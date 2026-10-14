import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createService } from '../src/service.mjs';

function harness(t) {
  fs.mkdirSync('.tmp', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('.tmp/library-search-state-'));
  assert.ok(root.startsWith(path.resolve('.tmp') + path.sep));
  const service = createService({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault') });
  t.after(async () => { await service.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return service;
}

const knowledge = (service, title, body, meta = {}) => service.store.create({
  kind: 'knowledge', title, body, meta: { stage: 'candidate', privacy: 'local', depth: 'find', ...meta },
});
const ids = values => [...values].sort();

test('library reports exact child matches without treating retained source-group siblings as matches', t => {
  const service = harness(t);
  const source = service.importItems({ items: [{ title: '合成原文', body: '合成原文只负责保留来源。' }] }).notes[0];
  const match = knowledge(service, '唯一关键词甲', '合成知识甲正文。', { sources: [{ id: source.id, role: 'input' }] });
  const sibling = knowledge(service, '合成知识乙', '合成知识乙正文。', { sources: [{ id: source.id, role: 'input' }] });
  const data = service.library({ q: '唯一关键词甲' });
  assert.equal(data.groups.length, 1);
  assert.equal(data.groups[0].source.id, source.id);
  assert.deepEqual(ids(data.groups[0].children.map(note => note.id)), ids([match.id, sibling.id]));
  assert.deepEqual(data.matchingIds, [match.id]);
  assert.deepEqual(data.standalone, []);
});

test('library reports a source hit distinctly from its children and retains stable recommendation links', t => {
  const service = harness(t);
  const source = service.importItems({ items: [{ title: '独特原文检索词', body: '合成原文正文。' }] }).notes[0];
  const child = knowledge(service, '合成待核验知识', '合成待核验内容。', {
    sources: [{ id: source.id, role: 'input' }], researchLimitations: ['合成待核验说明'],
  });
  const data = service.library({ q: '独特原文检索词' });
  assert.deepEqual(data.matchingIds, [source.id]);
  assert.equal(data.groups[0].children[0].id, child.id);
  const suggestion = service.recommendations().suggestions.find(item => item.noteId === child.id);
  assert.equal(suggestion.type, 'research');
  assert.equal(suggestion.sourceId, source.id);
});

test('library match IDs use the existing title/body and case-insensitive filters for standalone notes', t => {
  const service = harness(t);
  const byTitle = knowledge(service, 'SyntheticTitleNeedle', '合成正文甲。');
  const byBody = knowledge(service, '合成知识乙', '合成正文中有 SyntheticBodyNeedle。');
  knowledge(service, '合成知识丙', '无目标关键词的合成正文。');
  for (const [q, note] of [['synthetictitleneedle', byTitle], ['syntheticbodyneedle', byBody]]) {
    const data = service.library({ q });
    assert.deepEqual(data.matchingIds, [note.id]);
    assert.deepEqual(data.standalone.map(item => item.id), [note.id]);
    assert.equal(data.groups.length, 0);
  }
});

test('library has no matches for an absent query and restores exact category/stage matches after clearing', t => {
  const service = harness(t);
  const source = service.importItems({ items: [{ title: '合成来源', body: '合成来源正文。' }] }).notes[0];
  const candidate = knowledge(service, '合成候选', '合成候选正文。', { sources: [{ id: source.id, role: 'input' }] });
  const reference = knowledge(service, '合成查阅', '合成查阅正文。', { stage: 'reference' });
  const absent = service.library({ q: '不存在的合成检索词' });
  assert.deepEqual(absent, { groups: [], standalone: [], matchingIds: [] });
  assert.deepEqual(ids(service.library({ q: '' }).matchingIds), ids([source.id, candidate.id, reference.id]));
  assert.deepEqual(service.library({ q: '', kind: 'knowledge', stage: 'candidate' }).matchingIds, [candidate.id]);
  assert.deepEqual(service.library({ q: '', kind: 'source' }).matchingIds, [source.id]);
  assert.deepEqual(ids(service.library().matchingIds), ids([source.id, candidate.id, reference.id]));
});

test('internal excerpts never enter library match IDs and merge suggestions identify both notes by stable ID', t => {
  const service = harness(t);
  const body = '这两条合成知识正文完全相同，用来验证稳定编号的重复知识建议。';
  const first = knowledge(service, '合成同名知识', body);
  const second = knowledge(service, '合成同名知识', body);
  const excerpt = service.store.create({ kind: 'source', title: '唯一内部核验词', body: '合成内部核验正文。', meta: { excerptOnly: true } });
  assert.deepEqual(service.library({ q: '唯一内部核验词' }).matchingIds, []);
  assert.ok(!service.library().matchingIds.includes(excerpt.id));
  assert.deepEqual(ids(service.library({ q: '合成同名知识' }).matchingIds), ids([first.id, second.id]));
  const merge = service.recommendations().suggestions.find(item => item.type === 'merge');
  assert.deepEqual(ids([merge.noteId, merge.relatedId]), ids([first.id, second.id]));
});
