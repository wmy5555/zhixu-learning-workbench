# 知序 iOS：分阶段实现与验收

iOS 使用 Capacitor 8.5.2、原生 HTML/CSS/JS 和独立 Swift 存储。当前是原文阶段的开发候选，**不是与网页版功能完全对齐的已验收 App**。Windows 浏览器预览使用实际阶段 UI 与明确标识的内存模拟接口；工程生成、JS 检查、原生编译和真机操作分别记录。

## 基线与独立范围

本任务基于 main `5fce54da815375583900e2fa14ef41c700dd5a52`，分支 `feat/ios-web-parity`。iOS 配置位于 `apps/ios/`，应用标识为 `io.github.wmy5555.zhixu.iospreview`。Web 页面/样式基线由 `apps/ios/web-baseline.json` 精确绑定；打包从 Git 中读取该提交，叠加明确列出的 iOS 入口，不复制正在使用的 Web 工作目录、用户库或未跟踪文件。每次生成 `ios-assets.json`，记录来源和 SHA-256。

Android 的 `apps/android/web` 与既定基线不改变，已有 Android 安装包/点击证据不作为 iOS 证据。Capacitor 不直接运行 Node HTTP、`node:sqlite` 或 Windows DPAPI；原生存储、系统文件接口和后续权限需分别实现。

## 沿用实际 Android 阶段

阶段名称来自上述基线的 [ANDROID_SHARED_UI.md“分期交付与完成标准”](ANDROID_SHARED_UI.md#分期交付与完成标准)，不增加或重排 Android 原计划。

| 原阶段 | iOS 当前目标 | 可复用与平台差异 | 完成条件与当前边界 |
|---|---|---|---|
| 1．共用界面与原文本地样机 | 原文收集、查看、文字搜索、编辑和本机存储 | Web 视觉与通用控件；Swift 私有文件与版本，替代 Node/Java 文件接口 | 断网保存、重开、冲突拒绝和工程编译；目前有源码与 Windows 预览，iOS 编译/设备仍待验 |
| 2．数据可迁移与恢复 | txt/md 草稿、来源六字段、历史、单条交换与原文备份 | 复用 source-exchange 解析器和恢复原则；UIDocumentPicker 取代 SAF | 源码已接入；XCTest 覆盖恢复/中断/幂等，执行证据仍待 macOS；真实文件提供方待验 |
| 3．手机本地学习闭环 | 今日、原答、错题、主题、独立练习与完整新手流程 | 按现有纯 JS 规则与已修复反馈迁移；独立持久运行记录 | 待接入；不以四步指南代替 Web 完整实操，不伪造离线分数或掌握度 |
| 4．AI、研究与输出 | 逐次授权、预算、任务恢复、结构、引用输出 | Android #55 仅作为有明确未验收项的候选参考；iOS 需 Keychain 与原生网络授权 | 待接入；本阶段无凭据存储、供应商请求或费用记录，不调用付费 AI 验收 |
| 5．双端同步与手机系统能力 | 明确文件交换边界，另行设计同步/通知/后台 | iOS 生命周期与后台限制不同；Web 也没有现成自动同步 | 待设计/授权相关步骤；不把文件交换称作自动同步，不同步运行中的 SQLite |
| 6．发布打磨 | 编译、Simulator、iPhone/iPad、签名与覆盖升级 | 受支持 macOS/Xcode 和 Apple 签名流程 | 未签名、未真机、未发布；不创建新长期密钥或自动选许可证 |

未完成阶段可继续不依赖缺口的源码与契约工作；测试缺失的阶段不标通过。

## 当前功能与 Web 对齐缺口

| Web 功能 | 当前 iOS 候选 | 后续验收要求 |
|---|---|---|
| 原文、标题、出处和编辑 | 原文/来源保存、空标题暂用原文片段、版本冲突、相同原文去重 | 真机逐字读回、失败草稿、重复点击与响应丢失重试 |
| 文件、历史、单条交换 | UTF-8 txt/md 先入草稿；历史恢复保留当前版本；交换使用 Web 解析规则 | 真实选择/取消/导出、来源清空、Unicode、提供方错误 |
| 备份恢复 | 独立 `zhixu-ios-source-backup` v1，原文/初始快照/历史；预览与确认、冲突保留 | 完整故障注入、重复恢复、过期预览、非空冲突、容量与未知格式 |
| 原文与 AI 提取、结构图 | 本阶段只保存原文；AI/结构/手工知识尚未接入 | 保留原文、候选、建议和确认区别；原版本失效时拒绝覆盖 |
| 完整检索/语义/关联/发现 | 只有原文列表文字过滤，不等同完整检索 | 过滤与检索质量、向量授权、有效证据和关联端点 |
| 今日/学习/反馈/错题/主题 | 待迁移，导航实际禁用 | 前置/顺序、原答、单次结算、陈旧会话、停用与异议规则 |
| 新手实操和练习库 | 待迁移，相关启动/重置禁用 | 草稿保护、切库旧返回拒绝、独立练习时间、真实完成证据 |
| AI/研究/输出/费用 | 待迁移，AI 与研究复选框禁用且不勾选 | 内容/设置版本绑定授权、未知结果不重发、预算与 nullable 价格 |
| 设置/提示词/诊断 | 目前显示阶段能力和原文备份 | 对齐学习偏好、提示词变量校验、费用、任务与存储诊断 |
| MCP/ChatGPT/Obsidian | 本阶段只提供手工原文交换；桌面能力仍在电脑 | 不冒充 iPhone stdio/桌面隧道；远程配对和授权需单独设计 |
| 自动同步/系统后台/通知 | 未实现 | Web 无现成自动同步基线；后台不保证持续执行，通知需本人授权 |

## 原文存储与恢复约定

`cache/index.sqlite3` 是可重建的派生索引，不包含不可丢弃的学习记录。损坏时从已核对 Markdown 返回原文并标记索引待修复；只重建固定缓存文件，不清空正文、历史或回执。其 XCTest 独立覆盖“损坏缓存→原文仍可读→重建→重开正文相同”。

`Application Support/zhixu-ios-sources-v1` 保存不可变 Markdown，`current.json` 只发布版本引用、历史和请求回执；原文文件内自带受限元数据和精确正文。读取核对 SHA-256，不从派生列表反向覆盖原文。文件使用 iOS complete protection，资料根目录排除系统备份；没有共享容器、iCloud entitlement 或读取电脑库的接口。

写入先完整校验并暂存不可变文件、同步目录，再原子替换发布清单。提交后同步异常只在核对本次准确候选并完成同步后确认成功，否则保持 `COMMIT_UNKNOWN`。同一意图重试保留 requestId，回执防止重复创建或恢复；不同内容不能复用同一 requestId。用户旧页面用 expectedHash，版本不符拒绝。进程中断留下的未引用文件不会成为当前资料，也不自动删除；仍计入物理容量上限。

常规文件同步后再要求 Darwin `F_FULLFSYNC`，不将普通 fsync 等同断电保证；具体设备的锁屏、杀进程和电源故障仍未验收。应用私有文件元数据及 Capacitor 自有偏好的隐私清单分别声明 C617.1、CA92.1，不读取系统或其他应用偏好。依据 [Apple 同步文档](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fsync.2.html) 与 [所需原因类别](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype)；声明不是商店审核通过。

当前最多 100 份原文、1000 个物理文档/历史版本、每份正文 128 KiB、标题 200 个 UTF-16 单元、普通来源字段 200 个 UTF-16 单元，url/locator 2048 个；完整备份 32 MiB、回执 2000 条。到限拒绝，不静默截断或删历史。iOS 包与 Android/桌面整库格式不同；未知格式明确拒绝，不能把原文包当作全部学习数据。

恢复预览仅在内存保留 5 分钟，与当前清单版本绑定；选择或预览不写入。重复身份/字段、非法 UUID、超限、损坏正文/历史和同版本不同内容均拒绝；冲突原文保留本机当前条目。确认后一次原子发布全部合并结果，不清空整个库。系统导出位置由本人选择；选择网盘可能把资料交给文件提供方，不能声称始终仅本机。

## 可复用经验与证据版本

以下是迁移依据，不是 iOS 已通过声明。

| 经验 | 已有精确证据 | iOS 适用性 |
|---|---|---|
| 同源增量/去重、人工编辑与删除保护 | ChatGPT PR #64，head `f78076e2e67cb1dd8dd4dda76c6ca6b72e4d1143`；主线 `6d3e0dd6c1da896b49ac6b3a68e17f6d9fb1c32d` | 借鉴稳定身份、预期版本和来源快照；当前普通原文幂等不等于已移植 ChatGPT 增量协议 |
| 未保存编辑关闭保护 | PR #56，`f366e650f144dff3257588148a9e119a07069918`；该版本有浏览器真实点击 | iOS 保留取消/放弃与草稿；原生手势/杀进程需另验 |
| 学习双击与不确定请求身份 | PR #60，`ea2f9e448484179f90670860119b02849a608045` | 当前原文请求保持同一未确认意图；未来学习成功后需退休旧意图，不能照搬先前缺陷 |
| 切库、旧返回与练习隔离 | 已合入本任务基线 `5fce54da815375583900e2fa14ef41c700dd5a52` 的 PR #61；Android `cb00c42f2572ddcc81e7b1a9b799bbab83b2319b` | 当前单库原文没有假称此项已迁移；阶段 3 按同一保护迁移 |
| 原子提交与恢复、已提交清理故障 | Android `cb00c42f2572ddcc81e7b1a9b799bbab83b2319b` 的 117 项设备测试；`ef6a9e4443e734fa2ada888c2dec4c3d0f9bf9d3` 的 12 项新增差异检查 | 借鉴提交点与可重试状态，改用 Swift/POSIX 原子发布；新 XCTest 不继承 Android 通过结果 |
| 清空价格不能省略、缺失账本保持 unknown | PR #55，修复 `8f303b89c279018fcd4bdffcfbd7921c8aa52998`；UI 9、online/transport 36 项已有记录 | 后续 AI 迁移必须保留 null 与 unknown；旧缺陷不是可复用成功方案 |
| KeyStore、授权、网络与预算 | PR #55 当前候选 `5cd32c823b79ba99142bce92bb4cb380d05f92f1` | 只作为候选设计；真实供应商、最终点击及可读安全结论仍有缺口；iOS 应独立使用 Keychain/原生网络与测试 |

## Windows 阶段预览

安装锁定依赖后运行 `pnpm ios:preview`，默认打开地址 `http://127.0.0.1:4389`。只绑定回环，拒绝使用正式 4318 与既有 4386 端口；不启停其他服务。页面明确标出 Windows 浏览器、合成内存数据和模拟接口，支持 390×844、375×667、844×390、768×1024 近似尺寸。

只验证实际 Web UI 的几何、控件与状态变化；刷新重置合成資料。安全区域只是 CSS 近似。真实字体、软键盘、UIDocumentPicker、权限、系统分享、后台/锁屏恢复和 Keychain 必须由 Simulator/真机补证。预览 adapter 不打进 iOS 应用；生产入口要求真正 iOS runtime，浏览器不会回退成原生成功。

## macOS 构建与安装

官方 Capacitor 8 要求 iOS 15+ 和 Xcode 26.0+，构建需要 macOS。本项目使用 SPM，并将 capacitor-swift-pm 固定到与 npm iOS/core 相同的 8.5.2。

1. 在源码目录执行 `pnpm install --frozen-lockfile`。
2. Windows 可执行 `pnpm ios:prepare` 和 `pnpm ios:copy`；复制不是编译。若沙箱账户的 `os.userInfo` 失败，在正常本人用户上下文运行同一命令，不改安全权限。
3. macOS 执行 `pnpm ios:sync`，再在 `apps/ios/native` 执行 `swift test`（真实文件系统、事务、备份与损坏检查）。
4. 未签名 Simulator 编译：`xcodebuild -project apps/ios/ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath .tmp/ios-build CODE_SIGNING_ALLOWED=NO build`。
5. `pnpm ios:open` 后在 Xcode 选择 Simulator 运行；iPhone/iPad 设备需本人登录 Apple Account、配置自己的签名，再覆盖安装并测试数据保留。个人免费 Team 有周期重新配置限制，不是稳定分发。
6. TestFlight/App Store、注册付费、证书/长期密钥或使用新外部服务，均另经本人明确选择。当前只准备不含签名的工程/CI，不发布。

新增 `iOS unsigned build and native storage tests` CI 执行上述原生检查和无签名编译；通过只能证明该 SHA 的编译/存储测试，不能代替已安装 App 的系统文件与真机验收。项目原有四项 CI 仍保留。

来源：2026-10-13 实读 [Capacitor iOS](https://capacitorjs.com/docs/ios)、[环境/SPM 要求](https://capacitorjs.com/docs/getting-started/environment-setup)、[Xcode 系统要求](https://developer.apple.com/xcode/system-requirements)、[Apple Personal Team](https://developer.apple.com/help/account/basics/about-your-developer-account)。

实际结果与版本更新在 [测试结果](TEST_RESULTS.md) 和本任务 PR 跟进中；没有执行的检查保留未运行。
