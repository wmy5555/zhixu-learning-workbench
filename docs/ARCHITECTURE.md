# 架构与协作边界

## 今日安排与后台调度

`today()` 使用 `Store.ensureFresh()`，每次重算前仍检查文件指纹，沿用 60 秒完整哈希校对兜底。正式库 tick 到达每日安排时间后由 `today()` 执行该检查；未到时间时直接检查，两条分支均只检查一次。三秒定时器及防重入保持原样，不保证每次任务都在三秒内完成。计划每次按当前资料、学习记录、设置和学习时钟重新计算，不缓存整日结果；仅在待办内容或延期/暂停状态发生变化时写回，保留已完成、跳过、延期和暂停操作。

在一次 `today()` 的只读资料快照内，建立主题归属时同时保存各活跃主题的完整路径，按主题对象取回；该路径只依赖主题与当前 `all`。成员自身前置项与其路径前缀仍独立合并，不缓存所有成员的前缀列表，不修改路径遍历和循环处理。局部 Map 随本次调用结束释放，下一次调用从新快照重建；其他接口仍使用原来的路径计算。

## 检索派生投影

`src/search-index.mjs` 在原 SQLite 中维护可重建 FTS5 字符片段候选索引，最终核验沿用字面子串及中文字符覆盖规则。`Store.ensureFresh` 每次检查文件身份/大小/时间指纹，增量重读，完整哈希校对兜底；`notes` 触发器事务内登记脏身份，索引失败不丢待处理工作。先过滤再排序、RRF 融合和复合游标均使用正文以外的投影，当前页才读取完整笔记。同步、诊断口径、缓存失效及已知容量限制见 [SEARCH](SEARCH.md)。Markdown、已有向量、两库及外发权限边界保持。

## 网页收集的可选标题

空白标题按原文空白归一化后的前 36 字符临时命名，正文原样保存。来源 meta 的 titlePending、titlePlaceholder 与 titleOrigin 记录待生成及名称来源；只有当前标题仍与占位值相同才可生成。单独 title 任务使用同一个 ai.generate、模型配置、外发限制与任务预算；勾选拆解时 sourceExtract 在同次回答中附带可选 sourceTitle，旧自定义模板继续收到系统输出约定。标题结果须为单行纯文本 1–80 字符；缺失或无效标题不阻断有效候选保存，只留下可单独重试的失败标题任务。

写回前核对原文完整 hash、取消状态和有效外发权限，人工或外部标题修改不被覆盖。只有这一次严格核对的自动补标题允许将原版本的 processKey、加工任务/savedCandidates、已有研究缓存和仍有效的结构 basis 衔接到新 hash；正文、人工候选、确认与晋级状态不变。匹配的待确认修订建议同步其预期 hash。迁移候选时收集其精确 beforeHash→afterHash 绑定；未结束的学习会话仅在 sourceHash 匹配 beforeHash，且教学 material 等于正文或已有 confirmedNoteId 明确确认该知识时同步 sourceHash；确认追加个人理解会保留原教学快照，之后正文编辑仍因 hash 不匹配被拒绝，不改回答、反馈、任务或状态。candidate/suggested 关联仅在双方当前版本都有效时同步端点 hash，任一旧端点都会让整条建议继续失效；不修改既有学习 hash 校验或晋级规则。已结束历史、旧教学快照和已陈旧结构不会借此变为有效。重复导入只增加出处，尚未运行且未拆解的标题/加工请求更新到对应新版本；运行中的旧请求仍按冲突保护停止。后台不自动重试模型请求；所有失败保留原文和临时标题。

## 拆解与分批核验检查点

`process` 保留既有任务状态，新增 `phase`、`extractionSaved`、`savedCount`、`researchProgress`（total/covered/verified）及 `stopCode`。保存候选及结构后才启动研究；公开状态按当前来源 hash 和实际候选重新核对拆解完成，兼容旧记录，不把预设案例当真实结果。状态投影不读取或传送模型正文。

研究记录保留覆盖状态和尝试次数；批次逐项保存，未覆盖项优先，完成有效缓存继续复用。每批至多 3 项主张，整个任务共用 `withBudget`；网页读取为评价保留一次请求，重试和重定向仍计费计数。中断不抹除已完成批次，不变的候选正文及证据不重复写版本或关联任务。

人工编辑候选的待确认核验建议以笔记版本和建议正文识别；新检查点将旧 pending 建议标为 superseded，只留最新建议可接受，旧记录保留。无法执行的搜索规划仍保存具体诊断和停止代码，unsearched 不计覆盖也不增加检索尝试次数。

任务按原文版本保存实际候选 ID；候选被删除后在后续批次或重试前停止，不把缺失条目当作尚未创建。接受核验建议会保留 `acceptedResearchProposal` 标记，此后的检查点仍通过新建议更新，不能因接受操作清除了 `userEdited` 就直接覆盖；该标记不授予学习确认资格。

claims 继续为字符串数组；可选 claimChecks 使用 claimIndex、kind（formal/empirical/attribution）、subject 提供检索线索，不赋予核验通过资格。旧的默认反证搜索模板在渲染时映射为中性边界模板；自定义模板保持原文，模型评价附加一致的证据规则。

2026-10-02 补充：新增 `src/chatgpt.mjs` 与 `src/mcp-chatgpt.mjs`，通过独立凭据和开关提供第一层会话收集、以及用户单独授权的 ChatGPT 知识库读取。原同机 MCP 的默认只读/提案规则不变。ChatGPT 读取仍需独立开启，不自动触发模型/搜索/向量操作；详见 [接口与权限](CHATGPT_MCP.md)。

2026-09-20，施工计划 v1 的实现依据。计划中产品行为属于需求，导入资料中的文字永远不具备程序执行权限。

## 选型

- Node.js 24 / 原生 HTTP / 浏览器原生 ES modules，减少本机安装和构建依赖。
- SQLite（Node 内置）持久化运行记录；Vault Markdown 是知识内容权威。
- 资料结构由 `src/source-structure.mjs` 校验，存为 SQLite `sourceStructures` 派生记录（键为原始资料 ID），随完整备份保存；不写回原文，不改变既有拆解版本身份。`basis` 记录来源 hash 及各条目标题/正文摘要，内容或成员变化即标记待更新，读取时隐藏旧连线和依据。端点必须属于同组，摘录必须存在；层级防环，逻辑边允许环。
- `readPublicNote` 的原始资料详情增加可选 `structure`：当前节点、独立的 `hierarchy`、带类型与两端摘录的 `edges`、状态和原因。`sourceExtract` 可附带以候选下标标识的结构，保存后映射至实际笔记 ID；结构缺失不阻断拆解。`POST /api/notes/:id/structure` 排队分析现有内容，以实际 ID 返回结构；复用任务预算、CSRF、资料及父来源外发权限，在模型调用前后校验版本和权限。仅显式执行，不自动重试或晋级知识，不写入跨资料正式关系。
- `public/source-map.mjs` 用原生按钮与 SVG 绘图：逻辑图将强连通分量折叠后分层，仍画出循环边；思维导图独立按层级布局和折叠。节点选择/缩放/折叠缓存按知识库及来源隔离，显示 AI 建议和有效依据，沿用原有正文操作与引导目标。
- 拆解调用在现有系统提示词后附加结构输出约定，兼容已保存的旧拆解模板；仍为一次模型调用，缺失结构继续降级保存。排图只使用当前标题、实际 ID 与关系，不依赖练习案例文案；新示例成员替换后清理无效选中/折叠 ID。窗口展开仅改变空间，缩放与适应窗口由单独控件管理，默认不自动缩小文字。
- YAML frontmatter：稳定 id、kind、stage、sources、topic；旧 privacy 仅作回退兼容，保留未知字段。源码不依赖 Obsidian 常驻。
- 真实 MCP 官方 SDK，stdio 默认只读；只提供可选提案，Web 确认才写入。
- 模型：OpenAI-compatible chat completions；嵌入接口独立配置；搜索：Tavily-compatible；网页读取由服务器执行并限制公开地址。
- 所有云端能力默认关闭。普通保存不外发，主动 AI 拆解使用必要原文；其他 AI 功能仍由各自的主动操作触发。费用未知如实显示，不生成假的核验/学习成绩。

## 数据责任与边界

Vault 中保存 source（原始资料）、knowledge（结构化/个人知识）、mistake（错题修正）、topic（确认主题）、report（发现报告）。数据库保存任务、学习计划、原始回答、草稿提案、配置、调用记录和可重建索引。文件改动用内容哈希作并发检查，写前备份版本；外部重命名按稳定 id 更新路径。重复 id 和解析错误进入冲突列表，不静默覆盖。

删除将文件移入本地历史区并移除当前索引；版本与备份继续保留，用户在设置中能看到策略。备份导出不含密钥和会话认证令牌。恢复先预览，只在确认后执行，覆盖前自动生成安全备份。

服务只绑定 127.0.0.1，限制 Host、Origin，API 使用同源 HttpOnly 会话及写入 CSRF 标记。没有公网部署入口。密钥使用 Windows DPAPI，其他平台需环境密钥或明确配置主密钥。

## 设置、备份与调用的恢复边界

`src/settings-validation.mjs` 在任何持久写入前完整校验候选设置；`src/secrets.mjs` 把加密凭据保存在 SQLite 的独立 `encrypted_credentials` 表，与设置同事务提交。凭据绑定服务地址和模型，读取及外发时均核对；变更配置后须重新配置对应密钥。旧加密文件保留，一次性迁移标记阻止已清除密钥重新导入。该表不进入 JSON 备份或运行记录，恢复也不修改本机凭据。

`src/backup-contract.mjs` 统一导入和导出的容量与结构约定：最终 JSON（含转义、历史、记录与偏好）最多 100,000,000 UTF-8 字节，恢复 HTTP 包裹请求最多 100,065,536 字节；普通请求维持原限制。存储预校验只读当前 Vault，并在独立内存数据库重建候选镜像；完整设置校验也在恢复预览前完成。`Store.restore(backup,{settings})` 将资料、历史、运行记录和已验证设置一起提交。正式库恢复关闭外部能力及全部 MCP 权限，导入的 queued/running 任务转为 waiting；练习恢复仅处理隔离偏好。

文件与 SQLite 无法使用一个共同事务，因此 `src/store.mjs` 将恢复计划和原件持久暂存，并在 `restore_transactions` 表中先保存计划摘要，最后在数据事务中写入提交标记。启动在正常扫描前核对计划、数据库与全组文件哈希：未提交且原件完整则回滚，已提交且新态完整则清理；回滚完成前保留原件，允许再次中断后继续。未知文件、外部修改、计划不一致或证据缺失保留现场并阻塞，失败回滚也须核对预期哈希。进程强杀检查覆盖完整前态或后态，不代表全部断电情形已验收。

`src/call-ledger.mjs` 持久化 `callLedger`、`callResults` 与 `calls`。调用先预留、再发送、保存受限响应、最后记账；结果未知或记账失败暂停新请求，独立于月预算是否为 0。已有完整响应先补记账，再由原任务复用；批改的 `singleRequest` 按原轮次识别，即使模型或提示词改变也不重发。人工费用确认不补造响应，未知费用继续阻塞，已知费用只解除符合其他条件的新操作限制。恢复备份按整个调用身份保留本机原有证据，导入账本必须满足响应及费用记录的关联约束。

交互问答以可选 `requestId` 记录 `askRequests`：先保存规范化输入和草稿身份，再保存检索引用及版本准备状态；检索嵌入与回答生成分别使用 `withCallContext(...singleRequest:true)`。调用证据同时绑定请求身份、输入及取材版本摘要，不能把同一标识用于不同输入或分叉依据。重试重读材料并核对版本、外发权限与能力，生成后写草稿前再次核对；已保存响应优先复用，不按问题文本去重。草稿和完成标记同一事务提交；完成后同 ID 读取现有草稿，保留人工编辑。若旧备份丢失了操作状态但本机仍有该身份的调用记录，保守阻止重发，不补造输入状态。浏览器 sessionStorage 只保留已提交且未收到成功回执的输入/身份，按正式库与练习库隔离；成功或明确另起请求时清除。

问答完成记录另存 `generate` 返回的实际 `callId`。返回结果前和草稿事务写入前均由 `checkAskCalls` 核对同请求全部本机调用已记账；存在模型账本时，无论备份的 generated 标记为何，都只接受唯一且身份匹配、有成功响应证据的生成调用。恢复备份不能用导入的 completed 标记绕过本机未决记录，也不能在补记后以其他调用草稿完成原请求；拒绝时不先改写草稿。旧备份没有 callId 时保留草稿供人工查看，不从相同问题、时间或正文推测来源；请求接口保守返回 CALL_RECOVERY_REQUIRED。恢复后关闭外部能力的既有规则不变，已经匹配的完成草稿可本地读回，人工编辑不被模型原文覆盖。

核验调用时以 AI 适配器的账本所有者为准。`callLedger.evidence(jobId)` 仅投影该操作的 `id/phase/capability/turnId/ok`，经 `ai.getCallEvidence(jobId)` 供问答准备、完成及读回核对，不暴露响应正文、费用、凭据或正式资料。新手引导保持 `practice.ai === main.ai`，因此核对正式账本；材料校验、请求和草稿读写仍使用隔离练习 Store，练习库不能执行正式调用补记。无此读取接口的既有受控适配器使用服务本身的账本核对，不因缺少该方法放宽调用身份检查。

本次已完成调用恢复 15 项、备份恢复 17 项及设置相关 67 项定向测试；最终综合验证、浏览器界面和真实供应商验收仍待完成。没有新增依赖或第三方资产，Android 未同步本次网页改动。

## 模块与协作边界

- `src/store.mjs` 负责文件与 SQLite，`src/service.mjs` 编排知识业务，`src/server.mjs` 提供 HTTP 与调度；接口、数据边界和最终验收需在任务负责人处统一核对。
- `public/` 是浏览器界面；`src/ai.mjs` 负责模型与研究边界；`src/mcp.mjs` 提供 MCP 接口。相关测试和文档随实际改动范围维护，不把这些目录永久分配给固定 Agent。
- 多任务时由当前负责人按任务独立性、文件冲突和并行收益分派，并统一集成与验收；实际任务归属与交接以[跨任务交接规则](MAINTENANCE.md#跨任务交接)及当前明确指派为准。架构图不代表当前会话分工。

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
- POST /api/ask `{question,scope:['knowledge','source'],mode:'answer'|'outline'|'draft',privacy:'local'|'cloud',requestId?}` → `{requestId,answer,citations,limitations,draftId,generated}`。请求标识为 1–100 位字母、数字、下划线或短横线；同 ID 不同输入返回 `ASK_REQUEST_CONFLICT`。旧调用省略标识时自动创建新身份，无法由相同问题文本找回旧请求。
- GET /api/drafts → `{drafts}`；PUT /api/drafts/:id `{body,usedIds:[]}` → draft；POST /api/drafts/:id/capture `{body,title,privacy}` → source。
- GET /api/today → `{date,items,minutes,budget}`；POST /api/today/generate → same；POST /api/today/:id/action `{action:'skip'|'defer'|'pause',days:1}`。
- POST /api/study/start `{noteId,planId?}` → session；GET /api/study/:id → session；POST /api/study/:id/answer `{answer,hintUsed,requestId}` → session（保存回答后排 AI 批改，离线仍保存）；POST /api/study/:id/hint → `{hint}`；POST /api/study/:id/confirm `{body}` → note。
- GET /api/mistakes → `{mistakes}`；POST /api/mistakes/:id/action `{action:'dispute'|'resolve'|'reopen'|'revoke',reason}`。
- GET /api/topics → `{topics}`；POST /api/topics `{title,body,noteIds:[],prerequisites:[],minutes:20}`；PUT /api/topics/:id 使用 notes 编辑接口同类字段；POST /api/topics/:id/action `{action:'pause'|'resume'}`。
- GET /api/relations → `{relations,reports}`；POST /api/relations/:id/action `{action:'accept'|'reject',reason?}`；POST /api/discover → job。
- GET /api/jobs → `{jobs}`；POST /api/jobs/:id/action `{action:'retry'|'cancel'}`。
- GET /api/settings → sanitized settings；PUT /api/settings 更新非空字段，apiKey 仅写入且不返回，空值保持旧密钥；POST /api/settings/test `{capability:'model'|'embedding'|'search'|'fetch'}` 仍测试已保存配置；正式设置可另传 `config` 测试单项表单快照，不落盘，返回短期一次性 `receipt`。POST /api/settings/save-tested 提交同一 `capability/config/receipt`，校验草稿摘要和设置/加密凭据版本后经原安全保存路径提交；练习路由拒绝草稿测试和保存。回执最多保留 16 个，5 分钟过期，不含明文密钥。
- GET /api/usage → `{totals,daily,models,recentCalls,budget}`；按正式库时区汇总完整调用记录。PUT /api/usage/settings → 只更新预算与单价，验证当前模型标识；练习只读共用统计。详见 [用量说明](USAGE.md)。
- GET /api/call-recovery → `{pending}`；POST /api/call-recovery/:id `{action:'recover'}` 补记已有响应或取消未发预留，`{action:'confirm',cost:number|null,reason}` 核对无响应调用费用；不重新发送请求，练习只读。
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

导出 `createAI({getSettings,getSecret,recordCall,getUsage,fetchImpl?,callLedger?})` → `{generate({system,prompt,privacy,signal,json?}),embed({texts,privacy,signal}),search({query,privacy,signal}),readPage({url,privacy,signal}),research({claim,privacy,signal}),test(capability),withCallContext(context,fn)}`。
getSecret(capability,config) 核对配置绑定后返回实际密钥；getUsage() → `{callsToday,costMonth}`；recordCall({capability,model,inputTokens,outputTokens,cost,durationMs,ok,error?})。正式服务注入持久 callLedger；withCallContext 绑定原任务与批改轮次，用于保存响应的安全复用。
generate 返回 `{text,usage}`；embed → `{vectors}`；search → `{results:[{title,url,snippet}]}`；readPage → `{url,title,text,fetchedAt}`；research → `{claim,evidence:[{url,title,excerpt,locator,fetchedAt,role}],limitations:[]}`。research 必须真实搜索、读取支持与反对方向，不可把 search snippet 当已读正文。错误抛 Error 带 code；默认不外发 local 数据。禁止服务返回/日志记录密钥，记录供应商错误需截断清洗。

## 2026-09-29 对齐接口

- `src/learning.mjs` 集中主题、今日安排、错题与结束练习结算；`src/knowledge-lifecycle.mjs` 根据已有证据提出建议，不自动确认理解。
- `public/onboarding-materials.mjs` 保留五组经审阅的真实摘录、模拟心得、学习任务与第三方许可，不作为预建知识或证据。`getCurriculum(materialId)` 沿用原步骤身份与进度；`custom` 正文只存在隔离练习记录，不能混入公共素材。
- `POST /api/onboarding/start {materialId,customMaterial?}` 选择场景，`select-knowledge {practiceId,noteId,role}` 选择当前原文的实际可学知识。练习备份保留场景、角色与时间。仅隔离服务注入场景提问回调，正式学习不受影响，既有核验与外发限制不变。
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

## 学习与可信度解耦（2026-10-21）

学习编排接收独立的 learnable：知识未被替代、未停用，且用户已选学习阶段，才能练习；核验限制作为 materialWarnings 随计划和会话保留，并进入批改材料提醒。旧会话缺此字段时读取当前提示。材料版本校验、原回答、外发许可、预算与个人确认约束保持；原 eligible 继续用于问答/关系/发现的证据筛选，未验证知识不能因学习通过而成为已验证依据。

processNote 的 retryJobId 只接受当前原文版本的实际任务。明确重试才调整研究选项并将原任务排队，运行/排队中复用、完成回执重放不新建；失败的普通提交仍返回原记录。前端用轻量状态接口轮询，终态停止，只读刷新失败不会重发业务请求；普通拆解进行中收到核验意图时先显示当前任务，拆解完成后另给显式核验按钮。

证据写回不再用 stage 不等于 candidate 作为人工编辑证据；仍保护正文 hash、userEdited、acceptedResearchProposal、confirmedAt 和未完成会话。自动补证据保留 stage/depth/promotionReason/promotedAt/topic/prerequisites。接受研究修订仍校验 expectedHash，保留学习选择；integrated/core 回到 learning 并清除当前确认标记，原理解留在历史，不能静默认定新材料已被理解。
