# 外部 AI、搜索与网页读取

本模块实现 `docs/ARCHITECTURE.md` 中的 `createAI` contract。模型、嵌入、搜索和网页读取是四项独立能力，默认都关闭；只有用户明确启用相应能力并把本次数据标记为 `privacy: cloud` 时才会外发。`privacy: local`、缺省 privacy 或其他值都会在发起网络请求前以 `PRIVACY_LOCAL` 拒绝。

## 接口与配置

模型采用 OpenAI-compatible Chat Completions：在 `settings.ai.baseUrl` 后调用 `POST chat/completions`，请求含 `model` 和 `messages`。`json: true` 使用 JSON object 模式；也可传 `{name, schema, strict}` 使用 JSON Schema 格式。实现依据是 OpenAI 官方的 [Chat Completions API](https://developers.openai.com/api/reference/cli/resources/chat)；兼容服务仍可能只实现其中一部分参数，因此结构化输出是否可用需要对目标服务实测。

嵌入采用 OpenAI-compatible Embeddings：在 `settings.embedding.baseUrl` 后调用 `POST embeddings`，一次传入字符串数组并按响应 `index` 恢复顺序。实现依据是 OpenAI 官方的 [Embeddings API](https://developers.openai.com/api/reference/ruby/resources/embeddings/methods/create)。模块不会假定聊天模型地址、嵌入地址、模型名或凭据相同。

搜索采用 Tavily-compatible `POST search`，通过 Bearer header 鉴权，发送 `query`、`search_depth: advanced`、`max_results: 6`，并关闭答案和网页原文返回。返回值只包含 `{title,url,snippet}`。搜索摘要是发现线索，不算已经阅读过的网页正文。字段和响应形状按 Tavily 官方的 [Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search) 实现。

`baseUrl` 可以包含路径，例如 `https://api.openai.com/v1` 会得到 `/v1/chat/completions` 和 `/v1/embeddings`。如果配置值本身已以目标端点结尾，不会重复追加。服务地址不得包含 URL 用户名或密码。

密钥通过 `getSecret('model'|'embedding'|'search')` 取得，只进入相应请求，不进入返回值、缓存或普通错误。三类供应商请求都使用 Bearer header。错误写入 `recordCall` 前会移除已知密钥、Bearer token 和常见 key/token 字段，并截断到 500 个字符。

## 研究和网页证据

`research({claim,...})` 分别发起支持方向与反证/反例方向搜索，每个方向最多选择三个不重复地址，然后调用 `readPage` 读取正文。相同 URL 和正文高度重叠的页面不会重复作为独立证据。搜索方向只用于发现候选，不直接成为证据角色。

读取后，模块只把主张和每页最多约 1400 字符的相关正文窗口交给已配置的聊天模型。模型逐项给出 `support|oppose|limit|irrelevant`、理由和相关摘录，并形成保留条件与冲突的 `conclusion`。程序随后要求摘录是对应已读正文中的原样连续子串，重新计算正文字符位置；无法逐字定位的摘录会被丢弃，无关页面不会进入证据。`evidence[].excerpt` 因此只来自成功读取的网页正文，绝不从搜索 snippet 复制。`fetchedAt` 是本次正文读取时间，`locator` 是提取后正文中的字符位置。

返回值为 `{claim,evidence,limitations,conclusion,notice}`。`limitations` 只保存会妨碍形成结论的实质问题，例如没有有效正文、证据不足或支持与反对证据仍冲突；搜索或个别网页读取失败、未识别到反证、有限检索范围和“语义角色由 AI 整理”等说明进入 `notice`，不会单独阻止后续学习。证据角色和结论仍是模型对有限正文窗口的整理，不是程序证明网页正确；使用时仍需结合原网页语境、来源身份、时间和方法审阅。

网页读取支持公开 HTTP/HTTPS 的 HTML、XHTML 和纯文本，单次响应上限 3 MiB，最多跟随 4 次重定向，拒绝 HTTPS 降级到 HTTP。它不执行网页脚本，也不支持 PDF、需要登录的页面、浏览器挑战、客户端渲染正文或任意字符集的完整识别；正文目前按 UTF-8 解码并做轻量 HTML 文本提取。

## SSRF 和网络边界

所有服务地址和网页地址都经过同一套程序级 SSRF 检查。`localhost`、`.localhost`、`.local`、URL 凭据、非 HTTP(S) 协议，以及回环、私网、链路本地、共享地址、文档保留地址、基准测试地址、组播、未指定和其他特殊用途 IPv4/IPv6 范围都会被拒绝。因此，即使用户把某个模型服务标记为“可信”，也不能借它访问本机或未授权内部网络。

域名解析会取得全部地址，只要其中任一地址不是允许的公网地址就拒绝。生产传输不再按域名二次解析，而是直接连接已经检查过的固定 IP；HTTPS 仍使用原始主机名进行 SNI 和证书校验，并发送正确的 Host header，从而缩小 DNS rebinding 窗口。每一跳网页重定向都会重新解析和检查。模型、嵌入和搜索端点不自动跟随重定向，避免 POST 在跨主机跳转时泄漏授权信息。

`fetchImpl` 是单元测试隔离入口。即使注入它，模块仍会先做协议、主机和 DNS 地址校验，并要求 transport 使用 `redirect: manual`；实际 socket 固定由注入实现负责。生产环境不应传 `fetchImpl`，这样才能使用模块内置的固定地址连接。

## 调用限制、预算和缓存

所有真实 HTTP 尝试受同一个 3 并发信号量限制。模型超时默认 180 秒，可在 Web 设置为 1–600 秒；其他 JSON 能力为 30 秒，网页读取为 20 秒。调用方取消时抛 `CANCELLED`；内部超时抛 `REQUEST_TIMEOUT`。

模型生成请求不自动重试，以免响应中断后重复产生费用。其他能力遇到网络错误、HTTP 408、409、425、429 和 5xx 最多重试 2 次。每个真正发出的 HTTP 尝试分别受预算检查并写入调用记录；在隐私、配置、凭据、预算或 SSRF 阶段被拒绝的操作不记成供应商调用。

`dailyCallLimit` 是所有外部 HTTP 尝试合计的每日硬上限。`monthlyBudget: 0` 表示没有启用月费用上限；正数预算启用后，如果 `getUsage().costMonth` 为未知，模块以 `BUDGET_UNKNOWN` 停止，而不会假装费用可控。预算只能在请求开始前根据已记录费用判断，不能保证单个未知成本请求绝不越过剩余额度。

模型响应包含 token 用量且 `inputPrice`、`outputPrice` 都是有限数值时，费用按“每百万 token 的货币价格”计算。嵌入响应包含 token 用量且配置了 `embedding.inputPrice` 时按同一单位计算；未配置嵌入价格或搜索价格时费用记录为未知。网页读取没有供应商单价，记为 0。价格币种由上层设置界面统一约定，本模块不做汇率换算。返回的 `generate().usage.cost` 与调用记录使用相同算法。

用量与费用管理见 [USAGE](USAGE.md)。配置 `ai.cachedInputPrice` 后按供应商报告的缓存命中量分别计价；缺少缓存数量时该次费用未知。未配置缓存价时沿用全部输入乘普通输入价的估算方式。`search.requestPrice` 可为成功搜索 HTTP 请求估价，失败请求仍保持未知。新单价只用于后续请求，历史费用不回算。

进程内缓存是有界 LRU 风格缓存：嵌入结果 24 小时（最多 64 项），搜索结果 15 分钟（最多 128 项），网页正文 10 分钟（最多 128 项）。缓存 key 使用 SHA-256，不直接保存 query/text 作为 Map key；缓存值仍存在当前 Node 进程内存中，进程退出即消失。缓存命中不产生调用记录或费用。生成结果不缓存，避免复用本应重新生成的回答。

## 错误 code

调用方应使用 `error.code`，不要解析错误文字。主要 code 为：

- `PRIVACY_LOCAL`：数据不允许外发。
- `CAPABILITY_DISABLED`：能力开关未开启。
- `MISSING_CREDENTIALS`：相应密钥不存在。
- `INVALID_CONFIG`、`INVALID_INPUT`、`INVALID_URL`：配置或输入无效。
- `BUDGET_EXCEEDED`、`BUDGET_UNKNOWN`：调用量/费用保护阻止请求。
- `CANCELLED`、`REQUEST_TIMEOUT`：主动取消或超时。
- `SSRF_BLOCKED`、`DNS_FAILED`、`UNSAFE_REDIRECT`、`TOO_MANY_REDIRECTS`：网络目标不安全或无法安全解析。
- `NETWORK_ERROR`、`PROVIDER_ERROR`、`INVALID_RESPONSE`：传输、供应商状态或响应结构失败。
- `RESPONSE_TOO_LARGE`、`UNSUPPORTED_CONTENT_TYPE`、`EMPTY_PAGE`：网页/响应读取限制。

## 连接测试和验收边界

`test('model'|'embedding'|'search')` 会发出一个最小真实请求，因此会消耗调用次数和可能的费用。`test('fetch')` 读取 `settings.fetch.testUrl`，未配置时读取 `https://example.com/`。测试成功只证明该能力在当时可以完成这一请求，不证明所有模型参数、所有网站或长期稳定性。

自动化测试使用注入 transport 验证隐私、预算、取消、缺少凭据、SSRF、重定向逐跳检查、错误清洗、正文证据来源、费用计算和并发限制。它没有真实供应商凭据，所以不冒充外部连接实测。交付环境仍需分别运行四项连接测试，并记录供应商、模型、时间、响应和实际费用状态。
