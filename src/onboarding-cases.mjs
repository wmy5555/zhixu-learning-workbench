import { randomUUID } from 'node:crypto';
import { fail, hash } from './store.mjs';

const label = '【预设演示案例：虚构内容与预设记录，不是你的作答，也不是实际 AI 返回】';
const practice = { demo: true, practice: true, privacy: 'local' };
const timestamp = service => service.learningNow?.() || new Date().toISOString();
const dateAt = (value, timezone) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
const atOffset = (value, days) => new Date(Date.parse(value) + days * 86400000).toISOString();

/** Called only by the manager for its isolated practice service. Never makes API calls. */
export function seedPractice(service, materialId) {
  if (materialId) return { roles: {} };
  const previous = service.store.get('onboardingSeed', 'main');
  if (previous) return { roles: previous.roles };
  const source = service.store.create({
    kind: 'source', title: '练习原文 · 小岚的读书工作台',
    body: '【原创虚构练习】小岚准备分享虚构读物《纸桥书店》。她在这次任务中计划把自己的观点、对应摘录和章节位置分别记录。她还准备标明每条个人理解适用的任务边界。\n\n这只是虚构人物的写作安排，不是关于现实学习效果的科学结论。后面的四张卡片分别帮助她知道有何用、知道去哪找、能够解释和迁移应用。',
    meta: { ...practice, stage: 'reference', platform: '知序原创虚构练习', author: '示例人物小岚', locator: '练习原文第 1—2 段', onboardingRole: 'source' },
  });
  const roles = { source: source.id };
  const cards = [
    ['aware', '知道存在 · 读书出处卡', '【原创虚构练习】小岚的读书出处卡用于提醒她：分享一个观点时，可以保留原文、位置和个人理解。本卡只要求知道这种卡片的用途，不要求记住全部细节。'],
    ['find', '知道去哪找 · 摘录查找线索', '【原创虚构练习】需要再次核对《纸桥书店》的“两个书架”片段时，小岚会搜索“纸桥”“答案”“问题”或“两个书架”，定位到虚构文本第 2 段，再核对那一段是否支持本次表达。'],
    ['explain', '能够解释 · 观点为什么要保留出处', '【原创虚构练习】在小岚这一次读书分享中，观点、原文摘录和位置分别保存。这样她需要核对时，可以知道哪些话来自原文，哪些是自己的理解。找到出处仍不代表解释一定成立；还要核对上下文是否支持自己的说法。本条描述虚构任务中的安排，不是通用研究结论。'],
    ['apply', '能够迁移应用 · 为分享选择材料', '【原创虚构练习】小岚这次先写“我想回答什么问题”，再为问题选择摘录。迁移练习：如果把读书分享换成介绍一部虚构影片，可以如何记录镜头位置、自己的观点和适用范围？没有看过对应内容时，不能用凭空编造的片段作为依据。'],
  ];
  for (const [role, title, body] of cards) {
    const note = service.store.create({ kind: 'knowledge', title: `练习 · ${title}`, body,
      meta: { ...practice, onboardingRole: role, stage: 'candidate', depth: role, topic: '读书与知识整理', claimType: 'opinion', sources: [{ id: source.id, role: 'input' }], promotionReason: '这是原创虚构任务的候选卡片，尚无学习或掌握记录。' } });
    roles[role] = note.id;
  }
  service.store.put('onboardingSeed', 'main', { ...practice, roles });
  return { roles };
}

export const caseIds = Object.freeze(['mistakes', 'hints', 'duplicates', 'prerequisites', 'evidence', 'expired', 'proposals', 'conflicts', 'jobs', 'core-suggestion', 'relations']);

/** Preparing a case is not completing a lesson. The caller verifies later user actions. */
export function loadCase(service, caseId, roles = {}) {
  if (!caseIds.includes(caseId)) fail('没有这个练习案例。', 'ONBOARDING_CASE', 404);
  const existing = service.store.get('onboardingCases', caseId);
  // Reopening a completed deletion/merge case must not recreate its consumed objects.
  if (existing) return { ...existing, roles: { ...roles, ...existing.roles }, alreadyLoaded: true };
  const store = service.store, stamp = timestamp(service), caseRoles = {}, created = [];
  const marker = { ...practice, presetCase: caseId };
  const record = (namespace, key, fields) => store.put(namespace, key, { ...fields, ...marker });
  const note = (role, title, body, meta = {}, kind = 'knowledge') => {
    const value = store.create({ kind, title: `预设演示案例 · ${title}`, body: `${label}\n\n${body}`, meta: { ...marker, onboardingRole: role, stage: 'candidate', depth: 'explain', claimType: 'opinion', topic: '读书与知识整理', ...meta } });
    caseRoles[role] = value.id; created.push(value.id); return value;
  };
  const session = (role, knowledge, { hintUsed = false, assessment = 'partial', omission = '把自己的观点当成了原文。' } = {}) => {
    const id = randomUUID(), turnId = randomUUID();
    const feedback = { assessment, feedback: `${label}\n请把原文和自己的理解分别标明。`, omission: `${label}\n${omission}`, correction: `${label}\n保留原文、位置和自己的解释，回到上下文核对。`, nextQuestion: `${label}\n遇到不支持自己观点的原文时该怎么办？`, presetCase: caseId };
    record('sessions', id, { id, noteId: knowledge.id, status: 'feedback', question: feedback.nextQuestion, material: knowledge.body, sourceHash: knowledge.hash, depth: 'explain', goal: '能够解释（预设演示案例）', privacy: 'local', hintCount: hintUsed ? 1 : 0, pendingJobId: null, createdAt: stamp, feedback, turns: [{ id: turnId, requestId: `preset-${id}`, question: `${label}\n为什么保留出处？`, answer: `${label}\n预设回答：只要我同意结论，就不必留下原文。`, hintUsed, createdAt: stamp, feedback, ...marker }] });
    caseRoles[role] = id; return { id, feedback };
  };
  if (caseId === 'duplicates') {
    const version = note('versionNote', '历史恢复专用卡片', '版本 A（旧文）：这次虚构分享需要记录摘录的位置。');
    store.update(version.id, { expectedHash: version.hash, body: `${label}\n\n版本 B（新文）：这次虚构分享需要记录摘录的位置，并把原文与自己的理解分别标明。`, meta: marker });
    const body = '为这次虚构读书分享保留一句观点、一段对应原文和位置，并核对上下文是否支持自己的解释。';
    note('mergeKeep', '重复卡片 · 保留这一条', body);
    note('mergeOther', '重复卡片 · 合入另一条', body);
    note('deleteNote', '仅供删除的卡片', '这张卡片只用于体验删除，删除不会影响主线四张学习卡片。');
  } else if (caseId === 'mistakes') {
    const knowledge = note('mistakeKnowledge', '纠错专用知识', '在这次虚构分享中，自己的理解不替代原文；需要回到摘录位置核对。', { stage: 'learning' });
    const prepared = session('mistakeSession', knowledge);
    note('mistake', '只保存结论就够了 · 待处理错题', `## 问题\n${label}\n为什么保留出处？\n\n## 用户当时的回答（错误记录，不能作为正确知识引用）\n${label}\n预设回答：只保留结论就够了。\n\n## AI 指出的误解或遗漏（可质疑）\n${prepared.feedback.omission}\n\n## 修正与依据\n${prepared.feedback.correction}\n\n## 后续练习\n${prepared.feedback.nextQuestion}`, { noteId: knowledge.id, correctionState: 'open', sessions: [prepared.id], sources: [{ id: knowledge.id, role: 'input' }], omission: prepared.feedback.omission, correction: prepared.feedback.correction, nextQuestion: prepared.feedback.nextQuestion, misconceptionKey: hash(`practice:${knowledge.id}:preset`) }, 'mistake');
  } else if (caseId === 'hints') {
    const knowledge = note('hintKnowledge', '提示练习专用知识', '这次虚构分享需要保留观点与原文的位置。找到位置后，还要核对它是否支持自己的解释。', { stage: 'learning' });
    session('hintSession', knowledge, { hintUsed: true, assessment: 'correct', omission: '' });
    note('skipKnowledge', '仅供今日跳过的安排', '这张专用卡片用于体验今日跳过，知道它的用途即可。', { stage: 'learning', depth: 'aware' });
    note('pauseKnowledge', '仅供暂停的安排', '这张专用卡片用于体验暂停安排，知道它的用途即可。', { stage: 'learning', depth: 'aware' });
  } else if (caseId === 'prerequisites') {
    const prerequisite = note('prerequisite', '尚待核验的前置知识', '预设主张：某个安排对所有学习者都有效。这个主张没有真实研究证据，只用于演示阻塞。', { claimType: 'fact', stage: 'learning', researchLimitations: ['预设演示案例：这项普遍性主张没有真实依据，不能当成已验证知识。'] });
    const member = note('topicMember', '等待前置条件的成员', '只有前置事实得到真实核验后，才考虑继续这个虚构任务。', { stage: 'learning', prerequisites: [prerequisite.id] });
    note('topicBlocked', '前置条件尚未满足的主题', '本主题用于演示前置项待核验时，学习路径保持阻塞。', { noteIds: [member.id], prerequisites: [prerequisite.id], minutes: 10, paused: false }, 'topic');
  } else if (caseId === 'evidence') {
    const source = note('evidenceSource', '证据展示的虚构原文', '预设问题：在一次虚构分享里，保留出处是否便于回到原文？这里只展示证据结构，没有实际联网查询。', {}, 'source');
    const evidence = [];
    for (const [role, suffix, text] of [
      ['support', '支持', '在虚构情节中，小岚通过自己保存的位置找到对应段落。'],
      ['oppose', '反对', '在另一个虚构情节中，错误的位置让小岚找错段落，单有位置并不足够。'],
      ['limit', '限制', '以上仅为原创故事设定，不能推广为现实学习效果或统计结论。'],
    ]) {
      const excerpt = `${label}\n${text}`;
      const reference = note(`evidence${role[0].toUpperCase()}${role.slice(1)}`, `虚构${suffix}材料`, text, { excerptOnly: true, url: `https://example.invalid/zhixu-practice/${role}`, fetchedAt: stamp }, 'source');
      evidence.push({ title: `预设演示案例 · ${suffix}材料`, url: reference.meta.url, role, excerpt, rationale: `${label}\n该片段只用于演示${suffix}关系。`, locator: '原创虚构情节第 1 段', fetchedAt: stamp, ...marker });
    }
    note('evidenceKnowledge', '带支持、反对与限制的知识', '请查看证据抽屉。下列引用全部为预设虚构材料，链接使用不可用示例域名，没有真实研究结论。', { claimType: 'fact', sources: [{ id: source.id, role: 'input' }, ...evidence.map(ev => ({ id: caseRoles[`evidence${ev.role[0].toUpperCase()}${ev.role.slice(1)}`], role: ev.role }))], evidence, researchedAt: stamp, reviewAfter: atOffset(stamp, 7), researchLimitations: ['预设演示案例：只有合成证据展示，没有真实联网核验，不能据此学习或作事实引用。'] });
  } else if (caseId === 'expired') {
    const source = note('staleSource', '待复查的原始资料', '这个虚构资料只用于展示核验期限。没有实际联网结论。', { researchIntervalDays: 1 }, 'source');
    note('staleKnowledge', '已经过期的依据', '演示日期已超过本条预设复查期限。请查看复查提示，不能把过期材料当成当前依据。', { claimType: 'fact', sources: [{ id: source.id, role: 'input' }], researchedAt: atOffset(stamp, -8), reviewAfter: atOffset(stamp, -1), researchLimitations: ['预设演示案例：没有真实外部核验；复查日期已过。'] });
  } else if (caseId === 'proposals') {
    for (const [role, purpose] of [['proposal', '待接受'], ['proposalReject', '待拒绝']]) {
      const knowledge = note(role === 'proposal' ? 'proposalNote' : 'proposalRejectNote', `${purpose}提案的专用知识`, '原文：这次虚构分享要为观点保留出处。');
      const id = randomUUID();
      record('proposals', id, { id, title: `预设演示案例 · ${purpose}写入提案`, noteId: knowledge.id, before: knowledge.body, body: `${label}\n\n修改建议：这次虚构分享要为观点保留出处，并核对出处的上下文。`, reason: `${label}\n${purpose}：练习手动审阅，没有调用外部 MCP。`, expectedHash: knowledge.hash, state: 'pending', createdAt: stamp });
      caseRoles[role] = id;
    }
  } else if (caseId === 'conflicts') {
    const member = note('linkMember', '链接更新专用成员', '这条原创虚构知识只用于核对主题中的可读链接。');
    note('linkTopic', '链接更新专用主题', '这份主题尚未写入应用维护的链接区块。请先预览，再亲自确认更新；保留这段手写说明。', { noteIds: [member.id], prerequisites: [], minutes: 5, paused: false }, 'topic');
    let knowledge = note('conflictNote', '冲突版本对照', '版本 A（预设）：我准备先记录观点，再补上摘录位置。');
    knowledge = store.update(knowledge.id, { expectedHash: knowledge.hash, body: `${label}\n\n版本 B（预设）：我准备保存观点、摘录和位置，三项一起核对。`, meta: marker });
    record('onboardingConflicts', knowledge.id, { id: knowledge.id, noteId: knowledge.id, type: '预设演示案例', title: '预设演示案例 · 修改依据的版本已过期', error: `${label} 编辑器原先依据版本 A；文件已变为版本 B。请打开历史比较，不覆盖任意一版。此处为独立冲突报告，没有破坏 Markdown 文件。`, expectedHash: 'preset-stale-version', currentHash: knowledge.hash, updatedAt: stamp });
  } else if (caseId === 'jobs') {
    for (const [role, state, title] of [['failedJob', 'failed', '索引失败'], ['cancelJob', 'waiting', '等待取消']]) {
      const id = randomUUID();
      record('jobs', id, { id, type: 'index', state, title: `预设演示案例：${title}`, payload: { presetCase: caseId, demo: true, practice: true }, progress: 0, attempts: 1, error: `${label}\n${title}，没有发送任何请求。`, code: 'PRESET_DEMONSTRATION', createdAt: stamp, updatedAt: stamp });
      caseRoles[role] = id;
    }
  } else if (caseId === 'core-suggestion') {
    note('dismissKnowledge', '暂不采纳建议的专用卡片', '这张卡片只需要知道用途，是否转为仅供查阅由你判断。', { depth: 'aware' });
    const confirmedAt = atOffset(stamp, -5);
    const knowledge = note('coreKnowledge', '核心建议专用知识', '预设个人理解：在这次虚构分享中，观点、原文和出处位置应分别保留，再核对其相互关系。', { stage: 'integrated', confirmedAt, confirmedBy: 'preset-demo', personalUnderstanding: `${label}\n此理解和后续三天记录全部为预设。` });
    for (const day of [-3, -2, -1]) {
      const id = randomUUID(), completedAt = atOffset(stamp, day);
      const evidence = { sessionId: id, noteId: knowledge.id, day: dateAt(completedAt, service.settings().timezone), completedAt, depth: 'explain', independent: true, usedHints: false, errorObserved: false, ambiguous: false, explanationPractice: true, applicationPractice: false, spacedRecall: day !== -3, assessment: 'correct', reviewSettled: true, ...marker };
      const feedback = { assessment: 'correct', feedback: `${label}\n预设判定：完成了案例中的解释。`, ...marker };
      record('sessions', id, { id, noteId: knowledge.id, sourceHash: knowledge.hash, material: knowledge.body, status: 'completed', depth: 'explain', goal: '能够解释（预设演示案例）', question: `${label}\n为什么保存出处？`, privacy: 'local', hintCount: 0, createdAt: completedAt, completedAt, feedback, turns: [{ id: randomUUID(), requestId: `preset-${id}`, question: `${label}\n为什么保存出处？`, answer: `${label}\n预设回答：便于区分原文与自己的理解。`, hintUsed: false, feedback, createdAt: completedAt, ...marker }], completion: { reviewSettled: true, evidence, reason: `${label}\n预设跨日独立练习。` } });
      record('studyEvidence', id, evidence);
    }
    for (const day of [-2, -1]) {
      const id = randomUUID(), at = atOffset(stamp, day);
      record('drafts', id, { id, mode: 'answer', question: `${label}\n怎样核对出处？`, body: `${label}\n预设草稿：保留原文并核对上下文。 [${knowledge.id}]`, citations: [{ id: knowledge.id, title: knowledge.title, body: knowledge.body }], limitations: [label], usedIds: [knowledge.id], createdAt: at });
      record('uses', `${id}:${knowledge.id}`, { draftId: id, noteId: knowledge.id, actualUse: true, at });
    }
    const suggestion = service.recommendations().suggestions.find(item => item.noteId === knowledge.id && item.targetStage === 'core');
    if (suggestion) caseRoles.coreSuggestion = suggestion.id;
  } else if (caseId === 'relations') {
    const pairs = [
      ['relationAccept', '待接受', '出处帮助回到原文核对。', '核对原文时需要一个可以定位的位置。'],
      ['relationReject', '待拒绝', '小岚为这次分享保存摘录位置。', '另一个虚构人物只是在整理书架颜色。'],
      ['relationIgnore', '仅供忽略', '本次读书分享先列一个问题。', '另一次分享也提到问题，但尚未说明共同机制。'],
    ];
    for (const [role, title, leftBody, rightBody] of pairs) {
      const left = note(`${role}Left`, `${title}关系 · 甲`, leftBody);
      const right = note(`${role}Right`, `${title}关系 · 乙`, rightBody);
      const id = hash([left.id, right.id].sort().join(':'));
      record('relations', id, { id, fromId: left.id, toId: right.id, fromHash: left.hash, toHash: right.hash, state: role === 'relationIgnore' ? 'candidate' : 'suggested', type: 'support', highValue: true, valueScore: 1, sourceExcerpt: leftBody, targetExcerpt: rightBody, explanation: `${label}\n${title}：比较这两段文字是否构成有用联系。`, use: `${label}\n仅用于学习审阅操作。`, boundary: `${label}\n虚构文本不支持现实规律；待拒绝例子不应接受。`, evidence: [left.id, right.id], createdAt: stamp });
      caseRoles[role] = id;
      if (role === 'relationAccept') { caseRoles.relationLeft = left.id; caseRoles.relationRight = right.id; }
    }
  }
  const result = { caseId, roles: caseRoles, createdIds: created, ...marker, label, loadedAt: stamp };
  store.put('onboardingCases', caseId, result);
  return { ...result, roles: { ...roles, ...caseRoles } };
}
