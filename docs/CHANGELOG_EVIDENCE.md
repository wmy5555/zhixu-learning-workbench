# 更新日志历史覆盖与来源

本记录用于维护更新日志。核验截至北京时间 2026-10-18 18:29，主分支为 `6082b6a14f2e6c5494a49b48ea6ef5624ec841f3`。

## PR94 待合并批次补充（2026-10-19）

沿用 [PR92](https://github.com/wmy5555/zhixu-learning-workbench/pull/92) 的按日、问题修复/功能变化/体验优化格式及完整历史，来源提交 `25b4a243a47a50246949331848e4b0b484892d74`。2026-10-18及更早正文逐字保留，原始日志存档保持PR92的blob `81ef70d0a9681bdaf2f4fb5d7a5ac39324a10a4c`。本节不把下方历史覆盖统计扩称为当前全仓审计。

本次新增标题“2026-10-19（待合并批次）”使用批次日期；PR94尚未合并，不能冒充主分支合入或发布日期。合并后按实际merged_at的北京时间校正并归入当天。当前只补用户可见变化，不把历史遗漏的提交节奏/验证规则写成新产品功能。

范围来自PR94已核的13个来源提交及独立兼容修复 `029f0335c7300f627680fbe0eae06675c5fa2aa6`：阅读入口、知识结构/关系阅读、关联全文定位、MCP诊断、网页先拆解及v2导入/引用校验。完整来源SHA与去重表保留在[PR94正文](https://github.com/wmy5555/zhixu-learning-workbench/pull/94)，定向测试和未验收边界见[测试结果](TEST_RESULTS.md)。旧PR94流水日志仍可由029f033的CHANGELOG历史复核，本次不覆盖PR92已整理历史。

排除PR93逐条永久删除、PR89导入日期/当前标题/完整链接、PR88价格、AI质量第二轮及独立移动端产品代码。历史日志描述其当时已合并的Android等功能不表示本批引入那些候选。真实网页v2全链路、真实AI结构质量、可信网页连接状态仍未验收；v2整组撤销明确不支持。

此次仅Markdown日志和证据整理，产品代码、测试、依赖、配置及正式4318保持不变；复用029f033的直接相关验证和CI39154114035四项成功，不因文档变化重跑产品测试。PR92保留独立PR身份，PR94只衔接其三个日志文件，避免将较旧的流水日志覆盖回完整历史。

## 覆盖结论

- 已核全部 91 个 PR（#1–#91）：API 第一页 91 项，第二页为空；其中 71 个已合并、20 个未独立合并。
- 已核主分支从当前版本到根提交的全部 74 个提交：API 第一页 74 项，第二页为空；71 个与合并 PR 一一对应，另有 3 个初始直接提交。
- 根提交为 `3d1c29946070f5982bba5e7f681c7b94cd69ed0f`，北京时间 2026-09-20 22:18:56，无父节点；其文件树只有 README。最早产品源码基线为随后 22:20:05 的 `5bd47b0`。
- 日志覆盖 2026-09-20 至 2026-10-18，共 15 个有产品变化的日期、102 条描述；覆盖 62 个产品相关合并 PR 和初始源码直接提交。其余 9 个合并 PR 为维护、审计或流程记录，保留本表，不包装为用户功能更新。
- 最近一周已核 27 个提交及其证据直接复用；补核此前 44 个合并提交的变更文件与 CHANGELOG 差异，以及 3 个直接提交。没有重复运行产品测试。
- 日期按 PR 的 merged_at 转北京时间；直接提交按 committer.date。PR 创建日、代码提交日、合并日、首次上线日互不替代。
- 对历史日期记录当时行为；例如 10 月 7 日保存后自动补标题，在 10 月 15 日改为普通保存不自动调用 AI，均保留，避免将旧行为误当当前行为。

## 可复核的分页入口

- [全部 PR 第一页](https://api.github.com/repos/wmy5555/zhixu-learning-workbench/pulls?state=all&per_page=100&page=1&sort=created&direction=asc)；[第二页（本次为空）](https://api.github.com/repos/wmy5555/zhixu-learning-workbench/pulls?state=all&per_page=100&page=2&sort=created&direction=asc)。
- [main 提交第一页](https://api.github.com/repos/wmy5555/zhixu-learning-workbench/commits?sha=main&per_page=100&page=1)；[第二页（本次为空）](https://api.github.com/repos/wmy5555/zhixu-learning-workbench/commits?sha=main&per_page=100&page=2)。
- 这些集合入口会随未来提交变化；下表固定 SHA 和本次时间用于复核。

## 全部已合并 PR（北京时间）

| PR | 标题 | 创建 | 合并 | main 提交及提交时间 | 正文归档 |
|---|---|---|---|---|---|
| [#91](https://github.com/wmy5555/zhixu-learning-workbench/pull/91) | feat: 集中提交原文阅读、回收站、引导与状态用途增量 | 2026-10-18 04:06:25 | 2026-10-18 15:48:11 | [6082b6a](https://github.com/wmy5555/zhixu-learning-workbench/commit/6082b6a14f2e6c5494a49b48ea6ef5624ec841f3) · 2026-10-18 15:48:11 | 2026-10-18 |
| [#81](https://github.com/wmy5555/zhixu-learning-workbench/pull/81) | 提升本地检索可靠性：增量同步、全文候选索引与稳定分页 | 2026-10-16 14:05:20 | 2026-10-17 16:33:03 | [4223d3d](https://github.com/wmy5555/zhixu-learning-workbench/commit/4223d3d188e3567aab62eda46a214da727e10f22) · 2026-10-17 16:33:02 | 2026-10-17 |
| [#90](https://github.com/wmy5555/zhixu-learning-workbench/pull/90) | docs: 规范审查触发评论与 Windows UTF-8 路径约定 | 2026-10-17 15:49:17 | 2026-10-17 15:54:38 | [32e86b2](https://github.com/wmy5555/zhixu-learning-workbench/commit/32e86b24d2f0686fa69b731e3df08a0c60256cb2) · 2026-10-17 15:54:37 | 维护／审计，不进产品正文 |
| [#87](https://github.com/wmy5555/zhixu-learning-workbench/pull/87) | feat: unify reviewed history fixes and API configuration with responsive feedback | 2026-10-17 01:07:04 | 2026-10-17 15:21:44 | [6f2da72](https://github.com/wmy5555/zhixu-learning-workbench/commit/6f2da7259f1c6642ddee9c96ab9749e34a1747a9) · 2026-10-17 15:21:43 | 2026-10-17 |
| [#86](https://github.com/wmy5555/zhixu-learning-workbench/pull/86) | docs: 仅重大功能 PR 触发一次代码审查 | 2026-10-16 23:32:09 | 2026-10-16 23:49:35 | [e4b7eff](https://github.com/wmy5555/zhixu-learning-workbench/commit/e4b7eff045534b9b056441a432baf75e93a809d6) · 2026-10-16 23:49:34 | 维护／审计，不进产品正文 |
| [#82](https://github.com/wmy5555/zhixu-learning-workbench/pull/82) | fix: 空标题收集使用可读的本地 Markdown 摘要 | 2026-10-16 22:22:49 | 2026-10-16 23:41:35 | [85628fc](https://github.com/wmy5555/zhixu-learning-workbench/commit/85628fcfdb7f6f05e70484c77e23aaf835f304bc) · 2026-10-16 23:41:34 | 2026-10-16 |
| [#84](https://github.com/wmy5555/zhixu-learning-workbench/pull/84) | fix: 保存原始资料后保留查看整组入口 | 2026-10-16 22:24:02 | 2026-10-16 23:31:55 | [5031909](https://github.com/wmy5555/zhixu-learning-workbench/commit/5031909432394f8656f46237e9c10f3eef3747bc) · 2026-10-16 23:31:54 | 2026-10-16 |
| [#71](https://github.com/wmy5555/zhixu-learning-workbench/pull/71) | Verify history imports and support reversible local capture recovery | 2026-10-15 00:08:42 | 2026-10-16 00:54:08 | [4a5f90b](https://github.com/wmy5555/zhixu-learning-workbench/commit/4a5f90b65ad906ca6b35865859caf58a76ff5cbd) · 2026-10-16 00:54:08 | 2026-10-16 |
| [#80](https://github.com/wmy5555/zhixu-learning-workbench/pull/80) | 修复新手引导未能切库时页面一直加载 | 2026-10-16 00:11:47 | 2026-10-16 00:16:31 | [47bcb63](https://github.com/wmy5555/zhixu-learning-workbench/commit/47bcb63611e41edd8ca11895b61ff3173897af97) · 2026-10-16 00:16:30 | 2026-10-16 |
| [#79](https://github.com/wmy5555/zhixu-learning-workbench/pull/79) | 统一正文 Markdown 阅读与可视化编辑，修复窄屏滚动 | 2026-10-15 23:38:44 | 2026-10-15 23:52:08 | [c1bb3fd](https://github.com/wmy5555/zhixu-learning-workbench/commit/c1bb3fd13618ea7643f70c4251f8614721aea797) · 2026-10-15 23:52:07 | 2026-10-15 |
| [#78](https://github.com/wmy5555/zhixu-learning-workbench/pull/78) | 修复可视化编辑器按钮提示被外框遮挡 | 2026-10-15 23:28:15 | 2026-10-15 23:31:59 | [a67c2c5](https://github.com/wmy5555/zhixu-learning-workbench/commit/a67c2c591d943f98b13d786ea3c0e84f6db7b89d) · 2026-10-15 23:31:58 | 2026-10-15 |
| [#77](https://github.com/wmy5555/zhixu-learning-workbench/pull/77) | fix: 整合网页编辑、50 MB 附件与可靠恢复 | 2026-10-15 20:47:01 | 2026-10-15 21:48:06 | [5947fb6](https://github.com/wmy5555/zhixu-learning-workbench/commit/5947fb6c583906d08bf4c5cae807338581b9b254) · 2026-10-15 21:48:06 | 2026-10-15 |
| [#72](https://github.com/wmy5555/zhixu-learning-workbench/pull/72) | 登记外发流程重构的前置依赖与上线条款待办 | 2026-10-15 01:07:09 | 2026-10-15 01:09:32 | [05f3303](https://github.com/wmy5555/zhixu-learning-workbench/commit/05f330335fd28e24ec46ac9578c936f21e533df7) · 2026-10-15 01:09:32 | 维护／审计，不进产品正文 |
| [#70](https://github.com/wmy5555/zhixu-learning-workbench/pull/70) | 修复原文 Markdown 阅读、栏目折叠与搜索建议关联 | 2026-10-14 23:24:13 | 2026-10-14 23:33:14 | [164ee4f](https://github.com/wmy5555/zhixu-learning-workbench/commit/164ee4f3b5dee5b2f57bbea54837d589b762434d) · 2026-10-14 23:33:13 | 2026-10-14 |
| [#65](https://github.com/wmy5555/zhixu-learning-workbench/pull/65) | docs: 统一开发规则并加入版本化流程评估集 | 2026-10-12 19:19:08 | 2026-10-12 19:50:15 | [5fce54d](https://github.com/wmy5555/zhixu-learning-workbench/commit/5fce54da815375583900e2fa14ef41c700dd5a52) · 2026-10-12 19:50:14 | 维护／审计，不进产品正文 |
| [#64](https://github.com/wmy5555/zhixu-learning-workbench/pull/64) | feat: ChatGPT 会话增量保存与结构化候选导入 | 2026-10-12 13:15:52 | 2026-10-12 13:56:17 | [6d3e0dd](https://github.com/wmy5555/zhixu-learning-workbench/commit/6d3e0dd6c1da896b49ac6b3a68e17f6d9fb1c32d) · 2026-10-12 13:56:16 | 2026-10-12 |
| [#63](https://github.com/wmy5555/zhixu-learning-workbench/pull/63) | chore: define cross-task handoff boundaries | 2026-10-12 12:51:04 | 2026-10-12 13:29:39 | [7a275bc](https://github.com/wmy5555/zhixu-learning-workbench/commit/7a275bcece982dd354d04ef917b56c08b712ca36) · 2026-10-12 13:29:38 | 维护／审计，不进产品正文 |
| [#62](https://github.com/wmy5555/zhixu-learning-workbench/pull/62) | 修复本地问答保存后草稿列表不立即更新 | 2026-10-12 12:20:10 | 2026-10-12 13:14:21 | [be0c62d](https://github.com/wmy5555/zhixu-learning-workbench/commit/be0c62d08eae67953148ab31b4806b50629907f7) · 2026-10-12 13:14:20 | 2026-10-12 |
| [#61](https://github.com/wmy5555/zhixu-learning-workbench/pull/61) | fix: 网页收集草稿和未提交回答离开前确认 | 2026-10-12 12:15:12 | 2026-10-12 13:03:56 | [b44b39c](https://github.com/wmy5555/zhixu-learning-workbench/commit/b44b39cfda603bb93fe8eb9f8a61f5f7e805df02) · 2026-10-12 13:03:56 | 2026-10-12 |
| [#60](https://github.com/wmy5555/zhixu-learning-workbench/pull/60) | fix: 网页学习开始与理解确认防重复提交 | 2026-10-12 12:14:39 | 2026-10-12 12:43:42 | [75bde58](https://github.com/wmy5555/zhixu-learning-workbench/commit/75bde5818e3499b72d124de1a0fd082ef275c251) · 2026-10-12 12:43:42 | 2026-10-12 |
| [#57](https://github.com/wmy5555/zhixu-learning-workbench/pull/57) | fix: keep capture form readable beside onboarding | 2026-10-12 03:49:33 | 2026-10-12 04:40:29 | [8ac1a38](https://github.com/wmy5555/zhixu-learning-workbench/commit/8ac1a383a736d5304cc3e457fb4c6ee45e9d989d) · 2026-10-12 04:40:28 | 2026-10-12 |
| [#59](https://github.com/wmy5555/zhixu-learning-workbench/pull/59) | fix: 今日页在确认调整学习状态后立即更新 | 2026-10-12 04:04:38 | 2026-10-12 04:20:42 | [d58df3d](https://github.com/wmy5555/zhixu-learning-workbench/commit/d58df3d45a5ef814a7f7118c95013fab344807d5) · 2026-10-12 04:20:42 | 2026-10-12 |
| [#58](https://github.com/wmy5555/zhixu-learning-workbench/pull/58) | fix: 网页日期卡片保留学习时区的日历日 | 2026-10-12 03:51:13 | 2026-10-12 04:06:33 | [d1fc067](https://github.com/wmy5555/zhixu-learning-workbench/commit/d1fc0678534ddf365b8efaf029ea7535a5a15b4f) · 2026-10-12 04:06:33 | 2026-10-12 |
| [#56](https://github.com/wmy5555/zhixu-learning-workbench/pull/56) | 网页：误关闭原始资料和知识编辑前确认未保存修改 | 2026-10-12 03:38:55 | 2026-10-12 03:58:35 | [f1fa400](https://github.com/wmy5555/zhixu-learning-workbench/commit/f1fa400e67311d078ea4bc82adc2324ab6e31140) · 2026-10-12 03:58:34 | 2026-10-12 |
| [#52](https://github.com/wmy5555/zhixu-learning-workbench/pull/52) | Android 第三阶段：离线学习、错题、主题与独立练习库 | 2026-10-08 18:44:23 | 2026-10-12 01:12:40 | [eb5e2e3](https://github.com/wmy5555/zhixu-learning-workbench/commit/eb5e2e35cb49792b0136648397cd0c889205eb86) · 2026-10-12 01:12:39 | 2026-10-12 |
| [#51](https://github.com/wmy5555/zhixu-learning-workbench/pull/51) | Android 第二阶段：原文历史、文件交换和备份恢复 | 2026-10-07 19:35:28 | 2026-10-12 01:05:58 | [5a87882](https://github.com/wmy5555/zhixu-learning-workbench/commit/5a87882d13069ab81abb5827448cfc7a84e79beb) · 2026-10-12 01:05:57 | 2026-10-12 |
| [#54](https://github.com/wmy5555/zhixu-learning-workbench/pull/54) | chore: 按项目规则触发必要的云端审查，减少重复消耗 | 2026-10-12 00:42:02 | 2026-10-12 00:47:18 | [1a33938](https://github.com/wmy5555/zhixu-learning-workbench/commit/1a339380d12ab39a8a0d22e182ef53bb058b91fb) · 2026-10-12 00:47:17 | 维护／审计，不进产品正文 |
| [#50](https://github.com/wmy5555/zhixu-learning-workbench/pull/50) | fix: preserve learning references during automatic title migration | 2026-10-07 19:30:48 | 2026-10-07 19:46:50 | [65c8e32](https://github.com/wmy5555/zhixu-learning-workbench/commit/65c8e32e859a46e68f625bf01595ee1cf394b9d2) · 2026-10-07 19:46:50 | 2026-10-07 |
| [#49](https://github.com/wmy5555/zhixu-learning-workbench/pull/49) | fix: generate optional capture titles with the decomposition model | 2026-10-07 19:17:00 | 2026-10-07 19:19:31 | [9711e03](https://github.com/wmy5555/zhixu-learning-workbench/commit/9711e0379bc7ce77e05ba2a8ecb2fd6aed479d8c) · 2026-10-07 19:19:31 | 2026-10-07 |
| [#48](https://github.com/wmy5555/zhixu-learning-workbench/pull/48) | feat: Android offline source prototype with shared web UI | 2026-10-07 10:10:40 | 2026-10-07 11:15:25 | [ea0303a](https://github.com/wmy5555/zhixu-learning-workbench/commit/ea0303aba16d081309a98df1810cc157735ebd12) · 2026-10-07 11:15:24 | 2026-10-07 |
| [#43](https://github.com/wmy5555/zhixu-learning-workbench/pull/43) | fix: 拆解先保存、分批续验与合理反例提示，任务预算提高至 120 | 2026-10-04 23:24:39 | 2026-10-05 00:28:41 | [5e7bbd8](https://github.com/wmy5555/zhixu-learning-workbench/commit/5e7bbd80c4f1d5e54e830f87ce09aca324d8141c) · 2026-10-05 00:28:40 | 2026-10-05 |
| [#46](https://github.com/wmy5555/zhixu-learning-workbench/pull/46) | fix: 今日清单说明未安排原因并核对教程主线 | 2026-10-04 23:46:58 | 2026-10-05 00:23:01 | [14250e3](https://github.com/wmy5555/zhixu-learning-workbench/commit/14250e371131679d1b1de8af880dea55e6c3387a) · 2026-10-05 00:23:01 | 2026-10-05 |
| [#45](https://github.com/wmy5555/zhixu-learning-workbench/pull/45) | fix: 学习状态提示增加快捷跳转并保护未保存编辑 | 2026-10-04 23:33:47 | 2026-10-04 23:46:43 | [754dbe6](https://github.com/wmy5555/zhixu-learning-workbench/commit/754dbe62e97b121048edd6763555e30016dec0b1) · 2026-10-04 23:46:43 | 2026-10-04 |
| [#44](https://github.com/wmy5555/zhixu-learning-workbench/pull/44) | fix: 知识编辑表单字段从顶部排列，避免相邻说明拉高输入框 | 2026-10-04 23:26:47 | 2026-10-04 23:40:17 | [f834fab](https://github.com/wmy5555/zhixu-learning-workbench/commit/f834fabfc1b7afc28cfbcf49215f9538c87884dd) · 2026-10-04 23:40:17 | 2026-10-04 |
| [#42](https://github.com/wmy5555/zhixu-learning-workbench/pull/42) | fix: 为待核验事实添加悬停解释 | 2026-10-04 23:09:37 | 2026-10-04 23:27:16 | [b025ea2](https://github.com/wmy5555/zhixu-learning-workbench/commit/b025ea2fe0808bce83b796ee3fa8a14b2d6919e7) · 2026-10-04 23:27:16 | 2026-10-04 |
| [#41](https://github.com/wmy5555/zhixu-learning-workbench/pull/41) | fix: 不再使用弹窗说明停用原因与实际影响 | 2026-10-04 23:01:51 | 2026-10-04 23:14:10 | [832408a](https://github.com/wmy5555/zhixu-learning-workbench/commit/832408a23e030e1cf65ac82525cc976608fff697) · 2026-10-04 23:14:10 | 2026-10-04 |
| [#40](https://github.com/wmy5555/zhixu-learning-workbench/pull/40) | fix: 知识建议卡片折叠长依据，操作按钮独立显示 | 2026-10-04 22:56:42 | 2026-10-04 23:07:02 | [7b306cc](https://github.com/wmy5555/zhixu-learning-workbench/commit/7b306cc7082da5fab8f995724163792ae959d0f8) · 2026-10-04 23:07:01 | 2026-10-04 |
| [#39](https://github.com/wmy5555/zhixu-learning-workbench/pull/39) | fix: 新手引导先介绍首页功能，改用自然操作文案 | 2026-10-04 22:48:25 | 2026-10-04 23:00:14 | [e128e10](https://github.com/wmy5555/zhixu-learning-workbench/commit/e128e1094f2583ba4377f5252cc8cc7e3982cc05) · 2026-10-04 23:00:14 | 2026-10-04 |
| [#37](https://github.com/wmy5555/zhixu-learning-workbench/pull/37) | feat: 新手引导加入五个真实材料场景与自行粘贴选项 | 2026-10-04 09:13:32 | 2026-10-04 10:20:28 | [6cdfad3](https://github.com/wmy5555/zhixu-learning-workbench/commit/6cdfad310c85fe167b19a97dc2a25d577ee37e26) · 2026-10-04 10:20:28 | 2026-10-04 |
| [#38](https://github.com/wmy5555/zhixu-learning-workbench/pull/38) | feat: 鼠标悬停结构图时支持滚轮缩放 | 2026-10-04 09:14:30 | 2026-10-04 09:25:09 | [8b0082b](https://github.com/wmy5555/zhixu-learning-workbench/commit/8b0082b95f64c0a9ef87a095a8548829b393a949) · 2026-10-04 09:25:09 | 2026-10-04 |
| [#36](https://github.com/wmy5555/zhixu-learning-workbench/pull/36) | docs: 为关联分析补充使用时机建议 | 2026-10-04 09:05:21 | 2026-10-04 09:08:14 | [1e5da19](https://github.com/wmy5555/zhixu-learning-workbench/commit/1e5da19d2caeb24d9ae739d2e28856632f07d631) · 2026-10-04 09:08:13 | 2026-10-04 |
| [#35](https://github.com/wmy5555/zhixu-learning-workbench/pull/35) | fix: 结构分析二次确认、画布拖动与可读任务错误 | 2026-10-04 08:26:19 | 2026-10-04 08:47:51 | [853125a](https://github.com/wmy5555/zhixu-learning-workbench/commit/853125acb9f14e5db1d28b7f9da1d1e436f0e1d1) · 2026-10-04 08:47:50 | 2026-10-04 |
| [#34](https://github.com/wmy5555/zhixu-learning-workbench/pull/34) | fix: 拆解时生成资料结构并改善图形阅读与窗口控制 | 2026-10-03 23:17:03 | 2026-10-03 23:22:43 | [802d2ed](https://github.com/wmy5555/zhixu-learning-workbench/commit/802d2ed7a8b07931cf9a6462f9243499d3363706) · 2026-10-03 23:22:43 | 2026-10-03 |
| [#33](https://github.com/wmy5555/zhixu-learning-workbench/pull/33) | fix: 用自然文案提示已有拆解结果 | 2026-10-03 20:22:38 | 2026-10-03 20:25:27 | [7b92efc](https://github.com/wmy5555/zhixu-learning-workbench/commit/7b92efc542eb73f133aa5c902870dbe43276f16c) · 2026-10-03 20:25:26 | 2026-10-03 |
| [#32](https://github.com/wmy5555/zhixu-learning-workbench/pull/32) | 让资料拆解同时呈现逻辑联系与分支层级 | 2026-10-03 13:13:38 | 2026-10-03 13:21:04 | [33a0540](https://github.com/wmy5555/zhixu-learning-workbench/commit/33a05402444d5816b6007fb72ec01685a054ad48) · 2026-10-03 13:21:04 | 2026-10-03 |
| [#31](https://github.com/wmy5555/zhixu-learning-workbench/pull/31) | fix: AI 拆解等待通知与同版本重复提交保护 | 2026-10-03 11:14:49 | 2026-10-03 12:44:43 | [618afbd](https://github.com/wmy5555/zhixu-learning-workbench/commit/618afbdfcad96c4235cba50af027905b0daf6bf0) · 2026-10-03 12:44:42 | 2026-10-03 |
| [#30](https://github.com/wmy5555/zhixu-learning-workbench/pull/30) | fix: 用具体要求说明四档学习目标 | 2026-10-03 10:57:00 | 2026-10-03 10:58:57 | [4833c76](https://github.com/wmy5555/zhixu-learning-workbench/commit/4833c769851cc13273a958e1dd1d7da237e8a998) · 2026-10-03 10:58:57 | 2026-10-03 |
| [#29](https://github.com/wmy5555/zhixu-learning-workbench/pull/29) | fix: 全面补齐新手引导的可见定位框 | 2026-10-03 01:10:06 | 2026-10-03 09:27:06 | [f64b1cd](https://github.com/wmy5555/zhixu-learning-workbench/commit/f64b1cd7c9cc3fde32d7fcf75efcac13ccc40229) · 2026-10-03 09:27:05 | 2026-10-03 |
| [#22](https://github.com/wmy5555/zhixu-learning-workbench/pull/22) | feat: 支持 ChatGPT 会话入库与独立知识库读取授权 | 2026-10-02 23:26:56 | 2026-10-03 09:04:33 | [8977228](https://github.com/wmy5555/zhixu-learning-workbench/commit/89772284bc09ebb4889e51b7d6ac87a8d93e0836) · 2026-10-03 09:04:33 | 2026-10-03 |
| [#26](https://github.com/wmy5555/zhixu-learning-workbench/pull/26) | fix: 第七步明确框选原始资料展开区域 | 2026-10-02 23:50:29 | 2026-10-03 00:18:16 | [91339fc](https://github.com/wmy5555/zhixu-learning-workbench/commit/91339fcbdec030b80649e3ea26c3b64a855ba88d) · 2026-10-03 00:18:15 | 2026-10-03 |
| [#28](https://github.com/wmy5555/zhixu-learning-workbench/pull/28) | fix: 后台完成后清除过期的新手检查错误 | 2026-10-03 00:08:58 | 2026-10-03 00:10:46 | [03b41e9](https://github.com/wmy5555/zhixu-learning-workbench/commit/03b41e9601506f07b5e17650d5ee9fd3a42df4cb) · 2026-10-03 00:10:46 | 2026-10-03 |
| [#27](https://github.com/wmy5555/zhixu-learning-workbench/pull/27) | fix: 新手检查通过后提示并提供下一步按钮 | 2026-10-02 23:52:36 | 2026-10-03 00:05:06 | [c5e0684](https://github.com/wmy5555/zhixu-learning-workbench/commit/c5e06846ed8282dfde0c9bf07db5a8b770ca5fbb) · 2026-10-03 00:05:05 | 2026-10-03 |
| [#23](https://github.com/wmy5555/zhixu-learning-workbench/pull/23) | feat: 左侧导航支持收起并记住浏览器偏好 | 2026-10-02 23:36:03 | 2026-10-02 23:59:30 | [252bc85](https://github.com/wmy5555/zhixu-learning-workbench/commit/252bc85e7a5a26fbebb9dae78fc5c575e8f47700) · 2026-10-02 23:59:30 | 2026-10-02 |
| [#24](https://github.com/wmy5555/zhixu-learning-workbench/pull/24) | fix: 窄窗口新手引导改为可收起浮窗 | 2026-10-02 23:41:02 | 2026-10-02 23:54:17 | [305d99f](https://github.com/wmy5555/zhixu-learning-workbench/commit/305d99f11d2782747af6d7e8e303a1bee362f28f) · 2026-10-02 23:54:17 | 2026-10-02 |
| [#25](https://github.com/wmy5555/zhixu-learning-workbench/pull/25) | fix: 联网检验跟随 AI 拆解启用，精简小修改验证 | 2026-10-02 23:43:30 | 2026-10-02 23:47:33 | [5d70162](https://github.com/wmy5555/zhixu-learning-workbench/commit/5d70162186f8c072880ddff9f8235f7f809abf7b) · 2026-10-02 23:47:33 | 2026-10-02 |
| [#21](https://github.com/wmy5555/zhixu-learning-workbench/pull/21) | feat: 独立管理 Token 用量、费用与预算 | 2026-10-02 22:23:22 | 2026-10-02 23:12:19 | [bb93e96](https://github.com/wmy5555/zhixu-learning-workbench/commit/bb93e9608c18f41f16e4a1dc291b8da4ee48ac6e) · 2026-10-02 23:12:19 | 2026-10-02 |
| [#20](https://github.com/wmy5555/zhixu-learning-workbench/pull/20) | feat: 新手引导先完成核心体验，扩展教程按需自选 | 2026-10-02 21:45:08 | 2026-10-02 22:15:28 | [878350d](https://github.com/wmy5555/zhixu-learning-workbench/commit/878350d4536902c037868a3c6b017d64c65d6bc5) · 2026-10-02 22:15:28 | 2026-10-02 |
| [#19](https://github.com/wmy5555/zhixu-learning-workbench/pull/19) | fix: 定位操作位置时短暂闪烁目标边框 | 2026-10-02 21:27:59 | 2026-10-02 21:30:32 | [59af854](https://github.com/wmy5555/zhixu-learning-workbench/commit/59af854c5ab1ac5972bd4e2493d0692e94774cc0) · 2026-10-02 21:30:31 | 2026-10-02 |
| [#18](https://github.com/wmy5555/zhixu-learning-workbench/pull/18) | fix: 分开显示新手引导当前位置与完成进度 | 2026-10-02 21:19:12 | 2026-10-02 21:21:42 | [e00c365](https://github.com/wmy5555/zhixu-learning-workbench/commit/e00c3652e6794f5d83aa7f97c9d98c63d400dd92) · 2026-10-02 21:21:42 | 2026-10-02 |
| [#17](https://github.com/wmy5555/zhixu-learning-workbench/pull/17) | fix: advance onboarding after reading confirmation | 2026-10-02 21:03:48 | 2026-10-02 21:09:48 | [abbca22](https://github.com/wmy5555/zhixu-learning-workbench/commit/abbca226a5c6825b0c2f78d3de0621391bf7bdca) · 2026-10-02 21:09:47 | 2026-10-02 |
| [#16](https://github.com/wmy5555/zhixu-learning-workbench/pull/16) | chore: 修改前优先阅读并处理 PR 审阅意见 | 2026-09-30 22:28:09 | 2026-09-30 22:34:24 | [0e34624](https://github.com/wmy5555/zhixu-learning-workbench/commit/0e3462471ec63c69f758d54a28693daaa16596d4) · 2026-09-30 22:34:24 | 维护／审计，不进产品正文 |
| [#15](https://github.com/wmy5555/zhixu-learning-workbench/pull/15) | feat: add isolated hands-on onboarding for the full learning workflow | 2026-09-30 16:14:55 | 2026-09-30 16:32:11 | [474228a](https://github.com/wmy5555/zhixu-learning-workbench/commit/474228a8018d0c9f02bbe95f1c5c3cbd81710bac) · 2026-09-30 16:32:11 | 2026-09-30 |
| [#14](https://github.com/wmy5555/zhixu-learning-workbench/pull/14) | 对齐原设计：接通知识生命周期、主题教学、复习结算与 Vault 同步 | 2026-09-29 23:48:00 | 2026-09-29 23:52:26 | [c4ef9fb](https://github.com/wmy5555/zhixu-learning-workbench/commit/c4ef9fb2cceac1f556ff32fffb1527196e2a3265) · 2026-09-29 23:52:25 | 2026-09-29 |
| [#12](https://github.com/wmy5555/zhixu-learning-workbench/pull/12) | fix: 恢复知识操作栏的统一按钮样式 | 2026-09-21 23:28:51 | 2026-09-21 23:30:38 | [051ab6a](https://github.com/wmy5555/zhixu-learning-workbench/commit/051ab6a45f8ba3f4053a41b823cf919228f02969) · 2026-09-21 23:30:38 | 2026-09-21 |
| [#11](https://github.com/wmy5555/zhixu-learning-workbench/pull/11) | fix: 将知识联网核验改为勾选或手动执行 | 2026-09-21 23:19:48 | 2026-09-21 23:21:06 | [a9a447c](https://github.com/wmy5555/zhixu-learning-workbench/commit/a9a447ca1af57e150532e528119657288887f250) · 2026-09-21 23:21:06 | 2026-09-21 |
| [#10](https://github.com/wmy5555/zhixu-learning-workbench/pull/10) | feat: 优化独立使用指南布局并添加本地搜索 | 2026-09-21 16:47:50 | 2026-09-21 16:49:49 | [4e70eba](https://github.com/wmy5555/zhixu-learning-workbench/commit/4e70ebabec3abf08e64740f9b4257436bb47d13e) · 2026-09-21 16:49:49 | 2026-09-21 |
| [#9](https://github.com/wmy5555/zhixu-learning-workbench/pull/9) | 完善夜间模式与自定义强调色，采用 Recall 深灰底色 | 2026-09-21 15:37:08 | 2026-09-21 15:42:15 | [7000e1a](https://github.com/wmy5555/zhixu-learning-workbench/commit/7000e1ae8b6e002c108877f8eb1f9435552ca269) · 2026-09-21 15:42:15 | 2026-09-21 |
| [#8](https://github.com/wmy5555/zhixu-learning-workbench/pull/8) | fix: expand workspace content with fullscreen windows | 2026-09-21 15:23:00 | 2026-09-21 15:25:08 | [3bc2c0e](https://github.com/wmy5555/zhixu-learning-workbench/commit/3bc2c0e2ee2a4cc55acdd288c34604b852bc1736) · 2026-09-21 15:25:08 | 2026-09-21 |
| [#7](https://github.com/wmy5555/zhixu-learning-workbench/pull/7) | fix: reduce Windows desktop launcher delays | 2026-09-21 15:13:08 | 2026-09-21 15:14:51 | [6f2a8e3](https://github.com/wmy5555/zhixu-learning-workbench/commit/6f2a8e32d4cbb3257a6c22c97e0b499a8e5d54df) · 2026-09-21 15:14:50 | 2026-09-21 |
| [#6](https://github.com/wmy5555/zhixu-learning-workbench/pull/6) | 完成首次公开前审计并遮蔽 CI 临时测试密钥 | 2026-09-20 23:07:08 | 2026-09-20 23:14:11 | [d81a5d0](https://github.com/wmy5555/zhixu-learning-workbench/commit/d81a5d05ae90621ae9fe56d74d0e12a9a6832a03) · 2026-09-20 23:14:10 | 维护／审计，不进产品正文 |
| [#1](https://github.com/wmy5555/zhixu-learning-workbench/pull/1) | 建立可复现安装、自动检查与长期维护流程 | 2026-09-20 22:36:01 | 2026-09-20 22:40:59 | [f7f95e7](https://github.com/wmy5555/zhixu-learning-workbench/commit/f7f95e78a1fd87f33554cf9a12608e54bc656e6f) · 2026-09-20 22:40:59 | 维护／审计，不进产品正文 |

## 无 PR 的直接提交

| 提交 | 北京时间 | 处理 |
|---|---|---|
| [3d1c299](https://github.com/wmy5555/zhixu-learning-workbench/commit/3d1c29946070f5982bba5e7f681c7b94cd69ed0f) | 2026-09-20 22:18:56 | 仓库初始化，只有 README，不单列产品功能。 |
| [5bd47b0](https://github.com/wmy5555/zhixu-learning-workbench/commit/5bd47b0b682319582ee7b3778d9590e71b0e5048) | 2026-09-20 22:20:05 | 首次上传源码及使用说明；结合该提交固定 README 与随后 #1 的基线日志，纳入 9 月 20 日四条初始能力。 |
| [e5ef2c0](https://github.com/wmy5555/zhixu-learning-workbench/commit/e5ef2c08488a35d88163f7e3fe66ec054491daf8) | 2026-09-20 22:21:15 | 仅恢复提示词参考文件的 UTF-8 BOM；不视为产品能力变化。 |

## 未独立合并的 PR

关闭不等于合并；被组合吸收的实现按组合合并日记录，其余候选不当作主线已完成。

| PR | 状态 | 处理 |
|---|---|---|
| [#2](https://github.com/wmy5555/zhixu-learning-workbench/pull/2) Bump pnpm/action-setup from f40ffcd9367d9f12939873eb1018b921a783ffaa to b906affcce14559ad1aafd4ab0e942779e9f58b1 | open | 未合并候选，不列已完成主线更新 |
| [#3](https://github.com/wmy5555/zhixu-learning-workbench/pull/3) Bump actions/setup-node from 4.4.0 to 7.0.0 | open | 未合并候选，不列已完成主线更新 |
| [#4](https://github.com/wmy5555/zhixu-learning-workbench/pull/4) Bump actions/checkout from 4.4.0 to 7.0.1 | open | 未合并候选，不列已完成主线更新 |
| [#5](https://github.com/wmy5555/zhixu-learning-workbench/pull/5) chore(deps): bump zod from 3.25.76 to 4.6.6 | open | 未合并候选，不列已完成主线更新 |
| [#13](https://github.com/wmy5555/zhixu-learning-workbench/pull/13) chore(deps): bump @modelcontextprotocol/sdk from 1.31.0 to 1.32.0 in the compatible-dependencies group across 1 directory | closed | 未合并候选，不列已完成主线更新 |
| [#47](https://github.com/wmy5555/zhixu-learning-workbench/pull/47) feat: build Android personal test app and guarded file exchange | open | 未合并候选，不列已完成主线更新 |
| [#53](https://github.com/wmy5555/zhixu-learning-workbench/pull/53) chore(deps): bump the compatible-dependencies group across 1 directory with 4 updates | open | 未合并候选，不列已完成主线更新 |
| [#55](https://github.com/wmy5555/zhixu-learning-workbench/pull/55) Android：加入逐次授权的 AI、研究与输出 | open | 未合并候选，不列已完成主线更新 |
| [#66](https://github.com/wmy5555/zhixu-learning-workbench/pull/66) Preserve full history text through authenticated local incremental import | open | 实现由 #71 吸收，按组合合并日归档 |
| [#67](https://github.com/wmy5555/zhixu-learning-workbench/pull/67) feat(android): add source reconciliation and private atomic journal | open | 未合并候选，不列已完成主线更新 |
| [#68](https://github.com/wmy5555/zhixu-learning-workbench/pull/68) iOS: isolated source and recovery preview with native storage contracts | open | 未合并候选，不列已完成主线更新 |
| [#69](https://github.com/wmy5555/zhixu-learning-workbench/pull/69) 修复设置、备份恢复与外部调用的中断一致性 | closed | 实现由 #77 吸收，按组合合并日归档 |
| [#73](https://github.com/wmy5555/zhixu-learning-workbench/pull/73) feat: 第一层附件、原文插图与本地 Word 提取 | closed | 实现由 #77 吸收，按组合合并日归档 |
| [#74](https://github.com/wmy5555/zhixu-learning-workbench/pull/74) 资料编辑、收集与导入预览统一支持 Markdown 双模式 | closed | 实现由 #77 吸收，按组合合并日归档 |
| [#75](https://github.com/wmy5555/zhixu-learning-workbench/pull/75) feat(android): align phase-five candidate with stable web snapshot | open | 未合并候选，不列已完成主线更新 |
| [#76](https://github.com/wmy5555/zhixu-learning-workbench/pull/76) 取消资料外发分类，按主动 AI 操作使用必要内容 | closed | 实现由 #77 吸收，按组合合并日归档 |
| [#83](https://github.com/wmy5555/zhixu-learning-workbench/pull/83) fix: 修正网页编辑重复历史并折叠版本属性 | open | 实现由 #87 吸收，按组合合并日归档 |
| [#85](https://github.com/wmy5555/zhixu-learning-workbench/pull/85) fix: test current connection settings and auto-save verified configuration | open | 实现由 #87 吸收，按组合合并日归档 |
| [#88](https://github.com/wmy5555/zhixu-learning-workbench/pull/88) feat: 自动更新公开模型价格并冻结调用计价快照 | open | 未合并候选，不列已完成主线更新 |
| [#89](https://github.com/wmy5555/zhixu-learning-workbench/pull/89) fix: 补齐 ChatGPT 导入资料日期、当前标题与完整链接 | open | #91 明确排除；有本地部署记载，准确上线日期未核齐，未列主线更新 |

## 日志逐条来源

序号为同一天从上到下的条目次序。日期已由上表元数据核对；日志末尾的相关修改提供简短入口，这里保留细粒度映射。

### 2026-10-18
- 第 1 条：[#91](https://github.com/wmy5555/zhixu-learning-workbench/pull/91)
- 第 2 条：[#91](https://github.com/wmy5555/zhixu-learning-workbench/pull/91)
- 第 3 条：[#91](https://github.com/wmy5555/zhixu-learning-workbench/pull/91)
- 第 4 条：[#91](https://github.com/wmy5555/zhixu-learning-workbench/pull/91)
- 第 5 条：[#91](https://github.com/wmy5555/zhixu-learning-workbench/pull/91)
- 第 6 条：[#91](https://github.com/wmy5555/zhixu-learning-workbench/pull/91)
- 第 7 条：[#91](https://github.com/wmy5555/zhixu-learning-workbench/pull/91)
- 第 8 条：[#91](https://github.com/wmy5555/zhixu-learning-workbench/pull/91)
- 第 9 条：[#91](https://github.com/wmy5555/zhixu-learning-workbench/pull/91)

### 2026-10-17
- 第 1 条：[#87](https://github.com/wmy5555/zhixu-learning-workbench/pull/87)
- 第 2 条：[#87](https://github.com/wmy5555/zhixu-learning-workbench/pull/87)
- 第 3 条：[#87](https://github.com/wmy5555/zhixu-learning-workbench/pull/87)
- 第 4 条：[#81](https://github.com/wmy5555/zhixu-learning-workbench/pull/81)
- 第 5 条：[#81](https://github.com/wmy5555/zhixu-learning-workbench/pull/81)
- 第 6 条：[#87](https://github.com/wmy5555/zhixu-learning-workbench/pull/87)
- 第 7 条：[#87](https://github.com/wmy5555/zhixu-learning-workbench/pull/87)

### 2026-10-16
- 第 1 条：[#80](https://github.com/wmy5555/zhixu-learning-workbench/pull/80)
- 第 2 条：[#84](https://github.com/wmy5555/zhixu-learning-workbench/pull/84)
- 第 3 条：[#71](https://github.com/wmy5555/zhixu-learning-workbench/pull/71)
- 第 4 条：[#82](https://github.com/wmy5555/zhixu-learning-workbench/pull/82)

### 2026-10-15
- 第 1 条：[#77](https://github.com/wmy5555/zhixu-learning-workbench/pull/77)
- 第 2 条：[#77](https://github.com/wmy5555/zhixu-learning-workbench/pull/77)
- 第 3 条：[#77](https://github.com/wmy5555/zhixu-learning-workbench/pull/77)
- 第 4 条：[#77](https://github.com/wmy5555/zhixu-learning-workbench/pull/77)、[#78](https://github.com/wmy5555/zhixu-learning-workbench/pull/78)
- 第 5 条：[#77](https://github.com/wmy5555/zhixu-learning-workbench/pull/77)、[#79](https://github.com/wmy5555/zhixu-learning-workbench/pull/79)
- 第 6 条：[#77](https://github.com/wmy5555/zhixu-learning-workbench/pull/77)
- 第 7 条：[#77](https://github.com/wmy5555/zhixu-learning-workbench/pull/77)
- 第 8 条：[#79](https://github.com/wmy5555/zhixu-learning-workbench/pull/79)

### 2026-10-14
- 第 1 条：[#70](https://github.com/wmy5555/zhixu-learning-workbench/pull/70)
- 第 2 条：[#70](https://github.com/wmy5555/zhixu-learning-workbench/pull/70)
- 第 3 条：[#70](https://github.com/wmy5555/zhixu-learning-workbench/pull/70)

### 2026-10-12
- 第 1 条：[#56](https://github.com/wmy5555/zhixu-learning-workbench/pull/56)、[#61](https://github.com/wmy5555/zhixu-learning-workbench/pull/61)
- 第 2 条：[#60](https://github.com/wmy5555/zhixu-learning-workbench/pull/60)
- 第 3 条：[#58](https://github.com/wmy5555/zhixu-learning-workbench/pull/58)、[#59](https://github.com/wmy5555/zhixu-learning-workbench/pull/59)
- 第 4 条：[#62](https://github.com/wmy5555/zhixu-learning-workbench/pull/62)
- 第 5 条：[#64](https://github.com/wmy5555/zhixu-learning-workbench/pull/64)
- 第 6 条：[#51](https://github.com/wmy5555/zhixu-learning-workbench/pull/51)
- 第 7 条：[#52](https://github.com/wmy5555/zhixu-learning-workbench/pull/52)
- 第 8 条：[#57](https://github.com/wmy5555/zhixu-learning-workbench/pull/57)

### 2026-10-07
- 第 1 条（自动标题）：[#50](https://github.com/wmy5555/zhixu-learning-workbench/pull/50)
- 第 2 条（外部工具接入）：[#48](https://github.com/wmy5555/zhixu-learning-workbench/pull/48)
- 第 3 条（资料收集）：[#49](https://github.com/wmy5555/zhixu-learning-workbench/pull/49)
- 第 4 条（Android 原文样机）：[#48](https://github.com/wmy5555/zhixu-learning-workbench/pull/48)

### 2026-10-05
- 第 1 条（资料保存）：[#46](https://github.com/wmy5555/zhixu-learning-workbench/pull/46)
- 第 2 条（拆解与核验）：[#43](https://github.com/wmy5555/zhixu-learning-workbench/pull/43)
- 第 3 条（今日清单）：[#46](https://github.com/wmy5555/zhixu-learning-workbench/pull/46)
- 第 4 条（用量设置）：[#43](https://github.com/wmy5555/zhixu-learning-workbench/pull/43)
- 第 5 条（事实核验）：[#43](https://github.com/wmy5555/zhixu-learning-workbench/pull/43)
- 第 6 条（逻辑图）：[#43](https://github.com/wmy5555/zhixu-learning-workbench/pull/43)

### 2026-10-04
- 第 1 条（结构分析）：[#35](https://github.com/wmy5555/zhixu-learning-workbench/pull/35)
- 第 2 条（知识编辑）：[#45](https://github.com/wmy5555/zhixu-learning-workbench/pull/45)
- 第 3 条（新手练习）：[#37](https://github.com/wmy5555/zhixu-learning-workbench/pull/37)
- 第 4 条（资料结构图）：[#35](https://github.com/wmy5555/zhixu-learning-workbench/pull/35)
- 第 5 条（资料结构图）：[#38](https://github.com/wmy5555/zhixu-learning-workbench/pull/38)
- 第 6 条（任务错误）：[#35](https://github.com/wmy5555/zhixu-learning-workbench/pull/35)
- 第 7 条（查找关联）：[#36](https://github.com/wmy5555/zhixu-learning-workbench/pull/36)
- 第 8 条（新手引导）：[#39](https://github.com/wmy5555/zhixu-learning-workbench/pull/39)
- 第 9 条（知识建议）：[#40](https://github.com/wmy5555/zhixu-learning-workbench/pull/40)
- 第 10 条（停用知识）：[#41](https://github.com/wmy5555/zhixu-learning-workbench/pull/41)
- 第 11 条（待核验提醒）：[#42](https://github.com/wmy5555/zhixu-learning-workbench/pull/42)
- 第 12 条（知识编辑表单）：[#44](https://github.com/wmy5555/zhixu-learning-workbench/pull/44)

### 2026-10-03
- 第 1 条（新手引导）：[#28](https://github.com/wmy5555/zhixu-learning-workbench/pull/28)
- 第 2 条（AI 拆解）：[#31](https://github.com/wmy5555/zhixu-learning-workbench/pull/31)
- 第 3 条（原始资料）：[#32](https://github.com/wmy5555/zhixu-learning-workbench/pull/32)
- 第 4 条（ChatGPT 接入）：[#22](https://github.com/wmy5555/zhixu-learning-workbench/pull/22)
- 第 5 条（学习目标）：[#30](https://github.com/wmy5555/zhixu-learning-workbench/pull/30)
- 第 6 条（拆解进度）：[#31](https://github.com/wmy5555/zhixu-learning-workbench/pull/31)
- 第 7 条（重复拆解提示）：[#33](https://github.com/wmy5555/zhixu-learning-workbench/pull/33)
- 第 8 条（结构图阅读）：[#34](https://github.com/wmy5555/zhixu-learning-workbench/pull/34)
- 第 9 条（引导实操检查）：[#27](https://github.com/wmy5555/zhixu-learning-workbench/pull/27)
- 第 10 条（原文阅读引导）：[#26](https://github.com/wmy5555/zhixu-learning-workbench/pull/26)
- 第 11 条（引导定位）：[#29](https://github.com/wmy5555/zhixu-learning-workbench/pull/29)

### 2026-10-02
- 第 1 条（新手引导）：[#17](https://github.com/wmy5555/zhixu-learning-workbench/pull/17)
- 第 2 条（调用记录）：[#21](https://github.com/wmy5555/zhixu-learning-workbench/pull/21)
- 第 3 条（快速收集）：[#25](https://github.com/wmy5555/zhixu-learning-workbench/pull/25)
- 第 4 条（新手引导）：[#20](https://github.com/wmy5555/zhixu-learning-workbench/pull/20)
- 第 5 条（用量与费用）：[#21](https://github.com/wmy5555/zhixu-learning-workbench/pull/21)
- 第 6 条（左侧导航）：[#23](https://github.com/wmy5555/zhixu-learning-workbench/pull/23)
- 第 7 条（窄屏引导）：[#24](https://github.com/wmy5555/zhixu-learning-workbench/pull/24)
- 第 8 条（引导进度）：[#18](https://github.com/wmy5555/zhixu-learning-workbench/pull/18)
- 第 9 条（操作定位）：[#19](https://github.com/wmy5555/zhixu-learning-workbench/pull/19)
- 第 10 条（复习引导）：[#20](https://github.com/wmy5555/zhixu-learning-workbench/pull/20)

### 2026-09-30
- 第 1 条（新手实操）：[#15](https://github.com/wmy5555/zhixu-learning-workbench/pull/15)
- 第 2 条（练习进度）：[#15](https://github.com/wmy5555/zhixu-learning-workbench/pull/15)
- 第 3 条（多标签页）：[#15](https://github.com/wmy5555/zhixu-learning-workbench/pull/15)
- 第 4 条（确认窗口）：[#15](https://github.com/wmy5555/zhixu-learning-workbench/pull/15)

### 2026-09-29
- 第 1 条（复习结算）：[#14](https://github.com/wmy5555/zhixu-learning-workbench/pull/14)
- 第 2 条（资料与研究）：[#14](https://github.com/wmy5555/zhixu-learning-workbench/pull/14)
- 第 3 条（主题学习）：[#14](https://github.com/wmy5555/zhixu-learning-workbench/pull/14)
- 第 4 条（学习与知识状态）：[#14](https://github.com/wmy5555/zhixu-learning-workbench/pull/14)
- 第 5 条（知识关联）：[#14](https://github.com/wmy5555/zhixu-learning-workbench/pull/14)
- 第 6 条（资料库同步）：[#14](https://github.com/wmy5555/zhixu-learning-workbench/pull/14)

### 2026-09-21
- 第 1 条（Windows 启动）：[#7](https://github.com/wmy5555/zhixu-learning-workbench/pull/7)
- 第 2 条（全屏布局）：[#8](https://github.com/wmy5555/zhixu-learning-workbench/pull/8)
- 第 3 条（操作按钮）：[#12](https://github.com/wmy5555/zhixu-learning-workbench/pull/12)
- 第 4 条（联网核验）：[#11](https://github.com/wmy5555/zhixu-learning-workbench/pull/11)
- 第 5 条（外观）：[#9](https://github.com/wmy5555/zhixu-learning-workbench/pull/9)
- 第 6 条（使用指南）：[#10](https://github.com/wmy5555/zhixu-learning-workbench/pull/10)

### 2026-09-20
- 第 1 条（本地工作台）：[5bd47b0](https://github.com/wmy5555/zhixu-learning-workbench/commit/5bd47b0b682319582ee7b3778d9590e71b0e5048)
- 第 2 条（外部能力）：[5bd47b0](https://github.com/wmy5555/zhixu-learning-workbench/commit/5bd47b0b682319582ee7b3778d9590e71b0e5048)
- 第 3 条（资料管理）：[5bd47b0](https://github.com/wmy5555/zhixu-learning-workbench/commit/5bd47b0b682319582ee7b3778d9590e71b0e5048)
- 第 4 条（Windows 使用）：[5bd47b0](https://github.com/wmy5555/zhixu-learning-workbench/commit/5bd47b0b682319582ee7b3778d9590e71b0e5048)

## 日期与状态纠正依据

- 原 CHANGELOG 的 Unreleased、开发日期和待发布记录不直接视为发布历史。Android 第二阶段原标 10 月 7 日，实际 #51 于 10 月 12 日合并；#43/#46 的 UTC 10 月 4 日合并应归北京时间 10 月 5 日；#26/#27/#28 的 UTC 10 月 2 日合并应归北京时间 10 月 3 日。
- #71 曾以 10 月 12／13／14 日记开发阶段，实际合并为 10 月 16 日；#83/#85 通过 #87 于 10 月 17 日进入主线；#81 实际合并为 10 月 17 日。
- #91 中原文阅读和上传提示曾标 10 月 17 日，集中合并日为 10 月 18 日。其旧正文仍写 Draft／未部署，合并事实以元数据及主线提交为准。最终全屏行为按批次修订保留独立浮层，不沿用早期“整个抽屉铺满”描述。

## 保留的验证与覆盖边界

- 本记录完整覆盖截至上述 SHA 的 main 可达提交和全部可见 PR 列表，不宣称涵盖已删除／不可访问历史、尚未提交的本地文件、所有独立分支的每次中间提交，或 9 月 20 日之前在仓库外进行的开发。未合并候选已全部列出，不能当作无改动。
- PR 列表与提交树能证明代码归属，不能证明首次部署时间或用户最终验收。#89 是明确的本地部署但未合并例外，其他本地部署细节也未在本次完整重查。
- 初始开发版已有不少功能；源码上传日只是最早可证仓库基线，不据此推断这些能力都在当天首次开发。
- Android #48/#51/#52 保留真实手机、软件键盘、旋转、签名升级等未验收边界；网页后续修改不自动代表已进入 Android。#47 为独立未合并方案。
- #22/#64/#71 的接收能力有合成和协议测试，真实网页、独立发送器及云端插件完整联动不由这些测试替代。
- #77 的 PDF 灰屏未认定修复，支持附件保存不等于所有内置预览均已通过；保留下载原件回退方案。
- 真实模型的教学、事实判断和关联质量不由受控模型测试证明；早期功能按当时证据描述，不宣称今天重新完成全部验收。
- #64/#71/#77 的独立安全报告缺口仍按原 PR 留痕；#81/#87/#91 有绑定候选的正式完成回执，报告正文可读性缺口不被“合并”替代。#91 旧代码审查摘要与后续 Esc 修复记录存在版本差别，本次不宣称重做了审查闭环。
- 历史核验阶段只读取仓库元数据、日志、相关改动和使用说明，未读取本机凭据，未运行产品测试；本次文档整理通过独立草稿 PR 供审阅，不直接修改主分支。原 CHANGELOG 完整保存在 [历史存档](../CHANGELOG.legacy-2026-10-18.md)，保留候选记录和原始证据措辞；该存档是历史快照，不表示其中的待发布、私有仓库等旧状态现在仍成立。

## 维护约定

- 每个北京时间自然日只设一个日期标题，最新在前；只保留有内容的“问题修复、功能变化、体验优化”。
- 每项先写位置，再写具体变化；同日重复修改合并描述，必要时保留风险或待验证说明。
- 先查更新日志关键词，再查看相关 PR／提交，确有需要才读对应代码。日志不替代源码和测试证据。
- 不把分支计划、PR 创建或一次测试写成完成；来源日期有误时保留更正依据，避免静默改写历史。
