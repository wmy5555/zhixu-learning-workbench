import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createPriceCatalog, parsePriceCatalog, downloadPriceCatalog, CATALOG_URL, CATALOG_MAX_BYTES } from '../src/price-catalog.mjs';
import { resolvePricing, snapshotCost, summarizeCosts, validPricingSnapshot } from '../src/pricing.mjs';
import { buildUsageReport } from '../src/usage.mjs';
import { createAI } from '../src/ai.mjs';
import { createCallLedger } from '../src/call-ledger.mjs';
import { Store } from '../src/store.mjs';
import { createService } from '../src/service.mjs';

const date = new Date('2026-10-16T12:00:00Z');
const fixture = () => ({ example: { id: 'example', api: 'https://8.8.8.8/v1', models: {
  alpha: { id: 'alpha', cost: { input: 2, output: 6, cache_read: .5 } },
  vector: { id: 'vector', type: 'embedding', cost: { input: .2, output: 0 } },
} } });
const raw = value => JSON.stringify(value || fixture());
const catalog = value => parsePriceCatalog(raw(value), date.toISOString());
const config = values => ({ baseUrl: 'https://8.8.8.8/v1', model: 'alpha', ...values });
const usage = { inputTokens: 100, outputTokens: 20, cachedInputTokens: 40, reasoningTokens: 10 };
function directory(t) {
  fs.mkdirSync('.tmp', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('.tmp/pricing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('exact provider/endpoint/model/mode identities; aliases and canonical names never borrow prices', () => {
  const data = fixture();
  data.proxy = { id: 'proxy', api: 'https://9.9.9.9/v1', models: { alpha: { id: 'alpha', canonical_model_id: 'example/alpha', cost: { input: 20, output: 60 } } } };
  const c = catalog(data), standard = resolvePricing(config(), 'model', c, date);
  assert.equal(standard.identity.provider, 'example'); assert.equal(standard.identity.currency, 'USD');
  assert.equal(snapshotCost(usage, standard), .00026);
  assert.equal(resolvePricing(config({ baseUrl: 'https://9.9.9.9/v1' }), 'model', c, date).rates.inputPrice, 20);
  for (const change of [{ providerId: 'proxy' }, { baseUrl: 'https://unknown.example/v1' }, { baseUrl: 'https://8.8.8.8/v1/tenant' }, { model: 'example/alpha' }, { model: 'ALPHA' }, { billingMode: 'batch' }]) assert.equal(snapshotCost(usage, resolvePricing(config(change), 'model', c, date)), null);
  assert.equal(resolvePricing(config({ baseUrl: 'https://8.8.8.8/v1/' }), 'model', c, date).status, 'known');
  assert.equal(JSON.stringify(standard).includes('8.8.8.8'), false);
  assert.ok(validPricingSnapshot(standard));
  data.clone = { ...data.example, id: 'clone' };
  assert.equal(resolvePricing(config(), 'model', catalog(data), date).status, 'unknown');
  assert.equal(resolvePricing(config({ providerId: 'example' }), 'model', catalog(data), date).status, 'known');
});

test('manual prices take precedence, retain legacy currency, and never fill missing manual components from catalog', () => {
  const c = catalog();
  const legacy = resolvePricing(config({ inputPrice: 0, outputPrice: 0 }), 'model', c, date);
  assert.equal(legacy.source, 'legacy_manual'); assert.equal(legacy.identity.currency, null); assert.equal(snapshotCost(usage, legacy), 0);
  const manual = resolvePricing(config({ inputPrice: 8, outputPrice: 9, currency: 'CNY' }), 'model', c, date);
  assert.equal(manual.source, 'manual_override'); assert.equal(manual.identity.currency, 'CNY');
  assert.equal(snapshotCost(usage, manual), .00098);
  assert.equal(resolvePricing(config({ inputPrice: 8 }), 'model', c, date).status, 'partial');
  assert.equal(snapshotCost(usage, resolvePricing(config({ inputPrice: 8 }), 'model', c, date)), null);
  assert.equal(resolvePricing(config({ pricingMode: 'manual' }), 'model', c, date).status, 'partial');
  assert.throws(() => { manual.rates.inputPrice = 100; }, TypeError);
});

test('embedding, cache and reasoning subsets; absent rates/counts and unsupported dimensions stay unknown', () => {
  assert.equal(snapshotCost({ inputTokens: 100, outputTokens: 0, cachedInputTokens: null }, resolvePricing(config({ model: 'vector' }), 'embedding', catalog(), date)), .00002);
  assert.equal(snapshotCost({ ...usage, cachedInputTokens: null }, resolvePricing(config(), 'model', catalog(), date)), null);
  for (const extra of [{ tiers: [] }, { context_over_200k: { input: 4, output: 12 } }, { cache_write: 3 }, { reasoning: 9 }, { service_tier: 'priority' }]) {
    const data = fixture(); Object.assign(data.example.models.alpha.cost, extra);
    const snapshot = resolvePricing(config(), 'model', catalog(data), date);
    assert.equal(snapshot.status, 'partial'); assert.equal(snapshotCost(usage, snapshot), null);
  }
  const sameReasoning = fixture(); sameReasoning.example.models.alpha.cost.reasoning = 6;
  assert.equal(snapshotCost(usage, resolvePricing(config(), 'model', catalog(sameReasoning), date)), .00026);
  assert.equal(resolvePricing(config(), 'embedding', catalog(), date).status, 'partial');
  const noCost = fixture(); delete noCost.example.models.alpha.cost;
  assert.equal(snapshotCost(usage, resolvePricing(config(), 'model', catalog(noCost), date)), null);
});

test('schema rejects malformed identities, nonfinite/negative/string prices, oversized and empty data', () => {
  for (const value of [-1, '2', null, Infinity]) {
    const data = fixture(); data.example.models.alpha.cost.input = value;
    assert.throws(() => catalog(data), { code: 'PRICE_CATALOG_INVALID' });
  }
  for (const value of ['{}', '[]', 'broken', ' '.repeat(CATALOG_MAX_BYTES + 1)]) assert.throws(() => parsePriceCatalog(value, date.toISOString()), { code: 'PRICE_CATALOG_INVALID' });
  const data = fixture(); data.example.models.alpha.id = 'other'; assert.throws(() => catalog(data));
});

test('fixed anonymous download rejects redirects/status/oversize and does not send configuration', async () => {
  let seen;
  assert.equal(await downloadPriceCatalog({ fetchImpl: async (...args) => { seen = args; return new Response(raw()); } }), raw());
  assert.equal(seen[0], CATALOG_URL); assert.equal(seen[1].redirect, 'error'); assert.equal(seen[1].credentials, 'omit');
  assert.deepEqual(seen[1].headers, { accept: 'application/json' }); assert.equal(seen[1].body, undefined);
  for (const response of [new Response('', { status: 302 }), new Response('', { status: 500 }), new Response('x', { headers: { 'content-length': String(CATALOG_MAX_BYTES + 1) } }), new Response(new Uint8Array(CATALOG_MAX_BYTES + 1))]) await assert.rejects(downloadPriceCatalog({ fetchImpl: async () => response }));
});

test('refresh atomically activates valid catalog, deduplicates, backs off and retains last good on failure/restart', async t => {
  const dataDir = directory(t); let clock = date, requests = 0, content = raw();
  const c = createPriceCatalog({ dataDir, at: () => clock, fetchImpl: async () => { requests++; return new Response(content); } });
  t.after(() => c.close());
  await Promise.all([c.refresh(), c.refresh({ force: true })]);
  assert.equal(requests, 1); const revision = c.status().revision;
  await c.refresh(); assert.equal(requests, 1);
  clock = new Date(date.getTime() + 86400001); content = '{invalid';
  await c.refresh(); assert.equal(c.status().revision, revision); assert.equal(c.status().stale, true); assert.equal(c.status().lastError, 'PRICE_CATALOG_INVALID');
  await c.refresh(); assert.equal(requests, 2);
  const reopened = createPriceCatalog({ dataDir, at: () => clock, fetchImpl: async () => { throw new Error('not requested'); } });
  assert.equal(reopened.status().revision, revision); await reopened.close();
  clock = new Date(clock.getTime() + 3600001); const updated = fixture(); updated.example.models.alpha.cost.input = 8; content = raw(updated);
  await c.refresh(); assert.notEqual(c.status().revision, revision); assert.equal(c.status().lastError, null);
  assert.equal(fs.readdirSync(dataDir).filter(name => name.endsWith('.tmp')).length, 0);
});

test('timeout aborts stalled body and returns unknown without activating partial content', async t => {
  const dataDir = directory(t);
  const c = createPriceCatalog({ dataDir, timeoutMs: 15, fetchImpl: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); } })) });
  const keepAlive = setTimeout(() => {}, 1000); t.after(() => { clearTimeout(keepAlive); return c.close(); });
  await c.refresh(); assert.equal(c.status().revision, null); assert.equal(c.status().lastError, 'PRICE_CATALOG_TIMEOUT');
});

test('currency groups never sum USD, CNY or unlabelled legacy prices, including reports and provider groups', () => {
  const rows = [
    { cost: 2, pricingSnapshot: resolvePricing(config(), 'model', catalog(), date) },
    { cost: 3, pricingSnapshot: resolvePricing(config({ inputPrice: 1, outputPrice: 2, currency: 'CNY' }), 'model', null, date) },
    { cost: 7 },
  ].map(row => ({ ...row, capability: 'model', model: 'alpha', createdAt: date.toISOString() }));
  const sums = summarizeCosts(rows); assert.equal(sums.knownCost, null); assert.equal(sums.cost, null); assert.equal(sums.byCurrency.length, 3);
  const report = buildUsageReport(rows, { at: date }); assert.equal(report.models.length, 3); assert.equal(report.totals.mixedCurrency, true); assert.equal(report.daily.at(-1).knownCost, null);
});

test('request snapshot remains fixed through refresh, accounting failure, recovery, reopen and replay', async t => {
  const root = directory(t), dataDir = path.join(root, 'data'), vaultDir = path.join(root, 'vault');
  let store = new Store({ dataDir, vaultDir }), ledger = createCallLedger({ getStore: () => store });
  let current = catalog(), requests = 0;
  const settings = { ai: { ...config(), enabled: true, dailyCallLimit: 20, monthlyBudget: 0 } };
  const makeAI = () => createAI({ getSettings: () => settings, getSecret: () => 'synthetic-test-secret', getUsage: () => ({}), recordCall: () => {}, callLedger: ledger,
    getPricingSnapshot: (value, capability) => resolvePricing(value, capability, current, date),
    fetchImpl: async () => {
      requests++; const data = fixture(); data.example.models.alpha.cost.input = 100; current = catalog(data);
      settings.ai.inputPrice = 500; settings.ai.outputPrice = 500;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'synthetic answer' } }], usage: { prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 40 } }));
    } });
  let ai = makeAI();
  t.after(() => store.close());
  const accounted = ledger.accounted; ledger.accounted = () => { throw new Error('synthetic disk failure'); };
  const generate = () => ai.withCallContext({ key: 'stable' }, () => ai.generate({ prompt: 'synthetic', privacy: 'cloud' }));
  await assert.rejects(generate(), { code: 'CALL_ACCOUNTING_FAILED' });
  const [row] = store.records('callLedger'); assert.equal(row.pricingSnapshot.rates.inputPrice, 2);
  assert.equal(store.get('callResults', row.id).entry.cost, .00026);
  ledger.accounted = accounted; ledger.recover(row.id);
  const costBefore = store.get('calls', row.id); assert.equal(costBefore.pricingSnapshot.rates.inputPrice, 2);
  store.close(); store = new Store({ dataDir, vaultDir }); ledger = createCallLedger({ getStore: () => store }); ai = makeAI();
  const replay = await generate(); assert.equal(replay.usage.cost, .00026); assert.equal(replay.usage.pricingSnapshot.rates.inputPrice, 2); assert.equal(requests, 1);
});

test('budget refuses unknown incoming prices and cross-currency history but retains legacy budget compatibility', t => {
  const root = directory(t), store = new Store({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault') }); t.after(() => store.close());
  const ledger = createCallLedger({ store, at: () => date });
  const settings = { ai: { monthlyBudget: 10, budgetCurrency: 'USD', dailyCallLimit: 20 } };
  const known = resolvePricing(config(), 'model', catalog(), date);
  assert.throws(() => ledger.reserve({ capability: 'model', pricingSnapshot: resolvePricing(config(), 'model', null, date) }, settings), { code: 'BUDGET_CURRENCY_UNKNOWN' });
  store.put('calls', 'cny', { createdAt: date.toISOString(), cost: 1, currency: 'CNY' });
  assert.throws(() => ledger.reserve({ capability: 'model', pricingSnapshot: known }, settings), { code: 'BUDGET_CURRENCY_UNKNOWN' });
  store.remove('calls', 'cny'); store.put('calls', 'legacy', { createdAt: date.toISOString(), cost: 1 });
  assert.throws(() => ledger.reserve({ capability: 'model', pricingSnapshot: known }, settings), { code: 'BUDGET_CURRENCY_UNKNOWN' });
  settings.ai.budgetCurrency = null;
  const row = ledger.reserve({ capability: 'model', pricingSnapshot: resolvePricing(config({ inputPrice: 1, outputPrice: 1 }), 'model', null, date) }, settings);
  ledger.cancel(row.id); ledger.finish(row.id);
});

test('service refresh uses only mock public source and does not overwrite manual prices or create provider calls', async t => {
  const root = directory(t); let requests = 0;
  const service = createService({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'), priceCatalogFetch: async () => { requests++; return new Response(raw()); } });
  t.after(() => service.close());
  service.updateSettings({ ai: { ...config(), inputPrice: 3, outputPrice: 4, currency: 'CNY' } });
  await service.refreshPricing(); assert.equal(requests, 1); assert.equal(service.settings().ai.inputPrice, 3); assert.equal(service.pricingStatus().current.ai.source, 'manual_override');
  assert.equal(service.store.records('calls').length, 0); assert.equal(service.store.records('callLedger').length, 0);
  service.updateSettings({ ai: { inputPrice: null, outputPrice: null, cachedInputPrice: null } });
  assert.equal(service.pricingStatus().current.ai.source, 'models.dev');
  service.updateSettings({ pricingCatalog: { enabled: false } }); await service.refreshPricing({ force: true }); assert.equal(requests, 1);
  assert.equal(service.backup().preferences.pricingCatalog.enabled, false);
});

test('price refresh HTTP requires session/CSRF and practice cannot trigger a catalog request', async t => {
  const { createApp } = await import('../src/server.mjs');
  const { once } = await import('node:events');
  const root = directory(t); let requests = 0;
  const dataDir = path.join(root, 'data');
  const service = createService({ dataDir, vaultDir: path.join(root, 'vault'), priceCatalogFetch: async () => { requests++; return new Response(raw()); } });
  const app = createApp({ dataDir, service, scheduler: false });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening'); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = (route, headers = {}) => fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' });
  assert.equal((await post('/api/usage/pricing-refresh')).status, 401);
  const session = await fetch(base + '/api/session'), cookie = session.headers.get('set-cookie').split(';')[0], csrf = (await session.json()).csrf;
  assert.equal((await post('/api/usage/pricing-refresh', { Cookie: cookie })).status, 403); assert.equal(requests, 0);
  const headers = { Cookie: cookie, 'X-CSRF-Token': csrf };
  const practice = await post('/api/onboarding/start', headers), id = (await practice.json()).practiceId;
  assert.equal((await post(`/api/practice/${id}/usage/pricing-refresh`, headers)).status, 409); assert.equal(requests, 0);
  const result = await post('/api/usage/pricing-refresh', headers); assert.equal(result.status, 200); assert.equal((await result.json()).entries, 2); assert.equal(requests, 1);
  const shared = await fetch(base + `/api/practice/${id}/usage`, { headers }); assert.equal((await shared.json()).pricing.entries, 2);
});

test('invalid nested prices and failed activation retain last good catalog', async t => {
  const dataDir = directory(t); let clock = date, data = fixture();
  const c = createPriceCatalog({ dataDir, at: () => clock, fetchImpl: async () => new Response(raw(data)) }); t.after(() => c.close());
  await c.refresh(); const revision = c.status().revision;
  data.example.models.alpha.cost.tiers = [{ tier: { type: 'context', size: 200000 }, input: -2, output: 8 }];
  clock = new Date(date.getTime() + 86400001); await c.refresh(); assert.equal(c.status().revision, revision);
  data = fixture(); data.example.models.alpha.cost.input = 5;
  clock = new Date(clock.getTime() + 3600001);
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => { if (to === path.join(dataDir, 'public-price-catalog.json')) throw new Error('synthetic rename failure'); return rename(from, to); };
  try { await c.refresh(); } finally { fs.renameSync = rename; }
  assert.equal(c.status().revision, revision); assert.equal(c.status().lastError, 'PRICE_CATALOG_UNAVAILABLE');
  const reopened = createPriceCatalog({ dataDir, at: () => clock }); assert.equal(reopened.status().revision, revision); await reopened.close();
});

test('report keeps spend currency separate from configured budget and never reinterprets legacy amounts', async t => {
  const root = directory(t);
  const service = createService({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault') }); t.after(() => service.close());
  service.updateSettings({ ai: { monthlyBudget: 100, budgetCurrency: 'CNY' } });
  service.store.put('calls', 'usd', { id: 'usd', capability: 'model', model: 'alpha', createdAt: new Date().toISOString(), cost: 5, currency: 'USD' });
  const usd = service.usageReport(); assert.equal(usd.budget.currency, 'USD'); assert.equal(usd.budget.budgetCurrency, 'CNY'); assert.equal(usd.budget.comparable, false); assert.equal(usd.budget.costMonth, 5);
  service.store.remove('calls', 'usd');
  service.store.put('calls', 'old', { id: 'old', capability: 'model', model: 'alpha', createdAt: new Date().toISOString(), cost: 5 });
  service.updateSettings({ ai: { budgetCurrency: 'USD' } });
  const legacy = service.usageReport(); assert.equal(legacy.budget.currency, null); assert.equal(legacy.budget.budgetCurrency, 'USD'); assert.equal(legacy.budget.comparable, false);
});

test('24-hour last-good estimates remain visible but cannot authorize a positive budget', t => {
  const root = directory(t), store = new Store({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault') }); t.after(() => store.close());
  const stale = resolvePricing(config(), 'model', catalog(), new Date(date.getTime() + 86400001));
  assert.equal(stale.stale, true); assert.equal(snapshotCost(usage, stale), .00026, 'Unbudgeted estimates retain the stale marker and amount');
  const ledger = createCallLedger({ store, at: () => date }), settings = { ai: { monthlyBudget: 10, budgetCurrency: 'USD', dailyCallLimit: 20 } };
  assert.throws(() => ledger.reserve({ capability: 'model', pricingSnapshot: stale }, settings), { code: 'BUDGET_PRICE_STALE' });
  const manual = resolvePricing(config({ currency: 'USD', inputPrice: 2, outputPrice: 6 }), 'model', null, date);
  const manualRow = ledger.reserve({ capability: 'model', pricingSnapshot: manual }, settings); ledger.cancel(manualRow.id); ledger.finish(manualRow.id);
  store.put('calls', 'stale', { id: 'stale', createdAt: date.toISOString(), cost: .1, pricingSnapshot: stale });
  assert.throws(() => ledger.reserve({ capability: 'model', pricingSnapshot: manual }, settings), { code: 'BUDGET_PRICE_STALE' });
  settings.ai.monthlyBudget = 0;
  const unbudgeted = ledger.reserve({ capability: 'model', pricingSnapshot: stale }, settings); ledger.cancel(unbudgeted.id); ledger.finish(unbudgeted.id);
});

test('confirmed unknown stale call is usable by budget with new manual pricing and preserves snapshot', t => {
  const root = directory(t), store = new Store({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault') }); t.after(() => store.close());
  const ledger = createCallLedger({ store, at: () => date }), settings = { ai: { monthlyBudget: 0, budgetCurrency: 'USD', dailyCallLimit: 20 } };
  const stale = resolvePricing(config(), 'model', catalog(), new Date(date.getTime() + 86400001));
  const row = ledger.reserve({ capability: 'model', model: 'alpha', pricingSnapshot: stale }, settings);
  ledger.dispatch(row.id); ledger.unknown(row.id, { error: 'synthetic connection interruption' }); ledger.finish(row.id);
  ledger.confirm(row.id, { cost: .1, reason: 'Checked synthetic supplier bill in USD' });
  assert.equal(ledger.listPending().length, 0); assert.equal(store.get('calls', row.id).pricingConfirmation.cost, .1);
  assert.equal(store.get('calls', row.id).pricingSnapshot.stale, true);
  settings.ai.monthlyBudget = 10;
  const next = ledger.reserve({ capability: 'model', model: 'alpha', pricingSnapshot: resolvePricing(config({ currency: 'USD', inputPrice: 2, outputPrice: 6 }), 'model', null, date) }, settings);
  ledger.cancel(next.id); ledger.finish(next.id);
});

test('accounted stale estimate has explicit bill confirmation path; original snapshot, response and estimate survive backup', t => {
  const root = directory(t), store = new Store({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault') }); t.after(() => store.close());
  const ledger = createCallLedger({ store, at: () => date }), settings = { ai: { monthlyBudget: 0, budgetCurrency: 'USD', dailyCallLimit: 20 } };
  const stale = resolvePricing(config(), 'model', catalog(), new Date(date.getTime() + 86400001));
  const row = ledger.reserve({ capability: 'model', model: 'alpha', pricingSnapshot: stale }, settings);
  ledger.dispatch(row.id);
  ledger.received(row.id, { status: 200, body: '{}', headers: {} }, { capability: 'model', model: 'alpha', ...usage, cost: .00026, durationMs: 1, ok: true, pricingSnapshot: stale });
  ledger.accounted(row.id); ledger.finish(row.id);
  assert.equal(ledger.listPending()[0].pricingReview, true);
  const before = store.get('callResults', row.id);
  ledger.confirmPrice(row.id, { cost: .3, currency: 'USD', reason: 'Checked synthetic supplier invoice' });
  assert.equal(ledger.listPending().length, 0);
  assert.equal(store.get('calls', row.id).cost, .00026); assert.deepEqual(store.get('callResults', row.id), before);
  assert.deepEqual(store.get('calls', row.id).pricingSnapshot, before.entry.pricingSnapshot);
  settings.ai.monthlyBudget = .2;
  const manual = resolvePricing(config({ currency: 'USD', inputPrice: 2, outputPrice: 6 }), 'model', null, date);
  assert.throws(() => ledger.reserve({ capability: 'model', model: 'alpha', pricingSnapshot: manual }, settings), { code: 'BUDGET_EXCEEDED' });
  settings.ai.monthlyBudget = 1;
  const next = ledger.reserve({ capability: 'model', model: 'alpha', pricingSnapshot: manual }, settings); ledger.cancel(next.id); ledger.finish(next.id);
  const backup = store.backup();
  const confirmed = JSON.parse(backup.records.find(record => record.namespace === 'calls' && record.key === row.id).json);
  assert.equal(confirmed.pricingConfirmation.cost, .3); assert.equal(confirmed.cost, .00026);
  const report = buildUsageReport(store.records('calls'), { at: date });
  assert.equal(report.totals.cost, .00026); assert.equal(report.recentCalls[0].pricingConfirmation.cost, .3);
});
