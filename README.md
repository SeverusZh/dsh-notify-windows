# dsh-notify

DeepSeek Harness（DSH）插件：Agent 需要你关注时，向 Windows 发送系统桌面通知。

触发时机（三类，均可在配置中开关）：

1. 任务完成（turn/end）：Agent 每完成一轮回复，或任务出错/输出超限时弹窗提醒；
2. 权限审批（approval/asked）：有操作在等待你的审批时立即提醒（会话审批策略为
   never 时自动跳过，因为那时没有东西在等你）；
3. 提问确认（ask_user_question）：Agent 向你提问、等待回答时提醒——包括通过
   run_code 内部调用 ask_user_question 的情形（本部署下所有工具都经 run_code
   调用，插件会扫描 run_code 程序源码里的 tools.ask_user_question 调用）。

让你无需盯着网页界面也能知道任务结束、需要审批或等待你回答。

## 功能

- 监听会话事件流：turn/end、approval/asked、tool/call（含 run_code 源码启发式检测）；
- turn/end 支持按结束原因过滤：completed、error、max-tokens、aborted、interrupted、blocked；
- 审批提醒按会话生效策略折叠：策略为 never 时不提醒；
- 默认忽略子代理（subagent）会话，只提醒主会话，避免通知轰炸；
- 通知标题自动使用会话标题（session/title），正文显示原因与轮次；
- 零运行时依赖：通知通过 Windows PowerShell 5.1 的 WinRT Toast API 发送，并自动注册通知用的 AppUserModelId；
- 可选的日志文件（%TEMP%\dsh-notify\notify.log）与 debug 事件日志便于排查。

## 工作原理

turn/end、approval/asked、tool/call (session/event) -> lib/index.js -> spawn powershell.exe -> lib/notify.ps1 -> WinRT Toast

1. 插件在根上下文监听 session/event；
2. 匹配到关注的结束原因/审批请求/提问调用后生成标题与正文；
3. 启动 powershell.exe 执行 lib/notify.ps1：先按需在 HKCU\SOFTWARE\Classes\AppUserModelId 下注册 AUMID（无需管理员权限），再发送 Toast。

## 安装

把本包放进 DSH profile 可解析的位置，然后在 profile 的 cordis.patch.yml 里追加条目。

### 方式一：自动安装脚本（Windows）

pwsh scripts\install-profile.ps1 -Profile web

脚本会把插件复制到 profile 的 hoisted node_modules（目录名为 dsh-notify-版本号，
重新部署时目录名变化可使运行中的宿主热加载新代码而无需重启），并幂等地写入/更新
$HOME\.dsh\profiles\web\cordis.patch.yml（该文件被运行中的 DSH 热监视）：

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

### 方式二：dsh plugin 命令

dsh plugin --profile web add 本仓库路径

再手动把上面的 insert 条目加入 cordis.patch.yml（注意：修改插件代码后若想被运行中的宿主立即加载，请用安装脚本，它会更换部署目录名以绕过模块缓存）。

## 配置项

enabled            true    总开关
reasons            [completed, error, max-tokens]    需要提醒的回合结束原因
includeSubagents   false   是否也提醒子代理会话
notifyOnStart      false   插件加载时发一条「已激活」通知
notifyOnApproval   true    审批请求提醒（策略 never 时自动跳过）
notifyOnAskUser    true    Agent 提问等待回答时提醒
appName            DeepSeek Harness    通知来源显示名与兜底标题
aumid              DeepSeekHarness.Notify    通知 AppUserModelId
log                true    写日志到 %TEMP%\dsh-notify\notify.log
debug              false   把所有收到的会话事件写入日志（排查用，量大会产生大量磁盘写入）

## 验证

node scripts\smoke-test.mjs

独立进程内用 cordis Context 模拟会话事件，通过后会弹出多条测试通知（任务完成、
审批、提问），并断言日志记录与过滤行为。

## 限制与说明

- 仅支持 Windows（依赖 Windows PowerShell 5.1，Windows 10/11 自带）；
- 通知是否弹出受系统「专注助手 / 通知中心」设置影响；
- Toast 显示为 appName 名称；首次发送会自动注册 AUMID（HKCU，无需管理员）；
- 审批提醒只在会话审批策略为 ask（默认）时有意义；策略为 never 的会话不提醒；
- 提问检测依赖 run_code 程序源码中出现 tools.ask_user_question( 调用，属启发式，可能漏检或误报。
