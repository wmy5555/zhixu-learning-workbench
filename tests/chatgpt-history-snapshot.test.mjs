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
const conversationId = '11111111-1111-4111-8111-111111111111';
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
const signed = (reference, payload, key, claim) => {
  const boundClaim = { requestId: claim.requestId, inputDigest: claim.inputDigest, nonce: claim.nonce, issuedAt: claim.issuedAt };
  return { claim: boundClaim, payload,
    mac: createHmac('sha256', key).update(reference + '\n' + JSON.stringify({ claim: boundClaim, payload })).digest('hex') };
};
const framed = value => { const body = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)); const header = Buffer.alloc(4); header.writeUInt32LE(body.length); return Buffer.concat([header, body]); };
const item = (id = 'item_one', patch = {}) => ({ id, title: `合成候选 ${id}`, body: `待核验的建议 ${id}。`, type: 'knowledge', sourceMessageIds: ['message_b'], uncertainties: ['尚未核验。'], ...patch });
const input = (ref, patch = {}) => ({ requestId: randomUUID(), historySnapshotRef: ref, summary: '模型生成的独立摘要。',
  structured: { version: 1, items: [item()] }, ...patch });

test('local snapshot transfer saves exact source and separate unverified candidate; retry is idempotent', async t => {
  const root = fs.mkdtempSync(path.join(tempRoot, 'chatgpt-handoff-'));
  const key = randomBytes(32);
  const service = createService({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'),
    receiveHistorySnapshot: (ref, claim) => receiveHistorySnapshot(ref, { readAuthKey: async () => Buffer.from(key), ...claim }) });
  service.updateSettings({ mcp: { chatgptEnabled: true } });
  const reference = 'zhixu-history-v1:' + randomBytes(32).toString('hex');
  const payload = snapshot();
  const server = createServer(socket => {
    let request = '', claim = null, ack = '';
    socket.on('data', chunk => {
      if (!claim) {
        request += chunk.toString('utf8');
        const end = request.indexOf('\n');
        if (end < 0) return;
        claim = JSON.parse(request.slice(0, end));
        socket.write(framed(signed(reference, payload, key, claim)));
        return;
      }
      ack += chunk.toString('utf8');
      if (ack === `ack:${claim.nonce}\n`) socket.end();
    });
  });
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

test('a completed history import retries from its durable receipt after its handoff pipe expires', async t => {
  const root = fs.mkdtempSync(path.join(tempRoot, 'chatgpt-handoff-receipt-'));
  let calls = 0, expired = false;
  const payload = snapshot();
  const service = createService({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'),
    receiveHistorySnapshot: async () => { calls++; if (expired) throw new Error('synthetic expired pipe'); return payload; } });
  service.updateSettings({ mcp: { chatgptEnabled: true } });
  const request = input('zhixu-history-v1:' + randomBytes(32).toString('hex'));
  t.after(() => { service.store.db.close(); assert.ok(root.startsWith(tempRoot + path.sep)); fs.rmSync(root, { recursive: true, force: true }); });
  const first = await service.chatgpt.captureHistorySnapshot(request);
  assert.equal(first.status, 'saved'); assert.equal(calls, 1);
  expired = true;
  const retry = await service.chatgpt.captureHistorySnapshot(request);
  assert.equal(retry.duplicate, true); assert.equal(retry.noteId, first.noteId); assert.equal(calls, 1);
  await assert.rejects(service.chatgpt.captureHistorySnapshot({ ...request, summary: 'changed input' }), { code: 'CHATGPT_REQUEST_CONFLICT' });
  assert.equal(calls, 1);
});

test('a durable history receipt finalizes an interrupted session without reconnecting to an expired pipe', async t => {
  const root = fs.mkdtempSync(path.join(tempRoot, 'chatgpt-handoff-finalize-'));
  let calls = 0, interrupted = false, expired = false;
  const payload = snapshot();
  const service = createService({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'),
    receiveHistorySnapshot: async () => { calls++; if (expired) throw new Error('synthetic expired pipe'); return payload; } });
  service.updateSettings({ mcp: { chatgptEnabled: true } });
  const request = input('zhixu-history-v1:' + randomBytes(32).toString('hex'));
  const store = service.store, put = store.put.bind(store);
  store.put = (namespace, key, value) => {
    if (!interrupted && namespace === 'chatgptSyncSessions' && value.pending === false) { interrupted = true; throw new Error('synthetic finalize interruption'); }
    return put(namespace, key, value);
  };
  t.after(() => { service.store.db.close(); assert.ok(root.startsWith(tempRoot + path.sep)); fs.rmSync(root, { recursive: true, force: true }); });
  await assert.rejects(service.chatgpt.captureHistorySnapshot(request), /synthetic finalize interruption/);
  store.put = put;
  assert.equal(store.records('chatgptSyncSessions')[0].pending, true);
  assert.equal(store.records('chatgptCaptures').length, 1);
  expired = true;
  const retry = await service.chatgpt.captureHistorySnapshot(request);
  assert.equal(retry.duplicate, true); assert.equal(retry.noteId, store.records('chatgptCaptures')[0].noteId);
  assert.equal(store.records('chatgptSyncSessions')[0].pending, false); assert.equal(calls, 1);
});

test('pending history import resumes the exact durable transaction after source, partial candidate, and pre-receipt interruptions', async t => {
  for (const point of ['after-source', 'after-first-candidate', 'before-receipt']) await t.test(point, async t => {
    const root = fs.mkdtempSync(path.join(tempRoot, `chatgpt-handoff-${point}-`)), config = { dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault') };
    let calls = 0, expired = false, service;
    const payload = snapshot(), reference = 'zhixu-history-v1:' + randomBytes(32).toString('hex');
    service = createService({ ...config, receiveHistorySnapshot: async () => { calls++; if (expired) throw new Error('synthetic expired reference'); return payload; } });
    service.updateSettings({ mcp: { chatgptEnabled: true } });
    const structured = point === 'after-source' ? { version: 1, items: [item()] } : { version: 1, items: [item(), item('item_two')] };
    const request = input(reference, { structured }), store = service.store;
    t.after(() => { service.store.db.close(); assert.ok(root.startsWith(tempRoot + path.sep)); fs.rmSync(root, { recursive: true, force: true }); });
    const create = store.create.bind(store), put = store.put.bind(store);
    if (point === 'after-source') {
      store.put = (namespace, key, value) => {
        if (namespace === 'chatgptSyncSessions' && Object.values(value.candidateWrites || {}).some(entry => entry.phase === 'started')) throw new Error('synthetic interruption after source before candidate intent');
        return put(namespace, key, value);
      };
    } else if (point === 'after-first-candidate') {
      store.put = (namespace, key, value) => {
        const phases = Object.values(value.candidateWrites || {}).map(entry => entry.phase);
        if (namespace === 'chatgptSyncSessions' && phases.includes('written') && phases.includes('started')) throw new Error('synthetic interruption after first candidate before second intent');
        return put(namespace, key, value);
      };
    } else {
      store.put = (namespace, key, value) => { if (namespace === 'chatgptCaptures') throw new Error('synthetic interruption before final receipt'); return put(namespace, key, value); };
    }
    const expectedError = point === 'after-source' ? /after source/ : point === 'after-first-candidate' ? /after first candidate/ : /before final receipt/;
    await assert.rejects(service.chatgpt.captureHistorySnapshot(request), expectedError);
    store.create = create; store.put = put;
    const beforeRestart = service.store.list();
    assert.equal(beforeRestart.filter(note => note.kind === 'source').length, 1);
    if (point === 'after-first-candidate' || point === 'before-receipt') assert.equal(beforeRestart.filter(note => note.kind === 'knowledge').length, point === 'after-first-candidate' ? 1 : 2);
    service.store.db.close();
    service = createService({ ...config, receiveHistorySnapshot: async () => { calls++; if (expired) throw new Error('synthetic expired reference'); return payload; } });
    expired = true;
    const resumed = await service.chatgpt.captureHistorySnapshot(request);
    assert.equal(resumed.importedItems, structured.items.length);
    assert.equal(calls, 1, 'expired reference must not be fetched again');
    assert.equal(service.store.list().length, 1 + structured.items.length);
    assert.equal(service.store.records('chatgptCaptures').length, 1);
    assert.equal(service.store.records('chatgptSyncSessions')[0].pending, false);
  });
});

test('pending v2 history import preserves the v1 candidate after its receipt is interrupted and the ref expires', async t => {
  const root = fs.mkdtempSync(path.join(tempRoot, 'chatgpt-handoff-v2-provenance-'));
  const config = { dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault') };
  let calls = 0, service, expiredReference = null;
  const payload = snapshot(), ref1 = 'zhixu-history-v1:' + randomBytes(32).toString('hex'), ref2 = 'zhixu-history-v1:' + randomBytes(32).toString('hex');
  const receive = async ref => { calls++; if (ref === expiredReference) throw new Error('synthetic expired reference'); return payload; };
  service = createService({ ...config, receiveHistorySnapshot: receive });
  service.updateSettings({ mcp: { chatgptEnabled: true } });
  const firstRequest = input(ref1), store = service.store;
  t.after(() => { service.store.db.close(); assert.ok(root.startsWith(tempRoot + path.sep)); fs.rmSync(root, { recursive: true, force: true }); });
  const first = await service.chatgpt.captureHistorySnapshot(firstRequest), candidateId = first.importedNoteIds[0];
  const originalCandidate = store.read(candidateId);
  assert.equal(originalCandidate.meta.chatgptImport.sourceRevision, 1);

  const secondRequest = input(ref2, { summary: 'v2 summary changed', baseRevision: 1 });
  const put = store.put.bind(store);
  store.put = (namespace, key, value) => {
    if (namespace === 'chatgptCaptures' && value.receipt?.syncRevision === 2) throw new Error('synthetic interruption before v2 receipt');
    return put(namespace, key, value);
  };
  await assert.rejects(service.chatgpt.captureHistorySnapshot(secondRequest), /before v2 receipt/);
  store.put = put;
  expiredReference = ref2;
  assert.equal(store.records('chatgptSyncSessions')[0].pending, true);
  assert.equal(store.read(candidateId).hash, originalCandidate.hash);
  service.store.db.close();
  service = createService({ ...config, receiveHistorySnapshot: receive });
  expiredReference = ref2;
  const resumed = await service.chatgpt.captureHistorySnapshot(secondRequest);
  assert.equal(resumed.syncRevision, 2);
  assert.equal(calls, 2, 'restart recovery must use the durable pending snapshot, not the expired ref');
  const candidateAfterResume = service.store.read(candidateId);
  assert.equal(candidateAfterResume.hash, originalCandidate.hash);
  assert.equal(candidateAfterResume.meta.chatgptImport.sourceRevision, 1);
  assert.equal(service.store.records('chatgptSyncSessions')[0].pending, false);
});

test('pending history retry rejects a changed reference or model input before touching the expired pipe', async t => {
  const root = fs.mkdtempSync(path.join(tempRoot, 'chatgpt-handoff-binding-')), config = { dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault') };
  let calls = 0, expired = false;
  const payload = snapshot(), reference = 'zhixu-history-v1:' + randomBytes(32).toString('hex');
  const service = createService({ ...config, receiveHistorySnapshot: async () => { calls++; if (expired) throw new Error('synthetic expired reference'); return payload; } });
  service.updateSettings({ mcp: { chatgptEnabled: true } });
  const request = input(reference), store = service.store, put = store.put.bind(store);
  t.after(() => { service.store.db.close(); assert.ok(root.startsWith(tempRoot + path.sep)); fs.rmSync(root, { recursive: true, force: true }); });
  store.put = (namespace, key, value) => { if (namespace === 'chatgptSyncSessions' && value.sourceWritePhase === 'started') throw new Error('synthetic interruption after pending intent'); return put(namespace, key, value); };
  await assert.rejects(service.chatgpt.captureHistorySnapshot(request), /pending intent/);
  store.put = put; expired = true;
  const changed = [
    { ...request, historySnapshotRef: 'zhixu-history-v1:' + randomBytes(32).toString('hex') },
    { ...request, summary: '不同的整理摘要。' },
    { ...request, structured: { version: 1, items: [item('changed', { body: 'changed' })] } },
    { ...request, baseRevision: 1 },
  ];
  for (const candidate of changed) await assert.rejects(service.chatgpt.captureHistorySnapshot(candidate), { code: 'CHATGPT_REQUEST_CONFLICT' });
  assert.equal(calls, 1);
  const settings = service.settings(); service.updateSettings({ mcp: { chatgptEnabled: false } });
  await assert.rejects(service.chatgpt.captureHistorySnapshot(request), { code: 'CHATGPT_DISABLED' });
  assert.equal(service.store.list().length, 0);
  service.updateSettings({ mcp: { chatgptEnabled: settings.mcp.chatgptEnabled } });
  assert.equal((await service.chatgpt.captureHistorySnapshot(request)).importedItems, 1);
  assert.equal(calls, 1);
});

test('pending history recovery preserves source edits and refuses to recreate deleted source or candidate notes', async t => {
  const run = async (kind, t) => {
    const root = fs.mkdtempSync(path.join(tempRoot, `chatgpt-handoff-protect-${kind}-`)), config = { dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault') };
    let expired = false, service;
    const payload = snapshot(), reference = 'zhixu-history-v1:' + randomBytes(32).toString('hex');
    service = createService({ ...config, receiveHistorySnapshot: async () => { if (expired) throw new Error('synthetic expired reference'); return payload; } });
    service.updateSettings({ mcp: { chatgptEnabled: true } });
    const request = input(reference, { structured: { version: 1, items: [item(), item('item_two')] } });
    const store = service.store, create = store.create.bind(store);
    t.after(() => { service.store.db.close(); assert.ok(root.startsWith(tempRoot + path.sep)); fs.rmSync(root, { recursive: true, force: true }); });
    store.create = value => { if (value.kind === 'knowledge' && (kind === 'edited-candidate' || kind === 'deleted-candidate')) {
      const count = store.list().filter(note => note.kind === 'knowledge').length;
      if (count >= 1) throw new Error('synthetic interruption after first candidate');
    } else if (value.kind === 'knowledge') throw new Error('synthetic interruption after source'); return create(value); };
    await assert.rejects(service.chatgpt.captureHistorySnapshot(request), /synthetic interruption/); store.create = create;
    const source = store.list().find(note => note.kind === 'source'), candidate = store.list().find(note => note.kind === 'knowledge');
    if (kind === 'edited-source') store.update(source.id, { expectedHash: source.hash, body: source.body + '\n\n人工编辑，必须保留。' });
    if (kind === 'deleted-source') store.delete(source.id, source.hash);
    if (kind === 'edited-candidate') store.update(candidate.id, { expectedHash: candidate.hash, body: '人工编辑的候选。' });
    if (kind === 'deleted-candidate') store.delete(candidate.id, candidate.hash);
    service.store.db.close();
    service = createService({ ...config, receiveHistorySnapshot: async () => { if (expired) throw new Error('synthetic expired reference'); return payload; } });
    expired = true;
    const code = kind.includes('source') ? kind === 'edited-source' ? 'CHATGPT_SOURCE_EDITED' : 'CHATGPT_CAPTURE_UNAVAILABLE'
      : kind === 'edited-candidate' ? 'CHATGPT_STRUCTURE_EDITED' : 'CHATGPT_STRUCTURE_CONFLICT';
    await assert.rejects(service.chatgpt.captureHistorySnapshot(request), { code });
    if (kind === 'edited-source') assert.ok(service.store.read(source.id).body.endsWith('人工编辑，必须保留。'));
    if (kind === 'edited-candidate') assert.equal(service.store.read(candidate.id).body, '人工编辑的候选。');
    assert.equal(service.store.records('chatgptCaptures').length, 0);
  };
  for (const kind of ['edited-source', 'deleted-source', 'edited-candidate', 'deleted-candidate']) await t.test(kind, async t => run(kind, t));
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

test('reader signature binds the complete payload, authenticated claim and exact reference', () => {
  const key = randomBytes(32), ref = 'zhixu-history-v1:' + randomBytes(32).toString('hex');
  const claim = { requestId: 'request_12345678', inputDigest: 'a'.repeat(64), nonce: 'b'.repeat(64), issuedAt: Date.now() };
  const payload = snapshot(), envelope = signed(ref, payload, key, claim);
  assert.deepEqual(authenticateHistoryEnvelope(envelope, ref, key, claim), payload);
  assert.throws(() => authenticateHistoryEnvelope({ ...envelope, payload: { ...payload, title: '伪造标题' } }, ref, key, claim), { code: 'CHATGPT_HISTORY_AUTH' });
  assert.throws(() => authenticateHistoryEnvelope(envelope, 'zhixu-history-v1:' + randomBytes(32).toString('hex'), key, claim), { code: 'CHATGPT_HISTORY_AUTH' });
  assert.throws(() => authenticateHistoryEnvelope(envelope, ref, randomBytes(32), claim), { code: 'CHATGPT_HISTORY_AUTH' });
  assert.throws(() => authenticateHistoryEnvelope(envelope, ref, key, { ...claim, requestId: 'different_12345' }), { code: 'CHATGPT_HISTORY_AUTH' });
  key.fill(0);
});
