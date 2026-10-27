import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { createCallLedger } from '../src/call-ledger.mjs';

const now = '2026-10-27T00:00:00.000Z';
const settings = { timezone: 'Asia/Shanghai', ai: { dailyCallLimit: 10, monthlyBudget: 1 } };
const input = { capability: 'search', model: 'synthetic-model', key: 'request', contextKey: 'operation', singleRequest: true, reservedCost: .2 };
const history = { id: 'history', capability: 'search', phase: 'accounted', key: 'request', contextKey: 'operation', createdAt: now, updatedAt: now };

function fixture(t, { rows = [], calls = [], allowUncertainContinuation = false } = {}) {
  fs.mkdirSync('.tmp', { recursive: true });
  const directory = fs.mkdtempSync(path.resolve('.tmp/call-ledger-reserve-'));
  const options = { dataDir: path.join(directory, 'data'), vaultDir: path.join(directory, 'vault') };
  const store = new Store(options), connections = [store];
  t.after(() => { for (const current of connections) current.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  for (const row of rows) store.put('callLedger', row.id, row);
  for (const call of calls) store.put('calls', call.id, call);
  const ledger = createCallLedger({ store, at: () => new Date(now), allowUncertainContinuation });
  const records = store.records.bind(store);
  let reads = 0;
  store.records = namespace => {
    if (namespace === 'callLedger') { reads++; assert.equal(store.db.isTransaction, true, 'snapshot is read after BEGIN IMMEDIATE'); }
    return records(namespace);
  };
  return { store, ledger, records, options, connections, get reads() { return reads; } };
}

test('reserve reads the complete ledger once per transaction and keeps cancelled operations reusable', t => {
  const h = fixture(t, { rows: [
    { ...history, phase: 'cancelled' },
    ...Array.from({ length: 64 }, (_, index) => ({ ...history, id: `unrelated-${index}`, key: `old-${index}`, contextKey: `old-${index}` })),
  ] });
  const row = h.ledger.reserve(input, settings);
  assert.equal(h.reads, 1, 'context, single-request and key guards share the pending-check snapshot');
  assert.deepEqual(row, { id: row.id, phase: 'reserved', capability: 'search', model: 'synthetic-model', sourceId: undefined,
    key: 'request', contextKey: 'operation', jobId: undefined, turnId: undefined, singleRequest: true, reservedCost: .2, createdAt: now, updatedAt: now });
  assert.deepEqual(h.store.get('calls', row.id), { id: row.id, capability: 'search', model: 'synthetic-model', createdAt: now, phase: 'reserved', ok: null, cost: .2 });
  h.ledger.cancel(row.id); h.ledger.finish(row.id);
  const next = h.ledger.reserve(input, settings);
  assert.notEqual(next.id, row.id);
  assert.equal(h.reads, 2, 'the next transaction obtains a new snapshot');
  assert.equal(h.records('callLedger').length, 67, 'historical records are retained');
  assert.equal(h.store.db.isTransaction, false);
});

test('reserve keeps recovery and budget error precedence without partial writes', async t => {
  const cases = [
    { name: 'pending recovery precedes context, identity and budget errors', rows: [{ ...history, phase: 'unknown' }],
      calls: [{ id: 'invalid', createdAt: 'invalid', cost: null }],
      code: 'CALL_RECOVERY_REQUIRED', message: '有结果未知或记账未完成的调用。请先在用量与费用中处理，系统不会自动重发。' },
    { name: 'acknowledged uncertainty still blocks its original context before identity checks', allowUncertainContinuation: true,
      rows: [{ ...history, phase: 'unknown', continuation: { acknowledged: true } }],
      code: 'CALL_RECOVERY_REQUIRED', message: '原操作没有可恢复的响应。确认继续其他请求不会授权该操作重新发送。' },
    { name: 'single-request context precedes matching key and budget errors', rows: [history], dailyCallLimit: 0,
      code: 'CALL_RECOVERY_REQUIRED', message: '此轮操作已有调用，请恢复已有结果；修改输入或模型配置不会重新发送。' },
    { name: 'old matching key blocks an otherwise distinct context', rows: [{ ...history, contextKey: 'other' },
      ...Array.from({ length: 64 }, (_, index) => ({ ...history, id: `newer-${index}`, key: `other-${index}`, contextKey: `other-${index}` })),
    ],
      code: 'CALL_RECOVERY_REQUIRED', message: '同一操作已有调用记录，请恢复已有结果，不能重新发送。' },
    { name: 'invalid historical date precedes daily and monthly limits', calls: [{ id: 'invalid', createdAt: 'invalid', cost: null }], dailyCallLimit: 0,
      code: 'BUDGET_UNKNOWN', message: '调用记录日期无效，无法核对预算。' },
    { name: 'daily limit precedes unknown monthly cost', calls: [{ id: 'unknown', createdAt: now, cost: null }], dailyCallLimit: 1,
      code: 'BUDGET_EXCEEDED', message: '今日外部调用次数已达到上限。' },
    { name: 'unknown monthly cost fails closed', calls: [{ id: 'unknown', createdAt: now, cost: null }],
      code: 'BUDGET_UNKNOWN', message: '本月仍有未知费用，无法在预算保护下继续调用。' },
    { name: 'known reservation cannot exceed remaining monthly budget', calls: [{ id: 'known', createdAt: now, cost: .9 }],
      code: 'BUDGET_EXCEEDED', message: '本月外部服务预算已用尽或剩余额度不足。' },
  ];
  for (const item of cases) await t.test(item.name, t => {
    const h = fixture(t, item), before = { rows: h.records('callLedger'), calls: h.records('calls') };
    assert.throws(() => h.ledger.reserve(input, { ...settings, ai: { ...settings.ai, dailyCallLimit: item.dailyCallLimit ?? 10 } }),
      { code: item.code, status: 409, message: item.message });
    assert.equal(h.reads, 1);
    assert.equal(h.store.db.isTransaction, false, 'failed reservation rolls back');
    assert.deepEqual({ rows: h.records('callLedger'), calls: h.records('calls') }, before);
  });
});

test('reserve holds the SQLite write lock while reading and later connections see committed reservations', t => {
  const h = fixture(t), other = new Store(h.options);
  h.connections.push(other);
  other.db.exec('PRAGMA busy_timeout=0');
  const otherLedger = createCallLedger({ store: other, at: () => new Date(now) });
  const records = h.store.records.bind(h.store);
  h.store.records = namespace => {
    if (namespace === 'callLedger') assert.throws(() => otherLedger.reserve(input, settings), /database is locked/);
    return records(namespace);
  };
  const row = h.ledger.reserve(input, settings);
  h.store.records = records;
  assert.equal(h.reads, 1);
  assert.throws(() => otherLedger.reserve({ ...input, key: 'next', contextKey: 'next' }, settings), { code: 'CALL_RECOVERY_REQUIRED' });
  h.ledger.dispatch(row.id);
  h.ledger.received(row.id, { status: 200, body: 'synthetic saved response' }, { cost: .2, ok: true });
  h.ledger.accounted(row.id); h.ledger.finish(row.id);
  assert.throws(() => otherLedger.reserve(input, settings), { code: 'CALL_RECOVERY_REQUIRED' });
  assert.equal(otherLedger.replay(input.key, input).response.body, 'synthetic saved response');
  assert.throws(() => otherLedger.reserve({ ...input, key: 'next', contextKey: 'next' }, { ...settings, ai: { dailyCallLimit: 1, monthlyBudget: 0 } }),
    { code: 'BUDGET_EXCEEDED' });
  assert.equal(other.records('calls').length, 1);
  assert.equal(other.db.isTransaction, false);
});
