# 参与维护

当前仓库已由所有者确认公开，但尚未选择项目开源许可证；公开可见不等于已获再使用授权。添加或更改许可证仍由所有者明确决定。

先读 [README](README.md)、[架构](docs/ARCHITECTURE.md) 和 [Agent 指令](AGENTS.md)。Node.js 24 和 pnpm 版本要求见 `package.json`；安装使用 `pnpm install --frozen-lockfile`。本地服务 `pnpm start`，无需编译。

## 一次修改

1. 从最新 main 建立隔离工作目录和目的明确的 `feat/xxx`、`fix/xxx` 或 `chore/xxx` 分支；保留现有工作目录未提交内容。
2. 修改聚焦一个问题。Bug 修复优先增加会在修复前失败的回归测试；不同时重排整个文件。
3. 将新增文件暂存。按改动范围验证：局部文案/文档核对内容与相关检查，局部行为修复跑能发现回归的定向测试及必要仓库检查；跨模块、数据或权限行为变更运行 `pnpm verify`。依赖变更另运行 `pnpm audit --prod --audit-level high`；未改依赖时核对本次 PR 的 Dependencies CI。Linux/macOS 加密测试使用临时随机 `LEARNING_MASTER_KEY`，参见 `.env.example`。不要使用真实 Vault、密钥或供应商调用做 CI 测试。
4. 更新相关文档及 CHANGELOG 的 Unreleased。提交和推送分支，按模板开 PR。
5. 最新提交四项 CI 均通过、会话讨论解决后合并，优先 squash。重大依赖更新独立 PR，不自动合并 Dependabot。

Web/Node 部分没有 TypeScript 或打包流程；Android 样机有独立构建与 lint 检查，涉及它时也须通过，详见[维护说明](docs/MAINTENANCE.md)。`pnpm check` 检查 JavaScript 语法、JSON/YAML、锁文件、冲突标记、上传边界和 Actions SHA 固定；不是完整语义 lint。遵循现有局部风格和 `.editorconfig`。

不要对 main force push。撤销已合并改动使用 revert PR；恢复代码不等于恢复学习数据，数据恢复请读 [DATA](docs/DATA.md)。发现泄露按 [SECURITY](SECURITY.md) 处理，不在公开 Issue 粘贴凭据。

非编程使用者只需描述“哪里出错、希望什么结果”，维护 Agent 应负责分支、测试和 PR，并用简明报告交付。配置或发布需所有者权限的步骤，应明确指出所需的最小操作。
