import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildUsageReport } from '../src/usage.mjs';
import { readTokenUsage, tokenCost } from '../src/token-usage.mjs';
import { createService } from '../src/service.mjs';

const at = new Date('2026-10-02T16:30:00Z');
const entry = (values = {}) => ({ capability: 'model', model: 'alpha', createdAt: '2026-10-02T17:00:00Z', inputTokens: 100, outputTokens: 20, cost: .1, ok: true, ...values });

test('cache and reasoning are subsets; provider totals never double count them', () => {
  const counts = readTokenUsage({ prompt_tokens: 100, completion_tokens: 30, total_tokens: 180, prompt_cache_hit_tokens: 40, completion_tokens_details: { reasoning_tokens: 10 } });
  assert.deepEqual(counts, { inputTokens: 100, outputTokens: 30, totalTokens: 130, cachedInputTokens: 40, reasoningTokens: 10 });
  assert.equal(tokenCost(counts, { inputPrice: 2, outputPrice: 5, cachedInputPrice: .5 }), .00029);
  assert.equal(tokenCost(counts, { inputPrice: 2, outputPrice: 5 }), .00035);
  assert.equal(readTokenUsage({ total_tokens: 24 }, { embedding: true }).inputTokens, 24);
  assert.equal(tokenCost(readTokenUsage({ prompt_tokens: 10, completion_tokens: 2 }), { inputPrice: 1, outputPrice: 1, cachedInputPrice: .5 }), null);
});

test('missing, negative, fractional and invalid counts are unknown, with explicit zero supported', () => {
  for (const value of [undefined, null, -1, .5, Infinity, '10', false]) assert.equal(readTokenUsage({ prompt_tokens: value }).inputTokens, null);
  assert.equal(readTokenUsage({ prompt_tokens: 10, prompt_cache_hit_tokens: 11 }).cachedInputTokens, null);
  assert.equal(readTokenUsage({ completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 6 } }).reasoningTokens, null);
  assert.equal(tokenCost(readTokenUsage({ prompt_tokens: 0, completion_tokens: 0 }), { inputPrice: 0, outputPrice: 0 }), 0);
  assert.equal(tokenCost(readTokenUsage({ prompt_tokens: 1, completion_tokens: 1 }), { inputPrice: null, outputPrice: 0 }), null);
});

test('statistics use all records beyond recent 100, group by calendar timezone, and omit content', () => {
  const calls = Array.from({ length: 125 }, () => entry({ sourceId: 'private-note', error: 'private-detail', prompt: 'private-text', cachedInputTokens: 40 }));
  calls.push(entry({ createdAt: '2026-10-02T15:59:00Z', model: 'previous-day' }));
  calls.push(entry({ createdAt: '2026-09-30T16:01:00Z', model: 'month-start' }));
  calls.push(entry({ createdAt: '2026-09-30T15:59:00Z', model: 'previous-month' }));
  calls.push(entry({ createdAt: 'invalid' }));
  const report = buildUsageReport(calls, { timezone: 'Asia/Singapore', period: 'today', at });
  assert.equal(report.from, '2026-10-03'); assert.equal(report.totals.calls, 125);
  assert.equal(report.totals.totalTokens, 15000); assert.equal(report.totals.cachedInputTokens, 5000);
  assert.equal(report.recentCalls.length, 100); assert.equal(report.invalidDateCalls, 1);
  assert.equal(JSON.stringify(report).includes('private-'), false);
  const month = buildUsageReport(calls, { timezone: 'Asia/Singapore', at });
  assert.equal(month.totals.calls, 127); assert.equal(month.daily.length, 3);
  const utc = buildUsageReport(calls, { timezone: 'UTC', period: 'today', at });
  assert.equal(utc.totals.calls, 126);
  assert.equal(buildUsageReport([], { timezone: 'America/New_York', period: '7d', at: new Date('2026-11-03T12:00:00Z') }).daily.length, 7);
});

test('partial costs remain unknown across summaries, days and models; search has no missing tokens', () => {
  const report = buildUsageReport([entry(), entry({ inputTokens: null, outputTokens: null, totalTokens: null, cost: null, ok: false }), entry({ capability: 'search', model: null, cost: null })], { at });
  assert.equal(report.totals.cost, null); assert.equal(report.totals.knownCost, .1);
  assert.equal(report.totals.unknownCostCalls, 2); assert.equal(report.totals.unknownTokenCalls, 1);
  assert.equal(report.totals.failedCalls, 1); assert.equal(report.models.find(row => row.model === 'alpha').cost, null);
  assert.equal(report.daily.at(-1).cost, null);
  const filtered = buildUsageReport([entry(), entry({ model: 'beta' }), entry({ capability: 'search', model: null })], { at, capability: 'model', model: 'beta' });
  assert.equal(filtered.totals.calls, 1); assert.deepEqual(filtered.availableModels, ['alpha', 'beta']);
  assert.throws(() => buildUsageReport([], { period: 'forever' }), { code: 'INVALID_USAGE_FILTER' });
  const empty = buildUsageReport([], { at }); assert.equal(empty.totals.cost, 0); assert.equal(empty.totals.calls, 0);
});

test('usage settings preserve secrets/capability flags and historical costs, reject stale model prices', t => {
  const root = path.resolve('.tmp'); fs.mkdirSync(root, { recursive: true });
  const temp = fs.mkdtempSync(path.join(root, 'usage-settings-'));
  const service = createService({ dataDir: path.join(temp, 'data'), vaultDir: path.join(temp, 'vault') });
  t.after(async () => { await service.close(); assert.ok(path.resolve(temp).startsWith(root + path.sep)); fs.rmSync(temp, { recursive: true, force: true }); });
  service.updateSettings({ ai: { model: 'alpha', baseUrl: 'https://example.org/v1', enabled: false, dailyCallLimit: 77, monthlyBudget: 12 } });
  service.store.put('calls', 'historical', entry({ cost: null }));
  const settings = service.settings();
  const pricingFor = Object.fromEntries(['ai', 'embedding', 'search'].map(group => [group, { baseUrl: settings[group].baseUrl, model: settings[group].model || '' }]));
  const saved = service.updateUsageSettings({ pricingFor, ai: { inputPrice: '2', outputPrice: '5', cachedInputPrice: '', enabled: true, apiKey: 'must-not-save' }, search: { requestPrice: '0.01' } });
  assert.equal(saved.ai.enabled, false); assert.equal(saved.ai.hasKey, false);
  assert.equal(saved.ai.dailyCallLimit, 77); assert.equal(saved.ai.monthlyBudget, 12); assert.equal(saved.ai.inputPrice, 2);
  assert.equal(service.settings().ai.sourceCallLimit, 120);
  assert.equal(service.updateUsageSettings({ pricingFor, ai: { sourceCallLimit: 300 } }).ai.sourceCallLimit, 300);
  for (const sourceCallLimit of [0,301,1.5,null,'',false,true]) assert.throws(() => service.updateUsageSettings({ pricingFor, ai: { sourceCallLimit } }));
  assert.equal(saved.ai.cachedInputPrice, null); assert.equal(saved.search.requestPrice, .01);
  assert.equal(service.store.get('calls', 'historical').cost, null);
  assert.throws(() => service.updateUsageSettings({ pricingFor, ai: { inputPrice: -1 } }));
  assert.throws(() => service.updateUsageSettings({ pricingFor, ai: { outputPrice: false } }));
  assert.throws(() => service.updateUsageSettings({ pricingFor, ai: { dailyCallLimit: null } }));
  service.updateSettings({ ai: { model: 'beta' } });
  assert.equal(service.settings().ai.inputPrice, null);
  assert.throws(() => service.updateUsageSettings({ pricingFor, ai: { inputPrice: 9 } }), { code: 'PRICING_CHANGED' });
  service.store.put('calls', 'bad-date', entry({ createdAt: 'invalid' }));
  assert.equal(service.usageReport().invalidDateCalls, 1); assert.equal(service.usageReport().budget.unavailable, true);
});
