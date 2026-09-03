# dsh-notify-windows 消融实验报告

基线：d082794a (0.7.4-beta.0) · 原测试套件 7/7 通过 · 消融探针 14/14 通过

## 结果总览

| 变体 | 类型 | 消融目标 | 结果 | 关键观察 |
|---|---|---|---|---|
| M1-config | config | turn/end 通知（reasons=[]） | ✅ | 全部 reason 不通知；审批/提问保留 |
| M2-config | config | 审批通知（notifyOnApproval=false） | ✅ | 审批不通知；完成/提问保留 |
| M3-config | config | 提问通知（notifyOnAskUser=false） | ✅ | 提问不通知；完成/审批保留 |
| M4-config | config | 回复摘录（excerpt=false） | ✅ | notify 行无摘录；通知本身保留 |
| M5-config | config | 点击打开（openOnClick=false） | ✅ | notify 行无 url；通知保留 |
| M6-config | config | goal 轮静默（notifyOnGoalRounds=true） | ✅ | 非终态 goal 轮也通知（静默被消融） |
| M7-config | config | 子代理过滤（includeSubagents=true） | ✅ | 子代理会话也通知（过滤被消融） |
| M8-config | config | 激活 toast（notifyOnStart=false） | ✅ | 无激活 toast（默认态无副作用） |
| M9-config | config | JSONL 日志（log=false） | ✅ | 无任何日志行；通知通道不受影响 |
| M1-code | code | 移除 turn/end 分支 | ✅ | 完成不通知；审批/提问保留 |
| M2-code | code | 移除 approval/asked 分支 | ✅ | 审批不通知；完成/提问保留 |
| M3-code | code | 移除 tool/call 分支 | ✅ | 提问不通知；完成/审批保留 |
| M4-code | code | 移除 excerpt 逻辑 | ✅ | notify 行无摘录 |
| M5-code | code | 移除 openOnClick 逻辑 | ✅ | notify/approval/ask-user 行均无 url |

## 原测试套件在 code 消融下的反应（M1-code 示例）

- 失败 4/7：依赖 turn/end 通知的用例（completed 通知、子代理过滤×2、goal 静默）→ **消融生效**
- 通过 3/7：不依赖 turn/end 的用例（reasons 过滤、审批、提问）→ **核心保留**

## 结论

1. **模块独立性高**：9 个功能模块全部可独立消融（config 或 code），互不级联破坏。
2. **配置隔离性完整**：所有功能都有配置开关，软消融与硬消融结果一致。
3. **依赖关系**：M1（turn/end）是 M6（goal 静默）/M7（子代理过滤）的宿主——后两者只作用于 turn/end 路径；M4（excerpt）/M5（openOnClick）是 M1 的增强，消融后通知仍可用。
4. **基础设施**：M10（notify.ps1/powershell 通道）不可消融——消融即插件失去意义；通道缺失时插件启动告警但不崩溃（fail-soft）。
