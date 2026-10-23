# Android 原生迁移交接

工作分支 feat/android-native-20261023；共用 App 位于 apps/mobile。正式 4318 保持运行，基线 7aa1d780 与 iOS 5d233be 的迁移基线一致。快照和源码复用证据见 apps/mobile/android-baseline.json。

- 分享链接 /s/ 只显示一条分享回答。历史读取器不接受此格式；已通过 Chrome 读到末尾，不能声称读取了未提供的完整历史分支。
- iOS 现有候选可复用业务核心和界面，但不是已验收 App；保留原报告为 ios-source-*，不能冒充 Android 验收。
- Expo 模块生成器 add-platform-support 在 Windows 创建空目录后停滞。本任务停止了该生成器，并依据已安装 Expo 58 API 补齐模块，未改生成的 Android App 工程。
- Expo CLI 可能调用 PATH 中的 pnpm；pnpm 11 的 storeDir 放在 pnpm-workspace.yaml，旧 .npmrc 配置未生效。不要改全局 store 或手改锁文件。
- Android 也必须经 Metro 显式解析 .native.js；否则 Node 内置模块会进入 Hermes。原生代码编译和设备验收不能被 JS 导出代替。
- Android 使用独立包名 com.zhixu.learning.nativeapp。不要卸载旧 App 或清空设备数据。所有测试仅用随机合成目录与合成凭据。
- 原生调用取消可能先于异步 request 注册，需保留有界的早到取消。完整响应已收到后应保留回执，不能因迟到取消丢失计费证据。
- 原始 Kotlin 模块自带文件/Keystore 设备测试和固定 IP 网络 JVM 测试；未执行项目无关全量回归。实际结果继续更新 MIGRATION.md。
- 不提前创建 PR、不合并；日批需代码与安全审查。两项构建依赖 high 公告未解除前不可称可发布。
- Android public Os API 使用 remove，不能照搬隐藏的 unlink/rmdir；OkHttp 4.12 的 Kotlin Dns 不是 fun interface，需要显式 object。首轮 CI39906090806 因这两项失败，已定向修复。
- Gradle 同时编译独立包与模块设备测试时默认 512MB metaspace 不足，保留诊断并使用本任务 3GB heap/1GB metaspace、2 workers。启用构建缓存，不关闭 lint 或隐藏问题。
- 移动端不能只调用一次 runJobs 后结束：每个前台批次处理后释放串行队列，再继续有进展的 queued 项；进入后台阻止下一项外发。waiting/failed/未知费用仍须人工决定，不能自动重试。
- 保存文本不能移除包含 pendingFile 的整个设备草稿，也不能清除排队期间新输入；当前保存只消费实际提交的文本。
- 大库夹具只有合成原文。LibraryBenchmarkTest 需显式 syntheticBenchmark=true，且仅对本任务新安装的可丢弃候选库运行，禁止用于用户已有资料。
