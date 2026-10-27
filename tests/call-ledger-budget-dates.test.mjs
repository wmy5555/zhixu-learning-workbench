import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { createCallLedger } from '../src/call-ledger.mjs';

const now = '2026-10-27T00:00:00.000Z';
const settings = { timezone: 'Asia/Shanghai', ai: { dailyCallLimit: 10, monthlyBudget: 1 } };
const input = { capability: 'search', reservedCost: .2 };
const invalidDate = { code: 'BUDGET_UNKNOWN', status: 409, message: '调用记录日期无效，无法核对预算。' };

function fixture(t, calls = [], at = new Date(now)) {
  fs.mkdirSync('.tmp', { recursive: true });
  const directory = fs.mkdtempSync(path.resolve('.tmp/call-ledger-budget-dates-'));
  const store = new Store({ dataDir: path.join(directory, 'data'), vaultDir: path.join(directory, 'vault') });
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  calls.forEach((call, index) => store.put('calls', `history-${index}`, { id: `history-${index}`, capability: 'search', ...call }));
  return { store, ledger: createCallLedger({ store, at: () => at }) };
}

test('reserve parses and formats each historical budget date once in its transaction', t => {
  const h = fixture(t, [
    { createdAt: '2026-09-30T00:00:00.000Z', cost: null },
    { createdAt: '2026-10-01T00:00:00.000Z', cost: .1 },
    { createdAt: '2026-10-26T15:59:59.000Z', cost: .2 },
    { createdAt: '2026-10-26T16:00:00.000Z', cost: .3 },
  ]);
  const NativeDate = Date, NativeFormatter = Intl.DateTimeFormat;
  const parsed = [], formatted = [], reads = [];
  t.mock.method(globalThis, 'Date', class extends NativeDate {
    constructor(...args) { super(...args); parsed.push(args[0]); }
  });
  t.mock.method(Intl, 'DateTimeFormat', function (...args) {
    const formatter = new NativeFormatter(...args);
    return { format(date) { formatted.push(date.toISOString()); return formatter.format(date); } };
  });
  const records = h.store.records.bind(h.store);
  h.store.records = namespace => { assert.equal(h.store.db.isTransaction, true); reads.push(namespace); return records(namespace); };
  const row = h.ledger.reserve(input, settings);
  t.diagnostic(`4 historical records: ${parsed.length} date parses, ${formatted.length} date formats (including today)`);
  const expected = [now, '2026-10-26T16:00:00.000Z', '2026-10-26T15:59:59.000Z', '2026-10-01T00:00:00.000Z', '2026-09-30T00:00:00.000Z'];
  assert.deepEqual(parsed, expected);
  assert.deepEqual(formatted, expected);
  assert.deepEqual(reads, ['callLedger', 'calls']);
  assert.equal(h.store.get('calls', row.id).cost, .2);
  h.ledger.cancel(row.id); h.ledger.finish(row.id);
  parsed.length = 0; formatted.length = 0; reads.length = 0;
  h.ledger.reserve(input, settings);
  assert.deepEqual(parsed, expected, 'dates are parsed again in the next transaction');
  assert.deepEqual(formatted, expected);
  assert.deepEqual(reads, ['callLedger', 'calls']);
});

test('reserve budget dates preserve validation priority, timezone grouping and floating-point order', async t => {
  const cases = [
    { name: 'first invalid date stops before a later throwing conversion', calls: [
      { createdAt: { toString: 'not callable' }, cost: 0 }, { createdAt: 'invalid', cost: 0 },
    ], error: invalidDate },
    { name: 'invalid history precedes an already exceeded daily limit and unknown fees', calls: [
      { createdAt: 'invalid', cost: 0 }, { createdAt: now, cost: null },
    ], ai: { dailyCallLimit: 0 }, error: invalidDate },
    { name: 'throwing date conversion precedes budget checks', calls: [{ createdAt: { toString: 'not callable' }, cost: null }],
      ai: { dailyCallLimit: 0 }, error: { name: 'TypeError' } },
    { name: 'invalid timezone precedes invalid clock and history', timezone: 'Invalid/Zone', at: new Date(NaN),
      calls: [{ createdAt: 'invalid', cost: null }], error: { name: 'RangeError' } },
    { name: 'invalid clock precedes invalid history', at: new Date(NaN), calls: [{ createdAt: 'invalid', cost: null }], error: { name: 'RangeError' } },
    { name: 'local month excludes older unknown fees and admits exact remaining budget', at: new Date('2026-11-01T00:30:00.000Z'),
      calls: [{ createdAt: '2026-10-31T15:59:59.000Z', cost: null }, { createdAt: '2026-10-31T16:00:00.000Z', cost: .75 }],
      reservedCost: .25 },
    { name: 'local day boundary counts the current request day', at: new Date('2026-11-01T00:30:00.000Z'),
      calls: [{ createdAt: '2026-10-31T16:00:00.000Z', cost: .75 }], ai: { dailyCallLimit: 1 },
      error: { code: 'BUDGET_EXCEEDED', message: '今日外部调用次数已达到上限。' } },
    { name: 'local month includes fees before the UTC month boundary', at: new Date('2026-11-01T00:30:00.000Z'),
      calls: [{ createdAt: '2026-10-31T16:00:00.000Z', cost: .75 }], ai: { monthlyBudget: .8 }, reservedCost: .1,
      error: { code: 'BUDGET_EXCEEDED', message: '本月外部服务预算已用尽或剩余额度不足。' } },
    { name: 'daily limit precedes unknown fees in the same month', calls: [{ createdAt: now, cost: null }], ai: { dailyCallLimit: 1 },
      error: { code: 'BUDGET_EXCEEDED', message: '今日外部调用次数已达到上限。' } },
    { name: 'unknown fees in the current month fail closed', calls: [{ createdAt: now, cost: null }],
      error: { code: 'BUDGET_UNKNOWN', message: '本月仍有未知费用，无法在预算保护下继续调用。' } },
    { name: 'original newest-first decimal accumulation is retained', calls: [
      { createdAt: now, cost: .1 }, { createdAt: now, cost: .2 }, { createdAt: now, cost: .3 },
    ], ai: { monthlyBudget: .6000000000000001 }, reservedCost: 0 },
    { name: 'decimal costs are not rounded before the budget comparison', calls: [{ createdAt: now, cost: .1 }, { createdAt: now, cost: .2 }],
      ai: { monthlyBudget: .3 }, reservedCost: 0, error: { code: 'BUDGET_EXCEEDED' } },
    { name: 'empty history still enforces a zero daily limit', ai: { dailyCallLimit: 0 }, error: { code: 'BUDGET_EXCEEDED' } },
  ];
  for (const item of cases) await t.test(item.name, t => {
    const h = fixture(t, item.calls, item.at), before = h.store.records('calls');
    const config = { timezone: item.timezone ?? settings.timezone, ai: { ...settings.ai, ...item.ai } };
    const reserve = () => h.ledger.reserve({ ...input, reservedCost: item.reservedCost ?? .2 }, config);
    if (item.error) {
      assert.throws(reserve, item.error);
      assert.deepEqual(h.store.records('calls'), before);
      assert.deepEqual(h.store.records('callLedger'), []);
    } else {
      const row = reserve();
      assert.equal(row.phase, 'reserved');
      assert.equal(h.store.get('calls', row.id).cost, item.reservedCost);
      assert.deepEqual(h.store.records('calls').filter(call => call.id !== row.id), before);
    }
    assert.equal(h.store.db.isTransaction, false);
  });
});
