# Slave Code

Claude Code 的民间 Fork，支持多 API 后端切换和本地模型。

## 目录

- [快速开始](#快速开始)
- [配置 API](#配置-api)
- [多 API Profile 管理](#多-api-profile-管理)
- [本地模型配置](#本地模型配置)
- [命令参考](#命令参考)
- [核心功能](#核心功能)
- [更新日志](#更新日志)

---

## 快速开始

### 环境要求

- Bun 1.3.5+
- Node.js 24+

### 安装

```bash
git clone git@github.com:shenxchen/slave-code.git
cd slave-code
bun install
bun link
```

### 启动

```bash
slave
```

或直接运行：

```bash
bun run dev
```

---

## 配置 API

运行 `/login` 进入配置向导。

### 支持的 API Provider

| Provider | 说明 |
|----------|------|
| `anthropic` | Anthropic 官方 API |
| `openai` | OpenAI 兼容 API（Ollama、vLLM 等） |
| `gemini` | Google Gemini API |

### 配置项

- **Base URL**: API 端点地址
- **API Key**: 认证密钥
- **Model**: 默认使用的模型
- **Saved Models**: 保存的模型列表

---

## 多 API Profile 管理

### 命令列表

| 命令 | 别名 | 说明 |
|------|------|------|
| `/api-profile list` | `ls` | 列出所有 profile |
| `/api-profile use <name>` | - | 切换到指定 profile |
| `/api-profile add <name>` | - | 创建新 profile |
| `/api-profile remove <name>` | `rm` / `delete` | 删除 profile |
| `/api-profile rename <old> <new>` | - | 重命名 profile |
| `/api-profile current` | `show` | 显示当前 profile |

### 使用示例

```bash
# 创建不同场景的 profile
/api-profile add work
/api-profile add personal
/api-profile add ollama

# 切换到 work profile
/api-profile use work
/login  # 配置 work 的 API

# 切换到 ollama
/api-profile use ollama
/login  # 配置本地模型
```

---

## 本地模型配置

### Ollama

#### 1. 安装并启动 Ollama

```bash
# 安装 Ollama（参考官网）
# https://ollama.com/download

# 启动服务
ollama serve
```

#### 2. 拉取模型

```bash
ollama pull llama3.1
ollama pull qwen2.5
ollama pull codellama
```

#### 3. 在 Slave Code 中配置

```bash
/api-profile add ollama
/api-profile use ollama
/login
```

配置参数：

| 配置项 | 值 |
|--------|-----|
| Provider | `openai` |
| Base URL | `http://localhost:11434/v1` |
| API Key | 任意（留空或填 `sk-xxx`） |
| Model | `llama3.1`（或你拉取的其他模型） |

### vLLM

```bash
# 启动 vLLM
python -m vllm.entrypoints.openai.api_server \
  --model meta-llama/Llama-3.1-8B-Instruct \
  --port 8000
```

Slave Code 配置：

- Base URL: `http://localhost:8000/v1`

### LM Studio

启动 LM Studio 并启用本地服务器，然后配置：

- Base URL: `http://localhost:1234/v1`

---

## 命令参考

### 基础命令

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助 |
| `/config` | 打开配置面板 |
| `/login` | 配置 API 连接 |
| `/logout` | 登出 |
| `/clear` | 清空对话（别名: `reset` / `new`） |
| `/exit` | 退出 |

### 模型管理

| 命令 | 说明 |
|------|------|
| `/model` | 选择模型（交互式） |
| `/model <name>` | 直接设置模型 |
| `/add-model <name>` | 添加自定义模型 |
| `/remove-model <name>` | 移除自定义模型 |

### 核心功能

| 命令 | 说明 |
|------|------|
| `/plan` | 计划模式 |
| `/memory` | 编辑记忆文件 |
| `/buddy` | 宠物交互 |
| `/mcp` | MCP 服务器管理 |
| `/agents` | Agent 管理 |
| `/skills` | 技能管理 |
| `/tasks` | 任务管理 |

### Buddy 宠物系统

| 命令 | 说明 |
|------|------|
| `/buddy` | 唤出 Buddy |
| `/buddy pet` | 摸摸 Buddy |
| `/buddy mute` | 静音 |
| `/buddy unmute` | 取消静音 |
| `/buddy help` | 帮助 |

### Git 相关

| 命令 | 说明 |
|------|------|
| `/branch` | 分支管理 |
| `/commit` | 提交 |
| `/diff` | 查看差异 |

### 其他

| 命令 | 说明 |
|------|------|
| `/cost` | 查看费用 |
| `/usage` | 使用统计 |
| `/stats` | 统计信息 |
| `/theme` | 主题设置 |
| `/color` | 颜色设置 |
| `/vim` | Vim 模式切换 |
| `/keybindings` | 快捷键 |
| `/compact` | 紧凑模式 |
| `/doctor` | 诊断工具 |

---

## 核心功能

### 计划模式

```bash
# 启用计划模式
/plan

# 或直接描述计划
/plan 重构用户认证模块
```

### 记忆系统

```bash
/memory
```

编辑 `MEMORY.md` 和 `memory/` 目录下的文件来持久化信息。

### MCP (Model Context Protocol)

```bash
/mcp
```

管理 MCP 服务器，扩展 AI 的能力。

### Agents

```bash
/agents
```

创建和管理自定义 Agent。

---

## 配置文件

### 目录结构

```
~/.slave/
├── .claude.json          # 全局配置
├── settings.json          # 设置
├── settings.local.json    # 本地设置
├── memory/                # 记忆文件
│   ├── MEMORY.md
│   └── logs/
├── agents/                # Agent 定义
├── skills/                # 自定义技能
├── plugins/               # 插件
├── projects/              # 项目数据
└── sessions/              # 会话历史
```

### 环境变量

| 变量 | 说明 |
|------|------|
| `CLAUDE_CONFIG_DIR` | 配置目录（默认 `~/.slave`） |
| `SLAVE_API_KEY` | API Key |
| `ANTHROPIC_BASE_URL` | API Base URL |
| `ANTHROPIC_MODEL` | 默认模型 |

---

## 版本信息

```bash
bun run version
```

当前版本：**SLAVE-v1.1.1**

---

## 更新日志

### SLAVE-v1.1.1

完成所有层级中.slave配置目录的实现

### SLAVE-v1.1.0

**修复多 API Profile 与模型管理的关键 Bug**

核心问题：`customApiStorage`（多 Profile 存储）与 `globalConfig.customApiEndpoint`（旧单配置）之间存在数据不同步，导致模型切换、Profile 切换等操作后状态丢失或不一致。

#### Bug 修复

- **`/model` 命令选择模型后未持久化**：模型变更只更新了内存中的 `AppState`，没有同步写入 `customApiStorage`、`globalConfig` 和环境变量，导致重启后恢复为默认模型。现在通过 `onChangeAppState` 钩子自动完成三处持久化。(`src/state/onChangeAppState.ts`)

- **`/api-profile use` 切换 Profile 后模型不同步**：切换 Profile 后只更新了环境变量，没有同步 `mainLoopModelOverride` 和 `globalConfig.customApiEndpoint`，导致实际 API 请求仍使用旧 Profile 的模型。现在切换时会完整同步所有状态。(`src/commands/api-profile/api-profile.ts`)

- **模型选择器不读取当前 Profile 的模型列表**：`ModelPicker` 只从 `globalConfig.customApiEndpoint` 读取 `savedModels`，忽略了 `customApiStorage` 中当前 Profile 的自定义模型，导致不同 Profile 下的模型无法正确显示。现在优先从当前 Profile 读取并合并。(`src/utils/model/modelOptions.ts`)

- **`/remove-model` 删除当前模型后内存不同步**：删除正在使用的模型后，没有调用 `setMainLoopModelOverride` 更新内存状态，导致后续 API 请求仍使用已删除的模型。现在会同步更新内存中的模型覆盖。(`src/commands/remove-model/remove-model.ts`)

---

## 常见问题

### Ollama 连接失败？

确认：
1. `ollama serve` 正在运行
2. Base URL 正确：`http://localhost:11434/v1`
3. 模型已拉取：`ollama list`

### 如何完全重置配置？

```bash
rm -rf ~/.slave
```
