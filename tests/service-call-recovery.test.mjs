import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createAI } from '../src/ai.mjs';
import { createCallLedger } from '../src/call-ledger.mjs';
import { createService } from '../src/service.mjs';
import { promptDefaults } from '../src/prompts.mjs';

const feedback = { assessment: 'correct', feedback: '合成批改反馈，仅用于回归。', nextQuestion: '请解释这条合成规则。' };
const response = () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(feedback) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));

function harness(t, transport = async () => response()) {
  const parent = path.resolve(import.meta.dirname, '../.tmp');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'service-call-recovery-'));
  let service, ai, attempts = 0;
  const options = { dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'), aiOverride: {
    generate: (...args) => ai.generate(...args),
    withCallContext: (...args) => ai.withCallContext(...args),
  } };
  function open() {
    service = createService(options);
    ai = createAI({ getSettings: () => service.settings(), getSecret: () => 'synthetic-test-only', getUsage: () => service.usage(), recordCall: () => {},
      callLedger: createCallLedger({ getStore: () => service.store }),
      fetchImpl: async (...args) => { attempts++; return transport(...args); },
    });
  }
  open();
  service.updateSettings({ ai: { enabled: true, baseUrl: 'https://8.8.8.8/v1', model: 'synthetic-model', dailyCallLimit: 10, monthlyBudget: 0, inputPrice: 1, outputPrice: 2 } });
  t.after(async () => { await service.close(); assert.ok(root.startsWith(`${parent}${path.sep}`)); fs.rmSync(root, { recursive: true, force: true }); });
  return {
    get service() { return service; }, get attempts() { return attempts; },
    async reopen() { await service.close(); open(); },
    start() {
      const note = service.store.create({ kind: 'knowledge', title: '合成线性规则', body: '假设 y=2x，则 x=4 时 y=8。', meta: { stage: 'learning', privacy: 'cloud', depth: 'explain' } });
      const session = service.startStudy({ noteId: note.id });
      service.answerStudy(session.id, { answer: '由假设代入得 8。', requestId: 'synthetic-answer' });
      return { note, session, job: service.store.records('jobs').find(job => job.type === 'grade' && job.payload.sessionId === session.id) };
    },
    retry(job) { service.jobAction(job.id, { action: 'retry' }); return service.runJobs(); },
  };
}

function failWrite(service, predicate) {
  const put = service.store.put.bind(service.store);
  service.store.put = (namespace, key, data) => { if (predicate(namespace, data)) throw new Error('synthetic persistence failure'); return put(namespace, key, data); };
  return () => { service.store.put = put; };
}

test('grade recovers accounting locally after reopen and reuses original feedback despite prompt/provider changes', async t => {
  const h = harness(t), { session, job } = h.start();
  failWrite(h.service, (namespace, data) => namespace === 'calls' && data.phase === 'accounted');
  await h.service.runJobs();
  assert.equal(h.service.store.get('jobs', job.id).state, 'waiting');
  assert.equal(h.service.store.get('jobs', job.id).code, 'CALL_ACCOUNTING_FAILED');
  assert.equal(h.service.session(session.id).turns[0].feedback, undefined);
  assert.equal(h.service.session(session.id).turns[0].answer, '由假设代入得 8。');
  const [pending] = h.service.callRecovery().pending;
  assert.equal(pending.phase, 'received');
  assert.equal(pending.jobId, job.id);
  assert.equal(pending.turnId, job.payload.turnId);
  assert.match(h.service.store.get('callResults', pending.id).response.body, /合成批改反馈/);
  await h.reopen();
  await h.retry(job);
  assert.equal(h.service.store.get('jobs', job.id).code, 'CALL_RECOVERY_REQUIRED');
  assert.equal(h.attempts, 1);
  h.service.recoverCall(pending.id, { action: 'recover' });
  assert.equal(h.attempts, 1, 'recovery performs local accounting only');
  h.service.updateSettings({ ai: { baseUrl: 'https://1.1.1.1/v1', model: 'changed-synthetic-model', inputPrice: 500 } });
  h.service.updatePrompts({ prompts: { grade: `${promptDefaults.grade.template}\n合成测试新增说明。` } });
  await h.retry(job);
  assert.equal(h.service.store.get('jobs', job.id).state, 'done');
  assert.deepEqual(h.service.session(session.id).turns[0].feedback, feedback);
  assert.equal(h.attempts, 1);
  assert.equal(h.service.store.records('calls').length, 1);
  assert.equal(h.service.store.records('calls')[0].cost, .00014);
  assert.equal(h.service.callRecovery().pending.length, 0);
});

test('unknown grade remains blocked after restart, explicit unknown confirmation, and known-cost confirmation', async t => {
  const h = harness(t, async () => { throw new Error('synthetic connection lost after dispatch'); });
  const { session, job } = h.start();
  await h.service.runJobs();
  const [pending] = h.service.callRecovery().pending;
  assert.equal(pending.phase, 'unknown');
  assert.equal(h.service.store.get('calls', pending.id).cost, null);
  assert.equal(h.service.session(session.id).turns[0].feedback, undefined);
  await h.reopen();
  assert.throws(() => h.service.recoverCall(pending.id, { action: 'recover' }), { code: 'CALL_RESULT_UNKNOWN' });
  h.service.recoverCall(pending.id, { action: 'confirm', cost: null, reason: '合成供应商记录仍未说明费用。' });
  assert.equal(h.service.callRecovery().pending.length, 1);
  await h.retry(job);
  assert.equal(h.service.store.get('jobs', job.id).state, 'waiting');
  assert.equal(h.service.store.get('jobs', job.id).code, 'CALL_RECOVERY_REQUIRED');
  h.service.recoverCall(pending.id, { action: 'confirm', cost: .02, reason: '合成账单已核对；没有取得响应。' });
  assert.equal(h.service.callRecovery().pending.length, 0);
  h.service.updateSettings({ ai: { model: 'changed-synthetic-model' } });
  await h.retry(job);
  assert.equal(h.service.store.get('jobs', job.id).code, 'CALL_RECOVERY_REQUIRED');
  assert.equal(h.service.session(session.id).turns[0].feedback, undefined);
  assert.equal(h.attempts, 1, 'confirming cost never authorizes the original grade to resend');
});

test('disabled model capability cannot apply recovered grade feedback', async t => {
  const h = harness(t), { session, job } = h.start();
  const restore = failWrite(h.service, (namespace, data) => namespace === 'calls' && data.phase === 'accounted');
  await h.service.runJobs(); restore();
  const [pending] = h.service.callRecovery().pending;
  h.service.recoverCall(pending.id, { action: 'recover' });
  h.service.updateSettings({ ai: { enabled: false } });
  await h.retry(job);
  assert.equal(h.service.store.get('jobs', job.id).code, 'CAPABILITY_DISABLED');
  assert.equal(h.service.store.get('jobs', job.id).state, 'waiting');
  assert.equal(h.service.session(session.id).turns[0].feedback, undefined);
  assert.equal(h.attempts, 1);
  h.service.updateSettings({ ai: { enabled: true } });
  await h.retry(job);
  assert.deepEqual(h.service.session(session.id).turns[0].feedback, feedback);
  assert.equal(h.attempts, 1);
});

test('closing material cloud permission prevents applying an already saved grade', async t => {
  const h = harness(t), { note, session, job } = h.start();
  const restore = failWrite(h.service, (namespace, data) => namespace === 'calls' && data.phase === 'accounted');
  await h.service.runJobs(); restore();
  const [pending] = h.service.callRecovery().pending;
  h.service.recoverCall(pending.id, { action: 'recover' });
  h.service.editNote(note.id, { expectedHash: note.hash, meta: { privacy: 'local' } });
  await h.retry(job);
  assert.equal(h.service.store.get('jobs', job.id).code, 'SOURCE_CHANGED');
  assert.equal(h.service.session(session.id).turns[0].feedback, undefined);
  assert.equal(h.attempts, 1);
});

for (const fault of [
  { code: 'CALL_RESULT_SAVE_FAILED', transport: async () => response(), predicate: namespace => namespace === 'callResults' },
  { code: 'CALL_PERSISTENCE_FAILED', transport: async () => { throw new Error('synthetic lost connection'); }, predicate: (namespace, data) => namespace === 'calls' && data.phase === 'unknown' },
]) test(`${fault.code} leaves the grading job waiting and cannot resend`, async t => {
  const h = harness(t, fault.transport), { session, job } = h.start();
  const restore = failWrite(h.service, fault.predicate);
  await h.service.runJobs(); restore();
  assert.equal(h.service.store.get('jobs', job.id).code, fault.code);
  assert.equal(h.service.store.get('jobs', job.id).state, 'waiting');
  assert.equal(h.service.callRecovery().pending[0].phase, 'dispatch');
  await h.retry(job);
  assert.equal(h.service.store.get('jobs', job.id).code, 'CALL_RECOVERY_REQUIRED');
  assert.equal(h.service.session(session.id).turns[0].feedback, undefined);
  assert.equal(h.attempts, 1);
});
