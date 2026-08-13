# dsh-notify

DeepSeek Harness（DSH）插件：当 Agent 任务完成时，向 Windows 发送系统桌面通知。

Agent 每完成一轮回复（turn/end 事件），插件就会弹出一条 Windows Toast 通知，
让你无需盯着网页界面也能知道任务已经结束、出错或被截断。

## 功能

- 监听会话事件流中的 turn/end 事件，任务结束立即弹窗提醒；
- 支持按结束原因过滤：completed（完成）、error（出错）、max-tokens（输出超限）、aborted（取消）、interrupted（中断）、blocked（未开始）；
- 默认忽略子代理（subagent）会话，只提醒主会话，避免通知轰炸；
- 通知标题自动使用会话标题（session/title），正文显示原因与轮次；
- 零运行时依赖：通知通过 Windows PowerShell 5.1 的 WinRT Toast API 发送，并自动注册通知用的 AppUserModelId；
- 可选的日志文件（%TEMP%\dsh-notify\notify.log）便于排查。

## 工作原理

turn/end (session/event) -> lib/index.js -> spawn powershell.exe -> lib/notify.ps1 -> WinRT Toast

1. 插件在根上下文监听 session/event；
2. 收到 turn/end 且 reason.kind 在配置的 reasons 列表中时触发；
3. 生成标题（会话标题，没有则用 appName）与正文；
4. 启动 powershell.exe 执行 lib/notify.ps1：先按需在 HKCU\SOFTWARE\Classes\AppUserModelId 下注册 AUMID（无需管理员权限），再发送 Toast。

## 安装

把本包放进 DSH profile 可解析的位置，然后在 profile 的 cordis.patch.yml 里追加条目。

### 方式一：自动安装脚本（Windows）

pwsh scripts\install-profile.ps1 -Profile web

脚本会把插件复制到 profile 的 hoisted node_modules，并幂等地把以下条目写入
$HOME\.dsh\profiles\web\cordis.patch.yml（该文件被运行中的 DSH 热监视，改动立即生效，无需重启）：

- insert:
    - id: dsh-notify
      name: 'dsh-notify'
      config:
        enabled: true
        reasons: [completed, error, max-tokens]
        includeSubagents: false
        notifyOnStart: true
        appName: 'DeepSeek Harness'
        aumid: 'DeepSeekHarness.Notify'
        log: true

### 方式二：dsh plugin 命令

dsh plugin --profile web add 本仓库路径

再手动把上面的 insert 条目加入 cordis.patch.yml。

## 配置项

enabled       true   总开关
reasons       [completed, error, max-tokens]   需要提醒的结束原因
includeSubagents  false  是否也提醒子代理会话
notifyOnStart false  插件加载时发一条「已激活」通知
appName       DeepSeek Harness  通知来源显示名与兜底标题
aumid         DeepSeekHarness.Notify  通知 AppUserModelId
log           true   写日志到 %TEMP%\dsh-notify\notify.log

## 验证

node scripts\smoke-test.mjs

独立进程内用 cordis Context 模拟会话事件，通过后会弹出两条测试通知，并断言日志记录。

## 限制与说明

- 仅支持 Windows（依赖 Windows PowerShell 5.1，Windows 10/11 自带）；
- 通知是否弹出受系统「专注助手 / 通知中心」设置影响；
- Toast 显示为 appName 名称；首次发送会自动注册 AUMID（HKCU，无需管理员）；
- 修改插件代码后需重新执行安装脚本；修改 cordis.patch.yml 配置会被热重载。
