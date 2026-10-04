import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { createLearning } from '../src/learning.mjs';
import { renderPrompt } from '../src/prompts.mjs';
import { createAI } from '../src/ai.mjs';

const tempRoot = path.resolve(import.meta.dirname, '..', '.tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const correct = () => ({ assessment: 'correct', feedback: '受控离线反馈：回答满足本次目标。', nextQuestion: '换一个条件时如何判断？' });

function harness(t) {
  const root = fs.mkdtempSync(path.join(tempRoot, 'learning-alignment-'));
  let store = new Store({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault') });
  let config = { dailyMinutes: 25, timezone: 'Asia/Shanghai', focusTopics: [], pausedIds: [] };
  const calls = [], responses = [];
  const getNote = id => { store.scan(); return store.read(id); };
  const dependencies = {
    get store() { return store; }, settings: () => config, getNote,
    eligible: n => n.kind === 'knowledge' && n.meta.stage !== 'retired' && !n.meta.supersededBy && !n.meta.researchLimitations?.length,
    updateSettings: input => { config = { ...config, ...input }; return config; },
    queue(type, payload, dedupKey) { const id = randomUUID(); return store.put('jobs', id, { id, type, payload, dedupKey, state: 'queued' }); },
    ai: { async generate(input) { calls.push(input); return { text: JSON.stringify(responses.shift() || correct()) }; } },
    promptText: renderPrompt, parseJSON: JSON.parse,
    confirmNote(id, { body, expectedHash }) {
      const n = getNote(id);
      if (!String(body || '').trim()) throw new Error('请填写你自己的理解。');
      return store.update(id, { expectedHash, meta: { stage: 'integrated', personalUnderstanding: body, confirmedAt: new Date().toISOString(), confirmedBy: 'user' }, body: `${n.body.split('\n## 我的理解（用户确认）')[0]}\n\n## 我的理解（用户确认）\n\n${body}` });
    },
  };
  const learning = createLearning(dependencies);
  t.after(() => {
    store.close();
    const target = path.resolve(root);
    assert.ok(target.startsWith(`${tempRoot}${path.sep}`));
    assert.match(path.basename(target), /^learning-alignment-/);
    fs.rmSync(target, { recursive: true, force: true });
  });
  const h = {
    learning, calls, responses, dependencies, get store() { return store; },
    configure: dependencies.updateSettings,
    knowledge(title, meta = {}) { return store.create({ kind: 'knowledge', title, body: `【合成测试】${title}的正文与条件。`, meta: { stage: 'learning', privacy: 'local', depth: 'explain', ...meta } }); },
    async answer(sessionId, answer = '我的合成回答', response) {
      if (response) responses.push(response);
      const s = learning.answerStudy(sessionId, { answer, requestId: randomUUID() });
      await learning.grade(store.get('jobs', s.pendingJobId));
      return learning.session(sessionId);
    },
    reopen() { store.close(); store = new Store({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault') }); },
  };
  return h;
}

test('overdue reviews and unresolved mistakes are selected before new learning within a small budget', t => {
  const h = harness(t), overdue = h.knowledge('到期复习'), fresh = h.knowledge('新知识');
  h.configure({ dailyMinutes: 5 });
  h.store.put('reviews', overdue.id, { noteId: overdue.id, interval: 8, dueAt: new Date(Date.now() - 2 * 86400000).toISOString() });
  let result = h.learning.today();
  assert.deepEqual(result.items.map(x => x.noteId), [overdue.id]);
  assert.equal(result.items[0].kind, 'review');
  h.learning.planAction(result.items[0].id, { action: 'skip' });
  const mistake = h.store.create({ kind: 'mistake', title: '合成误解', body: '合成纠错记录', meta: { noteId: fresh.id, correctionState: 'open' } });
  h.knowledge('另一个新知识');
  result = h.learning.today();
  assert.equal(result.items.find(x => x.state === 'pending').mistakeId, mistake.id);
  assert.equal(h.calls.length, 0);
});

test('unscheduled knowledge exposes stage, research, pause, due time and budget without changing eligibility', t => {
  const h = harness(t), candidate = h.knowledge('未选学', { stage: 'candidate' }), blocked = h.knowledge('未核验', { researchLimitations: ['待核验'] });
  const paused = h.knowledge('暂停'), future = h.knowledge('未到期'), budget = h.knowledge('时间不足');
  h.configure({ dailyMinutes: 1, pausedIds: [paused.id] });
  h.store.put('reviews', future.id, { noteId: future.id, dueAt: '2099-01-01T00:00:00.000Z' });
  const result = h.learning.today(), reasons = new Map(result.unavailable.map(item => [item.noteId, item]));
  assert.equal(result.items.length, 0);
  assert.equal(reasons.get(candidate.id).code, 'stage');
  assert.equal(reasons.get(blocked.id).code, 'material');
  assert.equal(reasons.get(paused.id).code, 'paused');
  assert.equal(reasons.get(future.id).code, 'not_due');
  assert.match(reasons.get(future.id).reason, /2099-01-01/);
  assert.equal(reasons.get(budget.id).code, 'budget');
  assert.match(reasons.get(budget.id).reason, /1 分钟.*5 分钟/);
  assert.deepEqual(h.learning.today(), result, 'repeated generation stays idempotent');
  assert.equal(h.calls.length, 0);
});

test('unavailable prerequisites stay identifiable while retired and superseded notes never offer reprocessing', t => {
  const h = harness(t), source = h.store.create({ kind: 'source', title: '合成来源', body: '合成原文' });
  const refs = [{ id: source.id, role: 'input' }];
  const retired = h.knowledge('已停用', { stage: 'retired', sources: refs }), replaced = h.knowledge('已替代', { supersededBy: 'synthetic-new', sources: refs });
  const prerequisite = h.knowledge('必须先处理', { researchLimitations: ['待核验'], sources: refs });
  const dependent = h.knowledge('后续知识', { prerequisites: [prerequisite.id] });
  const reasons = new Map(h.learning.today().unavailable.map(item => [item.noteId, item]));
  assert.equal(reasons.get(retired.id).code, 'retired');
  assert.equal(reasons.get(replaced.id).code, 'superseded');
  assert.equal(reasons.get(retired.id).sourceId, undefined);
  assert.equal(reasons.get(replaced.id).sourceId, undefined);
  assert.equal(reasons.get(prerequisite.id).sourceId, source.id);
  assert.equal(reasons.get(dependent.id).prerequisiteId, prerequisite.id);
  assert.equal(reasons.get(dependent.id).prerequisiteTitle, prerequisite.title);
  assert.equal(h.calls.length, 0);
});

test('a prerequisite omitted by the budget pass identifies the actual blocker instead of teaching its dependent', t => {
  const h = harness(t), prerequisite = h.knowledge('合成预算前置', { depth: 'apply' });
  const dependent = h.knowledge('合成后续', { depth: 'aware', prerequisites: [prerequisite.id] });
  h.configure({ dailyMinutes: 5 });
  const result = h.learning.today(), reasons = new Map(result.unavailable.map(item => [item.noteId, item]));
  assert.equal(result.items.length, 0);
  assert.equal(reasons.get(prerequisite.id).code, 'budget');
  assert.equal(reasons.get(dependent.id).code, 'prerequisite');
  assert.equal(reasons.get(dependent.id).prerequisiteId, prerequisite.id);
  assert.equal(reasons.get(dependent.id).prerequisiteTitle, prerequisite.title);
  assert.equal(result.blocked.find(item => item.noteId === dependent.id).prerequisiteId, prerequisite.id);
  h.configure({ dailyMinutes: 10 });
  assert.deepEqual(h.learning.today().items.map(item => item.noteId), [prerequisite.id, dependent.id]);
  const legacy = h.store.create({ kind: 'knowledge', title: '合成缺省目标', body: '合成正文', meta: { stage: 'learning' } });
  h.configure({ dailyMinutes: 15 });
  const legacyPlan = h.learning.today().items.find(item => item.noteId === legacy.id);
  assert.equal(legacyPlan.depth, 'explain');
  assert.equal(legacyPlan.minutes, 5);
  assert.equal(h.calls.length, 0);
});

test('topic membership order and explicit prerequisite ids determine the daily learning path', t => {
  const h = harness(t), a = h.knowledge('后创建也可先学'), b = h.knowledge('最后学习'), c = h.knowledge('主题首项'), p = h.knowledge('主题前置'), q = h.knowledge('条目前置');
  h.store.update(b.id, { expectedHash: b.hash, meta: { prerequisites: [q.id] } });
  const topic = h.learning.createTopic({ title: '合成有序主题', body: '主题说明', noteIds: [c.id, a.id, b.id], prerequisites: [p.id, '仅名称的缺口'] });
  const planned = h.learning.today();
  assert.deepEqual(planned.items.map(x => x.noteId), [p.id, c.id, a.id, q.id, b.id]);
  assert.equal(topic.progress.nextNoteId, p.id);
  assert.deepEqual(topic.members.map(x => x.id), [c.id, a.id, b.id]);
  assert.equal(planned.items.every(x => x.topicId === topic.id), true);
  const started = h.learning.startStudy({ noteId: p.id, topicId: topic.id });
  assert.equal(started.topicProgress.nextNoteId, p.id);
  assert.equal(started.topicIndex, -1);
});

test('an inactive prerequisite blocks dependent teaching instead of silently teaching past it', t => {
  const h = harness(t), prerequisite = h.knowledge('待选学前置', { stage: 'candidate' }), dependent = h.knowledge('依赖前置的知识', { prerequisites: [prerequisite.id] });
  const result = h.learning.today();
  assert.equal(result.items.some(x => x.noteId === dependent.id), false);
  assert.equal(result.blocked.some(x => x.prerequisiteId === prerequisite.id), true);
  assert.equal(result.backlog, 1);
});

test('topic members can be added, removed and reordered, with hash checking and synchronized pause membership', t => {
  const h = harness(t), a = h.knowledge('成员甲'), b = h.knowledge('成员乙'), c = h.knowledge('成员丙');
  let topic = h.learning.createTopic({ title: '可调整主题', body: '主题说明', noteIds: [a.id, b.id] });
  const oldHash = topic.hash;
  topic = h.learning.updateTopic(topic.id, { expectedHash: topic.hash, meta: { noteIds: [c.id, a.id], minutes: 10, prerequisites: ['未命名缺口'] } });
  assert.deepEqual(topic.members.map(x => x.id), [c.id, a.id]);
  assert.deepEqual(h.store.get('topics', topic.id).noteIds, [c.id, a.id]);
  assert.throws(() => h.learning.updateTopic(topic.id, { expectedHash: oldHash, meta: { noteIds: [b.id] } }), { code: 'CONFLICT' });
  h.learning.topicAction(topic.id, { action: 'pause' });
  assert.deepEqual(h.learning.today().items.map(x => x.noteId), [b.id]);
  h.learning.topicAction(topic.id, { action: 'resume' });
  assert.deepEqual(h.learning.topics()[0].members.map(x => x.id), [c.id, a.id]);
  assert.equal(h.learning.today().items.some(x => x.noteId === c.id), true);
});

test('replanning remains idempotent and budget changes restore deferred items without duplicate plans', t => {
  const h = harness(t);
  for (let i = 0; i < 5; i++) h.knowledge(`预算项${i}`);
  const first = h.learning.today();
  assert.equal(first.minutes, 25);
  h.configure({ dailyMinutes: 5 });
  const reduced = h.learning.today();
  assert.equal(reduced.minutes, 5);
  assert.equal(h.store.records('plans').filter(p => p.state === 'budget_deferred').length, 4);
  assert.deepEqual(h.learning.today(), reduced);
  h.configure({ dailyMinutes: 25 });
  assert.equal(h.learning.today().minutes, 25);
  assert.equal(h.store.records('plans').length, 5);
});

test('grading saves each turn but only explicit finishing settles a session once and advances topic navigation', async t => {
  const h = harness(t), note = h.knowledge('多轮学习'), next = h.knowledge('下一条知识');
  const topic = h.learning.createTopic({ title: '练习路径', body: '合成说明', noteIds: [note.id, next.id] });
  const plan = h.learning.today().items.find(x => x.noteId === note.id);
  const s = h.learning.startStudy({ noteId: note.id, planId: plan.id });
  for (let i = 0; i < 3; i++) await h.answer(s.id, `第${i + 1}轮独立回答`);
  assert.equal(h.store.get('reviews', note.id), null);
  assert.equal(h.store.get('plans', plan.id).state, 'pending');
  const finished = h.learning.finishStudy(s.id);
  assert.equal(finished.status, 'completed');
  assert.equal(finished.completion.interval, 1);
  assert.equal(finished.topicProgress.nextNoteId, next.id);
  assert.equal(h.store.get('plans', plan.id).state, 'done');
  assert.equal(h.store.records('studyEvidence').length, 1);
  assert.equal(h.store.records('studyEvidence')[0].explanationPractice, true);
  const review = h.store.get('reviews', note.id);
  h.reopen();
  assert.deepEqual(h.learning.finishStudy(s.id).completion, finished.completion);
  assert.deepEqual(h.store.get('reviews', note.id), review);
  assert.equal(h.store.records('studyEvidence').length, 1);
  assert.throws(() => h.learning.answerStudy(s.id, { answer: '不允许继续', requestId: 'later' }), { code: 'SESSION_COMPLETED' });
});

test('same-day sessions never stack intervals; only a later due day with independent answers extends them', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 0, 1, 12) });
  const h = harness(t), note = h.knowledge('跨日复习');
  async function practice() { const s = h.learning.startStudy({ noteId: note.id }); await h.answer(s.id); return h.learning.finishStudy(s.id); }
  const initial = await practice(), repeated = await practice();
  assert.equal(initial.completion.interval, 1);
  assert.equal(repeated.completion.interval, 1);
  assert.equal(repeated.completion.sameDayPractice, true);
  assert.equal(repeated.completion.evidence.spacedRecall, false);
  t.mock.timers.tick(86400001);
  const tomorrow = await practice(), tomorrowAgain = await practice();
  assert.equal(tomorrow.completion.interval, 2);
  assert.equal(tomorrow.completion.evidence.spacedRecall, true);
  assert.equal(tomorrowAgain.completion.interval, 2);
  assert.equal(tomorrowAgain.completion.evidence.spacedRecall, false);
});

test('an error or a hint anywhere in the session prevents interval growth despite a correct final turn', async t => {
  const h = harness(t), note = h.knowledge('谨慎结算');
  h.store.put('reviews', note.id, { noteId: note.id, interval: 16, dueAt: new Date(Date.now() - 86400000).toISOString(), lastSuccessfulDay: '2026-01-01', lastSettledDay: '2026-01-01' });
  const s = h.learning.startStudy({ noteId: note.id });
  await h.answer(s.id, '最初错误', { assessment: 'incorrect', feedback: '遗漏条件', omission: '忘记条件', correction: '补全条件', nextQuestion: '补全后如何解释？' });
  h.learning.hintStudy(s.id);
  await h.answer(s.id, '提示后的正确回答');
  const finished = h.learning.finishStudy(s.id);
  assert.equal(finished.completion.interval, 1);
  assert.equal(finished.completion.evidence.errorObserved, true);
  assert.equal(finished.completion.evidence.usedHints, true);
  assert.equal(finished.completion.evidence.independent, false);
  assert.equal(finished.completion.evidence.spacedRecall, false);
});

test('waiting feedback and ambiguous judgments cannot be treated as completed review evidence', async t => {
  const h = harness(t), note = h.knowledge('反馈边界');
  const plan = h.learning.today().items[0], s = h.learning.startStudy({ noteId: note.id, planId: plan.id });
  const waiting = h.learning.answerStudy(s.id, { answer: '待评估回答', requestId: 'waiting-once' });
  assert.throws(() => h.learning.finishStudy(s.id), { code: 'FEEDBACK_PENDING' });
  const confirmation = h.learning.confirmStudy(s.id, { body: '用户仍可主动确认自己的理解。' });
  assert.equal(confirmation.meta.confirmedBy, 'user');
  assert.equal(h.learning.session(s.id).status, 'awaiting_feedback');
  assert.equal(h.store.get('plans', plan.id).state, 'pending');
  h.responses.push({ assessment: 'ambiguous', feedback: '题目条件有争议。' });
  await h.learning.grade(h.store.get('jobs', waiting.pendingJobId));
  const finished = h.learning.finishStudy(s.id);
  assert.equal(finished.completion.reviewSettled, false);
  assert.equal(h.store.get('reviews', note.id), null);
  assert.equal(h.store.get('plans', plan.id).state, 'pending');
});

test('four depths have distinct questions, hints and AI goals, and recent answers reach the next turn', async t => {
  const h = harness(t), questions = new Set(), hints = new Set();
  for (const depth of ['aware', 'find', 'explain', 'apply']) {
    const note = h.knowledge('同一合成知识', { depth }), s = h.learning.startStudy({ noteId: note.id });
    questions.add(s.question); hints.add(h.learning.hintStudy(s.id).hint);
    await h.answer(s.id, `${depth}的第一轮实际回答`);
    assert.match(h.calls.at(-1).prompt, new RegExp(s.goal));
    await h.answer(s.id, `${depth}的第二轮实际回答`);
    assert.equal(h.calls.at(-1).prompt.includes(`${depth}的第一轮实际回答`), true);
  }
  assert.equal(questions.size, 4);
  assert.equal(hints.size, 4);
  const application = h.knowledge('独立应用练习', { depth: 'apply' }), session = h.learning.startStudy({ noteId: application.id });
  await h.answer(session.id, '我提出一个新的合成场景并说明边界。');
  assert.equal(h.learning.finishStudy(session.id).completion.evidence.applicationPractice, true);
});

test('mistake practice uses the recorded misconception, correction and next question and excludes disputed records', async t => {
  const h = harness(t), note = h.knowledge('纠错知识');
  const mistake = h.store.create({ kind: 'mistake', title: '合成条件误解', body: '## AI 指出的误解或遗漏（可质疑）\n遗漏温度条件\n\n## 修正与依据\n检查材料中的温度条件\n\n## 后续练习\n温度改变后该结论是否仍适用？', meta: { noteId: note.id, correctionState: 'open', privacy: 'local' } });
  const s = h.learning.startStudy({ mistakeId: mistake.id });
  assert.equal(s.noteId, note.id);
  assert.equal(s.question, '温度改变后该结论是否仍适用？');
  assert.equal(s.mistakeContext.correction, '检查材料中的温度条件');
  await h.answer(s.id, '重新检查温度条件。');
  assert.equal(h.calls.at(-1).prompt.includes('遗漏温度条件'), true);
  assert.equal(h.calls.at(-1).prompt.includes('检查材料中的温度条件'), true);
  h.learning.mistakeAction(mistake.id, { action: 'dispute', reason: '原题条件不清楚。' });
  assert.throws(() => h.learning.startStudy({ mistakeId: mistake.id }), { code: 'MISTAKE_INACTIVE' });
  assert.equal(h.learning.today().items.some(x => x.mistakeId === mistake.id), false);
});

test('confirmation after feedback ends the session without replacing the original answer or auto-confirming any other note', async t => {
  const h = harness(t), note = h.knowledge('需要用户确认的知识'), other = h.knowledge('保持待学习');
  const s = h.learning.startStudy({ noteId: note.id });
  await h.answer(s.id, '这是不可被模型替换的原始回答。');
  assert.equal(h.store.read(note.id).meta.confirmedAt, undefined);
  const confirmed = h.learning.confirmStudy(s.id, { body: '用户整理并确认后的个人理解。' });
  assert.equal(confirmed.meta.confirmedBy, 'user');
  assert.equal(h.learning.session(s.id).status, 'completed');
  assert.equal(h.learning.session(s.id).turns[0].answer, '这是不可被模型替换的原始回答。');
  assert.equal(h.store.read(other.id).meta.confirmedAt, undefined);
});

test('a changed teaching source is not graded against its obsolete snapshot', async t => {
  const h = harness(t), note = h.knowledge('内容变更边界'), s = h.learning.startStudy({ noteId: note.id });
  const waiting = h.learning.answerStudy(s.id, { answer: '旧版回答', requestId: 'source-change' });
  h.store.update(note.id, { expectedHash: note.hash, body: '用户已经更新材料。' });
  await assert.rejects(h.learning.grade(h.store.get('jobs', waiting.pendingJobId)), { code: 'SOURCE_CHANGED' });
  assert.equal(h.calls.length, 0);
  assert.equal(h.learning.session(s.id).turns[0].feedback, undefined);
  assert.equal(h.store.records('studyEvidence').length, 0);
});

test('local mistake context attached to a cloud knowledge note reaches the real privacy guard without any network call', async t => {
  const h = harness(t), note = h.knowledge('可外发知识', { privacy: 'cloud' });
  const mistake = h.store.create({ kind: 'mistake', title: '本地错题', body: '包含只保留本地的个人回答。', meta: { noteId: note.id, correctionState: 'open', privacy: 'local', omission: '本地误解标记', correction: '本地修正标记' } });
  let networkCalls = 0;
  const realAI = createAI({
    getSettings: () => { throw new Error('Privacy guard should run before reading capability settings'); },
    getSecret: () => { throw new Error('No credentials in this test'); },
    recordCall: () => {}, getUsage: () => ({}),
    fetchImpl: async () => { networkCalls++; throw new Error('Network forbidden'); },
  });
  h.dependencies.ai.generate = realAI.generate;
  const s = h.learning.startStudy({ mistakeId: mistake.id });
  assert.equal(s.privacy, 'local');
  const waiting = h.learning.answerStudy(s.id, { answer: '本地实际回答', requestId: 'private-mistake' });
  await assert.rejects(h.learning.grade(h.store.get('jobs', waiting.pendingJobId)), { code: 'PRIVACY_LOCAL' });
  assert.equal(networkCalls, 0);
  assert.equal(h.learning.session(s.id).turns[0].feedback, undefined);
});

test('cloud grading includes authorized prior sessions but excludes local and legacy histories', async t => {
  const h = harness(t);
  let note = h.knowledge('历史隔离知识');
  const local = h.learning.startStudy({ noteId: note.id });
  await h.answer(local.id, 'LOCAL_HISTORY_MUST_NOT_LEAVE');
  const legacy = h.learning.startStudy({ noteId: note.id });
  await h.answer(legacy.id, 'LEGACY_HISTORY_NO_PERMISSION');
  const legacyRecord = h.store.get('sessions', legacy.id); delete legacyRecord.privacy;
  h.store.put('sessions', legacy.id, legacyRecord);
  note = h.store.update(note.id, { expectedHash: note.hash, meta: { privacy: 'cloud' } });
  const authorized = h.learning.startStudy({ noteId: note.id });
  await h.answer(authorized.id, 'CLOUD_HISTORY_ALLOWED');
  const current = h.learning.startStudy({ noteId: note.id });
  await h.answer(current.id, 'CURRENT_CLOUD_ANSWER');
  const request = h.calls.at(-1);
  assert.equal(request.privacy, 'cloud');
  assert.equal(request.prompt.includes('CLOUD_HISTORY_ALLOWED'), true);
  assert.equal(request.prompt.includes('LOCAL_HISTORY_MUST_NOT_LEAVE'), false);
  assert.equal(request.prompt.includes('LEGACY_HISTORY_NO_PERMISSION'), false);
});

test('confirming understanding after an external material change does not validate the obsolete study snapshot', async t => {
  const h = harness(t), note = h.knowledge('确认时材料变化'), s = h.learning.startStudy({ noteId: note.id });
  await h.answer(s.id, '旧材料下的回答');
  h.store.update(note.id, { expectedHash: note.hash, body: '用户已独立修订学习材料。' });
  const confirmed = h.learning.confirmStudy(s.id, { body: '用户仍可明确确认个人理解。' });
  assert.equal(confirmed.meta.confirmedBy, 'user');
  assert.equal(confirmed.body.includes('用户已独立修订学习材料。'), true);
  assert.equal(h.learning.session(s.id).status, 'feedback');
  assert.throws(() => h.learning.finishStudy(s.id), { code: 'SOURCE_CHANGED' });
  assert.equal(h.store.records('studyEvidence').length, 0);
});

test('a disputed misconception is not silently recreated or counted as valid review feedback', async t => {
  const h = harness(t), note = h.knowledge('有争议的误解');
  const wrong = { assessment: 'incorrect', feedback: '合成反馈', omission: '可能有争议的条件', correction: '合成修正', nextQuestion: '条件是否清楚？' };
  const first = h.learning.startStudy({ noteId: note.id });
  await h.answer(first.id, '第一次回答', wrong);
  const mistake = h.store.list().find(n => n.kind === 'mistake');
  h.learning.mistakeAction(mistake.id, { action: 'dispute', reason: '题目未给出必要条件。' });
  assert.equal(h.learning.finishStudy(first.id).completion.reviewSettled, false);
  const second = h.learning.startStudy({ noteId: note.id });
  await h.answer(second.id, '后续回答', wrong);
  assert.equal(h.store.list().filter(n => n.kind === 'mistake').length, 1);
  assert.equal(h.store.read(mistake.id).meta.correctionState, 'disputed');
  assert.equal(h.learning.finishStudy(second.id).completion.reviewSettled, false);
});

test('legacy free-text prerequisite descriptions remain editable without becoming character-level dependencies', t => {
  const h = harness(t), note = h.knowledge('兼容已有主题');
  let topic = h.learning.createTopic({ title: '旧主题格式', body: '主题说明', noteIds: [note.id], prerequisites: '先了解基础概念' });
  assert.deepEqual(topic.prerequisites, ['先了解基础概念']);
  topic = h.learning.updateTopic(topic.id, { expectedHash: topic.hash, meta: { prerequisites: '仍需补充材料' } });
  assert.deepEqual(topic.prerequisites, ['仍需补充材料']);
  assert.equal(h.learning.today().items[0].noteId, note.id);
});

test('topic creation and member reordering generate one consistent managed link order while preserving the explanation', t => {
  const h = harness(t), a = h.knowledge('原先第一项'), b = h.knowledge('调整后第一项');
  let topic = h.learning.createTopic({ title: '可重排的默认主题', noteIds: [a.id, b.id] });
  const start = '<!-- zhixu-managed-links:start -->', end = '<!-- zhixu-managed-links:end -->';
  const description = topic.body.split(start)[0];
  assert.equal(description.includes('[['), false, 'default explanatory text must not contain a second frozen member list');
  assert.equal(topic.body.indexOf(a.id) < topic.body.indexOf(b.id), true);
  assert.equal(topic.linkSyncConflict, null);
  assert.equal(h.store.managedLinksPreview(topic.id).changed, false);
  topic = h.learning.updateTopic(topic.id, { expectedHash: topic.hash, meta: { noteIds: [b.id, a.id] } });
  assert.equal(topic.body.split(start)[0], description);
  assert.equal(topic.body.indexOf(b.id) < topic.body.indexOf(a.id), true);
  assert.equal(topic.body.split(start).length, 2);
  assert.equal(topic.body.split(end).length, 2);
  assert.deepEqual(topic.noteIds, [b.id, a.id]);
  assert.equal(h.store.managedLinksPreview(topic.id).changed, false);
  assert.equal(topic.hash, h.store.read(topic.id).hash);

  const manual = '这是我自己写的问题和边界。\n\n还要保留这一段人工说明。';
  let authored = h.learning.createTopic({ title: '人工说明主题', body: manual, noteIds: [a.id, b.id] });
  authored = h.learning.updateTopic(authored.id, { expectedHash: authored.hash, meta: { noteIds: [b.id] } });
  assert.equal(authored.body.split(start)[0], `${manual}\n\n`);
  assert.equal(authored.body.includes(a.id), false);
  assert.equal(authored.body.includes(b.id), true);
});

test('topic reordering preserves an externally edited managed block and exposes its conflict', t => {
  const h = harness(t), a = h.knowledge('外改主题成员甲'), b = h.knowledge('外改主题成员乙');
  let topic = h.learning.createTopic({ title: '外改保护主题', body: '人工说明必须保留。', noteIds: [a.id, b.id] });
  const changed = topic.body.replace('## 已确认的知识链接', '## 已确认的知识链接\n\n用户在自动区增加的注释');
  fs.writeFileSync(path.join(h.store.vaultDir, topic.path), fs.readFileSync(path.join(h.store.vaultDir, topic.path), 'utf8').replace(topic.body, changed));
  h.store.scan();
  topic = h.store.read(topic.id);
  const updated = h.learning.updateTopic(topic.id, { expectedHash: topic.hash, meta: { noteIds: [b.id, a.id] } });
  assert.equal(updated.body, changed);
  assert.deepEqual(updated.noteIds, [b.id, a.id]);
  assert.match(updated.linkSyncConflict, /外部修改/);
  assert.equal(h.store.pendingManagedLinks().some(item => item.id === topic.id && item.conflict), true);
});
