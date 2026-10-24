# 知序学习工作台

把收集的资料，变成自己的理解，再用到下一次学习、写作和决策中。

知序是一个本地优先的中文个人学习工作台。你可以保存原文、整理知识、练习与复习，并带着来源检索和输出；AI 按需参与，资料和学习记录保存在自己的电脑上。

**开发预览 v0.1.0 · 本地运行 · 中文界面与文档**

[跟着做一遍](docs/ONBOARDING.md) · [快速开始](#快速开始) · [文档](#文档) · [更新记录](CHANGELOG.md) · [CI 检查](https://github.com/wmy5555/zhixu-learning-workbench/actions/workflows/ci.yml)

## 一条资料的旅程

### 01 · 收集

保存原文与出处。读书摘录、课程笔记、网页材料和 AI 对话先留在原始资料中，随时可以回看。

### 02 · 整理

按需让 AI 拆解概念、主张、方法和问题。主动联网核验时，阅读证据、分歧与适用条件，再决定哪些内容值得继续学习。

### 03 · 选择

只需未来查找的材料留作参考，尚未决定的内容进入候选；希望消化的知识再加入学习安排。

### 04 · 理解

亲自解释和作答，记录反馈与修正，再确认自己的理解。自己的回答、AI 建议和最终确认内容分别保存。

### 05 · 复习与应用

回到到期知识，修正误解。需要写作、推进项目或做决策时，检索材料、回看来源，再带着引用形成输出。

想跟着操作，可以从今日页或帮助入口开始新手引导。引导在独立练习库中进行；教程中的 AI 请求仍使用真实服务与预算，可能产生费用。完整步骤见 [新手实操说明](docs/ONBOARDING.md)。

## 三种内容，各有位置

| 保存什么 | 留住什么 |
| --- | --- |
| 原始资料 | 实际收到的原文、出处与上下文。 |
| 结构化材料 | 拆解得到的概念、主张、方法与问题，连同证据和限制。 |
| 个人理解 | 你自己的解释、应用与最终确认内容。 |

保存不代表学会，AI 生成也不代表你已经理解。不是每条材料都需要进入学习队列。

## 快速开始

需要 **Node.js 24** 和 **pnpm 11.19.0**。本 README 面向本机运行的网页版，直接启动，无需构建。

### 获取并运行

使用 Git 获取项目：

```sh
git clone https://github.com/wmy5555/zhixu-learning-workbench.git
cd zhixu-learning-workbench
```

已下载仓库的读者直接进入项目目录，再安装依赖并启动：

```sh
npm install --global pnpm@11.19.0
pnpm install --frozen-lockfile
pnpm start
```

打开 [http://127.0.0.1:4318](http://127.0.0.1:4318)。服务默认仅监听本机回环地址。

### Windows 脚本入口

安装 Node.js 24 后，也可以在项目目录中双击：

| 文件 | 什么时候用 |
| --- | --- |
| `install.cmd` | 首次使用或依赖更新后，安装锁定依赖。 |
| `start.cmd` | 后台启动服务并打开浏览器。 |
| `stop.cmd` | 需要停止后台服务时。 |

关闭浏览器不会停止后台服务。电脑关机或休眠时不保证执行复习调度，重新启动后补算今日安排。启动诊断与性能口径见 [启动说明](docs/STARTUP_PERFORMANCE.md)。

### 第一次打开

先检查资料文件夹、时区和每日学习时间，再保存一小段自己的材料。没有模型密钥也可以收集、编辑、本地查找、手动整理，并保留自己的回答与笔记。

需要 AI 时，在设置中配置相应服务。Linux/macOS 保存供应商凭据前需设置私有的 `LEARNING_MASTER_KEY`，详见 [.env.example](.env.example)。应用不会自动加载 `.env`；已自行配置该文件时可显式运行：

```sh
node --env-file=.env src/server.mjs
```

## 更多能力

| 想做什么 | 从这里了解 |
| --- | --- |
| 用自己的笔记工具管理资料 | 内容以 Markdown 保存，学习与任务记录存入 SQLite；支持 Obsidian 外部编辑与备份恢复。见 [数据说明](docs/DATA.md)。 |
| 保存附件、阅读和编辑原文 | 支持图片、PDF 和 Word 原件；DOCX 可在本机提取有限范围的文字，核对后再主动提交 AI。格式边界见 [附件说明](docs/SOURCE_FILES.md)，编辑方式见 [编辑器说明](docs/MARKDOWN_EDITOR.md)。 |
| 重新找到需要的知识 | 本地检索与来源回看，可选配置向量检索。检索范围、诊断与容量记录见 [检索说明](docs/SEARCH.md)。 |
| 从 ChatGPT 收集会话 | 按授权保存实际传入的会话原文，整理摘要单独标明。连接与历史读取的要求见 [ChatGPT 接入](docs/CHATGPT_MCP.md) 和 [同步边界](docs/CHATGPT_SYNC.md)。 |
| 让其他工具访问知识 | 主动启用 MCP，并按所选接口授权。连接要求与实测范围见 [MCP 说明](docs/MCP.md)。 |

外观、阅读、学习条件、任务恢复等操作见 [使用指南](public/guide.html)。

## AI 与隐私

- **本地保存**：资料与学习记录保存在本机。不要把 `.data/`、`vault/`、`.env`、凭据或个人备份上传到公共仓库。
- **按需配置**：模型、搜索、网页读取和向量能力分别配置。使用 AI 功能时，会向所配置的服务发送完成该操作所需的内容；联网核验还需搜索和网页读取能力。配置方法见 [服务说明](docs/PROVIDERS.md)。
- **费用可查**：连接测试与模型调用可能收费。可查看用量、设置请求上限与预算；缺失用量或单价时，费用保留为未知。见 [用量与费用](docs/USAGE.md)。
- **外部访问单独授权**：MCP 与 ChatGPT 接入默认关闭，需主动启用。允许 ChatGPT 读取知识后，内容会进入 ChatGPT 上下文；本地测试通过不代表你的账户已经连接。

备份、恢复与外部编辑的边界见 [数据说明](docs/DATA.md)。

## 当前状态

当前为 **v0.1.0 开发预览版**，主要面向本机单用户使用。具体功能覆盖与验收边界以 [需求覆盖](docs/COVERAGE.md) 和 [测试记录](docs/TEST_RESULTS.md) 为准。

本地测试和受控模拟不能代表你的供应商已经接通。真实资料的联网核验、语义检索和教学反馈质量仍需单独验收。

## 文档

| 想了解什么 | 文档入口 |
| --- | --- |
| 日常使用与排障 | [使用指南](public/guide.html)、[新手引导](docs/ONBOARDING.md) |
| 资料、文件与编辑 | [数据说明](docs/DATA.md)、[附件说明](docs/SOURCE_FILES.md)、[编辑器说明](docs/MARKDOWN_EDITOR.md) |
| 模型、搜索与费用 | [服务配置](docs/PROVIDERS.md)、[检索说明](docs/SEARCH.md)、[用量与费用](docs/USAGE.md) |
| 外部工具连接 | [MCP](docs/MCP.md)、[ChatGPT 接入](docs/CHATGPT_MCP.md)、[会话同步边界](docs/CHATGPT_SYNC.md) |
| 启动与运行 | [启动诊断与性能](docs/STARTUP_PERFORMANCE.md) |
| 功能边界与验收证据 | [需求覆盖](docs/COVERAGE.md)、[测试记录](docs/TEST_RESULTS.md)、[待办事项](docs/TODO.md) |
| 版本与维护 | [更新记录](CHANGELOG.md)、[维护说明](docs/MAINTENANCE.md)、[公开审计记录](docs/PUBLIC_RELEASE_AUDIT.md)、[第三方资产来源](docs/DEPENDENCY_LICENSES.md) |

<details>
<summary>开发参考与历史记录</summary>

- [架构与接口](docs/ARCHITECTURE.md)
- [产品目标与施工计划](docs/BUILD_PLAN_v1.md)
- [2026-09-29 设计对齐记录](docs/DESIGN_ALIGNMENT_2026-09-29.md)
- [Android 历史样机说明](docs/ANDROID_SHARED_UI.md)：保留历史基线，不作为当前移动端路线或设备验收的承诺。

</details>

## 参与贡献

欢迎通过 [Issue](https://github.com/wmy5555/zhixu-learning-workbench/issues) 反馈问题或提出建议。描述实际现象、复现步骤和期望结果即可；示例请使用合成资料，移除个人内容与凭据。

提交修改前请阅读 [贡献指南](CONTRIBUTING.md) 和 [维护说明](docs/MAINTENANCE.md)；AI Agent 还需遵循 [AGENTS.md](AGENTS.md)。从最新 `main` 创建聚焦单一问题的分支，按影响范围验证并补充文档，再按项目约定提交 Pull Request。

主要技术栈为 Node.js 24、ESM、原生 HTML/CSS/JavaScript、Markdown 与 SQLite。完整验证与运行依赖审计入口：

```sh
pnpm verify
pnpm audit --prod --audit-level high
```

`verify` 依次运行仓库检查、全部测试和本地检索质量检查。日常修改按影响范围选择必要检查，PR 与合并遵循项目规则；Linux/macOS 的加密测试使用临时随机主密钥，不复用真实凭据。

发现安全问题，请按 [安全报告说明](SECURITY.md) 处理，不在公开 Issue 中粘贴敏感信息。
