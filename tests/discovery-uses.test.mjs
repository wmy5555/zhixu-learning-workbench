import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createService } from '../src/service.mjs';

const tempRoot = path.resolve(import.meta.dirname, '../.tmp');
fs.mkdirSync(tempRoot, { recursive: true });

function fixture(t, generate = async () => { throw new Error('Unexpected AI request'); }) {
  const dir = fs.mkdtempSync(path.join(tempRoot, 'discovery-uses-'));
  const service = createService({ dataDir: path.join(dir, 'data'), vaultDir: path.join(dir, 'vault'),
    aiOverride: { generate, embed: async () => { throw new Error('Unexpected embedding'); } } });
  let useReads = 0;
  const records = service.store.records.bind(service.store);
  service.store.records = namespace => {
    if (namespace === 'uses') useReads++;
    return records(namespace);
  };
  t.after(async () => {
    await service.close();
    assert.ok(dir.startsWith(tempRoot + path.sep));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { service, useReads: () => useReads };
}

for (const size of [0, 3, 40]) test(`local discovery bounds use-history reads with ${size} knowledge notes`, async t => {
  const h = fixture(t), s = h.service;
  for (let i = 0; i < size; i++) s.store.create({ id: `note-${i}`, kind: 'knowledge', title: `合成知识${i}`,
    body: `合成材料${i}，用于本地发现读取次数回归。`, meta: { stage: 'learning' } });
  if (size) s.store.put('uses', 'unconfirmed', { noteId: 'note-0', actualUse: false });
  const job = s.queue('discover', { useAI: false }, 'local');
  await s.runJobs();
  assert.equal(s.store.get('jobs', job.id).state, 'done');
  // The synchronous discovery snapshot and the later recommendations each read once.
  assert.equal(h.useReads(), size ? 2 : 1);
  const report = s.listNotes({ kind: 'report' })[0];
  assert.equal(report.meta.discoverySummary.status, 'not_requested');
  assert.equal(report.meta.relationDetail.status, 'not_requested');
  const unused = report.body.split('## 尚无实际输出使用记录\n')[1].split('\n\n')[0];
  assert.equal(unused.split('\n').length, Math.min(Math.max(size - 1, 1), 30));
  assert.doesNotMatch(unused, /合成知识0(?:\n|$)/);
  assert.equal(s.store.get('schedule', 'discoveryCursor').offset, size ? Math.min(size, 16) % size : 0);
});

test('AI discovery shares use counts without changing unused notes, selection or post-await suggestions', async t => {
  let firstReadCount, materials, calls = 0;
  const h = fixture(t, async request => {
    if (++calls === 1) {
      firstReadCount = h.useReads();
      materials = JSON.parse(request.prompt.split('\n')[1]);
      await Promise.resolve();
      // A later recommendation must see this new use, while the summary keeps its input snapshot.
      s.store.put('uses', 'during-ai', { noteId: 'c', actualUse: true, at: '2026-10-27T00:00:00.000Z' });
      return { text: JSON.stringify({ findings: [] }) };
    }
    return { text: JSON.stringify({ relations: [] }) };
  }), s = h.service;
  s.updateSettings({ ai: { enabled: true }, prompts: { discover: 'MATERIALS\n{{notes}}\nEND_MATERIALS' } });
  for (const [id, stage] of [['a', 'learning'], ['b', 'learning'],
    ['c', 'candidate'], ['d', 'learning'], ['retired', 'retired']]) {
    s.store.create({ id, kind: 'knowledge', title: id.toUpperCase(), body: `合成材料 ${id} 的独立正文。`,
      meta: { stage, topic: id === 'a' ? '主题甲' : '主题乙', depth: 'explain' } });
  }
  for (const change of s.store.records('changed')) s.store.remove('changed', change.id);
  s.store.put('changed', 'c', { id: 'c' });
  for (const [id, row] of Object.entries({ falseUse: { noteId: 'a', actualUse: false },
    legacyUse: { noteId: 'a' }, trueUse: { noteId: 'b', actualUse: true }, orphan: { noteId: 'missing' } })) {
    s.store.put('uses', id, row);
  }
  const job = s.queue('discover', { useAI: true }, 'ai');
  await s.runJobs();
  const completed = s.store.get('jobs', job.id);
  assert.equal(completed.state, 'done', completed.error);
  assert.equal(firstReadCount, 1);
  assert.equal(h.useReads(), 2);
  assert.deepEqual(materials, [
    { id: 'c', sourceIds: [], title: 'C', topic: '主题乙', useCount: 0, summary: '合成材料 c 的独立正文。' },
    { id: 'd', sourceIds: [], title: 'D', topic: '主题乙', useCount: 0, summary: '合成材料 d 的独立正文。' },
    { id: 'b', sourceIds: [], title: 'B', topic: '主题乙', useCount: 1, summary: '合成材料 b 的独立正文。' },
    { id: 'a', sourceIds: [], title: 'A', topic: '主题甲', useCount: 2, summary: '合成材料 a 的独立正文。' },
  ]);
  assert.equal(calls, 3);
  const report = s.listNotes({ kind: 'report' })[0];
  assert.equal(report.body.split('## 尚无实际输出使用记录\n')[1].split('\n\n')[0], '- D\n- C');
  assert.equal(report.meta.discoverySummary.status, 'complete');
  assert.equal(report.meta.relationDetail.status, 'complete');
  assert.equal(report.meta.recommendationIds.length, 1);
  assert.match(report.body, /- C：这条知识已被实际采用/);
});
