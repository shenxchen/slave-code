# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Slave Code 项目记忆

## 项目概述

**Slave Code** 是 Claude Code 的民间 Fork，支持多 API 后端切换和本地模型。

- **版本**: SLAVE-v1.2.1
- **运行时**: Bun 1.3.5+ (也兼容 Node >=24)
- **语言**: TypeScript + React + Ink (终端 UI 框架)
- **主要特性**: 多 API Profile 管理、本地模型支持、Buddy 宠物系统
- **二进制名**: `slave`（全局安装后），进程标题 `slave`

## 开发命令

```bash
bun install          # 安装依赖
bun run dev          # 开发启动（等同于 bun run start）
bun run version      # 查看版本 (SLAVE-v1.2.1)
bun link             # 链接为全局命令 `slave`
bun run dev:restore-check  # 检查缺失的相对 import（src/dev-entry.ts）
```

**无编译步骤**：Bun 直接运行 TypeScript 源码，项目没有 build/bundle 流程。`tsconfig.json` 中 `strict: false`，类型检查不会阻止运行。无 lint 和 test 脚本（代码库移除了原版工具链）。
待修复问题清单见 `TODO.md`。

`src/dev-entry.ts` 是"恢复开发工作区"入口，扫描 `src/` 和 `vendor/` 中缺失的相对 import 并报告。仅当缺失 import 数为 0 时才会转发到 `main.tsx`。

## 启动流程

`src/bootstrap-entry.ts` 是唯一入口（shebang: `#!/usr/bin/env bun`）：

1. `ensureBootstrapMacro()` — 从 `package.json` 注入 `MACRO.VERSION` 等构建时宏（`src/bootstrapMacro.ts`）。`MACRO.VERSION` 是唯一版本号来源
2. 动态 `await import('./entrypoints/cli.tsx')` — 零依赖快速路径
3. `cli.tsx` 的 `main()` 按顺序检查 flag 后走不同路径：
   - `--version` / `-v` — 直接打印，不 import 任何模块
   - `--daemon-worker` — 后台 worker
   - `bridge` / `remote-control` — 远程桥接（`feature('BRIDGE_MODE')` DCE）
   - `daemon` — 后台 supervisor
   - fallthrough → `src/entrypoints/init.ts` → `src/main.tsx`（完整 CLI）

每个路径只动态 import 自己需要的模块。

## 核心架构

### API 分发层 (`src/services/api/claude.ts` — 3545 行)

**Slave Code 的关键改动**。根据 `globalConfig.customApiEndpoint` 和当前 profile 的 `compatProvider` 字段，将请求路由到：
- Anthropic 原生路径（Message API）
- OpenAI 兼容路径（chat_completions 或 responses）
- Gemini 兼容路径

路由逻辑约在 1824-1865 行。注意 `verifyApiKey()` 使用 Anthropic SDK 发送测试消息，对非 Anthropic provider 可能失败。

### API Provider 检测 (`src/utils/model/providers.ts`)

**已知局限**：`getAPIProvider()` 只返回 `'firstParty' | 'bedrock' | 'vertex' | 'foundry'`。OpenAI/Gemini 等自定义 provider 会被当作 `'firstParty'`，可能错误发送 Anthropic 特定的 beta header。

### Query 引擎 (`src/query.ts` — 1729 行)

核心 AI 交互循环。管理流式 API 请求、工具调用往返、上下文窗口管理。依赖 `QueryEngine.ts` 和 `src/context.ts`。

### 工具系统 (`src/Tool.ts` + `src/tools.ts` + `src/tools/*/`)

`Tool` 抽象类定义工具接口，`tools.ts` 注册所有可用工具（40+ 个）。关键工具：`BashTool`、`FileEditTool`、`FileReadTool`、`FileWriteTool`、`GlobTool`、`GrepTool`、`AgentTool`、`SkillTool`、`WebFetchTool`、`WebSearchTool`。

工具通过 `feature()` 和 `process.env.USER_TYPE === 'ant'` 条件加载。循环依赖的模块（`TeamCreateTool` 等）通过延迟 `require()` 加载。

### 命令系统 (`src/commands.ts` + `src/commands/*/`)

所有 `/` 命令的注册表。Slave Code 特有命令：
- `src/commands/api-profile/` — 多 Profile 管理
- `src/commands/cleanup/` — 清理 ~/.slave/ 数据

### 状态管理

两层状态：
- **`src/bootstrap/state.ts`**: 全局可变状态（session 信息、成本追踪、模型覆盖），不通过 React
- **`src/state/AppStateStore.ts`**: Ink UI 状态（100+ 字段的 monolithic state object）

`src/state/onChangeAppState.ts` 监听 `AppState` 变更，自动同步到三处存储。

### API Profile 存储 (`src/utils/customApiStorage.ts`)

多 Profile 管理核心。数据结构：`{ currentProfile, profiles: Record<string, { provider, baseURL, apiKey, model, savedModels }> }`。兼容旧版单配置格式（自动迁移）。

**已知问题**：
- `writeCustomApiStorage()` 和 `clearCustomApiStorage()` 使用硬编码字符串而非常量 `CUSTOM_API_STORAGE_KEY`
- `saveProfile()` 无防抖，每次调用直接写磁盘
- `switchProfile()` 返回 boolean，调用方需自行检查

### 认证系统 (`src/utils/auth.ts` — 2007 行)

- `isAnthropicAuthEnabled()` — 核心 guard，当用户提供自定义 API key 时返回 false，禁用所有 Anthropic OAuth 依赖功能
- `getAnthropicApiKeyWithSource()` — 依次检查 `SLAVE_API_KEY` env、profile 存储、apiKeyHelper
- OAuth 路径（`CLAUDE_CODE_OAUTH_TOKEN`、keychain 存储）只在获取到 OAuth token 时激活
- `isClaudeAISubscriber()` 等 subscriber 检查全部被 `isAnthropicAuthEnabled()` 门控

### 配置同步模式（Profile 切换时，缺一不可）

1. **环境变量** — `ANTHROPIC_BASE_URL`、`SLAVE_API_KEY`、`ANTHROPIC_MODEL`
2. **全局配置** — `globalConfig.customApiEndpoint`
3. **内存状态** — `mainLoopModelOverride`

Profile 切换在 `/api-profile use` 的命令处理器中完成，**不**通过 AppState observer。

### 配置目录 (`~/.slave/`)

为避免与原版冲突，配置目录使用 `.slave/`。内部的主要配置文件仍叫 `.claude.json`。
环境变量 `CLAUDE_CONFIG_DIR` 可覆盖此目录（尚无 `SLAVE_CONFIG_DIR`）。

### Buddy 宠物系统 (`src/buddy/` + `src/commands/buddy/`)

Slave Code 特有功能。终端底部的小水豚（capybara）伙伴，带有随机外观系统：

- `src/buddy/types.ts` — 物种(SPECIES)、眼睛(EYES)、帽子(HATS)、稀有度(RARITIES) 等定义，使用种子 PRNG (Mulberry32) 根据用户名哈希生成确定性外观
- `src/buddy/companion.ts` — 根据 `globalConfig.oauthAccount.displayName` 的 `Bun.hash()` 生成 companion 外观，支持 LEGENDARY/MYTHIC 等稀有度加权随机
- `src/buddy/sprites.ts` — ASCII 精灵动画
- `src/buddy/observer.ts` — 监听消息流，在特定时机触发 Buddy 通知
- `src/commands/buddy/buddy.tsx` — `/buddy` 命令，展示 Buddy 信息和统计数据

### Bridge 桥接 (`src/bridge/`)

由 `feature('BRIDGE_MODE')` 完全门控，外部构建中被 DCE 消除。Bridge 同时要求 `isClaudeAISubscriber()`，非 OAuth 用户无法使用。

### Shims 目录 (`shims/`)

7 个 stub 包，替代原版依赖中不可用的原生模块和 Anthropic 内部包：

| Shim | 替代内容 |
|------|---------|
| `ant-claude-for-chrome-mcp` | Anthropic 内部 Chrome MCP 集成 |
| `ant-computer-use-input` | Anthropic 内部计算机使用输入 |
| `ant-computer-use-mcp` | Anthropic 内部计算机使用 MCP |
| `ant-computer-use-swift` | Anthropic 内部 Swift 集成 |
| `color-diff-napi` | 原版 `color-diff-napi` 原生模块 |
| `modifiers-napi` | 原版 `modifiers-napi` 原生模块 |
| `url-handler-napi` | 原版 `url-handler-napi` 原生模块 |

所有 shim 版本号为 `0.0.0-restored`，导出最小空实现。新增依赖时若遇到原生模块编译失败，可能需要添加新的 shim。

### Ink 导入路径

所有组件通过 `src/ink.ts` 导入 Ink 框架（`import { Box, Text } from '../../ink.js'`）。该文件是 Ink 的 re-export 包装，添加了自定义组件和主题集成。**不要**直接从 `'ink'` 导入。

## 重要设计模式

### React Compiler 生成代码（不可手动编辑）

所有 `.tsx` 文件顶部有 `import { c as _c } from "react/compiler-runtime"`，组件内包含 `const $ = _c(N)` 和大量 `$[0]`/`$[1]` 缓存数组引用。这些是 **React Compiler (React 19) 自动生成的 memo 缓存代码**，用于提升渲染性能。

**禁止手动编辑 `_c()` 调用和 `$[N]` 缓存逻辑**。这些代码有对应的原始源码在 source map 的 `sourcesContent` 字段中。修改组件逻辑时应找到先于编译器的源码版本，否则修改会在下次编译时被覆盖。实际上这个代码库的 `.tsx` 文件已经以编译后形式提交，所以修改 `$[N]` 会直接生效——但这意味着你在编辑生成的代码而非原始源码，极易出错。

常见的识别特征：
- `_temp(s => s.field)` — 是 `useAppState(s => s.field)` 的编译后形式
- `$[0] !== x` / `$[1] = x` — 缓存比较和存储
- 块级 `let t0, t1, ...` 变量声明 — 编译后的 JSX 元素缓存

### 特性标志 / DCE

```typescript
import { feature } from 'bun:bundle';

if (feature('BRIDGE_MODE')) {
  // 外部构建中完全不存在
}
```

常见 flag：`BRIDGE_MODE`、`DAEMON`、`KAIROS`、`PROACTIVE`、`AGENT_TRIGGERS`。
`process.env.USER_TYPE === 'ant'` 也用于 DCE（170+ 处），在外部构建中被常量折叠。

### 循环依赖解决

`tools.ts` 和 `commands.ts` 使用延迟 `require()` (sync) 打破循环。动态 `import()` (async) 用于快速路径的按需加载。

## Slave Code 与 Anthropic 服务的隔离

以下功能已被禁用，防止向原版 Anthropic 服务器发送数据：

| 禁用的服务 | 文件 | 处理方式 |
|-----------|------|---------|
| Release Notes 获取 | `src/utils/releaseNotes.ts` | URL 改为 Slave 自己的仓库 |
| GrowthBook Feature Flags | `src/constants/keys.ts` | `getGrowthBookClientKey()` 返回空字符串 |
| 自动更新/版本检查 | `src/utils/autoUpdater.ts` | `assertMinVersion()`、GCS 函数等改为 no-op |
| 用户反馈提交 | `src/components/Feedback.tsx` | `submitFeedback()` 始终返回 `{success:false}`（注意：UI 会显示"请稍后重试"并可无限重试，参见 TODO.md） |
| 会话转录分享 | `src/components/FeedbackSurvey/submitTranscriptShare.ts` | 同上 |
| Bootstrap API | `src/services/api/bootstrap.ts` | `fetchBootstrapAPI()` 直接返回 null |
| Guest Passes | `src/services/api/referral.ts` | `prefetchPassesEligibility()` 改为 no-op |
| 远程 Agent 调度 | `src/skills/bundled/scheduleRemoteAgents.ts` | `isEnabled: () => false` |
| WebFetch 域名检查 | `src/tools/WebFetchTool/utils.ts` | 本地处理，所有域名直接允许 |
| Desktop 会话转移 | `src/commands/desktop/`、`src/components/DesktopHandoff.tsx`、`src/utils/desktopDeepLink.ts` | v1.2.0 遗漏，仍指向 `claude.ai` 和 `claude-dev://`（参见 TODO.md #24） |

保留的 Anthropic 服务：`claude-plugins-official` 插件市场（兼容 Slave）、MCP registry。

### 临时目录命名

所有运行时临时目录使用 `slave-*` 前缀（非 `claude-*`），定义在：
- `src/utils/permissions/filesystem.ts` — `getClaudeTempDirName()` 返回 `'slave'` / `'slave-{uid}'`
- `src/utils/shell/bashProvider.ts`、`powershellProvider.ts`、`src/commands/copy/copy.tsx` 等

XDG 路径（`~/.local/share/slave/`、`~/.cache/slave/`、`~/.local/state/slave/`）在 `src/utils/nativeInstaller/installer.ts` 中定义。
