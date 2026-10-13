import test from 'node:test';
import assert from 'node:assert/strict';
import { createIOSLearning, validateLearningState } from '../apps/ios/web/ios-learning.mjs';

const sourceID = '11111111-1111-4111-8111-111111111111';
const source = () => ({ id: sourceID, kind: 'source', title: '合成个人反思', body: '我想先写自己的理解，再看建议。', hash: 'source-version-1', meta: { privacy: 'local', stage: 'reference' } });
const clock = () => new Date('2026-10-13T02:00:00Z');
function prepared() {
  const service = createIOSLearning({ sources: [source()], clock });
  const note = service.extractSource(sourceID, { expectedHash: source().hash, title: '合成观点', body: '我准备每天写一段自己的解释。', reason: '这是个人打算。', claimType: 'opinion', depth: 'explain' });
  service.promote(note.id, { stage: 'learning', reason: '练习解释', expectedHash: note.hash });
  return { service, note };
}
test('iOS offline learning preserves raw answers, single completion and no invented mastery', () => {
  const { service, note } = prepared();
  const session = service.learning.startStudy({ noteId: note.id, requestId: 'start-intent-1' });
  const answered = service.learning.answerStudy(session.id, { answer: '这是自己的原始回答，尚未批改。', hintUsed: false, requestId: 'answer-1' });
  assert.equal(answered.turns[0].answer, '这是自己的原始回答，尚未批改。'); assert.equal(answered.status, 'unassessed');
  assert.equal(service.learning.answerStudy(session.id, { answer: '这是自己的原始回答，尚未批改。', requestId: 'answer-1' }).turns.length, 1);
  const completed = service.learning.finishStudy(session.id);
  assert.equal(completed.completion.reviewSettled, false); assert.equal(completed.completion.interval, null);
  assert.deepEqual(service.learning.finishStudy(session.id), completed);
  assert.equal(Object.keys(service.state.records.studyEvidence).length, 1); assert.equal(Object.keys(service.state.records.reviews || {}).length, 0);
  validateLearningState(service.state);
});
test('iOS persisted start intent handles response loss, conflicting reuse and fresh starts', () => {
  const { service, note } = prepared(), payload = { noteId: note.id, requestId: 'start-intent-1' };
  const started = service.learning.startStudy(payload);
  const reopened = createIOSLearning({ state: service.state, sources: [source()], clock });
  assert.equal(reopened.learning.startStudy(payload).id, started.id);
  assert.throws(() => reopened.learning.startStudy({ ...payload, planId: 'different-intent' }), { code: 'START_REQUEST_CONFLICT' });
  assert.notEqual(reopened.learning.startStudy({ noteId: note.id, requestId: 'start-intent-2' }).id, started.id);
  assert.equal(reopened.sessions().length, 2);
});
test('stale learning snapshots cannot overwrite new user edits and retirement remains explicit', () => {
  const { service, note } = prepared(), session = service.learning.startStudy({ noteId: note.id });
  service.learning.answerStudy(session.id, { answer: '旧材料时留下的原始解释。', hintUsed: false, requestId: 'old-answer' });
  const current = service.getNote(note.id);
  const changed = service.editNote(note.id, { expectedHash: current.hash, body: current.body + '\n\n## 用户追加章节\n不能丢弃。' });
  assert.throws(() => service.learning.confirmStudy(session.id, { body: '旧会话理解' }), { code: 'SOURCE_CHANGED' });
  assert.equal(service.getNote(note.id).body, changed.body);
  service.promote(note.id, { stage: 'retired', reason: '本次不再使用', expectedHash: changed.hash });
  const retired = service.getNote(note.id), confirmed = service.confirmNote(note.id, { expectedHash: retired.hash, body: '记录理解不等于重新启用。' });
  assert.equal(confirmed.meta.stage, 'retired'); assert.ok(confirmed.body.includes('用户追加章节'));
});
test('formal and practice state stay independent and blocked facts do not become learning evidence', () => {
  const formal = prepared().service;
  assert.throws(() => createIOSLearning({ practice: true, sources: [source()], clock }), { code: 'PRACTICE_ISOLATION' });
  const practice = createIOSLearning({ practice: true, clock });
  practice.saveSource({ title: '合成练习', body: '这只是一份练习原文。', meta: { platform: '合成' } });
  assert.equal(formal.state.notes.some(note => note.kind === 'source'), false);
  assert.equal(practice.state.notes[0].meta.practice, true);
  const fact = formal.extractSource(sourceID, { expectedHash: source().hash, title: '待核事实', body: '一个尚未研究的断言。', reason: '需核实。', claimType: 'fact' });
  assert.throws(() => formal.learning.startStudy({ noteId: fact.id }), { code: 'RESEARCH_REQUIRED' });
  assert.equal(Object.keys(formal.state.records.studyEvidence || {}).length, 0);
});
