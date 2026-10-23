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
- Expo 58 独立 Android 包曾出现全局 router 未绑定：原生标签正常，但保存后 router.push 报 first render。组件导航改用 useRouter 所绑定的上下文；不能因 Hermes 导出、APK 启动成功就跳过实际页面跳转验收。
- CI 的模块测试 APK 使用每个运行器生成的调试签名，升级可能签名不兼容。先归档证据，只替换本任务测试包；主 App 数据和旧 App 保留。MuMu 的 adb 曾在打印 Failure 后返回 0，安装与 instrumentation 必须读实际 Success/OK 及失败计数。
- UiAutomator 应通过 content-desc 查找未选中的 NativeTabs，不能假定所有标签都有可见文字；长表单需要实际滚动。By.desc 接受 Pattern，2.3 版没有 By.descMatches。
- 连续处理队列时仅首轮调用 tick，后续调用 runJobs；每次都 tick 会重复推进发现调度，可能重建刚失败的发现任务。
- 空库启动不能证明已迁移 SQLite：检索首次同步会用 iterate 和 lastInsertRowid；Expo 分别提供 getEachSync 和 lastInsertRowId，必须适配，保留游标提前退出时的释放。设备用例首次重启暴露此缺口，已增加实际索引重建的契约回归。
- 文件 stat 不能只返回 size：补齐 Date、inode、设备号与纳秒修改/状态时间，防止同长度改动被扫描缓存误认为未变化。Android API 27 起提供 StructTimespec，低版本保留明确秒级回退。
- 恢复确认对话框会暂时隐藏后面的预览，不能以“预览文本消失”断言已恢复并立刻杀进程。等待实际提交回执“已恢复 N 条资料”，再重启、检查库内数据；早期大库失败日志未完成该验收，不能当作性能结果。
- Android 自动化曾在保存后显示旧标题；实际键盘输入可正常保存。保留键盘文字事件、字段读回和输入截图，不能只凭旧标题断言输入事件丢失。草稿加载完前不开放收集与作答输入，避免恢复数据覆盖新输入。
- Android 15 实测系统返回直接离开 Activity，JS 未收到返回事件，未保存保护也无法执行。React Native 当前的预测返回兼容缺口有同样的上游复现（https://github.com/react/react-native/issues/58407）；关闭 predictiveBackGestureEnabled，保留普通系统返回与未保存确认。以后重开必须在 API 33-35 真正验收，不能用 Android 16 结果代替。
- 模拟器接硬键盘时输入框并不一定弹出软键盘。测试只能在 mInputShown=true 时用返回关闭键盘，否则会执行真实页面返回。系统返回缺口与这个测试假设叠加，早期旧标题日志不能用于断言表单丢字；已用实际 ASCII/中文输入读回和原文检索核对。
- 恢复预览须显示资料、版本、附件数量及将改变的服务配置，并明确外部能力关闭规则；“预览通过”一行不能代替可核对的恢复范围。
- UiAutomation.executeShellCommand 不是完整 shell：给 input text 包单引号会把引号也输入字段。测试先限制合成 ASCII 字符，空格编码为 %s，再直接传参数；不套用 PowerShell/终端的引用规则。实际失败字段读回确认过两端的单引号。
- 万条合成恢复在 Android 15 出现 SIGABRT，原文为 `Could not make wake event fd: Too many open files`。Android 的 FileInputStream/FileOutputStream(FileDescriptor) 不取得描述符所有权；流 use/close 后仍须在 finally 显式 Os.close。新增 200 次读写后的句柄数量回归，不能靠增大系统上限掩盖泄漏。
- 旧版 1000 条冷启动实测 14905ms，恢复流程 21913ms。Android 增加只读原生扫描批次，每个文件仍执行路径与 O_NOFOLLOW 校验，预读正文总量最多 32MiB，超预算和读取失败走原有逐文件校验；增量指纹与完整哈希复核规则保留，写入/恢复操作不使用该读取结果缓存。iOS/Node 保留旧扫描路径。
- 检索 n-gram 先去重再做 UTF-8 十六进制编码，避免 Hermes 为重复片段反复创建 Buffer；编码后仍去重，保留未配对代理字符的原有编码语义。基线、改善后性能与实体手机验收须分别报告。
- 旧列表计时在点击并等待空闲之后开始，18ms 不能表示打开知识库耗时。新用例在点击前计时；保留旧记录但不能把它用作性能结论。根目录 Dependencies 不覆盖 apps/mobile 的独立依赖审计，日批须核对移动端审计和未解除告警。
