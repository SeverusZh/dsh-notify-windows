# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/)。

## [0.7.4] - 2026-09-04

### 兼容：DSH 0.1.2-alpha.4

- **peerDependencies**：`@deepseek-ai/cordis` `^4.0.1` → `^4.0.2`（alpha.4
  各包一致声明的版本）。
- **真实-Cordis 探针**：新增 `test/probe.test.mjs`（devDependency
  `@deepseek-ai/cordis ^4.0.2`，`--legacy-peer-deps` 安装），在真实 Context 上
  挂载插件，按 harness-src @ 0.1.2-alpha.4 核实的会话事件字形合成 session
  stub 并经 `session/event` 火线派发，断言 JSONL 日志（
  `<tmpdir>/dsh-notify/notify.log`）的 notify / approval / ask-user 行与
  过滤行为：
  - turn/end completed → notify（标题/轮次/截断摘要）；原因不在 `reasons`
    内不通知；
  - 子代理过滤：`delegationDepth ≥ 1` / `header.origin === 'subagent'`
    过滤，恢复主会话（深度 0）通知；`includeSubagents: true` 放行；
  - approval/asked：`approval/policy` 为 `ask` 时通知、`never` 时抑制；
  - goal 轮静默：`user/message` source.kind `goal` + round > 0 时仅终态
    （`goal/change` operation `complete`）通知，非终态（`edit`）抑制；
  - ask_user_question 直接调用与 run_code 内嵌调用均提取问题文本。
- **脚本**：`npm test` = `node --test "test/*.test.mjs"`（显式限定 `test/`
  目录，避免 `node --test` 默认 glob 误拾取面向 Windows 宿主手工运行的
  `scripts/smoke-test.mjs`）。
- **事件字形核对结论**：`0.1.0-rc.8` → `0.1.2-alpha.4` 中插件消费的所有
  会话事件字段（turn/end reason kinds、user/message source、goal/change
  operation、approval/asked、approval/policy、tool/call、session.header）
  无变化；`ctx.sessionTitle.get(session).title` 与 `ctx.webServer.port`
  亦保留——lib/index.js 无需改码，探针作为兼容契约锚点锁定。

## [0.7.3] - 2026-08-28

### 修复：重启后主会话被误判为子代理，通知全部失效

- **根因**：DSH 持久化会话记录时写入 `delegationDepth ?? 0`，重启恢复后主会话的
  header 也带 `delegationDepth: 0`；旧过滤逻辑 `delegationDepth !== undefined`
  把「带该字段」当作子代理，导致每次 `dsh web` 重启后所有主会话的通知被静默过滤。
- **修复**：子代理判定改为 `(delegationDepth ?? 0) > 0`（主会话为 0，子代理 ≥ 1），
  重启后通知恢复正常。
- 冒烟测试新增回归用例：`delegationDepth: 0` 的恢复主会话必须弹通知，深度 ≥ 1 仍过滤。

## [0.7.2] - 2026-08-28

### 修复：WSL 下通知失败被静默吞掉 + 通知通道自检

- **静默失败检测**：PowerShell 5.1 在 `-File` 无法加载脚本时仍以退出码 0 退出（例如路径
  未转换成功时），旧版只检查退出码，失败完全无痕。现在捕获 stdout/stderr，以
  notify.ps1 输出的 `toast shown` 作为成功标记，失败时记录详细输出并告警。
- **powershell.exe 解析不再只依赖 PATH**：WSL 下若 DSH 由 systemd / cron / ssh 等
  最小 PATH 环境启动，`spawn("powershell.exe")` 会 ENOENT 失败。现在优先使用
  `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`（WSL 标准位置），
  原生 Windows 回退到 PATH 查找，行为不变。
- **启动自检**：插件启动时校验 notify.ps1 与 powershell.exe 是否可达，通道不可用时
  立即告警，不再等任务结束才发现通知发不出去。
- `wslpath` 转换结果缓存（NOTIFY_SCRIPT 恒定，不再每次 toast 同步转换）。

## [0.7.1] - 2026-08-27

### 修复：支持 DSH 部署在 WSL 中时发送通知

- 之前通知通道唯一依赖 `powershell.exe -File <notify.ps1>`，而 DSH 跑在 WSL 里时该脚本路径为
  Linux 形式（如 `/home/.../notify.ps1`），Windows 侧 PowerShell 无法识别，导致通知静默失败。
- **修复**：新增 `winPath()`，在 WSL 下用 `wslpath -w` 将脚本路径转为 Windows 可读的
  `\\wsl.localhost\...` UNC 路径后传给 `-File`。
- **原生 Windows 不受影响**：`wslpath` 在原生 Windows 上不存在，`winPath()` 会原样返回
  原始路径，行为与旧版完全一致。

## [0.7.0] - 2026-08-20

### 新增「点击通知跳转」功能

- 任务完成 / 审批 / 提问的 toast 变为**可点击**：点击后打开 DSH Web GUI。优先聚焦已打开的
  DSH 浏览器标签或 Chrome Application 窗口；无已开窗口则在默认浏览器新开标签。
  目标 URL 携带 `?session=<id>`（rc.8 前端暂不消费，为未来深链预留）。
- **实现**：
  - `lib/notify.ps1` 使用 `activationType="protocol"` + `launch`（协议 `dshnotify://` 或原始
    URL），使 toast 点击可触发跳转；
  - `lib/launcher.ps1` 处理聚焦 / 跳转：CDP 尽力 → Win32 聚焦 → `Start-Process` 兜底；
  - `lib/index.js` 新增配置 `openOnClick` / `preferExisting` / `webUrl`，并自动发现 web
    基地址（`ctx.webServer.port`，默认 `http://127.0.0.1:3080`）。
- **配置表补三行**：`openOnClick`(bool, true)、`preferExisting`(bool, true)、
  `webUrl`(string, '' 自动发现)。

### 已知限制

- DSH 0.1.0-rc.8 前端暂无会话深链：点击后打开 GUI 首页 / 会话列表并聚焦已有窗口；真正的
  「一键直达某会话」需前端侧支持。

## [0.6.0] - 2026-08-20

### 变更（dsh.bundle 安装 + 对齐 dsh 0.1.0-rc.8）

- **改为 `dsh.bundle` 安装**：新增 `cordis.patch.yml`（包内自带 `insert:` 条目）并在
  package.json 声明 `dsh.bundle.patch`。安装方式从「手动打 insert + 复制到
  node_modules」改为 `dsh plugin --profile <name> add dsh-notify-windows`，
  pnpm 安装后 `dsh` 自动把包加入 `dsh.profile.bundles` 层栈并挂载入口。
- **删除 manual-insert 部署**：移除 `scripts/install-profile.ps1`（旧的复制 lib 到
  version-suffixed node_modules 目录并正则改写 profile `cordis.patch.yml` 的做法）。
- **rc.8 兼容**：
  - 子代理过滤改用 rc.8 的 `session.header.delegationDepth`（旧字段 `depth` 已移除）；
  - 导出风格改为 rc.8 推荐的 `export const name` + `export const apply`（旧 default
    export 会让 loader 丢弃 `name` 命名导出，fiber 名显示为 `dshNotify`）。
- **配置文件覆盖方式**：不再需要手动 `- insert:`；在 profile 的 `cordis.patch.yml`
  中按 id（`dsh-notify`）覆盖 `config` 即可，与 `dsh-yolo-mode` 等 bundle 插件一致。

### 其它

- 冒烟测试 `scripts/smoke-test.mjs` 路径自发现（`DSH_HARNESS_DIR` 可覆盖），
  适配新的 `apply` 导出与 `delegationDepth` 字段。
- README 更新：安装 / 更新 / 卸载命令与配置覆盖示例。

## [0.5.0] - 2026-08-13

### 新增

- /goal 自动推进回合默认静默提醒，仅目标完成 / 阻塞的最终回合弹通知（可配置）。
- 任务完成通知自动附带 Agent 最后回复的摘要（可裁剪，`excerptMaxChars`）。

## [0.4.0] - 2026-08-13

### 新增

- 增加审批（`approval/asked`）与提问（`ask_user_question` / `run_code` 内联调用）
  提醒。
- Windows 桌面 Toast 通知，通过 PowerShell 5.1 WinRT API 发送，零运行时依赖。
