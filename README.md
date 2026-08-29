# Slave Code

Claude Code 的民间 Fork，支持多 API 后端切换和本地模型。

## 目录

- [快速开始](#快速开始)
- [配置 API](#配置-api)
- [多 API Profile 管理](#多-api-profile-管理)
- [本地模型配置](#本地模型配置)
- [命令参考](#命令参考)
- [核心功能](#核心功能)

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
| `/cleanup` | 清理历史数据和缓存 |
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
| `/cleanup` | 清理历史数据与缓存 |
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
── 核心配置 ──
├── .claude.json            # 全局配置（API key、profile、模型、项目状态）
├── .credentials.json       # OAuth 凭证
├── settings.json           # 用户设置（权限、钩子、清理策略）
├── keybindings.json        # 自定义快捷键

── 用户管理 ──
├── CLAUDE.md               # 用户级记忆文件（全局指令）
├── rules/                  # 用户级规则文件（.md，支持条件匹配）
├── skills/                 # 用户安装的技能
├── agents/                 # 用户自定义 Agent 定义
├── output-styles/          # 用户自定义输出风格
├── magic-docs/             # 自定义 Magic Docs 模板

── 会话数据 ──
├── history.jsonl           # REPL 输入历史（全局，自动裁剪上限 1000 条）  *
├── projects/               # 项目会话数据  *
│   └── <项目名>/
│       ├── *.jsonl         # 对话记录
│       ├── *.cast          # Asciicast 录制
│       └── <sessionId>/    # 工具输出 + 子代理记录
│           └── tool-results/

── 运行时状态 ──
├── sessions/               # 并发会话 PID 追踪  *
├── tasks/                  # 任务状态缓存  *
├── file-history/           # 文件检查点备份  *
├── plans/                  # 计划文件  *
├── debug/                  # 调试日志  *

── 插件系统 ──
├── plugins/                # 已安装插件（缓存 + 数据 + 市场清单）

── 缓存与备份 ──
├── backups/                # .claude.json 备份（自动保留最新 5 个）
├── cache/                  # Changelog、模型能力等缓存  *
├── shell-snapshots/        # Shell 环境快照（加速 Bash 工具启动）  *
├── image-cache/            # 图片缓存（按会话）               *
├── paste-cache/            # 粘贴板内容缓存                   *
├── stats-cache.json        # 统计数据缓存                     *

── 内部 / 工具 ──
├── session-env/            # 会话环境变量钩子脚本              *
├── computer-use.lock       # 桌面控制互斥锁
├── .update.lock            # 自动更新锁
├── .npm-cache-cleanup      # npm 缓存清理标记
├── .version-cleanup        # 旧版本清理标记

── 协作 / 团队 ──
├── teams/                  # 团队收件箱（多 Agent 消息传递）
├── uploads/                # Bridge 入站文件存储               *

── 专项功能（按需） ──
├── ide/                    # IDE 集成锁文件
├── chrome/                 # Chrome 扩展集成
├── local/                  # 本地安装（`claude` 二进制）
├── remote/                 # CCR 远程容器 Token 文件
├── agent-memory/           # 用户级 Agent 持久化记忆
├── traces/                 # Perfetto 性能追踪
├── telemetry/              # 遥测失败事件重试队列
├── startup-perf/           # 启动性能分析报告
├── usage-data/             # Insights 仪表盘分析数据
├── dump-prompts/           # API 调试转储（prompt/response）
├── completion.bash         # Bash 补全脚本缓存
├── completion.zsh          # Zsh 补全脚本缓存
└── completion.fish         # Fish 补全脚本缓存
```

> \* 标注的路径可通过 `/cleanup` 命令清理。

### 项目级 `.slave/` 目录

每个项目根目录下也可以有 `.slave/`（与全局 `~/.slave/` 独立）：

```
<project>/.slave/
├── settings.json           # 项目设置（可提交到 Git）
├── settings.local.json     # 本地项目设置（不提交）
├── CLAUDE.md               # 项目级 CLAUDE.md
├── rules/                  # 项目级规则文件
├── skills/                 # 项目级技能
├── agents/                 # 项目级 Agent 定义
├── commands/               # 项目级命令（旧格式）
├── output-styles/          # 项目级输出风格
├── agent-memory/           # 项目级 Agent 记忆（可提交）
├── agent-memory-local/     # 本地 Agent 记忆（不提交）
├── agent-memory-snapshots/ # Agent 记忆快照
├── worktrees/              # Git worktree 克隆
└── scheduled_tasks.json    # 定时任务配置
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

当前版本：**SLAVE-v1.2.3**

---

## 常见问题

### Ollama 连接失败？

确认：
1. `ollama serve` 正在运行
2. Base URL 正确：`http://localhost:11434/v1`
3. 模型已拉取：`ollama list`

### 如何清理或重置配置？

```bash
# 查看可清理的数据
slave /cleanup --list

# 选择性清理（保留 API 配置、skills、插件）
slave /cleanup --all --yes
slave /cleanup --project <项目名> --yes

# 完全重置
rm -rf ~/.slave
```
