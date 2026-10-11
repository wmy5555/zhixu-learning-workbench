import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAndroidTransport } from '../apps/android/web/android-transport.mjs';
import { createEmptyLearningState } from '../apps/android/web/android-learning.mjs';

const sourceId = '11111111-1111-4111-8111-111111111111';
const clock = () => new Date('2026-10-08T02:00:00.000Z');
const raw = () => ({ id: sourceId, kind: 'source', title: '个人反思', body: '我准备每天记录想法。正文专用检索词。', hash: 'source-version-1', meta: { stage: 'reference', privacy: 'local' } });
function fakeNative() {
  const states = { formal: { revision: 'empty', state: createEmptyLearningState() }, practice: { revision: 'empty', state: createEmptyLearningState() } };
  const calls = [], sources = [raw()];
  let failNext = false;
  const plugin = {
    async learningLoad({ context }) { calls.push(['learningLoad', context]); return structuredClone(states[context]); },
    async learningCommit({ context, expectedRevision, state }) {
      calls.push(['learningCommit', context]);
      if (failNext) { failNext = false; throw Object.assign(new Error('合成写入失败'), { code: 'STORE_ERROR' }); }
      if (states[context].revision !== expectedRevision) throw Object.assign(new Error('合成版本冲突'), { code: 'CONFLICT' });
      for (const note of state.notes) assert.deepEqual(Object.keys(note).sort(), ['body', 'hash', 'id', 'kind', 'meta', 'title']);
      states[context] = structuredClone({ revision: randomUUID(), state });
      return structuredClone(states[context]);
    },
    async learningReset({ context, expectedRevision }) {
      assert.equal(context, 'practice'); assert.equal(expectedRevision, states.practice.revision);
      states.practice = { revision: randomUUID(), state: createEmptyLearningState() };
      calls.push(['learningReset', context]); return structuredClone(states.practice);
    },
    async list() { calls.push(['list', 'formal']); return { notes: structuredClone(sources) }; },
    async read({ id }) { calls.push(['read', 'formal']); const note = sources.find(n => n.id === id); if (!note) throw Object.assign(new Error('不存在'), { code: 'NOT_FOUND' }); return { note: structuredClone(note) }; },
    async save(value) { calls.push(['save', 'formal']); const note = { ...raw(), ...structuredClone(value), id: value.id || randomUUID() }; sources.push(note); return { note }; },
    async pickSource() { calls.push(['pickSource']); return { name: '练习.txt', text: '合成待确认草稿' }; },
  };
  for (const method of ['exportLearningBackup', 'previewLearningBackup', 'restoreLearningBackup']) plugin[method] = async args => { calls.push([method, args]); return args; };
  return { plugin, states, sources, calls, failNext: () => { failNext = true; } };
}
const post = (transport, path, body = {}) => transport.request(path, { method: 'POST', body });

test('learning backup preview validates the exact WebView state before exposing a restore token', async () => {
  for (const context of ['formal', 'practice']) {
    const native = fakeNative(), transport = createAndroidTransport(native.plugin, { clock });
    let candidateState = createEmptyLearningState();
    native.plugin.previewLearningBackup = async () => ({ token: 'candidate-token', context, notes: 0, history: 0, canRestore: true, candidateState });
    const route = context === 'practice' ? '/api/practice/android-local/android/learning-backup-preview' : '/api/android/learning-backup-preview';
    const before = structuredClone(native.states);
    for (const corrupt of [
      state => { state.settings.dailyMinutes = '25'; },
      state => { state.settings.timezone = 'Not/AZone'; },
      state => { state.records.unknown = {}; },
      state => { state.records.sessions = { invalid: {} }; },
      state => { state.records.jobs = { pending: {} }; },
      state => { state.guide = []; },
    ]) {
      candidateState = createEmptyLearningState(); corrupt(candidateState);
      await assert.rejects(post(transport, route), { code: 'INVALID' });
      assert.deepEqual(native.states, before);
    }
    candidateState = createEmptyLearningState();
    candidateState.settings = { dailyMinutes: 35, timezone: 'Asia/Singapore' };
    const preview = await post(transport, route);
    assert.equal(preview.token, 'candidate-token');
    assert.equal(preview.context, context);
    assert.equal(Object.hasOwn(preview, 'candidateState'), false);
    assert.equal(native.calls.some(([name]) => ['learningCommit', 'restoreLearningBackup'].includes(name)), false);
  }
});
async function ready(transport, prefix = '/api', id = sourceId, hash = 'source-version-1') {
  const note = await post(transport, `${prefix}/notes/${id}/extract`, { expectedHash: hash, title: '个人观点', body: '我想用自己的话重述，再记录不明白之处。', claimType: 'opinion', depth: 'explain' });
  const promoted = await post(transport, `${prefix}/notes/${note.id}/promote`, { stage: 'learning', reason: '记录自己的练习', expectedHash: note.hash });
  const today = await transport.request(`${prefix}/today`);
  const plan = today.items.find(item => item.noteId === note.id);
  const session = await post(transport, `${prefix}/study/start`, { noteId: note.id, planId: plan.id });
  return { note: promoted, plan, session };
}

test('Android answer and finish persist once, survive transport reopen, and never claim grading or mastery', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Offline learning must never use HTTP'));
  const native = fakeNative(), transport = createAndroidTransport(native.plugin, { clock });
  const { session, plan, note } = await ready(transport);
  const payload = { answer: '这是我的回答，不预先假定正确。', requestId: 'same-request', hintUsed: false };
  const [first, repeated] = await Promise.all([post(transport, `/api/study/${session.id}/answer`, payload), post(transport, `/api/study/${session.id}/answer`, payload)]);
  assert.equal(first.status, 'unassessed'); assert.equal(repeated.turns.length, 1);
  assert.equal(first.turns[0].feedback, undefined); assert.equal(first.pendingJobId, null);
  const complete = await post(transport, `/api/study/${session.id}/finish`);
  assert.equal(complete.status, 'completed'); assert.equal(complete.completion.reviewSettled, false);
  assert.equal(complete.completion.evidence.independent, false); assert.equal(complete.completion.evidence.assessment, 'unassessed');
  const before = structuredClone(native.states.formal);
  const reopened = createAndroidTransport(native.plugin, { clock });
  assert.deepEqual(await post(reopened, `/api/study/${session.id}/finish`), complete);
  assert.deepEqual(native.states.formal, before, 'duplicate finish must not create another native revision');
  assert.equal(native.states.formal.state.records.plans[plan.id].state, 'done');
  assert.equal(Object.keys(native.states.formal.state.records.studyEvidence).length, 1);
  assert.equal(native.states.formal.state.records.reviews?.[note.id], undefined);
  assert.equal((await reopened.request(`/api/notes/${note.id}`)).meta.stage, 'learning');
  const guide = await reopened.request('/api/android/guide');
  assert.equal(guide.completed, true);
});

test('failed native answer commit rejects optimistic success and retries preserve a single answer', async () => {
  const native = fakeNative(), transport = createAndroidTransport(native.plugin, { clock });
  const { session } = await ready(transport);
  const before = structuredClone(native.states.formal);
  native.failNext();
  const answer = { answer: '失败后仍保留输入', requestId: 'retryable' };
  await assert.rejects(post(transport, `/api/study/${session.id}/answer`, answer), { code: 'STORE_ERROR' });
  assert.deepEqual(native.states.formal, before);
  const saved = await post(transport, `/api/study/${session.id}/answer`, answer);
  assert.equal(saved.turns.length, 1);
  assert.equal((await transport.request(`/api/study/${session.id}`)).turns[0].answer, answer.answer);
});

test('separate WebViews use native CAS and a rejected draft cannot overwrite the winner', async () => {
  const native = fakeNative(), first = createAndroidTransport(native.plugin, { clock });
  const { session } = await ready(first);
  const second = createAndroidTransport(native.plugin, { clock });
  const outcomes = await Promise.allSettled([
    post(first, `/api/study/${session.id}/answer`, { answer: '甲回答', requestId: 'a' }),
    post(second, `/api/study/${session.id}/answer`, { answer: '乙回答', requestId: 'b' }),
  ]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(item => item.status === 'rejected').reason.code, 'CONFLICT');
  assert.equal(native.states.formal.state.records.sessions[session.id].turns.length, 1);
  const failedIndex = outcomes.findIndex(item => item.status === 'rejected');
  await post(second, `/api/study/${session.id}/answer`, { answer: failedIndex ? '乙回答' : '甲回答', requestId: failedIndex ? 'b' : 'a' });
  assert.equal(native.states.formal.state.records.sessions[session.id].turns.length, 2);
});

test('practice data and guide stay isolated through seed, answer, backup routing and reset', async () => {
  const native = fakeNative(), transport = createAndroidTransport(native.plugin, { clock });
  const formal = structuredClone(native.states.formal), originalSources = structuredClone(native.sources);
  await post(transport, '/api/android/practice', { action: 'start' });
  const prefix = '/api/practice/android-local';
  const boot = await transport.request(`${prefix}/bootstrap`), source = boot.notes.find(n => n.kind === 'source');
  assert.equal(boot.notes.length, 1); assert.equal(boot.today.items.length, 0);
  assert.match(source.title, /合成/); assert.equal(boot.capabilities.ai, false);
  const { session } = await ready(transport, prefix, source.id, source.hash);
  await post(transport, `${prefix}/study/${session.id}/answer`, { answer: '练习回答', requestId: 'practice' });
  await post(transport, `${prefix}/study/${session.id}/finish`);
  assert.equal((await transport.request(`${prefix}/android/guide`)).completed, true);
  for (const route of ['source-export', 'backup-export', 'backup-preview', 'backup-restore']) {
    await assert.rejects(post(transport, `${prefix}/android/${route}`), { code: 'ANDROID_UNAVAILABLE' });
  }
  await post(transport, `${prefix}/android/source-file`);
  await post(transport, `${prefix}/android/learning-backup-export`);
  assert.deepEqual(native.calls.at(-1), ['exportLearningBackup', { context: 'practice' }]);
  await assert.rejects(post(transport, '/api/android/practice', { action: 'reset' }), { code: 'ANDROID_UNAVAILABLE' });
  await post(transport, `${prefix}/android/practice`, { action: 'reset' });
  assert.deepEqual(native.states.formal, formal); assert.deepEqual(native.sources, originalSources);
  assert.equal(native.states.practice.state.notes.length, 0);
  assert.equal(native.calls.some(([method]) => ['list', 'read', 'save'].includes(method)), false);
});

test('fact and obsolete source gates survive transport and formal body search remains available', async () => {
  const native = fakeNative(), transport = createAndroidTransport(native.plugin, { clock });
  const fact = await post(transport, `/api/notes/${sourceId}/extract`, { expectedHash: raw().hash, title: '需核验事实', body: '未经核验的事实陈述。', claimType: 'fact' });
  await post(transport, `/api/notes/${fact.id}/promote`, { stage: 'learning', reason: '希望学习', expectedHash: fact.hash });
  await assert.rejects(post(transport, '/api/study/start', { noteId: fact.id }), { code: 'RESEARCH_REQUIRED' });
  assert.equal((await transport.request('/api/notes?q=正文专用检索词')).notes[0].id, sourceId);
  const { note } = await ready(transport);
  const evidence = await transport.request(`/api/notes/${note.id}/evidence`);
  assert.equal(evidence.sourceSnapshot.body, native.sources[0].body);
  assert.deepEqual(evidence.evidence, []);
  await assert.rejects(post(transport, `/api/notes/${note.id}/evidence`), { code: 'ANDROID_UNAVAILABLE' });
  native.sources[0].hash = 'changed-source';
  await assert.rejects(post(transport, '/api/study/start', { noteId: note.id }), { code: 'RESEARCH_REQUIRED' });
  await assert.rejects(post(transport, `/api/notes/${sourceId}/extract`, { expectedHash: raw().hash, title: '旧表单', body: '旧正文', claimType: 'opinion' }), { code: 'SOURCE_CHANGED' });
  const detail = await transport.request(`/api/notes/${sourceId}`);
  assert.equal(detail.children.length, 2); assert.equal(detail.body, native.sources[0].body);
});

test('unsupported methods, forged contexts and scoped file overrides fail before native access', async () => {
  const native = fakeNative(), transport = createAndroidTransport(native.plugin);
  for (const [path, method] of [
    ['/api/practice/other/bootstrap', 'GET'], ['/api/notes/../bootstrap', 'GET'], ['/api/practice/android-local/../../bootstrap', 'GET'],
    ['/api/ask', 'POST'], ['/api/jobs', 'GET'], ['/api/study', 'POST'], ['/api/topics/suggest', 'POST'],
    ['/api/android/learning-backup-export?context=formal', 'POST'], ['/api/android/learning-backup-preview', 'GET'],
  ]) await assert.rejects(transport.request(path, { method }), { code: 'ANDROID_UNAVAILABLE' });
  await assert.rejects(post(transport, '/api/practice/android-local/android/learning-backup-restore', { token: 'test', context: 'formal' }), { code: 'VALIDATION' });
  assert.deepEqual(native.calls, []);
});
