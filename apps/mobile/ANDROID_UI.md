# Android 随身书桌：实现与验收边界

记录日期：2026-10-23。本文件依据本轮 Android 源码记录已经实现的界面与交互；源码核对不等于 APK、设备、性能或用户验收。运行结果留在末尾由主执行任务补全，不能复用上一版 APK 的结果冒充本轮通过。

## 用户选择与页面映射

本轮采用已选组合版 D。A、B、C 是交互原型的设计方案名，不是不同知识空间或业务模式。页面使用原生 React Native 控件；网页原型仅提供视觉参考，其示例资料、固定问题、分钟数和进度没有作为产品数据使用。

| 范围 | 用户选择 | 当前实现 |
| --- | --- | --- |
| 今日 | A 静读书桌 | [today.android.tsx](src/screens/today.android.tsx)：文字问候、服务端学习日期、当前计划主卡、预算刻度、今日安排及收集／专注入口。计划行保留开始、跳过、延期一天、暂停和原文阅读。 |
| 收集 | C 专注一刻 | [capture.android.tsx](src/screens/capture.android.tsx)：单一编辑区域；来源及保存后的处理选项按需展开；文件暂存、原件保存、批量导入和草稿恢复保持真实行为。 |
| 知识库 | C 主卡与列表 | [library.android.tsx](src/screens/library.android.tsx)：真实资料主卡、查找、分类和虚拟列表；宽度达到 840dp 时显示列表与阅读双栏，系统返回先退出选中阅读。 |
| 学习 | C 主卡 + B 双语标题 | [study.android.tsx](src/screens/study.android.tsx)：双语标题、真实未结束会话或今日计划主卡、真实统计与每页 30 条学习记录。 |
| 应用 | A 静读书桌 | [output.android.tsx](src/screens/output.android.tsx)：输入目标、回答／提纲／草稿、按需展开取材与外部模型授权，结果保留引用、限制及编辑确认入口。 |
| 页头 | B 的双语文字层级与 D 的品牌入口 | [android-design.tsx](src/components/android-design.tsx) 与 [mobile-tabs.android.tsx](src/components/mobile-tabs.android.tsx)：页内用具体语句表达当前任务；顶部保留「知序」及当前页，不再重复堆放「今日」「学习」大标题。 |
| 底栏 | C 轻量底栏 | 五个固定入口：今日、收集、知识库、学习、应用。只有选中标记移动，页面本身即时切换。 |
| 次级入口 | D 左侧栏 | 点击「知序」打开原生 Modal 内的左侧栏，次级功能共用已有路由。 |

温润底色、克制表面、细线分隔和衬线标题集中在 `android-design.tsx`、[workbench-ui.android.tsx](src/components/workbench-ui.android.tsx)。标题通常为 26–27、正文为 14–15；共享颜色仍读取现有外观偏好，保留深浅模式和用户选定强调色。页面不为解释布局增加成组的次级标签、宣传文案或逐条入场动画。

## Emil skills 的具体落点

公开来源为 [emilkowalski/skills 的 emil-design-eng](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md) 和 [animate-expo](https://github.com/emilkowalski/skills/blob/main/skills/animate-expo/SKILL.md)。以下把原则与实际代码对应，而非把“读过 skill”视为已经完成应用；公开 main 链接可变化，参数以下述本轮源码为准。

| 原文原则或决策 | 本轮实际行为与文件 |
| --- | --- |
| emil-design-eng：先判断频率和目的，再选择动画；按压用于即时反馈。 | `android-design.tsx` 的 `Action` 仅在按压时缩放至 0.98，使用 Reanimated CSS transition，120ms、`cubicBezier(0.23, 1, 0.32, 1)`。没有页面列表依次进入、循环装饰、模糊或阴影动画。普通列表和底栏另用即时透明度反馈，不能把所有控件都描述为同一种缩放。 |
| emil-design-eng 的 “Unseen details compound”。 | 控件把真实禁用状态传给原生 Pressable；标题换行、表单恢复、原文与引用入口、错误后的原地恢复保留。统一 `Action` 最小高度 48dp，常规行至少 52dp；底栏每项最小高度 52dp；侧栏关闭按钮 48×48dp。源码尺寸不替代放大字体、触点间距及设备可用性验收。 |
| animate-expo 的 “Tab switches never slide”。 | `mobile-tabs.android.tsx` 的 Tabs 显式使用 `animation: "none"`；不以横向滑页表达五个同级入口。底栏只移动一个绝对定位的选中标记：`withTiming` 150ms，`Easing.bezier(0.77, 0, 0.175, 1)`，动画属性为 `translateX`。 |
| animate-expo：用 Reanimated 及 shared value 保持逐帧工作在 UI 线程。 | 侧栏 `progress` 和底栏 `x` 使用 `useSharedValue`、`.get()`／`.set()` 及 `useAnimatedStyle`。侧栏只改变横向 transform 与遮罩 opacity；没有逐帧 React setState、动画高度或动画 elevation。布局测量、打开／关闭状态及导航是离散事件，关闭完成才用 `scheduleOnRN` 交回 React。 |
| animate-expo：只有带动量的手势才适合反弹；固定边界应防越界。 | 侧栏由点击打开，未实现拖动或甩动手势。打开使用 `withSpring(1, { duration: 300, dampingRatio: 1, overshootClamping: true })`，选择无反弹收拢；这是以原文的默认稳定弹簧原则适配 300ms 侧栏节奏，并未照搬带动量的 `dampingRatio: 0.8` 配方。300ms 为配置参数，实际感知时长仍待设备确认。 |
| emil-design-eng：退出要及时、使用明确缓动。 | 侧栏关闭为 `withTiming` 180ms，`Easing.bezier(0.23, 1, 0.32, 1)`；等待退出完成后再隐藏 Modal、执行目标导航。点击遮罩、关闭按钮及系统返回共用关闭逻辑，关闭中有防重标志。 |
| animate-expo 的 “Reduced motion ships with the animation”。 | `AndroidDesignProvider` 初始读取 `AccessibilityInfo.isReduceMotionEnabled()` 并监听 `reduceMotionChanged`；减少动态时 `Action` 不缩放、transition 为 0，选中标记时长为 0，侧栏直接进入终态。弹簧与 timing 同时传入 `ReduceMotion.System`。首次异步读取和运行时偏好变化仍须真机走查。 |
| animate-expo：性能结论依赖实际设备与发布构建。 | 本轮没有仅凭 Reanimated、Hermes 导出、截图或代码模式宣称帧率合格。下面单列实际运行与未验收项，避免把开发包表现推断为发布包或较慢设备表现。 |

## 原生容器、安全区与资源

- [src/app/_layout.tsx](src/app/_layout.tsx) 仅在 Android 分支加入 `SafeAreaProvider` 与 `AndroidDesignProvider`；顶栏使用原生安全区，底栏、侧栏与滚动正文根据真实 insets 留白。键盘出现时隐藏底栏，表单继续使用已有 KeyboardProvider 和 KeyboardAwareScrollView。
- 侧栏采用 React Native `Modal`，自身 `animationType="none"`，由 Reanimated 管理内容动画；`onRequestClose` 接收 Android 系统返回。遮罩、48dp 关闭按钮、展开状态、无障碍提示和关闭后的品牌焦点恢复均在同一实现中。它不是浏览器弹层，也没有假冒原生拖动关闭。
- [android-icon.tsx](src/components/android-icon.tsx) 通过字面量 `require` 引用 [assets/ui-icons](assets/ui-icons) 的随包 SVG，由已安装的 `expo-image` 呈现与着色。图标不再依赖字体转图片、远程字体或网络下载；`transition={0}`，装饰图标的读屏说明由周围真实控件承担。
- 原 `.tsx` 页面与原底栏实现保留；Metro 在 Android 选择同名 `.android.tsx`，iOS 继续使用原实现。此次 Android 视觉落地不等于 iOS 已重新验收，共享顶层布局也须按实际差异保留平台条件。

## 次级侧栏完整入口

下表对应 `mobile-tabs.android.tsx` 的实际 `groups`。选择条目先关闭侧栏，再导航到既有页面；不在主屏重复堆放这些大型入口卡片。

| 分组 | 可见入口 | 已有目标 |
| --- | --- | --- |
| 学习与探索 | 主题学习 | `section/topics` |
| 学习与探索 | 错题修正 | `section/mistakes` |
| 学习与探索 | 知识使用建议 | `section/recommendations` |
| 学习与探索 | 关联审阅 | `section/relations` |
| 学习与探索 | 检索与发现 | `/search` |
| 我的工具 | 专注计时 | `/focus` |
| 我的工具 | 输出草稿 | `section/drafts` |
| 我的工具 | 处理动态 | `section/jobs` |
| 我的工具 | 未安排知识 | `section/unavailable` |
| 知识空间 | 备份与恢复 | `section/backup` |
| 知识空间 | 回收站 | `section/recycle` |
| 知识空间 | 外观 | `/appearance` |
| 知识空间 | 设置 | `section/settings` |
| 知识空间 | 新手引导 | `section/onboarding` |

## 真实数据与业务边界

今日主卡取 `/api/today` 中第一个 `pending` 计划；显示的日期来自服务端学习日期，分钟和预算来自计划响应。刻度按 pending 与 done 计划的预计分钟计算，只表示安排量，不冒充实际专注耗时或掌握进度。开始请求仍传递 `noteId`、`planId`、`topicId`、`mistakeId`，学习可用性、主题前置和资料限制仍由原业务核心校验。

学习主卡优先选择当前历史页中真实未结束会话，其次选择真实今日 pending 计划。翻页可能改变主卡候选；目前没有为主卡新增全历史扫描。统计只使用真实学习记录 total、今日 pending 数量与预算，不把“结束过一次练习”标成“已经掌握”。空白界面提供真实收集和知识库入口，不注入演示笔记、固定问题或虚构进度。今日安排读取失败可原地重读，开始／调整失败保留具体错误。

收集仍读取、保存和恢复真实草稿；恢复不自动授予 AI 拆解或联网检验。未启用 AI 拆解时，联网检验实际禁用；关闭前置项立即取消从属选择。原件、上传回执和正文保存继续分开处理。应用页恢复草稿后关闭外部模型授权，明确本次授权后才沿既有调用路径生成；请求身份、引用、草稿确认和失败恢复沿用现有服务。视觉改动不授予资料外发权限，不改变预算、凭据、学习证据、冲突保护或备份恢复边界。

知识库使用真实 `/api/notes`，采用 FlatList 呈现正文以外的条目。新增 UI 没有后台轮询、远程图标请求、逐帧业务请求或逐帧重排整页。真正大库规模、SQLite／文件扫描、长正文与附件桥的既有性能边界仍见 [MIGRATION.md](MIGRATION.md)，本轮不能用轻量导航动画掩盖它们。

## 固定 CDS 参考与许可边界

CDS 参考固定为 [Caho1/open-claude-ui 的 4045ce76afdcb7dccef1b7e6417b04c4c6046e9c](https://github.com/Caho1/open-claude-ui/tree/4045ce76afdcb7dccef1b7e6417b04c4c6046e9c)，本项目适用规则见 [docs/UI-DESIGN.md](../../docs/UI-DESIGN.md)。本轮参考其温润色彩、表面层次、排版与克制控件，落为原生实现；没有直接把网页 CSS、Framer Motion 或整套参考仓库打进 Android 包。第三方参考的许可不替代知序项目许可；复制的第三方代码或资产仍须保留相应归属与许可，系统衬线字体不意味着可以再分发专有字体。

## 本轮实际运行验收记录

以下本地检查结果由主执行任务实际执行并回报；本文档子任务没有重复执行。候选提交、APK 与设备结果继续由主执行任务根据实际回执补全。表内待填写不是通过，也不是失败。

| 项目 | 本轮状态／证据 |
| --- | --- |
| 候选提交、构建来源、APK SHA256 | 待主执行任务填写。 |
| typecheck、lint | 主执行任务统一执行通过。 |
| 直接相关状态回归 | 5 项通过：输出并发 3 项、原文保存 2 项；不代表全套产品或真实供应商验收。 |
| native check | 主执行任务检查 85 个模块通过；不等于设备运行或原生编译通过。 |
| Android 打包、安装及启动 | 待主执行任务填写实际回执，区分模拟器与真机。 |
| 五个主页面、全部侧栏入口与系统返回 | 待实际界面走查。 |
| 真实计划／历史页、空库、读取失败与重试 | 待使用合成资料走查，不以示例原型替代。 |
| 收集草稿、文件暂存、原件保存、选项依赖 | 待直接相关运行验证。 |
| 深浅模式、中文长标题、键盘、安全区、放大字体 | 待本轮设备验证。 |
| 120ms 按压、150ms 标记、侧栏进退与减少动态 | 待实际设备验证；代码参数不等于体感和帧率结果。 |
| 发布模式及较慢设备性能、大库规模 | 未因本文件写成而验收。 |
| iOS、真实供应商响应、真实费用及长期学习效果 | 本轮 Android UI 源码记录不提供这些验收结论。 |

最终交付若采用开发签名 APK，只用于本轮独立安装和试用，不代表商店发布版本或可长期复用的正式签名。重新构建的测试签名可能不同；安装冲突不得通过清空用户资料规避。商店签名、发布审核、剩余依赖风险和正式分发门槛须另行完成。
