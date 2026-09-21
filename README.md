# 知序 · 个人学习工作台

[![CI](https://github.com/wmy5555/zhixu-learning-workbench/actions/workflows/ci.yml/badge.svg)](https://github.com/wmy5555/zhixu-learning-workbench/actions/workflows/ci.yml)

当前版本 **0.1.0 开发预览**。仓库保持私有，尚未选择开源许可证；暂不授予再分发授权。

首次公开前检查见 [Public Release Audit](docs/PUBLIC_RELEASE_AUDIT.md) 和 [第三方许可证清单](docs/DEPENDENCY_LICENSES.md)。完成审计不自动授权公开；须另行确认许可证和 Public 操作。

本地运行的中文 Web 应用。原始资料、知识、个人理解和错题修正保存为 Markdown；学习记录与任务保存到 SQLite。支持 Obsidian 外部编辑、来源追踪、独立配置的模型/搜索/向量服务和真实 MCP。

**当前状态：可运行开发版。** 本地数据流程、权限与 MCP 已实测；你尚未配置真实模型、搜索或嵌入凭据，所以联网核验质量、语义检索质量和真实教学反馈仍待验收。没有把模拟结果当作在线成功。详见 [测试结果](docs/TEST_RESULTS.md) 和 [需求覆盖](docs/COVERAGE.md)。

## 在这台 Windows 电脑使用

1. 双击 `start.cmd`，浏览器打开 `http://127.0.0.1:4318`。程序会在后台运行。
2. 在「系统」检查 Vault、每日时间和时区。默认采用本次会话时区 `Asia/Singapore`，可改为 `Asia/Shanghai`。
3. 到「收集与加工」粘贴文字或导入 UTF-8 `.txt` / `.md`。默认只存本机。
4. 无密钥时，可编辑、查找、手工整理个人观点、建立主题、主动加入学习、保留自己的回答和笔记。AI 批改会等待，不伪造评价。
5. 需要 AI 时，在「系统」填写供应商地址、模型和密钥并测试连接；再单独允许具体资料外发。联网研究还需搜索和网页读取两项能力。
6. 双击 `stop.cmd` 停止由启动脚本启动的后台服务。关闭网页不会停止后台调度；关机或休眠时不保证执行，重启后补算今日安排。

换电脑需 Node.js 24，双击 `install.cmd` 安装锁定依赖；无需安装 Codex。本地缓存运行时只是已有环境的兼容入口。

### 日夜模式与强调色

左上角 Logo 右侧可切换日夜模式，首次跟随系统；手动选择保存在当前浏览器。深色主底色采用 `#111111`，取自 2026-09-21 实测的 [Recall Roadmap](https://docs.recall.it/recall-roadmap) 深色页面，卡片仍使用稍亮的灰色保持层次。

「系统 → 外观」提供强调色预设、取色器、颜色代码、日夜预览及恢复默认。点击保存后应用；为保持可读性，系统会调整颜色亮度。配色不影响资料、凭据或 AI 设置。

### 窗口与全屏

工作台内容随窗口宽度伸展，宽屏与全屏时利用侧栏以外的可用空间；缩小窗口后沿用移动端布局。刷新页面即可加载更新样式，无需重启服务。

### 启动速度与排查

关闭网页后服务仍在后台运行，再次双击快捷方式会先确认本机服务就绪，直接交给默认浏览器打开。仅在服务未运行时查找 Node 并启动；不会为了加速自动设置开机启动。桌面快捷方式继续指向 `start.ps1`，无需重建。

需要定位延迟时可运行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -Timing`。输出的 `ReadyMs` 为脚本开始到服务可用，`BrowserDispatchMs` 为调用默认浏览器的耗时，二者都**不代表浏览器已完成首屏显示**，也不包含 PowerShell 自身加载时间。`-NoBrowser` 仅取消打开浏览器，服务未运行时仍会启动服务；`-Port` 可指定端口，默认读取 `PORT`，未设置时为 4318。

测试结果和一秒目标的适用范围见 [启动性能说明](docs/STARTUP_PERFORMANCE.md)。

## 开发者快速开始

安装 Node.js 24 和 `package.json` 指定的 pnpm 11.19.0，在项目目录运行：

```sh
npm install --global pnpm@11.19.0
pnpm install --frozen-lockfile
pnpm start
```

浏览器打开 `http://127.0.0.1:4318`。Linux/macOS 要保存供应商凭据，需先设置私有的 `LEARNING_MASTER_KEY`，参见 [.env.example](.env.example)；应用不自动加载 `.env`，显式加载可运行 `node --env-file=.env src/server.mjs`。没有供应商凭据也能使用本地资料功能。

```sh
pnpm verify
pnpm audit --prod --audit-level high
```

`verify` 运行语法/配置/上传边界检查、全部测试和本地中文检索检查。Linux/macOS 加密测试需临时随机主密钥，勿使用真实密钥。测试仅在 `.tmp/` 创建合成数据。项目无需构建，无 TypeScript 类型检查；真实模型和联网质量须单独验收。

参与修改请读 [CONTRIBUTING](CONTRIBUTING.md)；AI Agent 先读 [AGENTS](AGENTS.md)。版本、PR、自动检查和发布步骤见 [维护说明](docs/MAINTENANCE.md)，版本变化见 [CHANGELOG](CHANGELOG.md)，漏洞报告见 [SECURITY](SECURITY.md)。

## 怎样试用一条完整流程

在系统页导入明确标识的演示资料（不会自动创建个人掌握记录）→知识库打开「演示知识」→写明理由加入学习→今日生成清单→先阅读，再隐藏原文自己解释→回答落盘，等待配置后的真实 AI 反馈→用自己的语言确认个人理解。原始回答、AI 建议和最终确认分别保存。

真实资料：保存原文→允许外发并运行 AI 拆解（默认不联网核验；可勾选执行，或生成后在资料详情手动点击「联网检验并找反例」）→查看拆解与待核验标记；主动核验后查看保存的网页正文摘录、支持/反对/限制和研究结论→决定留作参考、候选或主动学习→练习、复习、检索和输出。输出草稿不会自动进入个人知识层。

## 文档

- [新手使用指南](public/guide.html)：运行后点击 Web 左下角的「?」，或访问 `/guide.html`。涵盖首次体验、资料加工、学习复习、检索输出、能力设置和备份排障。单独打开时提供顶部知序 Logo、固定目录与指南全文搜索；搜索在浏览器本地完成，支持正文、表格和折叠问答，点击结果直接定位。窄屏通过菜单展开目录，弹窗内仍保留原布局。
- [架构与接口](docs/ARCHITECTURE.md)
- [接入模型、搜索与向量](docs/PROVIDERS.md)
- [MCP 连接与实测说明](docs/MCP.md)
- [文件、隐私与备份恢复](docs/DATA.md)
- [需求覆盖与未完成验收](docs/COVERAGE.md)
- [测试结果](docs/TEST_RESULTS.md)

请勿把 `.data`、`vault` 或导出的个人备份上传到公共代码仓库。默认忽略这些目录。第三方 API 可能收费，应用默认全部关闭；费用不可获得时显示未知。只读本地 MCP 也默认关闭，需在 Web 设置中主动启用。
