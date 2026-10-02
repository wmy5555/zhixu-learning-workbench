# ChatGPT 会话收集与知识库读取

在 ChatGPT 网页端连接知序后，用户说“将该会话内容整理进知序”，模型调用 `save_chatgpt_conversation`，将实际传入的角色原文与单独标注的摘要存为第一层 `source/reference`。它不自动读取所有历史会话、附件或其他应用，不声称模型重述与网页记录已经独立比对。实际覆盖范围始终写进资料。

用户操作步骤见运行后的 `/chatgpt-setup.html`。本入口用于个人私有连接；没有发布到公共插件目录，也没有将知序 Web 服务改成公网服务。

## 权限与连接

两个设置默认都是 `false`。关闭接入会由服务端清除读取许可，旧配置中的失效勾选也不会在重新开启接入时恢复：

- `mcp.chatgptEnabled`：接入总开关，允许检查状态与新增第一层会话快照。关闭后所有 ChatGPT 工具立即拒绝调用。
- `mcp.chatgptAllowRead`：独立授予 ChatGPT 检索、读取原文与相关资料的权限。用户已明确要求增加此能力；实际使用仍需在设置中开启。**此项覆盖知识库中标为“仅本地”的资料，读取内容进入 ChatGPT 上下文**，界面同时展示独立授权提示。它不改变 `privacy` 或其他模型、搜索、向量服务的权限。单独关闭读取不影响收集。

本机 MCP 的 `enabled/allowProposals` 沿用原义。新入口不提供覆盖、删除、设置、文件路径或学习晋级工具。ChatGPT 无法替用户开启自己的权限。练习库不能配置接入，也不会被此入口读取或写入。

Web 服务在当前数据目录创建 `chatgpt-mcp-token`，与 `mcp-token` 分离，文件不进入备份、日志或工具结果。桥接进程优先读取 `LEARNING_CHATGPT_MCP_TOKEN`，否则从 `LEARNING_DATA_DIR` 读取专用文件；未指定目录时使用本项目 `.data`，不依赖隧道的工作目录。建议保持本机文件方式，不复制凭据。知序本机连接地址必须为 `http://127.0.0.1:端口` 或 `http://localhost:端口`，不带认证信息、路径或查询；拒绝跳转以免凭据被重定向外送。

官方 [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) 支持 stdio 私有服务，通过本机主动向 OpenAI 建立连接。账户须有隧道权限，隧道须关联目标 ChatGPT 工作区，并具备开发者模式；安装和模型订阅本身不代表已具备这些条件。正式配置需要用户自己的隧道运行凭据，不复用知序中的供应商密钥。源代码中没有任何 OpenAI API 密钥，也没有调用 OpenAI 生成 API。

从项目目录使用官方 `tunnel-client help quickstart` 核对当前版本语法，再运行：

```powershell
tunnel-client init --sample sample_mcp_stdio_local --profile zhixu-chatgpt --tunnel-id 你的隧道ID --mcp-command "node src/mcp-chatgpt.mjs"
tunnel-client doctor --profile zhixu-chatgpt --explain
tunnel-client run --profile zhixu-chatgpt
```

命令中的 ID 必须由账户创建；凭据在本机私密环境提供，不写入此命令或聊天。上述相对启动命令要求从知序项目目录运行。自定义端口/目录时将 `LEARNING_BASE_URL` / `LEARNING_DATA_DIR` 传给桥接进程。保持电脑、知序与隧道运行。在 [ChatGPT 插件](https://chatgpt.com/plugins) 的开发者应用创建界面选择 Tunnel 并选择该隧道；参见 [官方连接指南](https://developers.openai.com/plugins/deploy/connect-chatgpt)。这条私有连接路线不提供可公开提交的插件包。

## 工具与数据

| 工具 | 行为 |
| --- | --- |
| `get_zhixu_status` | 仅返回是否就绪、是否允许读取和输入限额 |
| `save_chatgpt_conversation` | 只在用户要求时新增第一层快照，返回资料编号与保存时间 |
| `search_knowledge` | 本地关键词搜索，最多十条标题/短摘录；不调用模型或向量服务 |
| `read_note` / `read_source` | 按稳定 ID 分页读取正文，默认 12000、最多 20000 字符，返回 `nextOffset` |
| `related_knowledge` | 返回最多二十条相关资料 ID 与标题，不把关系候选当成已确认知识 |

HTTP 入口是 `/api/chatgpt/*`，仅供 stdio 桥接使用；不是 Streamable HTTP MCP 地址。保留 Host/Origin 检查，所有调用都要求专用凭据；本机旧 MCP 凭据不能调用这里，反向亦然。权限在每次请求检查，异步检索返回前再检查一次。

会话参数：`requestId`（8–128 字符）、`title`、`summary`、`messages:[{role:'user'|'assistant',content}]`、`coverage:'current_context'|'selected_excerpt'`；可选 `limitations` 和已知的 `conversationUrl`。只接收 user/assistant 消息，禁止隐藏指令字段与任意元数据。最多 200 条消息，摘要加原文最多 500000 字符，HTTP 请求最多 2 MiB，每分钟最多尝试 30 次新写入（已有回执的重试不占用）。限额由服务端运行记录计算，不采用外部 Markdown 时间。缺失作者、日期、链接留空；不抓取链接、不创建公开分享链接。

保存的 Markdown 含范围说明、AI 摘要及编号角色原文。资料保持 `privacy:local`、`stage:reference`；不创建加工/研究/学习任务。`chatgptCapture` 版本 2 保存原记录 ID、请求与内容摘要，ID 由请求哈希确定；正文仍是知识权威。回执丢失后，只有唯一候选的原 ID、完整标题/正文、来源、条数、范围和时间均能核对时才恢复回执；复制的标记、多个候选、未来时间、已编辑正文或旧格式均提示人工核对，不任意选择、不覆盖、不重复创建。文件标记被去除或 ID 被改写时也不覆盖原路径。正常重试只返回已存回执，不回传后来人工修改的内容。删除后保留的回执可阻止同一请求复活；若原文件与全部运行回执同时丢失，系统无法证明过去的保存或删除。

审计仅记录客户端、操作、时间、条数与保存状态，不记录查询文字、会话正文、摘要、路径或令牌。读取结果不包含任意内部元数据/文件路径。工具注明读取与写入属性，写入使用 `readOnlyHint:false`；ChatGPT 的确认界面由宿主控制，服务端不把模型传入的“用户已确认”布尔值当作额外授权。

摘要、补充限制与每条原文独立使用文本代码块保存，分隔符不会被原文中的代码围栏关闭；Markdown 内的标题、HTML 等保留为文本，不会冒充外层角色标题。能力设置中有前置条件的 MCP 选项会禁用并清除，重新开启父项不自动恢复从属授权；保存后生效。

## 验证与未完成部分

`tests/chatgpt.test.mjs` 用官方 SDK 启动真实 stdio 进程，连接只监听回环地址的真实后端，在随机 `.tmp` 目录写 Markdown/SQLite。覆盖工具发现、收集、检索、分页读取、撤权、范围说明、原文保留、重启/回执恢复、冲突与删除保护、旧凭据隔离、Host/Origin、输入限额和练习库隔离。沿用旧 MCP 的测试覆盖本机客户端兼容性。

本机自动测试通过不代表用户账户已建立隧道或 ChatGPT 网页端实际调用成功。真实验收需：网页对话发出指令 → 工具返回 `saved/already_saved` → 在知序打开对应第一层记录核对摘要、角色原文和覆盖范围 → 关闭读取验证拒绝 → 关闭接入验证收集拒绝。不要使用正式敏感资料做首次连通测试。
