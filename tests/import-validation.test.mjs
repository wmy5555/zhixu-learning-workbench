import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createService } from '../src/service.mjs';

function fixture(t) {
  const parent = path.resolve(import.meta.dirname, '../.tmp');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'import-validation-'));
  const service = createService({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'), aiOverride: {
    generate: async () => { throw new Error('Synthetic imports must not call external services'); },
  } });
  t.after(async () => { await service.close(); assert.equal(path.dirname(root), parent); fs.rmSync(root, { recursive: true, force: true }); });
  return service;
}

for (const [label, invalid] of [
  ['blank text', { body: ' \n\t ' }],
  ['oversized text', { body: '合'.repeat(500001) }],
  ['null item', null],
]) test(`import rejects a later ${label} before changing earlier notes or queuing processing`, t => {
  const service = fixture(t);
  const original = service.importItems({ items: [{ title: '合成已有原文', body: '已保存的合成正文。', platform: '原始来源' }] }).notes[0];
  const history = service.store.history(original.id);
  assert.throws(() => service.importItems({ items: [
    { title: '相同原文的新出处', body: original.body, platform: '不应被记录的来源' },
    { title: '不应先保存的合成原文', body: '整批输入合法后才能保存。' },
    invalid,
  ], process: true }), { code: 'INVALID', status: 400 });
  assert.equal(service.store.list().length, 1);
  assert.deepEqual(service.store.read(original.id), original);
  assert.deepEqual(service.store.history(original.id), history);
  assert.deepEqual(service.store.records('jobs'), []);
});

test('a valid batch retains each source and returns its processing receipts', t => {
  const service = fixture(t);
  const items = [
    { title: '合成资料甲', body: '甲', platform: '本地合成', locator: '第一行' },
    { title: '合成资料乙', body: '另一份完整合成原文。', author: '合成作者', url: 'https://example.invalid/source' },
  ];
  const result = service.importItems({ items, process: true });
  assert.equal(result.notes.length, 2);
  assert.equal(result.jobs.length, 2);
  for (let i = 0; i < items.length; i++) {
    assert.equal(result.notes[i].body, items[i].body);
    assert.equal(result.notes[i].meta.origins.length, 1);
    assert.equal(result.jobs[i].payload.noteId, result.notes[i].id);
    assert.equal(result.jobs[i].state, 'queued');
  }
  assert.equal(result.notes[0].meta.locator, '第一行');
  assert.equal(result.notes[1].meta.author, '合成作者');
});
