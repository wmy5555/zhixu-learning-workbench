import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import { createAI } from '../src/ai.mjs';
import { createCallLedger } from '../src/call-ledger.mjs';
import { createService } from '../src/service.mjs';
import { createOnboarding } from '../src/onboarding.mjs';
import { createApp } from '../src/server.mjs';

function harness(t, { http = false } = {}) {
  const parent = path.resolve(import.meta.dirname, '../.tmp');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'onboarding-call-recovery-'));
  let ai, manager, note, attempts = 0;
  const requests = [];
  const dataDir = path.join(root, 'data');
  const main = createService({ dataDir, vaultDir: path.join(root, 'vault'), aiOverride: {
    generate: (...args) => ai.generate(...args),
    withCallContext: (...args) => ai.withCallContext(...args),
    getCallEvidence: (...args) => ai.getCallEvidence(...args),
  } });
  ai = createAI({ getSettings: () => main.settings(), getSecret: () => 'synthetic-test-only', getUsage: () => main.usage(), recordCall: () => {},
    callLedger: createCallLedger({ getStore: () => main.store }),
    fetchImpl: async (_url, options) => {
      attempts++; requests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: `合成练习回答 [${note.id}]`, citationIds: [note.id] }) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
    },
  });
  main.updateSettings({ ai: { enabled: true, baseUrl: 'https://8.8.8.8/v1', model: 'synthetic-model', dailyCallLimit: 10, monthlyBudget: 0, inputPrice: 1, outputPrice: 2 } });
  const app = http ? createApp({ dataDir, service: main, scheduler: false }) : null;
  function open() { manager = app?.onboarding || createOnboarding({ dataDir, mainService: main }); }
  open(); manager.start(); manager.tested('model'); // Synthetic receipt; no connection test or real provider.
  note = manager.currentService.store.create({ kind: 'knowledge', title: '合成练习账本规则', body: '合成练习账本规则只供回归测试。', meta: { stage: 'integrated', privacy: 'cloud' } });
  t.after(async () => {
    if (app?.server.listening) await new Promise(resolve => app.server.close(resolve));
    await manager.close(); await main.close();
    assert.ok(root.startsWith(`${parent}${path.sep}`)); fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    main, note, requests, app, input: { requestId: 'synthetic-practice-ask', question: '合成练习账本规则', privacy: 'cloud' },
    get manager() { return manager; }, get practice() { return manager.currentService; }, get attempts() { return attempts; },
    async reopen() { await manager.close(); open(); manager.resume(manager.state().practiceId); },
  };
}

test('onboarding generated ask saves its practice draft against the shared formal AI ledger', async t => {
  const h = harness(t);
  const privateNote = h.main.store.create({ kind: 'knowledge', title: '正式库本地合成资料', body: '不得进入练习问答。', meta: { privacy: 'local' } });
  assert.equal(h.practice.ai, h.main.ai);
  const result = await h.practice.ask(h.input);
  assert.equal(result.generated, true);
  assert.equal(result.answer, `合成练习回答 [${h.note.id}]`);
  assert.equal(h.attempts, 1);
  assert.equal(h.main.store.records('callLedger').length, 1);
  assert.equal(h.main.store.records('callLedger')[0].phase, 'accounted');
  assert.equal(h.main.store.records('drafts').length, 0);
  assert.equal(h.practice.store.records('drafts').length, 1);
  assert.equal(h.practice.store.row(privateNote.id), undefined);
  assert.ok(!JSON.stringify(h.requests).includes(privateNote.body));
  for (const ns of ['calls', 'callLedger', 'callResults']) assert.equal(h.practice.store.records(ns).length, 0);
  const [evidence] = h.practice.ai.getCallEvidence(`ask:${h.input.requestId}`);
  assert.deepEqual(Object.keys(evidence).sort(), ['capability', 'id', 'ok', 'phase', 'turnId']);
  assert.equal(evidence.ok, true);
  evidence.phase = 'unknown';
  assert.equal(h.main.store.get('callLedger', evidence.id).phase, 'accounted', 'evidence is a detached read-only projection');
  await h.reopen();
  assert.deepEqual(await h.practice.ask(h.input), result);
  assert.equal(h.attempts, 1);
});

function failWrite(service, predicate) {
  const put = service.store.put.bind(service.store);
  service.store.put = (namespace, key, data) => { if (predicate(namespace, data)) throw new Error('synthetic persistence failure'); return put(namespace, key, data); };
  return () => { service.store.put = put; };
}
function restoreBackup(service, backup) {
  const preview = service.restore({ backup });
  assert.equal(service.restore({ backup, preview: false, token: preview.token }).restored, true);
}

test('practice retries wait for formal accounting recovery then reuse the single paid response after reopen', async t => {
  const h = harness(t);
  const restore = failWrite(h.main, (ns, data) => ns === 'calls' && data.phase === 'accounted');
  await assert.rejects(h.practice.ask(h.input), { code: 'CALL_ACCOUNTING_FAILED' }); restore();
  const [pending] = h.main.callRecovery().pending;
  assert.equal(pending.phase, 'received');
  assert.equal(h.practice.store.records('drafts').length, 0);
  assert.throws(() => h.practice.recoverCall(pending.id, { action: 'recover' }), { code: 'PRACTICE_SETTINGS_LOCKED' });
  await h.reopen();
  await assert.rejects(h.practice.ask(h.input), { code: 'CALL_RECOVERY_REQUIRED' });
  assert.equal(h.attempts, 1);
  h.main.recoverCall(pending.id, { action: 'recover' });
  const result = await h.practice.ask(h.input);
  assert.equal(h.practice.store.get('askRequests', h.input.requestId).callId, pending.id);
  h.practice.updateDraft(result.draftId, { body: '合成人工编辑练习草稿。' });
  await h.reopen();
  assert.equal((await h.practice.ask(h.input)).answer, '合成人工编辑练习草稿。');
  assert.equal(h.attempts, 1);
  assert.equal(h.practice.store.records('drafts').length, 1);
  assert.equal(h.main.store.records('calls').length, 1);
});

test('practice backup cannot substitute a foreign call identity or a counterfeit practice ledger', async t => {
  const h = harness(t), result = await h.practice.ask(h.input), backup = h.practice.backup();
  const operationRow = backup.records.find(row => row.namespace === 'askRequests');
  const operation = JSON.parse(operationRow.json), foreignId = 'synthetic-foreign-call';
  operationRow.json = JSON.stringify({ ...operation, callId: foreignId });
  const draftRow = backup.records.find(row => row.namespace === 'drafts');
  draftRow.json = JSON.stringify({ ...JSON.parse(draftRow.json), body: '保留供人工查看的异机合成草稿。' });
  restoreBackup(h.practice, backup);
  for (const ns of ['calls', 'callLedger', 'callResults']) h.practice.store.put(ns, foreignId, { ...h.main.store.get(ns, operation.callId), id: foreignId });
  await assert.rejects(h.practice.ask(h.input), { code: 'CALL_RECOVERY_REQUIRED' });
  assert.equal(h.practice.store.get('drafts', result.draftId).body, '保留供人工查看的异机合成草稿。');
  assert.equal(h.attempts, 1);
  operationRow.json = JSON.stringify(operation);
  restoreBackup(h.practice, backup);
  await h.reopen();
  assert.equal((await h.practice.ask(h.input)).answer, '保留供人工查看的异机合成草稿。');
  assert.equal(h.attempts, 1);
});

test('practice restore without operation state cannot resend an intent retained by the formal ledger', async t => {
  const h = harness(t);
  await h.practice.ask(h.input);
  const backup = h.practice.backup();
  backup.records = backup.records.filter(row => row.namespace !== 'askRequests');
  restoreBackup(h.practice, backup); await h.reopen();
  await assert.rejects(h.practice.ask(h.input), { code: 'CALL_RECOVERY_REQUIRED' });
  assert.equal(h.attempts, 1);
  assert.equal(h.practice.store.records('drafts').length, 1);
});

test('restored completed practice cannot bypass a pending formal call or adopt another response after recovery', async t => {
  const h = harness(t);
  const undo = failWrite(h.main, (ns, data) => ns === 'calls' && data.phase === 'accounted');
  await assert.rejects(h.practice.ask(h.input), { code: 'CALL_ACCOUNTING_FAILED' }); undo();
  const [pending] = h.main.callRecovery().pending, backup = h.practice.backup();
  const row = backup.records.find(record => record.namespace === 'askRequests'), operation = JSON.parse(row.json);
  const body = '保留供人工检查的异机合成草稿。';
  row.json = JSON.stringify({ ...operation, completed: true, generated: true, callId: 'synthetic-foreign-call' });
  backup.records.push({ namespace: 'drafts', key: operation.draftId, json: JSON.stringify({ id: operation.draftId, mode: 'answer', question: h.input.question, body, citations: operation.prepared.citations, limitations: operation.prepared.limitations, usedIds: [], createdAt: operation.createdAt }) });
  restoreBackup(h.practice, backup); await h.reopen();
  await assert.rejects(h.practice.ask(h.input), { code: 'CALL_RECOVERY_REQUIRED' });
  h.main.recoverCall(pending.id, { action: 'recover' });
  await assert.rejects(h.practice.ask(h.input), { code: 'CALL_RECOVERY_REQUIRED' });
  assert.equal(h.practice.store.get('drafts', operation.draftId).body, body);
  assert.equal(h.attempts, 1);
});

test('shared ledger evidence preserves practice material permission checks before replaying a saved response', async t => {
  const h = harness(t);
  const restore = failWrite(h.practice, ns => ns === 'drafts');
  await assert.rejects(h.practice.ask(h.input), /synthetic persistence failure/); restore();
  h.practice.store.update(h.note.id, { expectedHash: h.note.hash, meta: { privacy: 'local' } });
  await h.reopen();
  await assert.rejects(h.practice.ask(h.input), { code: 'SOURCE_CHANGED' });
  assert.equal(h.attempts, 1);
  assert.equal(h.practice.store.records('drafts').length, 0);
});

test('practice asks still consume formal budgets and reject changed inputs under an existing identity', async t => {
  const h = harness(t);
  await h.practice.ask(h.input);
  await assert.rejects(h.practice.ask({ ...h.input, privacy: 'local' }), { code: 'ASK_REQUEST_CONFLICT' });
  h.main.updateSettings({ ai: { dailyCallLimit: 1 } });
  await assert.rejects(h.practice.ask({ ...h.input, requestId: 'synthetic-next-intent' }), { code: 'BUDGET_EXCEEDED' });
  assert.equal(h.attempts, 1);
  assert.equal(h.practice.store.records('drafts').length, 1);
  assert.equal(h.main.store.records('calls').length, 1);
});

test('practice ask HTTP route saves and retrieves the shared-ledger result with existing session and CSRF gates', async t => {
  const h = harness(t, { http: true });
  h.app.server.listen(0, '127.0.0.1'); await once(h.app.server, 'listening');
  const base = `http://127.0.0.1:${h.app.server.address().port}`;
  const sessionResponse = await fetch(base + '/api/session'), session = await sessionResponse.json();
  const cookie = sessionResponse.headers.get('set-cookie').split(';')[0];
  const prefix = `/api/practice/${h.manager.state().practiceId}`;
  async function request(route, body, csrf = session.csrf) {
    const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  }
  assert.equal((await request(prefix + '/ask', h.input, 'wrong')).status, 403);
  assert.equal(h.attempts, 0);
  const first = await request(prefix + '/ask', h.input);
  assert.equal(first.status, 200);
  assert.equal(first.data.answer, `合成练习回答 [${h.note.id}]`);
  assert.deepEqual(await request(prefix + '/ask', h.input), first);
  const drafts = await request(prefix + '/drafts');
  assert.equal(drafts.status, 200); assert.equal(drafts.data.drafts.length, 1);
  assert.equal((await request('/api/drafts')).data.drafts.length, 0);
  assert.equal(h.main.store.records('calls').length, 1);
  assert.equal(h.practice.store.records('calls').length, 0);
  assert.equal(h.attempts, 1);
  t.diagnostic(JSON.stringify({ synthetic: true, realProviderCalls: 0, invalidCSRF: 403, firstAsk: first.status, repeatAsk: 200, practiceDrafts: drafts.data.drafts.length, formalDrafts: 0, formalCalls: 1, practiceCalls: 0, transports: h.attempts }));
});
