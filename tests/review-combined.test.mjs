import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createService } from '../src/service.mjs';
import { testAndSaveCapability } from '../public/capability-test.mjs';

const draft = { enabled: true, baseUrl: 'https://8.8.8.8/v1', model: 'synthetic-alpha', apiKey: '' };
const rawCatalog = JSON.stringify({ synthetic: { id: 'synthetic', api: draft.baseUrl, models: {
  [draft.model]: { id: draft.model, cost: { input: 2, output: 6 } },
} } });
const pricingFor = settings => Object.fromEntries(['ai', 'embedding', 'search'].map(group => [group, {
  baseUrl: settings[group].baseUrl, model: settings[group].model || '', providerId: settings[group].providerId || '',
  billingMode: settings[group].billingMode || 'standard', currency: settings[group].currency || null,
}]));
function fixture(t) {
  const parent = path.resolve(import.meta.dirname, '../.tmp');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'review-combined-'));
  let requests = 0;
  const service = createService({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'),
    priceCatalogFetch: async () => { requests++; return new Response(rawCatalog); } });
  // Only the transport-facing test method is mocked; service validation, revision,
  // exact-snapshot receipt, save and price matching remain the actual implementation.
  t.mock.method(service.ai, 'test', async (capability, value) => {
    assert.equal(capability, 'model'); assert.equal(value.settings.ai.model, draft.model);
    assert.equal(value.settings.ai.monthlyBudget, 10);
    assert.equal(value.settings.ai.inputPrice, null, 'Changing model drops the old manual price');
    return { ok: true };
  });
  t.after(async () => { await service.close(); assert.equal(path.dirname(root), parent); fs.rmSync(root, { recursive: true, force: true }); });
  service.updateSettings({ ai: { baseUrl: draft.baseUrl, model: 'synthetic-old', inputPrice: 9, outputPrice: 11, currency: 'CNY', monthlyBudget: 10, budgetCurrency: 'USD' } });
  return { service, root, requests: () => requests };
}

test('combined test-and-save uses unsaved model and exposes its automatic price without changing budgets', async t => {
  const { service, requests, root } = fixture(t), before = service.settings();
  let receipt;
  const result = await testAndSaveCapability({ capability: 'model', snapshot: draft,
    test: async (...args) => {
      receipt = await service.capabilityTests.test(...args);
      assert.equal(service.settings().ai.model, 'synthetic-old');
      await service.refreshPricing(); // Catalog refresh is not a settings edit.
      return receipt;
    }, save: (...args) => service.capabilityTests.save(...args), unchanged: () => true, saving() {},
  });
  assert.equal(result.saved, true); assert.equal(requests(), 1);
  assert.equal(service.settings().ai.model, draft.model);
  assert.equal(service.settings().ai.monthlyBudget, before.ai.monthlyBudget);
  assert.equal(service.settings().ai.budgetCurrency, 'USD');
  assert.equal(service.pricingStatus().current.ai.source, 'models.dev');
  assert.equal(service.pricingStatus().current.ai.rates.inputPrice, 2);
  assert.equal(service.usageReport().pricing.current.ai.identity.model, draft.model);
  assert.deepEqual(service.store.records('calls'), []);
  assert.throws(() => service.capabilityTests.save('model', draft, receipt.receipt), { code: 'CONFIG_CHANGED' });
  assert.equal(fs.existsSync(path.join(root, 'data/mcp-token')), false);
  assert.equal(fs.existsSync(path.join(root, 'data/chatgpt-mcp-token')), false);
});

test('combined usage edits invalidate tested snapshots and stale price forms cannot overwrite new API identities', async t => {
  const { service } = fixture(t), oldIdentity = pricingFor(service.settings());
  const first = await service.capabilityTests.test('model', draft);
  service.updateUsageSettings({ pricingFor: oldIdentity, ai: { monthlyBudget: 12 } });
  assert.throws(() => service.capabilityTests.save('model', draft, first.receipt), { code: 'CONFIG_CHANGED' });
  assert.equal(service.settings().ai.model, 'synthetic-old');
  service.updateUsageSettings({ pricingFor: oldIdentity, ai: { monthlyBudget: 10 } });
  const second = await service.capabilityTests.test('model', draft);
  service.capabilityTests.save('model', draft, second.receipt);
  assert.throws(() => service.updateUsageSettings({ pricingFor: oldIdentity, ai: { inputPrice: 9 } }), { code: 'PRICING_CHANGED' });
  assert.equal(service.settings().ai.inputPrice, null);
});

test('combined capture and Web edits keep receipt identity and one history event after API and price changes', async t => {
  const { service } = fixture(t);
  const { receipt } = await service.capabilityTests.test('model', draft);
  service.capabilityTests.save('model', draft, receipt); await service.refreshPricing();
  const input = { items: [{ kind: 'source', body: '# 合成收集标题\n\n第一版正文' }], process: false };
  const saved = service.importItems(input), note = saved.notes[0];
  assert.equal(note.title, '合成收集标题');
  assert.equal(service.importItems(input).notes[0].id, note.id);
  const current = service.getNote(note.id), before = service.store.history(note.id);
  service.editNote(note.id, { expectedHash: current.hash, body: '# 合成收集标题\n\n第二版正文' });
  const added = service.store.history(note.id).filter(row => !before.some(old => old.versionId === row.versionId));
  assert.equal(added.length, 1); assert.equal(added[0].reason, 'Web 修改前'); assert.equal(added[0].hash, current.hash);
  assert.equal(service.pricingStatus().current.ai.source, 'models.dev');
  assert.deepEqual(service.store.records('calls'), []);
});
