# dsh-notify-windows 消融实验

基线：d082794a (0.7.4-beta.0)，测试 7/7 通过（test/probe.test.mjs，真实 Cordis 探针）。

## 模块清单（lib/index.js 单文件）

| ID | 模块 | 配置键（默认） | 消融类型 |
|---|---|---|---|
| M1 | turn/end 通知（completed/error/max-tokens） | reasons (["completed","error","max-tokens"]) | config + code |
| M2 | approval/asked 审批通知 | notifyOnApproval (true) | config + code |
| M3 | tool/call ask_user 提问通知 | notifyOnAskUser (true) | config + code |
| M4 | 回复摘录 excerpt | excerpt (true) | config + code |
| M5 | 点击打开 Web GUI（openOnClick） | openOnClick (true) | config + code |
| M6 | goal 轮静默 | notifyOnGoalRounds (false) | config |
| M7 | 子代理会话过滤 | includeSubagents (false) | config |
| M8 | 启动激活通知 | notifyOnStart (false) | config |
| M9 | JSONL 日志 | log (true) | config |
| M10 | 通知通道（notify.ps1/powershell） | —（基础设施） | 不消融（消融=插件无意义） |

## 消融方式

- **config 变体**：`variants/<id>-config.mjs` 导出 config 对象，探针用该 config 挂载插件。
- **code 变体**：`variants/<id>.patch` 移除对应事件分支/逻辑，探针用默认 config 挂载。

## 验证

- 探针 `ablation/probe.mjs`：真实 Cordis 挂载 + 合成会话事件，断言：
  - loadOk：apply 不抛错；
  - ablationEffective：被消融模块不产生对应日志行（负向）；
  - corePass：保留模块仍产生日志行（正向）。
- 每个变体跑 `node ablation/probe.mjs <variant>`，结果写入 results.json。
