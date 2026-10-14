<div align="center">

# 🔔 dsh-notify-windows

**A DeepSeek Harness (DSH) plugin that sends Windows desktop notifications whenever the agent needs your attention**

[![npm version](https://img.shields.io/npm/v/dsh-notify-windows?style=flat-square&logo=npm)](https://www.npmjs.com/package/dsh-notify-windows)
[![npm downloads](https://img.shields.io/npm/dm/dsh-notify-windows?style=flat-square&logo=npm)](https://www.npmjs.com/package/dsh-notify-windows)
[![license](https://img.shields.io/npm/l/dsh-notify-windows?style=flat-square)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square&logo=node.js)](package.json)
[![GitHub release](https://img.shields.io/github/v/release/SeverusZh/dsh-notify-windows?style=flat-square&logo=github)](https://github.com/SeverusZh/dsh-notify-windows/releases)
[![GitHub stars](https://img.shields.io/github/stars/SeverusZh/dsh-notify-windows?style=flat-square&logo=github)](https://github.com/SeverusZh/dsh-notify-windows)
[![DSH](https://img.shields.io/badge/DSH-%E2%89%A50.1.7--rc.1-blue?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

</div>

**Task finished** ✅ ｜ **Approval pending** 🔐 ｜ **Question pending** ❓ — never miss anything that needs you, even away from the screen.

---

## ✨ 功能特性 / Features

- **Task completion** — listens to `turn/end` session events; toasts on completed / errored / max-tokens turns, with the session title and reason;
- **Approval pending** — listens to `approval/asked`; toasts the moment a permission decision is waiting, and skips sessions whose approval policy is `never` (nothing is waiting there);
- **Question pending** — toasts when the agent calls `ask_user_question`; in this deployment every tool call goes through `run_code`, so the plugin also scans `run_code` source for `tools.ask_user_question(` calls and extracts the question text;
- **Quiet by default** — subagent sessions are ignored unless `includeSubagents` is set;
- **Zero dependencies** — toasts are sent through Windows PowerShell 5.1's WinRT toast API, with the AppUserModelId registered under HKCU on first use (no admin required);
- **Diagnosable** — optional log (`%TEMP%\dsh-notify\notify.log`) and a debug event log.

## 📦 安装 / Install

The plugin installs through the **`dsh.bundle`** mechanism: the npm package ships its own
`cordis.patch.yml`, and after `dsh plugin add` it auto-mounts the `dsh-notify` entry — no
manual `- insert:` needed.

```powershell
dsh plugin --profile web add dsh-notify-windows
```

Restart DSH and refresh the browser:

```powershell
dsh --profile web
```

> Note: don't hand-add `- insert:` with `dsh-notify` anymore — DSH would fail to boot with
> `duplicate loader entry id: dsh-notify`. To tweak settings, override the entry by id in the
> profile's `cordis.patch.yml` (see below).

### Update / Remove

```powershell
dsh plugin --profile web update dsh-notify-windows
dsh plugin --profile web remove dsh-notify-windows
```

Restart the DSH host after updating (a newly added bundle layer needs a boot).

## ⚙️ 配置 / Configuration

All `config` keys are optional and default in the plugin. To override, target the entry by id
in `$DSH_HOME/profiles/web/cordis.patch.yml` (hot-applied by the running host — no restart):

```yaml
- id: dsh-notify
  name: dsh-notify-windows
  config:
    enabled: true
    reasons: [completed, error, max-tokens]
    notifyOnStart: true
    notifyOnApproval: true
    log: true
```

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | master switch |
| `reasons` | `[completed, error, max-tokens]` | turn-end reasons to notify (`aborted` / `interrupted` / `blocked` also available) |
| `locale` | `zh` | built-in message pack for the toast text: `zh` / `en` / `ru` |
| `messages` | `{}` | per-key wording overrides applied on top of `locale` (see Localization) |
| `includeSubagents` | `false` | also notify subagent sessions |
| `notifyOnStart` | `false` | toast when the plugin loads |
| `notifyOnApproval` | `true` | toast on `approval/asked` (skipped under policy `never`) |
| `notifyOnAskUser` | `true` | toast when the agent asks you a question |
| `notifyOnGoalRounds` | `false` | stay quiet on /goal auto-continuation rounds (except the final complete/block round) |
| `excerpt` | `true` | append an excerpt of the agent's final reply to the toast |
| `excerptMaxChars` | `80` | max characters of the excerpt |
| `appName` | `DeepSeek Harness` | toast source display name and fallback title |
| `aumid` | `DeepSeekHarness.Notify` | toast AppUserModelId |
| `log` | `true` | write `%TEMP%\dsh-notify\notify.log` |
| `debug` | `false` | log every session event (diagnostics, heavy) |
| `openOnClick` | `true` | make completion / approval / question toasts clickable (false falls back to the old non-clickable toast) |
| `preferExisting` | `true` | when true, launcher prefers focusing an open DSH window; when false, just open the URL in the default browser |
| `webUrl` | `''` | override the auto-discovered base URL (e.g. `http://192.168.1.5:4000`); leave empty to auto-discover (defaults to `http://127.0.0.1:3080`) |

## 🌐 多语言 / Localization

Toast wording comes from a built-in message pack selected by `locale`. The default is `zh`, so an
existing install sees no change after upgrading; `en` and `ru` ship as complete packs. Any single
string can be overridden per install through `messages`, which wins over the selected pack:

```yaml
- id: dsh-notify
  name: dsh-notify-windows
  config:
    locale: ru
    messages:
      approvalTitle: ' · Требуется одобрение'
      turnSuffix: ' — попытка {turn}'
```

| Key | Used for |
| --- | --- |
| `completed` / `error` / `max-tokens` / `aborted` / `interrupted` / `blocked` | the turn/end reason line (looked up by `reason.kind`) |
| `turnEnded` | fallback when a reason has no entry in the pack |
| `turnSuffix` | turn number appended to the reason line — `{turn}` |
| `approvalTitle` | title suffix of an approval toast |
| `approvalToolWithReason` / `approvalTool` / `approvalGeneric` | approval body — `{tool}`, `{reason}` |
| `askTitle` | title suffix of a question toast |
| `askFallback` | question body when no question text could be extracted |
| `activated` | the `notifyOnStart` toast — `{version}` |
| `warnSpawnFailed` / `warnToastFailed` / `warnExitCode` / `warnChannelUnavailable` | DSH log wording — `{code}`; the `dsh-notify:` tag itself is never translated, so logs stay greppable across locales |

`{placeholder}` tokens are substituted from the event data. An unknown placeholder is left verbatim
rather than blanked, and a non-string override is ignored — a typo can therefore never produce an
empty or `[object Object]` toast. An unknown `locale` falls back to the default pack.

The `approval` and `ask-user` log entries now carry `title` and `body` alongside the existing
metadata (matching what the `notify` entry already did), so `%TEMP%\dsh-notify\notify.log` shows
the text that was actually sent.

## 🔔 触发场景 / Triggers

| Scenario | Session event | Sample toast |
| --- | --- | --- |
| Task finished | `turn/end` | Task completed (turn N) |
| Task errored / capped | `turn/end` | Task errored / Output hit token cap |
| Approval waiting | `approval/asked` | DeepSeek Harness · Needs approval / tool pwsh: … |
| Question waiting | `tool/call` (incl. run_code detection) | DeepSeek Harness · Needs your answer / Continue? |

## 🔗 点击通知跳转 / Click to Open

Toasts for task completion / approval pending / question pending are clickable → they open the
DSH Web GUI. The plugin prefers to focus an already-open DSH browser tab or Chrome Application
window; if none is open, it opens a new tab in the default browser and loads the GUI. The target
URL carries a `?session=<id>` parameter (not yet consumed by the rc.8 frontend — reserved for
future deep links).

**Configuration:**

- `openOnClick` (default `true`; `false` disables clickability and falls back to the old non-clickable toast);
- `preferExisting` (default `true`; when true the launcher prefers reusing an existing window; when false it opens the URL directly in the default browser);
- `webUrl` (optional, overrides the auto-discovered base URL, e.g. `http://192.168.1.5:4000`; leave empty to auto-discover / default `http://127.0.0.1:3080`).

**Notes:** the first click auto-registers the `dshnotify://` protocol handler (HKCU, no admin
needed); on failure it silently degrades to "open in default browser".

> Note: DSH 0.1.0-rc.8 does not yet support deep-linking to a single session by URL; clicking opens the DSH interface (home / session list) and focuses the existing window, and you pick the target session from the list. Once the DSH frontend supports deep links, `?session=<id>` will jump straight to it.

## 🧩 兼容性 / Compatibility

The `@deepseek-ai/dsh*` range in `peerDependencies` determines whether the plugin passes DSH's compatibility gate. This plugin declares **`>=0.1.7-rc.1`** (no upper bound), and has been tested on:

| DSH version | Status |
| --- | --- |
| 0.1.5-rc.1 | ✅ Tested |
| 0.1.5-rc.2 | ✅ Tested |
| 0.1.6-alpha.2 | ✅ Tested |
| 0.1.7-rc.1 | ✅ Tested |
| 0.1.7-rc.2 | ✅ Tested |
| 0.2.0-rc.1 | ✅ Tested |

> Only versions that were **actually run** are listed; untested versions are omitted.

v0.8.0 supports DSH **0.1.2-alpha.4+** and was verified against the `snapshotEvents()` contract on **0.1.5-rc.1 / 0.1.5-rc.2 / 0.1.6-alpha.2 / 0.1.7-rc.1 / 0.1.7-rc.2 / 0.2.0-rc.1** with the real-Cordis probe suite (15/15; peer `@deepseek-ai/cordis ^4.0.2`). Session history is read through both the legacy `session.events` (DSH <= 0.1.2-alpha.3) and `snapshotEvents()` (DSH 0.1.2-alpha.4+, where that property no longer exists), so excerpts, `/goal` round detection and approval-policy suppression work again after upgrading to 0.7.5. If you saw "all notifications went silent after a restart", upgrade to **0.7.3+** (see FAQ).

> **0.1.7-rc.1 note**: since this release `snapshotEvents()` is marked `@deprecated` ("new calls forbidden; existing unmigrated logic may stay for now"). This plugin's history read is such existing logic, so under the official Agent Note's deferral policy it is not migrated yet — DSH still keeps the full event sequence in memory, so notification excerpts and `/goal` round checks keep working; migration will follow once DSH offers an asynchronous paged read.

## 🛠️ 开发 / Develop

```powershell
node scripts\smoke-test.mjs
```

Runs the plugin on a bare cordis Context with synthetic events: three test toasts fire (completion, approval, question) and the log assertions verify the filtering (subagent, `never`-policy, unrelated calls).

## ❓ FAQ

- **No toast?** Check Windows notification settings for this app and Focus Assist; the AUMID registers itself on first use. On startup the plugin self-checks the notification channel (`powershell.exe` and `notify.ps1` reachable) and warns immediately in the DSH log if it is unavailable; each failed send also records the detailed reason in `%TEMP%\dsh-notify\notify.log`.
- **No toast under WSL?** The plugin uses `wslpath -w` to convert the script path to a `\\wsl.localhost\...` UNC path and prefers `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe` to invoke PowerShell (PATH-independent, so it works in minimal environments such as systemd / cron). If it still fails, check the `error` entries in `%TEMP%\dsh-notify\notify.log`.
- **Do /goal rounds toast?** Not by default: auto-continuation rounds stay quiet and only the final round that completes (or blocks) the goal toasts. Set `notifyOnGoalRounds` to `true` to hear every round.
- **Approval toasts missing?** Sessions whose approval policy is `never` auto-reject — nothing waits, so the plugin stays quiet. Only `ask`-policy sessions notify.
- **All notifications went silent after restarting DSH?** Fixed in **0.7.3**: the subagent check used to be `delegationDepth !== undefined`, which treated every restored main session (persisted with `delegationDepth: 0`) as a subagent and filtered it out. Upgrade to **0.7.3 or newer** (0.7.5 recommended), then restart the DSH host.
- **Empty excerpts, /goal intermediate rounds toasting, approvals toasting under `never`?** The plugin read `session.events`, a property DSH stopped exposing in **0.1.2-alpha.4** (history moved to `snapshotEvents()`); **0.7.4 and earlier** silently degraded in that case. Upgrade to **0.7.5 or newer**. If `history-unavailable` still appears in `%TEMP%\dsh-notify\notify.log`, please attach the log.
- **Hot-update after code changes?** Run `dsh plugin --profile web update dsh-notify-windows`, then restart the DSH host.

## 📄 许可证 / License

[MIT](./LICENSE) © 2026 SeverusZh
