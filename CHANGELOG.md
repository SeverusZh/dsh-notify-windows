# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/)。

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
