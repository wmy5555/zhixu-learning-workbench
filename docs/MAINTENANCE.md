# 维护与发布

## 最小维护系统

使用 main + 短期分支 + PR。主分支变更运行 CI；PR 运行同样检查；每周定时运行以发现新增依赖风险；Dependabot 每周提出 npm/pnpm 和 GitHub Actions 更新，不自动合并。

`pnpm-workspace.yaml` 禁止 pnpm 在运行脚本前隐式重装依赖。安装始终显式执行 `pnpm install --frozen-lockfile`；CI 使用干净环境重新安装，而本机验证不会擅自替换正在使用的依赖目录。

必需检查名称：`Quality (ubuntu-latest)`、`Quality (windows-latest)`、`Secrets`、`Dependencies`。Quality 使用 Node 24、固定 pnpm、锁定依赖，运行仓库检查、全部 Node 测试和小型中文检索质量检查。Linux 临时加密密钥仅用于合成测试。电脑端没有构建/类型系统，因此不设置虚假的构建/类型检查。

Android 共用界面样机另有 `Android build and lint` 检查，使用 JDK 21、Android SDK 36 和固定 Gradle Wrapper，构建应用及本项目设备测试 APK 并执行 lint。涉及样机的 PR 还需此项通过；设备测试 APK 构建成功不等于已在模拟器执行。首次功能交付的视觉和真实点击结果须单独记录，参见 [Android 共用界面](ANDROID_SHARED_UI.md)。

Android 网页基线按所有者要求固定在 `apps/android/web/`，清单见 `apps/android/web-baseline.json`。不要从最新 main/public 自动更新这个快照。网页版大版本后先提交同步范围供所有者确认；只有批准后才改基线。原生功能和手机适配可独立继续。手动 Android workflow 的 `upgrade_baseline` 仅在需要覆盖安装验收时开启，固定第一阶段源码与新 APK 共享本次临时 debug 签名，不上传密钥，不移动旧标签，不作为正式发布签名。

CI 文件不等于服务器端合并保护。Branch protection 是否可用取决于 GitHub 套餐和仓库可见性；不为启用功能擅自变更可见性或付费升级。若服务器不支持，维护 Agent 仍须等待四项检查全部通过，且明确说明不是强制阻断。

2026-09-20 实际配置 main 保护时，GitHub 返回 403，当时私有仓库的套餐不支持此功能。2026-10-02 已核对仓库为 Public，所有者确认公开是其本人决定。旧的套餐限制仅是历史记录；公开状态本身不能证明已启用保护，当前规则须另行读取验证，不能将四项 CI 通过误报为服务器强制保护已完成。

## 跨任务交接

交接只写接收任务需要的目标、已核实证据及其未覆盖范围、依赖或阻塞、下一步动作。接收方开始或恢复工作时，重新阅读当前 `AGENTS.md` 和相关维护规则，并核对任务归属、最新状态与当前分支；旧状态摘要不能代替现行规则或最新证据。

任务责任仍属于原任务负责人。收到进展、错误或待办不等于接管相关或无关工作；只有明确分派的范围才进入接收方任务，结果回报给原负责人。

Android 的独立实验进展、错误和待办留在 Android 任务及其 dot 汇报中。只有明确影响共享接口，或 Web 任务确实需要知道资源可用性时，才向 Web 任务交接对应事实和动作。同步脚本属于维护/协作工作；除非明确纳入产品范围，不将它写成 Web 产品需求。

交接不授予长期权限。一次任务的额度授权或自定义确认只在原授权范围内有效，不复制成项目长期规则；接收方按当前任务授权和项目边界执行。

## 云端审查的使用时机

为减少开发期间的重复审查，关闭 Codex 仓库设置中的 **Automatic review** 和 **Auto security review**，保留 GitHub 连接与手动审查能力。维护 Agent 根据 [AGENTS.md 的按需触发规则](../AGENTS.md#按需触发云端审查) 自动判断并发评论，你无需每次手动输入。

实质改动准备完成、必要本地检查通过并推送候选提交后，Agent 发起一次代码审查；权限、凭据、资料外发、不可信文件和备份恢复等安全相关改动再加安全审查。纯文案和局部样式调整可跳过。每个 PR 每类默认一轮初审，必要时一轮针对修复的复审；发送前读取现有请求与结果，避免重复或相互触发。仍未解决的问题需记录并继续定向处理，不能因额度上限而宣称通过。

这是执行 Agent 的项目约定，并非无人值守的 GitHub 自动化；没有 Agent 正在维护 PR 时，规则不会自行发评论。评论仍会消耗额度，范围说明也不保证固定成本；四项 CI 和合并前反馈核对继续执行。完整安全报告可能包含未达到 GitHub 显示门槛的发现，不能用“没有评论”代替验收。

官方说明：[项目指令加载](https://learn.chatgpt.com/docs/agent-configuration/agents-md)、[GitHub 手动审查](https://learn.chatgpt.com/docs/third-party/github)、[安全审查与报告门槛](https://learn.chatgpt.com/docs/security/security-review)。

## 发布 0.x 开发预览

1. 用独立 PR 调整 `package.json` 版本并在 CHANGELOG 新增对应版本及日期。修复为 patch，新能力或 0.x 不兼容变化为 minor；不自动升 1.0。
2. PR 合并且 main CI 通过后，在 Actions 手动运行 **Release preview**（main 分支）。此操作由维护 Agent 代办即可。
3. 工作流重新运行完整 CI，检查 main 没有前移、版本和更新说明有效，然后创建不可覆写的 `v0.x.x` tag 与 GitHub 预发布说明。源码下载由 GitHub 自动提供，不打包用户资料。
4. 必须实际查看 Release 页面和工作流成功状态后才声称发布完成。失败时先核对 tag/release 是否已部分创建，不盲目重跑或删除 tag。

若 tag 已创建但 Release 失败：确认 tag 指向该次通过验证的 commit，使用同一 tag 补建 Release（`gh release create --verify-tag`），不移动 tag。已发布的错误通过下一 patch 修正；代码回滚用 revert PR，学习数据另行从备份恢复。

当前发布工作流只支持 0.x.x 且标记为预发布，稳定 1.0 的标准与流程需另行评审。

## 仓库设置与权限

建议 squash 合并、自动删除已合并分支、禁用 force push 与删除 main、要求讨论解决和上述四项检查；单维护者不要求自己无法完成的第二人审批。普通 CI token 只读；仅发布 job 有 contents write。不使用 `pull_request_target` 执行外部 PR 代码。

Actions/Dependabot 可自动检查和提议更新，但许可证选择、公开私有内容、生产 Secret 轮换、不可逆数据操作、套餐付费仍由所有者决定。项目不新增第三方 Agent Skill，现有工具与仓库规则足以覆盖当前流程。

