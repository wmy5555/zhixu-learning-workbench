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

test('confirming understanding preserves chapters the user added after the old understanding', () => {
  const service = app(), heading = '\n\n## 我的理解（用户确认）\n\n';
  const first = service.confirmNote(id(1), { body: '最初的个人理解。', expectedHash: service.getNote(id(1)).hash });
  const expanded = `${first.body}\n\n## 用户新增的例子\n这个例子不能被删除。\n\n## 后续行动\n- 保留用户写下的安排。`;
  const edited = service.editNote(id(1), { body: expanded, expectedHash: first.hash });
  const result = service.confirmNote(id(1), { body: '本次重新确认的理解。', expectedHash: edited.hash });
  assert.equal(result.body, `${expanded}${heading}本次重新确认的理解。`);
  assert.equal(result.meta.personalUnderstanding, '本次重新确认的理解。');
  assert.equal(result.meta.stage, 'integrated');
  assert.equal(result.meta.confirmedBy, 'user');
});

test('reconfirmation replaces only an exact application understanding at the end of the material', () => {
  const service = app(), original = service.getNote(id(1)), heading = '\n\n## 我的理解（用户确认）\n\n';
  const first = service.confirmNote(id(1), { body: '应用记录的旧理解。', expectedHash: original.hash });
  const result = service.confirmNote(id(1), { body: '更新后的理解。', expectedHash: first.hash });
  assert.equal(result.body, `${original.body}${heading}更新后的理解。`);
  assert.equal(result.body.split('## 我的理解（用户确认）').length - 1, 1);
  assert.equal(result.meta.personalUnderstanding, '更新后的理解。');
  assert.notEqual(result.hash, first.hash);
});

test('reconfirmation preserves externally edited or untracked understanding sections', () => {
  const heading = '\n\n## 我的理解（用户确认）\n\n';
  for (const mode of ['externally edited', 'untracked heading', 'copied old block']) {
    const service = app();
    const original = service.getNote(id(1));
    const first = mode !== 'untracked heading'
      ? service.confirmNote(id(1), { body: '曾由应用记录的旧理解。', expectedHash: original.hash }) : original;
    const preserved = mode === 'copied old block'
      ? `${first.body}\n\n## 用户保存的历史副本\n后续内容必须保留。${heading}曾由应用记录的旧理解。`
      : `${original.body}${heading}后来手动修改的理解，必须保留。`;
    const edited = service.editNote(id(1), { body: preserved, expectedHash: first.hash });
    const result = service.confirmNote(id(1), { body: '本次明确确认的新理解。', expectedHash: edited.hash });
    assert.equal(result.body, `${preserved}${heading}本次明确确认的新理解。`, mode);
    assert.equal(result.meta.personalUnderstanding, '本次明确确认的新理解。', mode);
  }
});

test('confirmation preserves managed link bytes and chapters appended after those links', () => {
  const heading = '\n\n## 我的理解（用户确认）\n\n';
  const links = '<!-- zhixu-managed-links:start -->\n## 已确认的知识链接\n\n- [[合成链接|合成标题]]\n<!-- zhixu-managed-links:end -->';
  const material = { ...note(), body: `${note().body}\n\n${links}\n` };
  const service = app({ notes: [material] });
  const first = service.confirmNote(id(1), { body: '首次理解。', expectedHash: material.hash });
  assert.equal(first.body, `${note().body}${heading}首次理解。\n\n${links}\n`);
  const second = service.confirmNote(id(1), { body: '再次理解。', expectedHash: first.hash });
  assert.equal(second.body, `${note().body}${heading}再次理解。\n\n${links}\n`);
  const expanded = `${second.body}\n## 用户后补的边界\n这段位于自动链接之后，仍要完整保留。`;
  const edited = service.editNote(id(1), { body: expanded, expectedHash: second.hash });
  const third = service.confirmNote(id(1), { body: '第三次确认。', expectedHash: edited.hash });
  assert.equal(third.body, `${expanded}${heading}第三次确认。`);
  assert.equal(third.body.split(links).length - 1, 1);
});

test('a stale session cannot overwrite newly edited material or personal understanding', () => {
  for (const change of ['editNote', 'external update']) {
    let service = app();
    const session = service.learning.startStudy({ noteId: id(1) });
    service.learning.answerStudy(session.id, { answer: '这份解释对应旧学习材料。', requestId: 'old-confirmation' });
    const latestBody = '用户刚修改的新材料。\n\n## 我的理解（用户确认）\n\n当前版本的新理解，应完整保留。';
    if (change === 'editNote') {
      service.editNote(id(1), { body: latestBody, expectedHash: service.getNote(id(1)).hash });
    } else {
      const currentState = service.state;
      currentState.notes[0] = { ...currentState.notes[0], body: latestBody, hash: 'external-current-version',
        meta: { ...currentState.notes[0].meta, stage: 'integrated', confirmedAt: timestamp, confirmedBy: 'user', personalUnderstanding: '当前版本的新理解，应完整保留。' } };
      service = createAndroidLearning({ state: currentState, clock });
    }
    const before = service.state, latest = service.getNote(id(1)), savedSession = service.learning.session(session.id);
    assert.notEqual(latest.hash, session.sourceHash, change);
    assert.throws(() => service.learning.confirmStudy(session.id, { body: '旧会话理解不能覆盖新内容。' }), error => error.code === 'SOURCE_CHANGED' && error.status === 409, change);
    assert.deepEqual(service.state, before, `${change}: rejection must preserve the entire current draft`);
    assert.deepEqual(service.getNote(id(1)), latest, `${change}: material and understanding must stay unchanged`);
    assert.deepEqual(service.learning.session(session.id), savedSession, `${change}: old answer and session version must stay unchanged`);
    assert.equal(service.learning.session(session.id).confirmedNoteId, undefined);
    assert.equal(service.state.records.studyEvidence, undefined);
    assert.equal(service.learning.session(session.id).status, 'unassessed');
  }
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

test('legacy native sources keep valid 200-code-point emoji titles and can be extracted under a short new title', () => {
  const source = { ...note(50, {}, 'source'), title: '😀'.repeat(200) };
  assert.equal(source.title.length, 400);
  const service = app({ notes: [], sources: [source] });
  const boot = service.bootstrap();
  assert.equal(boot.stats.sources, 1);
  assert.equal(boot.notes[0].title, source.title);
  assert.equal(service.getNote(source.id).title, source.title);
  const knowledge = service.extractSource(source.id, { title: '短知识标题', body: '明确标记的个人观点', claimType: 'opinion', expectedHash: source.hash });
  assert.equal(knowledge.title, '短知识标题');
  assert.equal(knowledge.meta.sourceSnapshot.title, source.title);
  assert.equal(service.getNote(source.id).title, source.title);
  assert.throws(() => service.extractSource(source.id, { title: source.title, body: '新学习条目保持严格限制', claimType: 'opinion', expectedHash: source.hash }), errorCode('LIMIT_REACHED'));
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

test('topic study starts only its current step and advances after eligible personal confirmation', () => {
  const service = app({ notes: [note(1), note(2)] });
  const topic = service.learning.createTopic({ title: '先 A 后 B', noteIds: [id(1), id(2)] });
  assert.equal(topic.progress.nextNoteId, id(1));
  const outOfOrder = error => error.code === 'TOPIC_STEP_UNAVAILABLE' && error.status === 409;
  assert.throws(() => service.learning.startStudy({ noteId: id(2), topicId: topic.id }), outOfOrder);
  assert.equal(service.sessions().length, 0, 'rejected start creates no session');
  const first = service.learning.startStudy({ noteId: id(1), topicId: topic.id });
  assert.equal(first.topicId, topic.id);
  service.learning.answerStudy(first.id, { answer: 'A 的合成解释', requestId: 'first-topic-answer' });
  service.learning.finishStudy(first.id);
  assert.equal(service.learning.topics()[0].progress.nextNoteId, id(1), 'unassessed finish does not certify the prerequisite');
  assert.throws(() => service.learning.startStudy({ noteId: id(2), topicId: topic.id }), outOfOrder);
  assert.equal(service.sessions().length, 1);
  const current = service.getNote(id(1));
  service.confirmNote(id(1), { body: '这是我主动确认的 A 的个人理解。', expectedHash: current.hash });
  assert.equal(service.learning.topics()[0].progress.nextNoteId, id(2));
  const second = service.learning.startStudy({ noteId: id(2), topicId: topic.id });
  assert.equal(second.noteId, id(2));
  assert.equal(second.topicId, topic.id);
  assert.equal(second.status, 'reading');
  assert.throws(() => service.learning.startStudy({ noteId: id(1), topicId: topic.id }), outOfOrder, 'completed earlier steps cannot be restarted through the ordered topic entry');
});

test('a plan inherits topic ordering while ordinary single-note study keeps its original scope', () => {
  const service = app({ notes: [note(1), note(2, { prerequisites: [id(1)] })] });
  const topic = service.learning.createTopic({ title: '带今日安排的顺序', noteIds: [id(1), id(2)] });
  const today = service.learning.today();
  const firstPlan = today.items.find(item => item.noteId === id(1)), secondPlan = today.items.find(item => item.noteId === id(2));
  assert.equal(secondPlan.topicId, topic.id);
  assert.throws(() => service.learning.startStudy({ noteId: id(2), planId: secondPlan.id }), errorCode('TOPIC_STEP_UNAVAILABLE'));
  assert.equal(service.sessions().length, 0);
  assert.equal(service.learning.startStudy({ noteId: id(1), planId: firstPlan.id }).topicId, topic.id);
  const independent = service.learning.startStudy({ noteId: id(2) });
  assert.equal(independent.noteId, id(2));
  assert.equal(independent.topicId, undefined, 'the new guard is limited to topic-scoped entry');
});

test('topic study cannot jump over missing, paused, stale or unavailable prerequisites', () => {
  const cases = [
    ['unverified', { researchLimitations: ['尚待核验'] }, {}],
    ['expired', { confirmedAt: timestamp, reviewAfter: '2026-10-07T00:00:00.000Z' }, {}],
    ['not selected for learning', { stage: 'candidate' }, {}],
    ['retired', { stage: 'retired' }, {}],
    ['superseded', { supersededBy: id(3) }, {}],
    ['missing predecessor of A', { prerequisites: [id(99)] }, {}],
    ['paused A', {}, { pausedIds: [id(1)] }],
    ['paused next B', { confirmedAt: timestamp }, { pausedIds: [id(2)] }],
    ['stale source', { confirmedAt: timestamp, sources: [{ id: id(50), role: 'input', hash: 'obsolete-version' }] }, {}],
  ];
  for (const [label, changes, settings] of cases) {
    const topic = note(90, { noteIds: [id(1), id(2)], prerequisites: [], minutes: 20 }, 'topic');
    const service = app({ notes: [note(1, changes), note(2), topic], settings, sources: [note(50, {}, 'source')] });
    assert.equal(service.learning.topics()[0].progress.nextNoteId, null, label);
    assert.throws(() => service.learning.startStudy({ noteId: id(2), topicId: topic.id }), error => error.code === 'TOPIC_STEP_UNAVAILABLE' && error.status === 409, label);
    assert.equal(service.sessions().length, 0, `${label}: failure must not save a session`);
  }
  const missingMember = app({ notes: [note(2), note(90, { noteIds: [id(1), id(2)], prerequisites: [], minutes: 20 }, 'topic')] });
  assert.equal(missingMember.learning.topics()[0].progress.blockedNoteId, id(1));
  assert.throws(() => missingMember.learning.startStudy({ noteId: id(2), topicId: id(90) }), errorCode('TOPIC_STEP_UNAVAILABLE'));
  assert.equal(missingMember.sessions().length, 0);
});

test('personally confirming an unverified manual fact never completes its topic prerequisite', () => {
  const source = note(50, {}, 'source'), service = app({ notes: [note(2)], sources: [source] });
  const fact = service.extractSource(source.id, { title: '尚未核验的前置事实', body: '需要证据的合成事实', claimType: 'fact', expectedHash: source.hash });
  const confirmed = service.confirmNote(fact.id, { body: '这是我的理解，但不能替代事实核验。', expectedHash: fact.hash });
  assert.equal(confirmed.meta.stage, 'integrated');
  assert.ok(confirmed.meta.confirmedAt);
  assert.ok(confirmed.meta.researchLimitations.length);
  const topic = service.learning.createTopic({ title: '事实作为前置知识', noteIds: [fact.id, id(2)] });
  const detail = service.learning.topics().find(item => item.id === topic.id);
  assert.equal(detail.members.find(item => item.id === fact.id).completed, false);
  assert.equal(detail.progress.completedCount, 0);
  assert.equal(detail.progress.nextNoteId, null);
  assert.equal(detail.progress.blockedNoteId, fact.id);
  const today = service.learning.today();
  assert.equal(today.items.length, 0);
  assert.equal(today.unavailable.find(item => item.noteId === id(2)).code, 'prerequisite');
  assert.equal(today.unavailable.find(item => item.noteId === id(2)).prerequisiteId, fact.id);
  assert.throws(() => service.learning.startStudy({ noteId: fact.id }), errorCode('RESEARCH_REQUIRED'));
  assert.equal(service.getNote(fact.id).meta.confirmedAt, confirmed.meta.confirmedAt);
});

test('confirmed prerequisites stop counting after research expiry, source changes, retirement or replacement', () => {
  const source = note(50, {}, 'source');
  const cases = [
    ['unverified', { researchLimitations: ['该事实尚待核验。'] }],
    ['expired', { reviewAfter: '2026-10-07T00:00:00.000Z' }],
    ['stale process', { processKey: `${source.id}:obsolete-version:0` }],
    ['stale source reference', { sources: [{ id: source.id, role: 'input', hash: 'obsolete-version' }] }],
    ['retired', { stage: 'retired' }],
    ['superseded', { supersededBy: id(3) }],
  ];
  for (const [label, changes] of cases) {
    const predecessor = note(1, { stage: 'integrated', confirmedAt: timestamp, confirmedBy: 'user', ...changes });
    const topic = note(90, { noteIds: [id(1), id(2)], prerequisites: [], minutes: 20 }, 'topic');
    const service = app({ notes: [predecessor, note(2, { prerequisites: [id(1)] }), topic], sources: [source] });
    const detail = service.learning.topics()[0], today = service.learning.today();
    assert.equal(detail.members[0].completed, false, label);
    assert.equal(detail.progress.completedCount, 0, label);
    assert.equal(detail.progress.nextNoteId, null, label);
    assert.equal(detail.progress.blockedNoteId, id(1), label);
    assert.equal(today.items.length, 0, label);
    assert.equal(today.unavailable.find(item => item.noteId === id(2)).prerequisiteId, id(1), label);
    assert.equal(service.getNote(id(1)).meta.confirmedAt, timestamp, 'historical confirmation is retained');
  }
  const service = app({ notes: [note(1, { stage: 'integrated', confirmedAt: timestamp }), note(2, { prerequisites: [id(1)] }), note(90, { noteIds: [id(1), id(2)], prerequisites: [], minutes: 20 }, 'topic')] });
  assert.equal(service.learning.topics()[0].progress.nextNoteId, id(2), 'eligible personal confirmation still counts');
  assert.ok(service.learning.today().items.some(item => item.noteId === id(2)));
});

test('settled review history cannot complete a prerequisite whose current knowledge became ineligible', () => {
  const config = { dailyMinutes: 25, timezone: 'Asia/Shanghai', focusTopics: [], pausedIds: [] };
  const cases = [
    ['eligible', {}, true],
    ['unverified', { researchLimitations: ['材料尚待核验。'] }, false],
    ['expired', { reviewAfter: '2026-10-07T00:00:00.000Z' }, false],
    ['stale process', { processKey: `${id(50)}:obsolete-version:0` }, false],
    ['stale source reference', { sources: [{ id: id(50), role: 'input', hash: 'obsolete-version' }] }, false],
    ['retired', { stage: 'retired' }, false],
    ['superseded', { supersededBy: id(3) }, false],
  ];
  for (const [label, changes, completed] of cases) {
    const predecessor = note(1, changes), successor = note(2, { prerequisites: [id(1)] });
    const topic = note(90, { noteIds: [id(1), id(2)], prerequisites: [], minutes: 20 }, 'topic');
    const settled = { id: 'historical-settled-session', noteId: id(1), status: 'completed', completion: { reviewSettled: true } };
    const seed = { notes: [predecessor, successor, topic, note(50, {}, 'source')], settings: {}, guide: {}, records: { sessions: { [settled.id]: settled } } };
    // This probes the retained full-feedback core directly. Android's service
    // correctly refuses imported graded results, so it cannot seed this path.
    const harness = parityHarness(createPortableCore, seed, structuredClone(config), (n, store) => {
      if (n.kind !== 'knowledge' || n.meta.stage === 'retired' || n.meta.supersededBy || n.meta.researchLimitations?.length || n.meta.reviewAfter && n.meta.reviewAfter < timestamp) return false;
      if (n.meta.processKey) { const [sourceId, sourceHash] = n.meta.processKey.split(':'); if (store.row(sourceId)?.hash !== sourceHash) return false; }
      return !(n.meta.sources || []).some(ref => ref.role === 'input' && ref.hash && store.row(ref.id)?.hash !== ref.hash);
    });
    const detail = harness.learning.topics()[0], today = harness.learning.today();
    assert.equal(detail.members[0].completed, completed, label);
    if (completed) {
      assert.equal(detail.progress.nextNoteId, id(2), label);
      assert.ok(today.items.some(item => item.noteId === id(2)), label);
    } else {
      assert.equal(detail.progress.nextNoteId, null, label);
      assert.equal(detail.progress.blockedNoteId, id(1), label);
      assert.equal(today.items.length, 0, label);
      assert.equal(today.unavailable.find(item => item.noteId === id(2)).prerequisiteId, id(1), label);
    }
    assert.deepEqual(harness.state.records.sessions[settled.id], settled, 'historical review evidence is retained');
  }
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

function parityHarness(factory, seed, config, eligibility) {
  const state = structuredClone(seed), store = createMemoryStore(state, [], () => timestamp);
  const dependencies = { store, settings: () => config, getNote: n => store.read(n), eligible: n => eligibility ? eligibility(n, store) : n.kind === 'knowledge' && n.meta.stage !== 'retired' && !n.meta.supersededBy && !n.meta.researchLimitations?.length,
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
