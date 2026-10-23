import { createHash } from 'node:crypto';
const hash = value => createHash('sha256').update(value).digest('hex');
const practiceBody = body => body.split('\n## 我的理解（用户确认）')[0].trimEnd();

export const learningPolicies = Object.freeze({
  serviceSystem: '学习目标：帮助用户形成能独立解释、纠错和迁移的理解。内容数量、报告长度、点击完成均不是掌握证据。不要为凑齐旧模板栏目填写与学习目标无关的缺失细节或推断标签。优先给当前任务需要的清楚信息，保留真正影响结论的条件。',
  sourceExtract: '学习单元约定：按一个完整学习问题组织，不按句子或操作小步骤逐条拆。800字以内的单一主题通常1–3个单元；不要为数量凑条目。连续操作及其目的、条件、例子放在同一单元。来源身份和“不保证普适”随内容保留，不单独拆成知识。不要反复写与理解无关的“没有规定字数、颜色、格式”。仅缺少会阻止理解的先修知识才填写 prerequisites。每项可同时给 practice:{depth:"explain",question:"一次只检验一个核心目标的问题",criteria:[{point:"材料支持的必要要点",quote:"从本项body逐字摘录的依据"}]}，criteria 1–3项，只列题目确实问到的要点；depth固定为explain，换场景应用由应用练习单独检验。问题与要点必须能由本项body回答；没有机制依据就不问为何普遍有效。不得要求用户猜测未提供的理由或事实。',
  grade: '学习反馈约定：只按本题和材料评估，不把此前AI推断变成评分依据。若提供“本题评分依据”，只对当前问题适用的要点评分。正确同义表达应为correct；未问到的扩展内容不得扣分。迁移题允许不同于原文的人物、组织和情境；只要对应原理、必要条件和边界，就不能以“不是原文团队场景”为由扣分，也不能新增题目或材料未要求的执行角色。题目要求超出材料时用ambiguous，并说明证据缺口。feedback最多两句：先指出做对之处，再指出一个最关键缺口；正确答案无需凑缺点。omission只写关键遗漏；correction给简短依据，不重复整份答案；nextQuestion只提一个可回答的小问题，避免伪二选一。suggestion为可修改的短建议，不替用户写完整个人理解。',
  ask: '输出约定：严格服从用户指定的用途、受众和长度。“一段”只写一个自然段；无长度要求时回答/草稿以150–350字、提纲以3–5个可执行要点为默认。只引用直接回答问题的材料，不为凑例子引入旁支。相关原文与其拆解只算同一来源，不假装独立印证。把必要限制贴近对应论断说明一次，不套用“观点、证据、反方、未知”的固定章节；没有反方证据不要编造反方。引用ID和来源界限继续遵守原合同。',
  relate: '每条关联的use给一个具体对比问题或迁移小任务，让用户亲自检验联系。利用sourceIds区分来源，同源拆解不要当成跨资料发现；边界只写实际会改变用法的条件，不反复罗列无关缺失。',
  discover: '最多给2项最值得尝试的发现，每项不超过150字（引用ID除外），包含依据、一个可执行对比/迁移问题、关键边界。sourceIds相同表示来自同一原文，不要猜测是否同源，也不要把同源步骤重新组织当新发现。仅依据给出的使用次数说明使用情况；无时间证据不能判断长期未用。不为填满栏目罗列矛盾、反方或孤立节点。没有有价值发现就明确说明。',
  topics: '按一个可完成的学习任务组织1–3个学习包，不凑数量。problem写成“完成后能解释/做出什么”，noteIds只选完成该任务必要的条目并排序。prerequisites仅含缺少就无法开始的知识，不能把字数、标记颜色、记录格式、未定时长当成先修知识。每包增加task（一个具体输出或操作）与check（用户怎样检验结果）。minutes是粗略参考，不宣称测量精确；已有来源分组sourceIds须保留，不能冒充独立证据。',
});

export function makeLearningPractice(input, body) {
  if (!input || input.depth !== 'explain' || typeof input.question !== 'string' || !input.question.trim() || input.question.length > 300) return null;
  if (!Array.isArray(input.criteria) || !input.criteria.length || input.criteria.length > 3) return null;
  if (input.criteria.some(c=>!c || typeof c.point !== 'string' || !c.point.trim() || c.point.length > 300 || typeof c.quote !== 'string' || c.quote.trim().length < 4 || c.quote.length > 500 || !body.includes(c.quote))) return null;
  return { version:1, depth:input.depth, question:input.question.trim(), criteria:input.criteria.map(({point,quote})=>({point,quote})), basisHash:hash(practiceBody(body)) };
}

export function learningPractice(note, depth) {
  const plan=note.meta?.learningPractice;
  if (!plan || plan.version!==1 || plan.depth!==depth || plan.basisHash!==hash(practiceBody(note.body))) return null;
  return makeLearningPractice(plan,practiceBody(note.body));
}

export function learningSourceIds(note) {
  return [...new Set((note.meta?.sources||[]).filter(s=>s.role==='input').map(s=>s.id))];
}
