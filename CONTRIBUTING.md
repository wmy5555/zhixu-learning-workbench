# 参与维护

当前仓库为私有开发项目，尚未授予开源许可证。公开协作前由所有者决定授权方式。

先读 [README](README.md)、[架构](docs/ARCHITECTURE.md) 和 [Agent 指令](AGENTS.md)。Node.js 24 和 pnpm 版本要求见 `package.json`；安装使用 `pnpm install --frozen-lockfile`。本地服务 `pnpm start`，无需编译。

## 一次修改

1. 更新本地 main，从它建立目的明确的 `feat/xxx`、`fix/xxx` 或 `chore/xxx` 分支。
2. 修改聚焦一个问题。Bug 修复优先增加会在修复前失败的回归测试；不同时重排整个文件。
3. 将新增文件暂存，运行 `pnpm verify` 和 `pnpm audit --prod --audit-level high`。Linux/macOS 加密测试需要临时随机 `LEARNING_MASTER_KEY`，参见 `.env.example`。不要使用真实 Vault、密钥或供应商调用做 CI 测试。
4. 更新相关文档及 CHANGELOG 的 Unreleased。提交和推送分支，按模板开 PR。
5. 最新提交四项 CI 均通过、会话讨论解决后合并，优先 squash。重大依赖更新独立 PR，不自动合并 Dependabot。

本项目没有 TypeScript 或打包流程。`pnpm check` 检查 JavaScript 语法、JSON/YAML、锁文件、冲突标记、上传边界和 Actions SHA 固定；不是完整语义 lint。遵循现有局部风格和 `.editorconfig`。

不要对 main force push。撤销已合并改动使用 revert PR；恢复代码不等于恢复学习数据，数据恢复请读 [DATA](docs/DATA.md)。发现泄露按 [SECURITY](SECURITY.md) 处理，不在公开 Issue 粘贴凭据。

非编程使用者只需描述“哪里出错、希望什么结果”，维护 Agent 应负责分支、测试和 PR，并用简明报告交付。配置或发布需所有者权限的步骤，应明确指出所需的最小操作。
