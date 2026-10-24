# 依赖安全修复交接

## 2026-10-24 · 先修复依赖，再合并 README

- 用户已明确授权全部依赖告警修复及继续合并 README #99，并要求告知产品影响。分支 `fix/dependency-remediation-20261024` 基于 main 6a8f633，与 README 独立；未操作版本发布候选 #100 或正式服务。
- 固定 Zod 4.6.6；覆盖 Hono 4.13.11、body-parser 2.4.0、ip-address 10.7.4、fast-uri 3.1.9、Mammoth 的 argparse 2.0.1、Xcode 的 uuid 11.1.1。旧 `fix/dependency-alerts-20261022` 尚未合并，仍含 Zod 3，本分支覆盖其相关修复并解决新高危；保留旧分支，不重写其历史。
- 实际源码改动只为 `z.record(z.string(), z.string())`；保留提示词字符串字典语义、未知字段处理、默认值、布尔严格类型、原文及 MCP 权限。已告知用户新版本会拒绝超安全整数和不规范 UUID；系统生成的随机 UUID 与正常设置兼容。英文无效输入细节可能不同。
- 根工作区有大量未提交内容，README 原型基稿还有用户删句，均不能覆盖或暂存。正式依赖 PR 不带入原型、README 改稿、应用版本或界面/移动端变更。
- 本机 fallback pnpm 实际为 11.25.0，即使 packageManager 固定也不保证自动切换。初次 frozen 基线安装没有改锁；正式解析/生成与检查改用临时缓存的 `npx --yes pnpm@11.19.0`，不改全局工具或配置。
- 独立跑 `chatgpt-structure-import.test.mjs` 前必须建立空 `.tmp` 父目录。首次 126 项中 12 项因此失败；补目录只重跑相应文件与新增回归，16/16 通过。后补安全整数/UUID 两项 2/2 通过，共 130 个不同定向用例通过。
- Xcode UUID 控制测试需要先建立内存中的空已解析 project.hash，不能对未解析对象直接调用 generateUuid 并误判依赖回归。Mammoth 的 argparse 2 保留命令行别名，`--help` 和现有 DOCX 读取回归通过。
- 完整审计 9→0，生产 high 门禁通过；源码/锁文件/配置检查 421 个跟踪文件通过。GitHub 页面原先的 3 条 open（含撤回的 sprintf-js）要等修复实际进入默认分支后读回，不能手动隐藏告警来充当修复。
- 已完成一轮只读调查及一轮独立候选源码复核，无具体问题；云端 code/security 与当前 PR/main CI 尚待实际回执。之后先合并本依赖 PR，再将 main 衔接进 README #99，保留双方说明文档再完成其检查和合并。两个分支都新增 HANDOFF，合并时注意保留两项记录，不能选择一边整份覆盖。
