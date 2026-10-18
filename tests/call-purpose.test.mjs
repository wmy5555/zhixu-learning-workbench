import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { createAI } from '../src/ai.mjs';
import { createCallLedger } from '../src/call-ledger.mjs';
import { callPurpose } from '../src/call-purpose.mjs';
import { buildUsageReport } from '../src/usage.mjs';
import { createService } from '../src/service.mjs';

const settings = { timezone: 'Asia/Shanghai', ai: { enabled: true, baseUrl: 'https://8.8.8.8/v1', model: 'synthetic', dailyCallLimit: 100, monthlyBudget: 0 } };
const reply = () => new Response(JSON.stringify({ choices: [{ message: { content: 'synthetic answer' } }], usage: { prompt_tokens: 2, completion_tokens: 1 } }));
function temporary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhixu-purpose-'));
  return { root, dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault') };
}

test('purpose survives reservation, accounting and received-result recovery without changing replay identity', async t => {
  const dirs = temporary(), store = new Store(dirs);
  t.after(() => { store.close(); fs.rmSync(dirs.root, { recursive: true, force: true }); });
  const ledger = createCallLedger({ store });
  let attempts = 0;
  const ai = createAI({ getSettings: () => settings, getSecret: () => 'synthetic-secret', getUsage: () => ({}), recordCall() {}, callLedger: ledger,
    fetchImpl: async () => { attempts++; return reply(); } });
  const run = purpose => ai.withCallContext({ key: 'synthetic-stable-key', jobId: 'synthetic-job', purpose }, () => ai.generate({ prompt: 'synthetic private prompt', privacy: 'cloud' }));
  const account = ledger.accounted;
  ledger.accounted = () => { throw new Error('synthetic interruption'); };
  await assert.rejects(run('structure'), { code: 'CALL_ACCOUNTING_FAILED' });
  const pending = store.records('callLedger')[0];
  assert.equal(pending.purpose, 'structure');
  assert.equal(store.get('calls', pending.id).purpose, 'structure');
  ledger.accounted = account;
  ledger.recover(pending.id);
  assert.equal(store.get('calls', pending.id).purpose, 'structure');
  const recovered = await run('process');
  assert.equal(recovered.text, 'synthetic answer');
  assert.equal(attempts, 1, 'changing metadata must not produce a new paid operation');
  assert.equal(store.records('calls').length, 1);
  assert.equal(store.records('calls')[0].purpose, 'structure');
  assert.doesNotMatch(JSON.stringify(store.records('calls')), /synthetic private prompt|synthetic-secret/);
});

test('connection tests and failed transports record their explicit purpose without a durable ledger', async () => {
  const calls = [];
  let broken = false;
  const ai = createAI({ getSettings: () => settings, getSecret: () => 'synthetic-secret', getUsage: () => ({}), recordCall: call => calls.push(call),
    fetchImpl: async () => { if (broken) throw new Error('synthetic disconnect'); return reply(); } });
  await ai.test('model');
  broken = true;
  await assert.rejects(ai.withCallContext({ key: 'failed', purpose: 'grade' }, () => ai.generate({ prompt: 'synthetic', privacy: 'cloud' })));
  assert.deepEqual(calls.map(call => call.purpose), ['connection_test', 'grade']);
});

test('historical enrichment uses explicit job/request links, leaves unknowns unknown and never rewrites billing', () => {
  const historical = { id: 'old', capability: 'model', model: 'synthetic', cost: .25, createdAt: '2026-10-17T00:00:00Z' };
  const before = JSON.stringify(historical);
  assert.equal(callPurpose(historical, { ledger: { jobId: 'job' }, job: { id: 'job', type: 'structure' } }), 'structure');
  assert.equal(callPurpose(historical, { ledger: { jobId: 'different' }, job: { id: 'job', type: 'process' } }), 'unrecorded');
  assert.equal(callPurpose(historical, { ledger: { contextKey: 'looks-like-a-structure-prompt' } }), 'unrecorded');
  assert.equal(callPurpose(historical, { ledger: { jobId: 'ask:request' }, request: { id: 'request', input: { mode: 'outline' } } }), 'outline');
  assert.equal(callPurpose({ ...historical, purpose: 'private arbitrary text' }), 'unrecorded');
  assert.equal(JSON.stringify(historical), before);
  const calls = [{ ...historical, purpose: 'structure' }, historical, { ...historical, purpose: 'process' }];
  const report = buildUsageReport(calls, { purpose: 'structure', at: new Date('2026-10-17T12:00:00Z') });
  assert.equal(report.totals.calls, 1); assert.equal(report.totals.knownCost, .25);
  assert.equal(report.recentCalls[0].purposeLabel, '单资料逻辑图');
  assert.equal(buildUsageReport(calls, { purpose: 'unrecorded', at: new Date('2026-10-17T12:00:00Z') }).totals.calls, 1);
  assert.throws(() => buildUsageReport(calls, { purpose: 'invented' }), { code: 'INVALID_USAGE_FILTER' });
});

test('all queued business entry points attach purpose to the existing call context', async t => {
  const contexts = [];
  const dirs = temporary(), service = createService({ ...dirs, aiOverride: { withCallContext: context => { contexts.push(context); } } });
  t.after(async () => { await service.close(); fs.rmSync(dirs.root, { recursive: true, force: true }); });
  for (const type of ['process', 'structure', 'relate', 'discover', 'grade', 'title', 'index', 'topics']) {
    service.queue(type, {}, `synthetic:${type}`);
    await service.runJobs();
  }
  assert.deepEqual(contexts.map(context => context.purpose), ['process', 'structure', 'relate', 'discover', 'grade', 'title', 'index', 'topics']);
});

test('service diagnostics and usage share historical purposes without writing stored records', async t => {
  const dirs = temporary(), service = createService(dirs);
  t.after(async () => { await service.close(); fs.rmSync(dirs.root, { recursive: true, force: true }); });
  const call = { id: 'synthetic-old', capability: 'model', model: 'synthetic-model', cost: .25, createdAt: new Date().toISOString(), ok: true };
  service.store.put('calls', call.id, call);
  service.store.put('callLedger', call.id, { id: call.id, jobId: 'synthetic-job', phase: 'accounted' });
  service.store.put('jobs', 'synthetic-job', { id: 'synthetic-job', type: 'structure', state: 'done' });
  service.store.put('calls', 'legacy-without-id', { ...call, id: undefined });
  const before = JSON.stringify([service.store.records('calls'), service.store.records('callLedger')]);
  const report = service.usageReport({ purpose: 'structure' });
  assert.equal(report.totals.calls, 1); assert.equal(report.totals.knownCost, .25);
  assert.equal(report.budget.callsToday, 2, 'purpose filtering cannot change shared budget totals');
  const diagnostics = service.diagnostics();
  assert.deepEqual(diagnostics.calls.map(row => row.purpose), ['unrecorded', 'structure']);
  assert.equal(diagnostics.calls[0].purposeLabel, '历史用途未记录');
  assert.equal(JSON.stringify([service.store.records('calls'), service.store.records('callLedger')]), before);
});
