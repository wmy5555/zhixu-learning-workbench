# 知序原生移动端

Expo 58 + React Native 0.88，共用 iOS 候选的业务核心、原生界面与数据契约。Android 使用 Kotlin 文件/密钥/网络模块和 Jetpack Compose 控件；iOS 保留 Swift 模块与 SwiftUI 控件。没有 WebView、桌面网页服务器或对电脑 4318 的运行依赖。

这是独立原生候选。Android 应用标识为 `com.zhixu.learning.nativeapp`，可与旧 Android 并存。没有覆盖旧 App、导入个人数据、修改或重启正式 4318。源码基线与复用来源见 [android-baseline.json](android-baseline.json)。

## 开发和构建

进入 apps/mobile，使用 Node.js 24、pnpm 11.19.0。Android 本机构建还需 Java 21 和 SDK 37。

```sh
npx pnpm@11.19.0 install --frozen-lockfile --ignore-scripts
npx pnpm@11.19.0 typecheck
npx pnpm@11.19.0 lint
npx pnpm@11.19.0 check
npx pnpm@11.19.0 test
npx pnpm@11.19.0 export
npx pnpm@11.19.0 prebuild:android
cd android
./gradlew :app:assembleRelease :zhixu-runtime:testDebugUnitTest :app:lintRelease
```

Windows 用 gradlew.bat。原生工程由 Expo 生成；配置修改放在 app.json、plugins 或 modules，不手改生成的 android/、ios/。生成器采用临时调试签名构建试用 APK，正式发布须由所有者提供签名方案。不要把该密钥用于应用商店发布。

共用源码仍可在 Mac 生成 iOS；原 iOS 证据保留在 ios-source-verification.json、ios-source-migration.md，它们不是本轮 Android 验收结果。自定义模块不在 Expo Go 内，须用开发构建或独立 APK。

## 数据和使用

今日、收集、知识库、学习与应用为主要入口。模型、搜索和嵌入仍需本人配置与测试；资料外发和预算规则沿用 4318。默认没有真实凭据、测试资料或自动付费调用。

Android 原文、SQLite 和草稿保存在 noBackupFilesDir；凭据由 Android Keystore 的设备密钥加密。系统云备份和设备搬迁均排除资料。卸载前先主动导出完整备份；便携备份不含凭据与设备草稿。

手机和电脑通过备份文件交换，先预览再确认恢复。这不是增量双向同步。桌面 stdio MCP、ChatGPT 桌面管道、Obsidian 外部目录监听仍在电脑运行。

构建、设备、在线供应商和性能结果分别记录在 [迁移与验收](MIGRATION.md)。依赖审计的未解除告警不可视为发布通过。
