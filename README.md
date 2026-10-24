# dsh-aaaaaaa · 一键恢复插件预设置

> 记录一份「能正常跑」的插件清单与设置；DSH 因插件不兼容被迫**禁用第三方插件（恢复出厂）**之后，一键写回。
> 名字特意起成 `aaaaaaa`，就是为了在插件列表里一眼能找到、排在最前面。

## 它解决什么问题

DSH 启动失败时会弹「禁用第三方插件」——这一步会：

- 把 `profiles/<name>/cordis.patch.yml` 改名成 `.bak-<时间戳>`（你的设置层被移走）；
- 把 `dsh.profile.bundles` 重置成只剩官方两项。

结果就是：插件全没了、设置全没了，你得一个个回忆当初装了什么。

这个插件把「好的时候长什么样」记下来，随时写回去。更关键的是：**它自己不会被这次重置带走**。

## 三层保障

| 层级 | 做什么 | 触发时机 |
|---|---|---|
| ① 面板 | 侧边栏「dsh-aaaaaaa」入口，列出所有快照，点「恢复」写回 | 插件正常加载时 |
| ② 恢复时强制保留 | 恢复任何快照都会把本插件自己的登记**强制**塞回 profile，哪怕那份快照里没有它 | 每次恢复 / 每次修复 |
| ③ 看门狗 | 每 5 分钟（以及开机登录）检查一次：profile 被重置就自动写回最近一份健康快照，并补回本插件登记 | DSH 没启动也能跑 |

> ⚠️ **如果重置后面板没有自动回来**（说明当时进程是「禁用插件」后原地重建、没有重新读 profile），请手动运行一次：
>
> - 桌面上的 **`dsh-aaaaaaa-restore.cmd`**（双击即可），或
> - `%USERPROFILE%\.dsh\aaaaaaa-watch\run.cmd`
>
> 它会立刻把本插件重新登记、并把最近一份健康快照写回去，然后**完全退出 DSH 再打开**，面板就回来了。

## 快照怎么来

- **自动**：插件每次启动时记一份 `pending`（待验证）；启动成功且配置在 **75 秒**内没再变动，改判为 `healthy`（已验证可用）。
- **手动**：面板上点「+ 记录当前配置」。
- **恢复前备份**：每次点「恢复」之前，先把当前状态存成 `pre-restore`，恢复错了还能退回来。
- 保留 **15 份**（其中健康快照最多 10 份），超出自动删最旧的；「当前配置」「恢复前备份」不会挤占这 15 份。

## 安装

本插件是**本地插件**（不发布到 npm），装法：

1. 把 `dsh-aaaaaaa` 目录放到 `%USERPROFILE%\.dsh\plugins\dsh-aaaaaaa`；
2. 在 `%USERPROFILE%\.dsh\profiles\desktop\package.json` 里加：
   ```json
   "dependencies": { "dsh-aaaaaaa": "file:../../plugins/dsh-aaaaaaa" },
   "dsh": { "profile": { "bundles": [ "…原有项…", "dsh-aaaaaaa" ] } }
   ```
3. 建目录链接（PowerShell，普通权限即可）：
   ```bat
   cmd /c mklink /J "%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-aaaaaaa" "%USERPROFILE%\.dsh\plugins\dsh-aaaaaaa"
   ```
4. 完全退出 DSH 再打开。

看门狗（可选但强烈建议）：

```bat
schtasks /Create /F /TN "dsh-aaaaaaa watch" /SC MINUTE /MO 5 /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%USERPROFILE%\.dsh\aaaaaaa-watch\watchdog.ps1\""
```

## 数据在哪

| 路径 | 内容 |
|---|---|
| `%USERPROFILE%\.dsh\guardian\snapshots\` | 所有快照（`package.json` + `cordis.patch.yml` + `meta.json`） |
| `%USERPROFILE%\.dsh\guardian\status.json` | 当前进程心跳（pid / 版本 / 启动项数） |
| `%USERPROFILE%\.dsh\guardian\guardian.log` | 插件日志 |
| `%USERPROFILE%\.dsh\guardian\watchdog.log` | 看门狗日志 |
| `%USERPROFILE%\.dsh\guardian\watchdog.json` | `{"autoRestore": true}`，设 false 关掉自动写回 |

## 看门狗判定规则

1. 每 5 分钟（开机登录也会跑一次）；
2. 先确保本插件自己还登记在 profile 里（被抹掉就补回，并重建 `node_modules` 链接）；
3. 再看 `bundles` 里第三方条目是否只剩 ≤1 个 —— 是就认定「被重置」，把最新一份 `healthy` 快照的 `package.json` + `cordis.patch.yml` 写回，并把本插件重新并入启动项；
4. 全程只操作本地文件，不联网。

## 版本

| 版本 | 说明 |
|---|---|
| 1.3.0 | 改名 `dsh-aaaaaaa`；加看门狗；恢复/修复时强制保留自身；清掉旧包名残留 |
| 1.2.3 | 面板显示「常驻保护」状态与一键修复 |
| 1.2.2 | 恢复时不再剥离自身注册 |
| 1.2.1 | 面板与快照列表可滚动 |
| 1.2.0 | 侧边栏面板 + HTTP 接口 |
| 1.1.0 | 宿主侧 v1.1 |
| 1.0.0 | 首个可用版本（快照引擎） |

## 已知边界

- **「禁用第三方插件」不会重启进程**：插件树是原地重建的，所以那一刻本插件一定不在；面板要等下一次**完全重启**才会回来（或手动跑一次看门狗）。
- 恢复后必须**完全退出 DSH**（托盘也要退）再打开，新的插件列表才生效。
- 快照只记 `package.json` 与 `cordis.patch.yml`；插件代码本身在 `~/.dsh/plugins` 和各插件自己的目录里，恢复不会重装插件。

## 卸载

1. 删 `profiles/<name>/package.json` 里的 `dsh-aaaaaaa` 依赖与启动项；
2. 删 `profiles/<name>/node_modules/dsh-aaaaaaa` 链接与 `~/.dsh/plugins/dsh-aaaaaaa`；
3. 删计划任务：`schtasks /Delete /TN "dsh-aaaaaaa watch" /F`；
4. 数据目录 `~/.dsh/guardian` 可留作备份，也可整目录删掉。

## License

MIT
