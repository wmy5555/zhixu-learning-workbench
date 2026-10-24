<!-- README UI 原型 C，仅供比较；不替换正式 README，不加入许可证、图片或图片徽章。 -->

# 知序学习工作台

把收集的资料，变成自己的理解，再用到下一次学习、写作和决策中。

知序是一个本地优先的中文个人学习工作台。你可以保存原文、整理知识、练习与复习，并带着来源检索和输出；AI 按需参与，资料和学习记录保存在自己的电脑上。

**开发预览 v0.1.0 · 本地运行 · 中文界面与文档**


## 按目的找到入口

| 现在想做什么 | 直接进入 |
| --- | --- |
| 第一次运行知序 | [安装与运行](#安装与运行) |
| 跟着材料体验学习 | [新手引导](docs/ONBOARDING.md) |
| 查找某个操作 | [使用指南](public/guide.html) |
| 设置模型、搜索或向量 | [服务配置](docs/PROVIDERS.md) |
| 理解保存、外发与费用 | [AI 与隐私](#ai-与隐私) |
| 查看近期变化与项目检查 | [更新记录](CHANGELOG.md) · [CI 检查](https://github.com/wmy5555/zhixu-learning-workbench/actions/workflows/ci.yml) |

## 目录

- [功能一览](#功能一览)
- [安装与运行](#安装与运行)
- [学习流程](#学习流程)
- [AI 与隐私](#ai-与隐私)
- [当前状态](#当前状态)
- [开发与贡献](#开发与贡献)

## 功能一览

适合希望把读书摘录、网页材料、课程笔记和 AI 对话持续消化，而不只是收藏起来的个人学习者。

| 你想做的事 | 知序提供的帮助 |
| --- | --- |
| 留住原文与出处 | 粘贴文字、导入 UTF-8 文本或 Markdown，保留来源，随时回看原文。 |
| 整理值得学习的内容 | 按需用 AI 拆解概念、主张、方法与问题；主动联网核验时保留证据、分歧和适用条件。 |
| 练习并安排复习 | 组织学习主题，亲自作答，记录反馈与修正，按计划复习。 |
| 形成自己的理解 | 将自己的回答、AI 建议和最终确认的理解分别保存。 |
| 重新找到并使用知识 | 本地检索、来源回看、引用输出；可选接入向量检索与 MCP。 |
| 管理自己的资料 | 内容以 Markdown 保存，学习与任务记录存入 SQLite，支持 Obsidian 外部编辑和备份恢复。 |

原始资料、结构化材料和个人理解分别保留。保存一篇资料，不等于已经学会；AI 生成的答案也不会自动成为你已确认的个人理解。

## 安装与运行

需要 **Node.js 24** 和 **pnpm 11.19.0**。网页版直接运行，无需构建。

<details>
<summary>获取并运行</summary>

已下载仓库的读者可直接进入项目目录；使用 Git 获取项目时运行：

```sh
git clone https://github.com/wmy5555/zhixu-learning-workbench.git
cd zhixu-learning-workbench
npm install --global pnpm@11.19.0
pnpm install --frozen-lockfile
pnpm start
```

打开 [http://127.0.0.1:4318](http://127.0.0.1:4318)。服务默认仅监听本机回环地址。

</details>

<details>
<summary>Windows 脚本入口</summary>

安装 Node.js 24 后，也可以在项目目录中依次双击：

1. `install.cmd`：安装锁定依赖，首次使用或依赖更新后运行。
2. `start.cmd`：后台启动服务并打开浏览器。
3. `stop.cmd`：需要停止后台服务时运行。

关闭浏览器不会停止后台服务；电脑关机或休眠时不保证执行复习调度。

</details>

<details>
<summary>第一次打开</summary>

先检查资料文件夹、时区和每日学习时间，再保存一小段自己的材料。没有模型密钥也可以收集、编辑、本地查找、手动整理，并保留自己的回答与笔记。

需要 AI 时，在设置中配置相应服务。Linux/macOS 保存供应商凭据前需设置私有的 `LEARNING_MASTER_KEY`，详见 [.env.example](.env.example)。应用不会自动加载 `.env`；已自行配置该文件时可显式运行：

```sh
node --env-file=.env src/server.mjs
```

</details>

## 学习流程

1. **收集**：保存一段原文，并补充出处。
2. **整理**：按需运行 AI 拆解，阅读结果；需要核验时，主动检索并查看证据和限制。
3. **选择**：决定留作参考、暂存候选，还是加入学习安排。
4. **学习**：自己解释或作答，阅读反馈，再确认自己的理解。
5. **复习与应用**：回到到期知识，修正误解；检索材料并带着引用形成输出。

想跟着操作，可以从今日页或帮助入口开始新手引导。引导在独立练习库中进行；教程中的 AI 请求仍使用真实服务与预算，可能产生费用。完整步骤见 [新手实操说明](docs/ONBOARDING.md)。

## AI 与隐私

- **本地保存**：资料与学习记录保存在本机。不要把 `.data/`、`vault/`、`.env`、凭据或个人备份上传到公共仓库。
- **按需启用**：模型、搜索、网页读取和向量能力分别配置。主动使用 AI 功能时，会向所配置的服务发送完成该操作所需的内容；联网核验还需搜索和网页读取能力。
- **费用可查**：连接测试与模型调用可能收费。可查看用量、设置请求上限与预算；缺失用量或单价时，费用保留为未知。
- **外部访问单独授权**：MCP 与 ChatGPT 接入默认关闭，需主动启用。允许 ChatGPT 读取知识后，内容会进入 ChatGPT 上下文，详见 [ChatGPT 连接说明](docs/CHATGPT_MCP.md)。

更多说明：[文件、隐私与备份](docs/DATA.md) · [服务配置](docs/PROVIDERS.md) · [用量与费用](docs/USAGE.md)

## 当前状态

当前为 **v0.1.0 开发预览版**，主要面向本机单用户使用。本 README 介绍本地网页版；具体功能覆盖与验收边界以 [需求覆盖](docs/COVERAGE.md) 和 [测试记录](docs/TEST_RESULTS.md) 为准。

本地测试和受控模拟不能代表你的供应商已经接通。真实资料的联网核验、语义检索和教学反馈质量仍需单独验收。

当前维护中文 README，不提供尚未完成的英文版链接。版本变化见 [CHANGELOG](CHANGELOG.md)。

## 开发与贡献

| 想了解什么 | 从这里开始 |
| --- | --- |
| 日常使用与排障 | [使用指南](public/guide.html)、[新手引导](docs/ONBOARDING.md) |
| 数据、文件与恢复 | [数据说明](docs/DATA.md)、[附件说明](docs/SOURCE_FILES.md) |
| 模型、搜索与外部工具 | [服务配置](docs/PROVIDERS.md)、[MCP](docs/MCP.md)、[ChatGPT 接入](docs/CHATGPT_MCP.md) |
| 代码结构与接口 | [架构说明](docs/ARCHITECTURE.md) |
| 功能边界与验收证据 | [需求覆盖](docs/COVERAGE.md)、[测试记录](docs/TEST_RESULTS.md) |
| 版本与维护流程 | [更新记录](CHANGELOG.md)、[维护说明](docs/MAINTENANCE.md) |

<details>
<summary>技术栈与验证命令</summary>

主要技术栈：Node.js 24、ESM、原生 HTML/CSS/JavaScript、Markdown 与 SQLite。

在项目目录运行：

```sh
pnpm check
pnpm test
pnpm quality
```

完整验证入口与运行依赖审计：

```sh
pnpm verify
pnpm audit --prod --audit-level high
```

`verify` 依次运行仓库检查、全部测试和本地检索质量检查。日常修改按影响范围选择检查，PR 与合并遵循项目规则。Linux/macOS 的加密测试使用临时随机主密钥，不复用真实凭据。

</details>

欢迎通过 [Issue](https://github.com/wmy5555/zhixu-learning-workbench/issues) 反馈问题或提出建议。描述实际现象、复现步骤和期望结果即可；示例请使用合成资料，移除个人内容与凭据。

提交代码前请阅读 [贡献指南](CONTRIBUTING.md) 和 [维护说明](docs/MAINTENANCE.md)；AI Agent 还需遵循 [AGENTS.md](AGENTS.md)。

1. 获取仓库，在最新 `main` 上创建聚焦单一问题的分支。
2. 完成修改，按影响范围验证，并补充必要的文档与更新记录。
3. 推送分支，按项目约定提交 Pull Request；维护 Agent 遵循北京时间每日 02:00 的集中 PR 节奏。

发现安全问题，请按 [安全报告说明](SECURITY.md) 处理，不在公开 Issue 中粘贴敏感信息。
