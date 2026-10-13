import test from 'node:test';
import assert from 'node:assert/strict';
import { createAndroidBrowser, findButton, control, click, descendants } from './fixtures/android-browser.mjs';

const sourceId = '11111111-1111-4111-8111-111111111111';
const body = '<script>合成文本，不能执行</script>\n完整正文末行';
const value = { title: '合成原文', body, source: { platform: '合成平台', author: '虚构作者', url: 'https://example.org/synthetic', date: '2026-10-13', locator: '合成定位', topic: '合成主题' } };
const event = { id: 'synthetic-peer:1', operation: 'put', value };
const preview = () => ({ context: 'formal', sourceId, revision: '1', heads: [event.id], versions: [event], original: { id: sourceId, title: '手机原文', body: '手机合成正文', hash: 'synthetic-hash', meta: {} }, canApply: true, identical: false, token: 'synthetic-token' });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
async function setup({ api = {}, confirmations = [], isCurrent = () => true, onChanged = async () => {} } = {}) {
  const calls = [], errors = [];
  const fixture = await createAndroidBrowser({ confirmations, api: {
    androidSync: async () => ({ context: 'formal', connected: false, sources: [{ sourceId, title: '合成原文', local: true, status: 'present' }], events: 1 }),
    previewAndroidSyncSource: async () => preview(),
    stageAndroidSyncSource: async input => { calls.push(['stage', input]); },
    resolveAndroidSyncSource: async input => { calls.push(['resolve', input]); },
    applyAndroidSyncSource: async token => { calls.push(['apply', token]); return { sourceId, eventId: event.id, note: {} }; }, ...api,
  } });
  const panel = await fixture.context.createAndroidSyncPanel({ api: fixture.context.api, isCurrent, onChanged, onError: error => errors.push(error) });
  return { ...fixture, panel, calls, errors };
}
const open = fixture => click(findButton(fixture.panel, '预览原文与同步版本'));
function acknowledge(fixture) { const checkbox = control(fixture.panel, 'syncReviewed'); checkbox.checked = true; checkbox.events.change(); return checkbox; }
const apply = fixture => findButton(fixture.panel, '应用到这一份手机原文');

test('pairing and apply remain disabled without a token or explicit review; complete sources are plain text', async () => {
  const fixture = await setup(); assert.equal(findButton(fixture.panel, '同一 Wi-Fi 配对（尚未开放）').disabled, true);
  assert.match(fixture.panel.textContent, /连接尚未接入/); assert.equal(apply(fixture).disabled, true);
  await open(fixture); assert.equal(apply(fixture).disabled, true); await click(apply(fixture)); assert.equal(fixture.calls.length, 0);
  assert.ok(fixture.panel.textContent.includes(body)); for (const field of Object.values(value.source)) assert.ok(fixture.panel.textContent.includes(field));
  assert.equal(descendants(fixture.panel).filter(node => node.tagName === 'a').length, 0);
  acknowledge(fixture); assert.equal(apply(fixture).disabled, false);
  const blocked = await setup({ api: { previewAndroidSyncSource: async () => ({ ...preview(), token: null }) } });
  await open(blocked); acknowledge(blocked); assert.equal(control(blocked.panel, 'syncReviewed').checked, false); assert.equal(apply(blocked).disabled, true);
});

test('new preview and preview failure reset checked permission and invalidate the old token', async () => {
  let fail = false;
  const fixture = await setup({ api: { previewAndroidSyncSource: async () => { if (fail) throw new Error('synthetic read failure'); return preview(); } } });
  await open(fixture); acknowledge(fixture); await open(fixture);
  assert.equal(control(fixture.panel, 'syncReviewed').checked, false); assert.equal(apply(fixture).disabled, true);
  acknowledge(fixture); fail = true; await open(fixture); await click(apply(fixture));
  assert.equal(fixture.calls.length, 0); assert.equal(fixture.errors.length, 1); assert.equal(control(fixture.panel, 'syncReviewed').disabled, true);
});

test('cancelled confirmation never applies or changes sync records', async () => {
  const fixture = await setup({ confirmations: [false, false] }); await open(fixture); acknowledge(fixture);
  await click(apply(fixture)); await click(findButton(fixture.panel, '把这版手机原文记入同步记录'));
  assert.equal(fixture.calls.length, 0);
  const conflict = await setup({ confirmations: [false], api: { previewAndroidSyncSource: async () => ({ ...preview(), heads: [event.id, 'peer:2'], versions: [event, { ...event, id: 'peer:2' }], canApply: false, token: null }) } });
  await open(conflict); await click(findButton(conflict.panel, '选择这版作为同步版本')); assert.equal(conflict.calls.length, 0);
});

test('successful apply followed by refresh failure stays successful and cannot consume token twice', async () => {
  const fixture = await setup({ onChanged: async () => { throw new Error('synthetic bootstrap refresh failure'); } });
  await open(fixture); acknowledge(fixture); await click(apply(fixture)); await click(apply(fixture));
  assert.deepEqual(fixture.calls, [['apply', 'synthetic-token']]); assert.equal(fixture.errors.length, 0);
  assert.match(fixture.panel.textContent, /原文已应用.*无需再次应用/); assert.equal(control(fixture.panel, 'syncReviewed').checked, false);
});

test('busy apply ignores duplicate clicks; failed response resets review and token', async () => {
  const pending = deferred(); let count = 0;
  const fixture = await setup({ api: { applyAndroidSyncSource: async () => { count++; await pending.promise; throw new Error('synthetic lost response'); } } });
  await open(fixture); acknowledge(fixture); const first = click(apply(fixture)); await flush();
  await click(apply(fixture)); assert.equal(count, 1); assert.equal(apply(fixture).disabled, true);
  pending.resolve(); await first; await click(apply(fixture)); assert.equal(count, 1);
  assert.equal(control(fixture.panel, 'syncReviewed').checked, false); assert.equal(control(fixture.panel, 'syncReviewed').disabled, true);
});

test('leaving page during confirmation and changing library invalidate old permission before apply', async () => {
  let current = true; const pending = deferred(); const fixture = await setup({ isCurrent: () => current });
  fixture.context.confirmAction = async () => pending.promise;
  await open(fixture); acknowledge(fixture); const first = click(apply(fixture)); current = false; pending.resolve(true); await first;
  assert.equal(fixture.calls.length, 0); assert.equal(control(fixture.panel, 'syncReviewed').checked, false);
  let version = 0;
  const switched = await setup({ api: { getContext: () => ({ practiceId: version ? 'android-local' : '', version }) } });
  await open(switched); acknowledge(switched); version++; await click(apply(switched)); assert.equal(switched.calls.length, 0);
});

test('stage and resolve use reviewed hashes and complete heads; delete versions cannot be chosen or applied', async () => {
  const fixture = await setup(); await open(fixture); await click(findButton(fixture.panel, '把这版手机原文记入同步记录'));
  assert.equal(fixture.calls[0][0], 'stage'); assert.equal(fixture.calls[0][1].expectedHash, 'synthetic-hash'); assert.deepEqual(Array.from(fixture.calls[0][1].expectedHeads), [event.id]);
  assert.match(fixture.context.confirmPrompts[0].message, /不会改写原文/); assert.equal(apply(fixture).disabled, true);
  const conflict = await setup({ api: { previewAndroidSyncSource: async () => ({ ...preview(), heads: [event.id, 'peer:2'], versions: [event, { id: 'peer:2', operation: 'delete', value: null }], canApply: false, token: null }) } });
  await open(conflict); assert.match(conflict.panel.textContent, /保留的删除记录/); assert.equal(findButton(conflict.panel, '选择删除版本（未开放）').disabled, true);
  await click(findButton(conflict.panel, '选择这版作为同步版本')); assert.equal(conflict.calls[0][0], 'resolve');
  assert.deepEqual(Array.from(conflict.calls[0][1].expectedHeads), [event.id, 'peer:2']); assert.equal(conflict.calls[0][1].eventId, event.id);
});

test('system render generation prevents a late result from replacing another page and hides operations in practice', async () => {
  const pending = deferred(); let version = 0, practiceId = '';
  const fixture = await createAndroidBrowser({ api: { getContext: () => ({ version, practiceId }), androidGuide: async () => ({ steps: [] }), settings: async () => ({}), androidSync: async () => pending.promise } });
  fixture.app.state.view = 'system'; const rendering = fixture.app.renderSystem(); await flush();
  fixture.app.state.view = 'capture'; fixture.app.refs.main.textContent = 'new-page-marker'; pending.resolve({ context: 'formal', sources: [], connected: false }); await rendering;
  assert.equal(fixture.app.refs.main.textContent, 'new-page-marker');
  practiceId = 'android-local'; version++; fixture.app.state.view = 'system'; await fixture.app.renderSystem();
  assert.ok(!fixture.app.refs.main.textContent.includes('原文同步预览'));
});

test('a slower previous system render cannot replace the newer system list', async () => {
  const pending = deferred(); let loads = 0;
  const fixture = await createAndroidBrowser({ api: { androidGuide: async () => ({ steps: [] }), settings: async () => ({}),
    androidSync: async () => ++loads === 1 ? pending.promise : { context: 'formal', sources: [{ sourceId, title: '最新列表原文' }], connected: false } } });
  fixture.app.state.view = 'system'; const older = fixture.app.renderSystem(); await flush(); await fixture.app.renderSystem();
  const fresh = fixture.app.refs.main.textContent; assert.match(fresh, /最新列表原文/);
  pending.resolve({ context: 'formal', sources: [{ sourceId, title: '旧列表原文' }], connected: false }); await older;
  assert.equal(fixture.app.refs.main.textContent, fresh);
});
