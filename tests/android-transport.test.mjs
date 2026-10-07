import test from 'node:test';
import assert from 'node:assert/strict';
import { createAndroidTransport } from '../public/android-transport.mjs';

const SOURCE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
let instance = 0;

function source(overrides = {}) {
  return { id: SOURCE_ID, title: '离线原文', body: '保留原文', kind: 'source', hash: 'version-1', meta: { stage: 'reference', privacy: 'local' }, ...overrides };
}

function pluginStub(overrides = {}) {
  const calls = [];
  const implementations = { list: async () => ({ notes: [source()] }), read: async () => ({ note: source() }), save: async () => ({ note: source() }), ...overrides };
  const plugin = Object.fromEntries(Object.entries(implementations).map(([name, implementation]) => [name, async args => {
    calls.push({ name, args });
    return implementation(args);
  }]));
  return { plugin, calls };
}

function rejectFetch(t) {
  return t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected network request'); });
}

async function freshApi(transport) {
  const module = await import(`../public/api.mjs?android-transport-test=${++instance}`);
  if (transport) module.configureLocalTransport(transport);
  return module;
}

function localImport(overrides = {}) {
  return { captureMode: 'text', process: false, research: false, items: [{ title: '离线原文', body: '保留原文', privacy: 'local' }], ...overrides };
}

test('Android text capture saves one local source and passes only supported source metadata', async t => {
  const fetchMock = rejectFetch(t);
  const { plugin, calls } = pluginStub();
  const transport = createAndroidTransport(plugin);
  const item = { title: '离线原文', body: '保留原文', privacy: 'local', platform: '笔记', author: '合成作者', url: 'https://example.com/source', date: '2026-10-07', locator: '第 1 段', apiKey: 'synthetic-unused-field', stage: 'mastered' };
  const result = await transport.request('/api/import', { method: 'POST', body: localImport({ items: [item] }) });
  assert.deepEqual(result, { notes: [source()], jobs: [] });
  assert.deepEqual(calls, [{ name: 'save', args: { title: item.title, body: item.body, meta: { platform: item.platform, author: item.author, url: item.url, date: item.date, locator: item.locator } } }]);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('Android capture rejects processing, research, file batches and nonlocal privacy before native storage', async t => {
  const fetchMock = rejectFetch(t);
  const { plugin, calls } = pluginStub();
  const transport = createAndroidTransport(plugin);
  const bodies = [
    localImport({ process: true }), localImport({ research: true }),
    localImport({ captureMode: 'file' }), localImport({ captureMode: undefined }),
    localImport({ items: [] }), localImport({ items: [source(), source()] }),
    localImport({ items: {} }), localImport({ items: undefined }),
    localImport({ items: [{ title: '原文', body: '正文', privacy: 'external' }] }),
    localImport({ items: [{ title: '原文', body: '正文' }] }),
  ];
  for (const body of bodies) {
    await assert.rejects(transport.request('/api/import', { method: 'POST', body }), { code: 'ANDROID_UNAVAILABLE' });
  }
  assert.deepEqual(calls, []);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('unsupported routes, methods, practice scopes and AI actions never reach native storage or HTTP', async t => {
  const fetchMock = rejectFetch(t);
  const { plugin, calls } = pluginStub();
  const { request, ApiError } = await freshApi(createAndroidTransport(plugin));
  const routes = [
    ['/api/unknown'], ['/api/practice/example/notes'], ['/api/onboarding/state'],
    ['/api/settings'], ['/api/search?q=test'], ['/api/study/start', 'POST'],
    ['/api/ask', 'POST'], [`/api/notes/${SOURCE_ID}/process`, 'POST'],
    [`/api/notes/${SOURCE_ID}/structure`, 'POST'], [`/api/notes/${SOURCE_ID}`, 'DELETE'],
    ['/api/notes/not-an-id'], ['/api/notes', 'POST'], ['/api/import'],
    ['/api/bootstrap', 'PUT'], ['/api/notes#fragment'],
    ['https://example.com/api/notes'], ['//example.com/api/notes'], ['/outside'],
  ];
  for (const [path, method = 'GET'] of routes) {
    await assert.rejects(request(path, { method, body: {} }), error => error instanceof ApiError && error.code === 'ANDROID_UNAVAILABLE');
  }
  assert.deepEqual(calls, []);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('Android bootstrap reports stored source count with no simulated jobs or AI capabilities', async () => {
  const { plugin } = pluginStub({ list: async () => ({ notes: [source(), source({ id: OTHER_ID })] }) });
  const result = await createAndroidTransport(plugin).request('/api/bootstrap');
  assert.equal(result.stats.notes, 2);
  assert.equal(result.notes.length, 2);
  assert.deepEqual(result.jobs, []);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.capabilities, { ai: false, search: false, fetch: false, embedding: false });
  assert.equal(result.settings.ai.enabled, false);
  assert.equal(result.settings.mcp.enabled, false);
});

test('source and library lists forward the decoded query and preserve kind and stage filters', async () => {
  const keep = source();
  const wrongKind = source({ id: OTHER_ID, kind: 'knowledge' });
  const wrongStage = source({ id: OTHER_ID, meta: { stage: 'candidate', privacy: 'local' } });
  const { plugin, calls } = pluginStub({ list: async () => ({ notes: [keep, wrongKind, wrongStage] }) });
  const transport = createAndroidTransport(plugin);
  const query = new URLSearchParams({ q: '原文 + 正文', kind: 'source', stage: 'reference' });
  assert.deepEqual(await transport.request(`/api/notes?${query}`), { notes: [keep] });
  assert.deepEqual(await transport.request(`/api/library?${query}`), { groups: [{ source: keep, children: [], jobs: [] }], standalone: [] });
  assert.deepEqual(calls, [{ name: 'list', args: { q: '原文 + 正文' } }, { name: 'list', args: { q: '原文 + 正文' } }]);
  assert.equal((await transport.request('/api/notes?kind=topic')).notes.length, 0);
  assert.equal((await transport.request('/api/notes')).notes.length, 3);
});

test('source read and edit use the route identity and preserve the expected content version', async () => {
  const saved = source({ title: '已编辑', body: '更新原文', hash: 'version-2' });
  const { plugin, calls } = pluginStub({ save: async () => ({ note: saved }) });
  const transport = createAndroidTransport(plugin);
  assert.deepEqual(await transport.request(`/api/notes/${SOURCE_ID}`), source());
  const payload = { id: OTHER_ID, title: '已编辑', body: '更新原文', expectedHash: 'version-1' };
  assert.deepEqual(await transport.request(`/api/notes/${SOURCE_ID}`, { method: 'PUT', body: payload }), saved);
  assert.deepEqual(calls, [{ name: 'read', args: { id: SOURCE_ID } }, { name: 'save', args: { ...payload, id: SOURCE_ID } }]);
});

test('the shared API initializes Android locally and uses the real source API methods without fetch', async t => {
  const fetchMock = rejectFetch(t);
  const { plugin, calls } = pluginStub();
  const { api, startSession, getApiContext } = await freshApi(createAndroidTransport(plugin));
  assert.deepEqual(await startSession(), { local: true });
  assert.equal(api.runtime.kind, 'android-prototype');
  assert.equal((await api.import(localImport())).notes.length, 1);
  assert.equal((await api.notes({ q: '原文' })).notes.length, 1);
  assert.equal((await api.note(SOURCE_ID)).id, SOURCE_ID);
  assert.equal((await api.updateNote(SOURCE_ID, { body: '新原文', expectedHash: 'version-1' })).id, SOURCE_ID);
  assert.deepEqual(calls.map(call => call.name), ['save', 'list', 'read', 'save']);
  assert.equal(getApiContext().pending, 0);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('native read failures and save conflicts become shared ApiError values and release pending state', async t => {
  const fetchMock = rejectFetch(t);
  const { plugin } = pluginStub({
    read: async () => { throw Object.assign(new Error('原文不存在'), { code: 'NOT_FOUND' }); },
    save: async () => { throw Object.assign(new Error('内容已更新，请重新打开'), { code: 'CONFLICT' }); },
    list: async () => { throw new Error('索引暂不可读'); },
  });
  const { api, ApiError, getApiContext } = await freshApi(createAndroidTransport(plugin));
  await assert.rejects(api.note(SOURCE_ID), error => error instanceof ApiError && error.code === 'NOT_FOUND' && error.message === '原文不存在');
  await assert.rejects(api.updateNote(SOURCE_ID, { body: '新原文', expectedHash: 'old' }), error => error instanceof ApiError && error.code === 'CONFLICT' && error.message === '内容已更新，请重新打开');
  await assert.rejects(api.notes(), error => error instanceof ApiError && error.code === 'LOCAL_STORAGE_FAILED' && error.message === '索引暂不可读');
  assert.equal(getApiContext().pending, 0);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('shared practice context cannot leak an Android operation into the main source library', async t => {
  const fetchMock = rejectFetch(t);
  const { plugin, calls } = pluginStub();
  const { api, request, setApiContext, getApiContext } = await freshApi(createAndroidTransport(plugin));
  setApiContext('practice / example');
  await assert.rejects(api.notes(), { code: 'ANDROID_UNAVAILABLE' });
  await assert.rejects(api.import(localImport()), { code: 'ANDROID_UNAVAILABLE' });
  assert.deepEqual(calls, []);
  assert.equal(getApiContext().pending, 0);
  assert.equal((await request('/api/notes', { scope: 'main' })).notes.length, 1);
  setApiContext('');
  assert.equal((await api.notes()).notes.length, 1);
  assert.equal(calls.length, 2);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('shared local requests keep context busy during writes and reject stale background reads', async () => {
  const pending = [];
  const transport = {
    runtime: { kind: 'android-prototype' }, startSession: async () => ({ local: true }),
    request: (path, options) => new Promise(resolve => pending.push({ path, options, resolve })),
  };
  const { request, setApiContext, getApiContext } = await freshApi(transport);
  setApiContext('practice / example');
  const write = request(`/api/notes/${SOURCE_ID}`, { method: 'PUT', body: { body: '原文' } });
  assert.equal(pending[0].path, `/api/practice/practice%20%2F%20example/notes/${SOURCE_ID}`);
  assert.equal(getApiContext().pending, 1);
  assert.throws(() => setApiContext('other'), { code: 'CONTEXT_BUSY' });
  pending.shift().resolve(source());
  await write;
  assert.equal(getApiContext().pending, 0);
  const read = request(`/api/notes/${SOURCE_ID}`, { background: true });
  assert.equal(getApiContext().pending, 0);
  setApiContext('other');
  pending.shift().resolve(source());
  await assert.rejects(read, { code: 'STALE_CONTEXT' });
});

test('unconfigured shared API retains HTTP session, CSRF, credentials and error handling', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (path, init) => {
    calls.push({ path, init });
    if (path === '/api/session') return Response.json({ csrf: 'synthetic-csrf-token' });
    if (init.method === 'PUT') return Response.json({ error: '网页原文已更新', code: 'CONFLICT' }, { status: 409 });
    return Response.json({ notes: [source()], jobs: [] });
  });
  const { api, ApiError, configureLocalTransport } = await freshApi();
  assert.equal(api.runtime, undefined);
  const payload = localImport();
  assert.equal((await api.import(payload)).notes.length, 1);
  assert.deepEqual(calls.map(call => call.path), ['/api/session', '/api/import']);
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.equal(calls[1].init.credentials, 'same-origin');
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(calls[1].init.headers.get('X-CSRF-Token'), 'synthetic-csrf-token');
  assert.equal(calls[1].init.headers.get('Content-Type'), 'application/json');
  assert.deepEqual(JSON.parse(calls[1].init.body), payload);
  await assert.rejects(api.updateNote(SOURCE_ID, { body: '新原文', expectedHash: 'old' }), error => error instanceof ApiError && error.code === 'CONFLICT' && error.status === 409 && error.message === '网页原文已更新');
  assert.equal(calls.filter(call => call.path === '/api/session').length, 1);
  assert.throws(() => configureLocalTransport(createAndroidTransport(pluginStub().plugin)), /Transport already initialized/);
});

test('local transport setup rejects invalid runtimes and replacement after configuration', async () => {
  const { configureLocalTransport } = await freshApi();
  assert.throws(() => configureLocalTransport({ runtime: { kind: 'other' }, request() {}, startSession() {} }), /Invalid local transport/);
  assert.throws(() => configureLocalTransport({ runtime: { kind: 'android-prototype' }, request() {} }), /Invalid local transport/);
  const transport = createAndroidTransport(pluginStub().plugin);
  configureLocalTransport(transport);
  assert.throws(() => configureLocalTransport(transport), /Transport already initialized/);
});
