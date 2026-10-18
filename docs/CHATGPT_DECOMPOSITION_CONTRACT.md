# 网页 ChatGPT 先拆解，再导入

本契约针对“整理进知序”，不改变仅保存原文的请求。由网页 ChatGPT 完成拆解，知序只做校验、持久化和读回，不新增后台 AI 调用。已有拆解直接使用，不要求再次生成。

## 已有传输、保存和显示链路

- `save_chatgpt_conversation` → `conversationSchema` → `validateSync` → `captureIncremental`。`structured:{version:1,items}` 需显式 sync 与真实消息 ID。原文、独立摘要、完整 structured JSON 分区保存在 source；每个 item 另存 knowledge 候选，`stage:candidate`，保持仅本地、未经核验、不加入学习。
- 候选正文保留 `body`、`sourceMessageIds`、`uncertainties`；元数据的 `chatgptImport` 保留条目类型、来源消息、来源修订和内容指纹。候选通过 `sources` 关联原资料，知识库可显示整组和独立内容。正文是文字保留，不等于 v2 图谱结构。
- 快照导入通过授权本机桥接接收原文；批次导入保留消息与分片的真实字符范围、全局来源位置，候选与原文分别持久化并读回。整份签名快照仍受 2 MiB 传输上限限制；批次能力不等于任意长历史都能传输。
- 同一请求须复用 requestId 和完整载荷；sync 同分支使用有效 baseRevision。服务已有去重、冲突和人工编辑保护。不同正文、摘要或拆解不能冒充相同请求重试。
- 长历史必须连续读取至末页；完整性证据含分页范围、消息顺序、快照身份与摘要。服务读回只证明收到的授权文本保存成功，不能证明隐藏分支或附件字节已读取。

## 插件 instructions 应加入的执行要求

用户要求“整理进知序”时，在网页 ChatGPT 内先基于全部已授权读取的原文完成拆解；已有拆解直接保留。每条拆解保留陈述、适用条件、例外、论证语境、未决问题及真实来源消息 ID。将原文、单独摘要和 structured 一起提交。不要只传摘要，也不要要求知序导入后调用外部 AI 再拆解。

只用当前实际暴露工具及其 schema。状态工具声称支持快照或批次不代表这些工具已暴露。缺少真实 sync 身份或消息 ID 时，不能编造；旧路径可保存可见原文和独立摘要，但明确没有导入结构化候选。不能可靠传递完整历史时停止完整性声明，说明阻碍；不能静默摘要化或自行拆成不受支持的调用。

## save-chat-history skill 应加入的段落

放在“选择保存路径”之前：

> 用户要求整理入库时，先在当前 ChatGPT 内基于已授权且完整读取的范围完成拆解，再选择保存路径。已有拆解直接使用，不做重复拆解。按当前实际 schema 构造 structured；每条 body 保留结论所需的条件、例外和上下文，uncertainties 保留未决问题，sourceMessageIds 使用真实已收到的消息编号。原文、独立摘要和拆解共同提交，原文不能被摘要替代。知序只校验保存，不调用外部 AI 二次拆解。若来源身份不支持当前 structured schema，明确报告结构化候选未导入，不编造消息 ID 或 sync 身份。

此段保留现有授权、分页、回执、重试和读回要求，不能替换或弱化它们。

## v1 与 v2 的准确边界

v1 item 只有 `id/title/body/type/sourceMessageIds/uncertainties`。`type` 为 knowledge/conclusion/unverified_fact，不等于 v2 的知识维度或内容角色。它没有独立 sourceRefs 字符定位、units 分类、topics 父子层级或 edges 关系字段；strict schema 会拒绝额外字段，不会自动完成 v2 映射。

现有 v2 `knowledge-structure.mjs`、`source-structure.mjs` 校验原文精确引用、分类、主题导航、带条件和例外的关系。它们用于现有资料加工路径，当前 ChatGPT v1 导入没有接入。可在 v1 body 保留这些语义供阅读，但不得声称高亮、分类筛选或图谱已获得机器映射。不为来源不支持的语义伪造定位，也不以运行一次后台 AI 补全作为导入前提。

本次仅修调用引导。若以后明确要求 ChatGPT 拆解直接驱动 v2 图谱，需要另行定义消息内引用到保存原文的可靠映射、批次跨片关系、结构修订与人工编辑保护契约；这不是现有 v1 流程的必要迁移。
