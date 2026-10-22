# 知序 iOS · 原生源码候选

本工程以正式 4318 的固定版本重建，采用 Expo 58 + React Native 0.88、Expo Router 与原生 SwiftUI 控件。旧 iOS 实现没有复用。界面不加载桌面网页，也不要求电脑服务在线。

当前交付是**可移交的源码候选**。Windows 已完成业务契约检查和 Hermes 导出；Swift 模块没有经过 Xcode 编译，iPhone/iPad 没有真机验收。存在未解除的依赖高危公告，不能据此宣称可以发布。

## 打开工程

需要 Node.js 24 和 pnpm 11.19.0。请先进入本目录；本地 pnpm-workspace.yaml 用于阻止安装命令误进入仓库根工作区。

```sh
npx pnpm@11.19.0 install --frozen-lockfile --ignore-scripts
npx pnpm@11.19.0 typecheck
npx pnpm@11.19.0 lint
npx pnpm@11.19.0 check
npx pnpm@11.19.0 test
npx pnpm@11.19.0 export
```

自定义 Swift 模块不在 Expo Go 内，必须使用 development build。拿到 Mac、Xcode 后，在本目录运行：

```sh
npx expo prebuild --platform ios
npx expo run:ios
```

首次编译需要解决 Xcode/CocoaPods 的实际诊断并重新验收。不要手改生成的 ios/；改 app.json、config plugin 或 modules/ 后重新生成。Windows 上 prebuild 明确拒绝生成 iOS 工程，当前没有 .xcodeproj、签名包或 IPA。

应用标识暂定 com.zhixu.learning；设备签名时应核对所有者的团队、证书和标识。eas.json 只提供配置，没有创建云端项目、付费构建、提交 TestFlight 或发布。发版前还要补齐正式图标、隐私披露和签名。

## 使用

底部为今日、收集、知识库、学习、输出。设置从今日进入。资料保存在 App 私有目录，模型/搜索/向量服务默认沿用原业务的显式启用、测试、预算和调用恢复规则。没有预置任何真实凭据或个人数据。

进入后台时保存已注册草稿并暂停任务；返回前台可继续本地调度。中断或未知费用须在任务/调用恢复中核对，不能把重启当作自动重发许可。iOS 不提供桌面的常驻服务或 stdio MCP。

电脑协作通过知序完整备份文件完成：手机和电脑分别保留本地库，先预览再确认恢复。**不是增量双向同步**，不要用过时备份覆盖新修改。凭据及设备草稿不随应用备份导出。资料目录排除系统自动云备份，卸载前须自行导出已保存资料；Keychain 主密钥为设备专属。

详见 [迁移与验收](MIGRATION.md)、[技能来源](skills-used.json)、[依赖审计](dependency-audit-summary.json)、[第三方许可](THIRD_PARTY_NOTICES.md)。
