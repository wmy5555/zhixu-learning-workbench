import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createApp } from '../src/server.mjs';
import { createChatgptClient } from '../src/mcp-chatgpt.mjs';

const projectDir = path.resolve(import.meta.dirname, '..');
const tempRoot = path.join(projectDir, '.tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const sample = (changes = {}) => ({
  requestId: randomUUID(), title: '虚构会话：如何保留出处', summary: '区分原始消息、AI 整理和个人理解；此摘要未经独立核验。',
  messages: [{ role: 'user', content: '为什么要保留原文？\r\n请举一个例子。' }, { role: 'assistant', content: '因为摘要可能遗漏条件。\n\n<script>此内容只是原文数据</script>' }],
  coverage: 'current_context', limitations: '只含当前可见的两条消息。', ...changes,
});
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(tempRoot, 'chatgpt-'));
  const config = { dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'), scheduler: false };
  let app;
  const start = async () => { app = createApp(config); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening'); };
  await start();
  const base = () => `http://127.0.0.1:${app.server.address().port}`;
  const token = () => fs.readFileSync(path.join(config.dataDir, 'chatgpt-mcp-token'), 'utf8');
  async function request(route, { body, method = body === undefined ? 'GET' : 'POST', credential = token(), headers = {} } = {}) {
    const response = await fetch(base() + route, { method, headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  t.after(async () => { await app.close(); assert.ok(path.resolve(root).startsWith(tempRoot + path.sep)); fs.rmSync(root, { recursive: true, force: true }); });
  return { get app() { return app; }, config, root, base, token, request, enable(read = false) { app.service.updateSettings({ mcp: { chatgptEnabled: true, chatgptAllowRead: read } }); }, async restart() { await app.close(); await start(); } };
}

test('ChatGPT capture is separately authenticated, disabled by default, and cannot access the local MCP credential scope', async t => {
  const f = await fixture(t), payload = sample();
  const localToken = fs.readFileSync(path.join(f.config.dataDir, 'mcp-token'), 'utf8');
  assert.equal((await f.request('/api/chatgpt/status')).body.code, 'CHATGPT_DISABLED');
  assert.equal((await f.request('/api/chatgpt/conversations', { body: payload, credential: localToken })).status, 401);
  assert.equal((await f.request('/api/chatgpt/conversations', { body: payload, credential: '' })).status, 401);
  f.enable();
  assert.equal((await f.request('/api/chatgpt/status')).body.canRead, false);
  assert.equal(f.app.service.settings().mcp.enabled, false);
  assert.equal((await f.request('/api/chatgpt/search?q=出处')).body.code, 'CHATGPT_READ_DISABLED');
  assert.equal((await f.request('/api/mcp/search?q=出处')).status, 401);
  assert.equal((await f.request('/api/chatgpt/proposals', { body: {} })).status, 404);
  assert.equal((await f.request('/api/chatgpt/conversations', { body: payload, headers: { Origin: 'https://chatgpt.com' } })).body.code, 'ORIGIN_DENIED');
  const wrongHost = await new Promise((resolve, reject) => {
    const req = http.get(f.base() + '/api/chatgpt/status', { headers: { Host: 'attacker.invalid', Authorization: `Bearer ${f.token()}` } }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve(JSON.parse(text)));
    }); req.on('error', reject);
  });
  assert.equal(wrongHost.code, 'HOST_DENIED');
  assert.equal(f.app.service.store.list().length, 0);
});

test('ChatGPT HTTP calls never prove that the separate local MCP channel is connected', async t => {
  const f = await fixture(t); f.enable(true);
  const state = () => f.app.onboarding.state().externalConnections.mcp;
  assert.equal(state().status, 'pending');
  assert.equal((await f.request('/api/chatgpt/status')).status, 200);
  const saved = await f.request('/api/chatgpt/conversations', { body: sample() });
  assert.equal(saved.status, 201);
  assert.equal((await f.request('/api/chatgpt/search?q=出处')).status, 200);
  assert.deepEqual(state(), { status: 'pending', lastSeenAt: null, operations: [] });
  f.app.service.updateSettings({ mcp: { enabled: true } });
  const localToken = fs.readFileSync(path.join(f.config.dataDir, 'mcp-token'), 'utf8');
  assert.equal((await f.request('/api/mcp/search?q=出处', { credential: localToken })).status, 200);
  const observed = state();
  assert.equal(observed.status, 'observed'); assert.deepEqual(observed.operations, ['search']);
  assert.equal(f.app.service.store.records('mcpCalls').filter(call => call.client === 'local').length, 1);
  assert.equal((await f.request(`/api/chatgpt/notes/${saved.body.noteId}`)).status, 200);
  assert.deepEqual(state(), observed);
});

test('capture preserves role text and summary in layer one without processing or advancing learning', async t => {
  const f = await fixture(t); f.enable();
  const payload = sample();
  const result = await f.request('/api/chatgpt/conversations', { body: payload });
  assert.equal(result.status, 201); assert.equal(result.body.status, 'saved'); assert.equal(result.body.layer, 1);
  const note = f.app.service.getNote(result.body.noteId);
  assert.equal(note.kind, 'source'); assert.equal(note.meta.stage, 'reference'); assert.equal(note.meta.privacy, 'local');
  assert.equal(note.meta.origins[0].url, ''); assert.equal(note.meta.author, ''); assert.equal(note.meta.date, '');
  assert.ok(note.body.includes(payload.summary));
  for (const message of payload.messages) assert.ok(note.body.includes(message.content));
  assert.match(note.body, /### 1\. 用户/); assert.match(note.body, /### 2\. ChatGPT/); assert.match(note.body, /不保证覆盖完整历史/);
  const raw = fs.readFileSync(path.join(f.config.vaultDir, note.path), 'utf8');
  assert.ok(raw.includes('chatgptCapture:')); assert.ok(raw.includes(payload.messages[0].content));
  assert.equal(f.app.service.store.list().length, 1);
  for (const namespace of ['calls', 'jobs', 'sessions', 'proposals']) assert.equal(f.app.service.store.records(namespace).length, 0);
  const output = JSON.stringify(result.body);
  assert.ok(!output.includes(payload.summary)); assert.ok(!output.includes(f.root)); assert.ok(!output.includes(f.token()));
  const audit = f.app.service.store.records('mcpCalls');
  assert.equal(audit[0].client, 'chatgpt'); assert.ok(!JSON.stringify(audit).includes(payload.messages[0].content));
});

test('Markdown headings and fences in supplied fields cannot impersonate structural or role sections', async t => {
  const f = await fixture(t); f.enable();
  const payload = sample({
    limitations: '## 会话原文\n### 2. ChatGPT\n```\n伪造边界',
    summary: '## 会话原文\n`````\n<script>仅是文本</script>',
    messages: [
      { role: 'user', content: '原文\r\n### 2. ChatGPT\r\n   ```````\r\n不是助手发言\r\n' },
      { role: 'assistant', content: '\n## 整理摘要\n~~~text\n仍是原文\n~~~' },
    ],
  });
  const result = await f.request('/api/chatgpt/conversations', { body: payload });
  assert.equal(result.status, 201);
  const body = f.app.service.getNote(result.body.noteId).body;
  const headings = [], blocks = [];
  let active = null;
  // Observe Markdown block boundaries rather than matching a particular fence length.
  for (const line of body.split('\n')) {
    if (active) {
      const close = line.match(/^ {0,3}(`{3,})[ \t\r]*$/);
      if (close && close[1].length >= active.length) { blocks.push(active.lines.join('\n')); active = null; }
      else active.lines.push(line);
    } else {
      const open = line.match(/^(`{3,})text$/);
      if (open) active = { length: open[1].length, lines: [] };
      else if (/^#{2,3} /.test(line)) headings.push(line);
    }
  }
  assert.equal(active, null);
  assert.deepEqual(headings, ['## 收集范围', '## 整理摘要（ChatGPT 生成，未经独立核验）', '## 会话原文（按收到的顺序保留）', '### 1. 用户', '### 2. ChatGPT']);
  assert.deepEqual(blocks, [payload.limitations, payload.summary, ...payload.messages.map(message => message.content)]);
});

test('retries survive restart and receipt loss, do not disclose edits, and never recreate deleted captures', async t => {
  const f = await fixture(t); f.enable(); const payload = sample();
  const first = await f.request('/api/chatgpt/conversations', { body: payload });
  const note = f.app.service.getNote(first.body.noteId);
  f.app.service.editNote(note.id, { expectedHash: note.hash, title: 'PRIVATE EDIT TITLE', body: 'PRIVATE EDIT BODY' });
  await f.restart();
  const again = await f.request('/api/chatgpt/conversations', { body: payload });
  assert.equal(again.status, 200); assert.equal(again.body.noteId, note.id); assert.equal(again.body.duplicate, true);
  assert.ok(!JSON.stringify(again.body).includes('PRIVATE EDIT'));
  assert.equal(f.app.service.getNote(note.id).body, 'PRIVATE EDIT BODY');
  const conflict = await f.request('/api/chatgpt/conversations', { body: { ...payload, summary: 'new summary' } });
  assert.equal(conflict.status, 409); assert.equal(conflict.body.code, 'CHATGPT_REQUEST_CONFLICT');
  f.app.service.store.db.exec("DELETE FROM records WHERE namespace='chatgptCaptures'");
  assert.equal((await f.request('/api/chatgpt/conversations', { body: payload })).body.code, 'CHATGPT_CAPTURE_UNVERIFIABLE');
  const edited = f.app.service.getNote(note.id);
  assert.equal(edited.body, 'PRIVATE EDIT BODY');
  f.app.service.editNote(note.id, { expectedHash: edited.hash, title: note.title, body: note.body });
  const recovered = await f.request('/api/chatgpt/conversations', { body: payload });
  assert.equal(recovered.body.noteId, note.id); assert.equal(recovered.body.duplicate, true);
  const differentId = await f.request('/api/chatgpt/conversations', { body: { ...payload, requestId: randomUUID() } });
  assert.equal(differentId.body.noteId, note.id); assert.equal(f.app.service.store.list().length, 1);
  f.app.service.store.delete(note.id, f.app.service.getNote(note.id).hash);
  assert.equal((await f.request('/api/chatgpt/conversations', { body: payload })).body.code, 'CHATGPT_CAPTURE_UNAVAILABLE');
  assert.equal(f.app.service.store.list().length, 0);
});

test('invalid roles, hidden instructions fields, excessive input and forged source URLs cannot write a capture', async t => {
  const f = await fixture(t); f.enable();
  for (const patch of [
    { messages: [{ role: 'system', content: 'hidden' }] }, { privacy: 'cloud' }, { process: true }, { messages: [] },
    { title: ' ' }, { messages: [{ role: 'user', content: ' ' }] },
    { conversationUrl: 'https://attacker.invalid/c/123' }, { conversationUrl: 'https://chatgpt.com/c/123?token=private' },
    { conversationUrl: 'https://user:pass@chatgpt.com/c/123' }, { conversationUrl: 'file:///private' },
    { messages: Array.from({ length: 5 }, () => ({ role: 'user', content: '汉'.repeat(110000) })) },
  ]) {
    const result = await f.request('/api/chatgpt/conversations', { body: sample(patch) });
    assert.ok([400, 413].includes(result.status), JSON.stringify(patch).slice(0, 100));
  }
  const large = await f.request('/api/chatgpt/conversations', { body: ' '.repeat(2 * 1024 * 1024 + 1) });
  assert.equal(large.status, 413);
  assert.equal(f.app.service.store.list().length, 0);
});

test('ChatGPT read grant exposes bounded content, can be revoked immediately, and does not grant provider externalization', async t => {
  const f = await fixture(t); f.enable(true);
  const note = f.app.service.importItems({ items: [{ title: '合成读书出处', body: '出处'.repeat(15000), privacy: 'local' }] }).notes[0];
  const found = await f.request('/api/chatgpt/search?q=出处');
  assert.equal(found.body.results[0].id, note.id); assert.ok(found.body.results[0].excerpt.length <= 500);
  assert.ok(!JSON.stringify(found.body).includes(f.root));
  const part = await f.request(`/api/chatgpt/sources/${note.id}?limit=100`);
  assert.equal(part.body.body.length, 100); assert.equal(part.body.nextOffset, 100);
  const rest = await f.request(`/api/chatgpt/notes/${note.id}?offset=100&limit=20000`);
  assert.equal(rest.body.body, note.body.slice(100, 20100));
  assert.equal((await f.request(`/api/chatgpt/notes/${note.id}?limit=20001`)).status, 400);
  assert.equal(f.app.service.store.outboundPrivacy(note), 'local');
  assert.equal(f.app.service.store.records('calls').length, 0);
  f.enable(false);
  assert.equal((await f.request(`/api/chatgpt/notes/${note.id}`)).body.code, 'CHATGPT_READ_DISABLED');
  assert.equal((await f.request('/api/chatgpt/conversations', { body: sample() })).status, 201);
  f.app.service.updateSettings({ mcp: { chatgptEnabled: false } });
  assert.equal((await f.request('/api/chatgpt/conversations', { body: sample() })).body.code, 'CHATGPT_DISABLED');
});

test('official SDK discovers the ChatGPT tools and stores a real temporary Markdown source through stdio and HTTP', async t => {
  const f = await fixture(t); f.enable(true);
  const env = { PATH: process.env.PATH || '', SystemRoot: process.env.SystemRoot || '', LEARNING_BASE_URL: f.base(), LEARNING_DATA_DIR: f.config.dataDir };
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(projectDir, 'src/mcp-chatgpt.mjs')], cwd: projectDir, env, stderr: 'pipe' });
  let stderr = ''; transport.stderr.on('data', chunk => { stderr += chunk; });
  const client = new Client({ name: 'zhixu-chatgpt-test', version: '0.1.0' });
  await client.connect(transport); t.after(() => client.close());
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['get_zhixu_status', 'save_chatgpt_conversation', 'search_knowledge', 'read_note', 'read_source', 'related_knowledge'].sort());
  assert.equal(tools.find(tool => tool.name === 'save_chatgpt_conversation').annotations.readOnlyHint, false);
  assert.equal(tools.find(tool => tool.name === 'save_chatgpt_conversation').annotations.idempotentHint, true);
  const call = async (name, args = {}) => client.callTool({ name, arguments: args });
  const status = await call('get_zhixu_status'); assert.equal(status.structuredContent.canRead, true);
  const payload = sample(), saved = await call('save_chatgpt_conversation', payload);
  assert.equal(saved.isError, undefined); assert.equal(saved.structuredContent.status, 'saved');
  const id = saved.structuredContent.noteId;
  const read = await call('read_source', { id }); assert.ok(read.structuredContent.body.includes(payload.summary));
  assert.equal((await call('read_note', { id, limit: 10 })).structuredContent.body.length, 10);
  assert.equal((await call('search_knowledge', { query: '出处' })).structuredContent.results[0].id, id);
  assert.deepEqual((await call('related_knowledge', { id })).structuredContent.notes, []);
  f.enable(false); assert.equal((await call('read_source', { id })).isError, true);
  assert.equal((await call('save_chatgpt_conversation', payload)).structuredContent.duplicate, true);
  assert.ok(!stderr.includes(f.token())); assert.ok(!JSON.stringify(saved).includes(f.token()));
  await client.close();
});

test('ChatGPT bridge rejects remote credential destinations and refuses redirects', async () => {
  for (const base of ['https://example.org', 'http://127.0.0.1@evil.invalid', 'http://localhost/other', 'http://127.0.0.1/?x=1']) assert.throws(() => createChatgptClient({ env: { LEARNING_BASE_URL: base } }));
  let inspected;
  const client = createChatgptClient({ env: { LEARNING_CHATGPT_MCP_TOKEN: 'synthetic-test-credential' }, fetchImpl: async (url, options) => { inspected = { url: String(url), options }; return new Response('{}'); } });
  await client.status(); assert.equal(inspected.url, 'http://127.0.0.1:4318/api/chatgpt/status'); assert.equal(inspected.options.redirect, 'error');
});

test('partial settings updates and restarts cannot restore an old ChatGPT read grant', async t => {
  const f = await fixture(t); f.enable(true);
  const id = (await f.request('/api/chatgpt/conversations', { body: sample() })).body.noteId;
  const read = () => f.request(`/api/chatgpt/notes/${id}`);
  assert.equal((await read()).status, 200);
  f.app.service.updateSettings({ mcp: { chatgptEnabled: false } });
  assert.equal(f.app.service.store.get('settings', 'main').mcp.chatgptAllowRead, false);
  await f.restart();
  f.app.service.updateSettings({ mcp: { chatgptEnabled: true } });
  assert.equal((await read()).body.code, 'CHATGPT_READ_DISABLED');
  f.app.service.updateSettings({ mcp: { chatgptEnabled: false, chatgptAllowRead: true } });
  assert.equal(f.app.service.settings().mcp.chatgptAllowRead, false);
  const saved = f.app.service.store.get('settings', 'main');
  f.app.service.store.put('settings', 'main', { ...saved, mcp: { ...saved.mcp, chatgptAllowRead: true } });
  await f.restart();
  assert.equal(f.app.service.settings().mcp.chatgptAllowRead, false);
  f.app.service.updateSettings({ mcp: { chatgptEnabled: true } });
  assert.equal((await read()).body.code, 'CHATGPT_READ_DISABLED');
  f.app.service.updateSettings({ mcp: { chatgptAllowRead: true } });
  assert.equal((await read()).status, 200);
});

test('practice settings cannot enable ChatGPT and malformed permission values cannot grant access', async t => {
  const f = await fixture(t);
  assert.throws(() => f.app.service.updateSettings({ mcp: { chatgptAllowRead: 'true' } }));
  const state = f.app.onboarding.start();
  const lease = f.app.onboarding.acquire(state.practiceId, { resource: 'settings', method: 'PUT', query: {} });
  try { assert.throws(() => lease.service.updateSettings({ mcp: { chatgptEnabled: true, chatgptAllowRead: true } }), error => error.code === 'PRACTICE_SETTINGS_LOCKED'); } finally { lease.release(); }
  assert.equal(f.app.service.settings().mcp.chatgptEnabled, false);
});

test('capture recovers after an audit failure without leaking internal errors or duplicating the stored source', async t => {
  const f = await fixture(t); f.enable();
  const payload = sample(), store = f.app.service.store, original = store.put.bind(store);
  store.put = (namespace, ...args) => { if (namespace === 'mcpCalls') throw new Error(`PRIVATE-PATH ${f.root}`); return original(namespace, ...args); };
  const failed = await f.request('/api/chatgpt/conversations', { body: payload });
  assert.equal(failed.status, 500); assert.equal(failed.body.code, 'CHATGPT_OPERATION_FAILED'); assert.ok(!JSON.stringify(failed.body).includes(f.root));
  store.put = original;
  const retry = await f.request('/api/chatgpt/conversations', { body: payload });
  assert.equal(retry.body.duplicate, true); assert.equal(store.list().length, 1);
});

test('receipt recovery rejects copied identities, duplicate files, and unverifiable timestamps', async t => {
  const f = await fixture(t); f.enable(); const payload = sample();
  const first = f.app.service.chatgpt.capture(payload), store = f.app.service.store;
  const note = store.read(first.noteId);
  store.create({ kind: 'source', title: note.title, body: note.body, meta: note.meta });
  store.db.exec("DELETE FROM records WHERE namespace='chatgptCaptures'");
  assert.throws(() => f.app.service.chatgpt.capture(payload), { code: 'CHATGPT_CAPTURE_AMBIGUOUS' });
  store.delete(note.id, store.read(note.id).hash);
  assert.throws(() => f.app.service.chatgpt.capture(payload), { code: 'CHATGPT_CAPTURE_UNVERIFIABLE' });
  assert.equal(store.list().length, 1);
  const nextPayload = sample({ summary: '另一份原文' }), next = f.app.service.chatgpt.capture(nextPayload);
  const original = store.read(next.noteId), originalPath = path.join(f.config.vaultDir, original.path);
  const copyPath = path.join(path.dirname(originalPath), 'synthetic-duplicate.md');
  fs.copyFileSync(originalPath, copyPath);
  store.db.exec("DELETE FROM records WHERE namespace='chatgptCaptures'");
  assert.throws(() => f.app.service.chatgpt.capture(nextPayload), { code: 'CHATGPT_CAPTURE_UNAVAILABLE' });
  fs.unlinkSync(copyPath); store.scan();
  const current = store.read(original.id);
  store.update(current.id, { expectedHash: current.hash, meta: { chatgptCapture: { ...current.meta.chatgptCapture, savedAt: new Date(Date.now() + 86400000).toISOString() } } });
  assert.throws(() => f.app.service.chatgpt.capture(nextPayload), { code: 'CHATGPT_CAPTURE_UNVERIFIABLE' });
  const future = store.read(current.id);
  store.update(future.id, { expectedHash: future.hash, meta: { chatgptCapture: null } });
  const editedRaw = fs.readFileSync(originalPath, 'utf8').replace(/^id: .*$/m, 'id: externally-renamed-identity');
  fs.writeFileSync(originalPath, editedRaw);
  assert.throws(() => f.app.service.chatgpt.capture(nextPayload), { code: 'CHATGPT_CAPTURE_UNAVAILABLE' });
  assert.equal(fs.readFileSync(originalPath, 'utf8'), editedRaw);
  const upperPath = path.join(path.dirname(originalPath), path.basename(originalPath).toUpperCase());
  assert.ok(path.resolve(upperPath).startsWith(path.resolve(f.config.vaultDir) + path.sep));
  fs.renameSync(originalPath, upperPath);
  assert.throws(() => f.app.service.chatgpt.capture(nextPayload), { code: 'CHATGPT_CAPTURE_UNAVAILABLE' });
  assert.equal(fs.readFileSync(upperPath, 'utf8'), editedRaw);
});

test('external capture timestamps cannot consume the service rate limit', async t => {
  const f = await fixture(t); f.enable();
  const store = f.app.service.store, list = store.list.bind(store);
  store.list = () => Array.from({ length: 30 }, (_, i) => ({ id: `external-${i}`, kind: 'source', meta: { chatgptCapture: { version: 1, requestHash: 'a'.repeat(64), payloadHash: 'b'.repeat(64), savedAt: '2999-01-01T00:00:00.000Z' } } }));
  try { assert.equal(f.app.service.chatgpt.capture(sample()).status, 'saved'); }
  finally { store.list = list; }
});

test('capture rate limit counts new write attempts, permits retries, and expires without trusting Markdown', async t => {
  const f = await fixture(t); f.enable(); const payload = sample();
  const realNow = Date.now; let timestamp = realNow(); Date.now = () => timestamp;
  try {
    const first = f.app.service.chatgpt.capture(payload);
    for (let i = 1; i < 30; i++) f.app.service.chatgpt.capture(sample({ summary: `新快照 ${i}` }));
    assert.throws(() => f.app.service.chatgpt.capture(sample({ summary: 'over limit' })), error => error.code === 'CHATGPT_RATE_LIMIT');
    assert.equal(f.app.service.chatgpt.capture(payload).noteId, first.noteId);
    timestamp += 61000;
    assert.equal(f.app.service.chatgpt.capture(sample({ summary: 'after window' })).status, 'saved');
  } finally { Date.now = realNow; }
});
