# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/)。

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
