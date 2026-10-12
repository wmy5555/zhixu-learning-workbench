import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { createService } from '../src/service.mjs';
import { authenticateHistoryEnvelope, receiveHistorySnapshot, snapshotPipePath, verifiedHistoryCapture } from '../src/chatgpt-history-snapshot.mjs';

const tempRoot = path.resolve(import.meta.dirname, '../.tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const conversationId = '6abfb208-eb9c-83ec-8ccc-892a0210ee57';
function snapshot() {
  const units = [
    { index: 0, role: 'user', message_id: 'message_a', created_at: null, content_type: 'text', content: '保留这段原文。', rich_content: null },
    { index: 1, role: 'assistant', message_id: 'message_b', created_at: null, content_type: 'text', content: '这是回答🙂。', rich_content: null },
  ];
  return { version: 1, conversation_id: conversationId, title: '合成历史聊天', branch: 'active',
    snapshot_id: randomBytes(16).toString('hex'), transcript_sha256: createHash('sha256').update(JSON.stringify(units)).digest('hex'),
    units, pages: [
      { range: { start: { message: 0, offset: 0 }, end: { message: 1, offset: 3 } }, hasMore: true },
      { range: { start: { message: 1, offset: 3 }, end: { message: 2, offset: 0 } }, hasMore: false },
    ], coverage: { text: 'complete_visible_active_branch' }, warnings: [], issued_at: Date.now(), expires_at: Date.now() + 60000 };
}
const signed = (reference, payload, key) => ({ payload,
  mac: createHmac('sha256', key).update(reference + '\n' + JSON.stringify(payload)).digest('hex') });
const input = ref => ({ requestId: randomUUID(), historySnapshotRef: ref, summary: '模型生成的独立摘要。',
  structured: { version: 1, items: [{ id: 'item_one', title: '合成候选', body: '待核验的建议。', type: 'knowledge', sourceMessageIds: ['message_b'], uncertainties: ['尚未核验。'] }] } });

test('local snapshot transfer saves exact source and separate unverified candidate; retry is idempotent', async t => {
  const root = fs.mkdtempSync(path.join(tempRoot, 'chatgpt-handoff-'));
  const key = randomBytes(32);
  const service = createService({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'),
    receiveHistorySnapshot: ref => receiveHistorySnapshot(ref, { readAuthKey: async () => Buffer.from(key) }) });
  service.updateSettings({ mcp: { chatgptEnabled: true } });
  const reference = 'zhixu-history-v1:' + randomBytes(32).toString('hex');
  const payload = snapshot();
  const server = createServer(socket => socket.end(JSON.stringify(signed(reference, payload, key))));
  const pipePath = snapshotPipePath(reference);
  if (process.platform !== 'win32') fs.mkdirSync(path.dirname(pipePath), { mode: 0o700 });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(pipePath, resolve); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); if (process.platform !== 'win32') fs.rmdirSync(path.dirname(pipePath)); service.store.db.close(); key.fill(0); assert.ok(root.startsWith(tempRoot + path.sep)); fs.rmSync(root, { recursive: true, force: true }); });
  const request = input(reference);
  const receipt = await service.chatgpt.captureHistorySnapshot(request);
  assert.equal(receipt.status, 'saved'); assert.equal(receipt.complete, true); assert.equal(receipt.importedItems, 1);
  const source = service.store.read(receipt.noteId);
  assert.ok(source.body.includes(payload.units[0].content));
  assert.ok(source.body.includes(payload.units[1].content));
  assert.ok(source.body.includes(request.summary));
  assert.equal(service.store.read(receipt.importedNoteIds[0]).meta.stage, 'candidate');
  assert.equal((await service.chatgpt.captureHistorySnapshot(request)).duplicate, true);
  assert.equal(service.store.records('calls').length, 0);
});

test('tampered text, missing pages, duplicate IDs and expired snapshots fail before a write', () => {
  const reference = 'zhixu-history-v1:' + 'a'.repeat(64);
  const valid = snapshot();
  for (const changed of [
    { ...valid, units: [{ ...valid.units[0], content: '替换原文' }, valid.units[1]] },
    { ...valid, pages: valid.pages.slice(1) },
    { ...valid, units: [valid.units[0], { ...valid.units[1], message_id: 'message_a' }] },
    { ...valid, expires_at: Date.now() - 1 },
    { ...valid, expires_at: valid.issued_at + 5 * 60 * 1000 + 1 },
    { ...valid, issued_at: Date.now() - 6 * 60 * 1000 },
  ]) assert.throws(() => verifiedHistoryCapture(changed, input(reference)));
  assert.throws(() => snapshotPipePath('http://127.0.0.1/private'), { code: 'CHATGPT_HISTORY_REF_INVALID' });
});

test('reader signature binds the complete payload to the private key and exact reference', () => {
  const key = randomBytes(32), ref = 'zhixu-history-v1:' + randomBytes(32).toString('hex');
  const payload = snapshot(), envelope = signed(ref, payload, key);
  assert.deepEqual(authenticateHistoryEnvelope(envelope, ref, key), payload);
  assert.throws(() => authenticateHistoryEnvelope({ ...envelope, payload: { ...payload, title: '伪造标题' } }, ref, key), { code: 'CHATGPT_HISTORY_AUTH' });
  assert.throws(() => authenticateHistoryEnvelope(envelope, 'zhixu-history-v1:' + randomBytes(32).toString('hex'), key), { code: 'CHATGPT_HISTORY_AUTH' });
  assert.throws(() => authenticateHistoryEnvelope(envelope, ref, randomBytes(32)), { code: 'CHATGPT_HISTORY_AUTH' });
  key.fill(0);
});
