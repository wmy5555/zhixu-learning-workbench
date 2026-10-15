import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createAI } from '../src/ai.mjs';
import { createCallLedger } from '../src/call-ledger.mjs';
import { createService } from '../src/service.mjs';
import { promptDefaults } from '../src/prompts.mjs';
import { hash } from '../src/store.mjs';

const feedback = { assessment: 'correct', feedback: '合成批改反馈，仅用于回归。', nextQuestion: '请解释这条合成规则。' };
const response = () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(feedback) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));

function harness(t, transport = async () => response()) {
  const parent = path.resolve(import.meta.dirname, '../.tmp');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'service-call-recovery-'));
  let service, ai, attempts = 0;
  const options = { dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'), aiOverride: {
    generate: (...args) => ai.generate(...args),
    embed: (...args) => ai.embed(...args),
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

test('ask survives accounting failure, reopen and local recovery without another transport or draft', async t => {
  let note;
  const h = harness(t, async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: `合成回答 [${note.id}]`, citationIds: [note.id] }) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } })));
  note = h.service.store.create({ kind: 'knowledge', title: '合成线性规则', body: '合成线性规则：假设 y=2x，则 x=4 时 y=8。', meta: { stage: 'integrated', privacy: 'cloud' } });
  const input = { requestId: 'synthetic-ask-intent', question: '合成线性规则', privacy: 'cloud' };
  failWrite(h.service, (namespace, data) => namespace === 'calls' && data.phase === 'accounted');
  await assert.rejects(h.service.ask(input), { code: 'CALL_ACCOUNTING_FAILED' });
  assert.equal(h.service.store.records('drafts').length, 0);
  const [pending] = h.service.callRecovery().pending;
  await h.reopen();
  await assert.rejects(h.service.ask(input), { code: 'CALL_RECOVERY_REQUIRED' });
  assert.equal(h.attempts, 1);
  h.service.recoverCall(pending.id, { action: 'recover' });
  h.service.updateSettings({ ai: { baseUrl: 'https://1.1.1.1/v1', model: 'changed-synthetic-model' } });
  h.service.updatePrompts({ prompts: { ask: `${promptDefaults.ask.template}\n合成新增说明。` } });
  const result = await h.service.ask(input);
  assert.equal(h.attempts, 1);
  assert.equal(h.service.store.records('drafts').length, 1);
  await h.reopen();
  assert.deepEqual(await h.service.ask(input), result);
  assert.equal(h.service.store.records('drafts').length, 1);
  assert.equal(h.attempts, 1);
  h.service.updateDraft(result.draftId, { body: '用户编辑的合成草稿。' });
  assert.equal((await h.service.ask(input)).answer, '用户编辑的合成草稿。');
  await assert.rejects(h.service.ask({ ...input, question: '另一个问题' }), { code: 'ASK_REQUEST_CONFLICT' });
  const regenerated = await h.service.ask({ ...input, requestId: 'synthetic-ask-new-intent' });
  assert.notEqual(regenerated.draftId, result.draftId);
  assert.equal(h.attempts, 2, 'the same question can be intentionally regenerated with a new identity');
  assert.equal(h.service.store.records('drafts').length, 2);
});

function askFixture(t, transport) {
  let note;
  const h = harness(t, async (...args) => transport ? transport(note, ...args) : new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: `合成回答 [${note.id}]`, citationIds: [note.id] }) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } })));
  note = h.service.store.create({ kind: 'knowledge', title: '合成问答规则', body: '合成问答规则只供回归测试。', meta: { stage: 'integrated', privacy: 'cloud' } });
  return { h, note, input: { question: '合成问答规则', privacy: 'cloud', requestId: 'synthetic-ask-intent' } };
}

function restoreBackup(service, backup) {
  const preview = service.restore({ backup });
  return service.restore({ backup, preview: false, token: preview.token });
}

test('restored completed ask cannot bypass a local unfinished call or substitute another machine response', async t => {
  const { h, note, input } = askFixture(t);
  const restore = failWrite(h.service, (ns, data) => ns === 'calls' && data.phase === 'accounted');
  await assert.rejects(h.service.ask(input), { code: 'CALL_ACCOUNTING_FAILED' }); restore();
  const localCall = h.service.callRecovery().pending[0], backup = h.service.backup();
  const operationRow = backup.records.find(row => row.namespace === 'askRequests');
  const operation = JSON.parse(operationRow.json), foreignId = 'foreign-completed-call';
  const resultRow = backup.records.find(row => row.namespace === 'callResults' && row.key === localCall.id);
  const result = JSON.parse(resultRow.json), body = `异机合成回答 [${note.id}]`;
  const responseBody = JSON.parse(result.response.body);
  responseBody.choices[0].message.content = JSON.stringify({ answer: body, citationIds: [note.id] });
  for (const row of backup.records.filter(row => ['calls','callLedger','callResults'].includes(row.namespace) && row.key === localCall.id)) {
    const value = JSON.parse(row.json); value.id = foreignId;
    if (row.namespace === 'callResults') value.response.body = JSON.stringify(responseBody);
    else { value.phase = 'accounted'; if (row.namespace === 'calls') value.cost = result.entry.cost; }
    row.key = foreignId; row.json = JSON.stringify(value);
  }
  const { prepared, ...completed } = operation;
  operationRow.json = JSON.stringify({ ...completed, completed: true, generated: true, callId: foreignId });
  backup.records.push({ namespace: 'drafts', key: operation.draftId, json: JSON.stringify({ id: operation.draftId, question: input.question, mode: 'answer', body, citations: prepared.citations, limitations: prepared.limitations, usedIds: [], createdAt: operation.createdAt }) });
  assert.equal(restoreBackup(h.service, backup).restored, true);
  await h.reopen();
  assert.equal(h.service.store.get('callLedger', localCall.id).phase, 'received');
  assert.equal(h.service.store.get('callLedger', foreignId), null);
  await assert.rejects(h.service.ask(input), { code: 'CALL_RECOVERY_REQUIRED' });
  h.service.recoverCall(localCall.id, { action: 'recover' });
  await assert.rejects(h.service.ask(input), { code: 'CALL_RECOVERY_REQUIRED' });
  assert.equal(h.attempts, 1);
  assert.equal(h.service.store.records('drafts').length, 1, 'explicitly restored data remains available for manual inspection');
});

test('older pending ask backup resumes from local accounted response and completed backup preserves manual draft edits', async t => {
  const { h, input } = askFixture(t);
  const restore = failWrite(h.service, (ns, data) => ns === 'calls' && data.phase === 'accounted');
  await assert.rejects(h.service.ask(input), { code: 'CALL_ACCOUNTING_FAILED' }); restore();
  const pendingBackup = h.service.backup(), callId = h.service.callRecovery().pending[0].id;
  h.service.recoverCall(callId, { action: 'recover' });
  const first = await h.service.ask(input);
  assert.equal(h.service.store.get('askRequests', input.requestId).callId, callId);
  restoreBackup(h.service, pendingBackup);
  await h.reopen();
  assert.equal(h.service.settings().ai.enabled, false);
  assert.equal(h.service.store.get('callLedger', callId).phase, 'accounted');
  await assert.rejects(h.service.ask(input), { code: 'CAPABILITY_DISABLED' });
  h.service.updateSettings({ ai: { enabled: true } });
  assert.deepEqual(await h.service.ask(input), first);
  h.service.updateDraft(first.draftId, { body: '合成人工修订，不是新的模型回答。' });
  const completedBackup = h.service.backup();
  restoreBackup(h.service, completedBackup);
  await h.reopen();
  assert.equal(h.service.settings().ai.enabled, false);
  assert.equal((await h.service.ask(input)).answer, '合成人工修订，不是新的模型回答。');
  assert.equal(h.attempts, 1);
  assert.equal(h.service.store.records('drafts').length, 1);
});

test('legacy completed ask without call identity stays readable as a draft but cannot claim an inferred replay', async t => {
  const { h, input } = askFixture(t), first = await h.service.ask(input);
  const backup = h.service.backup(), operationRow = backup.records.find(row => row.namespace === 'askRequests');
  const operation = JSON.parse(operationRow.json); delete operation.callId; operationRow.json = JSON.stringify(operation);
  restoreBackup(h.service, backup);
  await h.reopen();
  await assert.rejects(h.service.ask(input), { code: 'CALL_RECOVERY_REQUIRED' });
  assert.equal(h.service.store.get('drafts', first.draftId).body, first.answer);
  assert.equal(h.attempts, 1);
  // A historical backup may also have lost all billing rows. Their absence is
  // not evidence that its generated draft belongs to a known paid operation.
  const fresh = harness(t);
  const withoutBilling = { ...backup, records: backup.records.filter(row => !['calls','callLedger','callResults'].includes(row.namespace)) };
  restoreBackup(fresh.service, withoutBilling);
  await assert.rejects(fresh.service.ask(input), { code: 'CALL_RECOVERY_REQUIRED' });
  assert.equal(fresh.service.store.get('drafts', first.draftId).body, first.answer);
  assert.equal(fresh.attempts, 0);
});

test('ask query embedding receipt survives restore and recovery before one model generation', async t => {
  const { h, note, input } = askFixture(t, (note, url) => new Response(JSON.stringify(String(url).endsWith('/embeddings')
    ? { data: [{ index: 0, embedding: [1,0] }], usage: { prompt_tokens: 10, total_tokens: 10 } }
    : { choices: [{ message: { content: JSON.stringify({ answer: `合成回答 [${note.id}]`, citationIds: [note.id] }) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } })));
  h.service.updateSettings({ embedding: { enabled: true, baseUrl: 'https://8.8.8.8/v1', model: 'synthetic-embedding', inputPrice: 1 } });
  const restore = failWrite(h.service, (ns, data) => ns === 'calls' && data.phase === 'accounted' && data.capability === 'embedding');
  await assert.rejects(h.service.ask(input), { code: 'CALL_RECOVERY_REQUIRED' }); restore();
  const pending = h.service.callRecovery().pending[0];
  assert.equal(pending.capability, 'embedding');
  assert.equal(h.attempts, 1);
  const backup = h.service.backup();
  restoreBackup(h.service, backup);
  await h.reopen();
  assert.equal(h.service.settings().embedding.enabled, false);
  assert.equal(h.service.settings().ai.enabled, false);
  h.service.recoverCall(pending.id, { action: 'recover' });
  h.service.updateSettings({ ai: { enabled: true }, embedding: { enabled: true } });
  const completed = await h.service.ask(input);
  assert.match(completed.answer, new RegExp(note.id));
  assert.deepEqual(await h.service.ask(input), completed);
  assert.equal(h.attempts, 2, 'one embedding and one model request, with no repeated embedding charge');
  assert.deepEqual(h.service.store.records('calls').map(call => call.capability).sort(), ['embedding','model']);
  assert.equal(h.service.store.records('drafts').length, 1);
});

for (const namespace of ['drafts', 'askRequests']) test(`ask atomically rolls back ${namespace} completion failure and replays after reopen`, async t => {
  const { h, input } = askFixture(t);
  const restore = failWrite(h.service, (ns, data) => ns === namespace && (ns === 'drafts' || data.completed));
  await assert.rejects(h.service.ask(input), /synthetic persistence failure/); restore();
  assert.equal(h.attempts, 1);
  assert.equal(h.service.store.records('drafts').length, 0);
  assert.equal(h.service.store.get('askRequests', input.requestId).completed, undefined);
  await h.reopen();
  await h.service.ask(input);
  assert.equal(h.attempts, 1);
  assert.equal(h.service.store.records('drafts').length, 1);
});

test('ask persists its identity before sending and blocks duplicate in-flight submits', async t => {
  let release;
  const { h, note, input } = askFixture(t, () => new Promise(resolve => { release = resolve; }));
  const restore = failWrite(h.service, ns => ns === 'askRequests');
  await assert.rejects(h.service.ask(input), /synthetic persistence failure/); restore();
  assert.equal(h.attempts, 0);
  const first = h.service.ask(input);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(h.service.ask(input), { code: 'BUSY' });
  release(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: `合成回答 [${note.id}]`, citationIds: [note.id] }) } }] })));
  await first;
  assert.equal(h.attempts, 1);
  assert.equal(h.service.store.records('drafts').length, 1);
});

test('ask with an unknown response stays blocked after restart and known-cost confirmation', async t => {
  const { h, input } = askFixture(t, () => { throw new Error('synthetic connection lost'); });
  await assert.rejects(h.service.ask(input));
  const [pending] = h.service.callRecovery().pending;
  await h.reopen();
  h.service.recoverCall(pending.id, { action: 'confirm', cost: .01, reason: '合成账单已核对，没有响应。' });
  await assert.rejects(h.service.ask(input), { code: 'CALL_RECOVERY_REQUIRED' });
  assert.equal(h.attempts, 1);
  assert.equal(h.service.store.records('drafts').length, 0);
});

for (const change of ['disabled', 'material', 'permission']) test(`ask recovered response preserves the ${change} gate`, async t => {
  const { h, input, note } = askFixture(t);
  const restore = failWrite(h.service, (ns, data) => ns === 'calls' && data.phase === 'accounted');
  await assert.rejects(h.service.ask(input), { code: 'CALL_ACCOUNTING_FAILED' }); restore();
  h.service.recoverCall(h.service.callRecovery().pending[0].id, { action: 'recover' });
  if (change === 'disabled') h.service.updateSettings({ ai: { enabled: false } });
  else h.service.editNote(note.id, { expectedHash: note.hash, ...(change === 'permission' ? { meta: { privacy: 'local' } } : { body: '用户修改过的合成材料。' }) });
  await assert.rejects(h.service.ask(input), { code: change === 'disabled' ? 'CAPABILITY_DISABLED' : 'SOURCE_CHANGED' });
  assert.equal(h.attempts, 1);
  assert.equal(h.service.store.records('drafts').length, 0);
});

test('ask cannot resend a restored identity whose operation state is missing', async t => {
  const { h, input } = askFixture(t);
  await h.service.ask(input);
  h.service.store.remove('askRequests', input.requestId);
  await h.reopen();
  await assert.rejects(h.service.ask(input), { code: 'CALL_RECOVERY_REQUIRED' });
  assert.equal(h.attempts, 1);
});

test('ask rejects a restored operation whose input conflicts with retained local billing evidence', async t => {
  const { h, input } = askFixture(t);
  await h.service.ask(input);
  const request = h.service.store.get('askRequests', input.requestId);
  const changed = { ...request.input, question: '另一份合成输入' };
  h.service.store.put('askRequests', input.requestId, { ...request, input: changed });
  await assert.rejects(h.service.ask({ ...changed, requestId: input.requestId }), { code: 'ASK_REQUEST_CONFLICT' });
  assert.equal(h.attempts, 1);
});

test('ask rechecks material permission after the model responds and before saving', async t => {
  let release;
  const { h, note, input } = askFixture(t, () => new Promise(resolve => { release = resolve; }));
  const first = h.service.ask(input);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  h.service.editNote(note.id, { expectedHash: note.hash, meta: { privacy: 'local' } });
  release(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: `合成回答 [${note.id}]`, citationIds: [note.id] }) } }] })));
  await assert.rejects(first, { code: 'SOURCE_CHANGED' });
  assert.equal(h.attempts, 1);
  assert.equal(h.service.store.records('drafts').length, 0);
});

test('ask refuses a divergent restored material basis instead of applying the local older response', async t => {
  const { h, note, input } = askFixture(t);
  const restore = failWrite(h.service, (ns, data) => ns === 'calls' && data.phase === 'accounted');
  await assert.rejects(h.service.ask(input), { code: 'CALL_ACCOUNTING_FAILED' }); restore();
  h.service.recoverCall(h.service.callRecovery().pending[0].id, { action: 'recover' });
  const changed = h.service.editNote(note.id, { expectedHash: note.hash, body: '同一身份的另一版合成依据。' });
  const request = h.service.store.get('askRequests', input.requestId);
  request.prepared.references[0].hash = changed.hash;
  request.basisHash = hash(JSON.stringify([request.input, request.prepared.references]));
  h.service.store.put('askRequests', request.id, request);
  await h.reopen();
  await assert.rejects(h.service.ask(input), { code: 'ASK_REQUEST_CONFLICT' });
  assert.equal(h.attempts, 1);
  assert.equal(h.service.store.records('drafts').length, 0);
});

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
