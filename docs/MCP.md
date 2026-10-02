# MCP 本地接入

> ChatGPT 网页端请使用新的独立入口 `src/mcp-chatgpt.mjs`，连接、会话收集与单独的读取许可见 [ChatGPT MCP](CHATGPT_MCP.md)。下文的 `src/mcp.mjs` 仍仅供同机客户端使用，不要直接通过隧道开放它。

本应用提供真正的 MCP stdio 服务。MCP 客户端与 `src/mcp.mjs` 通过标准输入/输出交换协议消息；该进程再用本地 token 调用 Web 服务的 `/api/mcp/*` 接口，因此 Web 与 MCP 共用同一份知识、索引、权限和来源关系。它不是把普通 HTTP 接口改名为 MCP。

## 默认权限

MCP 默认关闭。Web 设置中的 `mcp.enabled` 开启后，搜索和读取工具才可调用。`mcp.allowProposals` 是独立开关：关闭时四个只读工具仍可使用，`propose_change` 返回权限错误；开启时它也只创建待确认提案，正式笔记必须在 Web 中查看差异并确认后才能更新。

工具如下：

| 工具 | 行为 | 是否写正式笔记 |
|---|---|---|
| `search_knowledge` | 搜索知识并返回结果及检索诊断 | 否 |
| `read_note` | 按稳定 id 读取知识笔记 | 否 |
| `read_source` | 按稳定 id 读取已保存的原始来源 | 否 |
| `related_knowledge` | 读取关系及相关笔记 | 否 |
| `propose_change` | 保存等待 Web 确认的修改提案 | 否 |

Web 服务首次启动时在数据目录创建并复用 `mcp-token`。MCP 进程优先读取环境变量 `LEARNING_MCP_TOKEN`；未设置时读取 `LEARNING_DATA_DIR` 下的 `mcp-token`，数据目录默认是当前项目的 `.data`。token 只用于请求头，不写入协议结果或日志。文件模式和目录访问权限仍应限制为当前用户。

## 客户端配置

先启动 Web 服务并在设置中开启 MCP。客户端命令使用当前 Node.js 和项目内脚本：

```json
{
  "mcpServers": {
    "personal-learning": {
      "command": "node",
      "args": ["C:/完整路径/个人学习知识系统/src/mcp.mjs"],
      "env": {
        "LEARNING_BASE_URL": "http://127.0.0.1:4318",
        "LEARNING_DATA_DIR": "C:/完整路径/个人学习知识系统/.data"
      }
    }
  }
}
```

不要把 token 直接写进可同步或可共享的客户端配置；让 MCP 进程从本机数据目录读取。首轮实现只面向同一台电脑上的 Web 服务，不代表云端 AI 客户端能访问本机地址，也不构成公网部署。

## 实际兼容测试

`tests/mcp.test.mjs` 使用已安装的官方 `@modelcontextprotocol/sdk` 客户端启动真实 stdio MCP 子进程，再调用 `listTools`、搜索、读取笔记、读取来源、查询关系和创建提案。HTTP 端是只监听 `127.0.0.1` 的受控测试桩，数据位于系统临时目录，不读取用户 Vault，也不访问云端。测试还确认错误 token 被拒绝、关闭提案权限后写入被拒绝，并检查协议结果和 stderr 不包含测试 token。

运行：

```powershell
node --test --test-concurrency=1 tests/mcp.test.mjs
```

2026-09-20 的受控测试使用实际安装并锁定的官方 `@modelcontextprotocol/sdk 1.30.0`，客户端与本服务完成初始化握手，协商协议版本为 `2025-11-25`，随后实际完成工具发现和调用。不声称它是官网当前最新版，也不把 SDK 2.0 文档状态与稳定 1.x 包版本混为一谈。

随后 `tests/http.test.mjs` 进一步用官方 SDK 客户端连接真实 stdio 进程，再调用真实本地 Web 后端和临时 Markdown/SQLite 库，完成检索、读取笔记、读取来源，以及提案权限拒绝。此测试已执行通过。它与前述受控 HTTP 桩测试分别记录；两者都没有在用户日常第三方桌面客户端界面进行配置。

真实后端启动后，可再执行：

```powershell
node scripts/mcp-smoke.mjs "要查找的词"
```

该 smoke test 会输出实际 SDK 版本、握手协商协议版本、服务端版本、工具清单和一次真实搜索结果。它成功只证明当前本机服务上的这次 MCP 搜索成功；不会被描述为公网可用、全库检索完整或云端客户端已经接通。

## 故障含义

- `MCP_DISABLED`：Web 设置尚未开启 MCP。
- `MCP_UNAUTHORIZED`：token 缺失、错误或已轮换。
- `MCP_TOKEN_UNAVAILABLE`：Web 服务尚未生成 token，或 MCP 进程无权读取数据目录。
- `MCP_PROPOSALS_DISABLED`：只读工具可继续使用，修改提案开关关闭。
- `MCP_SERVICE_UNAVAILABLE` / `MCP_TIMEOUT`：本地 Web 服务未运行、地址错误或请求超时。

网页、导入资料和笔记内容在 MCP 中始终只是数据。它们不能改变工具权限、读取 token、触发额外工具，或绕过 Web 确认去修改正式笔记。
