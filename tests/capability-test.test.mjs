import test from 'node:test';
import assert from 'node:assert/strict';
import { createCapabilityTests } from '../src/capability-test.mjs';
import { defaults } from '../src/service.mjs';
import { testAndSaveCapability } from '../public/capability-test.mjs';
const config = { enabled: true, baseUrl: 'https://example.invalid/v1', model: 'synthetic', apiKey: 'synthetic-test-only' };
function harness(testImpl = async () => ({ ok: true })) {
  let current = structuredClone(defaults), version = 0, time = 0;
  const saved = [], tested = [];
  const flow = createCapabilityTests({ settings: () => current, defaults, revision: () => version,
    ai: { async test(...args) { tested.push(args); return testImpl(...args); } },
    save(input) { saved.push(input); version++; current = { ...current, ...input }; }, now: () => time });
  return { flow, saved, tested, change() { version++; }, expire() { time += 300001; } };
}
test('draft test does not persist; receipt saves only the exact capability once without secret reflection', async () => {
  const h = harness(), result = await h.flow.test('model', config);
  assert.equal(h.saved.length, 0);
  assert.equal(h.tested[0][1].settings.ai.enabled, true);
  assert.equal(h.tested[0][1].settings.ai.apiKey, undefined);
  assert.equal(h.tested[0][1].secret, config.apiKey);
  assert.equal(JSON.stringify(result).includes(config.apiKey), false);
  assert.equal(h.flow.save('model', config, result.receipt).saved, true);
  assert.deepEqual(h.saved, [{ ai: config }]);
  assert.throws(() => h.flow.save('model', config, result.receipt), { code: 'CONFIG_CHANGED' });
});
test('failed test never saves or issues a usable receipt', async () => {
  const h = harness(async () => { throw new Error('mock offline'); });
  await assert.rejects(h.flow.test('model', config), /mock offline/);
  assert.equal(h.saved.length, 0);
});
test('unrelated and privileged fields cannot be smuggled into test-and-save', async () => {
  for (const extra of [{ mcp: { enabled: true } }, { vaultDir: '/tmp/other' }, { monthlyBudget: 0 }, { clearKey: true }]) {
    const h = harness();
    await assert.rejects(h.flow.test('model', { ...config, ...extra }));
    assert.equal(h.tested.length, 0); assert.equal(h.saved.length, 0);
  }
});
test('changes during test, after test, mismatched draft, wrong capability and expiry cannot overwrite settings', async () => {
  const racing = harness(async () => { racing.change(); return { ok: true }; });
  await assert.rejects(racing.flow.test('model', config), { code: 'CONFIG_CHANGED' });
  for (const mode of ['change', 'draft', 'capability', 'expiry']) {
    const h = harness(), { receipt } = await h.flow.test('model', config);
    if (mode === 'change') h.change();
    if (mode === 'expiry') h.expire();
    assert.throws(() => h.flow.save(mode === 'capability' ? 'search' : 'model', mode === 'draft' ? { ...config, model: 'newer' } : config, receipt), { code: 'CONFIG_CHANGED' });
    assert.equal(h.saved.length, 0);
  }
});
test('UI saves unchanged snapshot, skips edited/detached forms, distinguishes save failure, and unlocks', async () => {
  const saves = [], locks = [];
  const common = { capability: 'model', snapshot: config, test: async () => ({ receipt: 'mock-proof' }), save: async (...args) => { saves.push(args); return { saved: true }; }, unchanged: () => true, saving: active => locks.push(active) };
  assert.deepEqual(await testAndSaveCapability(common), { saved: true });
  assert.deepEqual(saves, [['model', config, 'mock-proof']]);
  assert.deepEqual(locks, [true, false]);
  assert.deepEqual(await testAndSaveCapability({ ...common, unchanged: () => false }), { saved: false, changed: true });
  assert.equal(saves.length, 1);
  await assert.rejects(testAndSaveCapability({ ...common, save: async () => { throw new Error('storage full'); } }), /测试成功，但未能确认保存/);
  assert.equal(locks.at(-1), false);
  await assert.rejects(testAndSaveCapability({ ...common, test: async () => { throw new Error('mock offline'); } }), /mock offline/);
  assert.equal(saves.length, 1);
});

test('receipts cannot cross service/library instances, and invalid disabled drafts are never enabled', async () => {
  const a = harness(), b = harness();
  const { receipt } = await a.flow.test('model', config);
  assert.throws(() => b.flow.save('model', config, receipt), { code: 'CONFIG_CHANGED' });
  const disabled = harness(async (_cap, draft) => { assert.equal(draft.settings.ai.enabled, false); throw Object.assign(new Error('disabled'), { code: 'CAPABILITY_DISABLED' }); });
  await assert.rejects(disabled.flow.test('model', { ...config, enabled: false }), { code: 'CAPABILITY_DISABLED' });
  assert.equal(disabled.saved.length, 0);
});

test('settings routes preserve legacy testing and reject practice draft test/save before invocation', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');
  const start = source.indexOf("      else if(resource==='settings'&&id==='test'&&method==='POST')");
  const end = source.indexOf("      else if(resource==='usage'", start);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const route = new AsyncFunction('body','practiceId','id','mainService','onboarding','fail', `let result; const resource='settings',method='POST'; if(false) {} ${source.slice(start,end)} return result;`);
  const calls = [];
  const main = { capabilityTests: { test: async () => { calls.push('draft'); return { ok: true }; }, save: () => { calls.push('save'); return { saved: true }; } } };
  const onboarding = { test: async () => ({ testResult: { legacy: true } }), settingsChanged: () => calls.push('changed'), tested: () => calls.push('tested') };
  const fail = (message, code) => { throw Object.assign(new Error(message), { code }); };
  assert.deepEqual(await route({ capability: 'model' }, 'practice', 'test', main, onboarding, fail), { legacy: true });
  for (const id of ['test','save-tested']) await assert.rejects(route({ capability: 'model', config }, 'practice', id, main, onboarding, fail), { code: 'PRACTICE_SETTINGS_LOCKED' });
  assert.deepEqual(calls, []);
  await route({ capability: 'model', config }, '', 'test', main, onboarding, fail);
  await route({ capability: 'model', config }, '', 'save-tested', main, onboarding, fail);
  assert.deepEqual(calls, ['draft','save','changed','tested']);
  const saved = await route({ capability: 'model', config }, '', 'save-tested', main, { ...onboarding, settingsChanged: () => { throw new Error('synthetic disk full'); } }, fail);
  assert.equal(saved.saved, true); assert.match(saved.warning, /无需重复测试/);
});


test('a non-successful adapter result cannot issue a save receipt', async () => {
  const h = harness(async () => ({ ok: false }));
  await assert.rejects(h.flow.test('model', config), { code: 'INVALID_RESPONSE' });
  assert.equal(h.saved.length, 0);
});
