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
- 句柄耗尽后的合成恢复现场触发了保守启动保护；保留该现场，不清库假装恢复通过。CI 同时提供独立 release 与开发 debug APK，用标准 run-as 读取本任务全合成测试库的诊断；不启用设备 root，不改变其他 App。最终交付与设备回装使用 release APK，debug 不作为交付包。
- 现场归档 SHA256 d0d009108c5798d7f2abdb7d4fa9f1c485a927899a578034868161529e4fc853。诊断为 staging 阶段仅写入 2828/10000 个 incoming，没有事务提交标记或 previous 文件；原 1000 条数据库和磁盘逐项一致、无未知或改写文件。完整归档后可逆移至本候选 no_backup/zhixu-synthetic-recovery-20261023，原始资料未删除；这不是自动恢复验收通过，未削弱原有启动保护。
- 原生按钮自动保存期间可能暂时禁用。设备脚本要等待可点击且 enabled 的祖先，保存后等“阅读”页面；正文/标题仍在输入框可见不能作为保存成功依据。已修正用例等待，不为首版重复全套测试。
- 当前 Expo Android 的 Material 字体图标在实际独立包里显示为空。原生标签改用随模块打包的自绘矢量 drawable，并明确普通/选中颜色和全部标签；不依赖异步字体转位图。用户要求优先首个可用版本，停止万条压力测试，剩余性能与实体设备/真实供应商验收另行推进。
- 首版 cd746c031ee0887380fab0ee76df4f0a29a48035 已通过 CI39939771940 并实际安装；最终 APK SHA256 d22c58f11dbe299423ba8f60db9b434155261fe418852f75fbe6c79818824551。非 debuggable，沿用开发签名，未发布应用商店。五个导航图标/标签可见，升级前编辑的合成笔记保留。
- 基本收集/阅读/编辑保存、系统返回未保存确认、继续编辑/放弃、重启保留已经实际操作通过；输入法开启时第一下 Back 先关输入法，下一下才触发页面返回。最终图标改动复用此前有效业务验证，只补安装和显示确认。真实 AI、实体手机、万条性能与自动中断恢复没有宣称通过；两项构建依赖 high 告警仍在。
- PowerShell ConvertTo-Json 输出的新验收 JSON 需显式保存为 LF；本仓库 diff --check 将未归一的 CRLF 识别为行末空白。只归一新文件，不全库格式化。

## Android 组合原型落地（2026-10-23）

- 用户已明确授权依托 D 组合原型开始正式 Android 实现，并要求实际使用 Emil skills 修正细节。保留原 iOS 页面文件，Android 使用 .android.tsx；五个页面对应及具体原则见 apps/mobile/ANDROID_UI.md。没有更改正式 4318 或业务数据存储、网络/授权机制。
- 安全区放在 Android 主导航外壳，不让大标题直接进入状态栏。主页面始终由左上角知序打开侧栏；全部次级功能保留真实入口。系统返回先关闭原生 Modal 侧栏，详情仍走既有原生 Stack 与未保存保护。
- 已安装 Expo 58 的 JS Tabs 不是旧 React Navigation 签名：BottomTabBarProps 是 emitter/navigateToTab，不是 navigation；initialRouteName 已不接受，首页由 index 路由确定。以真实 installed types/source 为准，不能只复制旧示例。
- Reanimated CSS 动效的曲线需 cubicBezier(...) 对象，不接受 CSS cubic-bezier 字符串；RN0.88 原生 ref 用 React.ComponentRef<typeof View>。只对 transform/opacity 动画，未对列表或 Tab 页面加 slide。
- 图标用本地原创 SVG + 已安装 expo-image，不再依赖 Material 字体异步转图。无新增依赖，避免扩大打包和安全审计范围。
- 原型的示例学习数据不能照搬。Today使用真实计划；Study优先当前已读历史页的未结束会话，再使用真实今日pending，统计来自已读服务字段。
- 收集/应用草稿hydration和离开flush保留。输出提交在await保存前固定完整请求快照，旧请求结果与错误不能覆盖后来输入；3个延迟Promise用例与2个原文保存回归共5项通过。Typecheck/lint、85模块native检查通过，后续只按新增问题补验证。
- Android versionCode递增至2，版本名仍0.1.0；沿用独立包名与签名，不卸载主App、不清数据。APK构建和设备结果另补，不能把本地通过当作原生交付。

- Android 实测中，Hermes 的 month+weekday Intl 格式呈现不自然的“周五(月:十月)”。首页日期改用服务端年月日组合为“10 月 · 周五”。ADB pull 的绝对中文目录在本机失败，设备证据改用候选工作目录下的 ASCII 相对路径；先检查拉取回执再解析 XML。

## Android 随身书桌交付完成（2026-10-23）

- 最终构建 a8620aa67b90a4f4b7a966d37e6ca791eb5e210c，CI39976191509成功；交付 exports/android-native/20261023-ui-a8620aa。APK SHA256 4ce2114cddffea304b3d62e9ed9ee825950d7f974205e7a6fdf53d9d8d5cfb5e，开发签名、非debuggable、versionCode2，旧版可覆盖安装。
- Android15模拟器已实际查看五页/侧栏，导入保存中文合成文本、阅读、未保存返回与放弃、旧资料及重启后保留通过。深浅、系统关动画、130%字体走查；未测实体手机帧率、真实AI及完整业务回归。38c5d10流程结果只在日期修改未影响部分复用，最终包另核对日期/安装/资料保留。详见 docs/ANDROID_UI_ACCEPTANCE.md。
- UIAutomator快照可能早于异步资料读取或动画后的跳转；等待真实目标控件和保存后的阅读正文，不能把输入框文字当回执。字体比例调整会重建Activity并回到今日，不能等待旧路由标题误报界面失败。
- 已恢复模拟器原来的字体、动画、显示旋转及浅色外观，关闭本任务启动的实例3。所有截图均为合成资料；没有读取或打包真实库。依赖未改，之前移动端2项high未解除；不提前PR或合并。
