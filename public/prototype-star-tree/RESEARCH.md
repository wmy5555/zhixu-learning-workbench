# 知序 · 星光成叶原型

本轮问题：从散星、概念、星光到叶片，再到树冠和地面，这条视觉叙事是否清楚、是否值得继续深化？

这是独立官网原型，不是正式工作台。材料、回答和反馈均为原创合成示意；不调用模型，不保存学习记录，不连接真实资料。下载按钮只说明后续入口，不提供安装包。

## GitHub 调查与选取

2026-10-25 使用已连接 GitHub 插件，搜索了滚动叙事、程序化树木、Canvas 星空三条路线，并扩展到滚动进度实现、窗口缩放问题及相关源码。

| 项目 | 核验内容 | 本轮决定 |
| --- | --- | --- |
| [Scrollama](https://github.com/russellsamora/scrollama) | README、package.json、src/entry.js、构建文件、MIT LICENSE、Issue #145 与全部三条评论 | 实际复用，用于章节进入与状态标记 |
| [GSAP](https://github.com/greensock/GSAP) | 仓库元数据及 README 的滚动编排能力 | 保留作后续复杂镜头备选；本轮未安装、未复制 |
| [EZ-Tree](https://github.com/dgreenheck/ez-tree) | README 的 Three.js 几何、树干/叶片参数及 LOD；仓库标注 MIT | 三维路线参考，本轮选择二维手绘风格，未复制源码与贴图 |
| [WarpSpeed](https://github.com/adolfintel/warpspeed) | 星空绘制源码、持续动画循环、仓库许可元数据 | 不采用；持续飞行不符合叙事，尚未核实完整许可 |
| [treegrowjs](https://github.com/k2xl/treegrowjs) | 仓库信息、2014 年最后推送、缺少明确许可元数据 | 未作为可直接复制的实现 |

这是一轮针对原型的选型，不是全网穷尽搜索或完整安全审计。只有实际引入的 Scrollama 和本原型经过本地运行；其余候选仅做上述静态核验。

## 实际复用与边界

- Scrollama 版本：package.json 为 3.2.0。
- 固定来源提交：afab8ab2509a7e0112bee4bd7c131eafc50ffc3a。
- [实际引入文件](https://github.com/russellsamora/scrollama/blob/afab8ab2509a7e0112bee4bd7c131eafc50ffc3a/build/scrollama.min.js)原样保存在 vendor/scrollama.min.js。
- [MIT 许可](https://github.com/russellsamora/scrollama/blob/afab8ab2509a7e0112bee4bd7c131eafc50ffc3a/LICENSE)完整保存在 vendor/LICENSE.scrollama.txt。不改变知序项目自身许可证。
- 星空、曲线树枝、叶片及星光转移为本轮原创 Canvas 实现，不从无明确许可的演示复制。
- 知序产品纸面示意沿用现有暖色纸张、中文衬线标题和克制边框。官网夜空配色与连续场景由本轮明确选定的方向决定。
- 没有外部字体、图片、CDN、遥测或运行期联网依赖。保留原生滚动。

## 有依据的实现取舍

[Scrollama #145](https://github.com/russellsamora/scrollama/issues/145)在本次读取时仍为 open。报告涉及大幅缩放后 progress 只返回 0/1。评论给出 resize 或重建 observer 的经验，不能当作上游已修复。

因此只用 Scrollama 通知章节，连续镜头直接由页面实际滚动位置计算；缩放后重新测量并重建章节观察器。渲染通过一次 requestAnimationFrame 合并，追上滚动位置后停止，没有空闲动画循环。像素密度上限为 2。减少动态模式固定显示完整树，保留文字与操作。

用户已明确选定同一条视觉方向，因此按 prototype 的有界探索规则跳过随机采样。本轮交付一个集中验证的原型；尚无胜出方案，不推广到正式产品。

## 使用

在候选分支运行 pnpm prototype:star-tree。启动器只监听 127.0.0.1，自动选择空闲端口，并只允许读取原型的白名单文件。无需安装项目依赖。

也可以直接打开本目录 index.html 离线观看。页面底部可减少动态、返回开篇；右侧圆点可跳到章节。排队题有两种示例反馈。

当前仅作视觉与交互示意。它不证明真实模型教学效果、长期记忆、真机流畅度或生产发布已验收。

## 本轮验证与边界

- 原生 JavaScript、固定第三方文件与启动器语法检查通过；仓库规则检查覆盖 469 个跟踪文件。首次暂存被目录权限阻止，因此早先 462 文件结果未作为新增文件验收依据；获准暂存后才执行有效检查。
- Codex 浏览器实际检查开篇、学习片段、完整树冠、正反向章节跳转、两项示例选择、390×844 窄屏与系统/手动减少动态。资源记录只含本机预览源，没有外部资源请求。
- 1440×900 浏览器采样 176 次 Canvas 绘制：中位数 0.4ms，P95 0.8ms，最大 1.7ms；900ms 停滚区间新增绘制 0。此前窄屏/缩放采样 P95 3.2ms、最大 4ms。这仅是本机绘制函数耗时，不是整帧 GPU 时间、长期帧率或真实手机性能。
- 预览服务器使用原生 HTTP 请求核验首页 GET 200、资源 HEAD 200、未知路径 404、POST 405、错误 Host 403。首次 fetch 的自定义 Host 未被实际发送，不将其结果当作 Host 校验失效；改用原生 HTTP 发送指定请求头后核验。
- 修正了树冠裁切和分枝过早出现的问题：最终缩放取决于树形边界，子枝从父枝完成时开始，避免悬空枝梢。
- 未运行全套产品测试、真实模型或手机真机测试；这是独立、无持久化原型。未部署正式 4318，未创建或合并 PR，云端审阅等待未来经确认的实现范围。
