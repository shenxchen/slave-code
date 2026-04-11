# Slave Code

Claude Code 的民间 Fork，支持多 API 后端切换和本地模型。

## 功能特性

- **多 API Profile**：配置多个后端，一键切换
- **OpenAI 兼容**：支持 Ollama、vLLM、LM Studio 等本地模型
- **协议转接**：Anthropic Messages ↔ OpenAI Chat Completions
- **数据隔离**：独立配置目录 `~/.slave`

## 安装

```bash
bun install
bun link
```

## 常用命令

| 命令 | 说明 |
|------|------|
| `slave` | 启动 |
| `/login` | 配置 API |
| `/model` | 选择模型 |
| `/api-profile list` | 列出所有 profile |
| `/api-profile use <name>` | 切换 profile |
| `/api-profile add <name>` | 创建 profile |
| `/api-profile remove <name>` | 删除 profile |

## Ollama 配置

```bash
# 1. 启动 Ollama
ollama serve

# 2. 在 Slave Code 中创建 profile
/api-profile add ollama
/api-profile use ollama

# 3. 配置（/login）
#   Provider: openai
#   Base URL: http://localhost:11434/v1
#   API Key: 任意
#   Model: llama3.1（需先 ollama pull llama3.1）
```

## 版本

SLAVE-v1.0.0
