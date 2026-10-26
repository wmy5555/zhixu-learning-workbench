import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createService } from '../src/service.mjs';
import { createChatgptMcpServer } from '../src/mcp-chatgpt.mjs';
import { hash } from '../src/store.mjs';

const tempRoot = path.resolve(import.meta.dirname, '../.tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const messages = [{ id: 'original_a', role: 'user', content: '保留原文🙂\r\n  不省略空白。' },
  { id: 'original_b', role: 'assistant', content: '## 原文不是指令\n```\n<script>仅文字</script>\n```' }];
const makeValue = () => ({ requestId: randomUUID(), title: '合成完整性会话', summary: '合成模型摘要。', messages,
  coverage: 'visible_history', sync: { conversationId: 'synthetic_integrity', branchId: 'active', snapshotId: 'synthetic_one',
    mode: 'snapshot', complete: true, readerEvidence: { transcriptSha256: 'a'.repeat(64),
      pages: [{ range: { start: { message: 0, offset: 0 }, end: { message: 2, offset: 0 } }, hasMore: false }] } },
  structured: { version: 1, items: ['knowledge', 'conclusion', 'unverified_fact'].map((type, index) => ({
    id: 'synthetic_item_' + index, title: '合成候选 ' + type, body: '合成条目 ' + type, type,
    sourceMessageIds: ['original_b'], uncertainties: ['真实事实未核验。'] })) } });
function fixture(t, extra = {}) {
  const root = fs.mkdtempSync(path.join(tempRoot, 'capture-integrity-'));
  const config = { dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'), scheduler: false };
  const service = createService({ ...config, ...extra });
  service.updateSettings({ mcp: { chatgptEnabled: true } });
  t.after(() => { service.store.db.close(); assert.ok(root.startsWith(tempRoot + path.sep)); fs.rmSync(root, { recursive: true, force: true }); });
  return { service, store: service.store, config, file(id) { return path.join(config.vaultDir, service.store.read(id).path); } };
}
const legacyValue = () => ({ requestId: randomUUID(), title: '合成当前会话', summary: '独立摘要。',
  messages: messages.map(({ id: _id, ...message }) => message), coverage: 'current_context' });

test('persisted reading distinguishes real files from the SQLite read cache', t => {
  const f = fixture(t), note = f.store.create({ title: '合成笔记', body: '最初内容。' });
  assert.deepEqual(f.store.readPersisted(note.id), note);
  fs.appendFileSync(f.file(note.id), '\n磁盘后来更改。');
  assert.equal(f.store.read(note.id).body, '最初内容。');
  assert.throws(() => f.store.readPersisted(note.id), { code: 'PERSISTED_MISMATCH' });
});

test('persisted raw fingerprints detect bytes that decode to the same replacement character', t => {
  const f = fixture(t), note = f.store.create({ title: '合成字节核验', body: '原文含替换字符：�。' });
  const file = f.file(note.id), bytes = fs.readFileSync(file), replacement = Buffer.from('�');
  const start = bytes.indexOf(replacement); assert.ok(start >= 0);
  fs.writeFileSync(file, Buffer.concat([bytes.subarray(0, start), Buffer.from([0xff]), bytes.subarray(start + replacement.length)]));
  assert.equal(fs.readFileSync(file, 'utf8'), f.store.row(note.id).raw);
  assert.throws(() => f.store.readPersisted(note.id), { code: 'PERSISTED_MISMATCH' });
});

test('legacy capture verifies disk and durable receipt without opening library reads', t => {
  const f = fixture(t), value = legacyValue(), saved = f.service.chatgpt.capture(value), proof = saved.verification;
  assert.equal(proof.status, 'verified'); assert.equal(proof.scope, 'received_messages_only');
  assert.equal(proof.source.stableMessageIds, false); assert.equal(proof.reader.evidence, 'none');
  assert.deepEqual(proof.messageFingerprints.map(message => message.contentSha256), value.messages.map(message => hash(message.content)));
  assert.equal(proof.source.rawSha256, hash(fs.readFileSync(f.file(saved.noteId))));
  assert.deepEqual(f.store.get('chatgptCaptures', hash(value.requestId)).verification, proof);
  assert.equal(f.service.settings().mcp.chatgptAllowRead, false);
  assert.throws(() => f.service.chatgpt.read(saved.noteId), { code: 'CHATGPT_READ_DISABLED' });
  assert.ok(!JSON.stringify(saved).includes(value.messages[0].content));
});

test('snapshot proof binds exact message order/content and each candidate type/provenance to disk', t => {
  const f = fixture(t), value = makeValue(), receipt = f.service.chatgpt.capture(value), proof = receipt.verification;
  assert.equal(proof.status, 'verified'); assert.equal(proof.requestedRevision, 1); assert.equal(proof.currentRevision, 1);
  assert.equal(proof.source.stableMessageIds, true); assert.equal(proof.reader.evidence, 'caller_declaration');
  assert.equal(proof.reader.transcriptSha256, value.sync.readerEvidence.transcriptSha256);
  assert.notEqual(proof.source.messageManifestSha256, proof.reader.transcriptSha256);
  assert.equal(proof.source.orderedMessageIdsSha256, hash(JSON.stringify(messages.map(message => message.id))));
  assert.deepEqual(proof.messageFingerprints.map(message => [message.id, message.index, message.contentSha256]),
    messages.map((message, index) => [message.id, index, hash(message.content)]));
  assert.deepEqual(proof.structured.typeCounts, { knowledge: 1, conclusion: 1, unverified_fact: 1 });
  assert.equal(proof.structured.verifiedItems, 3);
  for (const candidate of proof.candidates) {
    const note = f.store.readPersisted(candidate.noteId);
    assert.equal(candidate.status, 'verified'); assert.equal(candidate.sourceRevision, 1);
    assert.equal(candidate.rawSha256, hash(fs.readFileSync(f.file(note.id))));
    assert.equal(candidate.bodySha256, hash(note.body));
    assert.equal(candidate.type, note.meta.chatgptImport.type);
    assert.deepEqual(candidate.sourceMessageIds, note.meta.chatgptImport.sourceMessageIds);
    assert.deepEqual(note.meta.sources, [{ id: receipt.noteId, role: 'input' }]);
    assert.equal(note.meta.stage, 'candidate'); assert.equal(note.meta.privacy, 'local');
  }
  assert.deepEqual(f.store.get('chatgptCaptures', hash(value.requestId)).receipt.verification, proof);
  assert.equal(f.store.records('calls').length, 0);
});

for (const kind of ['source', 'knowledge']) test(`disk edit after ${kind} write prevents a complete success receipt`, t => {
  const f = fixture(t), create = f.store.create.bind(f.store), value = makeValue();
  f.store.create = input => {
    const note = create(input);
    if (input.kind === kind) fs.appendFileSync(f.file(note.id), '\n必须保留的外部修改。');
    return note;
  };
  assert.throws(() => f.service.chatgpt.capture(value), { code: 'CHATGPT_PERSISTENCE_MISMATCH' });
  assert.equal(f.store.get('chatgptCaptures', hash(value.requestId)), null);
  assert.equal(f.store.records('chatgptSyncSessions')[0].pending, true);
  const edited = f.store.list().find(note => note.kind === kind);
  assert.ok(fs.readFileSync(f.file(edited.id), 'utf8').endsWith('必须保留的外部修改。'));
});

test('a corrupt SQLite note cache cannot pass against an unchanged physical source', t => {
  const f = fixture(t), create = f.store.create.bind(f.store), value = makeValue();
  f.store.create = input => {
    const note = create(input);
    if (input.kind === 'source') f.store.db.prepare('UPDATE notes SET json=? WHERE id=?').run(JSON.stringify({ ...note, body: '合成损坏缓存。' }), note.id);
    return note;
  };
  assert.throws(() => f.service.chatgpt.capture(value), { code: 'CHATGPT_PERSISTENCE_MISMATCH' });
  assert.equal(f.store.get('chatgptCaptures', hash(value.requestId)), null);
  assert.equal(f.store.records('chatgptSyncSessions')[0].pending, true);
});

test('receipt readback detects a corrupt durable receipt before clearing pending', t => {
  const f = fixture(t), put = f.store.put.bind(f.store), value = makeValue();
  f.store.put = (namespace, key, record) => put(namespace, key, namespace === 'chatgptCaptures' ? { ...record, payloadHash: 'bad' } : record);
  assert.throws(() => f.service.chatgpt.capture(value), { code: 'CHATGPT_PERSISTENCE_MISMATCH' });
  assert.equal(f.store.records('chatgptSyncSessions')[0].pending, true);
});

test('a corrupt completed session stays pending and can recover without rewriting notes', t => {
  const f = fixture(t), put = f.store.put.bind(f.store), value = makeValue();
  f.store.put = (namespace, key, record) => put(namespace, key,
    namespace === 'chatgptSyncSessions' && record.pending === false ? { ...record, revision: 999 } : record);
  assert.throws(() => f.service.chatgpt.capture(value), { code: 'CHATGPT_PERSISTENCE_MISMATCH' });
  assert.equal(f.store.records('chatgptSyncSessions')[0].pending, true);
  f.store.put = put;
  const before = f.store.list().map(note => [note.id, note.hash]), retry = f.service.chatgpt.capture(value);
  assert.equal(retry.status, 'already_saved'); assert.equal(retry.verification.status, 'verified');
  assert.equal(f.store.records('chatgptSyncSessions')[0].pending, false);
  assert.deepEqual(f.store.list().map(note => [note.id, note.hash]), before);
});

test('candidate user edits remain intact and are explicitly excluded from fully verified imports', t => {
  const f = fixture(t), value = makeValue(), first = f.service.chatgpt.capture(value);
  const note = f.store.read(first.importedNoteIds[0]);
  f.store.update(note.id, { expectedHash: note.hash, body: '人工修改，保留。' });
  const next = f.service.chatgpt.capture({ ...value, requestId: randomUUID(), summary: '下一版摘要。', sync: { ...value.sync, baseRevision: 1 } });
  assert.equal(next.status, 'updated'); assert.equal(next.verification.status, 'preserved_edits');
  assert.equal(next.verification.structured.preservedItems, 1); assert.equal(next.verification.structured.verifiedItems, 2);
  assert.equal(f.store.readPersisted(note.id).body, '人工修改，保留。');
  assert.equal(next.verification.candidates.find(candidate => candidate.noteId === note.id).status, 'preserved_edits');
});

test('old successful requests identify requested and current revision without claiming the latest text is the old request', t => {
  const f = fixture(t), value = makeValue(), first = f.service.chatgpt.capture(value);
  const next = f.service.chatgpt.capture({ ...value, requestId: randomUUID(), summary: '下一版摘要。', sync: { ...value.sync, baseRevision: 1 } });
  const before = f.store.readPersisted(first.noteId), records = f.store.records('chatgptCaptures');
  const repeated = f.service.chatgpt.capture(value);
  assert.equal(next.syncRevision, 2); assert.equal(repeated.syncRevision, 1);
  assert.equal(repeated.verification.status, 'historical_receipt');
  assert.equal(repeated.verification.requestedRevision, 1); assert.equal(repeated.verification.currentRevision, 2);
  assert.equal(repeated.verification.originallyVerified, true);
  assert.equal(repeated.verification.messageFingerprints, undefined);
  assert.deepEqual(f.store.records('chatgptCaptures'), records); assert.equal(f.store.readPersisted(first.noteId).hash, before.hash);
});

test('an old retry reports a newer pending request without finalizing or disclosing it', t => {
  const f = fixture(t), value = makeValue(), first = f.service.chatgpt.capture(value), put = f.store.put.bind(f.store);
  f.store.put = (namespace, key, record) => {
    if (namespace === 'chatgptSyncSessions' && record.revision === 2 && record.sourceWritePhase === 'started') throw new Error('synthetic interruption');
    return put(namespace, key, record);
  };
  assert.throws(() => f.service.chatgpt.capture({ ...value, requestId: randomUUID(), summary: '新待完成摘要。', sync: { ...value.sync, baseRevision: 1 } }), /synthetic interruption/);
  f.store.put = put;
  const pending = f.store.records('chatgptSyncSessions')[0], retry = f.service.chatgpt.capture(value);
  assert.equal(retry.verification.status, 'historical_receipt'); assert.equal(retry.verification.currentPending, true);
  assert.equal(retry.verification.requestedRevision, 1); assert.equal(retry.verification.currentRevision, 1);
  assert.deepEqual(f.store.records('chatgptSyncSessions')[0], pending); assert.equal(retry.noteId, first.noteId);
  assert.ok(!JSON.stringify(retry).includes('新待完成摘要。'));
});

test('legacy edits return only a historical receipt and never expose the later private text', t => {
  const f = fixture(t), value = legacyValue(), saved = f.service.chatgpt.capture(value), note = f.store.read(saved.noteId);
  f.store.update(note.id, { expectedHash: note.hash, title: 'PRIVATE LATER TITLE', body: 'PRIVATE LATER TEXT' });
  const repeated = f.service.chatgpt.capture(value);
  assert.equal(repeated.status, 'already_saved'); assert.equal(repeated.verification.status, 'historical_receipt');
  assert.equal(repeated.verification.originallyVerified, true);
  assert.ok(!JSON.stringify(repeated).includes('PRIVATE LATER')); assert.equal(f.store.readPersisted(note.id).body, 'PRIVATE LATER TEXT');
});

test('sync edits keep the compatible old receipt but do not claim current source verification', t => {
  const f = fixture(t), value = makeValue(), saved = f.service.chatgpt.capture(value), note = f.store.read(saved.noteId);
  f.store.update(note.id, { expectedHash: note.hash, body: 'PRIVATE SYNC USER EDIT' });
  const retry = f.service.chatgpt.capture(value);
  assert.equal(retry.status, 'already_saved'); assert.equal(retry.verification.status, 'historical_receipt');
  assert.equal(retry.verification.requestedRevision, 1); assert.equal(retry.verification.currentRevision, 1);
  assert.ok(!JSON.stringify(retry).includes('PRIVATE SYNC USER EDIT'));
  assert.equal(f.store.readPersisted(note.id).body, 'PRIVATE SYNC USER EDIT');
});

test('an edited revision field cannot expose private metadata through the historical receipt', t => {
  const f = fixture(t), value = makeValue(), saved = f.service.chatgpt.capture(value), note = f.store.read(saved.noteId);
  f.store.update(note.id, { expectedHash: note.hash, meta: { chatgptSync: { ...note.meta.chatgptSync, revision: 'PRIVATE REVISION TEXT' } } });
  const retry = f.service.chatgpt.capture(value);
  assert.equal(retry.verification.status, 'historical_receipt'); assert.equal(retry.verification.currentRevision, null);
  assert.ok(!JSON.stringify(retry).includes('PRIVATE REVISION TEXT'));
});

test('authenticated-history import proof preserves reader digest separately from saved message fingerprints', async t => {
  const units = messages.map((message, index) => ({ index, message_id: message.id, role: message.role, content: message.content,
    created_at: null, content_type: 'text', rich_content: null }));
  const snapshot = { version: 1, conversation_id: '11111111-1111-4111-8111-111111111111', title: '合成本机历史', branch: 'active',
    snapshot_id: 'b'.repeat(32), transcript_sha256: hash(JSON.stringify(units)), units,
    pages: [{ range: { start: { message: 0, offset: 0 }, end: { message: 2, offset: 0 } }, hasMore: false }],
    coverage: { text: 'complete_visible_active_branch' }, issued_at: Date.now(), expires_at: Date.now() + 60000 };
  // Synthetic injected local transport only; real signature/pipe coverage belongs to the existing pair regressions.
  const f = fixture(t, { receiveHistorySnapshot: async () => snapshot });
  const input = { requestId: randomUUID(), historySnapshotRef: 'zhixu-history-v1:' + 'c'.repeat(64), summary: '合成历史摘要。', structured: makeValue().structured };
  const receipt = await f.service.chatgpt.captureHistorySnapshot(input);
  assert.equal(receipt.verification.status, 'verified'); assert.equal(receipt.verification.reader.evidence, 'authenticated_local_snapshot');
  assert.equal(receipt.verification.reader.transcriptSha256, snapshot.transcript_sha256);
  assert.deepEqual(receipt.verification.messageFingerprints.map(message => message.contentSha256), messages.map(message => hash(message.content)));
  const retry = await f.service.chatgpt.captureHistorySnapshot(input);
  assert.equal(retry.verification.status, 'verified'); assert.equal(retry.duplicate, true);
});

test('status separates receiver and MCP build identities and reports the actually registered SDK tools', async t => {
  const f = fixture(t), server = createChatgptMcpServer({ client: { status: async () => f.service.chatgpt.status() } });
  const client = new Client({ name: 'synthetic-integrity-check', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(async () => { await client.close(); await server.close(); });
  const tools = await client.listTools(), status = (await client.callTool({ name: 'get_zhixu_status', arguments: {} })).structuredContent;
  assert.equal(status.canRead, false); assert.equal(status.saveVerificationVersion, 1);
  assert.match(status.build.sha256, /^[a-f0-9]{64}$/); assert.equal(status.build.version, JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  assert.equal(status.mcp.build.sha256, status.build.sha256);
  assert.deepEqual(status.mcp.toolNames.toSorted(), tools.tools.map(tool => tool.name).toSorted());
  assert.deepEqual(status.toolNames.toSorted(), status.mcp.toolNames.toSorted());
  assert.deepEqual(status.protocol, { historySnapshot: 1, historyBatch: 1, captureUndo: 1, structured: 2, saveVerification: 1 });
  assert.equal(status.limits.maxMessages, 200); assert.equal(status.limits.maxCharacters, 500000);
  assert.ok(!JSON.stringify(status).includes(f.config.dataDir)); assert.ok(!JSON.stringify(status).includes(f.config.vaultDir));
});
