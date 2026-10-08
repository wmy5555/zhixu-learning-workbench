// Frozen learning rules from src/learning.mjs at 5e7bbd8; offline-only branches are explicit.
import { randomUUID, hash, fail } from './learning-runtime.mjs';

const dayAt = (date, timezone) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const learningStages = new Set(['learning', 'integrated', 'core']);
const goals = {
  aware: { label: '知道存在', minutes: 2, question: title => `「${title}」主要处理哪类问题？遇到什么情形时，你会想到它？`, hint: '只需指出它的用途和出现的情形，不要求背出机制或细节。' },
  find: { label: '知道去哪找', minutes: 3, question: title => `如果需要使用「${title}」，你会用什么线索、关键词或来源找到它？找到后先核对什么条件？`, hint: '想想可搜索的关键词、资料出处，以及重新使用前要核对的条件。' },
  explain: { label: '能够解释', minutes: 5, question: title => `请用自己的话解释「${title}」：它解决什么问题，为什么成立，有哪些条件？`, hint: '先说明要解决的问题，再解释机制、成立条件和一个具体例子。' },
  apply: { label: '能够迁移应用', minutes: 8, question: title => `请为「${title}」提出一个不同于材料例子的具体场景，说明如何应用、需要哪些条件，以及何时不能套用。`, hint: '换一个具体场景，逐步对应机制与条件，并说明一个不能直接应用的边界。' },
};
const depthOf = note => Object.hasOwn(goals, note.meta.depth) ? note.meta.depth : 'explain';
const uniqueStrings = value => [...new Set(value)];
const textList = value => Array.isArray(value) ? value.filter(x => typeof x === 'string') : typeof value === 'string' && value.trim() ? [value] : [];

export function createLearning(dependencies) {
  const { settings, getNote, eligible, queue, ai, promptText, parseJSON, confirmNote, updateSettings } = dependencies;
  const learningClock = dependencies.learningClock || (() => new Date());
  const now = () => learningClock().toISOString();
  const practiceTags = (...records) => {
    const presetCase = dependencies.practice && records.map(record => record?.presetCase || record?.meta?.presetCase).find(value => typeof value === 'string' && value);
    return presetCase ? { presetCase, demo: true, practice: true } : {};
  };
  // Read the getter at each operation so changing the configured Vault does not retain an old Store.
  const storage = () => dependencies.store;
  const privacyFor = note => dependencies.privacyFor ? dependencies.privacyFor(note) : note.meta.privacy;
  const completedIds = () => {
    const store = storage();
    return new Set([
      ...store.records('sessions').filter(s => s.status === 'completed' && s.completion?.reviewSettled).map(s => s.noteId),
      ...store.list().filter(n => n.kind === 'knowledge' && n.meta.confirmedAt).map(n => n.id),
    ]);
  };
  const topicPaused = topic => topic.meta.paused ?? storage().get('topics', topic.id, {}).paused ?? false;
  function topicPath(topic, all) {
    const notes = new Map(all.filter(n => n.kind === 'knowledge').map(n => [n.id, n]));
    const ordered = [], visiting = new Set(), seen = new Set();
    const visit = id => {
      if (dependencies.strictPrerequisites && !notes.has(id)) { if (!seen.has(id)) { seen.add(id); ordered.push(id); } return; }
      if (!notes.has(id) || seen.has(id) || visiting.has(id)) return;
      visiting.add(id);
      for (const predecessor of textList(notes.get(id).meta.prerequisites)) visit(predecessor);
      visiting.delete(id); seen.add(id); ordered.push(id);
    };
    for (const id of textList(topic.meta.prerequisites)) visit(id);
    for (const id of textList(topic.meta.noteIds)) visit(id);
    return ordered;
  }
  function topicDetails(topic, all = storage().list()) {
    const done = completedIds(), byId = new Map(all.map(n => [n.id, n]));
    const pausedIds = settings().pausedIds || [];
    const members = textList(topic.meta.noteIds).map((id, index) => {
      const n = byId.get(id);
      return { id, index, title: n?.title || '内容已删除或暂不可读', stage: n?.meta.stage, depth: n ? depthOf(n) : null, completed: done.has(id), available: Boolean(n && eligible(n) && learningStages.has(n.meta.stage) && !pausedIds.includes(id)) };
    });
    const path = topicPath(topic, all);
    // A missing/inactive prerequisite remains a visible gap, rather than being silently skipped.
    const nextId = path.find(id => !done.has(id));
    const next = nextId ? byId.get(nextId) : null;
    const canStart = next && eligible(next) && learningStages.has(next.meta.stage) && !pausedIds.includes(next.id) && !topicPaused(topic);
    return {
      ...topic, ...topic.meta, paused: topicPaused(topic), members,
      progress: { total: members.length, completedCount: members.filter(m => m.completed).length, completedNoteIds: members.filter(m => m.completed).map(m => m.id), nextNoteId: canStart ? next.id : null, nextNoteTitle: canStart ? next.title : null, blockedNoteId: dependencies.strictPrerequisites ? nextId && !canStart ? nextId : null : next && !canStart ? next.id : null },
    };
  }
  function topics() { const store = storage(); store.scan(); const all = store.list(); return all.filter(n => n.kind === 'topic').map(n => topicDetails(n, all)); }

  function today() {
    const store = storage(); store.scan();
    const config = settings(), timestamp = now(), date = dayAt(new Date(timestamp), config.timezone);
    const all = store.list(), byId = new Map(all.map(n => [n.id, n]));
    const bundles = all.filter(n => n.kind === 'topic').sort((a, b) => Number(config.focusTopics.includes(b.title)) - Number(config.focusTopics.includes(a.title)) || a.id.localeCompare(b.id));
    const pausedMembers = new Set(bundles.filter(topicPaused).flatMap(n => textList(n.meta.noteIds)));
    const candidates = all.filter(n => eligible(n) && learningStages.has(n.meta.stage) && !config.pausedIds.includes(n.id) && !pausedMembers.has(n.id));
    const candidateMap = new Map(candidates.map(n => [n.id, n]));
    const existing = store.records('plans').filter(p => p.date === date);
    const fixed = existing.filter(p => ['done', 'skip', 'defer', 'pause'].includes(p.state));
    const fixedIds = new Set(fixed.map(p => p.noteId)), done = completedIds();
    const reviews = new Map(store.records('reviews').map(r => [r.noteId, r]));
    // Older review records may not carry noteId; read by key for compatibility.
    for (const n of candidates) if (!reviews.has(n.id)) { const review = store.get('reviews', n.id); if (review) reviews.set(n.id, review); }
    const mistakes = new Map(all.filter(n => n.kind === 'mistake' && n.meta.correctionState === 'open').map(n => [n.meta.noteId, n]));
    const bundleFor = new Map();
    for (const bundle of bundles.filter(n => !topicPaused(n))) for (const id of topicPath(bundle, all)) if (!bundleFor.has(id)) bundleFor.set(id, bundle);
    const due = n => !reviews.get(n.id)?.dueAt || reviews.get(n.id).dueAt <= timestamp;
    const priority = n => reviews.get(n.id)?.dueAt && due(n) ? 0 : mistakes.has(n.id) ? 1 : 2;
    const waiting = candidates.filter(n => due(n) && !fixedIds.has(n.id));
    waiting.sort((a, b) => priority(a) - priority(b) || (reviews.get(a.id)?.dueAt || '').localeCompare(reviews.get(b.id)?.dueAt || '') || Number(config.focusTopics.includes(b.meta.topic)) - Number(config.focusTopics.includes(a.meta.topic)) || String(a.meta.topic || '').localeCompare(String(b.meta.topic || '')) || a.id.localeCompare(b.id));
    const ordered = [], selected = new Set(), visiting = new Set(), blocked = [];
    const dependenciesFor = n => {
      const bundle = bundleFor.get(n.id), path = bundle ? topicPath(bundle, all) : [];
      const index = path.indexOf(n.id);
      return uniqueStrings([...textList(n.meta.prerequisites).filter(id => dependencies.strictPrerequisites || byId.get(id)?.kind === 'knowledge'), ...(index > 0 ? path.slice(0, index) : [])]);
    };
    function visit(note) {
      if (selected.has(note.id)) return true;
      if (visiting.has(note.id)) { blocked.push({ noteId: note.id, reason: '前置知识形成循环，请调整主题顺序或前置关系。' }); return false; }
      visiting.add(note.id);
      for (const id of dependenciesFor(note)) {
        if (done.has(id) || selected.has(id)) continue;
        const predecessor = candidateMap.get(id);
        if (!predecessor || fixedIds.has(id) || !due(predecessor) || !visit(predecessor)) {
          blocked.push({ noteId: note.id, prerequisiteId: id, reason: '请先处理前置知识；已暂停、待研究或被跳过的前置项不会自动跳过。' });
          visiting.delete(note.id); return false;
        }
      }
      visiting.delete(note.id); selected.add(note.id); ordered.push(note); return true;
    }
    for (const n of waiting) visit(n);
    let used = fixed.filter(p => p.state === 'done').reduce((sum, p) => sum + p.minutes, 0);
    const pending = [], scheduledIds = new Set();
    for (const note of ordered) {
      const prerequisiteId = dependenciesFor(note).find(id => !done.has(id) && !scheduledIds.has(id));
      if (prerequisiteId) {
        blocked.push({ noteId: note.id, prerequisiteId, reason: '前置知识尚未进入今日安排，请先查看前置知识的未安排原因；可调整预算或改天学习。' });
        continue;
      }
      const minutes = goals[depthOf(note)].minutes;
      if (used + minutes > config.dailyMinutes) continue;
      const review = reviews.get(note.id), mistake = mistakes.get(note.id), bundle = bundleFor.get(note.id);
      const item = {
        id: `${date}:${note.id}`, date, noteId: note.id, title: note.title, kind: mistake ? 'mistake' : review ? 'review' : 'learn',
        reason: mistake ? '针对尚未解决的具体误解练习' : review ? '优先安排已经到期的复习' : bundle ? `按「${bundle.title}」的前置知识与顺序学习` : `当前主题 ${note.meta.topic || '自主学习'} 的新知识`,
        minutes, state: 'pending', depth: depthOf(note), ...practiceTags(mistake, note), ...(mistake ? { mistakeId: mistake.id } : {}),
        ...(bundle ? { topicId: bundle.id, topicIndex: (bundle.meta.noteIds || []).indexOf(note.id) } : {}),
      };
      store.put('plans', item.id, item); pending.push(item); scheduledIds.add(note.id); used += minutes;
    }
    for (const p of existing) if (!fixedIds.has(p.noteId) && !scheduledIds.has(p.noteId)) {
      store.put('plans', p.id, { ...p, state: candidateMap.has(p.noteId) ? 'budget_deferred' : 'paused' });
    }
    const unavailable = all.filter(n => n.kind === 'knowledge' && !scheduledIds.has(n.id)).map(note => {
      const materialIssues = dependencies.limitationsFor?.(note) || note.meta.researchLimitations || [];
      const result = (code, reason) => {
        const inputs = uniqueStrings(textList(note.meta.sources?.filter(ref => ref.role === 'input').map(ref => ref.id)));
        const targetId = note.meta.processKey ? note.meta.processKey.split(':')[0] : inputs.length === 1 ? inputs[0] : null;
        const sourceId = code === 'material' && materialIssues.length && byId.get(targetId)?.kind === 'source' ? targetId : null;
        return { noteId: note.id, title: note.title, code, reason, ...(sourceId ? { sourceId } : {}) };
      };
      if (note.meta.supersededBy) return result('superseded', '这条知识已被合并或替代，请查看保留的知识；重新加工不能恢复旧条目的学习状态。');
      if (note.meta.stage === 'retired') return result('retired', '这条知识已设为不再使用，因此不进入今日清单。若想继续，请打开知识详情重新选择学习状态并填写理由。');
      if (!eligible(note)) return result('material', materialIssues.join('；') || '这条知识暂不符合学习条件，请查看知识详情。');
      if (!learningStages.has(note.meta.stage)) return result('stage', '还未加入学习。请打开知识详情，选择“加入学习”并填写理由。');
      if (config.pausedIds.includes(note.id) || pausedMembers.has(note.id)) return result('paused', '这条知识或所属主题已暂停，请在系统的暂停项或主题详情中恢复。');
      const fixedPlan = fixed.find(p => p.noteId === note.id);
      if (fixedPlan) return result('today_action', fixedPlan.state === 'done' ? '今天已完成这项学习。' : '今天已跳过、延期或暂停，请查看今日安排；下一天会重新按规则安排。');
      if (!due(note)) return result('not_due', Number.isFinite(Date.parse(reviews.get(note.id).dueAt)) ? `还未到复习时间：${dayAt(new Date(reviews.get(note.id).dueAt), config.timezone)}（${config.timezone}）。可到期再生成清单；教程可使用“跳到下次复习”。` : '复习时间记录无效，请查看知识详情和复习记录。');
      const blocker = blocked.find(item => item.noteId === note.id);
      if (blocker) return { ...result('prerequisite', blocker.reason), ...(blocker.prerequisiteId && byId.has(blocker.prerequisiteId) ? { prerequisiteId: blocker.prerequisiteId, prerequisiteTitle: byId.get(blocker.prerequisiteId).title } : {}) };
      return result('budget', `今日剩余预算 ${Math.max(0, config.dailyMinutes - used)} 分钟；这条知识需要 ${goals[depthOf(note)].minutes} 分钟，或其前置项尚未安排。可调整预算或改天学习。`);
    });
    return { date, items: [...fixed, ...pending], minutes: pending.reduce((sum, p) => sum + p.minutes, 0), budget: config.dailyMinutes, backlog: Math.max(0, waiting.length - pending.length), blocked, unavailable, reason: '先安排到期复习和薄弱点，再按主题前置顺序学习；超出预算的材料留待以后。' };
  }
  function planAction(id, { action, days = 1 }) {
    const store = storage(), plan = store.get('plans', id);
    if (!plan) fail('找不到学习安排。', 'NOT_FOUND', 404);
    if (!['skip', 'defer', 'pause'].includes(action)) fail('安排动作无效。');
    if (plan.state === 'done') fail('已结束的学习安排不能改成跳过或延期。');
    if (action === 'defer') store.put('reviews', plan.noteId, { ...store.get('reviews', plan.noteId, {}), ...practiceTags(plan, dependencies.practice && store.row(plan.noteId) ? getNote(plan.noteId) : null), noteId: plan.noteId, dueAt: new Date(Date.parse(now()) + Math.min(365, Math.max(1, +days || 1)) * 86400000).toISOString() });
    if (action === 'pause') updateSettings({ pausedIds: [...new Set([...settings().pausedIds, plan.noteId])] });
    return store.put('plans', id, { ...plan, state: action, updatedAt: now() });
  }
  function session(id) {
    const store = storage(), s = store.get('sessions', id);
    if (!s) fail('学习会话不存在。', 'NOT_FOUND', 404);
    const topic = s.topicId && store.row(s.topicId) ? store.read(s.topicId) : null;
    return { ...s, ...(topic?.kind === 'topic' ? { topicProgress: topicDetails(topic).progress } : {}) };
  }
  function mistakeSection(note, heading) {
    const prefix = `## ${heading}\n`, text = note.body.slice(note.body.lastIndexOf(prefix) + prefix.length);
    return note.body.includes(prefix) ? text.split(/\n## |\n### |\n---/)[0].trim() : '';
  }
  function startStudy({ noteId, planId, topicId, mistakeId } = {}) {
    const store = storage();
    const plan = planId ? store.get('plans', planId) : null;
    mistakeId ||= plan?.mistakeId; topicId ||= plan?.topicId;
    let mistake;
    if (mistakeId) {
      mistake = getNote(mistakeId);
      if (mistake.kind !== 'mistake' || mistake.meta.correctionState !== 'open') fail('只有未解决且未被质疑或撤销的错题可以进入纠错练习。', 'MISTAKE_INACTIVE');
      if (noteId && noteId !== mistake.meta.noteId) fail('错题与知识不一致。');
      noteId = mistake.meta.noteId;
    }
    const note = getNote(noteId);
    if (!eligible(note)) fail('这份材料含待补研究或旧结论，请先处理材料。', 'RESEARCH_REQUIRED');
    if (!learningStages.has(note.meta.stage)) fail('请先将知识加入学习。');
    if (planId && (plan?.noteId !== noteId || plan.state !== 'pending')) fail('学习安排已变化，请刷新今日清单。');
    let topic;
    if (topicId) {
      topic = getNote(topicId);
      if (topic.kind !== 'topic' || !topicPath(topic, store.list()).includes(noteId)) fail('主题学习包不包含这项知识。');
      if (topicPaused(topic)) fail('这个主题学习包已暂停。');
    }
    const depth = depthOf(note), goal = goals[depth].label;
    const mistakeContext = mistake ? {
      id: mistake.id, omission: mistake.meta.omission || mistakeSection(mistake, 'AI 指出的误解或遗漏（可质疑）'),
      correction: mistake.meta.correction || mistakeSection(mistake, '修正与依据'),
      nextQuestion: mistake.meta.nextQuestion || mistakeSection(mistake, '后续练习'),
    } : null;
    const question = mistake ? mistakeContext.nextQuestion || `请针对上次的误解「${mistakeContext.omission || mistake.title}」重新解释，并说明修正依据和适用边界。` : dependencies.getPracticeQuestion?.(note) || goals[depth].question(note.title);
    const id = randomUUID();
    const privacy = privacyFor(note) === 'cloud' && (!mistake || privacyFor(mistake) === 'cloud') ? 'cloud' : 'local';
    store.put('sessions', id, { id, noteId, planId, status: 'reading', question, material: note.body, sourceHash: note.hash, depth, goal, privacy, turns: [], createdAt: now(), hintCount: 0, ...practiceTags(mistake, note), ...(topic ? { topicId, topicIndex: textList(topic.meta.noteIds).indexOf(noteId) } : {}), ...(mistake ? { mistakeId, mistakeContext } : {}) });
    return session(id);
  }
  function answerStudy(id, { answer, hintUsed = false, requestId }) {
    const store = storage(), s = session(id);
    if (!String(answer || '').trim()) fail('请先填写自己的回答。');
    if (!requestId) fail('缺少防重提交标识。');
    if (s.turns.some(t => t.requestId === requestId)) return s;
    if (s.status === 'completed') fail('这次练习已经结束；可开始一次新的练习。', 'SESSION_COMPLETED', 409);
    if (s.status === 'awaiting_feedback' || s.pendingJobId) fail('上一轮反馈仍在等待处理；你的上一份回答已保存。', 'BUSY', 409);
    const turn = { id: randomUUID(), requestId, question: s.question, answer, goal: s.goal || goals[s.depth || 'explain'].label, hintUsed: !!hintUsed || s.hintCount > 0, createdAt: now() };
    s.turns.push(turn); s.status = 'awaiting_feedback'; s.hintCount = 0;
    if (dependencies.assessmentMode === 'offline') {
      turn.assessment = 'unassessed';
      s.status = 'unassessed';
      s.pendingJobId = null;
      return store.put('sessions', id, s);
    }
    const job = queue('grade', { sessionId: id, turnId: turn.id }, `grade:${id}:${turn.id}`); s.pendingJobId = job.id;
    return store.put('sessions', id, s);
  }
  function hintStudy(id) {
    const store = storage(), s = session(id);
    if (s.status === 'completed') fail('这次练习已经结束。', 'SESSION_COMPLETED', 409);
    s.hintCount++; store.put('sessions', id, s);
    const first = s.mistakeContext ? `先检查上次遗漏之处：${s.mistakeContext.omission || '比较问题条件与自己的回答。'}` : goals[s.depth || 'explain'].hint;
    return { hint: s.hintCount === 1 ? first : s.mistakeContext?.correction || s.material.slice(0, 600), hintUsed: true };
  }

  function finishStudy(id) {
    const store = storage(), s = session(id);
    if (s.status === 'completed') return s;
    if (!s.turns.length) fail('请先留下至少一次自己的回答。');
    if (dependencies.assessmentMode === 'offline') {
      const timestamp = now(), date = dayAt(new Date(timestamp), settings().timezone), note = getNote(s.noteId);
      if (note.hash !== s.sourceHash) fail('学习材料已有更新，请按当前材料重新开始。', 'SOURCE_CHANGED');
      const depth = s.depth || depthOf(note), usedHints = s.turns.some(t => t.hintUsed);
      const evidence = { sessionId: s.id, noteId: s.noteId, day: date, completedAt: timestamp, depth,
        independent: false, usedHints, errorObserved: false, ambiguous: false,
        explanationPractice: false, applicationPractice: false, spacedRecall: false,
        assessment: 'unassessed', turnIds: s.turns.map(t => t.id), reviewSettled: false, ...practiceTags(s, note) };
      s.status = 'completed'; s.completedAt = timestamp;
      s.completion = { reviewSettled: false, interval: null, sameDayPractice: false, evidence, ...practiceTags(s, note),
        reason: '已保存本次离线练习；回答尚未评估，只记为本地完成记录，不更新复习间隔或掌握程度。' };
      store.db.exec('BEGIN IMMEDIATE');
      try {
        for (const plan of store.records('plans').filter(p => p.noteId === s.noteId && p.state === 'pending' && (p.id === s.planId || p.date === date)))
          store.put('plans', plan.id, { ...plan, state: 'done', completedAt: timestamp, assessment: 'unassessed', completionReason: s.completion.reason });
        store.put('studyEvidence', s.id, evidence);
        store.put('sessions', s.id, s);
        store.db.exec('COMMIT');
      } catch (error) { store.db.exec('ROLLBACK'); throw error; }
      return session(id);
    }
    if (s.pendingJobId || s.status === 'awaiting_feedback' || s.turns.some(t => !t.feedback)) fail('反馈尚未完成，回答已保存；收到反馈后再结束练习。', 'FEEDBACK_PENDING', 409);
    const timestamp = now(), date = dayAt(new Date(timestamp), settings().timezone), note = getNote(s.noteId);
    if (note.hash !== s.sourceHash) fail('学习材料已有更新，请按当前材料重新开始。', 'SOURCE_CHANGED');
    const old = store.get('reviews', s.noteId, {}), depth = s.depth || depthOf(note);
    const usedHints = s.turns.some(t => t.hintUsed), errors = s.turns.some(t => ['partial', 'incorrect'].includes(t.feedback.assessment));
    const disputed = store.list().some(m => m.kind === 'mistake' && ['disputed', 'revoked'].includes(m.meta.correctionState) && (m.id === s.mistakeId || textList(m.meta.sessions).includes(s.id)));
    const ambiguous = disputed || s.turns.some(t => t.feedback.assessment === 'ambiguous' || t.feedback.disputedMisconception === true);
    const independent = !usedHints && !errors && !ambiguous && s.turns.every(t => t.feedback.assessment === 'correct');
    const oldDay = old.lastSettledDay || (old.lastSession && store.get('sessions', old.lastSession)?.completedAt ? dayAt(new Date(store.get('sessions', old.lastSession).completedAt), settings().timezone) : null);
    const sameDay = oldDay === date;
    const spaced = Boolean(independent && old.lastSuccessfulDay && old.lastSuccessfulDay < date && old.dueAt && old.dueAt <= timestamp);
    const interval = usedHints || errors ? 1 : sameDay ? Math.max(1, Number(old.interval) || 1) : spaced ? Math.min(120, Math.max(2, (Number(old.interval) || 1) * 2)) : Math.max(1, Number(old.interval) || 1);
    const reviewSettled = !ambiguous;
    const assessment = ambiguous ? 'ambiguous' : errors ? 'needs_practice' : independent ? 'correct' : 'with_hints';
    const evidence = {
      sessionId: s.id, noteId: s.noteId, day: date, completedAt: timestamp, depth, independent, usedHints, errorObserved: errors, ambiguous,
      explanationPractice: independent && ['explain', 'apply'].includes(depth), applicationPractice: independent && depth === 'apply', spacedRecall: spaced,
      assessment, turnIds: s.turns.map(t => t.id), reviewSettled, ...practiceTags(s, note),
    };
    s.status = 'completed'; s.completedAt = timestamp;
    s.completion = { reviewSettled, interval: reviewSettled ? interval : null, sameDayPractice: sameDay, evidence, ...practiceTags(s, note), reason: ambiguous ? '本次存在争议，已保留练习记录，未更新复习间隔。' : usedHints || errors ? '本次使用提示或出现错误，安排近期再练。' : spaced ? '到期后在另一天独立作答，增加复习间隔。' : sameDay ? '同日追加练习不叠加复习间隔。' : '首次独立练习先安排近期复习，之后依据跨日表现调整。' };
    store.db.exec('BEGIN IMMEDIATE');
    try {
      if (reviewSettled) {
        const dueAt = sameDay && !usedHints && !errors && old.dueAt ? old.dueAt : new Date(Date.parse(timestamp) + interval * 86400000).toISOString();
        store.put('reviews', s.noteId, { ...old, ...practiceTags(s, note), noteId: s.noteId, interval, dueAt, lastSession: s.id, lastSettledDay: date, lastSuccessfulDay: independent ? date : old.lastSuccessfulDay || null, lastAssessment: assessment, hintUsed: usedHints });
        for (const plan of store.records('plans').filter(p => p.noteId === s.noteId && p.state === 'pending' && (p.id === s.planId || p.date === date))) store.put('plans', plan.id, { ...plan, state: 'done', completedAt: timestamp });
      }
      store.put('studyEvidence', s.id, evidence);
      store.put('sessions', s.id, s);
      store.db.exec('COMMIT');
    } catch (error) { store.db.exec('ROLLBACK'); throw error; }
    return session(id);
  }
  function confirmStudy(id, { body }) {
    const store = storage(), s = session(id);
    if (!s.turns.length) fail('请先留下至少一次自己的解释。');
    const n = getNote(s.noteId), wasCurrent = n.hash === s.sourceHash, result = confirmNote(n.id, { body, expectedHash: n.hash });
    s.confirmedNoteId = result.id;
    // The explicit confirmation appends the user's own note; the original teaching snapshot stays separate.
    if (wasCurrent) s.sourceHash = result.hash;
    store.put('sessions', id, s);
    if (wasCurrent && !s.pendingJobId && s.status !== 'awaiting_feedback' && (dependencies.assessmentMode === 'offline' || s.turns.every(t => t.feedback))) finishStudy(id);
    return result;
  }
  function mistakeAction(id, { action, reason = '' }) {
    const n = getNote(id), store = storage();
    if (n.kind !== 'mistake') fail('条目不是错题记录。');
    const states = { dispute: 'disputed', resolve: 'resolved', reopen: 'open', revoke: 'revoked' };
    if (!states[action]) fail('错题动作无效。');
    return store.update(id, { expectedHash: n.hash, meta: { correctionState: states[action], userReason: reason }, body: `${n.body}\n\n### 用户处理 ${now()}\n${action}：${reason}` });
  }
  function validateTopic({ noteIds, prerequisites, minutes }) {
    if (typeof prerequisites === 'string') prerequisites = textList(prerequisites);
    if (!Array.isArray(noteIds) || !Array.isArray(prerequisites) || [...noteIds, ...prerequisites].some(x => typeof x !== 'string')) fail('主题知识与前置知识应为文本列表。');
    if (noteIds.length > 500 || prerequisites.length > 100) fail('单个主题的知识或前置项过多，请拆分主题。');
    for (const id of noteIds) if (getNote(id).kind !== 'knowledge') fail('主题成员应选择知识条目，不能选择原始资料或报告。');
    if (dependencies.validateTopicPrerequisites) dependencies.validateTopicPrerequisites(prerequisites);
    if (!Number.isFinite(+minutes) || +minutes < 1 || +minutes > 1440) fail('预计投入应为 1–1440 分钟。');
    return { noteIds: uniqueStrings(noteIds), prerequisites: uniqueStrings(prerequisites.map(x => x.trim()).filter(Boolean)), minutes: +minutes };
  }
  function synchronizeTopicLinks(topic) {
    const store = storage(), preview = store.managedLinksPreview(topic.id);
    const current = preview.changed && !preview.conflict ? store.syncManagedLinks(topic.id, { expectedHash: preview.expectedHash }) : store.read(topic.id);
    return { ...topicDetails(current), linkSyncConflict: preview.conflict || null };
  }
  function createTopic({ title, body = '', noteIds = [], prerequisites = [], minutes = 20 }) {
    const store = storage();
    if (!String(title || '').trim()) fail('请填写主题名称。');
    const fields = validateTopic({ noteIds, prerequisites, minutes });
    const n = store.create({ kind: 'topic', title, body: body || `# ${title}\n\n在这里记录这个主题要解决的问题、适用范围和学习说明。`, meta: { ...fields, confirmedBy: 'user', privacy: 'local' } });
    store.put('topics', n.id, { id: n.id, noteIds: fields.noteIds, paused: false });
    return synchronizeTopicLinks(n);
  }
  function updateTopic(id, { title, body, expectedHash, meta = {} }) {
    const store = storage(), n = getNote(id);
    if (n.kind !== 'topic') fail('条目不是主题学习包。');
    const fields = validateTopic({ noteIds: meta.noteIds ?? n.meta.noteIds ?? [], prerequisites: meta.prerequisites ?? n.meta.prerequisites ?? [], minutes: meta.minutes ?? n.meta.minutes ?? 20 });
    if (title !== undefined && !String(title).trim() || body !== undefined && !String(body).trim()) fail('主题标题和正文不能为空。');
    const result = store.update(id, { title, body, expectedHash, meta: { ...fields, confirmedBy: 'user' } });
    store.put('topics', id, { id, noteIds: fields.noteIds, paused: topicPaused(result) });
    return synchronizeTopicLinks(result);
  }
  function topicAction(id, { action }) {
    const store = storage(), n = getNote(id);
    if (n.kind !== 'topic' || !['pause', 'resume'].includes(action)) fail('主题操作无效。');
    const result = store.update(id, { expectedHash: n.hash, meta: { paused: action === 'pause' } });
    store.put('topics', id, { id, noteIds: n.meta.noteIds || [], paused: action === 'pause' });
    return topicDetails(result);
  }
  async function grade(job, signal) {
    if (dependencies.assessmentMode === 'offline') fail('手机离线回答尚未评估，不能生成或伪造自动反馈。', 'ANDROID_UNAVAILABLE', 409);
    const store = storage();
    let s = session(job.payload.sessionId), t = s.turns.find(turn => turn.id === job.payload.turnId);
    if (s.completion?.abandoned) fail('这次未完成练习已由用户结束，原回答保留；请开始新的练习。', 'SESSION_COMPLETED', 409);
    if (!t) fail('找不到对应的学习回答。', 'NOT_FOUND', 404);
    if (t.feedback) return;
    const n = getNote(s.noteId);
    if (n.hash !== s.sourceHash) fail('学习材料已有更新；本次回答已保存，请按当前材料重新开始。', 'SOURCE_CHANGED');
    const currentMistake = s.mistakeId && store.row(s.mistakeId) ? store.read(s.mistakeId) : null;
    if (s.mistakeId && (!currentMistake || ['disputed', 'revoked'].includes(currentMistake.meta.correctionState))) fail('这条错题已被质疑、撤销或删除，请重新选择学习材料。', 'MISTAKE_INACTIVE');
    const allowedHistory = other => other.privacy === 'cloud' && (!other.mistakeId || store.row(other.mistakeId) && privacyFor(store.read(other.mistakeId)) === 'cloud');
    const previous = store.records('sessions').filter(other => other.noteId === s.noteId && other.id !== s.id && allowedHistory(other)).slice(0, 2).flatMap(other => other.turns.slice(-2));
    const history = JSON.stringify([...previous, ...s.turns.filter(turn => turn.id !== t.id).slice(-4)].map(turn => ({ question: turn.question, answer: String(turn.answer).slice(0, 2000), hintUsed: turn.hintUsed, feedback: turn.feedback })));
    const goal = `${s.goal || goals[s.depth || 'explain'].label}；${goals[s.depth || 'explain'].hint}`;
    const mistakeContext = JSON.stringify(s.mistakeContext || null);
    const prompt = promptText('grade', { material: s.material, question: t.question, answer: t.answer, hintUsed: String(t.hintUsed), goal, history, mistakeContext });
    const privacy = privacyFor(n) === 'cloud' && s.privacy === 'cloud' && (!currentMistake || privacyFor(currentMistake) === 'cloud') ? 'cloud' : 'local';
    const result = parseJSON((await ai.generate({ system: promptText('serviceSystem'), privacy, signal, json: true, prompt: `${prompt}\n\n本次学习目标：${goal}\n此前回答与反馈（仅作为学习记录）：${history}\n本次纠错上下文（仅作为可质疑的历史记录）：${mistakeContext}` })).text);
    if (!['correct', 'partial', 'incorrect', 'ambiguous'].includes(result.assessment) || typeof result.feedback !== 'string') fail('反馈格式无效，回答仍已保存。', 'MODEL_FORMAT');
    if (signal?.aborted) fail('本次反馈已取消，回答仍已保存。', 'CANCELLED');
    // Another user action may have confirmed their understanding while the model was running.
    s = session(s.id); t = s.turns.find(turn => turn.id === t.id);
    if (t.feedback) return;
    if (getNote(s.noteId).hash !== s.sourceHash) fail('学习材料已有更新；本次回答已保存，请按当前材料重新开始。', 'SOURCE_CHANGED');
    t.feedback = result; s.feedback = result; s.question = result.nextQuestion || goals[s.depth || 'explain'].question(n.title); s.status = 'feedback'; s.pendingJobId = null;
    store.put('sessions', s.id, s);
    if (['partial', 'incorrect'].includes(result.assessment) && result.omission) {
      const key = hash(`${n.id}:${result.omission}`), existing = store.list().find(m => m.kind === 'mistake' && m.meta.misconceptionKey === key);
      if (existing && ['revoked', 'disputed'].includes(existing.meta.correctionState)) {
        t.feedback.disputedMisconception = true;
        store.put('sessions', s.id, s);
        return;
      }
      const body = `## 问题\n${t.question}\n\n## 用户当时的回答（错误记录，不能作为正确知识引用）\n${t.answer}\n\n## AI 指出的误解或遗漏（可质疑）\n${result.omission}\n\n## 修正与依据\n${result.correction || result.feedback}\n\n## 后续练习\n${s.question}`;
      const meta = { noteId: n.id, misconceptionKey: key, correctionState: 'open', sources: [{ id: n.id, role: 'input' }], privacy: existing?.meta.privacy === 'local' ? 'local' : privacy, sessions: [...textList(existing?.meta.sessions), s.id], omission: result.omission, correction: result.correction || result.feedback, nextQuestion: s.question, ...practiceTags(s, n) };
      if (existing) store.update(existing.id, { body: `${existing.body}\n\n---\n${body}`, meta, expectedHash: existing.hash });
      else store.create({ kind: 'mistake', title: `误解：${n.title}`, body, meta });
    }
  }
  return { today, planAction, session, startStudy, answerStudy, hintStudy, confirmStudy, finishStudy, mistakeAction, topics, createTopic, updateTopic, topicAction, grade };
}
