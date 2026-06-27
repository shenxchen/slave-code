# Slave Code 待修复问题清单

本文档整理了代码审查中发现的所有未修复问题。按风险程度分为三个等级：
- **高风险**：可能导致进程崩溃、数据丢失或安全漏洞
- **中风险**：影响功能正确性、用户体验或代码可维护性
- **低风险**：技术债务、代码质量问题，暂不影响正常运行

---

## 高风险 (High)

### 1. apiKeyHelper 任意 Shell 执行风险

- **文件**: `src/utils/auth.ts:563-567`
- **来源**: 原版 Claude Code 的设计。`apiKeyHelper` 设置项（来自 `settings.json`）作为 shell 命令执行：
  ```typescript
  const result = await execa(apiKeyHelper, {
      shell: true,
      timeout: 10 * 60 * 1000,
      reject: false,
  })
  ```
- **后果**: 如果恶意项目的 `.slave/settings.local.json` 中注入了构造的 `apiKeyHelper` 命令，会在用户运行 Slave Code 时执行任意 Shell 代码。代码中已有信任检查（line 552），但仅适用于项目级或本地设置——存在绕过风险。
- **风险程度**: 高（远程代码执行）
- **建议行动**:
  1. 审查 `apiKeyHelper` 执行前的 trust dialog 检查路径，确保无绕过
  2. 考虑移除 `shell: true`，改用直接执行可执行文件
  3. 在运行 `apiKeyHelper` 前打印警告信息，让用户知晓有命令将被执行

### 2. process.exit() 导致缓冲异步事件丢失

- **文件**: `src/bridge/bridgeMain.ts`
- **具体位置**: 1991, 2032, 2075, 2092, 2107, 2137, 2160, 2192, 2337, 2372, 2398, 2410, 2466, 2542, 2767 行
- **来源**: 原版代码，代码自身在 line 2062-2065 承认了问题：
  ```
  "logEventAsync only enqueues — process.exit() discards buffered events."
  ```
- **后果**: 14 处 `process.exit()` 调用点缺少异步事件 flush（analytics 事件、DataDog 日志丢失）。虽然 analytics 在 Slave 中已被禁用，但 Bridge 模式下的 session 状态同步和调试日志也可能丢失。
- **风险程度**: 高（数据丢失）
- **建议行动**:
  1. 为所有 `process.exit()` 调用添加 `await flushPendingEvents()` 或等效逻辑
  2. 考虑使用统一的安全退出函数（如 `gracefulShutdown()`），集中处理异步 flush
  3. 注意：Bridge 代码由 `feature('BRIDGE_MODE')` 门控，外部构建中已被 DCE 消除。若未来启用 Bridge 模式，此问题将变得关键

### 3. 多进程 Token 刷新竞争条件

- **文件**: `src/services/mcp/auth.ts:1741-1749`
- **来源**: 原版代码，代码自带 TODO：
  ```
  "TODO(xaa-ga): add cross-process lockfile before GA. _refreshInProgress
  only dedupes within one process — two CC instances with expiring tokens
  both fire the full 4-request XAA chain and race on storage.update()."
  ```
- **后果**: 同一用户运行多个 Slave Code 实例时，两个进程可能同时触发 OAuth token 刷新，导致：
  - 浪费 4 个往返请求
  - keychain/storage 写入竞争
  - 可能获得过期/无效 token
- **风险程度**: 高（Token 刷新失败 → API 请求全部 401 失败）
- **建议行动**:
  1. 添加基于文件系统的跨进程锁（使用 `proper-lockfile` 或类似方案）
  2. 确保锁在进程崩溃时有超时释放机制
  3. 注意：此问题仅在 OAuth 认证用户（非 API key 用户）场景下触发

### 4. 单个损坏 JSON 行导致进程崩溃

- **文件**: `src/cli/structuredIO.ts:459-462`
- **来源**: 原版代码
- **后果**: NDJSON 流输入中任何格式错误的行都会导致 `process.exit(1)`。一个损坏的 JSON 行可以让整个 SDK session 终止。该行被记录但导致崩溃的具体内容无法恢复。
- **风险程度**: 高（进程崩溃）
- **建议行动**:
  1. 将 `process.exit(1)` 改为抛出一个可恢复的错误
  2. 为损坏的行添加更详细的错误日志（记录原始内容用于调试）
  3. 考虑添加"跳过损坏行继续处理"的容错逻辑

---

## 中风险 (Medium)

### 5. 空 catch 吞噬关键路径错误

- **文件**: `src/bootstrap/state.ts:270-274`
- **来源**: 原版代码
- **代码**: `realpathSync(rawCwd)` 被 `try/catch {}` (完全空 catch) 包裹。注释说处理 `"File Provider EPERM on CloudStorage mounts"`。
- **后果**: 不仅吞掉了 EPERM，还吞掉了 EMFILE (too many open files)、ENOMEM、ENAMETOOLONG、EACCES、EIO 等所有其他错误。这些错误会静默回退到未解析的 CWD 路径，可能连锁引发下游路径相关的 bug。
- **风险程度**: 中
- **建议行动**:
  1. 在 catch 中区分 EPERM（已知场景，安全回退）和其他错误类型
  2. 对非 EPERM 错误至少记录日志
  3. 考虑是否应该对关键错误（ENOMEM、EMFILE）向上传播而非静默吞掉

### 6. customApiStorage 中不一致的 Key 使用

- **文件**: `src/utils/customApiStorage.ts`
- **具体位置**:
  - `readCustomApiStorage()` (line ~30): 使用常量 `CUSTOM_API_STORAGE_KEY` (`'customApiEndpoint'`)
  - `writeCustomApiStorage()` (line 98): 使用硬编码字符串 `'customApiEndpoint'` 而非常量
  - `clearCustomApiStorage()` (line 173): 同样使用硬编码字符串
- **来源**: Slave Code 特有的新增代码
- **后果**: 如果未来有人修改 `CUSTOM_API_STORAGE_KEY` 常量的值，`writeCustomApiStorage()` 和 `clearCustomApiStorage()` 会静默失效——它们会写入/删除不同的 key，导致读写不一致的 bug。
- **风险程度**: 中（数据不一致的潜伏 bug）
- **建议行动**:
  1. 将所有硬编码 `'customApiEndpoint'` 替换为常量 `CUSTOM_API_STORAGE_KEY`

### 7. verifyApiKey() 仅支持 Anthropic Provider

- **文件**: `src/services/api/claude.ts:532-585`
- **来源**: 原版代码，未针对多 provider 做适配
- **后果**: 当用户使用 OpenAI 或 Gemini provider 时，`/login` 流程中的 API key 验证步骤会失败，因为该函数使用 Anthropic SDK 发送 Messages API 格式的测试请求。OpenAI/Gemini 兼容端点不接受此格式。
- **风险程度**: 中（非 Anthropic 用户的 `/login` 体验受损）
- **建议行动**:
  1. 根据 `compatProvider` 字段，为 OpenAI/Gemini 添加对应的验证逻辑
  2. OpenAI 路径：发送 Chat Completions API 的轻量测试请求
  3. Gemini 路径：发送 Gemini API 的轻量测试请求
  4. 保留当前 Anthropic 路径作为默认

### 8. Anthropic API 预连接总是执行

- **文件**: `src/entrypoints/init.ts:153-159`
- **来源**: 原版代码，无多 provider 感知
- **后果**: 即使用户使用 OpenAI/Gemini profile，启动时仍会向 `api.anthropic.com` 发起 TCP 连接。对非 Anthropic 用户是浪费的网络请求，且在受限网络环境中可能造成不必要的延迟。该函数会检查 `CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY` 并跳过，但完全没感知 `CustomApiProvider`。
- **风险程度**: 中
- **建议行动**:
  1. 在 `preconnectAnthropicApi()` 中添加对当前 profile 的检查
  2. 如果当前 provider 不是 `anthropic`，跳过预连接
  3. 或改为预连接到当前 profile 的 base URL

### 9. Anthropic Beta Header 发送给非 Anthropic Provider

- **文件**: `src/services/api/claude.ts`（多处）
- **来源**: 原版 Anthropic 特定 beta header
- **涉及 header**: `task-budgets-2026-03-13`、`context-1m-2026-08-01` 等
- **后果**: 这些 beta header 是 Anthropic 特定的 API 功能。发送到 OpenAI/Gemini 兼容端点可能导致：
  - 忽略（理想情况）
  - 400 错误（端点不支持该 header）
  - 行为异常（端点误解析）
- **风险程度**: 中
- **建议行动**:
  1. 在 OpenAPI/Gemini 兼容路径中剥离 Anthropic 特定的 beta header
  2. 或使 beta header 的添加基于当前 provider 类型条件化

### 10. AppState 无多 Profile 字段

- **文件**: `src/state/AppStateStore.ts`
- **来源**: Slave Code 多 Profile 功能是后来添加的，未集成到核心状态管理
- **具体问题**:
  - `AppState` 类型（452 行）包含 100+ 字段，但没有 `currentProfile` 或 `profiles`
  - Profile 状态完全在 React 状态树之外管理（`customApiStorage.ts` + `globalConfig` + env vars）
  - UI 组件无法响应式显示 profile 信息，必须直接读取存储
- **后果**: UI 不能实时反映当前 profile 切换；profile 状态变更不经过统一的状态管理；调试困难
- **风险程度**: 中
- **建议行动**:
  1. 在 `AppState` 中添加 `currentProfile?: string` 字段
  2. Profile 切换时通过 `onChangeAppState` 同步更新
  3. UI 组件通过 AppState 读取，而非直接访问 `customApiStorage`

### 11. 3 个未完成的 TODOs：useDiffInIDE 生命周期管理

- **文件**: `src/hooks/useDiffInIDE.ts:212-214`
- **来源**: 原版代码
- **TODO 内容**:
  - `TODO: Time out after 5 mins of inactivity?`
  - `TODO: Update auto-approval UI when IDE exits`
  - `TODO: Close the IDE tab when the approval prompt is unmounted`
- **后果**: IDE diff 功能缺乏完整的生命周期管理，可能导致：
  - IDE 标签页泄漏（不关闭）
  - 长时间不活动后无超时处理
  - IDE 退出后自动审批 UI 不更新
- **风险程度**: 中
- **建议行动**: 逐项实现上述 TODO

### 12. GrowthBook WORKAROUND 未移除

- **文件**: `src/services/analytics/growthbook.ts:317-319, 365-372`
- **来源**: 原版代码
- **代码**: 两处 WORKAROUND 块，将 API 返回的 `{value: ...}` 转换为 SDK 期望的 `{defaultValue: ...}`。TODO 注释：`"Remove this once the API is fixed to return correct format."`
- **后果**: GrowthBook 在 Slave 中已被禁用（`getGrowthBookClientKey()` 返回空字符串），这些 workaround 代码成为死代码。同时，导入这些 workaround 相关函数的模块可能还在白白执行额外的转换逻辑。
- **风险程度**: 中
- **建议行动**:
  1. 清理 GrowthBook 初始化代码中不再需要的转换逻辑
  2. 移除对 `@growthbook/growthbook` 的硬依赖（若 SDK 始终使用空 key 初始化失败）

---

## 低风险 (Low)

### 13. 80+ 处使用已废弃的 `getSettings_DEPRECATED`

- **文件**: `src/utils/settings/settings.ts:820`
  ```typescript
  export const getSettings_DEPRECATED = getInitialSettings
  ```
- **影响范围**: 40+ 文件中仍有 80+ 处调用（如 `auth.ts`、`print.ts`、`hooks.ts`、`cleanup.ts`、`permissionSetup.ts`、`pluginLoader.ts`、`sandbox-adapter.ts`）
- **来源**: 原版代码，启动了从 `getSettings_DEPRECATED()` 到 `useSettings()` hook 的迁移但未完成
- **后果**: 技术债务，React 组件中使用废弃 API 可能导致非响应式的设置变更
- **风险程度**: 低（功能正常，但增加维护负担）
- **建议行动**: 逐步将调用迁移到 `useSettings()`，完成后删除 `getSettings_DEPRECATED`

### 14. Linux 无安全存储实现

- **文件**: `src/utils/secureStorage/index.ts:14`
- **代码**: `TODO: add libsecret support for Linux`
- **来源**: 原版代码
- **后果**: Linux 上 API keys 直接明文存储在文件中，不像 macOS 使用 Keychain。在共享系统或多用户环境中有凭证泄露风险
- **风险程度**: 低（本地单用户环境中风险较低）
- **建议行动**:
  1. 实现基于 `libsecret` 的 Linux 安全存储
  2. 或使用文件权限保护（`chmod 600`）+ 用户目录加密（LUKS/ecryptfs）

### 15. 103 个 `as any` 类型断言（54 个文件）

- **最严重的文件**:
  - `src/services/api/claude.ts` (16 个)
  - `src/utils/mcpWebSocketTransport.ts` (7 个)
  - `src/utils/computerUse/executor.ts` (4 个)
  - `src/cli/transports/WebSocketTransport.ts` (4 个)
- **来源**: 原版代码
- **后果**: 绕过类型检查，隐蔽的运行时错误风险
- **风险程度**: 低（当前运行正常，但代码修改时容易引入 bug）
- **建议行动**: 逐个审查并改为正确的类型，优先处理 computer-use 模块（最危险的违规者）

### 16. 30+ 处 `.catch(() => {})` 静默错误吞噬

- **关键位置**:
  - `src/bridge/replBridge.ts:470, 659, 714, 754, 791, 2149` — session 状态更新失败被静默丢弃
  - `src/services/mcp/client.ts:302, 309, 1052, 1054, 1143, 1145` — MCP 连接错误被丢弃
  - `src/services/extractMemories/extractMemories.ts:582` — 记忆提取失败被丢弃
  - 工具文件中的 `addSkillDirectories()` 调用失败被丢弃
- **来源**: 原版代码
- **后果**: 失败时无日志、无提示、无从排查
- **风险程度**: 低（通常只是清理/deregistration 操作的失败）
- **建议行动**: 至少添加 `logForDebugging` 日志，对关键操作（session 更新）考虑向上传播错误

### 17. `agentSdkTypes.ts` — 500+ 行存根文件

- **文件**: `src/entrypoints/agentSdkTypes.ts`
- **内容**: 15+ 个导出函数（`tool()`、`query()`、`createSdkMcpServer()` 等）全部 `throw new Error('not implemented')`
- **来源**: 原版代码
- **用途**: 仅为外部 SDK 构建提供类型声明
- **后果**: 主二进制中的死代码
- **风险程度**: 低（功能上无害，但增加代码库体积和维护认知负担）
- **建议行动**: 评估是否可以从主构建中排除此文件

### 18. `query.ts` 中的重复代码

- **文件**: `src/query.ts:1033-1041` 和 `1489-1497`
- **内容**: 两处近 9 行的相同代码块调用 `cleanupComputerUseAfterTurn()`，含相同的动态 import、try/catch 和注释
- **来源**: 原版代码
- **后果**: 修改时需要同步两处
- **风险程度**: 低
- **建议行动**: 提取为共享函数

### 19. API 错误检测依赖字符串匹配

- **文件**: `src/services/api/withRetry.ts:597-599`
- **代码自带 TODO**: `"Replace with a response header check once the API adds a dedicated header for fast-mode rejection (e.g., x-fast-mode-rejected). String-matching the error message is fragile and will break if the API wording changes."`
- **后果**: 上游 API 错误消息措辞变化会导致 fast-mode 拒绝检测静默失效
- **风险程度**: 低（影响范围小，仅 fast-mode 功能）
- **建议行动**: 等待 API 添加专用 header 后切换

### 20. CLAUDE_CODE_* 环境变量无 SLAVE_* 替代

- **影响**: 14+ 个 `CLAUDE_CODE_*` 环境变量（如 `CLAUDE_CODE_SIMPLE`、`CLAUDE_CODE_DISABLE_TERMINAL_TITLE`、`CLAUDE_CODE_USE_POWERSHELL_TOOL` 等）
- **后果**: 如果同时安装了原版 Claude Code 和 Slave Code，设置这些环境变量会同时影响两者
- **风险程度**: 低
- **建议行动**:
  1. 为每个 `CLAUDE_CODE_*` env var 添加 `SLAVE_*` 替代
  2. 优先级：`SLAVE_*` > `CLAUDE_CODE_*`
  3. 注意：`ANTHROPIC_*` 变量是 API 生态标准，应保持不变

### 21. 配置文件名仍是 `.claude.json`

- **文件**: `src/utils/dogeConfigDir.ts:9`
- **内容**: `~/.slave/.claude.json` — 目录用的是 `.slave/` 但文件名仍为 `.claude.json`
- **后果**: 与原版共用 `CLAUDE_CONFIG_DIR` 时两个工具会读写同名文件
- **风险程度**: 低（目录不同，通常不冲突）
- **建议行动**: 考虑重命名为 `.slave.json`，需要兼容旧文件名并提供迁移逻辑

### 22. 过时的文档链接（30+ 处）

- **涉及文件**: `src/constants/prompts.ts`、`src/tools/AgentTool/`、`src/components/HelpV2/`、`src/components/Onboarding.tsx`、`src/components/TrustDialog/`、`src/bridge/`、`src/utils/settings/validationTips.ts` 等
- **链接形式**: `https://code.claude.com/docs/en/...`、`https://docs.anthropic.com/en/docs/claude-code/...`
- **后果**: 用户点击后进入 Claude Code 官方文档而非 Slave Code 文档；若官方文档下线或修改路径，链接会失效
- **风险程度**: 低
- **建议行动**: 逐个审查链接是否需要替换或删除

### 23. scheduleRemoteAgents Skill 仍有完整实现

- **文件**: `src/skills/bundled/scheduleRemoteAgents.ts`
- **现状**: `isEnabled: () => false` 阻止了 skill 被激活，但 400+ 行的完整实现（含 claude.ai URLs、cloud environment API 调用等）仍然存在
- **后果**: 死代码占用文件空间
- **风险程度**: 低
- **建议行动**: 如确定永不启用，可清理整个文件

### 24. 内部 Slack 频道引用泄露

- **文件**: `src/skills/bundled/stuck.ts:44`
- **内容**: `post to **#claude-code-feedback** (channel ID: C07VBSHV7EV)`
- **来源**: Anthropic 内部 Slack 频道
- **后果**: 不应出现在 Fork 版本中
- **风险程度**: 低
- **建议行动**: 删除此行或替换为通用建议

### 25. `src/utils/undercover.ts` 整个文件无意义

- **内容**: "Undercover mode" 是 Anthropic 内部概念（防止内部模型代号泄露到公开仓库）。全部通过 `process.env.USER_TYPE === 'ant'` 门控，外部构建中 DCE。
- **后果**: 对 Slave Code 完全无用的代码
- **风险程度**: 低
- **建议行动**: 可保留（DCE 已消除），或手动清理

---

## 汇总

| 等级 | 数量 | 关键项 |
|------|------|--------|
| 高 | 4 | Shell 执行风险、process.exit 数据丢失、Token 竞争条件、NDJSON 崩溃 |
| 中 | 8 | 错误吞噬、Key 不一致、Provider 检测、预连接、Beta header、状态管理、IDE 生命周期、GrowthBook 死代码 |
| 低 | 13 | 废弃 API、安全存储、类型断言(TypeScript)、静默 catch、存根文件、重复代码、字符串匹配、环境变量、配置文件名、文档链接、死代码、Slack 泄露、undercover 模式 |

**建议修复顺序**: 先处理 4 个高风险项 → 再处理中风险项中的 5-9（与 Slave Code 多 Provider 特性直接相关）→ 最后逐步清理低风险技术债务。
