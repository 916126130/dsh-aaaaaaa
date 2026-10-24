# 一键守护 · dsh-aaaaaaa

English | [简体中文](README.md)

> Saves the one plugin setup that actually works. When a bad plugin forces DSH back to "all plugins disabled + settings wiped", come back and restore it with one click.

The package is called `dsh-aaaaaaa`, and that is also the name shown in the sidebar — so it sorts to the very top of your plugin list and is easy to find.

---

## What it does

| Capability | Description |
|---|---|
| Automatic snapshots | One "unverified" snapshot per launch; if startup succeeds and the config does not change for 75s it is promoted to "verified working" |
| Manual snapshot | Click "+ 记录当前配置" in the panel to save one at any time |
| One-click restore | Pick a snapshot, click restore, and the plugin list + settings are written back |
| Pre-restore backup | Every restore saves the current state first as "pre-restore", so a wrong restore can be undone |
| Auto cleanup | Keeps at most 15 snapshots (at most 10 verified), oldest non-verified ones are pruned |
| Always keeps itself | Restoring any snapshot also re-registers this plugin, so the plugin list never loses it |

Sidebar entry: **the column below New session → dsh-aaaaaaa**.

## Notes

1. **A full DSH restart is required after restoring** (quit from the tray as well) — the new plugin list only takes effect on the next launch.
2. **Coming back after a reset**: reopen DSH → open the 一键守护 panel → click restore on a snapshot → quit DSH completely and open it again.
3. Snapshots only record `package.json` and `cordis.patch.yml`. Plugin code lives in `~/.dsh/plugins` and each plugin's own directory; restoring does **not** reinstall plugins — it restores *which ones are enabled and how they are configured*.
4. Everything is local (`~/.dsh/guardian/`). No network, nothing uploaded.
5. "Verified" is decided automatically: it requires the config to stay unchanged for 75s after startup. Right after installing a plugin without restarting, snapshots show as "unverified" — restart to confirm.

## Install

Local plugin:

1. Put the `dsh-aaaaaaa` directory at `%USERPROFILE%\.dsh\plugins\dsh-aaaaaaa`;
2. Add to `%USERPROFILE%\.dsh\profiles\desktop\package.json`:

   ```json
   "dependencies": { "dsh-aaaaaaa": "file:../../plugins/dsh-aaaaaaa" },
   "dsh": { "profile": { "bundles": [ "…existing…", "dsh-aaaaaaa" ] } }
   ```

3. Create the directory link (PowerShell, no admin needed):

   ```bat
   cmd /c mklink /J "%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-aaaaaaa" "%USERPROFILE%\.dsh\plugins\dsh-aaaaaaa"
   ```

4. Quit DSH completely and open it again.

## Where the data lives

| Path | Content |
|---|---|
| `%USERPROFILE%\.dsh\guardian\snapshots\` | All snapshots (`package.json` + `cordis.patch.yml` + `meta.json`) |
| `%USERPROFILE%\.dsh\guardian\status.json` | Heartbeat of the running process (pid / version / bundle count) |
| `%USERPROFILE%\.dsh\guardian\guardian.log` | Plugin log |

## Versions

| Version | Change |
|---|---|
| 1.3.1 | Panel renamed 一键守护; bilingual docs; copy no longer describes automatic post-reset behavior |
| 1.3.0 | Renamed to `dsh-aaaaaaa`; watchdog added; self-registration always preserved; legacy names cleaned |
| 1.2.3 | Panel shows the "always keeps itself" status with a one-click repair |
| 1.2.2 | Restore no longer strips its own registration |
| 1.2.1 | Panel and snapshot list scroll properly |
| 1.2.0 | Sidebar panel + HTTP routes |
| 1.0.0 | First working version (snapshot engine) |

## Optional: watchdog (auto-restore after a reset)

After a reset the plugin is not loaded, so the panel cannot appear either. The watchdog is a small script **outside** DSH, run every 5 minutes by Windows Task Scheduler:

- if the plugin registration was wiped from the profile, it puts it back;
- if the startup list collapsed to official bundles only, it writes back the newest **healthy** snapshot and re-adds this plugin.

Install (from the repository root):

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.dsh\aaaaaaa-watch" | Out-Null
Copy-Item .\watchdog\watchdog.ps1, .\watchdog\run.cmd "$env:USERPROFILE\.dsh\aaaaaaa-watch\" -Force
schtasks /Create /F /TN "dsh-aaaaaaa watch" /SC MINUTE /MO 5 /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File %USERPROFILE%\.dsh\aaaaaaa-watch\watchdog.ps1"
```

Disable auto-restore by setting `{"autoRestore": false}` in `%USERPROFILE%\.dsh\guardian\watchdog.json`; the watchdog then only re-registers the plugin.

> Not needed on macOS / Linux: a single DSH restart is enough there.

## Uninstall

1. Remove the `dsh-aaaaaaa` dependency and bundle entry from `profiles/<name>/package.json`;
2. Delete `profiles/<name>/node_modules/dsh-aaaaaaa` and `~/.dsh/plugins/dsh-aaaaaaa`;
3. `~/.dsh/guardian` can be kept as a backup or deleted entirely.

## License

MIT
