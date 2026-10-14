import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import test from 'node:test';
import { Store } from '../src/store.mjs';
import { createHistoryBatchStore } from '../src/chatgpt-history-batch-store.mjs';
import { planHistoryBatch } from '../src/chatgpt-history-batch.mjs';

const tempRoot = path.resolve(import.meta.dirname, '../.tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const hash = value => createHash('sha256').update(value).digest('hex');
const jsonHash = value => hash(JSON.stringify(value));
const copy = value => JSON.parse(JSON.stringify(value));
function snapshot(contents = ['合成问题。', '合成回答。']) {
  const units = contents.map((content, index) => ({ index, role: index % 2 ? 'assistant' : 'user',
    message_id: 'actual_original_' + index, created_at: null, content_type: 'text', content, rich_content: null }));
  const timestamp = Date.now();
  return { version: 1, conversation_id: '11111111-1111-4111-8111-111111111111', title: '合成实际入库快照', branch: 'active',
    snapshot_id: 'e'.repeat(32), transcript_sha256: jsonHash(units), units,
    pages: [{ range: { start: { message: 0, offset: 0 }, end: { message: units.length, offset: 0 } }, hasMore: false }],
    coverage: { text: 'complete_visible_active_branch', attachment_bytes: 'not_read', other_branches: 'excluded' },
    warnings: ['所有数据均为独立临时合成资料。'], issued_at: timestamp, expires_at: timestamp + 60000 };
}
const input = extra => ({ requestId: randomUUID(), historySnapshotRef: 'zhixu-history-v1:' + 'c'.repeat(64), summary: '独立合成摘要。', ...extra });
const binding = value => ({ referenceHash: hash(value.historySnapshotRef), inputDigest: jsonHash([value.summary, value.structured ?? null, value.baseRevision ?? null]) });
const structured = () => ({ version: 1, items: ['knowledge', 'conclusion', 'unverified_fact'].map((type, index) => ({
  id: 'original_item_' + index, title: '合成未核验候选 ' + type, body: '保留候选正文：' + type,
  type, sourceMessageIds: ['actual_original_0', 'actual_original_1'], uncertainties: ['尚未外部事实核验。', '保留全部分片来源。'],
})) });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(tempRoot, 'history-batch-store-'));
  const config = { dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault') };
  let store = new Store(config), current = store, allowed = true;
  const factory = () => createHistoryBatchStore({ getStore: () => current, enabled: () => allowed });
  t.after(() => { store.close(); assert.ok(path.resolve(root).startsWith(tempRoot + path.sep)); fs.rmSync(root, { recursive: true, force: true }); });
  return { get store() { return store; }, batch: factory(), config,
    file(id) { return path.join(config.vaultDir, store.read(id).path); },
    restart() { store.close(); store = new Store(config); current = store; this.batch = factory(); },
    disable() { allowed = false; }, switchContext() { current = {}; },
  };
}

test('actual disk and SQLite verify over-200-message independent parts without a cumulative session', async t => {
  const f = fixture(t), source = snapshot(Array.from({ length: 201 }, (_, index) => `实际合成消息 ${index}`)), request = input();
  assert.equal(await f.batch.findRetry(request), null);
  const saved = await f.batch.capture(source, request, binding(request));
  assert.equal(saved.status, 'saved'); assert.equal(saved.complete, true); assert.equal(saved.textComplete, true);
  assert.equal(saved.partCount, 2); assert.equal(saved.verifiedSources, 2); assert.equal(saved.messageCount, 201);
  assert.equal(saved.undo.supported, false); assert.equal(saved.undo.leafUndoAllowed, false);
  assert.equal(saved.verification.reader.evidence, 'authenticated_local_snapshot');
  assert.equal(saved.verification.reader.transcriptSha256, source.transcript_sha256);
  assert.equal(f.store.records('chatgptSyncSessions').length, 0); assert.equal(f.store.records('chatgptCaptures').length, 0);
  const fragments = saved.sourceIds.flatMap(id => {
    const note = f.store.readPersisted(id, { includeRaw: true });
    const proof = saved.verification.sources.find(proof => proof.noteId === id);
    assert.equal(note.meta.privacy, 'local'); assert.equal(note.meta.stage, 'reference');
    assert.equal(proof.rawSha256, hash(fs.readFileSync(f.file(id)))); assert.equal(proof.bodySha256, hash(note.body));
    assert.equal(note.meta.chatgptHistoryBatchPart.part.global.branchId, 'active');
    assert.equal(f.store.get('chatgptHistoryBatchLeaves', id).undoSupported, false);
    return note.meta.chatgptHistoryBatchPart.part.fragments;
  });
  assert.deepEqual(fragments.map(fragment => fragment.messageId), source.units.map(unit => unit.message_id));
  assert.deepEqual(fragments.map(fragment => fragment.content), source.units.map(unit => unit.content));
  assert.equal(f.store.get('chatgptCaptureRate', 'recent').length, 1);
  assert.ok(!JSON.stringify(saved).includes(source.units[0].content));
});

test('a >120000 character original message keeps its stable ID, offsets and exact literal source text', async t => {
  const f = fixture(t), text = 'a'.repeat(119999) + '🙂\r\n```text\n**原样保留**\n```  \n' + 'z'.repeat(120010);
  const source = snapshot([text]), request = input(), saved = await f.batch.capture(source, request, binding(request));
  assert.equal(saved.complete, true); assert.equal(saved.messageCount, 1);
  const fragments = saved.sourceIds.flatMap(id => f.store.readPersisted(id).meta.chatgptHistoryBatchPart.part.fragments);
  assert.equal(fragments.map(fragment => fragment.content).join(''), text);
  assert.equal(new Set(fragments.map(fragment => fragment.messageId)).size, 1);
  assert.equal(fragments[0].charEnd, 119999); assert.equal(fragments[1].charStart, 119999);
  assert.ok(fragments.every(fragment => fragment.content.length <= 120000));
  for (const id of saved.sourceIds) assert.ok(f.store.readPersisted(id).body.includes('```text'));
});

test('>500000 characters and all three cross-part candidate types persist with complete sources and uncertainties', async t => {
  const f = fixture(t), source = snapshot(['x'.repeat(520000), '最终合成结论。']);
  const request = input({ structured: structured() }), saved = await f.batch.capture(source, request, binding(request));
  assert.equal(saved.complete, true); assert.equal(saved.textComplete, true); assert.equal(saved.partCount, 2);
  assert.equal(saved.expectedCandidates, 3); assert.equal(saved.verifiedCandidates, 3);
  assert.deepEqual(saved.verification.structured.typeCounts, { knowledge: 1, conclusion: 1, unverified_fact: 1 });
  for (const proof of saved.verification.candidates) {
    const note = f.store.readPersisted(proof.noteId), marker = note.meta.chatgptHistoryBatchImport;
    assert.equal(note.kind, 'knowledge'); assert.equal(note.meta.stage, 'candidate'); assert.equal(note.meta.privacy, 'local');
    assert.equal(proof.type, marker.type); assert.equal(proof.provenanceVerified, true);
    assert.deepEqual(marker.sourceMessageIds, ['actual_original_0', 'actual_original_1']);
    assert.deepEqual(marker.sourceNoteIds, saved.sourceIds); assert.deepEqual(note.meta.sources.map(value => value.id), saved.sourceIds);
    assert.equal(marker.sourceLocations[0].parts.length, 2);
    assert.equal(marker.sourceLocations[0].parts.at(-1).ranges.at(-1).end, 520000);
    assert.deepEqual(marker.item.uncertainties, request.structured.items[0].uncertainties);
    assert.equal(proof.itemSha256, jsonHash(marker.item)); assert.equal(proof.rawSha256, hash(fs.readFileSync(f.file(proof.noteId))));
  }
  assert.equal(f.store.records('calls').length, 0); assert.equal(f.store.records('tasks').length, 0);
});

test('completed request retries after restart and original snapshot expiry without new transport or rate usage', async t => {
  const f = fixture(t), source = snapshot(), request = input();
  const saved = await f.batch.capture(source, request, binding(request));
  const bytes = saved.sourceIds.map(id => fs.readFileSync(f.file(id)));
  f.restart();
  t.mock.method(Date, 'now', () => source.expires_at + 600000);
  const retried = await f.batch.findRetry(request);
  assert.equal(retried.status, 'already_saved'); assert.equal(retried.complete, true);
  assert.deepEqual(retried.sourceIds, saved.sourceIds); assert.equal(f.store.list().length, saved.sourceIds.length);
  assert.equal(f.store.get('chatgptCaptureRate', 'recent').length, 1);
  assert.deepEqual(saved.sourceIds.map(id => fs.readFileSync(f.file(id))), bytes);
});

test('changed reference, summary, structure or provided authentication binding conflicts without touching data', async t => {
  const f = fixture(t), source = snapshot(), request = input({ structured: structured() });
  const saved = await f.batch.capture(source, request, binding(request)), before = saved.sourceIds.map(id => fs.readFileSync(f.file(id)));
  for (const patch of [ { summary: '已更改的摘要。' }, { historySnapshotRef: 'zhixu-history-v1:' + 'd'.repeat(64) },
    { structured: { ...structured(), items: structured().items.slice(0, 1) } } ]) {
    await assert.rejects(f.batch.findRetry({ ...request, ...patch }), { code: 'CHATGPT_REQUEST_CONFLICT' });
  }
  await assert.rejects(f.batch.capture(source, request, { ...binding(request), inputDigest: 'a'.repeat(64) }), { code: 'CHATGPT_REQUEST_CONFLICT' });
  const changed = copy(source); changed.units[0].content += 'changed'; changed.transcript_sha256 = jsonHash(changed.units);
  await assert.rejects(f.batch.capture(changed, request, binding(request)), { code: 'CHATGPT_REQUEST_CONFLICT' });
  assert.deepEqual(saved.sourceIds.map(id => fs.readFileSync(f.file(id))), before);
});

test('external source edit and deletion make a completed retry incomplete without overwriting or resurrection', async t => {
  const f = fixture(t), source = snapshot(), request = input(), saved = await f.batch.capture(source, request, binding(request));
  const file = f.file(saved.sourceIds[0]); fs.appendFileSync(file, '\n用户保留的外部编辑。');
  const editedBytes = fs.readFileSync(file), edited = await f.batch.findRetry(request);
  assert.equal(edited.complete, false); assert.equal(edited.status, 'pending');
  assert.equal(edited.code, 'CHATGPT_BATCH_LEAF_EDITED'); assert.deepEqual(fs.readFileSync(file), editedBytes);
  fs.unlinkSync(file);
  const missing = await f.batch.findRetry(request);
  assert.equal(missing.complete, false); assert.equal(missing.code, 'CHATGPT_BATCH_LEAF_UNAVAILABLE');
  assert.equal(fs.existsSync(file), false); assert.equal(f.store.list().length, 0);
});

test('edited candidate leaves text verified but the overall import incomplete and preserves the exact user bytes', async t => {
  const f = fixture(t), source = snapshot(), request = input({ structured: structured() });
  const saved = await f.batch.capture(source, request, binding(request)), file = f.file(saved.candidateIds[1]);
  fs.appendFileSync(file, '\n用户补充结论。'); const bytes = fs.readFileSync(file);
  const retry = await f.batch.findRetry(request);
  assert.equal(retry.textComplete, true); assert.equal(retry.complete, false); assert.equal(retry.status, 'partial');
  assert.equal(retry.verifiedCandidates, 2); assert.equal(retry.expectedCandidates, 3);
  assert.deepEqual(fs.readFileSync(file), bytes); assert.equal(f.store.list().length, 4);
});

test('failure before a started file write reports exact partial counts and does not recreate a possibly deleted leaf', async t => {
  const f = fixture(t), source = snapshot(Array.from({ length: 201 }, (_, index) => '合成 ' + index)), request = input();
  const create = f.store.create.bind(f.store); let calls = 0;
  f.store.create = value => { if (++calls === 2) throw Object.assign(new Error('synthetic pre-write failure'), { code: 'EIO' }); return create(value); };
  const partial = await f.batch.capture(source, request, binding(request));
  assert.equal(partial.status, 'partial'); assert.equal(partial.complete, false); assert.equal(partial.code, 'EIO');
  assert.equal(partial.verifiedSources, 1); assert.equal(partial.expectedSources, 2); assert.equal(f.store.list().length, 1);
  f.store.create = create;
  const retry = await f.batch.findRetry(request);
  assert.equal(retry.complete, false); assert.equal(retry.code, 'CHATGPT_BATCH_LEAF_UNAVAILABLE');
  assert.equal(f.store.list().length, 1); assert.equal(f.store.get('chatgptCaptureRate', 'recent').length, 1);
});

test('interruption after actual file creation resumes a started leaf from disk without duplicate or new pipe', async t => {
  const f = fixture(t), source = snapshot(Array.from({ length: 201 }, (_, index) => '合成 ' + index)), request = input();
  const create = f.store.create.bind(f.store); let once = true;
  f.store.create = value => { const note = create(value); if (once) { once = false; throw Object.assign(new Error('synthetic crash after file write'), { code: 'EIO' }); } return note; };
  const partial = await f.batch.capture(source, request, binding(request));
  assert.equal(partial.complete, false); assert.equal(partial.code, 'EIO'); assert.equal(f.store.list().length, 1);
  const original = f.store.list()[0], bytes = fs.readFileSync(f.file(original.id));
  f.store.create = create; f.restart();
  t.mock.method(Date, 'now', () => source.expires_at + 600000);
  const resumed = await f.batch.findRetry(request);
  assert.equal(resumed.complete, true); assert.equal(resumed.status, 'saved'); assert.equal(resumed.verifiedSources, 2);
  assert.deepEqual(fs.readFileSync(f.file(original.id)), bytes); assert.equal(f.store.list().length, 2);
  assert.equal(f.store.get('chatgptCaptureRate', 'recent').length, 1);
});

test('candidate creation interruption resumes all three types and never treats a deferred item as saved', async t => {
  const f = fixture(t), source = snapshot(), request = input({ structured: structured() });
  const create = f.store.create.bind(f.store); let candidateWrites = 0;
  f.store.create = value => {
    const note = create(value);
    if (value.kind === 'knowledge' && ++candidateWrites === 1) throw Object.assign(new Error('synthetic candidate post-write interruption'), { code: 'EIO' });
    return note;
  };
  const partial = await f.batch.capture(source, request, binding(request));
  assert.equal(partial.complete, false); assert.equal(partial.textComplete, true); assert.equal(partial.verifiedCandidates, 1);
  assert.equal(partial.expectedCandidates, 3); f.store.create = create;
  const complete = await f.batch.findRetry(request);
  assert.equal(complete.complete, true); assert.equal(complete.verifiedCandidates, 3); assert.equal(f.store.list().length, 4);
});

test('a lost completion KV write cannot report complete and later retry verifies the actual surviving files', async t => {
  const f = fixture(t), source = snapshot(), request = input();
  const put = f.store.put.bind(f.store); let once = true;
  f.store.put = (namespace, key, value) => {
    if (once && namespace === 'chatgptHistoryBatches' && value.pending === false) { once = false; throw Object.assign(new Error('synthetic completion DB failure'), { code: 'EIO' }); }
    return put(namespace, key, value);
  };
  const partial = await f.batch.capture(source, request, binding(request));
  assert.equal(partial.complete, false); assert.equal(partial.code, 'EIO'); assert.equal(partial.verifiedSources, 1);
  const retry = await f.batch.findRetry(request);
  assert.equal(retry.complete, true); assert.equal(f.store.list().length, 1);
});

test('unknown occupied filename with another stable id is never overwritten', async t => {
  const f = fixture(t), source = snapshot(), request = input();
  const plan = planHistoryBatch(source, { summary: request.summary });
  const targetId = 'chatgpt_history_part_' + plan.parts[0].partId;
  const existing = f.store.create({ id: 'unrelated_existing_user_note', kind: 'source', title: '独立用户笔记', body: '必须完整保留。' });
  const target = path.join(f.config.vaultDir, '01 原始资料', targetId + '.md');
  fs.renameSync(f.file(existing.id), target); const bytes = fs.readFileSync(target); f.store.scan();
  const result = await f.batch.capture(source, request, binding(request));
  assert.equal(result.complete, false); assert.equal(result.code, 'CONFLICT');
  assert.deepEqual(fs.readFileSync(target), bytes); assert.equal(f.store.list().length, 1);
  assert.equal(f.store.readPersisted(existing.id).body, '必须完整保留。');
});

test('shared rate budget is charged once per new batch, not for its parts or durable retries', async t => {
  const f = fixture(t), source = snapshot(Array.from({ length: 201 }, (_, index) => '合成 ' + index)), request = input();
  f.store.put('chatgptCaptureRate', 'recent', Array(29).fill(Date.now()));
  const saved = await f.batch.capture(source, request, binding(request));
  assert.equal(saved.complete, true); assert.equal(f.store.get('chatgptCaptureRate', 'recent').length, 30);
  assert.equal((await f.batch.findRetry(request)).complete, true); assert.equal(f.store.get('chatgptCaptureRate', 'recent').length, 30);
  const next = input({ summary: '另一个新请求。' });
  await assert.rejects(f.batch.capture(source, next, binding(next)), { code: 'CHATGPT_RATE_LIMIT', status: 429 });
  assert.equal(f.store.list().length, 2); assert.equal(f.store.get('chatgptHistoryBatches', hash(next.requestId)), null);
});

test('concurrent requests, revoked permission and changed library cannot produce stale success', async t => {
  const f = fixture(t), source = snapshot(), request = input();
  const first = f.batch.capture(source, request, binding(request)), other = input({ summary: '同时的第二请求。' });
  await assert.rejects(f.batch.capture(source, other, binding(other)), { code: 'CHATGPT_BATCH_BUSY' });
  assert.equal((await first).complete, true);
  const active = f.batch.findRetry(request); f.disable();
  await assert.rejects(active, { code: 'CHATGPT_DISABLED' });
  const g = fixture(t), second = input(), writing = g.batch.capture(snapshot(), second, binding(second));
  g.switchContext(); await assert.rejects(writing, { code: 'CHATGPT_BATCH_CONTEXT_CHANGED' });
});

test('oversized full snapshot is explicitly blocked with no files, state, or consumed rate slot', async t => {
  const f = fixture(t), source = snapshot(['中'.repeat(750000)]), request = input();
  const blocked = await f.batch.capture(source, request, binding(request));
  assert.equal(blocked.status, 'blocked'); assert.equal(blocked.complete, false); assert.equal(blocked.code, 'CHATGPT_HISTORY_FRAME_LIMIT');
  assert.equal(blocked.transport.maxFrameBytes, 2 * 1024 * 1024); assert.equal(f.store.list().length, 0);
  assert.equal(f.store.get('chatgptHistoryBatches', hash(request.requestId)), null);
  assert.equal(f.store.get('chatgptCaptureRate', 'recent'), null);
});

test('existing ordinary capture request hashes reject both batch entry paths', async t => {
  const f = fixture(t), source = snapshot(), request = input();
  f.store.put('chatgptCaptures', hash(request.requestId), { syntheticOrdinaryCapture: true });
  await assert.rejects(f.batch.findRetry(request), { code: 'CHATGPT_REQUEST_CONFLICT' });
  await assert.rejects(f.batch.capture(source, request, binding(request)), { code: 'CHATGPT_REQUEST_CONFLICT' });
  assert.equal(f.store.list().length, 0);
});

test('a manipulated durable leaf receipt cannot be replaced by status declarations', async t => {
  const f = fixture(t), source = snapshot(), request = input();
  const saved = await f.batch.capture(source, request, binding(request));
  const state = f.store.get('chatgptHistoryBatches', hash(request.requestId));
  state.partWrites[state.plan.parts[0].partId].receipt.partSha256 = 'a'.repeat(64);
  f.store.put('chatgptHistoryBatches', hash(request.requestId), state);
  const result = await f.batch.findRetry(request);
  assert.equal(result.complete, false); assert.equal(result.textComplete, false);
  assert.equal(result.verification.text.issues[0].code, 'receipt_binding_or_status_invalid');
  assert.equal(f.store.readPersisted(saved.sourceIds[0]).meta.stage, 'reference');
});

test('candidate edit during the asynchronous text aggregation prevents a stale all-complete result', async t => {
  const f = fixture(t), source = snapshot(), request = input({ structured: structured() });
  const read = f.store.readPersisted.bind(f.store); let sourceReads = 0, file = null, bytes = null;
  f.store.readPersisted = (id, options) => {
    if (id.startsWith('chatgpt_history_part_') && ++sourceReads === 5) {
      const candidate = f.store.list().find(note => note.kind === 'knowledge');
      file = f.file(candidate.id); fs.appendFileSync(file, '\n候选初次读回后发生的用户修改。'); bytes = fs.readFileSync(file);
    }
    return read(id, options);
  };
  const result = await f.batch.capture(source, request, binding(request));
  assert.ok(file); assert.equal(result.complete, false); assert.equal(result.textComplete, true);
  assert.equal(result.verifiedCandidates, 2); assert.deepEqual(fs.readFileSync(file), bytes);
});

test('pending sync request hashes reject both batch entry paths before any write or rate charge', async t => {
  const f = fixture(t), source = snapshot(), request = input();
  f.store.put('chatgptSyncSessions', 'synthetic_session_key', { pending: true, requestHash: hash(request.requestId) });
  await assert.rejects(f.batch.findRetry(request), { code: 'CHATGPT_REQUEST_CONFLICT' });
  await assert.rejects(f.batch.capture(source, request, binding(request)), { code: 'CHATGPT_REQUEST_CONFLICT' });
  assert.equal(f.store.list().length, 0); assert.equal(f.store.get('chatgptCaptureRate', 'recent'), null);
});

test('failure to persist the initial intent returns explicit pending zero counts and never starts a file write', async t => {
  const f = fixture(t), source = snapshot(), request = input(), put = f.store.put.bind(f.store);
  f.store.put = (namespace, key, value) => {
    if (namespace === 'chatgptHistoryBatches') throw Object.assign(new Error('synthetic initial DB write failed'), { code: 'EIO' });
    return put(namespace, key, value);
  };
  const result = await f.batch.capture(source, request, binding(request));
  assert.equal(result.status, 'pending'); assert.equal(result.complete, false); assert.equal(result.code, 'EIO');
  assert.equal(result.statePersisted, false); assert.equal(result.verifiedSources, 0); assert.equal(result.verifiedCandidates, 0);
  assert.equal(f.store.list().length, 0); assert.equal(f.store.get('chatgptHistoryBatches', hash(request.requestId)), null);
});
