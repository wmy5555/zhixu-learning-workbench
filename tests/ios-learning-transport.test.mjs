import test from 'node:test';
import assert from 'node:assert/strict';
import { createIOSLearningTransport } from '../apps/ios/web/ios-learning-transport.mjs';
import { createPreviewPlugin } from '../scripts/fixtures/ios-preview-native.mjs';

async function prepared() {
  const { plugin, controls } = createPreviewPlugin(), transport = createIOSLearningTransport(plugin);
  const { notes } = await plugin.list(), source = notes[0];
  const body = { expectedHash: source.hash, title: '合成个人打算', body: '先留下自己的回答。', claimType: 'opinion' };
  return { plugin, controls, transport, source, body };
}
test('iOS lost learning response retries exact draft and returns one persisted note', async t => {
  const network = t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected network'); });
  const { plugin, controls, transport, source, body } = await prepared();
  controls.dropNextLearningResponse = true;
  const path = `/api/notes/${source.id}/extract`;
  await assert.rejects(transport.request(path, { method: 'POST', body }), { code: 'COMMIT_UNKNOWN' });
  const before = await plugin.learningLoad({ context: 'formal' }); assert.equal(before.state.notes.length, 1);
  const retry = await transport.request(path, { method: 'POST', body: { claimType: body.claimType, body: body.body, title: body.title, expectedHash: body.expectedHash } });
  const after = await plugin.learningLoad({ context: 'formal' }); assert.equal(after.state.notes.length, 1); assert.equal(after.state.notes[0].id, retry.id);
  assert.equal(after.revision, before.revision);
  const commits = controls.calls.filter(call => call[0] === 'learningCommit'); assert.deepEqual(commits[0][1], commits[1][1]);
  assert.equal(network.mock.callCount(), 0);
});
test('iOS native source CAS rejects a stale extraction and rebuilds on a deliberate retry', async () => {
  const { plugin, controls, transport, source, body } = await prepared();
  controls.changeSourceBeforeLearningCommit = true;
  await assert.rejects(transport.request(`/api/notes/${source.id}/extract`, { method: 'POST', body }), { code: 'SOURCE_CHANGED' });
  assert.equal((await plugin.learningLoad({ context: 'formal' })).state.notes.length, 0);
  const changed = (await plugin.read({ id: source.id })).note;
  const note = await transport.request(`/api/notes/${source.id}/extract`, { method: 'POST', body: { ...body, expectedHash: changed.hash } });
  assert.equal(note.meta.sources[0].hash, changed.hash);
});
test('iOS transport persists offline start, answers and completion without network or formal/practice mixing', async () => {
  const { plugin, transport, source, body } = await prepared();
  const note = await transport.request(`/api/notes/${source.id}/extract`, { method: 'POST', body });
  await transport.request(`/api/notes/${note.id}/promote`, { method: 'POST', body: { expectedHash: note.hash, stage: 'learning', reason: '开始解释练习' } });
  const session = await transport.request('/api/study/start', { method: 'POST', body: { noteId: note.id, requestId: 'start-once' } });
  await transport.request(`/api/study/${session.id}/answer`, { method: 'POST', body: { answer: '保留自己的原始回答。', requestId: 'answer-once', hintUsed: false } });
  const complete = await transport.request(`/api/study/${session.id}/finish`, { method: 'POST' });
  assert.equal(complete.completion.reviewSettled, false); assert.equal(complete.turns[0].answer, '保留自己的原始回答。');
  const reopened = createIOSLearningTransport(plugin);
  assert.equal((await reopened.request('/api/study/start', { method: 'POST', body: { noteId: note.id, requestId: 'start-once' } })).id, session.id);
  await reopened.request('/api/ios/practice', { method: 'POST', body: { action: 'start' } });
  const formal = await plugin.learningLoad({ context: 'formal' }), practice = await plugin.learningLoad({ context: 'practice' });
  assert.equal(formal.state.notes.length, 1); assert.equal(practice.state.notes.length, 1); assert.equal(practice.state.notes[0].kind, 'source');
  await reopened.request('/api/ios/practice', { method: 'POST', body: { action: 'reset' } });
  assert.equal((await plugin.learningLoad({ context: 'formal' })).state.notes.length, 1); assert.equal((await plugin.learningLoad({ context: 'practice' })).state.notes.length, 0);
});
