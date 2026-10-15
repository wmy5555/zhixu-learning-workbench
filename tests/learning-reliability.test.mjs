import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createService } from '../src/service.mjs';

function harness(t) {
  const parent = path.resolve(import.meta.dirname, '../.tmp');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'learning-reliability-'));
  const options = { dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'), aiOverride: {
    generate: async () => ({ text: JSON.stringify({ assessment: 'correct', feedback: '合成反馈，仅用于回归。' }) }),
  } };
  let service = createService(options);
  t.after(async () => { await service.close(); assert.ok(root.startsWith(`${parent}${path.sep}`)); fs.rmSync(root, { recursive: true, force: true }); });
  return {
    get service() { return service; },
    async reopen() { await service.close(); service = createService(options); },
    start() {
      const note = service.store.create({ kind: 'knowledge', title: '合成线性规则', body: '假设 y=2x，则 x=4 时 y=8。', meta: { stage: 'learning', privacy: 'cloud', depth: 'explain' } });
      return service.startStudy({ noteId: note.id });
    },
  };
}

test('failed answer persistence rolls back the grading job and exact retry persists one pair', async t => {
  const h = harness(t), session = h.start(), put = h.service.store.put.bind(h.service.store);
  h.service.store.put = (namespace, ...args) => { if (namespace === 'sessions') throw new Error('synthetic disk failure'); return put(namespace, ...args); };
  const answer = { answer: '由假设代入得 8。', requestId: 'atomic-answer' };
  assert.throws(() => h.service.answerStudy(session.id, answer), /synthetic disk failure/);
  assert.equal(h.service.store.records('jobs').length, 0);
  assert.equal(h.service.session(session.id).turns.length, 0);
  h.service.store.put = put;
  h.service.answerStudy(session.id, answer);
  h.service.answerStudy(session.id, answer);
  await h.reopen();
  assert.equal(h.service.session(session.id).turns.length, 1);
  assert.equal(h.service.session(session.id).turns[0].answer, answer.answer);
  assert.equal(h.service.store.records('jobs').length, 1);
});

test('feedback and settlement survive reopening and a final hint never counts as independent recall', async t => {
  const h = harness(t), session = h.start();
  h.service.answerStudy(session.id, { answer: '在给定规则内答案为 8。', requestId: 'settlement-answer' });
  await h.service.runJobs();
  assert.equal(h.service.session(session.id).status, 'feedback');
  h.service.hintStudy(session.id);
  const completed = h.service.finishStudy(session.id);
  assert.equal(completed.completion.evidence.usedHints, true);
  assert.equal(completed.completion.evidence.independent, false);
  await h.reopen();
  const reopened = h.service.session(session.id);
  assert.equal(reopened.status, 'completed');
  assert.equal(reopened.turns[0].feedback.assessment, 'correct');
  assert.deepEqual(reopened.completion, completed.completion);
  assert.deepEqual(h.service.store.get('studyEvidence', session.id), completed.completion.evidence);
  assert.deepEqual(h.service.finishStudy(session.id), reopened);
});
