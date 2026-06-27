# Changelog

All notable changes to Slave Code will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [SLAVE-v1.2.0] — 2026-06-27

### Changed
- **隔离 Anthropic 服务依赖**：阻断向原版服务器的不必要数据发送
  - Release Notes 获取指向 Slave 自建仓库
  - GrowthBook Feature Flags 禁用（所有 feature gate 回退默认值）
  - 自动更新/版本强制检查（`assertMinVersion`、`getMaxVersion`、GCS 版本检查）改为 no-op
  - 用户反馈提交（`submitFeedback`）和会话转录分享（`submitTranscriptShare`）禁用
  - Bootstrap API（`fetchBootstrapAPI`）禁用
  - Guest Passes / 推荐系统（`prefetchPassesEligibility`）禁用
  - WebFetch 域名 blocklist 检查本地化（所有域名直接允许，SSRF 依赖 `ssrfGuard.ts`）
- **文件系统隔离**：修复与原始 Claude Code 的运行时冲突
  - 所有临时目录前缀改为 `slave-*`（5 处 `tmpdir()` 路径 + sandbox 路径）
  - XDG 路径改为 `~/.local/share/slave/`、`~/.cache/slave/`、`~/.local/state/slave/`
  - 进程标题改为 `slave`
  - 原生安装二进制名改为 `slave` / `slave.exe`
- CLI 命令名引用更新：resume 提示、graceful shutdown、跨项目恢复、Bridge 消息中的 `claude` → `slave`
- Tip 系统中禁用不适用 Slave 的提示（desktop/web/mobile app、guest passes、overage credit、GitHub/Slack app）
- GitHub Actions 工作流模板更新为 Slave Code 品牌（触发词 `@slave`）
- `package.json` 的 `repository` 和 `description` 更新为 Slave Code 信息

### Fixed
- 修复 PID 锁进程检测同时匹配 `slave` 和 `claude`

### Removed
- 禁用 `scheduleRemoteAgents` skill（依赖 claude.ai 云基础设施，Slave 不可用）
- 清理被禁用代码中的死代码（未使用的 import、常量、schema 定义，共 ~110 行）
- NPM 弃用通知（已为 no-op，本次彻底确认）

### Added
- 新增 `TODO.md` 待修复问题清单（收录 25 个已知问题及修复建议）

## [SLAVE-v1.1.3] — 2026-06-27

### Added
- 新增 `/cleanup` 命令，支持选择性清理 `~/.slave/` 下的历史数据与缓存
  - 支持清理对话记录、项目记忆、任务缓存、Shell 快照、会话状态、文件检查点、计划文件、调试日志、会话环境变量等
  - 保留 API 配置、模型设置、skills、插件等核心配置
  - `--config-orphans` 可检测并清理指向已不存在目录的配置条目
  - 清理项目数据时自动同步删除 `.claude.json` 中对应的 `projects` 和 `githubRepoPaths` 配置条目
- `history.jsonl` 新增自动裁剪机制，磁盘上限 1000 条，防止无限膨胀

## [SLAVE-v1.1.2]

### Changed
- 支持模型思考强度设置为 max
- 优化若干小问题

## [SLAVE-v1.1.1]

### Changed
- 完成所有层级中 `.slave/` 配置目录的实现

## [SLAVE-v1.1.0]

### Fixed
- **`/model` 命令选择模型后未持久化**：模型变更现在通过 `onChangeAppState` 钩子自动完成三处持久化（环境变量 → `globalConfig` → `customApiStorage`）
- **`/api-profile use` 切换 Profile 后模型不同步**：切换时完整同步 `mainLoopModelOverride` 和 `globalConfig.customApiEndpoint`
- **模型选择器不读取当前 Profile 的模型列表**：`ModelPicker` 现在优先从当前 Profile 读取并合并 `savedModels`
- **`/remove-model` 删除当前模型后内存不同步**：现在同步更新 `mainLoopModelOverride`

## [SLAVE-v1.0.0] — 2026-04-11

### Added
- 初始发布，基于 Claude Code 源码重构
- 多 API Profile 管理系统（`/api-profile` 命令组）
- 支持 Anthropic、OpenAI 兼容、Gemini 三种 API Provider
- 本地模型支持（Ollama、vLLM、LM Studio）
- Buddy 宠物系统（终端小水豚动画伴侣）
- 配置文件目录改为 `~/.slave/`，与原版 `.claude/` 隔离
