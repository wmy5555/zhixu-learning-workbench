# 架构与协作边界

2026-10-02 补充：新增 `src/chatgpt.mjs` 与 `src/mcp-chatgpt.mjs`，通过独立凭据和开关提供第一层会话收集、以及用户单独授权的 ChatGPT 知识库读取。原同机 MCP 的默认只读/提案规则不变。ChatGPT 授权可包含仅本地资料，但不修改模型/搜索/向量的外发许可；详见 [接口与权限](CHATGPT_MCP.md)。

2026-09-20，施工计划 v1 的实现依据。计划中产品行为属于需求，导入资料中的文字永远不具备程序执行权限。

## 选型

- Node.js 24 / 原生 HTTP / 浏览器原生 ES modules，减少本机安装和构建依赖。
- SQLite（Node 内置）持久化运行记录；Vault Markdown 是知识内容权威。
- YAML frontmatter：稳定 id、kind、stage、sources、topic、privacy；保留未知字段。源码不依赖 Obsidian 常驻。
- 真实 MCP 官方 SDK，stdio 默认只读；只提供可选提案，Web 确认才写入。
- 模型：OpenAI-compatible chat completions；嵌入接口独立配置；搜索：Tavily-compatible；网页读取由服务器执行并限制公开地址。
- 所有云端能力默认关闭，输入默认仅本地。费用未知如实显示，不生成假的核验/学习成绩。

## 数据责任与边界

Vault 中保存 source（原始资料）、knowledge（结构化/个人知识）、mistake（错题修正）、topic（确认主题）、report（发现报告）。数据库保存任务、学习计划、原始回答、草稿提案、配置、调用记录和可重建索引。文件改动用内容哈希作并发检查，写前备份版本；外部重命名按稳定 id 更新路径。重复 id 和解析错误进入冲突列表，不静默覆盖。

删除将文件移入本地历史区并移除当前索引；版本与备份继续保留，用户在设置中能看到策略。备份导出不含密钥和会话认证令牌。恢复先预览，只在确认后执行，覆盖前自动生成安全备份。

服务只绑定 127.0.0.1，限制 Host、Origin，API 使用同源 HttpOnly 会话及写入 CSRF 标记。没有公网部署入口。密钥使用 Windows DPAPI，其他平台需环境密钥或明确配置主密钥。

## 代码模块负责人

- 总负责人：src/store.mjs（文件/SQLite）、src/service.mjs（知识业务）、src/server.mjs（HTTP/调度）、集成和最终验收。
- 界面 Agent：public/（纯浏览器模块，不增设后端接口）。
- AI Agent：src/ai.mjs、tests/ai.test.mjs（独立服务能力、隐私、真实网页研究）。
- MCP/测试 Agent：src/mcp.mjs、tests/mcp.test.mjs、docs/MCP.md（真实 SDK 客户端验收）。

## 固定内部接口

`createService({dataDir, vaultDir})` 从 src/service.mjs 导出，返回下述方法。同步数据方法可被 await。服务的 `close()` 关闭数据库。MCP 通过 HTTP 调用同一服务，不能直接开第二个写进程。

### HTTP 约定

JSON 请求/响应；正常状态 200/201；错误 `{error,code}`。GET /api/bootstrap 返回 `{settings,stats,today,notes,jobs,conflicts,capabilities}`。GET /api/session 返回 csrf（前端保存仅内存），随后修改请求带 `X-CSRF-Token`。不使用 localStorage 存密钥。

- GET /api/notes?kind=&stage=&q= → `{notes}`；GET /api/notes/:id → note。
- POST /api/import `{items:[{title,body,platform,author,url,date,locator,privacy}],process:false}` → `{notes,jobs}`，隐私默认 local。
- PUT /api/notes/:id `{body,title,expectedHash,meta:{...}}` → note；DELETE 同上 expectedHash → `{deleted:true}`。
- POST /api/notes/:id/process → job；POST /api/notes/:id/promote `{stage,reason,depth}` → note；POST /api/notes/:id/confirm `{body,expectedHash}` → note（只有用户确认个人理解）。
- POST /api/notes/merge `{keepId,mergeId,expectedHash,mergeHash,preview:true|false}` → 预览或 note；保留不同观点，绝不自动语义合并。
- GET /api/search?q=&mode=keyword|semantic|hybrid&stage=&topic=&kind=&source=&from=&to= → `{results,diagnostics}`。
- POST /api/ask `{question,scope:['knowledge','source'],mode:'answer'|'outline'|'draft'}` → `{answer,citations,limitations,draftId}`。
- GET /api/drafts → `{drafts}`；PUT /api/drafts/:id `{body,usedIds:[]}` → draft；POST /api/drafts/:id/capture `{body,title,privacy}` → source。
- GET /api/today → `{date,items,minutes,budget}`；POST /api/today/generate → same；POST /api/today/:id/action `{action:'skip'|'defer'|'pause',days:1}`。
- POST /api/study/start `{noteId,planId?}` → session；GET /api/study/:id → session；POST /api/study/:id/answer `{answer,hintUsed,requestId}` → session（保存回答后排 AI 批改，离线仍保存）；POST /api/study/:id/hint → `{hint}`；POST /api/study/:id/confirm `{body}` → note。
- GET /api/mistakes → `{mistakes}`；POST /api/mistakes/:id/action `{action:'dispute'|'resolve'|'reopen'|'revoke',reason}`。
- GET /api/topics → `{topics}`；POST /api/topics `{title,body,noteIds:[],prerequisites:[],minutes:20}`；PUT /api/topics/:id 使用 notes 编辑接口同类字段；POST /api/topics/:id/action `{action:'pause'|'resume'}`。
- GET /api/relations → `{relations,reports}`；POST /api/relations/:id/action `{action:'accept'|'reject',reason?}`；POST /api/discover → job。
- GET /api/jobs → `{jobs}`；POST /api/jobs/:id/action `{action:'retry'|'cancel'}`。
- GET /api/settings → sanitized settings；PUT /api/settings 更新非空字段，apiKey 仅写入且不返回，空值保持旧密钥；POST /api/settings/test `{capability:'model'|'embedding'|'search'|'fetch'}`。
- GET /api/usage → `{totals,daily,models,recentCalls,budget}`；按正式库时区汇总完整调用记录。PUT /api/usage/settings → 只更新预算与单价，验证当前模型标识；练习只读共用统计。详见 [用量说明](USAGE.md)。
- GET /api/diagnostics → `{usage,calls,index,mcp,storage}`；POST /api/index/rebuild → 状态。
- GET /api/backup → 下载开放 JSON（知识+运行状态，无密钥）；POST /api/restore `{backup,preview:true}` → 预览和 token；POST 同地址 `{backup,preview:false,token}` → 恢复。
- GET /api/history/:id → `{versions}`；POST /api/history/:id/restore `{versionId,expectedHash}`。
- GET /api/proposals → `{proposals}`；POST /api/proposals/:id/action `{action:'accept'|'reject'}`，接受检查原哈希。
- POST /api/demo → 幂等导入明确标识的演示资料，不生成虚假个人掌握记录。

### 补充接口与隐私行为

- `GET /api/study` 返回最近学习会话，支持浏览器刷新和服务重启后继续。
- `POST /api/notes/:sourceId/extract {title,body,topic,reason,depth,claimType}` 创建用户手工候选；`fact` 保留研究限制，`opinion` 仅供个人观点/虚构练习，不宣称事实核验。
- `POST /api/topics/suggest` 生成有界 AI 学习包建议报告，用户确认后才建立主题。
- 搜索和问答增加本次查询 `privacy`，默认 `local`；显式 `cloud` 才允许查询文字外发。材料隐私另行检查。
- 重新研究遇到人工修改或外部正文修改，只建立修订提案。接受新研究后回到候选，旧个人理解留在历史中，不自动宣称继续掌握。

协议实施参考官方 [MCP server 指南](https://modelcontextprotocol.io/docs/develop/build-server) 与实际安装 SDK 的类型定义；兼容性以本项目官方客户端实测结果为准。Obsidian 文件模型参考[官方数据存放说明](https://help.obsidian.md/Files+and+folders/How+Obsidian+stores+data)。

### 通用实体

note `{id,kind,title,body,meta,hash,path,updatedAt}`；kind source/knowledge/mistake/topic/report。meta stage reference/candidate/learning/integrated/core/retired；privacy local/cloud；sources `[{id,role:'input'|'support'|'oppose'|'limit',locator?}]`；topic:string；depth aware/find/explain/apply。无置信度/验证标签。

job `{id,type,state:'queued'|'running'|'waiting'|'failed'|'done'|'cancelled',payload,progress,error,createdAt,updatedAt}`。
today.items `[{id,noteId,title,kind,reason,minutes,state}]`。
session `{id,noteId,planId,status,question,material,turns:[{question,answer,hintUsed,feedback,createdAt}],feedback,pendingJobId}`。
settings `{dailyMinutes:25,timezone:'Asia/Singapore',scheduleTime:'08:00',focusTopics:[],pausedIds:[],ai:{enabled:false,baseUrl:'',model:'',hasKey:false,dailyCallLimit:30,monthlyBudget:0,inputPrice:null,outputPrice:null},embedding:{enabled:false,baseUrl:'',model:'',hasKey:false},search:{enabled:false,baseUrl:'https://api.tavily.com',hasKey:false},fetch:{enabled:false},mcp:{enabled:false,allowProposals:false}}`。

### AI 模块 contract

导出 `createAI({getSettings,getSecret,recordCall,getUsage,fetchImpl?})` → `{generate({system,prompt,privacy,signal,json?}),embed({texts,privacy,signal}),search({query,privacy,signal}),readPage({url,privacy,signal}),research({claim,privacy,signal}),test(capability)}`。
getSecret(capability) 返回实际密钥；getUsage() → `{callsToday,costMonth}`；recordCall({capability,model,inputTokens,outputTokens,cost,durationMs,ok,error?})。
generate 返回 `{text,usage}`；embed → `{vectors}`；search → `{results:[{title,url,snippet}]}`；readPage → `{url,title,text,fetchedAt}`；research → `{claim,evidence:[{url,title,excerpt,locator,fetchedAt,role}],limitations:[]}`。research 必须真实搜索、读取支持与反对方向，不可把 search snippet 当已读正文。错误抛 Error 带 code；默认不外发 local 数据。禁止服务返回/日志记录密钥，记录供应商错误需截断清洗。

## 2026-09-29 对齐接口

- `src/learning.mjs` 集中主题、今日安排、错题与结束练习结算；`src/knowledge-lifecycle.mjs` 根据已有证据提出建议，不自动确认理解。
- `GET /api/notes/:id/evidence` 按需返回保留的原文证据；列表仍隐藏内部摘录。
- `GET /api/recommendations`、`POST /api/recommendations/:id/action {action:'accept'|'dismiss'}`：阶段建议走原晋级规则；合并返回预览；研究返回原始资料入口，不自动调用研究。
- `POST /api/study/start` 支持 `topicId`、`mistakeId`；`POST /api/study/:id/finish` 幂等完成整场练习，争议不结算复习。
- `PUT /api/topics/:id` 校验并保存 `meta.noteIds/prerequisites/minutes`；`GET /api/topics` 带有序成员、进度与下一项。
- `POST /api/notes/:id/relate {useAI:false}` 默认本地候选；明确 true 才扩展检索与模型核对。`GET /api/relations` 区分 `candidates` 与 `relations`，并带 `deferredCount`。
- `POST /api/discover {useAI:false}` 默认本地报告及可处理建议；true 受单次预算约束并最多细查两个节点。
- `POST /api/index/update` 和旧 rebuild 入口均复用未变片段，只补建缺失且获准的向量；diagnostics.index.pending 显示缺口。
- `GET /api/notes/:id/links-preview`、`POST /api/notes/:id/links-sync {expectedHash}` 提供管理链接预览与确认；冲突不得覆盖。
- 原始资料 `meta.researchIntervalDays` 可设 1–365，默认 30，仅影响后续研究新结果的 reviewAfter。

上述接口沿用原会话、CSRF、只监听回环地址及 MCP 只读/提案限制。当前设置默认值以 `src/service.mjs` 的 defaults 为准，本文件早期示例不是当前配置快照。
