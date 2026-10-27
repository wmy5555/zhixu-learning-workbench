import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { createService } from '../src/service.mjs';

const tempRoot = path.resolve(import.meta.dirname, '../.tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const bridgeIds = Array.from({ length: 12 }, (_, i) => `a-${String(i).padStart(2, '0')}`);

function fixture(t, primaryIds) {
  const dir = fs.mkdtempSync(path.join(tempRoot, 'relation-ranking-'));
  const service = createService({ dataDir: path.join(dir, 'data'), vaultDir: path.join(dir, 'vault'), aiOverride: {
    generate: async () => { throw new Error('Unexpected AI request'); },
    embed: async () => { throw new Error('Unexpected embedding'); },
  } });
  for (const id of bridgeIds) service.store.create({ id, kind: 'knowledge', title: `River ${id}`,
    body: `合成比较资料 ${id}，仅用于排序回归。`, meta: { topic: 'River', stage: 'learning' } });
  for (const id of primaryIds) service.store.create({ id, kind: 'knowledge', title: `Nebula ${id}`,
    body: `合成探索资料 ${id}，仅用于排序回归。`, meta: { topic: 'Nebula', stage: 'learning' } });
  t.after(async () => {
    await service.close();
    assert.ok(dir.startsWith(tempRoot + path.sep));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return service;
}

function watchRankHashes(t, primaryIds, tied = false) {
  const inputs = new Set(primaryIds.flatMap(id => bridgeIds.map(candidate => `${id}:${candidate}`)));
  const counts = new Map(), createHash = crypto.createHash;
  t.mock.method(crypto, 'createHash', (...args) => {
    const instance = createHash(...args), update = instance.update, digest = instance.digest;
    let ranking = false;
    instance.update = function (value, ...rest) {
      if (inputs.has(value)) { ranking = true; counts.set(value, (counts.get(value) || 0) + 1); }
      return update.call(this, value, ...rest);
    };
    if (tied) instance.digest = function (...rest) {
      const result = digest.apply(this, rest);
      return ranking ? 'synthetic-equal-rank' : result;
    };
    return instance;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return counts;
}

for (const tied of [false, true]) test(`relation ranking hashes each candidate once per request and preserves ${tied ? 'tied' : 'SHA-256'} order`, async t => {
  const s = fixture(t, ['zz-anchor']), counts = watchRankHashes(t, ['zz-anchor'], tied);
  for (let request = 1; request <= 2; request++) {
    const job = s.requestRelations('zz-anchor', { useAI: false });
    await s.runJobs();
    assert.equal(s.store.get('jobs', job.id).state, 'done');
    assert.equal(counts.size, bridgeIds.length);
    assert.deepEqual([...counts.values()], Array(12).fill(request));
    assert.deepEqual(s.store.records('relations').reverse().map(r => r.toId),
      tied ? ['a-11', 'a-10', 'a-09'] : ['a-07', 'a-09', 'a-04']);
  }
});

test('discovery keeps rank reuse within each of its sixteen local relation calls', async t => {
  const primaryIds = Array.from({ length: 16 }, (_, i) => `zz-anchor-${i}`);
  const s = fixture(t, primaryIds), counts = watchRankHashes(t, primaryIds);
  const job = s.queue('discover', { useAI: false }, 'rank-count');
  await s.runJobs();
  assert.equal(s.store.get('jobs', job.id).state, 'done');
  assert.equal(counts.size, 16 * 12);
  assert.deepEqual([...counts.values()], Array(192).fill(1));
  assert.equal(s.store.get('schedule', 'discoveryCursor').offset, 16);
});
