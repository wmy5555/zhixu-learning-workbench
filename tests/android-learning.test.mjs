import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createAndroidLearning, createEmptyLearningState, validateLearningState, learningLimits } from '../apps/android/web/android-learning.mjs';
import { createLearning as createPortableCore } from '../apps/android/web/learning-core.mjs';
import { createLearning as createBaselineCore } from '../src/learning.mjs';
import { createMemoryStore } from '../apps/android/web/learning-runtime.mjs';

const timestamp = '2026-10-08T00:00:00.000Z';
const clock = () => new Date(timestamp);
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function note(n = 1, meta = {}, kind = 'knowledge') {
  return { id: id(n), kind, title: `合成条目${n}`, body: `【合成测试】条目${n}的正文与适用条件。`, hash: `opaque-version-${n}`,
    meta: { privacy: 'local', stage: kind === 'knowledge' ? 'learning' : 'reference', depth: 'explain', ...meta } };
}
function app({ notes = [note()], records = {}, sources = [], practice = false, settings = {}, guide = {} } = {}) {
  return createAndroidLearning({ state: { notes, records, settings, guide }, sources, practice, clock });
}
const errorCode = code => error => error.code === code;

test('offline answers survive reconstruction, remain unassessed and never create feedback jobs', async () => {
  const service = app(), session = service.learning.startStudy({ noteId: id(1) });
  const answered = service.learning.answerStudy(session.id, { answer: '我的合成回答', requestId: 'answer-one' });
  assert.equal(answered.status, 'unassessed');
  assert.equal(answered.turns[0].assessment, 'unassessed');
  assert.equal(answered.turns[0].feedback, undefined);
  assert.equal(answered.pendingJobId, null);
  assert.deepEqual(service.state.records.jobs, undefined);
  const reconstructed = createAndroidLearning({ state: service.state, clock });
  assert.deepEqual(reconstructed.learning.session(session.id), answered);
  assert.deepEqual(reconstructed.learning.answerStudy(session.id, { answer: '重复提交不能覆盖', requestId: 'answer-one' }), answered);
  const forged = service.state;
  forged.records.sessions[session.id].turns[0].feedback = { assessment: 'correct', feedback: '伪造自动反馈' };
  assert.throws(() => createAndroidLearning({ state: forged, clock }), /尚未评估/);
  await assert.rejects(reconstructed.learning.grade({ payload: {} }), errorCode('ANDROID_UNAVAILABLE'));
});

test('offline finish only marks the local plan done, preserves reviews and mastery, and is idempotent', () => {
  const review = { noteId: id(1), interval: 16, dueAt: '2026-10-07T00:00:00.000Z', lastSuccessfulDay: '2026-09-21' };
  const service = app({ records: { reviews: { [id(1)]: review } } });
  const before = service.getNote(id(1)), plan = service.learning.today().items[0];
  const session = service.learning.startStudy({ noteId: id(1), planId: plan.id });
  assert.throws(() => service.learning.finishStudy(session.id), /至少一次/);
  service.learning.answerStudy(session.id, { answer: '尚未评估的回答', requestId: 'offline-finish' });
  const result = service.learning.finishStudy(session.id), saved = service.state;
  assert.equal(result.status, 'completed');
  assert.equal(result.completion.interval, null);
  assert.equal(result.completion.reviewSettled, false);
  assert.equal(result.completion.evidence.assessment, 'unassessed');
  for (const key of ['independent', 'explanationPractice', 'applicationPractice', 'spacedRecall']) assert.equal(result.completion.evidence[key], false);
  assert.deepEqual(saved.records.reviews[id(1)], review);
  assert.deepEqual(service.getNote(id(1)), before);
  assert.equal(saved.records.plans[plan.id].state, 'done');
  assert.match(saved.records.plans[plan.id].completionReason, /本地完成记录/);
  assert.deepEqual(service.learning.finishStudy(session.id), result);
  const forged = service.state;
  forged.records.sessions[session.id].completion.evidence.independent = true;
  assert.throws(() => createAndroidLearning({ state: forged, clock }), /不能作为已掌握/);
  assert.deepEqual(service.state, saved);
  assert.equal(service.learning.today().items[0].state, 'done');
});

test('updated knowledge prevents an old material session from being finished', () => {
  const service = app(), session = service.learning.startStudy({ noteId: id(1) });
  service.learning.answerStudy(session.id, { answer: '针对旧材料', requestId: 'old-material' });
  service.editNote(id(1), { body: '新版本材料', expectedHash: service.getNote(id(1)).hash });
  assert.throws(() => service.learning.finishStudy(session.id), errorCode('SOURCE_CHANGED'));
  assert.equal(service.learning.session(session.id).status, 'unassessed');
  assert.equal(service.state.records.studyEvidence, undefined);
});

test('explicit personal confirmation promotes understanding while leaving offline mastery unassessed', () => {
  const service = app(), session = service.learning.startStudy({ noteId: id(1) });
  service.learning.answerStudy(session.id, { answer: '我先留下自己的解释', requestId: 'my-understanding' });
  assert.throws(() => service.learning.confirmStudy(session.id, { body: '' }), /格式无效/);
  const result = service.learning.confirmStudy(session.id, { body: '这是我主动确认的个人理解。' });
  assert.equal(result.meta.stage, 'integrated');
  assert.equal(result.meta.confirmedBy, 'user');
  assert.match(result.body, /我的理解（用户确认）/);
  const saved = service.learning.session(session.id);
  assert.equal(saved.status, 'completed');
  assert.equal(saved.sourceHash, result.hash);
  assert.equal(saved.completion.evidence.assessment, 'unassessed');
  assert.equal(saved.completion.evidence.independent, false);
  assert.deepEqual(service.state.records.reviews, undefined);
});

test('manual facts remain blocked; opinions retain their original snapshot and go stale with their source version', () => {
  const source = note(50, { platform: '合成来源', author: '合成作者', url: '', date: '', locator: '', topic: '' }, 'source');
  const service = app({ notes: [], sources: [source] });
  assert.throws(() => service.extractSource(source.id, { title: '过时表单', body: '合成材料', claimType: 'opinion', expectedHash: 'old-version' }), errorCode('SOURCE_CHANGED'));
  assert.throws(() => service.extractSource(source.id, { title: '未明确分类', body: '合成材料', expectedHash: source.hash }), /明确选择/);
  const fact = service.extractSource(source.id, { title: '合成事实', body: '必须核验的合成事实', claimType: 'fact', expectedHash: source.hash });
  service.promote(fact.id, { stage: 'learning', reason: '我想学习这项内容' });
  assert.throws(() => service.learning.startStudy({ noteId: fact.id }), errorCode('RESEARCH_REQUIRED'));
  const opinion = service.extractSource(source.id, { title: '合成观点', body: '明确标记的个人观点', claimType: 'opinion', expectedHash: source.hash });
  service.promote(opinion.id, { stage: 'learning', reason: '主动选学' });
  assert.equal(service.learning.startStudy({ noteId: opinion.id }).status, 'reading');
  assert.deepEqual(opinion.meta.sourceSnapshot, { id: source.id, hash: source.hash, title: source.title, body: source.body, meta: source.meta });
  assert.deepEqual(opinion.meta.sources, [{ id: source.id, role: 'input', hash: source.hash }]);
  assert.deepEqual(service.state.notes.some(n => n.kind === 'source'), false);
  const stale = createAndroidLearning({ state: service.state, sources: [{ ...source, hash: 'new-native-uuid' }], clock });
  assert.throws(() => stale.learning.startStudy({ noteId: opinion.id }), errorCode('RESEARCH_REQUIRED'));
  assert.equal(stale.learning.today().unavailable.find(n => n.noteId === opinion.id).sourceId, source.id);
  assert.deepEqual(stale.getNote(opinion.id).meta.sourceSnapshot, opinion.meta.sourceSnapshot);
});

test('source summaries suffice for ordinary operations but extraction requires full current content', () => {
  const source = note(50, {}, 'source'); delete source.body;
  const service = app({ sources: [source] });
  assert.equal(service.bootstrap().stats.sources, 1);
  assert.equal(service.learning.today().items.length, 1);
  assert.throws(() => service.extractSource(source.id, { title: '合成观点', body: '合成内容', claimType: 'opinion', expectedHash: source.hash }), /原文正文格式无效/);
  assert.deepEqual(service.list({ q: 'undefined' }), []);
});

test('stale research, stale processing, retired and superseded knowledge stay outside study and today', () => {
  const notes = [note(1, { reviewAfter: '2020-01-01T00:00:00.000Z' }), note(2, { processKey: `${id(50)}:obsolete:0` }), note(3, { stage: 'retired' }), note(4, { supersededBy: id(5) })];
  const service = app({ notes, sources: [note(50, {}, 'source')] });
  assert.equal(service.learning.today().items.length, 0);
  for (const n of notes) assert.throws(() => service.learning.startStudy({ noteId: n.id }), errorCode('RESEARCH_REQUIRED'));
  assert.deepEqual(service.learning.today().unavailable.map(n => n.code), ['material', 'material', 'retired', 'superseded']);
});

test('content edits require a current hash and cannot forge confirmation, evidence or stage changes', () => {
  const service = app(), original = service.getNote(id(1));
  assert.throws(() => service.editNote(id(1), { expectedHash: 'stale', body: '新内容' }), errorCode('CONFLICT'));
  assert.throws(() => service.editNote(id(1), { expectedHash: original.hash, meta: { confirmedAt: timestamp, researchLimitations: [], evidence: [] } }), /不支持的字段/);
  assert.throws(() => service.editNote(id(1), { expectedHash: original.hash, meta: { stage: 'core' } }), /晋级操作/);
  assert.throws(() => service.promote(id(1), { stage: 'learning', reason: '' }), /格式无效/);
  assert.throws(() => service.promote(id(1), { stage: 'core', reason: '直接声称掌握' }), /确认个人理解/);
  assert.deepEqual(service.getNote(id(1)), original);
});

test('practice sources and guide progress remain separate from formal sources and preserve source fields', () => {
  const service = app({ notes: [], practice: true });
  const meta = { platform: '课程', author: '合成作者', url: 'https://example.com', date: '2026-10-08', locator: '合成位置', topic: '合成主题' };
  const source = service.saveSource({ title: '练习原文', body: '合成原文', meta });
  for (const [key, value] of Object.entries(meta)) assert.equal(source.meta[key], value);
  const edited = service.saveSource({ id: source.id, title: source.title, body: '调整后的合成原文', expectedHash: source.hash });
  for (const [key, value] of Object.entries(meta)) assert.equal(edited.meta[key], value);
  assert.deepEqual(Object.keys(service.state.notes[0]).sort(), ['body', 'hash', 'id', 'kind', 'meta', 'title']);
  service.updateGuide({ started: true, dismissed: false });
  assert.deepEqual(service.state.guide, { started: true, dismissed: false });
  assert.throws(() => service.updateGuide({ dismissed: 'false' }), /开关值/);
  assert.throws(() => service.saveSource({ id: source.id, title: source.title, body: '新版', meta, expectedHash: 'stale' }), errorCode('CONFLICT'));
  assert.throws(() => app({ practice: true, sources: [note(50, {}, 'source')] }), errorCode('PRACTICE_ISOLATION'));
  assert.throws(() => app({ notes: [] }).saveSource({ title: '错误入口', body: '正文' }), errorCode('ANDROID_UNAVAILABLE'));
});

test('user mistakes require an answer and own correction, remain historical, and support dispute/reopen', () => {
  const service = app(), session = service.learning.startStudy({ noteId: id(1) });
  const input = { omission: '我遗漏了适用条件', correction: '我应先核对条件', reason: '比较原文后发现', nextQuestion: '换个条件如何判断？' };
  assert.throws(() => service.createMistake(session.id, input), /先留下自己的回答/);
  service.learning.answerStudy(session.id, { answer: 'NEVER_SEARCH_AS_CORRECT', requestId: 'user-mistake' });
  const mistake = service.createMistake(session.id, input);
  assert.equal(mistake.meta.origin, 'user');
  assert.equal(mistake.meta.assessment, 'unassessed');
  assert.match(mistake.body, /错误记录，不能作为正确知识引用/);
  assert.deepEqual(service.list({ q: 'NEVER_SEARCH_AS_CORRECT' }), []);
  assert.deepEqual(service.list({ q: '我应先核对条件' }), []);
  assert.equal(service.mistakes().length, 1);
  assert.equal(service.learning.startStudy({ mistakeId: mistake.id }).question, input.nextQuestion);
  service.learning.mistakeAction(mistake.id, { action: 'dispute', reason: '尚未确定' });
  assert.throws(() => service.learning.startStudy({ mistakeId: mistake.id }), errorCode('MISTAKE_INACTIVE'));
  service.learning.mistakeAction(mistake.id, { action: 'reopen', reason: '继续核对' });
  assert.equal(service.learning.startStudy({ mistakeId: mistake.id }).mistakeId, mistake.id);
});

test('topic prerequisites must be current knowledge and managed links safely preserve every original byte', () => {
  const service = app({ notes: [note(1), note(2, { stage: 'retired' }), note(3, { researchLimitations: ['待核验'] })] });
  assert.throws(() => service.learning.createTopic({ title: '缺失前置', noteIds: [id(1)], prerequisites: [id(99)] }), errorCode('NOT_FOUND'));
  assert.throws(() => service.learning.createTopic({ title: '停用前置', noteIds: [id(1)], prerequisites: [id(2)] }), errorCode('INVALID_PREREQUISITE'));
  assert.throws(() => service.learning.createTopic({ title: '待核验前置', noteIds: [id(1)], prerequisites: [id(3)] }), errorCode('INVALID_PREREQUISITE'));
  const body = '# 原文\n\n<!-- zhixu-managed-links:start -->\n用户编辑的链接\n<!-- zhixu-managed-links:end -->';
  const topic = service.learning.createTopic({ title: '合成主题', body, noteIds: [id(1)] });
  assert.equal(topic.body, body);
  assert.match(topic.linkSyncConflict, /暂未接入/);
  const preview = service.linksPreview(topic.id);
  assert.equal(preview.changed, false); assert.equal(preview.body, body); assert.equal(preview.supported, false);
  assert.throws(() => service.syncLinks(), errorCode('ANDROID_UNAVAILABLE'));
});

test('missing imported dependencies stay visible and block scheduling instead of silently skipping', () => {
  const topic = note(90, { noteIds: [id(1)], prerequisites: [id(99)], minutes: 20 }, 'topic');
  const service = app({ notes: [note(1), topic] });
  assert.equal(service.learning.topics()[0].progress.blockedNoteId, id(99));
  assert.equal(service.learning.today().items.length, 0);
  assert.equal(service.learning.today().blocked[0].prerequisiteId, id(99));
  const direct = app({ notes: [note(1, { prerequisites: [id(99)] })] });
  assert.equal(direct.learning.today().items.length, 0);
});

test('strict boundary rejects oversized answers, unsafe JSON keys, unsupported settings and nonboolean hints', () => {
  const original = { notes: [note()], records: {}, settings: {}, guide: {} };
  const service = createAndroidLearning({ state: original, clock }), session = service.learning.startStudy({ noteId: id(1) });
  assert.throws(() => service.learning.answerStudy(session.id, { answer: '文'.repeat(Math.floor(learningLimits.bodyBytes / 3) + 1), requestId: 'too-large' }), errorCode('LIMIT_REACHED'));
  assert.throws(() => service.learning.answerStudy(session.id, { answer: '回答', requestId: 'x'.repeat(129) }), errorCode('LIMIT_REACHED'));
  assert.throws(() => service.learning.answerStudy(session.id, { answer: '回答', requestId: 'bad-hint', hintUsed: 'false' }), /开关值/);
  assert.throws(() => service.updateSettings({ dailyMinutes: '25' }), /整数/);
  assert.throws(() => service.updateSettings({ ai: { enabled: true } }), /不支持的字段/);
  assert.throws(() => service.updateSettings({ pausedIds: [false] }), /格式无效/);
  assert.throws(() => service.editNote(id(1), { title: 'a'.repeat(201), expectedHash: service.getNote(id(1)).hash }), errorCode('LIMIT_REACHED'));
  assert.throws(() => service.updateSettings(JSON.parse('{"__proto__": {"polluted": true}}')), /无效字段/);
  assert.equal(service.learning.session(session.id).turns.length, 0);
  assert.deepEqual(original, { notes: [note()], records: {}, settings: {}, guide: {} });
  const copy = service.state; copy.notes[0].body = '外部对象不应修改内部内容';
  const returned = service.getNote(id(1)); returned.meta.stage = 'retired';
  assert.equal(service.getNote(id(1)).body, note().body);
  assert.equal(service.getNote(id(1)).meta.stage, 'learning');
  assert.deepEqual(validateLearningState(createEmptyLearningState()), createEmptyLearningState());
});

function parityHarness(factory, seed, config) {
  const state = structuredClone(seed), store = createMemoryStore(state, [], () => timestamp);
  const dependencies = { store, settings: () => config, getNote: n => store.read(n), eligible: n => n.kind === 'knowledge' && n.meta.stage !== 'retired' && !n.meta.supersededBy && !n.meta.researchLimitations?.length,
    learningClock: clock, updateSettings: value => Object.assign(config, value), queue() { throw new Error('Not used'); },
  };
  return { learning: factory(dependencies), state, store };
}
test('frozen portable core retains baseline planner/topic behavior and complete graded settlement rules', () => {
  const knowledge = [note(1, { depth: 'aware' }), note(2, { prerequisites: [id(1)], depth: 'apply' }), note(3, { topic: '关注主题' })];
  const topic = note(90, { noteIds: [id(1), id(2)], prerequisites: [], minutes: 20 }, 'topic');
  const seed = { notes: [...knowledge, topic], settings: {}, guide: {}, records: { reviews: { [id(3)]: { noteId: id(3), interval: 4, dueAt: '2026-10-07T00:00:00.000Z', lastSuccessfulDay: '2026-10-01' } } } };
  const config = { dailyMinutes: 25, timezone: 'Asia/Shanghai', focusTopics: ['关注主题'], pausedIds: [] };
  const baseline = parityHarness(createBaselineCore, seed, structuredClone(config)), portable = parityHarness(createPortableCore, seed, structuredClone(config));
  assert.deepEqual(portable.learning.today(), baseline.learning.today());
  assert.deepEqual(portable.learning.topics(), baseline.learning.topics());
  const exercise = { id: 'same-session', noteId: id(3), status: 'feedback', sourceHash: knowledge[2].hash, depth: 'apply', turns: [{ id: 'same-turn', requestId: 'same-request', answer: '完整合成回答', hintUsed: false, feedback: { assessment: 'correct' } }], createdAt: timestamp };
  baseline.store.put('sessions', exercise.id, exercise); portable.store.put('sessions', exercise.id, exercise);
  assert.deepEqual(portable.learning.finishStudy(exercise.id), baseline.learning.finishStudy(exercise.id));
  assert.deepEqual(portable.state, baseline.state);
  assert.equal(portable.state.records.reviews[id(3)].interval, 8);
  assert.equal(portable.state.records.studyEvidence[exercise.id].independent, true);
  assert.equal(portable.state.records.studyEvidence[exercise.id].spacedRecall, true);
});

test('portable frozen module contains the baseline grade and planner with explicit offline branches only', () => {
  const source = fs.readFileSync(new URL('../apps/android/web/learning-core.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"]node:/);
  assert.match(source, /assessmentMode === 'offline'/);
  assert.match(source, /async function grade/);
  assert.match(source, /old\.lastSuccessfulDay < date/);
  assert.match(source, /Math\.min\(120/);
});
