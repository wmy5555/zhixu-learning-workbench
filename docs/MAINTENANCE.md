# 维护与发布

## 最小维护系统

使用 main + 短期分支 + PR。主分支变更运行 CI；PR 运行同样检查；每周定时运行以发现新增依赖风险；Dependabot 每周提出 npm/pnpm 和 GitHub Actions 更新，不自动合并。

`pnpm-workspace.yaml` 禁止 pnpm 在运行脚本前隐式重装依赖。安装始终显式执行 `pnpm install --frozen-lockfile`；CI 使用干净环境重新安装，而本机验证不会擅自替换正在使用的依赖目录。

必需检查名称：`Quality (ubuntu-latest)`、`Quality (windows-latest)`、`Secrets`、`Dependencies`。Quality 使用 Node 24、固定 pnpm、锁定依赖，运行仓库检查、全部 Node 测试和小型中文检索质量检查。Linux 临时加密密钥仅用于合成测试。电脑端没有构建/类型系统，因此不设置虚假的构建/类型检查。

Android 共用界面样机另有 `Android build and lint` 检查，使用 JDK 21、Android SDK 36 和固定 Gradle Wrapper，构建应用及本项目设备测试 APK 并执行 lint。涉及样机的 PR 还需此项通过；设备测试 APK 构建成功不等于已在模拟器执行。首次功能交付的视觉和真实点击结果须单独记录，参见 [Android 共用界面](ANDROID_SHARED_UI.md)。

CI 文件不等于服务器端合并保护。Branch protection 是否可用取决于 GitHub 套餐和仓库可见性；不为启用功能擅自变更可见性或付费升级。若服务器不支持，维护 Agent 仍须等待四项检查全部通过，且明确说明不是强制阻断。

2026-09-20 实际配置 main 保护时，GitHub 返回 403，当时私有仓库的套餐不支持此功能。2026-10-02 已核对仓库为 Public，所有者确认公开是其本人决定。旧的套餐限制仅是历史记录；公开状态本身不能证明已启用保护，当前规则须另行读取验证，不能将四项 CI 通过误报为服务器强制保护已完成。

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
