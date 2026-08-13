# dsh-notify

A DeepSeek Harness (DSH) plugin that sends Windows toast notifications whenever
the agent needs your attention:

1. Task finished (turn/end) — a turn completed, errored, or hit the token cap;
2. Approval pending (approval/asked) — a permission decision is waiting for you
   (skipped when the session's approval policy is never, since nothing waits);
3. Question pending — the agent asked you a question via ask_user_question,
   including calls nested inside run_code programs (in this deployment every
   tool call goes through run_code, so the plugin scans run_code source for
   tools.ask_user_question( calls).

Zero runtime dependencies: toasts are sent through Windows PowerShell 5.1's
WinRT toast API (lib/notify.ps1), with the AppUserModelId registered under HKCU
on first use (no admin required).

## Install

```powershell
pwsh scripts\install-profile.ps1 -Profile web   # or: dsh plugin --profile web add dsh-notify
```

The script deploys the package into the profile's hoisted node_modules as
dsh-notify-<version> (the versioned directory lets a running host hot-load a
redeploy without a restart) and adds this entry to the profile's
cordis.patch.yml, which the running host hot-applies:

```yaml
- insert:
    - id: dsh-notify
      name: 'dsh-notify-0.4.0'
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

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| enabled | true | master switch |
| reasons | [completed, error, max-tokens] | turn-end reasons to notify |
| includeSubagents | false | also notify subagent sessions |
| notifyOnStart | false | toast when the plugin loads |
| notifyOnApproval | true | toast on approval/asked (policy-aware) |
| notifyOnAskUser | true | toast when the agent asks a question |
| appName | DeepSeek Harness | toast source display name |
| aumid | DeepSeekHarness.Notify | toast AppUserModelId |
| log | true | write %TEMP%\dsh-notify\notify.log |
| debug | false | log every session event (diagnostics, heavy) |

## Verify

```powershell
node scripts\smoke-test.mjs
```

Runs the plugin on a bare cordis Context with synthetic events and asserts the
log output (task, approval, and question toasts fire; subagent / never-policy /
unrelated events are filtered).

## Limitations

- Windows only (requires Windows PowerShell 5.1, shipped with Windows 10/11);
- toast delivery depends on the system notification / Focus Assist settings;
- the run_code question detection is heuristic and may miss or misreport.
