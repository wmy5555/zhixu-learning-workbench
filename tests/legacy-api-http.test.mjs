import assert from 'node:assert/strict';
import test from 'node:test';

test('unconfigured shared API retains HTTP session, CSRF, credentials and error handling', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (path, init) => {
    calls.push({ path, init });
    if (path === '/api/session') return Response.json({ csrf: 'synthetic-csrf-token' });
    if (init.method === 'PUT') return Response.json({ error: '网页原文已更新', code: 'CONFLICT' }, { status: 409 });
    return Response.json({ notes: [{ id: 'synthetic-source' }], jobs: [] });
  });
  const { api, ApiError } = await import('../public/api.mjs?web-http-contract');
  const payload = { items: [{ title: '合成标题', body: '合成正文' }], process: false };
  assert.equal((await api.import(payload)).notes.length, 1);
  assert.deepEqual(calls.map(call => call.path), ['/api/session', '/api/import']);
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.equal(calls[1].init.credentials, 'same-origin');
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(calls[1].init.headers.get('X-CSRF-Token'), 'synthetic-csrf-token');
  assert.equal(calls[1].init.headers.get('Content-Type'), 'application/json');
  assert.deepEqual(JSON.parse(calls[1].init.body), payload);
  await assert.rejects(api.updateNote('synthetic-source', { body: '新原文', expectedHash: 'old' }), error => error instanceof ApiError && error.code === 'CONFLICT' && error.status === 409 && error.message === '网页原文已更新');
  assert.equal(calls.filter(call => call.path === '/api/session').length, 1);
});
