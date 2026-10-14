import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { historyBatchLimits, planHistoryBatch, verifyHistoryBatchReceipts } from '../src/chatgpt-history-batch.mjs';

const NOW = 1800000000000;
const hash = value => createHash('sha256').update(value).digest('hex');
const jsonHash = value => hash(JSON.stringify(value));
const copy = value => JSON.parse(JSON.stringify(value));
const message = (content, index = 0) => ({ index, role: index % 2 ? 'assistant' : 'user',
  message_id: `original_message_${index}`, created_at: null, content_type: 'text', content,
  rich_content: index === 0 ? { assets: [{ id: 'attachment_reference_only' }] } : null });
function snapshot(contents = ['原始问题', '原始回答']) {
  const units = contents.map(message), pages = [];
  let start = { message: 0, offset: 0 }, index = 0, offset = 0;
  while (index < units.length) {
    let room = 9000;
    while (index < units.length && room > 0) {
      let end = Math.min(units[index].content.length, offset + room);
      if (end < units[index].content.length && /[\uD800-\uDBFF]/.test(units[index].content[end - 1]) && /[\uDC00-\uDFFF]/.test(units[index].content[end])) end--;
      if (end === offset) break;
      room -= end - offset; offset = end;
      if (offset === units[index].content.length) { index++; offset = 0; }
    }
    const end = { message: index, offset };
    pages.push({ range: { start, end }, hasMore: index < units.length }); start = end;
  }
  return { version: 1, conversation_id: '11111111-1111-4111-8111-111111111111', title: '合成历史分片', branch: 'active',
    snapshot_id: 'b'.repeat(32), transcript_sha256: jsonHash(units), units, pages,
    coverage: { text: 'complete_visible_active_branch', other_branches: 'excluded', attachment_bytes: 'not_read', complete_multimodal: false },
    warnings: ['附件索引已保留，附件字节未读取。'], issued_at: NOW, expires_at: NOW + 60000 };
}
const options = extra => ({ summary: '独立模型摘要', now: NOW, ...extra });
const item = patch => ({ id: 'actual_item_id', type: 'knowledge', title: '合成知识建议', body: '未经核验的合成内容。',
  sourceMessageIds: ['original_message_0', 'original_message_1'], uncertainties: ['需要另行事实核验。'], ...patch });
function receipts(plan) {
  const readbacks = new Map();
  const attempts = plan.parts.map(part => {
    const raw = JSON.stringify({ syntheticNote: part });
    const receipt = { status: 'saved', batchId: part.batchId, partId: part.partId, partIndex: part.partIndex,
      partCount: part.partCount, requestId: part.requestId, partSha256: jsonHash(part), noteId: `synthetic_part_${part.partIndex}`, rawSha256: hash(raw) };
    readbacks.set(part.partId, { part: copy(part), receipt: copy(receipt), raw,
      persistence: { method: 'fresh_disk_and_sqlite_readback', rawSha256: hash(raw) } });
    return receipt;
  });
  const reads = [];
  const verifyPersistedPart = async query => { reads.push(query); return readbacks.get(query.partId); };
  return { attempts, readbacks, reads, verifyPersistedPart };
}

test('planning is deterministic, immutable, does not mutate input, and cannot claim storage or authentication', () => {
  const source = snapshot(), before = JSON.stringify(source);
  const a = planHistoryBatch(source, options()), b = planHistoryBatch(source, options({ now: NOW + 1000 }));
  assert.deepEqual(a, b); assert.equal(JSON.stringify(source), before);
  assert.equal(a.execution.status, 'planning_only'); assert.equal(a.execution.persisted, false);
  assert.equal(a.execution.cumulativeSyncSupported, false); assert.equal(a.execution.authenticatedTransportRequired, true);
  assert.equal(Object.isFrozen(a.parts[0].fragments[0]), true);
  assert.throws(() => { a.parts[0].fragments[0].content = 'changed'; }, TypeError);
  assert.deepEqual(a.parts[0].fragments.map(fragment => fragment.messageId), source.units.map(unit => unit.message_id));
  assert.equal(a.transport.maxFrameBytes, 2 * 1024 * 1024);
});

test('more than 200 actual messages become distinct parts without inventing branches or message ids', () => {
  const source = snapshot(Array.from({ length: 401 }, (_, index) => `原文 ${index}`));
  const plan = planHistoryBatch(source, options());
  assert.deepEqual(plan.parts.map(part => part.fragments.length), [200, 200, 1]);
  assert.deepEqual(plan.parts.map(part => part.range), [
    { start: { message: 0, offset: 0 }, end: { message: 200, offset: 0 } },
    { start: { message: 200, offset: 0 }, end: { message: 400, offset: 0 } },
    { start: { message: 400, offset: 0 }, end: { message: 401, offset: 0 } },
  ]);
  for (const [index, part] of plan.parts.entries()) {
    assert.equal(part.global.branchId, 'active'); assert.equal(part.global.snapshotId, source.snapshot_id);
    assert.equal(part.global.transcriptSha256, source.transcript_sha256);
    assert.equal(part.partIndex, index); assert.equal(part.partCount, 3);
    assert.equal('sync' in part, false);
  }
  assert.deepEqual(plan.parts.flatMap(part => part.fragments.map(fragment => fragment.messageId)), source.units.map(unit => unit.message_id));
  assert.equal(new Set(plan.parts.map(part => part.requestId)).size, 3);
});

test('500000 character cap reserves summary and long messages split at exact offsets with original identity', () => {
  const text = '甲'.repeat(600123), source = snapshot([text]);
  const plan = planHistoryBatch(source, options({ summary: '摘'.repeat(30000) }));
  assert.equal(plan.parts.length, 2);
  const fragments = plan.parts.flatMap(part => part.fragments);
  assert.equal(fragments.map(fragment => fragment.content).join(''), text);
  assert.equal(new Set(fragments.map(fragment => fragment.messageId)).size, 1);
  assert.equal(fragments[0].charStart, 0); assert.equal(fragments.at(-1).charEnd, text.length);
  let offset = 0;
  for (const fragment of fragments) {
    assert.equal(fragment.charStart, offset); offset = fragment.charEnd;
    assert.equal(fragment.fullMessageSha256, hash(text)); assert.equal(fragment.contentSha256, hash(fragment.content));
    assert.ok(fragment.content.length <= 120000);
  }
  for (const part of plan.parts) {
    assert.ok(part.summary.length + part.fragments.reduce((n, fragment) => n + fragment.content.length, 0) <= 500000);
    assert.ok(JSON.stringify(part).length <= 1000000); assert.ok(Buffer.byteLength(JSON.stringify(part)) <= 2 * 1024 * 1024);
  }
});

test('UTF-16 offsets do not split surrogate pairs and literal code, CRLF, spaces and rich references survive', async () => {
  const text = 'a'.repeat(119999) + '🙂\r\n```js\n  const raw = "**原样**";\n```  \n' + 'z'.repeat(120010);
  const source = snapshot([text]), plan = planHistoryBatch(source, options());
  const fragments = plan.parts.flatMap(part => part.fragments);
  assert.equal(fragments[0].charEnd, 119999); assert.equal(fragments[1].charStart, 119999);
  assert.equal(fragments[1].content.startsWith('🙂'), true);
  assert.equal(fragments.map(fragment => fragment.content).join(''), text);
  assert.deepEqual(fragments[0].unitMetadata.rich_content, source.units[0].rich_content);
  const fixture = receipts(plan);
  assert.equal((await verifyHistoryBatchReceipts(plan, fixture.attempts, fixture)).complete, true);
});

test('escaping-heavy content respects JSON budget without loss', async () => {
  const text = '\\\"\n\t'.repeat(170000), source = snapshot([text]), plan = planHistoryBatch(source, options());
  assert.ok(plan.parts.length > 1);
  assert.equal(plan.parts.flatMap(part => part.fragments.map(fragment => fragment.content)).join(''), text);
  for (const part of plan.parts) assert.ok(JSON.stringify(part).length <= historyBatchLimits.maxPayloadJsonCharacters);
  const fixture = receipts(plan);
  assert.equal((await verifyHistoryBatchReceipts(plan, fixture.attempts, fixture)).complete, true);
});

test('oversized v1 full snapshot is explicitly blocked; planning does not raise frame or TTL limits', () => {
  const source = snapshot(['中'.repeat(750000)]), plan = planHistoryBatch(source, options());
  assert.ok(plan.transport.fullSnapshotPayloadBytes > 2 * 1024 * 1024);
  assert.equal(plan.transport.fullSnapshotBlocked, true);
  assert.equal(plan.transport.status, 'blocked_by_existing_full_snapshot_frame');
  assert.equal(plan.execution.status, 'planning_only'); assert.equal(plan.global.expiresAt, source.expires_at);
  for (const part of plan.parts) assert.ok(Buffer.byteLength(JSON.stringify(part)) <= 2 * 1024 * 1024);
});

test('cross-part structured sources keep every original item type, uncertainty and source location but remain deferred', async () => {
  const source = snapshot(['a'.repeat(520000), '回答']), structured = { version: 1, items: [
    item({ type: 'knowledge' }), item({ id: 'conclusion_item', type: 'conclusion' }),
    item({ id: 'fact_item', type: 'unverified_fact' }),
  ] };
  const plan = planHistoryBatch(source, options({ structured }));
  assert.deepEqual(plan.deferredStructured.map(value => value.item), structured.items);
  for (const deferred of plan.deferredStructured) {
    assert.equal(deferred.status, 'deferred_not_persisted');
    assert.deepEqual(deferred.sourceLocations.map(source => source.messageId), structured.items[0].sourceMessageIds);
    assert.equal(deferred.sourceLocations[0].parts.length, 2);
    assert.equal(deferred.sourceLocations[0].parts[0].ranges[0].start, 0);
    assert.equal(deferred.sourceLocations[0].parts.at(-1).ranges.at(-1).end, 520000);
  }
  const fixture = receipts(plan), result = await verifyHistoryBatchReceipts(plan, fixture.attempts, fixture);
  assert.equal(result.textComplete, true); assert.equal(result.complete, false); assert.equal(result.structured.complete, false);
  assert.equal(result.status, 'text_verified_structure_pending');
  assert.equal(result.structured.persistedItems, 0); assert.equal(result.structured.expectedItems, 3);
});

test('snapshot identity, SHA, duplicate original ids, incomplete or discontinuous pages fail closed', () => {
  const cases = [
    [source => { source.branch = 'invented-part-1'; }, 'CHATGPT_BATCH_SNAPSHOT'],
    [source => { source.snapshot_id = 'model-supplied'; }, 'CHATGPT_BATCH_SNAPSHOT'],
    [source => { source.warnings = { invalid: 'not an array' }; }, 'CHATGPT_BATCH_SNAPSHOT'],
    [source => { source.units[0].content += 'tampered'; }, 'CHATGPT_BATCH_HASH'],
    [source => { source.units[1].message_id = source.units[0].message_id; source.transcript_sha256 = jsonHash(source.units); }, 'CHATGPT_BATCH_MESSAGES'],
    [source => { source.pages[0].hasMore = true; }, 'CHATGPT_BATCH_PAGES'],
    [source => { source.pages[0].range.start.offset = 1; }, 'CHATGPT_BATCH_PAGES'],
    [source => { source.pages[0].range.end = { message: 1, offset: 0 }; }, 'CHATGPT_BATCH_PAGES'],
    [source => { source.pages[0].range.end = { message: 99, offset: 0 }; }, 'CHATGPT_BATCH_PAGES'],
    [source => { source.pages = [
      { range: { start: { message: 0, offset: 0 }, end: { message: 0, offset: 1 } }, hasMore: true },
      { range: { start: { message: 1, offset: 0 }, end: { message: 2, offset: 0 } }, hasMore: false },
    ]; }, 'CHATGPT_BATCH_PAGES'],
  ];
  for (const [change, code] of cases) { const source = snapshot(); change(source); assert.throws(() => planHistoryBatch(source, options()), { code }); }
});

test('expired, future-issued or overlong TTL snapshots cannot be renewed by the planner', () => {
  for (const patch of [
    { expires_at: NOW }, { issued_at: NOW + 1 },
    { issued_at: NOW - 300001, expires_at: NOW + 1000 }, { expires_at: NOW + 300001 },
  ]) assert.throws(() => planHistoryBatch({ ...snapshot(), ...patch }, options()), { code: 'CHATGPT_BATCH_SNAPSHOT' });
});

test('unresolved structured references and oversized original metadata are rejected rather than discarded', () => {
  assert.throws(() => planHistoryBatch(snapshot(), options({ structured: { version: 1, items: [item({ sourceMessageIds: ['missing_real_message'] })] } })), { code: 'CHATGPT_BATCH_STRUCTURE' });
  const source = snapshot(); source.units[0].rich_content = { retained: 'x'.repeat(1000100) }; source.transcript_sha256 = jsonHash(source.units);
  assert.throws(() => planHistoryBatch(source, options()), { code: 'CHATGPT_BATCH_METADATA_LIMIT' });
});

test('all actual program readbacks verify complete text even when delivery receipts arrive out of order', async () => {
  const plan = planHistoryBatch(snapshot(Array.from({ length: 401 }, (_, index) => `原文 ${index}`)), options());
  const fixture = receipts(plan), result = await verifyHistoryBatchReceipts(plan, [...fixture.attempts].reverse(), fixture);
  assert.equal(result.complete, true); assert.equal(result.verifiedParts, 3); assert.deepEqual(result.missingParts, []);
  assert.equal(result.transcriptSha256, plan.global.transcriptSha256);
  assert.equal(fixture.reads.length, 3);
  for (const query of fixture.reads) assert.deepEqual(Object.keys(query).sort(), ['noteId', 'partId', 'requestId']);
});

test('identical retries share one verified part; they do not create or count another message', async () => {
  const plan = planHistoryBatch(snapshot(), options()), fixture = receipts(plan);
  const retry = { ...fixture.attempts[0], status: 'already_saved' };
  const result = await verifyHistoryBatchReceipts(plan, [fixture.attempts[0], retry, retry], fixture);
  assert.equal(result.complete, true); assert.equal(result.verifiedParts, 1);
  assert.equal(result.duplicateRetries, 2); assert.equal(fixture.reads.length, 1);
});

test('missing parts, failed writes and historical-only receipts never report complete', async () => {
  const plan = planHistoryBatch(snapshot(Array.from({ length: 201 }, (_, index) => `原文 ${index}`)), options());
  const fixture = receipts(plan);
  let result = await verifyHistoryBatchReceipts(plan, [fixture.attempts[0]], fixture);
  assert.equal(result.complete, false); assert.deepEqual(result.missingParts, [1]);
  result = await verifyHistoryBatchReceipts(plan, [fixture.attempts[0], { ...fixture.attempts[1], status: 'pending' }], fixture);
  assert.equal(result.complete, false); assert.equal(result.failedAttempts, 1);
  fixture.readbacks.get(plan.parts[1].partId).persistence.method = 'durable_receipt_only';
  result = await verifyHistoryBatchReceipts(plan, fixture.attempts, fixture);
  assert.equal(result.complete, false); assert.deepEqual(result.missingParts, [1]);
});

test('status declarations or model-provided booleans are insufficient without a real service readback adapter', async () => {
  const plan = planHistoryBatch(snapshot(), options()), fixture = receipts(plan);
  await assert.rejects(verifyHistoryBatchReceipts(plan, fixture.attempts), { code: 'CHATGPT_BATCH_READBACK_REQUIRED' });
  for (const response of [true, { status: 'verified' }, { ...fixture.readbacks.values().next().value, raw: undefined }]) {
    const result = await verifyHistoryBatchReceipts(plan, fixture.attempts, { verifyPersistedPart: async () => response });
    assert.equal(result.complete, false); assert.equal(result.verifiedParts, 0);
  }
});

test('tampered stored content, receipt bindings, raw file fingerprint, and conflicting retry note are detected', async () => {
  const plan = planHistoryBatch(snapshot(), options());
  for (const change of [
    fixture => { fixture.readbacks.values().next().value.part.fragments[0].content += 'changed'; },
    fixture => { fixture.readbacks.values().next().value.receipt.batchId = 'c'.repeat(64); },
    fixture => { fixture.readbacks.values().next().value.receipt.rawSha256 = 'c'.repeat(64); },
    fixture => { fixture.readbacks.values().next().value.raw += 'edited'; },
    fixture => { fixture.attempts[0].partSha256 = 'c'.repeat(64); },
    fixture => { fixture.attempts.push({ ...fixture.attempts[0], noteId: 'unexpected_copy' }); },
  ]) {
    const fixture = receipts(plan); change(fixture);
    const result = await verifyHistoryBatchReceipts(plan, fixture.attempts, fixture);
    assert.equal(result.complete, false); assert.ok(result.issues.length > 0);
  }
});

test('altered plan fragments, ranges, order and missing final offsets are rejected before readback', async () => {
  const original = planHistoryBatch(snapshot(Array.from({ length: 201 }, (_, index) => `原文 ${index}`)), options());
  for (const change of [
    plan => { plan.parts[0].fragments[0].content += 'changed'; },
    plan => { plan.parts.reverse(); },
    plan => { plan.parts[1].range.start.offset = 1; },
    plan => { plan.parts.pop(); },
  ]) {
    const plan = copy(original); change(plan);
    plan.manifestSha256 = jsonHash({ parts: plan.parts, deferredStructured: plan.deferredStructured });
    await assert.rejects(verifyHistoryBatchReceipts(plan, [], { verifyPersistedPart: async () => assert.fail('must not read') }), { code: 'CHATGPT_BATCH_PLAN_HASH' });
  }
});

test('transient adapter failure is incomplete and a later independent verification can safely retry', async () => {
  const plan = planHistoryBatch(snapshot(), options()), fixture = receipts(plan);
  const failed = await verifyHistoryBatchReceipts(plan, fixture.attempts, { verifyPersistedPart: async () => { throw new Error('synthetic interrupted read'); } });
  assert.equal(failed.complete, false); assert.equal(failed.issues[0].code, 'persisted_readback_failed');
  const success = await verifyHistoryBatchReceipts(plan, fixture.attempts, fixture);
  assert.equal(success.complete, true);
});

test('two real stored copies for one part are a deduplication conflict even when both payloads match', async () => {
  const plan = planHistoryBatch(snapshot(), options()), fixture = receipts(plan);
  const duplicate = { ...fixture.attempts[0], noteId: 'synthetic_duplicate_copy' };
  let reads = 0;
  const result = await verifyHistoryBatchReceipts(plan, [...fixture.attempts, duplicate], {
    verifyPersistedPart: async query => {
      reads++;
      const stored = copy(fixture.readbacks.get(query.partId));
      stored.receipt.noteId = query.noteId;
      return stored;
    },
  });
  assert.equal(result.complete, false); assert.equal(result.textComplete, false);
  assert.equal(result.issues[0].code, 'part_storage_identity_conflict'); assert.equal(reads, 1);
});
