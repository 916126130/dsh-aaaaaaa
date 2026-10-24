# 一键守护 · dsh-aaaaaaa

[English](README.en.md) | 简体中文

> 把「插件能正常工作」的那一份配置存下来。哪天 DSH 因为插件不兼容把你打回「禁用所有插件 + 清空设置」，回来点一下就能还原。

插件名是 `dsh-aaaaaaa`，侧边栏显示的名字也是 `dsh-aaaaaaa` —— 这样在插件列表里排得最靠前，一眼就能找到。

---

## 它做什么

| 能力 | 说明 |
|---|---|
| 自动快照 | 每次启动记一份「待验证」；启动成功且 75 秒内配置没再变动，自动转成「已验证可用」 |
| 手动快照 | 面板上点「+ 记录当前配置」，随时存一份 |
| 一键恢复 | 选一份快照点「恢复」，把插件清单和设置写回当前 profile |
| 恢复前备份 | 每次恢复前先存一份「恢复前备份」，恢复错了还能退回去 |
| 自动清理 | 最多保留 15 份（其中「已验证可用」最多 10 份），超出自动删最旧的 |
| 强制保留自身 | 恢复任何快照都会把本插件的登记一并写回，插件列表不会因为恢复而缺它 |

侧边栏入口：**新会话下面那一列 → dsh-aaaaaaa**。

## 注意事项

1. **恢复后必须完全退出 DSH**（托盘也退掉）再重新打开，新的插件列表才会生效。
2. **被重置之后怎么回来**：重新打开 DSH → 进到「一键守护」面板 → 点「恢复」选一份快照 → 再完全退出重开。
3. 快照只记录 `package.json` 与 `cordis.patch.yml`。插件代码本身在 `~/.dsh/plugins` 和各插件自己的目录里，恢复**不会**帮你重装插件，只恢复「启用了哪些、设置成什么」。
4. 数据都在本地（`~/.dsh/guardian/`），不联网、不上传。
5. 「已验证可用」是自动判定的：启动后 75 秒内配置没变动才算。装完插件**没重启**时，它会显示成「待验证」，提示你重启确认。

## 安装

本地插件，装法：

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

## 数据在哪

| 路径 | 内容 |
|---|---|
| `%USERPROFILE%\.dsh\guardian\snapshots\` | 所有快照（`package.json` + `cordis.patch.yml` + `meta.json`） |
| `%USERPROFILE%\.dsh\guardian\status.json` | 当前进程心跳（pid / 版本 / 启动项数） |
| `%USERPROFILE%\.dsh\guardian\guardian.log` | 插件日志 |

## 版本

| 版本 | 说明 |
|---|---|
| 1.3.1 | 面板更名「一键守护」；说明改为中英双语；文案不再描述重置后的自动行为 |
| 1.3.0 | 改名 `dsh-aaaaaaa`；加看门狗；恢复/修复时强制保留自身；清掉旧包名残留 |
| 1.2.3 | 面板显示「常驻保护」状态与一键修复 |
| 1.2.2 | 恢复时不再剥离自身注册 |
| 1.2.1 | 面板与快照列表可滚动 |
| 1.2.0 | 侧边栏面板 + HTTP 接口 |
| 1.0.0 | 首个可用版本（快照引擎） |

## 卸载

1. 删 `profiles/<name>/package.json` 里的 `dsh-aaaaaaa` 依赖与启动项；
2. 删 `profiles/<name>/node_modules/dsh-aaaaaaa` 链接与 `~/.dsh/plugins/dsh-aaaaaaa`；
3. 数据目录 `~/.dsh/guardian` 可留作备份，也可整目录删掉。

## License

MIT
