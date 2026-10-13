import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeSourceSyncRepository } from '../apps/android/web/source-sync-native.mjs';
import { createSyncState, createSyncBatch, inspectSyncSource, recordSyncChange, syncVector } from '../apps/android/web/source-sync.mjs';

const libraryId = '10000000-0000-4000-8000-000000000001';
const phone = '10000000-0000-4000-8000-000000000002';
const desktop = '10000000-0000-4000-8000-000000000003';
const sourceId = '10000000-0000-4000-8000-000000000004';
function state(replicaId = phone, context = 'formal') { return createSyncState({ libraryId, replicaId, context }); }
function packet() {
  return createSyncBatch(recordSyncChange(state(desktop), { sourceId, expectedHeads: [], operation: 'put',
    value: { title: '合成同步原文', body: '只用于临时回归。', source: { platform: '', author: '', url: '', date: '', locator: '', topic: '' } } }));
}
function pluginFixture(context = 'formal') {
  let durable = { revision: '0', state: state(phone, context) }, attempts = 0, commits = 0;
  const plugin = {
    async syncLoad(request) { assert.deepEqual(request, { context }); return structuredClone(durable); },
    async syncCommit(request) {
      assert.equal(request.context, context); attempts++;
      if (request.expectedRevision !== durable.revision) throw Object.assign(new Error('合成并发提交'), { code: 'SYNC_STALE' });
      durable = { revision: String(BigInt(durable.revision) + 1n), state: structuredClone(request.state) }; commits++;
      return structuredClone(durable);
    },
  };
  return { plugin, get durable() { return structuredClone(durable); }, get commits() { return commits; }, get attempts() { return attempts; },
    replace(value) { durable = structuredClone(value); } };
}

test('native bridge reopens durable journal and replays without another commit', async () => {
  const fixture = pluginFixture(), repository = createNativeSourceSyncRepository(fixture.plugin);
  const result = await repository.receive(packet());
  assert.equal(result.added, 1);
  assert.deepEqual(result.cursor, { [desktop]: 1 });
  assert.equal(inspectSyncSource(fixture.durable.state, sourceId).status, 'present');
  const reopened = createNativeSourceSyncRepository(fixture.plugin);
  assert.deepEqual(await reopened.load(), fixture.durable.state);
  assert.equal((await reopened.receive(packet())).added, 0);
  assert.equal(fixture.commits, 1);
});

test('native bridge reconciles an installed commit with lost reply but never acknowledges uncommitted data', async () => {
  for (const installed of [false, true]) {
    const fixture = pluginFixture(), commit = fixture.plugin.syncCommit;
    fixture.plugin.syncCommit = async request => {
      if (installed) await commit(request);
      throw Object.assign(new Error('合成回执中断'), { code: 'STORE_ERROR' });
    };
    const repository = createNativeSourceSyncRepository(fixture.plugin);
    if (installed) assert.deepEqual((await repository.receive(packet())).cursor, { [desktop]: 1 });
    else {
      await assert.rejects(repository.receive(packet()), { code: 'STORE_ERROR' });
      assert.deepEqual(syncVector(fixture.durable.state), {});
      assert.equal(fixture.commits, 0);
    }
  }
});

test('native bridge rejects cross-context journals, changed identity and malformed revisions before writing', async () => {
  for (const invalidRevision of ['empty', '-1', '01', '1.0', 1, '9223372036854775808']) {
    const fixture = pluginFixture(); fixture.replace({ ...fixture.durable, revision: invalidRevision });
    await assert.rejects(createNativeSourceSyncRepository(fixture.plugin).receive(packet()), { code: 'SYNC_INVALID' });
    assert.equal(fixture.attempts, 0);
  }
  const fixture = pluginFixture(), repository = createNativeSourceSyncRepository(fixture.plugin);
  await repository.load();
  for (const badState of [state(phone, 'practice'), state(desktop), { ...state(), libraryId: sourceId }]) {
    fixture.replace({ revision: '0', state: badState });
    await assert.rejects(repository.receive(packet()), { code: 'SYNC_SCOPE' });
    assert.equal(fixture.attempts, 0);
  }
  fixture.replace({ revision: '0', state: state() });
  assert.equal((await repository.receive(packet())).added, 1);
});

test('native bridge isolates practice calls and rejects a false successful commit receipt', async () => {
  const practice = pluginFixture('practice');
  await createNativeSourceSyncRepository(practice.plugin, { context: 'practice' }).load();
  const fixture = pluginFixture();
  fixture.plugin.syncCommit = async () => fixture.durable;
  await assert.rejects(createNativeSourceSyncRepository(fixture.plugin).receive(packet()), { code: 'SYNC_COMMIT_UNKNOWN' });
  assert.deepEqual(syncVector(fixture.durable.state), {});
  assert.throws(() => createNativeSourceSyncRepository(fixture.plugin, { context: 'other' }), TypeError);
});
