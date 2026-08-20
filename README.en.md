# dsh-notify-windows

> A DeepSeek Harness (DSH) plugin that sends Windows toast notifications whenever the agent needs your attention.

<p align="center">
  <img src="https://img.shields.io/npm/v/dsh-notify-windows" alt="npm">
  <img src="https://img.shields.io/github/license/SeverusZh/dsh-notify-windows" alt="license">
  <img src="https://img.shields.io/badge/platform-Windows%2010%2F11-blue" alt="platform">
  <img src="https://img.shields.io/github/stars/SeverusZh/dsh-notify-windows?style=social" alt="stars">
</p>

**Task finished** ✅ ｜ **Approval pending** 🔐 ｜ **Question pending** ❓ — never miss anything that needs you, even away from the screen.

## ✨ Features

- **Task completion** — listens to `turn/end` session events; toasts on completed / errored / max-tokens turns, with the session title and reason;
- **Approval pending** — listens to `approval/asked`; toasts the moment a permission decision is waiting, and skips sessions whose approval policy is `never` (nothing is waiting there);
- **Question pending** — toasts when the agent calls `ask_user_question`; in this deployment every tool call goes through `run_code`, so the plugin also scans `run_code` source for `tools.ask_user_question(` calls and extracts the question text;
- **Quiet by default** — subagent sessions are ignored unless `includeSubagents` is set;
- **Zero dependencies** — toasts are sent through Windows PowerShell 5.1's WinRT toast API, with the AppUserModelId registered under HKCU on first use (no admin required);
- **Diagnosable** — optional log (`%TEMP%\dsh-notify\notify.log`) and a debug event log.

## 🚀 Install

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

## ⚙️ Configuration

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

## 🔔 Triggers

| Scenario | Session event | Sample toast |
| --- | --- | --- |
| Task finished | `turn/end` | Task completed (turn N) |
| Task errored / capped | `turn/end` | Task errored / Output hit token cap |
| Approval waiting | `approval/asked` | DeepSeek Harness · Needs approval / tool pwsh: … |
| Question waiting | `tool/call` (incl. run_code detection) | DeepSeek Harness · Needs your answer / Continue? |

## 🔗 Click to open

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

## 🧪 Verify

```powershell
node scripts\smoke-test.mjs
```

Runs the plugin on a bare cordis Context with synthetic events: three test toasts fire (completion, approval, question) and the log assertions verify the filtering (subagent, `never`-policy, unrelated calls).

## ❓ FAQ

- **No toast?** Check Windows notification settings for this app and Focus Assist; the AUMID registers itself on first use.
- **Do /goal rounds toast?** Not by default: auto-continuation rounds stay quiet and only the final round that completes (or blocks) the goal toasts. Set `notifyOnGoalRounds` to `true` to hear every round.
- **Approval toasts missing?** Sessions whose approval policy is `never` auto-reject — nothing waits, so the plugin stays quiet. Only `ask`-policy sessions notify.
- **Hot-update after code changes?** Run `dsh plugin --profile web update dsh-notify-windows`, then restart the DSH host.

## 📄 License

[MIT](./LICENSE) © 2026 SeverusZh