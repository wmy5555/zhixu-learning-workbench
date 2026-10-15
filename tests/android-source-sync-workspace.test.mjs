import test from 'node:test';
import assert from 'node:assert/strict';
import { createAndroidSourceSyncWorkspace } from '../apps/android/web/android-source-sync-workspace.mjs';
import { createAndroidTransport } from '../apps/android/web/android-transport.mjs';
import { createEmptyLearningState } from '../apps/android/web/android-learning.mjs';
import { createSyncState, createSyncBatch, inspectSyncSource, recordSyncChange, receiveSyncBatch } from '../apps/android/web/source-sync.mjs';

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const L = '33333333-3333-4333-8333-333333333333', ID = '44444444-4444-4444-8444-444444444444';
const OTHER = '55555555-5555-4555-8555-555555555555', TOKEN = '66666666-6666-4666-8666-666666666666';
const value = body => ({ title: '合成原文', body, source: { platform: '', author: '', url: '', date: '', locator: '', topic: '' } });
const initial = replicaId => createSyncState({ replicaId, libraryId: L });
const change = (state, body) => recordSyncChange(state, { sourceId: ID, expectedHeads: inspectSyncSource(state, ID).versions.map(v => v.id),
  operation: body === null ? 'delete' : 'put', value: body === null ? null : value(body) });
function fixture() {
  let journal = { revision: '0', state: initial(A) }, writes = 0;
  const calls = [], note = { id: ID, kind: 'source', title: '合成原文', body: '手机原文', hash: 'synthetic-hash-1',
    meta: { privacy: 'local', stage: 'reference', platform: '合成来源', author: '', url: 'https://example.org/inert', date: '', locator: '', topic: '' },
    userAnswer: '不参加原文同步的合成回答' };
  const plugin = {
    async syncLoad(args) { calls.push(['load', args]); return structuredClone(journal); },
    async syncCommit(args) {
      calls.push(['commit', structuredClone(args)]);
      if (args.expectedRevision !== journal.revision) throw Object.assign(new Error('合成陈旧提交'), { code: 'SYNC_STALE' });
      journal = { revision: String(BigInt(journal.revision) + 1n), state: structuredClone(args.state) }; writes++;
      return structuredClone(journal);
    },
    async list(args) { calls.push(['list', args]); return { notes: [structuredClone(note)] }; },
    async read(args) { calls.push(['read', args]); assert.equal(args.id, ID); return { note: structuredClone(note) }; },
    async syncSourcePreview(args) {
      calls.push(['preview', args]);
      const view = inspectSyncSource(journal.state, args.sourceId);
      return { context: 'formal', sourceId: args.sourceId, revision: journal.revision,
        heads: view.versions.map(v => v.id), versions: view.versions, original: structuredClone(note), canApply: false, identical: false, token: null };
    },
    async syncSourceApply(args) { calls.push(['apply', args]); return { sourceId: ID, eventId: `${A}:1`, note: structuredClone(note), unchanged: false }; },
  };
  return { plugin, calls, note, get state() { return structuredClone(journal.state); }, get writes() { return writes; },
    install(state) { journal = { revision: String(BigInt(journal.revision) + 1n), state: structuredClone(state) }; } };
}

test('local source snapshot retains six provenance fields and never imports permissions or learning data', async () => {
  const f = fixture(), workspace = createAndroidSourceSyncWorkspace(f.plugin);
  const first = await workspace.summary(); assert.equal(first.connected, false); assert.equal(first.sources[0].status, 'absent');
  const request = { sourceId: ID, expectedHash: f.note.hash, expectedHeads: [] };
  await workspace.stage(request);
  assert.equal(f.writes, 1); assert.equal(f.state.events[0].sourceId, ID);
  assert.deepEqual(Object.keys(f.state.events[0].value).sort(), ['body', 'source', 'title']);
  assert.deepEqual(f.state.events[0].value.source, Object.fromEntries(['platform', 'author', 'url', 'date', 'locator', 'topic'].map(k => [k, f.note.meta[k]])));
  assert.equal(f.state.events[0].value.body, f.note.body);
  const heads = inspectSyncSource(f.state, ID).versions.map(v => v.id);
  assert.deepEqual(await workspace.stage({ ...request, expectedHeads: heads }), { unchanged: true });
  assert.equal(f.writes, 1); assert.equal(f.note.meta.privacy, 'local');
  const summary = await workspace.summary(); assert.equal(summary.sources[0].status, 'present'); assert.equal(summary.events, 1);
});

test('stale original hash or heads cannot record a different snapshot or overwrite the original', async () => {
  const f = fixture(), workspace = createAndroidSourceSyncWorkspace(f.plugin);
  await assert.rejects(workspace.stage({ sourceId: ID, expectedHash: 'older-hash', expectedHeads: [] }), { code: 'SYNC_STALE' });
  f.install(change(initial(A), '日记已有版本'));
  await assert.rejects(workspace.stage({ sourceId: ID, expectedHash: f.note.hash, expectedHeads: [] }), { code: 'SYNC_STALE' });
  assert.equal(f.writes, 0); assert.equal(f.note.body, '手机原文');
});

test('conflict selection requires every current head and leaves source materialization to reviewed native apply', async () => {
  const f = fixture(), left = change(initial(A), '手机同步分支'), right = change(initial(B), '电脑同步分支');
  f.install(receiveSyncBatch(left, createSyncBatch(right)).state);
  const workspace = createAndroidSourceSyncWorkspace(f.plugin), view = inspectSyncSource(f.state, ID), heads = view.versions.map(v => v.id);
  assert.equal((await workspace.summary()).sources[0].status, 'conflict');
  await assert.rejects(workspace.resolve({ sourceId: ID, eventId: `${B}:1`, expectedHeads: [heads[0]] }), { code: 'SYNC_STALE' });
  await assert.rejects(workspace.resolve({ sourceId: ID, eventId: `${B}:2`, expectedHeads: heads }), { code: 'SYNC_STALE' });
  assert.equal(f.writes, 0);
  await workspace.resolve({ sourceId: ID, eventId: `${B}:1`, expectedHeads: heads });
  assert.equal(inspectSyncSource(f.state, ID).versions[0].value.body, '电脑同步分支');
  assert.equal(f.state.events.length, 3); assert.equal(f.note.body, '手机原文');
  assert.equal(f.calls.some(call => call[0] === 'apply'), false);
});

test('delete conflicts and wrong-library preview remain unapplied while journal history survives', async () => {
  const f = fixture(), left = change(initial(A), '保留手机分支'), right = change(initial(B), null);
  f.install(receiveSyncBatch(left, createSyncBatch(right)).state);
  const workspace = createAndroidSourceSyncWorkspace(f.plugin), before = f.state;
  await assert.rejects(workspace.resolve({ sourceId: ID, eventId: `${B}:1`, expectedHeads: inspectSyncSource(before, ID).versions.map(v => v.id) }), { code: 'ANDROID_UNAVAILABLE' });
  f.plugin.syncSourcePreview = async () => ({ context: 'practice', sourceId: ID });
  await assert.rejects(workspace.preview({ sourceId: ID }), { code: 'SYNC_SCOPE' });
  assert.deepEqual(f.state, before); assert.equal(f.writes, 0); assert.equal(f.note.body, '手机原文');
});

test('Android sync routes reject practice, unsupported methods and extra fields before native storage or HTTP', async t => {
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected network'); });
  const f = fixture(), transport = createAndroidTransport(f.plugin);
  for (const [path, method, body] of [
    ['/api/practice/android-local/android/sync', 'GET', {}], ['/api/android/sync?context=formal', 'GET', {}],
    ['/api/android/sync/stage', 'GET', {}], ['/api/android/sync/unknown', 'POST', {}],
  ]) await assert.rejects(transport.request(path, { method, body }), { code: 'ANDROID_UNAVAILABLE' });
  await assert.rejects(transport.request('/api/android/sync/apply', { method: 'POST', body: { token: TOKEN, allowExternal: true } }), { code: 'VALIDATION' });
  assert.deepEqual(f.calls, []);
  assert.equal((await transport.request('/api/android/sync')).connected, false);
  await transport.request('/api/android/sync/preview', { method: 'POST', body: { sourceId: ID } });
  await transport.request('/api/android/sync/apply', { method: 'POST', body: { token: TOKEN } });
  assert.deepEqual(f.calls.find(call => call[0] === 'apply'), ['apply', { context: 'formal', token: TOKEN }]);
  assert.equal(network.mock.callCount(), 0);
});

test('online-enabled transport keeps formal sync local and preserves later online and learning routes', async t => {
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected supplier HTTP'); });
  const f = fixture(), onlineCalls = [], learningCalls = [];
  // The original sync-only fixture adds a learning-answer field to prove it is excluded.
  // Native source list responses do not contain that unsupported field.
  f.plugin.list = async args => { f.calls.push(['list', args]); const { userAnswer, ...note } = f.note; return { notes: [structuredClone(note)] }; };
  f.plugin.learningLoad = async ({ context }) => { learningCalls.push(context); return { revision: 'empty', state: createEmptyLearningState() }; };
  const online = {
    async settingsGet() { onlineCalls.push('settings'); return { revision: 'synthetic-settings', ai: { enabled: false, hasKey: false }, search: { enabled: false, hasKey: false }, fetch: { enabled: false } }; },
    async usage(args) { onlineCalls.push(['usage', args]); return { calls: [], budget: { callsToday: 0, knownCostMonth: 0, unknownCostCalls: 0 } }; },
    async authorize() { onlineCalls.push('authorize'); throw new Error('sync must not authorize a supplier'); },
    async request() { onlineCalls.push('request'); throw new Error('sync must not request a supplier'); },
  };
  const transport = createAndroidTransport(f.plugin, { online, clock: () => new Date('2026-10-13T02:00:00Z') });
  assert.equal((await transport.request('/api/android/sync')).connected, false);
  await transport.request('/api/android/sync/preview', { method: 'POST', body: { sourceId: ID } });
  await transport.request('/api/android/sync/stage', { method: 'POST', body: { sourceId: ID, expectedHash: f.note.hash, expectedHeads: [] } });
  await transport.request('/api/android/sync/apply', { method: 'POST', body: { token: TOKEN } });
  assert.equal(f.writes, 1); assert.ok(f.calls.some(([name]) => name === 'preview')); assert.ok(f.calls.some(([name]) => name === 'apply'));
  assert.deepEqual(onlineCalls, []); assert.deepEqual(learningCalls, []);
  const before = structuredClone(f.calls);
  for (const [route, method, body] of [['sync', 'GET', {}], ['sync/preview', 'POST', { sourceId: ID }], ['sync/stage', 'POST', { sourceId: ID, expectedHash: f.note.hash, expectedHeads: [] }], ['sync/apply', 'POST', { token: TOKEN }]]) {
    await assert.rejects(transport.request(`/api/practice/android-local/android/${route}`, { method, body }), { code: 'ANDROID_UNAVAILABLE' });
  }
  assert.deepEqual(f.calls, before); assert.deepEqual(onlineCalls, []);
  const usage = await transport.request('/api/usage'); assert.ok(usage.budget);
  assert.deepEqual(onlineCalls, [['usage', { context: 'formal' }]]);
  const guide = await transport.request('/api/android/guide'); assert.equal(guide.steps[0].completed, true);
  assert.ok(learningCalls.every(context => context === 'formal')); assert.ok(onlineCalls.includes('settings'));
  assert.ok(!onlineCalls.includes('authorize') && !onlineCalls.includes('request')); assert.equal(network.mock.callCount(), 0);
});

test('queued Android stage freezes caller input and preserves the explicitly reviewed original version', async () => {
  const f = fixture(), transport = createAndroidTransport(f.plugin);
  const body = { sourceId: ID, expectedHash: f.note.hash, expectedHeads: [] };
  const pending = transport.request('/api/android/sync/stage', { method: 'POST', body });
  body.sourceId = OTHER; body.expectedHash = 'unreviewed'; body.expectedHeads.push('unreviewed');
  await pending; assert.equal(f.state.events[0].sourceId, ID); assert.equal(f.state.events[0].value.body, '手机原文');
});
