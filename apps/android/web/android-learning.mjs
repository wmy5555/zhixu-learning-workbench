import { createLearning } from './learning-core.mjs';
import { clone, fail, text, titleText, idText, jsonObject, jsonValue, inputObject, strings, validateNote, createMemoryStore, learningLimits } from './learning-runtime.mjs';

export { learningLimits } from './learning-runtime.mjs';
export const defaults = Object.freeze({ dailyMinutes: 25, timezone: 'Asia/Shanghai', scheduleTime: '08:00', focusTopics: [], pausedIds: [], discoveryDays: 7 });
const stages = ['reference', 'candidate', 'learning', 'integrated', 'core', 'retired'];
const depths = ['aware', 'find', 'explain', 'apply'];
const settingsKeys = Object.keys(defaults);
const namespaces = ['sessions', 'plans', 'reviews', 'studyEvidence', 'topics', 'jobs', 'relations'];
const byteLength = value => new TextEncoder().encode(JSON.stringify(value)).length;

function validateSettings(saved) {
  inputObject(saved, settingsKeys, '学习设置');
  const next = { ...clone(defaults), ...clone(saved) };
  if (!Number.isInteger(next.dailyMinutes) || next.dailyMinutes < 5 || next.dailyMinutes > 240) fail('每日时间应为 5–240 分钟的整数。');
  text(next.timezone, '时区', 128);
  try { new Intl.DateTimeFormat('en-CA', { timeZone: next.timezone }).format(new Date()); } catch { fail('时区无效，请用 Asia/Shanghai 等标准时区名称。'); }
  if (typeof next.scheduleTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(next.scheduleTime)) fail('生成时间应为 HH:mm。');
  next.focusTopics = strings(next.focusTopics, '关注主题', 100);
  next.pausedIds = strings(next.pausedIds, '暂停条目', 200);
  if (!Number.isInteger(next.discoveryDays) || next.discoveryDays < 1 || next.discoveryDays > 365) fail('发现范围应为 1–365 天的整数。');
  return next;
}

export function createEmptyLearningState() { return { notes: [], records: {}, settings: {}, guide: {} }; }
export function validateLearningState(state) {
  inputObject(state, ['notes', 'records', 'settings', 'guide'], '学习数据');
  if (!Array.isArray(state.notes) || state.notes.length > learningLimits.notes) fail('手机最多保存 200 条学习内容。', 'LIMIT_REACHED');
  const ids = new Set();
  for (const note of state.notes) { validateNote(note, { persisted: true }); if (ids.has(note.id)) fail('学习数据包含重复条目。'); ids.add(note.id); }
  jsonObject(state.records, '学习记录');
  if (Object.keys(state.records).some(key => !namespaces.includes(key))) fail('学习记录类型无效。');
  let count = 0;
  for (const [namespace, records] of Object.entries(state.records)) {
    jsonObject(records, '学习记录');
    for (const [key, record] of Object.entries(records)) {
      idText(key); jsonObject(record, '记录'); jsonValue(record); count++;
      if (namespace === 'sessions') {
        idText(record.id); idText(record.noteId); text(record.sourceHash, '学习材料版本', 256);
        if (!['reading', 'unassessed', 'completed'].includes(record.status) || !Array.isArray(record.turns) || record.turns.length > 500) fail('学习会话格式无效。');
        text(record.material, '学习材料', learningLimits.bodyBytes);
        if (record.pendingJobId || record.feedback !== undefined) fail('手机离线记录不能包含自动评估结果。');
        if (!Number.isInteger(record.hintCount) || record.hintCount < 0 || record.hintCount > 1000) fail('提示记录格式无效。');
        for (const turn of record.turns) { jsonObject(turn); idText(turn.id); text(turn.requestId, '提交标识', learningLimits.requestId); text(turn.answer, '回答', learningLimits.bodyBytes); if (typeof turn.hintUsed !== 'boolean') fail('提示记录格式无效。'); if (turn.assessment !== 'unassessed' || turn.feedback !== undefined) fail('手机离线回答只能标记为尚未评估。'); }
        if (record.status === 'completed') {
          if (!record.turns.length || record.completion?.reviewSettled !== false || record.completion?.interval !== null) fail('离线完成记录不能更新复习间隔。');
          validateOfflineEvidence(record.completion.evidence);
        }
      }
      if (namespace === 'studyEvidence') validateOfflineEvidence(record);
      if (namespace === 'jobs') fail('手机离线练习不能包含自动反馈任务。');
      if (namespace === 'plans' && (!['pending', 'done', 'skip', 'defer', 'pause', 'budget_deferred', 'paused'].includes(record.state) || typeof record.minutes !== 'number' || !Number.isFinite(record.minutes))) fail('今日安排格式无效。');
    }
  }
  if (count > 2000 || byteLength(state.records) > learningLimits.recordsBytes) fail('学习记录超过手机保存上限，请先导出备份。', 'LIMIT_REACHED');
  validateSettings(state.settings); jsonObject(state.guide, '教程进度'); jsonValue(state.guide);
  if (byteLength(state) > learningLimits.stateBytes) fail('学习内容超过手机保存上限，请先导出备份。', 'LIMIT_REACHED');
  return clone(state);
}

function validateOfflineEvidence(evidence) {
  jsonObject(evidence, '离线练习证据');
  if (evidence.assessment !== 'unassessed' || evidence.reviewSettled !== false
    || ['independent', 'explanationPractice', 'applicationPractice', 'spacedRecall'].some(key => evidence[key] !== false)) fail('离线练习尚未评估，不能作为已掌握或增加复习间隔的证据。');
}

// Each call owns a draft. The transport commits api.state atomically only after
// the request succeeds; this service performs no HTTP or native plugin calls.
export function createAndroidLearning({ state = createEmptyLearningState(), sources = [], practice = false, clock = () => new Date() } = {}) {
  const draft = validateLearningState(state);
  if (typeof practice !== 'boolean' || typeof clock !== 'function' || !Array.isArray(sources) || sources.length > 200) fail('学习环境无效。');
  if (!practice && draft.notes.some(n => n.kind === 'source')) fail('正式原文应独立保存，不能写入学习数据。');
  if (practice && sources.length) fail('练习空间不能读取正式原文。', 'PRACTICE_ISOLATION', 409);
  const externalIds = new Set();
  for (const note of sources) { validateNote(note, { sourceOnly: true, summary: true }); if (externalIds.has(note.id) || draft.notes.some(n => n.id === note.id)) fail('来源标识冲突。'); externalIds.add(note.id); }
  const learningDate = () => { const date = clock(); if (!(date instanceof Date) || !Number.isFinite(date.getTime())) fail('学习时间无效。', 'INVALID_LEARNING_TIME'); return new Date(date.getTime()); };
  const now = () => learningDate().toISOString();
  const store = createMemoryStore(draft, sources, now);
  const getRawNote = id => { idText(id); return store.read(id); };
  const settings = () => ({ ...validateSettings(draft.settings), ai: { enabled: false, hasKey: false }, embedding: { enabled: false, hasKey: false }, search: { enabled: false, hasKey: false }, fetch: { enabled: false }, mcp: { enabled: false, allowProposals: false, chatgptEnabled: false, chatgptAllowRead: false }, prompts: {} });
  function limitationsFor(note) {
    const issues = [...(note.meta.researchLimitations || [])];
    if (note.meta.reviewAfter && note.meta.reviewAfter < now()) issues.push('材料可能陈旧，需要重新研究。');
    if (note.meta.processKey) { const [sourceId, sourceHash] = note.meta.processKey.split(':'); if (store.row(sourceId)?.hash !== sourceHash) issues.push('底层原始资料已修改或删除，需要重新加工。'); }
    for (const ref of note.meta.sources || []) if (ref.role === 'input' && ref.hash && store.row(ref.id)?.hash !== ref.hash) issues.push('底层原始资料已修改或删除，需要重新加工。');
    return [...new Set(issues)];
  }
  const eligible = note => note.kind === 'knowledge' && note.meta.stage !== 'retired' && !note.meta.supersededBy && !limitationsFor(note).length;
  const publicNote = note => ({ ...clone(note), limitations: limitationsFor(note), meta: { ...clone(note.meta), effectivePrivacy: 'local' } });
  const complete = result => { validateLearningState(draft); return clone(result); };
  function updateSettings(input) { inputObject(input, settingsKeys); const value = validateSettings({ ...draft.settings, ...input }); draft.settings = value; return complete(settings()); }
  function editNote(id, input) {
    inputObject(input, ['title', 'body', 'meta', 'expectedHash']);
    const old = getRawNote(id); text(input.expectedHash, '当前版本', 256);
    if (old.kind === 'topic') fail('请通过主题编辑入口调整主题成员和顺序。');
    const meta = input.meta || {}; inputObject(meta, ['stage', 'privacy', 'topic', 'depth', 'prerequisites', 'researchIntervalDays', 'platform', 'author', 'url', 'date', 'locator']);
    if (input.title !== undefined) titleText(input.title);
    if (input.body !== undefined) text(input.body, '正文', learningLimits.bodyBytes);
    if (meta.stage !== undefined && meta.stage !== old.meta.stage) fail('请通过晋级操作调整阶段。');
    if (meta.privacy !== undefined && meta.privacy !== 'local') fail('手机端仅支持本地资料。');
    if (meta.depth !== undefined && !depths.includes(meta.depth)) fail('学习目标无效。');
    if (meta.topic !== undefined) text(meta.topic, '主题', 800, { empty: true });
    if (meta.researchIntervalDays !== undefined && (!Number.isInteger(meta.researchIntervalDays) || meta.researchIntervalDays < 1 || meta.researchIntervalDays > 365)) fail('核验有效天数应为 1–365。');
    if (meta.prerequisites !== undefined) validatePrerequisites(strings(meta.prerequisites, '前置知识', 100));
    if (old.hash !== input.expectedHash) fail('内容已发生变化，请刷新后合并修改。', 'CONFLICT', 409);
    if ((input.title === undefined || input.title === old.title) && (input.body === undefined || input.body === old.body) && Object.entries(meta).every(([key, value]) => JSON.stringify(value) === JSON.stringify(old.meta[key]))) return publicNote(old);
    return complete(publicNote(store.update(id, { ...input, meta: { ...meta, ...(old.kind === 'knowledge' ? { userEdited: true } : {}) } })));
  }
  function promote(id, input) {
    inputObject(input, ['stage', 'reason', 'depth', 'expectedHash']);
    const note = getRawNote(id); if (note.kind !== 'knowledge') fail('只有知识条目能进入学习阶段。');
    if (!stages.includes(input.stage) || input.depth !== undefined && !depths.includes(input.depth)) fail('阶段或学习目标无效。');
    text(input.reason, '调整理由', 4096);
    if (input.expectedHash !== undefined && input.expectedHash !== note.hash) fail('内容已发生变化，请刷新。', 'CONFLICT', 409);
    if (['integrated', 'core'].includes(input.stage) && !note.meta.confirmedAt) fail('请先以自己的语言确认个人理解。');
    return complete(publicNote(store.update(id, { expectedHash: note.hash, meta: { stage: input.stage, depth: input.depth || note.meta.depth || 'explain', promotionReason: input.reason, promotedAt: now() } })));
  }
  function confirmNote(id, input) {
    inputObject(input, ['body', 'expectedHash']); const note = getRawNote(id);
    if (note.kind !== 'knowledge') fail('请先把资料整理为知识条目。');
    text(input.body, '自己的理解', learningLimits.bodyBytes); text(input.expectedHash, '当前版本', 256);
    const heading = '\n\n## 我的理解（用户确认）\n\n';
    const linkStart = '<!-- zhixu-managed-links:start -->', linkEnd = '<!-- zhixu-managed-links:end -->';
    // Keep a single terminal managed block in place after the new understanding.
    // Ambiguous or nonterminal blocks stay byte-for-byte in the original text.
    const terminalLinks = note.body.indexOf(linkStart) === note.body.lastIndexOf(linkStart)
      && note.body.indexOf(linkEnd) === note.body.lastIndexOf(linkEnd)
      ? note.body.match(/\n\n<!-- zhixu-managed-links:start -->[\s\S]*?<!-- zhixu-managed-links:end -->[\t \r\n]*$/) : null;
    const suffix = terminalLinks?.[0] || '';
    let original = suffix ? note.body.slice(0, terminalLinks.index) : note.body;
    // Only the exact last block recorded by the previous confirmation is ours
    // to replace. Later chapters or external edits must never be truncated.
    const previous = typeof note.meta.personalUnderstanding === 'string' && note.meta.personalUnderstanding
      ? `${heading}${note.meta.personalUnderstanding}` : '';
    if (previous && original.endsWith(previous) && original.indexOf(previous) === original.lastIndexOf(previous)) original = original.slice(0, -previous.length);
    return complete(publicNote(store.update(id, { expectedHash: input.expectedHash, meta: { stage: 'integrated', personalUnderstanding: input.body, confirmedAt: now(), confirmedBy: 'user' },
      body: `${original}${heading}${input.body}${suffix}` })));
  }
  function extractSource(id, input) {
    inputObject(input, ['title', 'body', 'topic', 'reason', 'depth', 'claimType', 'expectedHash']); const source = getRawNote(id);
    if (source.kind !== 'source') fail('手动整理必须关联一份原始资料。');
    text(input.expectedHash, '原文当前版本', 256);
    if (input.expectedHash !== source.hash) fail('原文版本已变化，请刷新后整理。', 'SOURCE_CHANGED', 409);
    text(source.body, '原文正文', learningLimits.bodyBytes);
    titleText(input.title); text(input.body, '知识正文', learningLimits.bodyBytes);
    for (const key of ['topic', 'reason']) if (input[key] !== undefined) text(input[key], key, 4096, { empty: true });
    if (input.depth !== undefined && !depths.includes(input.depth)) fail('学习目标无效。');
    if (!['fact', 'opinion'].includes(input.claimType)) fail('请明确选择事实或个人观点。');
    return complete(publicNote(store.create({ kind: 'knowledge', title: input.title, body: input.body, meta: {
      stage: 'candidate', privacy: 'local', sources: [{ id: source.id, role: 'input', hash: source.hash }],
      sourceSnapshot: { id: source.id, hash: source.hash, title: source.title, body: source.body, meta: clone(source.meta) },
      topic: input.topic || '', depth: input.depth || 'explain', promotionReason: input.reason || '', userStructured: true, claimType: input.claimType,
      researchLimitations: input.claimType === 'opinion' ? [] : ['这份手工材料含需查证的事实；请在电脑端对原始资料运行联网加工，再采用带证据的候选条目。'],
      ...(practice ? { demo: true, practice: true } : {}),
    } })));
  }
  function saveSource(input) {
    if (!practice) fail('正式原文请通过原文保存入口写入。', 'ANDROID_UNAVAILABLE', 409);
    inputObject(input, ['id', 'title', 'body', 'meta', 'expectedHash']);
    titleText(input.title); text(input.body, '正文', learningLimits.bodyBytes);
    const meta = input.meta || {}; inputObject(meta, ['platform', 'author', 'url', 'date', 'locator', 'topic']);
    for (const [key, value] of Object.entries(meta)) text(value, key, 4096, { empty: true });
    const fields = { platform: '', author: '', url: '', date: '', locator: '', topic: '', ...meta, privacy: 'local', stage: 'reference', demo: true, practice: true };
    if (input.id) { const old = getRawNote(input.id); if (old.kind !== 'source') fail('条目不是原文。'); return complete(publicNote(store.update(input.id, { ...input, meta: { ...old.meta, ...meta, privacy: 'local', stage: 'reference', demo: true, practice: true } }))); }
    return complete(publicNote(store.create({ kind: 'source', title: input.title, body: input.body, meta: fields })));
  }
  function validatePrerequisites(ids) {
    for (const id of ids) { const note = getRawNote(id); if (note.kind !== 'knowledge' || !eligible(note)) fail('前置知识必须选择当前可用、尚未停用或替代的知识条目。', 'INVALID_PREREQUISITE'); }
  }
  const core = createLearning({ store, settings, getNote: getRawNote, eligible, limitationsFor, privacyFor: () => 'local', confirmNote, updateSettings,
    learningClock: learningDate, practice, assessmentMode: 'offline', strictPrerequisites: true, validateTopicPrerequisites: validatePrerequisites,
    queue() { fail('离线练习不会创建自动反馈任务。', 'ANDROID_UNAVAILABLE'); },
    ai: { generate() { fail('手机端尚未接入在线评估。', 'ANDROID_UNAVAILABLE'); } },
  });
  const operation = (fn, validator) => (...args) => { validator?.(...args); return complete(fn(...args)); };
  const idOperation = (fn, fields = []) => operation(fn, (id, input = {}) => { idText(id); inputObject(input, fields); });
  const learning = {
    today: operation(core.today), topics: operation(core.topics), session: idOperation(core.session),
    startStudy: operation(core.startStudy, (input = {}) => { inputObject(input, ['noteId', 'planId', 'topicId', 'mistakeId']); for (const value of Object.values(input)) idText(value); }),
    answerStudy: operation(core.answerStudy, (id, input) => { idText(id); inputObject(input, ['answer', 'hintUsed', 'requestId']); text(input.answer, '回答', learningLimits.bodyBytes); text(input.requestId, '提交标识', learningLimits.requestId); if (input.hintUsed !== undefined && typeof input.hintUsed !== 'boolean') fail('提示使用情况应为开关值。'); }),
    hintStudy: idOperation(core.hintStudy), finishStudy: idOperation(core.finishStudy),
    confirmStudy: idOperation(core.confirmStudy, ['body']),
    planAction: operation(core.planAction, (id, input) => { idText(id); inputObject(input, ['action', 'days']); if (input.days !== undefined && (!Number.isInteger(input.days) || input.days < 1 || input.days > 365)) fail('延期天数应为 1–365 的整数。'); }),
    mistakeAction: operation(core.mistakeAction, (id, input) => { idText(id); inputObject(input, ['action', 'reason']); if (input.reason !== undefined) text(input.reason, '处理理由', 4096, { empty: true }); }),
    createTopic: operation(core.createTopic, input => { inputObject(input, ['title', 'body', 'noteIds', 'prerequisites', 'minutes']); titleText(input.title); if (input.body !== undefined) text(input.body, '主题正文', learningLimits.bodyBytes, { empty: true }); if (input.noteIds !== undefined) strings(input.noteIds, '主题成员', 500); if (input.prerequisites !== undefined) strings(input.prerequisites, '前置知识', 100); if (input.minutes !== undefined && (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 1440)) fail('预计投入应为 1–1440 分钟的整数。'); }),
    updateTopic: operation(core.updateTopic, (id, input) => { idText(id); inputObject(input, ['title', 'body', 'expectedHash', 'meta']); if (input.meta !== undefined) { inputObject(input.meta, ['noteIds', 'prerequisites', 'minutes']); if (input.meta.noteIds !== undefined) strings(input.meta.noteIds, '主题成员', 500); if (input.meta.prerequisites !== undefined) strings(input.meta.prerequisites, '前置知识', 100); if (input.meta.minutes !== undefined && (!Number.isInteger(input.meta.minutes) || input.meta.minutes < 1 || input.meta.minutes > 1440)) fail('预计投入应为 1–1440 分钟的整数。'); } if (input.title !== undefined) titleText(input.title); if (input.body !== undefined) text(input.body, '主题正文', learningLimits.bodyBytes); text(input.expectedHash, '当前版本', 256); }),
    topicAction: idOperation(core.topicAction, ['action']),
    grade: core.grade,
  };
  function list(filters = {}) {
    inputObject(filters, ['q', 'kind', 'stage']);
    if (filters.q !== undefined) text(filters.q, '查询内容', 4096, { empty: true });
    if (filters.kind && !['source', 'knowledge', 'topic', 'mistake'].includes(filters.kind) || filters.stage && !stages.includes(filters.stage)) fail('筛选条件无效。');
    return store.list().filter(n => !n.meta.excerptOnly && (!filters.kind || n.kind === filters.kind) && (!filters.stage || n.meta.stage === filters.stage)
      // A user's old incorrect answer is a historical record, never a correct
      // knowledge search hit. Mistakes remain available in their dedicated list.
      && (!filters.q || n.kind !== 'mistake' && `${n.title}\n${n.body || ''}`.toLowerCase().includes(filters.q.toLowerCase()))).map(publicNote);
  }
  function library(filters = {}) {
    const all = list(), matched = new Set(list(filters).map(n => n.id)), grouped = new Set();
    const groups = all.filter(n => n.kind === 'source').map(source => {
      const children = all.filter(n => n.kind === 'knowledge' && (n.meta.sources || []).some(ref => ref.role === 'input' && ref.id === source.id));
      grouped.add(source.id); children.forEach(n => grouped.add(n.id)); return { source, children, jobs: [] };
    }).filter(group => matched.has(group.source.id) || group.children.some(n => matched.has(n.id)));
    return { groups, standalone: all.filter(n => !grouped.has(n.id) && matched.has(n.id)) };
  }
  function createMistake(sessionId, input) {
    inputObject(input, ['omission', 'correction', 'reason', 'nextQuestion', 'title', 'origin']); idText(sessionId);
    if (input.origin !== undefined && input.origin !== 'user') fail('手机错题只能标记为用户记录。');
    const session = core.session(sessionId); if (!session.turns.length) fail('请先留下自己的回答，再记录需要修正之处。');
    for (const key of ['omission', 'correction', 'reason']) text(input[key], key, 8192);
    if (input.title !== undefined) titleText(input.title);
    if (input.nextQuestion !== undefined) text(input.nextQuestion, '后续练习', 8192, { empty: true });
    const note = getRawNote(session.noteId), turn = session.turns.at(-1);
    const body = `## 问题\n${turn.question}\n\n## 用户当时的回答（错误记录，不能作为正确知识引用）\n${turn.answer}\n\n## 用户记录的误解或遗漏（尚未自动评估）\n${input.omission}\n\n## 用户写下的修正与依据\n${input.correction}\n\n## 用户记录理由\n${input.reason}\n\n## 后续练习\n${input.nextQuestion || session.question}`;
    return complete(publicNote(store.create({ kind: 'mistake', title: input.title || `误解：${note.title}`.slice(0, 200).replace(/[\uD800-\uDBFF]$/u, ''), body, meta: {
      origin: 'user', noteId: note.id, sessionId, sessions: [sessionId], correctionState: 'open', privacy: 'local', sources: [{ id: note.id, role: 'input', hash: session.sourceHash }],
      omission: input.omission, correction: input.correction, userReason: input.reason, nextQuestion: input.nextQuestion || session.question,
      assessment: 'unassessed', ...(practice ? { demo: true, practice: true } : {}),
    } })));
  }
  function getNote(id) {
    const note = publicNote(getRawNote(id));
    if (note.kind === 'source') return { ...note, children: list({ kind: 'knowledge' }).filter(n => n.meta.sources?.some(ref => ref.id === id && ref.role === 'input')), structure: { state: 'missing', structure: null, message: '手机端暂未接入自动结构分析。' } };
    return note;
  }
  function bootstrap() {
    const notes = list(); return complete({ settings: settings(), notes, topics: core.topics(), today: core.today(),
      stats: { notes: notes.length, sources: notes.filter(n => n.kind === 'source').length, knowledge: notes.filter(n => n.kind === 'knowledge').length, pending: 0 },
      jobs: [], jobRevision: 'android-offline', jobSnapshot: 0, conflicts: [], practice,
      capabilities: { offline: true, model: false, ai: false, search: false, fetch: false, embedding: false, assessment: 'unavailable', onlineResearch: false } });
  }
  function updateGuide(input) {
    inputObject(input, ['started', 'dismissed']);
    for (const value of Object.values(input)) if (typeof value !== 'boolean') fail('教程进度应为开关值。');
    draft.guide = { ...draft.guide, ...input }; return complete(draft.guide);
  }
  return { get state() { return clone(draft); }, bootstrap, list, library, getNote, saveSource, extractSource, editNote, promote, confirmNote, createMistake, updateSettings, updateGuide, settings,
    sessions: () => store.records('sessions'), mistakes: () => list({ kind: 'mistake' }), learning,
    evidence(id) { const note = getRawNote(id); return { noteId: id, evidence: clone(note.meta.evidence || []), limitations: limitationsFor(note), researchedAt: note.meta.researchedAt || null, sourceSnapshot: clone(note.meta.sourceSnapshot || null) }; },
    linksPreview: id => store.managedLinksPreview(id), syncLinks: () => store.syncManagedLinks(),
  };
}
