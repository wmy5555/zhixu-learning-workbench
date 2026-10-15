import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { createAI } from '../src/ai.mjs';
import { createCallLedger } from '../src/call-ledger.mjs';
import { buildUsageReport } from '../src/usage.mjs';

const config = () => ({ timezone: 'Asia/Singapore', ai: { enabled: true, baseUrl: 'https://8.8.8.8/v1', model: 'synthetic-model', dailyCallLimit: 10, monthlyBudget: 0, inputPrice: 1, outputPrice: 2 },
  search: { enabled: true, baseUrl: 'https://8.8.8.8', requestPrice: .2 }, embedding: { enabled: true, baseUrl: 'https://8.8.8.8/v1', model: 'synthetic-embedding', inputPrice: 1 }, fetch: { enabled: true } });
const response = () => new Response(JSON.stringify({ choices: [{ message: { content: 'Saved synthetic answer' } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
const context = { key: 'synthetic-task-v1', jobId: 'synthetic-job', turnId: 'synthetic-turn' };
function harness(t, fetchImpl = async () => response()) {
  fs.mkdirSync('.tmp', { recursive: true });
  const directory = fs.mkdtempSync(path.resolve('.tmp/call-recovery-'));
  let store = new Store({ dataDir: path.join(directory, 'data'), vaultDir: path.join(directory, 'vault') });
  let ledger = createCallLedger({ getStore: () => store });
  const settings = config();
  let attempts = 0;
  const makeAI = () => createAI({ getSettings: () => settings, getSecret: () => 'synthetic-test-only', getUsage: () => ({}), recordCall: () => {}, callLedger: ledger,
    fetchImpl: async (...args) => { attempts++; return fetchImpl(...args); } });
  let ai = makeAI();
  const generate = () => ai.withCallContext(context, () => ai.generate({ prompt: 'Synthetic content', privacy: 'cloud' }));
  const reopen = () => { if (store.db.isOpen) store.db.close(); store = new Store({ dataDir: path.join(directory, 'data'), vaultDir: path.join(directory, 'vault') }); ledger = createCallLedger({ getStore: () => store }); ai = makeAI(); };
  t.after(() => { if (store.db.isOpen) store.db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { directory, settings, generate, reopen, get ai() { return ai; }, get store() { return store; }, get ledger() { return ledger; }, get attempts() { return attempts; } };
}

test('reservation commits before transport and rejects a persistence failure without contacting provider', async t => {
  const h = harness(t);
  const put = h.store.put.bind(h.store);
  h.store.put = (namespace, key, data) => { if (namespace === 'callLedger') throw new Error('synthetic disk failure'); return put(namespace, key, data); };
  await assert.rejects(h.generate(), /synthetic disk failure/);
  assert.equal(h.attempts, 0);
  assert.equal(h.store.records('calls').length, 0, 'reservation transaction rolls back');
});

test('accounting failure preserves response across reopen and explicit recovery replays without another request', async t => {
  const h = harness(t);
  const put = h.store.put.bind(h.store);
  h.store.put = (namespace, key, data) => { if (namespace === 'calls' && data.phase === 'accounted') throw new Error('synthetic accounting failure'); return put(namespace, key, data); };
  let callId;
  await assert.rejects(h.generate(), error => { callId = error.callId; return error.code === 'CALL_ACCOUNTING_FAILED'; });
  assert.equal(h.ledger.listPending()[0].phase, 'received');
  assert.match(h.ledger.getResult(callId).response.body, /Saved synthetic answer/);
  await assert.rejects(h.ai.generate({ prompt: 'Different task', privacy: 'cloud' }), { code: 'CALL_RECOVERY_REQUIRED' });
  h.reopen();
  await assert.rejects(h.generate(), { code: 'CALL_RECOVERY_REQUIRED' });
  h.ledger.recover(callId);
  h.ledger.recover(callId);
  h.settings.ai.inputPrice = 500;
  const result = await h.generate();
  assert.equal(result.text, 'Saved synthetic answer');
  assert.equal(result.recovered, true);
  assert.equal(result.usage.cost, .00014, 'replay retains historical accounting prices');
  assert.equal(h.attempts, 1);
  assert.equal(h.store.records('calls').length, 1);
  assert.equal(h.ledger.listPending().length, 0);
  await assert.rejects(h.ai.withCallContext(context, () => h.ai.generate({ prompt: 'Synthetic content', privacy: 'local' })), { code: 'PRIVACY_LOCAL' });
});

test('abort after dispatch retains unknown cost and blocks new calls even with budget disabled', async t => {
  const controller = new AbortController();
  const h = harness(t, async (_url, options) => {
    if (controller.signal.aborted) return response();
    assert.equal(h.store.records('callLedger')[0].phase, 'dispatch');
    const waiting = new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    controller.abort();
    return waiting;
  });
  await assert.rejects(h.ai.withCallContext(context, () => h.ai.generate({ prompt: 'Synthetic content', privacy: 'cloud', signal: controller.signal })), { code: 'CANCELLED' });
  const id = h.ledger.listPending()[0].id;
  assert.equal(h.store.get('calls', id).cost, null);
  h.reopen();
  await assert.rejects(h.generate(), { code: 'CALL_RECOVERY_REQUIRED' });
  assert.throws(() => h.ledger.recover(id), { code: 'CALL_RESULT_UNKNOWN' });
  assert.throws(() => h.ledger.confirm(id, { cost: 0 }), { code: 'INVALID_INPUT' });
  h.ledger.confirm(id, { cost: null, reason: '供应商暂未提供账单，明确保留未知' });
  assert.equal(h.store.get('calls', id).cost, null);
  assert.equal(h.ledger.listPending()[0].phase, 'resolved_unknown');
  await assert.rejects(h.ai.generate({ prompt: 'Next operation without a budget', privacy: 'cloud' }), { code: 'CALL_RECOVERY_REQUIRED' });
  await assert.rejects(h.generate(), { code: 'CALL_RECOVERY_REQUIRED' }, 'confirmed unknown outcome never resends original operation');
  await assert.rejects(h.ai.withCallContext(context, () => h.ai.generate({ prompt: 'Changed text in the same uncertain operation', privacy: 'cloud' })), { code: 'CALL_RECOVERY_REQUIRED' });
  h.settings.ai.monthlyBudget = 1;
  await assert.rejects(h.ai.generate({ prompt: 'Next operation', privacy: 'cloud' }), { code: 'CALL_RECOVERY_REQUIRED' });
  h.ledger.confirm(id, { cost: .1, reason: '人工核对合成账单' });
  await h.ai.generate({ prompt: 'Next operation', privacy: 'cloud' });
  assert.equal(h.attempts, 2);
});

test('single grading operation recovers its received answer after prompt and provider changes without a new charge', async t => {
  const h = harness(t), single = { ...context, singleRequest: true };
  const generate = prompt => h.ai.withCallContext(single, () => h.ai.generate({ prompt, privacy: 'cloud' }));
  const put = h.store.put.bind(h.store);
  h.store.put = (namespace, key, data) => { if (namespace === 'calls' && data.phase === 'accounted') throw new Error('synthetic accounting failure'); return put(namespace, key, data); };
  let callId;
  await assert.rejects(generate('Original grade prompt'), error => { callId = error.callId; return error.code === 'CALL_ACCOUNTING_FAILED'; });
  h.reopen();
  h.settings.ai.model = 'changed-model'; h.settings.ai.baseUrl = 'https://1.1.1.1/v2'; h.settings.ai.inputPrice = 200;
  await assert.rejects(generate('Changed grade prompt'), { code: 'CALL_RECOVERY_REQUIRED' });
  h.ledger.recover(callId);
  const result = await generate('Changed grade prompt');
  assert.equal(result.text, 'Saved synthetic answer'); assert.equal(result.callId, callId); assert.equal(result.recovered, true);
  assert.equal(result.usage.cost, .00014); assert.equal(h.attempts, 1); assert.equal(h.store.records('calls').length, 1);
  await assert.rejects(h.ai.withCallContext(single, () => h.ai.generate({ prompt: 'Changed grade prompt', privacy: 'local' })), { code: 'PRIVACY_LOCAL' });
  h.settings.ai.enabled = false;
  await assert.rejects(generate('Changed grade prompt'), { code: 'CAPABILITY_DISABLED' });
});

test('single operation reserves once when different prompt fingerprints race', async t => {
  let release, dispatched;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { dispatched = resolve; });
  const h = harness(t, async () => { dispatched(); await gate; return response(); });
  const generate = prompt => h.ai.withCallContext({ ...context, singleRequest: true }, () => h.ai.generate({ prompt, privacy: 'cloud' }));
  const outcomes = Promise.allSettled([generate('First prompt'), generate('Other prompt')]);
  await started; release();
  const results = await outcomes;
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'CALL_RECOVERY_REQUIRED');
  assert.equal(h.attempts, 1); assert.equal(h.store.records('calls').length, 1);
});

test('multi-request contexts retain separate request identities and replay both results', async t => {
  const h = harness(t, async (_url, options) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.parse(options.body).messages[0].content } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })));
  const run = () => h.ai.withCallContext(context, async () => [await h.ai.generate({ prompt: 'First request', privacy: 'cloud' }), await h.ai.generate({ prompt: 'Second request', privacy: 'cloud' })]);
  const first = await run();
  assert.deepEqual(first.map(result => result.text), ['First request', 'Second request']);
  h.reopen();
  const replayed = await run();
  assert.deepEqual(replayed.map(result => result.text), ['First request', 'Second request']);
  assert.ok(replayed.every(result => result.recovered)); assert.equal(h.attempts, 2); assert.equal(h.store.records('calls').length, 2);
});

test('divergent accounted backup cannot replay over a local unknown call with the same logical key in either order', async t => {
  for (const localNewest of [false, true]) {
    const local = harness(t, async () => { throw new Error('synthetic lost response'); });
    const forked = harness(t);
    await assert.rejects(local.generate(), { code: 'NETWORK_ERROR' });
    await forked.generate();
    const [unknown] = local.store.records('callLedger'), [accounted] = forked.store.records('callLedger');
    assert.equal(unknown.key, accounted.key);
    assert.notEqual(unknown.id, accounted.id);
    if (localNewest) local.store.remove('callLedger', unknown.id);
    for (const namespace of ['calls', 'callResults', 'callLedger']) local.store.put(namespace, accounted.id, forked.store.get(namespace, accounted.id));
    if (localNewest) local.store.put('callLedger', unknown.id, unknown);
    assert.equal(local.store.records('callLedger')[0].phase, localNewest ? 'unknown' : 'accounted');
    await assert.rejects(local.generate(), { code: 'CALL_RECOVERY_REQUIRED' });
    assert.equal(local.store.get('calls', unknown.id).cost, null);
    assert.equal(local.ledger.listPending()[0].id, unknown.id);
    assert.equal(local.attempts, 1);
    local.ledger.confirm(unknown.id, { cost: .01, reason: '合成账单金额已核对，原响应仍未知。' });
    await assert.rejects(local.generate(), { code: 'CALL_RECOVERY_REQUIRED' }, 'cost confirmation cannot select another machine response');
    assert.equal(local.attempts, 1);
  }
});

test('ambiguous accounted responses sharing a logical key are rejected instead of choosing the newest answer', async t => {
  const h = harness(t);
  await h.generate();
  const [original] = h.store.records('callLedger'), forkId = randomUUID();
  const result = h.store.get('callResults', original.id);
  h.store.put('calls', forkId, { ...h.store.get('calls', original.id), id: forkId });
  h.store.put('callResults', forkId, { ...result, id: forkId, response: { ...result.response, body: result.response.body.replace('Saved synthetic answer', 'Different forked answer') } });
  h.store.put('callLedger', forkId, { ...original, id: forkId });
  assert.equal(h.ledger.listPending().length, 0);
  await assert.rejects(h.generate(), { code: 'CALL_RECOVERY_REQUIRED' });
  assert.equal(h.attempts, 1);
  h.reopen();
  await assert.rejects(h.generate(), { code: 'CALL_RECOVERY_REQUIRED' });
  assert.equal(h.attempts, 1);
});

test('matching unfinished calls block replay while unrelated completed results remain available locally', async t => {
  for (const phase of ['reserved', 'dispatch', 'received', 'unknown', 'resolved_unknown']) {
    const h = harness(t);
    await h.generate();
    const [original] = h.store.records('callLedger'), conflictingId = randomUUID();
    h.store.put('callLedger', conflictingId, { ...original, id: conflictingId, phase,
      ...(phase === 'resolved_unknown' ? { confirmation: { cost: null, reason: '合成未知费用', at: original.createdAt } } : {}),
    });
    h.store.remove('callLedger', original.id);
    h.store.put('callLedger', original.id, original);
    assert.equal(h.store.records('callLedger')[0].phase, 'accounted', 'newest accounted row cannot hide an unfinished sibling');
    assert.throws(() => h.ledger.replay(original.key), { code: 'CALL_RECOVERY_REQUIRED' }, phase);
    assert.throws(() => h.ledger.replay('changed-key', { contextKey: original.contextKey, singleRequest: true }), { code: 'CALL_RECOVERY_REQUIRED' }, phase);
    const unrelatedId = randomUUID();
    h.store.put('callLedger', unrelatedId, { ...original, id: unrelatedId, key: 'unrelated-key', contextKey: 'unrelated-context' });
    h.store.put('callResults', unrelatedId, { ...h.store.get('callResults', original.id), id: unrelatedId });
    assert.equal(h.ledger.replay('unrelated-key').callId, unrelatedId, 'known unrelated local response requires no new external call');
    await assert.rejects(h.ai.generate({ prompt: 'A new external request', privacy: 'cloud' }), { code: 'CALL_RECOVERY_REQUIRED' });
    assert.equal(h.attempts, 1);
  }
});

test('timeout and incomplete response are unknown and never automatically repeat search or embedding', async t => {
  const original = AbortSignal.timeout;
  t.mock.method(AbortSignal, 'timeout', () => original(30));
  for (const capability of ['generate', 'search', 'embed']) {
    const h = harness(t, (_url, options) => new Promise((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout fixture failed')), 500);
      options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(options.signal.reason); }, { once: true });
    }));
    const inputs = { generate: { prompt: 'Synthetic' }, search: { query: 'Synthetic' }, embed: { texts: ['Synthetic'] } };
    await assert.rejects(h.ai[capability]({ ...inputs[capability], privacy: 'cloud' }), { code: 'REQUEST_TIMEOUT' });
    assert.equal(h.attempts, 1);
    assert.equal(h.store.records('calls')[0].cost, null);
    assert.equal(h.ledger.listPending()[0].phase, 'unknown');
  }
  const partial = harness(t, async () => new Response(new ReadableStream({ start(stream) { stream.enqueue(new TextEncoder().encode('{"partial":')); stream.error(new Error('synthetic broken stream')); } })));
  await assert.rejects(partial.generate(), { code: 'NETWORK_ERROR' });
  assert.equal(partial.ledger.listPending()[0].phase, 'unknown');
});

test('failed result persistence keeps dispatch blocked instead of declaring a known free result', async t => {
  const h = harness(t);
  const put = h.store.put.bind(h.store);
  h.store.put = (namespace, key, data) => { if (namespace === 'callResults') throw new Error('synthetic response write failure'); return put(namespace, key, data); };
  await assert.rejects(h.generate(), { code: 'CALL_RESULT_SAVE_FAILED' });
  h.reopen();
  assert.equal(h.ledger.listPending()[0].phase, 'dispatch');
  assert.equal(h.store.records('calls')[0].cost, null);
  await assert.rejects(h.generate(), { code: 'CALL_RECOVERY_REQUIRED' });
  assert.equal(h.attempts, 1);
});

test('daily reservation is atomic across instances and known search reservation respects remaining budget', async t => {
  const h = harness(t);
  h.settings.ai.dailyCallLimit = 1;
  const first = h.ledger.reserve({ capability: 'search', reservedCost: .2 }, h.settings);
  const other = createCallLedger({ store: h.store });
  assert.throws(() => other.reserve({ capability: 'search', reservedCost: .2 }, h.settings), { code: 'CALL_RECOVERY_REQUIRED' });
  assert.throws(() => h.ledger.reserve({ capability: 'search', reservedCost: .2 }, h.settings), { code: 'BUDGET_EXCEEDED' });
  h.ledger.cancel(first.id); h.ledger.finish(first.id);
  h.settings.ai.monthlyBudget = .1;
  await assert.rejects(h.ai.search({ query: 'Synthetic', privacy: 'cloud' }), { code: 'BUDGET_EXCEEDED' });
  assert.equal(h.attempts, 0);
});

test('durable response excludes credentials and usage export omits response and operation identity', async t => {
  const h = harness(t, async () => new Response(JSON.stringify({ error: { message: 'synthetic-test-only Authorization: Bearer synthetic-other' } }), { status: 401 }));
  await assert.rejects(h.generate(), { code: 'PROVIDER_ERROR' });
  const records = JSON.stringify(h.store.records('callResults'));
  assert.doesNotMatch(records, /synthetic-test-only|synthetic-other/);
  const report = buildUsageReport(h.store.records('calls'));
  assert.doesNotMatch(JSON.stringify(report), /synthetic-job|synthetic-turn|REDACTED|response/);
  assert.equal(report.totals.failedCalls, 1);
  assert.equal(h.store.records('calls')[0].cost, null);
  assert.equal(h.attempts, 1);
});

for (const mode of ['reserved', 'dispatch', 'received', 'accounting', 'accounted']) test(`forced child termination at ${mode} preserves restart state and prevents duplicate transport`, async t => {
  const h = harness(t);
  h.store.db.close();
  // This endpoint is synthetic and only reached through the existing injected
  // fetch fixture. Production target validation stays on public-address checks.
  let requests = 0, endpointReady;
  const observed = new Promise(resolve => { endpointReady = resolve; });
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    requests++;
    endpointReady();
    req.resume();
    if (mode !== 'dispatch') res.end(JSON.stringify({ choices: [{ message: { content: 'Saved synthetic answer' } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const child = fork(new URL('./fixtures/call-recovery-child.mjs', import.meta.url), [h.directory, mode, `http://127.0.0.1:${server.address().port}`], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = '';
  child.stderr.on('data', bytes => { stderr += bytes; });
  t.after(() => { child.kill('SIGKILL'); for (const socket of sockets) socket.destroy(); server.close(); });
  const event = mode === 'dispatch' ? observed : mode === 'accounting' ? once(child, 'exit') : once(child, 'message');
  let timer;
  try { await Promise.race([event, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`Child did not reach ${mode}: ${stderr}`)), 10000); })]); }
  finally { clearTimeout(timer); }
  if (mode !== 'accounting') { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
  h.reopen();
  const restarted = h.store, ledger = h.ledger;
  const row = restarted.records('callLedger')[0];
  assert.equal(row.phase, mode === 'accounting' ? 'received' : mode);
  assert.equal(requests, mode === 'reserved' ? 0 : 1);
  assert.equal(restarted.records('calls').length, 1);
  if (mode === 'reserved') { ledger.recover(row.id); assert.equal(restarted.records('calls').length, 0); }
  else if (mode === 'received' || mode === 'accounting') { assert.match(ledger.getResult(row.id).response.body, /Saved synthetic answer/); ledger.recover(row.id); }
  else if (mode === 'dispatch') assert.throws(() => ledger.reserve({ capability: 'model' }, config()), { code: 'CALL_RECOVERY_REQUIRED' });
  if (mode === 'received' || mode === 'accounting' || mode === 'accounted') {
    let newRequests = 0;
    const ai = createAI({ getSettings: config, getSecret: () => 'synthetic-test-only', getUsage: () => ({}), recordCall: () => {}, callLedger: ledger, fetchImpl: () => { newRequests++; throw new Error('Unexpected resend'); } });
    const result = await ai.withCallContext({ key: 'child-task', jobId: 'synthetic-job' }, () => ai.generate({ prompt: 'Synthetic content', privacy: 'cloud' }));
    assert.equal(result.text, 'Saved synthetic answer'); assert.equal(newRequests, 0); assert.equal(restarted.records('calls').length, 1);
  }
});
