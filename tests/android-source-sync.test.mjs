import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncState, validateSyncState, syncVector, inspectSyncSource, recordSyncChange, createSyncBatch, receiveSyncBatch, syncLimits } from '../apps/android/web/source-sync.mjs';
import { createSourceSyncRepository } from '../apps/android/web/source-sync-repository.mjs';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const libraryId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', sourceId = '11111111-1111-4111-8111-111111111111';
const newState = (replicaId, context = 'formal') => createSyncState({ replicaId, libraryId, context });
const content = body => ({ title: '明确标记的合成原文', body, source: { platform: '合成测试', author: '虚构作者', url: 'https://example.org/synthetic', date: '2026-10-13', locator: '合成段落', topic: '协议回归' } });
const change = (state, body, id = sourceId) => recordSyncChange(state, { sourceId: id, expectedHeads: inspectSyncSource(state, id).versions.map(v => v.id), operation: body === null ? 'delete' : 'put', value: body === null ? null : content(body) });
const receive = (to, from) => receiveSyncBatch(to, createSyncBatch(from, syncVector(to))).state;
const view = state => inspectSyncSource(state, sourceId);

test('offline divergent edits preserve both branches on both devices until explicit resolution', () => {
  let a = change(newState(A), '合成共同原文'), b = receive(newState(B), a);
  a = change(a, '合成手机离线修改'); b = change(b, '合成电脑离线修改');
  const beforeA = structuredClone(a), beforeB = structuredClone(b);
  a = receive(a, b); b = receive(b, a);
  assert.equal(view(a).status, 'conflict'); assert.deepEqual(view(a), view(b));
  assert.deepEqual(view(a).versions.map(v => v.value.body), ['合成手机离线修改', '合成电脑离线修改']);
  assert.equal(beforeA.events.length, 2); assert.equal(beforeB.events.length, 2);
  assert.throws(() => recordSyncChange(a, { sourceId, expectedHeads: [view(a).versions[0].id], operation: 'put', value: content('未经完整核对') }), { code: 'SYNC_STALE' });
  a = change(a, '双方核对后的合成合并正文'); b = receive(b, a);
  assert.equal(view(b).status, 'present'); assert.equal(view(b).versions[0].value.body, '双方核对后的合成合并正文');
  assert.equal(b.events.length, 4, 'all original and conflicting text remains in the journal');
});

test('delete tombstones propagate once, retain original text, and prevent stale resurrection', () => {
  let a = change(newState(A), '合成待删除原文'), b = receive(newState(B), a);
  const stale = createSyncBatch(a);
  a = change(a, null); b = receive(b, a);
  assert.equal(view(b).status, 'deleted'); assert.equal(b.events[0].value.body, '合成待删除原文');
  const repeated = receiveSyncBatch(b, stale);
  assert.equal(repeated.added, 0); assert.deepEqual(repeated.state, b); assert.equal(view(repeated.state).status, 'deleted');
  assert.equal(createSyncBatch(a, syncVector(b)).events.length, 0);
});

test('delete versus edit and concurrent deletes require explicit resolution rather than last timestamp wins', () => {
  for (const edit of ['另一端保留的合成正文', null]) {
    let a = change(newState(A), '合成共同原文'), b = receive(newState(B), a);
    a = change(a, null); b = change(b, edit);
    a = receive(a, b); b = receive(b, a);
    assert.equal(view(a).status, 'conflict'); assert.deepEqual(view(a), view(b));
    a = change(a, edit); b = receive(b, a);
    assert.equal(view(b).status, edit === null ? 'deleted' : 'present');
  }
});

test('three replicas, forwarded branches and pagination converge independently of delivery order', () => {
  let a = change(newState(A), '共同版本'), b = receive(newState(B), a), c = receive(newState(C), a);
  a = change(change(a, 'A 第一次'), 'A 第二次'); b = change(b, 'B 分支'); c = change(c, 'C 分支');
  const aFirst = receive(receive(a, b), c), aSecond = receive(receive(a, c), b);
  assert.deepEqual(view(aFirst), view(aSecond)); assert.equal(view(aFirst).versions.length, 3);
  let target = newState('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
  let count = 0;
  for (;;) {
    const batch = createSyncBatch(aFirst, syncVector(target), { maxEvents: 1 }); if (!batch.events.length) break;
    target = receiveSyncBatch(target, batch).state; count++;
  }
  assert.equal(count, 5); assert.deepEqual(view(target), view(aFirst));
  const resolved = change(aFirst, '合成统一版本');
  assert.equal(view(receive(target, resolved)).versions.length, 1);
});

test('whole batches reject missing sequence/ancestry, reused identities and cross-source parents atomically', () => {
  const a = change(change(newState(A), '第一版'), '第二版'), b = newState(B), original = structuredClone(b), packet = createSyncBatch(a);
  const broken = [
    { ...packet, events: [packet.events[1]] },
    { ...packet, events: [packet.events[0], { ...packet.events[1], parents: [`${C}:1`] }] },
    { ...packet, events: [packet.events[0], { ...packet.events[1], sourceId: C }] },
    { ...packet, events: [packet.events[0], { ...packet.events[0], value: content('同编号不同正文') }] },
  ];
  for (const batch of broken) { assert.throws(() => receiveSyncBatch(b, batch)); assert.deepEqual(b, original); }
  const imported = receiveSyncBatch(b, packet).state;
  assert.throws(() => receiveSyncBatch(imported, { ...packet, events: [{ ...packet.events[0], value: content('篡改原身份') }] }), { code: 'SYNC_ID_REUSED' });
  assert.throws(() => receiveSyncBatch(newState(A), packet), { code: 'SYNC_ID_REUSED' });
});

test('library/context isolation and closed source schema exclude permissions, credentials and learning events', () => {
  const a = change(newState(A), '合成原文'), packet = createSyncBatch(a), b = newState(B);
  for (const batch of [{ ...packet, context: 'practice' }, { ...packet, libraryId: C }]) assert.throws(() => receiveSyncBatch(b, batch), { code: 'SYNC_SCOPE' });
  for (const corrupt of [
    value => ({ ...value, apiKey: 'synthetic-not-a-key' }),
    value => ({ ...value, privacy: 'cloud' }),
    value => ({ ...value, learningEvidence: { reviewSettled: true } }),
    value => ({ ...value, source: { ...value.source, externalApproval: true } }),
    value => ({ ...value, title: 123 }),
    value => ({ ...value, body: '\ud800' }),
  ]) assert.throws(() => receiveSyncBatch(b, { ...packet, events: [{ ...packet.events[0], value: corrupt(packet.events[0].value) }] }), { code: 'SYNC_INVALID' });
  assert.throws(() => receiveSyncBatch(b, { ...packet, version: 2 }), { code: 'SYNC_INVALID' });
  assert.throws(() => validateSyncState({ ...a, records: {} }), { code: 'SYNC_INVALID' });
});

test('bounded increments count UTF-8 and JSON escaping and reject overflow without pruning', () => {
  let a = newState(A);
  for (let i = 0; i < 70; i++) a = change(a, ('\u0000\\"中文').repeat(4000));
  const batch = createSyncBatch(a);
  assert.ok(batch.events.length > 0 && batch.events.length < a.events.length);
  assert.ok(Buffer.byteLength(JSON.stringify(batch)) <= syncLimits.batchBytes);
  assert.throws(() => receiveSyncBatch(newState(B), { ...batch, events: Array(101).fill(batch.events[0]) }), { code: 'SYNC_LIMIT' });
  assert.throws(() => change(a, '中'.repeat(45000)), { code: 'SYNC_INVALID' });
  assert.throws(() => createSyncBatch(a, { invalid: 1 }), { code: 'SYNC_INVALID' });
  assert.throws(() => createSyncBatch(a, {}, { maxEvents: 101 }), { code: 'SYNC_INVALID' });
  assert.equal(a.events.length, 70);
});

function memoryStorage(state) {
  let durable = structuredClone({ revision: 'empty', state }), failBefore = false, failAfter = false, failRead = false, writes = 0;
  return {
    async load() { if (failRead) throw new Error('合成读失败'); return structuredClone(durable); },
    async commit({ expectedRevision, state }) {
      if (failBefore) { failBefore = false; throw new Error('合成提交前中断'); }
      if (expectedRevision !== durable.revision) throw Object.assign(new Error('合成 CAS 冲突'), { code: 'SYNC_STALE' });
      durable = structuredClone({ revision: String(++writes), state });
      if (failAfter) { failAfter = false; throw new Error('合成提交后响应中断'); }
    },
    failBefore: () => { failBefore = true; }, failAfter: () => { failAfter = true; }, failRead: value => { failRead = value; },
    get writes() { return writes; }, get durable() { return structuredClone(durable); },
  };
}

test('interruption before/after atomic commit and ACK loss replay once after repository reopen', async () => {
  const a = change(change(newState(A), '合成历史'), null), batch = createSyncBatch(a), storage = memoryStorage(newState(B));
  let repository = createSourceSyncRepository(storage);
  storage.failBefore(); await assert.rejects(repository.receive(batch), /合成提交前中断/);
  assert.equal(storage.writes, 0); assert.deepEqual(syncVector(storage.durable.state), {});
  repository = createSourceSyncRepository(storage); storage.failAfter();
  const recovered = await repository.receive(batch);
  assert.equal(recovered.added, 2); assert.equal(storage.writes, 1); assert.deepEqual(recovered.cursor, syncVector(storage.durable.state));
  repository = createSourceSyncRepository(storage);
  const replay = await repository.receive(batch);
  assert.equal(replay.added, 0); assert.equal(storage.writes, 1); assert.equal(view(await repository.load()).status, 'deleted');
});

test('uncertain commit never ACKs; retry reloads durable state and cannot duplicate versions', async () => {
  const batch = createSyncBatch(change(newState(A), '合成正文')), storage = memoryStorage(newState(B)), baseLoad = storage.load;
  let reads = 0;
  storage.load = async () => { if (++reads === 2) throw new Error('合成提交后读回中断'); return baseLoad(); };
  const repository = createSourceSyncRepository(storage); storage.failAfter();
  await assert.rejects(repository.receive(batch), { code: 'SYNC_COMMIT_UNKNOWN' }); assert.equal(storage.writes, 1);
  const retried = await repository.receive(batch);
  assert.equal(retried.added, 0); assert.equal(storage.writes, 1); assert.deepEqual(retried.cursor, { [A]: 1 });
});

test('serialized receive/change preserves a fresh local edit and rejects stale conflict resolution', async () => {
  const a = change(newState(A), '合成原文'), storage = memoryStorage(newState(B)), repository = createSourceSyncRepository(storage);
  await Promise.all([repository.receive(createSyncBatch(a)), repository.receive(createSyncBatch(a))]);
  assert.equal(storage.writes, 1);
  const before = await repository.load(), expectedHeads = view(before).versions.map(v => v.id);
  await repository.change({ sourceId, expectedHeads, operation: 'put', value: content('合成本机编辑') });
  const remote = change(a, '合成离线远端编辑'); await repository.receive(createSyncBatch(remote));
  await assert.rejects(repository.change({ sourceId, expectedHeads, operation: 'delete', value: null }), { code: 'SYNC_STALE' });
  assert.equal(view(await repository.load()).status, 'conflict'); assert.equal(storage.writes, 3);
});

test('a concurrent storage revision cannot be overwritten or acknowledged by a stale repository', async () => {
  const batch = createSyncBatch(change(newState(A), '合成远端正文')), storage = memoryStorage(newState(B)), commit = storage.commit;
  let intervened = false;
  storage.commit = async request => {
    if (!intervened) {
      intervened = true;
      const current = await storage.load();
      await commit({ expectedRevision: current.revision, state: change(current.state, '合成并发本机正文') });
    }
    return commit(request);
  };
  const repository = createSourceSyncRepository(storage);
  await assert.rejects(repository.receive(batch), { code: 'SYNC_STALE' });
  assert.deepEqual(syncVector(storage.durable.state), { [B]: 1 });
  assert.equal(view(storage.durable.state).versions[0].value.body, '合成并发本机正文');
  await repository.receive(batch);
  assert.equal(view(await repository.load()).status, 'conflict'); assert.equal(storage.writes, 2);
});

test('queued input is captured at submission and cannot change during an asynchronous storage read', async () => {
  const storage = memoryStorage(newState(B)), repository = createSourceSyncRepository(storage);
  const packet = createSyncBatch(change(newState(A), '提交时的合成正文'));
  const result = repository.receive(packet); packet.events[0].value.body = '提交后的修改';
  assert.equal(view((await result).state).versions[0].value.body, '提交时的合成正文');
  const state = await repository.load(), request = { sourceId, expectedHeads: view(state).versions.map(v => v.id), operation: 'put', value: content('确认时的合成编辑') };
  const changed = repository.change(request); request.value.body = '提交后的编辑';
  assert.equal(view((await changed).state).versions[0].value.body, '确认时的合成编辑');
});

test('source, replica, event and journal caps retain input rather than pruning tombstones or history', () => {
  const base = change(newState(A), '合成正文'), first = base.events[0];
  const ids = Array.from({ length: 101 }, (_, i) => `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`);
  const sources = ids.map((id, i) => ({ ...first, id: `${A}:${i + 1}`, sequence: i + 1, sourceId: id, parents: [], operation: 'delete', value: null }));
  assert.throws(() => validateSyncState({ ...base, events: sources }), { code: 'SYNC_LIMIT' });
  const replicas = ids.slice(0, 33).map(id => ({ ...first, id: `${id}:1`, replicaId: id }));
  assert.throws(() => validateSyncState({ ...base, events: replicas }), { code: 'SYNC_LIMIT' });
  assert.throws(() => validateSyncState({ ...base, events: Array(2001).fill(first) }), { code: 'SYNC_LIMIT' });
  const huge = Array.from({ length: 43 }, (_, i) => ({ ...first, id: `${A}:${i + 1}`, sequence: i + 1, parents: i ? [`${A}:${i}`] : [], value: content('\u0000'.repeat(128 * 1024)) }));
  assert.throws(() => validateSyncState({ ...base, events: huge }), { code: 'SYNC_LIMIT' });
  assert.deepEqual(base.events, [first]);
});

test('one device cannot fork its own source lineage or supply an unbounded parent list', () => {
  const state = change(change(newState(A), '合成旧版本'), '合成新版本'), packet = createSyncBatch(state);
  assert.throws(() => receiveSyncBatch(newState(B), { ...packet, events: [packet.events[0], { ...packet.events[1], parents: [] }] }), { code: 'SYNC_GAP' });
  assert.throws(() => receiveSyncBatch(newState(B), { ...packet, events: [{ ...packet.events[0], parents: Array.from({ length: 33 }, (_, i) => `${A}:${i + 1}`) }] }), { code: 'SYNC_INVALID' });
});
