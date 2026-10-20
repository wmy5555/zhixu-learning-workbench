# 知序首页重构原型

- 原型分支：[`prototype/homepage-redesign`](https://github.com/wmy5555/zhixu-learning-workbench/tree/prototype/homepage-redesign)
- 可运行原型：[homepage-redesign.html](./homepage-redesign.html)
- 参考设计规范：[open-claude-ui](https://github.com/Caho1/open-claude-ui)，重点参考 `docs/v1/01-设计哲学与设计令牌体系.md`、`docs/v1/02-基础原子组件与交互控件.md`、`docs/v1/08-AI-Agent-前端-UI-与动效开发指南.md)。
- 原型方法：[AIHero /prototype Skill](https://www.aihero.dev/skills-prototype)。

## 本原型要回答的唯一问题

**知序首页应该采用哪一种信息层级与布局，才能让用户最快开始收集、继续学习并处理当天待办？**

三个版本在布局结构与信息优先级上存在实质区别，而非只换颜色：

- **A · 均衡工作台**：左侧完整导航、顶部快速收集、当天安排与最近收集为主、学习节奏和继续学习为辅。
- **B · 紧凑导航**：压缩侧栏，增加主内容空间，把统计信息变成右侧紧凑摘要。
- **C · 聚焦收集**：隐藏常驻侧栏，突出收集输入与核心任务，适合以快速记录为首页首要动作的方向。

## 原型边界

这是一次性设计探索，不是生产页面：使用合成示例数据、内存状态和简单交互；没有连接真实知识库、API、账户或持久化，也不包含生产级错误处理和测试。不要直接把此文件合并进 `main`。确认设计方向后，应将选定的布局与视觉决策迁移到正式页面，并按知序的 `AGENTS.md` 进行独立实现和验收。

## 评审建议

请优先比较：首屏能否一眼理解今天该做什么、收集入口是否足够明显、已有导航是否容易发现、窄屏是否可用，以及首页是否有过多装饰或重复信息。选定方向时可以组合不同版本的局部优点。
