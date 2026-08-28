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

项目通过 **`dsh.bundle`** 机制安装：npm 包自带的 `cordis.patch.yml` 会在
`dsh plugin add` 后自动挂载 `dsh-notify` 入口，**不需要**再手动 `- insert:`。

```powershell
dsh plugin --profile web add dsh-notify-windows
```

重启 DSH 并刷新浏览器后生效：

```powershell
dsh --profile web
```

> 注意：不要再用 `- insert:` 手动添加 `dsh-notify`，否则启动会报
> `duplicate loader entry id: dsh-notify`。想调整配置，在 profile 的
> `cordis.patch.yml` 里按 id 覆盖即可（见下节）。

### 更新 / 卸载

```powershell
dsh plugin --profile web update dsh-notify-windows
dsh plugin --profile web remove dsh-notify-windows
```

更新后需重启 DSH 宿主（新增 bundle 层需要重新启动）。

## ⚙️ 配置项

插件行 `config` 全字段可选，未填按默认值。需要调整时，在
`$DSH_HOME/profiles/web/cordis.patch.yml` 里按 id 覆盖主条目即可
（该文件被运行中的 DSH 热监视，改动立即生效，无需重启）：

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

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `reasons` | `[completed, error, max-tokens]` | 需要提醒的回合结束原因（可选 `aborted` / `interrupted` / `blocked`） |
| `includeSubagents` | `false` | 是否也提醒子代理会话 |
| `notifyOnStart` | `false` | 插件加载时发一条「已激活」通知 |
| `notifyOnApproval` | `true` | 审批请求提醒（策略 `never` 时自动跳过） |
| `notifyOnAskUser` | `true` | Agent 提问等待回答时提醒 |
| `notifyOnGoalRounds` | `false` | /goal 自动推进回合不提醒（目标完成/阻塞的最终回合除外） |
| `excerpt` | `true` | 通知正文附带 Agent 最后回复的摘要 |
| `excerptMaxChars` | `80` | 摘要最大字符数 |
| `appName` | `DeepSeek Harness` | 通知来源显示名与兜底标题 |
| `aumid` | `DeepSeekHarness.Notify` | 通知 AppUserModelId |
| `log` | `true` | 写日志到 `%TEMP%\dsh-notify\notify.log` |
| `debug` | `false` | 把所有会话事件写入日志（排查用，量大） |
| `openOnClick` | `true` | 任务完成 / 审批 / 提问 toast 是否可点击（false 回退为旧的无点击 toast） |
| `preferExisting` | `true` | true 走 launcher 优先聚焦已开 DSH 窗口；false 直接用默认浏览器打开 URL |
| `webUrl` | `''` | 覆盖自动发现的基地址（如 `http://192.168.1.5:4000`），留空自动发现（默认 `http://127.0.0.1:3080`） |

## 🔔 触发场景

| 场景 | 会话事件 | 通知示例 |
| --- | --- | --- |
| 任务完成 | `turn/end` | 「任务已完成（第 N 轮）」 |
| 任务出错 / 超限 | `turn/end` | 「任务出错」/「输出达到 token 上限」 |
| 等待审批 | `approval/asked` | 「DeepSeek Harness · 需要审批 / 工具 pwsh：…」 |
| 等待回答 | `tool/call`（含 run_code 检测） | 「DeepSeek Harness · 需要回答 / 是否继续？」 |

## 🔗 点击通知跳转

任务完成 / 等待审批 / 等待回答的 toast 可点击 → 打开 DSH Web GUI。优先聚焦已打开的
DSH 浏览器标签或 Chrome Application 窗口；没有已开窗口时在默认浏览器新开标签并打开 GUI。
目标 URL 带 `?session=<id>` 参数（rc.8 前端暂不消费，为未来深链预留）。

**配置：**

- `openOnClick`（默认 `true`，`false` 则关闭可点击，回退为旧的无点击 toast）；
- `preferExisting`（默认 `true`，`true` 走 launcher 优先复用已开窗口；`false` 直接用默认浏览器打开 URL）；
- `webUrl`（可选，覆盖自动发现的基地址，如 `http://192.168.1.5:4000`，留空自动发现 / 默认 `http://127.0.0.1:3080`）。

**注意事项：** 首次点击会自动注册 `dshnotify://` 协议处理器（HKCU，无需管理员）；故障会静默降级为「默认浏览器打开」。

> 说明：DSH 0.1.0-rc.8 前端暂不支持按 URL 直达单个会话；点击后打开的是 DSH 界面（首页/会话列表）并聚焦已有窗口，目标会话需在列表中选择。未来 DSH 前端支持深链后 `?session=<id>` 将直接定位。

## 🧪 验证

```powershell
node scripts\smoke-test.mjs
```

独立进程内用 cordis Context 模拟会话事件：应弹出任务完成 / 审批 / 提问三条测试通知，并断言日志记录与过滤行为（子代理、`never` 策略、无关调用均被过滤）。

## ❓ 常见问题

- **收不到通知？** 检查 Windows「通知与操作」设置是否允许该应用显示通知，以及「专注助手」是否开启；首次发送会自动注册 AUMID。插件启动时会自检通知通道（`powershell.exe` 与 `notify.ps1` 是否可达），通道不可用会在 DSH 日志中立即告警；每次发送失败也会记录详细原因到 `%TEMP%\dsh-notify\notify.log`。
- **WSL 下收不到通知？** 插件会自动用 `wslpath -w` 把脚本路径转成 `\\wsl.localhost\...` UNC 路径，并优先通过 `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe` 调用 PowerShell（不依赖 PATH，systemd / cron 等最小环境也能工作）。若仍失败，查看 `%TEMP%\dsh-notify\notify.log` 中的 `error` 条目。
- **/goal 模式会提醒吗？** 默认不会：自动推进的中间回合保持静默，只有目标完成（或阻塞）的最终回合才提醒；如需每个回合都提醒，把 `notifyOnGoalRounds` 设为 `true`。
- **为什么审批提醒有时不弹？** 会话审批策略为 `never` 时审批会被自动拒绝、不会等待，插件会跳过提醒；策略为 `ask` 时才提醒。
- **更新插件代码后如何生效？** 执行 `dsh plugin --profile web update dsh-notify-windows` 后重启 DSH 宿主。

## 📄 许可证

[MIT](./LICENSE) © 2026 SeverusZh