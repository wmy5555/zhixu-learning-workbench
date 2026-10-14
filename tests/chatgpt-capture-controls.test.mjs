import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createService } from '../src/service.mjs';
import { createApp } from '../src/server.mjs';
import { createChatgptClient, createChatgptMcpServer } from '../src/mcp-chatgpt.mjs';
import { hash } from '../src/store.mjs';

const temp = path.resolve(import.meta.dirname, '../.tmp');
fs.mkdirSync(temp, { recursive: true });
const value = () => ({ requestId: randomUUID(), title: '合成撤销验收', summary: '独立摘要', coverage: 'visible_history',
  messages: [{ id: 'message_a', role: 'user', content: '合成原文，保留空白。\r\n  第二行🙂。' }],
  sync: { conversationId: 'synthetic_controls', branchId: 'active', snapshotId: 'first', mode: 'snapshot', complete: true,
    readerEvidence: { transcriptSha256: 'a'.repeat(64), pages: [{ range: { start: { message: 0, offset: 0 }, end: { message: 1, offset: 0 } }, hasMore: false }] } } });
async function fixture(t, extra = {}) {
  const root = fs.mkdtempSync(path.join(temp, 'capture-controls-'));
  const config = { dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'), scheduler: false };
  const service = createService({ ...config, ...extra });
  service.updateSettings({ mcp: { chatgptEnabled: true } });
  const app = createApp({ ...config, service });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const token = fs.readFileSync(path.join(config.dataDir, 'chatgpt-mcp-token'), 'utf8').trim();
  const sessionResponse = await fetch(base + '/api/session'), session = await sessionResponse.json();
  const cookie = sessionResponse.headers.get('set-cookie').split(';')[0];
  const request = async (route, body, headers = {}) => {
    const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  const local = (route, body) => request('/api/capture-undo' + route, body, { Cookie: cookie, 'X-CSRF-Token': session.csrf });
  const mcpServer = createChatgptMcpServer({ client: createChatgptClient({ env: { LEARNING_BASE_URL: base, LEARNING_CHATGPT_MCP_TOKEN: token } }) });
  const client = new Client({ name: 'synthetic-controls', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([mcpServer.connect(b), client.connect(a)]);
  t.after(async () => { await client.close(); await mcpServer.close(); await app.close(); assert.ok(root.startsWith(temp + path.sep)); fs.rmSync(root, { recursive: true, force: true }); });
  return { service, client, request, local, token, cookie, config };
}

test('MCP can preview one receipt but only the local session and CSRF confirmation can execute undo and restore', async t => {
  const f = await fixture(t), input = value(), saved = f.service.chatgpt.capture(input);
  const before = f.service.store.readPersisted(saved.noteId).hash;
  const tools = (await f.client.listTools()).tools.map(item => item.name);
  assert.ok(tools.includes('preview_chatgpt_capture_undo')); assert.ok(!tools.some(name => /confirm/.test(name)));
  const preview = (await f.client.callTool({ name: 'preview_chatgpt_capture_undo', arguments: { requestId: input.requestId, noteId: saved.noteId, syncRevision: 1, confirm: true } })).structuredContent;
  assert.equal(preview.requiresLocalConfirmation, true);
  assert.equal(f.service.store.readPersisted(saved.noteId).hash, before);
  assert.equal((await f.request('/api/chatgpt/undo-confirm', { previewId: preview.previewId, confirm: true }, { Authorization: `Bearer ${f.token}` })).status, 404);
  assert.equal((await f.request('/api/capture-undo/confirm', { previewId: preview.previewId }, { Authorization: `Bearer ${f.token}` })).status, 401);
  assert.equal((await f.request('/api/capture-undo/confirm', { previewId: preview.previewId }, { Cookie: f.cookie })).status, 403);
  const undone = await f.local('/confirm', { previewId: preview.previewId });
  assert.equal(undone.body.status, 'undone'); assert.equal(f.service.store.row(saved.noteId), undefined);
  assert.equal((await f.local('/confirm', { previewId: preview.previewId })).body.status, 'already_undone');
  const restore = await f.local('/restore-preview', { undoId: undone.body.undoId });
  assert.equal((await f.local('/restore-confirm', { previewId: restore.body.previewId })).body.status, 'restored');
  assert.equal(f.service.store.readPersisted(saved.noteId).hash, before);
  const listed = await f.local('');
  assert.ok(listed.body.requests.length >= 2);
  assert.ok(!JSON.stringify(listed.body).includes(input.messages[0].content));
  assert.ok(!JSON.stringify(listed.body).includes(f.config.vaultDir));
});

test('a recycled revision number cannot make an old request verify a later generation', async t => {
  const f = await fixture(t), original = value(), first = f.service.chatgpt.capture(original);
  const oldInput = { ...original, requestId: randomUUID(), summary: '旧的第二版摘要', sync: { ...original.sync, baseRevision: 1 } };
  const old = f.service.chatgpt.capture(oldInput);
  const preview = f.service.chatgpt.previewUndo({ requestId: oldInput.requestId, noteId: old.noteId, syncRevision: 2 });
  assert.equal((await f.local('/confirm', { previewId: preview.previewId })).body.status, 'undone');
  const next = f.service.chatgpt.capture({ ...original, requestId: randomUUID(), summary: '另一份新的第二版摘要', sync: { ...original.sync, baseRevision: first.syncRevision } });
  assert.equal(next.syncRevision, 2); assert.notEqual(next.verification.source.rawSha256, old.verification.source.rawSha256);
  const repeat = f.service.chatgpt.capture(oldInput);
  assert.equal(repeat.verification.status, 'historical_receipt'); assert.equal(repeat.verification.messageFingerprints, undefined);
});

test('disabling capture after preview blocks confirmation and does not change files', async t => {
  const f = await fixture(t), input = value(), saved = f.service.chatgpt.capture(input);
  const preview = f.service.chatgpt.previewUndo({ requestId: input.requestId, noteId: saved.noteId, syncRevision: 1 });
  f.service.updateSettings({ mcp: { chatgptEnabled: false } });
  const result = await f.local('/confirm', { previewId: preview.previewId });
  assert.equal(result.status, 403); assert.equal(result.body.code, 'CHATGPT_DISABLED');
  assert.equal(f.service.store.readPersisted(saved.noteId).hash, saved.verification.source.rawSha256);
});

test('SDK batch tool persists over 200 messages and returns a fresh aggregate without enabling knowledge reads', async t => {
  const units = Array.from({ length: 201 }, (_, index) => ({ index, role: index % 2 ? 'assistant' : 'user', message_id: 'batch_message_' + index,
    created_at: null, content_type: 'text', content: `合成分批原文 ${index}。`, rich_content: null }));
  const snapshot = { version: 1, conversation_id: randomUUID(), title: '合成批次', branch: 'active', snapshot_id: randomBytes(16).toString('hex'),
    units, transcript_sha256: hash(JSON.stringify(units)), pages: [{ range: { start: { message: 0, offset: 0 }, end: { message: units.length, offset: 0 } }, hasMore: false }],
    coverage: { text: 'complete_visible_active_branch', attachment_bytes: 'not_read' }, warnings: [], issued_at: Date.now(), expires_at: Date.now() + 60000 };
  let receives = 0;
  const f = await fixture(t, { receiveHistorySnapshot: async () => { receives++; return snapshot; } });
  const args = { requestId: randomUUID(), historySnapshotRef: 'zhixu-history-v1:' + 'b'.repeat(64), summary: '独立批次摘要' };
  const saved = (await f.client.callTool({ name: 'import_chatgpt_history_batch', arguments: args })).structuredContent;
  assert.equal(saved.status, 'saved'); assert.equal(saved.complete, true); assert.equal(saved.partCount, 2);
  assert.equal(saved.verification.reader.transcriptSha256, snapshot.transcript_sha256);
  assert.equal(saved.verification.text.verifiedParts, 2); assert.equal(f.service.settings().mcp.chatgptAllowRead, false);
  const repeated = (await f.client.callTool({ name: 'import_chatgpt_history_batch', arguments: args })).structuredContent;
  assert.equal(repeated.status, 'already_saved'); assert.equal(receives, 1);
  const invalid = await f.request('/api/chatgpt/history-batches', { ...args, requestId: randomUUID(), baseRevision: 1 }, { Authorization: `Bearer ${f.token}` });
  assert.equal(invalid.status, 400);
  assert.throws(() => f.service.chatgpt.capture({ ...value(), requestId: args.requestId }), { code: 'CHATGPT_REQUEST_CONFLICT' });
});
