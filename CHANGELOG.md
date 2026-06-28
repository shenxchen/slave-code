# Changelog

All notable changes to Slave Code will be documented in this file.

## 1.2.1

- 修复 `saveGlobalConfig` 中 `removeProjectHistory` 使用旧 `projects` 覆盖 updater 结果导致清理无效的 bug
- 修复 `--config-orphans` 无法真正删除 `.claude.json` 中孤儿条目的 bug
- 修复 `/cleanup --project` 完成后 `ReferenceError: projectNames is not defined` 报错
- 修复 `--memory-only` / `--transcripts-only` 不指定 project 目标时静默无输出的问题，新增提示
- `--memory-only` / `--transcripts-only` 不再错误删除 `.claude.json` 中的 project 和 githubRepoPaths 条目
- 移除 `--yes` flag，简化 cleanup 命令流程
- `--config-orphans` 孤儿判断改为检查项目数据目录是否存在（而非原工作目录），避免有磁盘路径但无 Slave 项目数据的条目被误判为活跃

## 1.2.0

- 阻断向 Anthropic 服务器的不必要数据发送：Release Notes 改为 Slave 仓库、GrowthBook 禁用、自动更新/版本强制检查禁用、用户反馈和会话转录分享禁用、Bootstrap API 禁用、Guest Passes 禁用、WebFetch 域名检查本地化
- 修复与原始 Claude Code 的文件系统冲突：所有临时目录改为 `slave-*` 前缀、XDG 路径改为 `~/.local/share/slave/` 等、进程标题改为 `slave`、二进制名改为 `slave`
- 修复 CLI 命令名引用：resume 提示、graceful shutdown、跨项目恢复、Bridge 消息中的 `claude` → `slave`
- 禁用不适用 Slave 的 Tip 提示（desktop/web/mobile app、guest passes、overage credit、GitHub/Slack app 安装）
- 禁用 `scheduleRemoteAgents` skill（依赖 claude.ai 云基础设施，Slave 不可用）
- GitHub Actions 工作流模板更新为 Slave Code 品牌（触发词 `@slave`）
- `package.json` 的 `repository` 和 `description` 更新为 Slave Code 信息
- 修复 PID 锁进程检测同时匹配 `slave` 和 `claude`
- 清理被禁用代码中的死代码（未使用的 import、常量、schema 定义）
- 新增 `TODO.md` 待修复问题清单（收录 25 个已知问题及修复建议）

## 1.1.3

- 新增 `/cleanup` 命令，支持选择性清理 `~/.slave/` 下的历史数据与缓存
- 保留 API 配置、模型设置、skills、插件等核心配置
- `--config-orphans` 可检测并清理指向已不存在目录的配置条目
- 清理项目数据时自动同步删除 `.claude.json` 中对应的 `projects` 和 `githubRepoPaths` 配置条目
- `history.jsonl` 新增自动裁剪机制，磁盘上限 1000 条，防止无限膨胀

## 1.1.2

- 支持模型思考强度设置为 max

## 1.1.1

- 完成所有层级中 `.slave/` 配置目录的实现

## 1.1.0

- 修复 `/model` 命令选择模型后未持久化：模型变更现在通过 `onChangeAppState` 钩子自动完成三处持久化
- 修复 `/api-profile use` 切换 Profile 后模型不同步：切换时完整同步 `mainLoopModelOverride` 和 `globalConfig.customApiEndpoint`
- 修复模型选择器不读取当前 Profile 的模型列表：`ModelPicker` 现在优先从当前 Profile 读取并合并 `savedModels`
- 修复 `/remove-model` 删除当前模型后内存不同步：现在同步更新 `mainLoopModelOverride`

## 1.0.0

- 初始发布，基于 Claude Code 源码重构
- 多 API Profile 管理系统（`/api-profile` 命令组）
- 支持 Anthropic、OpenAI 兼容、Gemini 三种 API Provider
- 本地模型支持（Ollama、vLLM、LM Studio）
- Buddy 宠物系统（终端动画伴侣）
- 配置文件目录改为 `~/.slave/`，与原版 `.claude/` 隔离
