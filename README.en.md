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

### Option A: npm (recommended)

```powershell
dsh plugin --profile web add dsh-notify-windows
```

Then add this entry to the profile's `cordis.patch.yml` (the running host hot-applies it — no restart needed):

```yaml
- insert:
    - id: dsh-notify
      name: 'dsh-notify-windows'
      config:
        enabled: true
        reasons: [completed, error, max-tokens]
        includeSubagents: false
        notifyOnStart: true
        notifyOnApproval: true
        notifyOnAskUser: true
        appName: 'DeepSeek Harness'
        aumid: 'DeepSeekHarness.Notify'
        log: true
        debug: false
```

### Option B: from source

```powershell
git clone git@github.com:SeverusZh/dsh-notify-windows.git
cd dsh-notify-windows
pwsh scripts\install-profile.ps1 -Profile web
```

The script deploys the package into the profile's hoisted `node_modules` as `dsh-notify-windows-<version>` — the versioned directory lets a running host hot-load a redeploy without a restart — and writes the patch entry above idempotently.

## ⚙️ Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | master switch |
| `reasons` | `[completed, error, max-tokens]` | turn-end reasons to notify (`aborted` / `interrupted` / `blocked` also available) |
| `includeSubagents` | `false` | also notify subagent sessions |
| `notifyOnStart` | `false` | toast when the plugin loads |
| `notifyOnApproval` | `true` | toast on `approval/asked` (skipped under policy `never`) |
| `notifyOnAskUser` | `true` | toast when the agent asks you a question |
| `appName` | `DeepSeek Harness` | toast source display name and fallback title |
| `aumid` | `DeepSeekHarness.Notify` | toast AppUserModelId |
| `log` | `true` | write `%TEMP%\dsh-notify\notify.log` |
| `debug` | `false` | log every session event (diagnostics, heavy) |

## 🔔 Triggers

| Scenario | Session event | Sample toast |
| --- | --- | --- |
| Task finished | `turn/end` | Task completed (turn N) |
| Task errored / capped | `turn/end` | Task errored / Output hit token cap |
| Approval waiting | `approval/asked` | DeepSeek Harness · Needs approval / tool pwsh: … |
| Question waiting | `tool/call` (incl. run_code detection) | DeepSeek Harness · Needs your answer / Continue? |

## 🧪 Verify

```powershell
node scripts\smoke-test.mjs
```

Runs the plugin on a bare cordis Context with synthetic events: three test toasts fire (completion, approval, question) and the log assertions verify the filtering (subagent, `never`-policy, unrelated calls).

## ❓ FAQ

- **No toast?** Check Windows notification settings for this app and Focus Assist; the AUMID registers itself on first use.
- **Approval toasts missing?** Sessions whose approval policy is `never` auto-reject — nothing waits, so the plugin stays quiet. Only `ask`-policy sessions notify.
- **Hot-update after code changes?** Re-run the install script (the versioned directory name busts the module cache); for npm installs run `dsh plugin --profile web update dsh-notify-windows` and restart the host.

## 📄 License

[MIT](./LICENSE) © 2026 SeverusZh
