/**
 * dsh-yijianhuifu — DSH 配置守护（宿主侧插件）
 *
 * 目的：DSH 桌面版在插件不兼容导致启动失败时，会弹「禁用第三方插件」，
 * 一点就把 cordis.patch.yml 改名、dsh.profile.bundles 重置成
 * ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]，所有插件和设置消失。
 * 本插件在「能启动、能稳定运行」的时刻把配置拍成快照，事后一键回到那个状态。
 *
 * 设计约束（很重要）：
 *  1. apply() 绝对不能抛异常 —— 它在启动路径上。全部包在 try/catch 里。
 *  2. 不在模块顶层做任何 IO —— 导入期出错会让插件树加载失败。
 *  3. 定时器全部 unref()，不拖住宿主进程退出。
 *  4. 只读 profile 目录；写入只发生在用户明确点「恢复」时。
 *  5. 只有「本次启动加载的配置 + 稳定运行 75 秒后仍未被改动」才记为
 *     healthy。启动前/运行中改过的配置一律记 pending，等下次重启验证 ——
 *     否则一个坏插件刚装上前就把坏状态标成「可用」，恢复就救不回来了。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

export const name = "yijianhuifu";

/** 需要 webServer 服务来给面板提供 HTTP 接口。 */
export const inject = ["webServer"];

const PKG_NAME = "dsh-yijianhuifu";
const PLUGIN_VERSION = "1.2.2";
const HEALTHY_DELAY_MS = Number(process.env.DSH_GUARDIAN_HEALTHY_DELAY_MS || 75000);
const DEBOUNCE_MS = Number(process.env.DSH_GUARDIAN_DEBOUNCE_MS || 4000);
const HEARTBEAT_MS = 5 * 60 * 1000;
const KEEP_TOTAL = 15;
const KEEP_HEALTHY = 10;
const PROFILE_FILES = ["package.json", "cordis.patch.yml"];
const API = "/api/dsh-yijianhuifu";
const SELF_SPEC = "file:../../plugins/dsh-yijianhuifu";
const SELF_BUNDLE = "yijianhuifu";

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

/** 解析出 profile 目录与数据目录；任何一步失败都返回 null 而不是抛错。 */
function resolvePaths() {
  try {
    const home = (process.env.DSH_HOME || path.join(os.homedir(), ".dsh")).replace(/[\\/]+$/, "");
    const profileName = process.env.DSH_PROFILE || "desktop";
    const profile = (process.env.DSH_PROFILE_DIR || path.join(home, "profiles", profileName)).replace(/[\\/]+$/, "");
    const root = path.join(home, "guardian");
    return {
      home,
      profileName,
      profile,
      root,
      snaps: path.join(root, "snapshots"),
      status: path.join(root, "status.json"),
      logFile: path.join(root, "guardian.log"),
      homePatch: path.join(home, "cordis.patch.yml"),
    };
  } catch {
    return null;
  }
}

function log(p, message) {
  try {
    fs.appendFileSync(p.logFile, `[${new Date().toISOString()}] [plugin] ${message}\n`, "utf8");
  } catch {
    /* 日志写不进去就算了 */
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function stripBom(text) {
  return text && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function readJson(file) {
  const text = readText(file);
  if (text === null) return null;
  try {
    return JSON.parse(stripBom(text));
  } catch {
    return null;
  }
}

/** 先写临时文件再 rename，避免写到一半被读到半截 JSON。 */
function writeAtomic(file, content) {
  const tmp = `${file}.guardian-tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

/** profile 的 node_modules 里要有指向插件目录的链接；pnpm 重装或重置后可能没了。 */
function ensureSelfLink(p) {
  try {
    const link = path.join(p.profile, "node_modules", PKG_NAME);
    const src = path.join(p.home, "plugins", PKG_NAME);
    if (fs.existsSync(link)) return true;
    if (!fs.existsSync(src)) return false;
    fs.mkdirSync(path.join(p.profile, "node_modules"), { recursive: true });
    fs.symlinkSync(src, link, "junction");
    return true;
  } catch {
    return false;
  }
}

/**
 * 自愈：确保 profile 的 package.json 里始终有本插件的依赖与启动项。
 *
 * 「禁用第三方插件」和快照恢复都可能把它抹掉，而 home 层注册在部分版本上不生效，
 * 所以这里每次加载时补一次 —— 有则不动，无则补上，保证重启后面板还在。
 */
function selfHealRegistration(p) {
  try {
    const file = path.join(p.profile, "package.json");
    const text = readText(file);
    if (text === null) return false;
    const pkg = JSON.parse(stripBom(text));
    let changed = false;

    if (!pkg.dependencies || typeof pkg.dependencies !== "object") pkg.dependencies = {};
    if (!pkg.dependencies[PKG_NAME]) {
      pkg.dependencies[PKG_NAME] = SELF_SPEC;
      changed = true;
    }

    const dsh = pkg.dsh && typeof pkg.dsh === "object" ? pkg.dsh : (pkg.dsh = {});
    const prof = dsh.profile && typeof dsh.profile === "object" ? dsh.profile : (dsh.profile = {});
    const bundles = Array.isArray(prof.bundles) ? prof.bundles : (prof.bundles = []);
    if (!bundles.includes(SELF_BUNDLE)) {
      bundles.push(SELF_BUNDLE);
      changed = true;
    }

    if (!changed) {
      ensureSelfLink(p);
      return false;
    }
    writeAtomic(file, `${JSON.stringify(pkg, null, 2)}\n`);
    ensureSelfLink(p);
    log(p, "self-heal: 已把本插件重新登记到 profile 启动项");
    return true;
  } catch {
    return false;
  }
}

function fingerprint(pjText, ptText) {
  return createHash("sha256").update(pjText).update("\0").update(ptText).digest("hex").slice(0, 16);
}

function readState(p) {
  const pjText = readText(path.join(p.profile, "package.json"));
  if (pjText === null) return null;
  const ptText = readText(path.join(p.profile, "cordis.patch.yml")) ?? "";
  let pkg = null;
  try {
    pkg = JSON.parse(stripBom(pjText));
  } catch {
    pkg = null;
  }
  const deps = pkg && pkg.dependencies && typeof pkg.dependencies === "object" ? Object.keys(pkg.dependencies) : [];
  const bundles = pkg?.dsh?.profile?.bundles;
  return {
    pjText,
    ptText,
    hash: fingerprint(pjText, ptText),
    deps,
    bundles: Array.isArray(bundles) ? bundles.slice() : [],
    parseError: pkg === null,
  };
}

function stamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function readMeta(dir) {
  const meta = readJson(path.join(dir, "meta.json"));
  return meta && meta.id ? meta : null;
}

/** 按名字升序（时间顺序）返回快照元数据。 */
function listSnapshots(p) {
  let names = [];
  try {
    names = fs
      .readdirSync(p.snaps, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    const meta = readMeta(path.join(p.snaps, n));
    if (meta) out.push(meta);
  }
  return out;
}

function pruneSnapshots(p) {
  const all = listSnapshots(p);
  if (all.length <= KEEP_TOTAL) return;
  const keep = new Set();
  let healthyKept = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    const s = all[i];
    const isNewest = i >= all.length - 5;
    const healthyBudget = s.healthy && healthyKept < KEEP_HEALTHY;
    if (healthyBudget) healthyKept++;
    if (isNewest || healthyBudget || s.kind === "pre-restore") keep.add(s.id);
  }
  for (const s of all) {
    if (keep.has(s.id)) continue;
    try {
      fs.rmSync(path.join(p.snaps, s.id), { recursive: true, force: true });
      log(p, `pruned ${s.id}`);
    } catch {
      /* ignore */
    }
  }
}

/** 同 hash 且同 kind 已经拍过就复用，避免每次心跳堆一堆重复快照。 */
function writeSnapshot(p, kind, note) {
  const state = readState(p);
  if (!state) return null;
  const snaps = listSnapshots(p);
  const newest = snaps[snaps.length - 1];
  if (newest && newest.hash === state.hash && newest.kind === kind) return newest.id;

  let id = `${stamp()}-${kind}`;
  let dir = path.join(p.snaps, id);
  for (let n = 2; fs.existsSync(dir) && n < 100; n++) {
    id = `${stamp()}-${kind}-${n}`;
    dir = path.join(p.snaps, id);
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), state.pjText, "utf8");
  fs.writeFileSync(path.join(dir, "cordis.patch.yml"), state.ptText, "utf8");
  if (kind === "healthy") {
    const lock = readText(path.join(p.profile, "pnpm-lock.yaml"));
    if (lock !== null) fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), lock, "utf8");
  }
  const meta = {
    schema: 1,
    id,
    kind,
    healthy: kind === "healthy",
    createdAt: new Date().toISOString(),
    note,
    source: "plugin",
    pluginVersion: PLUGIN_VERSION,
    hash: state.hash,
    profileDir: p.profile,
    pluginCount: state.deps.length,
    bundleCount: state.bundles.length,
    plugins: state.deps,
    bundles: state.bundles,
  };
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
  pruneSnapshots(p);
  log(p, `snapshot ${id} kind=${kind} hash=${state.hash} plugins=${state.deps.length}`);
  return id;
}

function updateStatus(p, patch) {
  const current = readJson(p.status) || {};
  const next = { ...current, ...patch, pluginVersion: PLUGIN_VERSION, profileDir: p.profile };
  try {
    fs.mkdirSync(p.root, { recursive: true });
    fs.writeFileSync(p.status, JSON.stringify(next, null, 2), "utf8");
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* 恢复                                                                */
/* ------------------------------------------------------------------ */

/**
 * 把某份快照写回 profile。
 *
 * 关键点：恢复出来的 package.json 里会剥掉守护插件自己的依赖与启动项 ——
 * 守护插件改由 home 层 cordis.patch.yml 挂载（那一层不会被「禁用第三方插件」
 * 清掉），所以不能重复注册，否则面板会消失。
 */
function restoreSnapshot(p, id) {
  const snapDir = path.join(p.snaps, id);
  const meta = readMeta(snapDir);
  if (!meta) throw new Error("找不到这份快照");

  const pjRaw = readText(path.join(snapDir, "package.json"));
  if (pjRaw === null) throw new Error("快照里缺少 package.json，无法恢复");

  let pkg;
  try {
    pkg = JSON.parse(stripBom(pjRaw));
  } catch {
    throw new Error("快照里的 package.json 已损坏，拒绝写回");
  }

  if (pkg && pkg.dependencies && typeof pkg.dependencies === "object") {
    delete pkg.dependencies[PKG_NAME];
  }
  if (pkg?.dsh?.profile && Array.isArray(pkg.dsh.profile.bundles)) {
    pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter((b) => b !== PKG_NAME);
  }

  // 恢复出来的配置里必须保留守护插件自己的注册 —— 否则恢复完重启，面板就没了。
  // （home 层注册在部分版本上不生效，profile 层才是真正会被加载的那一条。）
  try {
    if (!pkg.dependencies || typeof pkg.dependencies !== "object") pkg.dependencies = {};
    pkg.dependencies[PKG_NAME] = SELF_SPEC;
    const dsh = pkg.dsh && typeof pkg.dsh === "object" ? pkg.dsh : (pkg.dsh = {});
    const prof = dsh.profile && typeof dsh.profile === "object" ? dsh.profile : (dsh.profile = {});
    const bundles = Array.isArray(prof.bundles) ? prof.bundles : (prof.bundles = []);
    if (!bundles.includes(SELF_BUNDLE)) bundles.push(SELF_BUNDLE);
  } catch {
    // 兜底：结构异常时不阻断恢复
  }

  const pjOut = `${JSON.stringify(pkg, null, 2)}\n`;
  JSON.parse(pjOut); // 写前自检：解析不过就抛，不动磁盘

  const ptRaw = readText(path.join(snapDir, "cordis.patch.yml"));
  const current = readState(p);
  const preRestoreId = current ? writeSnapshot(p, "pre-restore", `恢复 ${id} 之前的自动备份`) : null;

  writeAtomic(path.join(p.profile, "package.json"), pjOut);
  if (ptRaw !== null) writeAtomic(path.join(p.profile, "cordis.patch.yml"), ptRaw);
  ensureSelfLink(p);

  const after = readState(p);
  log(p, `restored ${id} → plugins=${after ? after.deps.length : "?"} (pre=${preRestoreId})`);
  return {
    restoredId: id,
    preRestoreId,
    pluginCount: after ? after.deps.filter((d) => d !== PKG_NAME).length : null,
    bundleCount: after ? after.bundles.length : null,
    hash: after ? after.hash : null,
    note: meta.note || "",
  };
}

/** 对比当前配置与某份快照，给出差异摘要。 */
function diffSnapshot(p, id) {
  const meta = readMeta(path.join(p.snaps, id));
  if (!meta) throw new Error("找不到这份快照");
  const now = readState(p);
  if (!now) throw new Error("读不到当前配置");
  const curPlugins = now.deps.filter((d) => d !== PKG_NAME);
  const curBundles = now.bundles.filter((b) => b !== PKG_NAME);
  const snapPlugins = (meta.plugins || []).filter((d) => d !== PKG_NAME);
  const snapBundles = (meta.bundles || []).filter((b) => b !== PKG_NAME);
  const minus = (a, b) => a.filter((x) => !b.includes(x));
  return {
    id,
    same: now.hash === meta.hash,
    plugins: { add: minus(snapPlugins, curPlugins), remove: minus(curPlugins, snapPlugins) },
    bundles: { add: minus(snapBundles, curBundles), remove: minus(curBundles, snapBundles) },
    counts: {
      now: { plugins: curPlugins.length, bundles: curBundles.length },
      snapshot: { plugins: snapPlugins.length, bundles: snapBundles.length },
    },
  };
}

/* ------------------------------------------------------------------ */
/* HTTP 接口                                                           */
/* ------------------------------------------------------------------ */

function sendJson(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1 << 20) {
        req.destroy();
        resolve({});
        return;
      }
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

function homePatchState(p) {
  const text = readText(p.homePatch);
  return {
    path: p.homePatch,
    exists: text !== null,
    registered: text !== null && text.includes(PKG_NAME),
  };
}

/** 只允许本机回环访问：这些接口能改写 profile，不该暴露给局域网/隧道。 */
function isLoopback(req) {
  try {
    const addr = req?.socket?.remoteAddress || req?.connection?.remoteAddress || "";
    if (!addr) return true;
    return addr === "::1" || addr === "127.0.0.1" || addr === "::ffff:127.0.0.1";
  } catch {
    return false;
  }
}

function sameSet(a, b) {
  const x = (a || []).filter((v) => v !== PKG_NAME).slice().sort();
  const y = (b || []).filter((v) => v !== PKG_NAME).slice().sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * 用户侧的插件清单：去掉官方内置项与本插件自己。
 * 「已安装」看 dependencies，「已生效」看 dsh.profile.bundles；
 * 两者对不上通常就是「装了插件但还没重启」。
 */
const SELF_IDS = new Set([PKG_NAME, "yijianhuifu"]);

function isOfficial(name) {
  return typeof name === "string" && name.startsWith("@deepseek-ai/");
}

function userList(list) {
  return (Array.isArray(list) ? list : []).filter((x) => typeof x === "string" && !SELF_IDS.has(x) && !isOfficial(x));
}

function snapshotView(p) {
  const snaps = listSnapshots(p).reverse();
  const now = readState(p);
  const status = readJson(p.status) || {};
  const installed = now ? userList(now.deps) : null;
  const started = now ? userList(now.bundles) : null;
  return {
    pluginVersion: PLUGIN_VERSION,
    profileDir: p.profile,
    current: now
      ? {
          hash: now.hash,
          pluginCount: installed.length,
          bundleCount: started.length,
          pendingPlugins: installed.filter((d) => !started.includes(d)).slice(0, 20),
          orphanBundles: started.filter((b) => !installed.includes(b)).slice(0, 20),
          parseError: now.parseError,
        }
      : null,
    status,
    homePatch: homePatchState(p),
    snapshots: snaps.map((m) => ({
      id: m.id,
      kind: m.kind,
      healthy: Boolean(m.healthy),
      createdAt: m.createdAt,
      note: m.note || "",
      pluginCount: userList(m.plugins).length,
      bundleCount: userList(m.bundles).length,
      hash: m.hash,
      active: Boolean(now && (now.hash === m.hash || (sameSet(m.plugins, now.deps) && sameSet(m.bundles, now.bundles)))),
    })),
  };
}

/**
 * 注册 HTTP 接口。每个都是独立 try/catch：任何一条失败都不能影响启动。
 * @param ctx 插件上下文（已 inject webServer）
 */
function registerRoutes(ctx, p) {
  const routes = [
    {
      kind: "exact",
      path: `${API}/health`,
      handler: async (req, res) => {
        sendJson(res, 200, {
          ok: true,
          name: PKG_NAME,
          version: PLUGIN_VERSION,
          ...snapshotView(p),
        });
      },
    },
    {
      kind: "exact",
      path: `${API}/list`,
      handler: async (req, res) => {
        try {
          sendJson(res, 200, { ok: true, ...snapshotView(p) });
        } catch (err) {
          sendJson(res, 500, { error: `读取快照失败：${err.message || err}` });
        }
      },
    },
    {
      kind: "exact",
      path: `${API}/snapshot`,
      handler: async (req, res) => {
        try {
          const body = req.method === "POST" ? await readBody(req) : {};
          const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 200) : "手动记录";
          const id = writeSnapshot(p, "healthy", note);
          if (!id) throw new Error("读不到当前配置");
          sendJson(res, 200, { ok: true, id, ...snapshotView(p) });
        } catch (err) {
          sendJson(res, 500, { error: `记录快照失败：${err.message || err}` });
        }
      },
    },
    {
      kind: "exact",
      path: `${API}/diff`,
      handler: async (req, res) => {
        try {
          const url = new URL(req.url || "/", "http://localhost");
          const id = url.searchParams.get("id") || "";
          sendJson(res, 200, { ok: true, diff: diffSnapshot(p, id) });
        } catch (err) {
          sendJson(res, 400, { error: `${err.message || err}` });
        }
      },
    },
    {
      kind: "exact",
      path: `${API}/restore`,
      handler: async (req, res) => {
        try {
          if (req.method !== "POST") {
            sendJson(res, 405, { error: "请用 POST 调用恢复接口" });
            return;
          }
          const body = await readBody(req);
          const id = typeof body.id === "string" ? body.id : "";
          if (!id) {
            sendJson(res, 400, { error: "缺少快照 id" });
            return;
          }
          const result = restoreSnapshot(p, id);
          sendJson(res, 200, { ok: true, needRestart: true, ...result, ...snapshotView(p) });
        } catch (err) {
          sendJson(res, 500, { error: `恢复失败：${err.message || err}` });
        }
      },
    },
  ];

  ctx.effect(
    () => {
      const disposers = [];
      for (const route of routes) {
        try {
          const handler = route.handler;
          disposers.push(
            ctx.webServer.register({
              ...route,
              handler: async (req, res) => {
                if (!isLoopback(req)) {
                  sendJson(res, 403, { error: "仅允许本机访问" });
                  return;
                }
                return handler(req, res);
              },
            }),
          );
        } catch (err) {
          log(p, `route ${route.path} register failed: ${err}`);
        }
      }
      return () => {
        for (const dispose of disposers) {
          try {
            if (typeof dispose === "function") dispose();
          } catch {
            /* ignore */
          }
        }
      };
    },
    "yijianhuifu: http routes",
  );
}

/* ------------------------------------------------------------------ */
/* 生命周期                                                            */
/* ------------------------------------------------------------------ */

/** 启动 75 秒后的判定：配置仍是启动时那一份 → healthy；变过 → pending。 */
function bootCheck(p, bootHash) {
  const now = readState(p);
  if (!now) return;
  const checkedAt = new Date().toISOString();
  if (bootHash && now.hash === bootHash) {
    const id = writeSnapshot(p, "healthy", "启动成功并稳定运行，配置未被修改");
    updateStatus(p, { healthyCheckedAt: checkedAt, lastHealthyId: id, lastCheckHash: now.hash });
  } else {
    const id = writeSnapshot(p, "pending", "本次启动期间配置已被修改，等下次重启验证");
    updateStatus(p, { healthyCheckedAt: checkedAt, lastCheckHash: now.hash, lastPendingId: id });
  }
}

function watchProfile(p) {
  try {
    let timer = null;
    const onChange = (_event, filename) => {
      try {
        const n = filename ? String(filename) : "";
        if (n && !PROFILE_FILES.some((f) => n === f || n.startsWith(f))) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          try {
            writeSnapshot(p, "pending", "配置文件发生变化，等待重启验证");
          } catch (err) {
            log(p, `watch snapshot failed: ${err}`);
          }
        }, DEBOUNCE_MS);
        if (timer.unref) timer.unref();
      } catch {
        /* ignore */
      }
    };
    const watcher = fs.watch(p.profile, onChange);
    watcher.on("error", (err) => log(p, `watch error: ${err}`));
    if (watcher.unref) watcher.unref();
  } catch (err) {
    log(p, `watch unavailable: ${err}`);
  }
}

/**
 * 插件入口。cordis 会在启动时调用一次。
 * 整个函数不抛异常：启动期抛错可能让插件树加载失败，反而制造启动问题。
 */
const GLOBAL_APPLIED = "__dshYiJianHuiFuApplied";

export function apply(ctx) {
  // 同一进程内被注册两次时（profile 层 + home 层同时在），只初始化一次。
  try {
    if (globalThis[GLOBAL_APPLIED]) return;
    globalThis[GLOBAL_APPLIED] = true;
  } catch (err) {
    // 忽略
  }

  let p = null;
  try {
    p = resolvePaths();
    if (!p) return;
    fs.mkdirSync(p.snaps, { recursive: true });
  } catch (err) {
    return;
  }

  try {
    if (ctx && ctx.webServer) {
      try {
        registerRoutes(ctx, p);
      } catch (err) {
        log(p, `routes unavailable: ${err}`);
      }
    }
  } catch (err) {
    log(p, `routes setup failed: ${err}`);
  }

  // 自愈：保证 profile 里始终有本插件的依赖与启动项（重置/恢复后不会被一起抹掉）
  try {
    selfHealRegistration(p);
  } catch {
    // 忽略
  }

  try {
    const boot = readState(p);
    const bootHash = boot ? boot.hash : null;
    const loadedAt = new Date().toISOString();
    updateStatus(p, {
      loadedAt,
      heartbeatAt: loadedAt,
      pid: process.pid,
      bootHash,
      bootPlugins: boot ? boot.deps.filter((d) => d !== PKG_NAME).length : null,
      bootBundles: boot ? boot.bundles.filter((b) => b !== PKG_NAME).length : null,
      node: process.version,
      homePatch: homePatchState(p).registered,
    });

    if (boot) {
      try {
        const newest = listSnapshots(p).pop();
        if (!newest || newest.hash !== boot.hash) {
          writeSnapshot(p, "pending", "启动时记录的配置（尚未验证）");
        }
      } catch (err) {
        log(p, `boot snapshot failed: ${err}`);
      }
    }

    const healthyTimer = setTimeout(() => {
      try {
        bootCheck(p, bootHash);
      } catch (err) {
        log(p, `boot check failed: ${err}`);
      }
    }, HEALTHY_DELAY_MS);
    if (healthyTimer.unref) healthyTimer.unref();

    const heartbeat = setInterval(() => {
      try {
        updateStatus(p, { heartbeatAt: new Date().toISOString(), pid: process.pid });
      } catch {
        /* ignore */
      }
    }, HEARTBEAT_MS);
    if (heartbeat.unref) heartbeat.unref();

    watchProfile(p);
  } catch (err) {
    try {
      if (p) log(p, `apply failed: ${err}`);
    } catch {
      /* 连日志都写不了，就安静退出 */
    }
  }
}
