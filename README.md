# dsh-notify-windows

> DeepSeek Harness（DSH）插件：当 Agent 需要你关注时，向 Windows 发送系统桌面通知。

<p align="center">
  <img src="https://img.shields.io/npm/v/dsh-notify-windows" alt="npm">
  <img src="https://img.shields.io/github/license/SeverusZh/dsh-notify-windows" alt="license">
  <img src="https://img.shields.io/badge/platform-Windows%2010%2F11-blue" alt="platform">
  <img src="https://img.shields.io/github/stars/SeverusZh/dsh-notify-windows?style=social" alt="stars">
</p>

**任务完成** ✅ ｜ **等待审批** 🔐 ｜ **等待回答** ❓ —— 离开屏幕也不错过任何需要你处理的事。

## ✨ 功能

- **任务完成提醒**：监听会话 `turn/end` 事件，任务完成 / 出错 / 输出超限时立即弹窗，标题自动使用会话标题，正文显示原因与轮次；
- **权限审批提醒**：监听 `approval/asked` 事件，有操作等待你的审批时立即提醒；会话审批策略为 `never` 时自动跳过（此时没有东西在等你）；
- **提问确认提醒**：Agent 调用 `ask_user_question` 向你提问时提醒；本部署下所有工具都经 `run_code` 调用，插件会扫描 `run_code` 程序源码中的 `tools.ask_user_question(` 调用并提取问题文本；
- **防打扰**：默认忽略子代理（subagent）会话，只提醒主会话；
- **零依赖**：通知通过 Windows PowerShell 5.1 的 WinRT Toast API 发送，自动注册 HKCU 的 AppUserModelId（无需管理员权限）；
- **可诊断**：可选日志（`%TEMP%\dsh-notify\notify.log`）与 debug 事件日志。

## 🚀 安装

### 方式一：npm（推荐）

```powershell
dsh plugin --profile web add dsh-notify-windows
```

然后在 profile 的 `cordis.patch.yml` 中追加条目（该文件被运行中的 DSH 热监视，改动立即生效，无需重启）：

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

### 方式二：源码安装

```powershell
git clone git@github.com:SeverusZh/dsh-notify-windows.git
cd dsh-notify-windows
pwsh scripts\install-profile.ps1 -Profile web
```

脚本会把插件部署到 profile 的 hoisted `node_modules`（目录名 `dsh-notify-windows-<版本>`，重新部署时更换目录名，让运行中的宿主热加载新代码而无需重启），并幂等地写入上面的 patch 条目。

## ⚙️ 配置项

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `reasons` | `[completed, error, max-tokens]` | 需要提醒的回合结束原因（可选 `aborted` / `interrupted` / `blocked`） |
| `includeSubagents` | `false` | 是否也提醒子代理会话 |
| `notifyOnStart` | `false` | 插件加载时发一条「已激活」通知 |
| `notifyOnApproval` | `true` | 审批请求提醒（策略 `never` 时自动跳过） |
| `notifyOnAskUser` | `true` | Agent 提问等待回答时提醒 |
| `appName` | `DeepSeek Harness` | 通知来源显示名与兜底标题 |
| `aumid` | `DeepSeekHarness.Notify` | 通知 AppUserModelId |
| `log` | `true` | 写日志到 `%TEMP%\dsh-notify\notify.log` |
| `debug` | `false` | 把所有会话事件写入日志（排查用，量大） |

## 🔔 触发场景

| 场景 | 会话事件 | 通知示例 |
| --- | --- | --- |
| 任务完成 | `turn/end` | 「任务已完成（第 N 轮）」 |
| 任务出错 / 超限 | `turn/end` | 「任务出错」/「输出达到 token 上限」 |
| 等待审批 | `approval/asked` | 「DeepSeek Harness · 需要审批 / 工具 pwsh：…」 |
| 等待回答 | `tool/call`（含 run_code 检测） | 「DeepSeek Harness · 需要回答 / 是否继续？」 |

## 🧪 验证

```powershell
node scripts\smoke-test.mjs
```

独立进程内用 cordis Context 模拟会话事件：应弹出任务完成 / 审批 / 提问三条测试通知，并断言日志记录与过滤行为（子代理、`never` 策略、无关调用均被过滤）。

## ❓ 常见问题

- **收不到通知？** 检查 Windows「通知与操作」设置是否允许该应用显示通知，以及「专注助手」是否开启；首次发送会自动注册 AUMID。
- **为什么审批提醒有时不弹？** 会话审批策略为 `never` 时审批会被自动拒绝、不会等待，插件会跳过提醒；策略为 `ask` 时才提醒。
- **更新插件代码后如何热更新？** 重新执行安装脚本（版本目录名变化即热加载）；用 npm 安装时执行 `dsh plugin --profile web update dsh-notify-windows` 后重启宿主。

## 📄 许可证

[MIT](./LICENSE) © 2026 SeverusZh
