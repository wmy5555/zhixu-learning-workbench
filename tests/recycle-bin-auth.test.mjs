import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { createApp } from '../src/server.mjs';
import { createRecycleBin } from '../src/recycle-bin.mjs';
import { decodeFile, writeAttachment, attachmentPath } from '../src/attachments.mjs';

const tempRoot = path.resolve(import.meta.dirname, '../.tmp');
fs.mkdirSync(tempRoot, { recursive: true });
async function fixture(t, purgeToken = '') {
  const root = fs.mkdtempSync(path.join(tempRoot, 'purge-auth-'));
  const app = createApp({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'), scheduler: false, purgeToken });
  t.after(async () => { await app.close(); fs.rmSync(root, { recursive: true, force: true }); });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const session = await fetch(base + '/api/session'), sessionBody = await session.json();
  const headers = { Cookie: session.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': sessionBody.csrf, 'Content-Type': 'application/json' };
  const req = async (url, method = 'GET', body, token, extra = {}) => {
    const response = await fetch(base + url, { method, headers: { ...headers, ...(token ? { 'X-Zhixu-Purge-Token': token } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  return { app, root, req, sessionBody };
}
function recycled(store) {
  const file = decodeFile({ name: 'synthetic.png', mime: 'image/png', bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGZkAAAAASUVORK5CYII=', 'base64') });
  writeAttachment(store.vaultDir, file);
  const note = store.create({ kind: 'source', title: 'synthetic purge fixture', body: 'synthetic original', meta: { attachments: [file.descriptor] } });
  store.delete(note.id, note.hash);
  return { note, filePath: attachmentPath(store.vaultDir, file.descriptor.id) };
}
function snapshot(store) {
  const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : [[path.relative(store.vaultDir, path.join(dir, entry.name)), fs.readFileSync(path.join(dir, entry.name)).toString('base64')]]);
  return { list: createRecycleBin(store).list(), history: store.db.prepare('SELECT * FROM versions ORDER BY rowid').all(),
    claims: ['deleted', 'fileRecovery', 'recyclePurge', 'attachmentUploads'].map(namespace => [namespace, store.records(namespace)]), files: files(store.vaultDir) };
}

test('purge defaults disabled even with a self-issued session, CSRF, confirmation and current revision', async t => {
  const { app, req } = await fixture(t), store = app.service.store;
  const { note } = recycled(store), before = snapshot(store), preview = (await req('/api/recycle-bin')).body;
  const denied = await req('/api/recycle-bin', 'DELETE', { confirmed: true, revision: preview.revision }, randomBytes(32).toString('base64url'));
  assert.equal(denied.status, 403); assert.equal(denied.body.code, 'RECYCLE_PURGE_DISABLED'); assert.deepEqual(snapshot(store), before);
  assert.equal(preview.purgeEnabled, false);
  // Ordinary settings cannot enable or replace the separate runtime capability.
  await req('/api/settings', 'PUT', { purgeToken: randomBytes(32).toString('base64url'), purgeEnabled: true });
  assert.equal((await req('/api/recycle-bin')).body.purgeEnabled, false);
  assert.equal((await req('/api/recycle-bin/' + note.id + '/restore', 'POST', { versionId: preview.items[0].versionId })).status, 200);
});

test('owner capability protects normalized main and practice purge, retains scope checks and does not leak', async t => {
  const token = randomBytes(32).toString('base64url'), { app, root, req, sessionBody } = await fixture(t, token), store = app.service.store;
  const { note, filePath } = recycled(store), before = snapshot(store), preview = (await req('/api/recycle-bin')).body;
  assert.equal(preview.purgeEnabled, true);
  for (const url of ['/api/recycle-bin', '/api//recycle-bin/', '/api/%72ecycle-bin']) {
    for (const wrong of [undefined, randomBytes(32).toString('base64url')]) {
      const denied = await req(url, 'DELETE', { confirmed: true, revision: preview.revision }, wrong);
      assert.equal(denied.status, 403); assert.equal(denied.body.code, 'RECYCLE_PURGE_UNAUTHORIZED'); assert.deepEqual(snapshot(store), before);
    }
  }
  for (const file of ['mcp-token', 'chatgpt-mcp-token']) {
    const otherCapability = fs.readFileSync(path.join(root, 'data', file), 'utf8').trim();
    assert.equal((await req('/api/recycle-bin', 'DELETE', { confirmed: true, revision: preview.revision }, otherCapability)).status, 403);
  }
  const leaked = JSON.stringify([sessionBody, preview, (await req('/api/settings')).body, (await req('/api/bootstrap')).body]);
  assert.equal(leaked.includes(token), false);
  assert.equal((await req('/api/recycle-bin', 'DELETE', { confirmed: true, revision: preview.revision }, token, { 'X-CSRF-Token': '' })).status, 403);
  assert.equal((await req('/api/recycle-bin', 'DELETE', { confirmed: true, revision: 'stale' }, token)).status, 409);
  assert.equal((await req('/api/recycle-bin', 'DELETE', { revision: preview.revision }, token)).body.code, 'RECYCLE_CONFIRM_REQUIRED');
  const practice = (await req('/api/onboarding/start', 'POST', {})).body;
  app.service.updateSettings({ ai: { enabled: true } }); app.onboarding.tested('model');
  const prefix = '/api/practice/' + practice.practiceId;
  const lease = app.onboarding.acquire(practice.practiceId, { resource: 'recycle-bin', method: 'GET', query: {} });
  try {
    const entry = recycled(lease.service.store), pBefore = snapshot(lease.service.store), pList = (await req(prefix + '/recycle-bin')).body;
    assert.equal((await req(prefix + '//%72ecycle-bin/', 'DELETE', { confirmed: true, revision: pList.revision })).status, 403);
    assert.deepEqual(snapshot(lease.service.store), pBefore);
    assert.equal((await req(prefix + '/recycle-bin', 'DELETE', { confirmed: true, revision: pList.revision }, token)).status, 200);
    assert.equal(lease.service.store.history(entry.note.id).length, 0); assert.equal(fs.existsSync(entry.filePath), false);
    assert.deepEqual(snapshot(store), before);
  } finally { lease.release(); }
  const cleared = await req('/api/recycle-bin', 'DELETE', { confirmed: true, revision: preview.revision }, token);
  assert.equal(cleared.status, 200); assert.equal(cleared.body.cleared, 1); assert.equal(store.history(note.id).length, 0); assert.equal(fs.existsSync(filePath), false);
});

test('pending physical cleanup still requires owner authorization', async t => {
  const token = randomBytes(32).toString('base64url'), { app, req } = await fixture(t, token), store = app.service.store;
  recycled(store); const bin = createRecycleBin(store), unlink = fs.unlinkSync;
  fs.unlinkSync = file => { if (file.endsWith('.raw')) throw Object.assign(new Error('synthetic busy'), { code: 'EBUSY' }); return unlink(file); };
  try { assert.throws(() => bin.clear({ confirmed: true, revision: bin.list().revision }), { code: 'EBUSY' }); } finally { fs.unlinkSync = unlink; }
  const before = snapshot(store); assert.equal(before.list.pendingCleanup, 1);
  assert.equal((await req('/api/recycle-bin', 'DELETE', { confirmed: true, revision: before.list.revision })).status, 403);
  assert.deepEqual(snapshot(store), before);
  assert.equal((await req('/api/recycle-bin', 'DELETE', { confirmed: true, revision: before.list.revision }, token)).status, 200);
  assert.equal(bin.list().pendingCleanup, 0);
});

test('invalid owner configuration fails before creating data or starting a server', () => {
  for (const purgeToken of [null, 'short', ' '.repeat(43), 'x'.repeat(129)]) assert.throws(() => createApp({ purgeToken }), /LEARNING_PURGE_TOKEN/);
});

test('browser API sends owner credential only in the request header, never body or request events', async t => {
  const originalFetch = globalThis.fetch, originalWindow = globalThis.window, originalEvent = globalThis.CustomEvent;
  t.after(() => { globalThis.fetch = originalFetch; globalThis.window = originalWindow; globalThis.CustomEvent = originalEvent; });
  const sent = [], events = [], token = randomBytes(32).toString('base64url');
  globalThis.window = { dispatchEvent: event => events.push(event.detail) };
  globalThis.CustomEvent = class { constructor(type, { detail }) { this.detail = detail; } };
  globalThis.fetch = async (url, options = {}) => {
    sent.push({ url, options });
    return new Response(JSON.stringify(url === '/api/session' ? { csrf: 'synthetic-csrf' } : { cleared: 1 }), { headers: { 'Content-Type': 'application/json' } });
  };
  const { api } = await import('../public/api.mjs?purge-owner-test');
  await api.clearRecycleBin('synthetic-revision', token);
  assert.equal(sent.length, 2);
  const call = sent[1]; assert.equal(call.url, '/api/recycle-bin'); assert.equal(call.options.headers.get('X-Zhixu-Purge-Token'), token);
  assert.deepEqual(JSON.parse(call.options.body), { confirmed: true, revision: 'synthetic-revision' });
  assert.equal(JSON.stringify(events).includes(token), false);
});
