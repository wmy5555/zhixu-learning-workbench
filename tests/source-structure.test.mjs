import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createService } from '../src/service.mjs';
import { normalizeStructure, structureRecord } from '../src/source-structure.mjs';
import { layoutSourceMap } from '../public/source-map.mjs';

fs.mkdirSync(path.resolve('.tmp'), { recursive: true });
function setup(t, generate = async () => ({ text: '{}' }), practice = false) {
  const root = fs.mkdtempSync(path.resolve('.tmp/structure-'));
  const calls = [];
  const service = createService({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'), practice,
    aiOverride: { generate: async options => { calls.push(options); return generate(options); }, withBudget: async (_, fn) => fn() } });
  t.after(async () => { await service.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { service, calls };
}
const candidates = [{ title: '观点', body: '观点需要可追溯的依据。', claims: [] }, { title: '摘录', body: '保留对应的原文摘录。', claims: [] }];
const edge = (from, to) => ({ from, to, type: 'support', sourceExcerpt: candidates[1].body, targetExcerpt: candidates[0].body, explanation: '摘录为观点提供可追溯依据。' });
const structure = { hierarchy: [{ child: '0', parent: null }, { child: '1', parent: '0' }], edges: [edge('1', '0')] };
function material(s, privacy = 'cloud') {
  const source = s.store.create({ kind: 'source', title: '合成读书分享', body: '观点与摘录的合成示例。', meta: { privacy } });
  const notes = candidates.map(n => s.store.create({ kind: 'knowledge', title: n.title, body: n.body, meta: { privacy, sources: [{ id: source.id, role: 'input' }], stage: 'candidate', userEdited: true } }));
  return { source, notes };
}
function forNotes(notes) { return { hierarchy: [{ child: notes[0].id, parent: null }, { child: notes[1].id, parent: notes[0].id }], edges: [edge(notes[1].id, notes[0].id)] }; }

test('new extraction produces both views with one model call and does not change source identity or confirm knowledge', async t => {
  const { service: s, calls } = setup(t, async () => ({ text: JSON.stringify({ candidates, structure }) }));
  const source = s.importItems({ items: [{ title: '合成原文', body: '测试原文', privacy: 'cloud' }] }).notes[0];
  const job = s.processNote(source.id); await s.runJobs();
  const view = s.readPublicNote(source.id);
  assert.equal(s.store.get('jobs', job.id).state, 'done'); assert.equal(calls.length, 1);
  assert.equal(view.hash, source.hash); assert.equal(view.structure.state, 'ready');
  assert.equal(view.structure.edges[0].from, view.children[1].id);
  assert.equal(view.structure.hierarchy[1].parent, view.children[0].id);
  assert.ok(view.children.every(n => n.meta.stage === 'candidate' && !n.meta.confirmedAt));
  assert.equal(s.store.records('relations').some(r => r.state === 'accepted'), false);
  s.readPublicNote(source.id); s.library(); assert.equal(calls.length, 1);
});

test('old/custom extraction outputs and invalid optional structure do not break saved decomposition', async t => {
  for (const value of [undefined, 'invalid', { edges: 'bad', hierarchy: null }]) {
    const { service: s } = setup(t, async () => ({ text: JSON.stringify({ candidates, structure: value }) }));
    const source = s.importItems({ items: [{ title: '旧格式', body: '旧格式原文', privacy: 'cloud' }], process: true });
    await s.runJobs();
    assert.equal(s.store.get('jobs', source.jobs[0].id).state, 'done');
    assert.equal(s.readPublicNote(source.notes[0].id).children.length, 2);
    assert.equal(s.readPublicNote(source.notes[0].id).structure.state, 'missing');
  }
});

test('saved extraction templates receive the structure contract in the same call for changing materials', async t => {
  for (const count of [1, 5, 8]) {
    const values = Array.from({ length: count }, (_, i) => ({ title: `新的材料 ${i}：与旧示例无关的较长标题`, body: `当前合成材料的条目 ${i}。`, claims: [] }));
    const generated = { hierarchy: values.map((_, i) => ({ child: String(i), parent: null })),
      edges: count < 2 ? [] : [{ from: '0', to: String(count - 1), type: 'sequence', explanation: '合成顺序', sourceExcerpt: values[0].body, targetExcerpt: values.at(-1).body }] };
    const { service: s, calls } = setup(t, async () => ({ text: JSON.stringify({ candidates: values, structure: generated }) }));
    s.updatePrompts({ prompts: { serviceSystem: '保留用户自定义系统说明', sourceExtract: '用户保存的旧拆解提示 {{source}}' } });
    const result = s.importItems({ items: [{ title: `替换示例 ${count}`, body: `当前资料 ${count}`, privacy: 'cloud' }], process: true });
    await s.runJobs();
    const detail = s.readPublicNote(result.notes[0].id);
    assert.equal(calls.length, 1);
    assert.match(calls[0].system, /保留用户自定义系统说明.*\n.*同一次回答.*hierarchy.*sourceExcerpt/s);
    assert.equal(calls[0].prompt, `用户保存的旧拆解提示 当前资料 ${count}`);
    assert.equal(detail.children.length, count); assert.equal(detail.structure.state, 'ready');
    assert.equal(detail.structure.hierarchy.length, count);
    if (count > 1) assert.equal(detail.structure.edges[0].to, detail.children.at(-1).id);
  }
});

test('validation removes nonexistent endpoints, invented excerpts, duplicates and hierarchy cycles, but preserves logical cycles', () => {
  const notes = candidates.map((n, i) => ({ ...n, id: String(i) }));
  const reverse = { ...edge('0', '1'), sourceExcerpt: candidates[0].body, targetExcerpt: candidates[1].body };
  const result = normalizeStructure({ hierarchy: [{ child: '0', parent: '1' }, { child: '1', parent: '0' }],
    edges: [edge('1','0'), reverse, edge('1','0'), edge('foreign','0'), { ...edge('1','0'), sourceExcerpt: '编造引文' }] }, notes);
  assert.equal(result.edges.length, 2); assert.equal(result.hierarchy.length, 1); assert.equal(result.discarded, 4);
  const layout = layoutSourceMap(notes, result.edges, result.hierarchy);
  assert.equal(layout.positions.size, 2); assert.ok(Number.isFinite(layout.height));
});

test('explicit analysis uses existing edited notes without overwriting them and survives full backup/restore', async t => {
  let notes;
  const { service: s, calls } = setup(t, async () => ({ text: JSON.stringify({ structure: forNotes(notes) }) }));
  const data = material(s); notes = data.notes;
  const hashes = [data.source, ...notes].map(n => n.hash);
  const first = s.requestSourceStructure(data.source.id);
  assert.equal(s.requestSourceStructure(data.source.id).id, first.id);
  await s.runJobs();
  assert.equal(calls.length, 1); assert.equal(s.readPublicNote(data.source.id).structure.state, 'ready');
  assert.deepEqual([data.source, ...notes].map(n => s.getNote(n.id).hash), hashes);
  const { service: restored } = setup(t);
  const backup = s.backup(), preview = restored.restore({ backup });
  restored.restore({ backup, preview: false, token: preview.token });
  assert.equal(restored.readPublicNote(data.source.id).structure.edges.length, 1);
});

test('changes, added members and deleted members mark the graph stale without displaying obsolete excerpts', async t => {
  let notes;
  const { service: s } = setup(t, async () => ({ text: JSON.stringify({ structure: forNotes(notes) }) }));
  const data = material(s); notes = data.notes;
  s.requestSourceStructure(data.source.id); await s.runJobs();
  s.editNote(notes[0].id, { expectedHash: notes[0].hash, body: '用户后来修订的观点' });
  const view = s.readPublicNote(data.source.id).structure;
  assert.equal(view.state, 'stale'); assert.deepEqual(view.edges, []);
  s.store.create({ kind: 'knowledge', title: '新加入的条目', body: '后续手动补充', meta: { sources: [{ id: data.source.id, role: 'input' }] } });
  assert.equal(s.readPublicNote(data.source.id).structure.nodes.length, 3);
  s.store.delete(notes[1].id, notes[1].hash);
  assert.equal(s.readPublicNote(data.source.id).structure.nodes.length, 2);
});

test('failed reanalysis preserves the previously saved structure and edited notes', async t => {
  for (const failure of ['timeout', 'invalid-json', 'missing-structure']) {
    const { service: s } = setup(t, async () => {
      if (failure === 'timeout') throw Object.assign(new Error('connect ETIMEDOUT 203.0.113.10:443'), { code: 'ETIMEDOUT' });
      return { text: failure === 'invalid-json' ? 'invalid result' : '{}' };
    });
    const { source, notes } = material(s), saved = structureRecord(source, notes, forNotes(notes));
    s.store.put('sourceStructures', source.id, saved);
    const job = s.requestSourceStructure(source.id); await s.runJobs();
    assert.equal(s.store.get('jobs', job.id).state, 'failed');
    assert.deepEqual(s.store.get('sourceStructures', source.id), saved);
    assert.deepEqual(notes.map(n => s.getNote(n.id).body), notes.map(n => n.body));
    assert.equal(s.readPublicNote(source.id).structure.edges.length, 1);
  }
});

test('local-only children block external analysis and permission revocation during the call discards the result', async t => {
  const { service: local, calls } = setup(t);
  const data = material(local);
  local.editNote(data.notes[0].id, { expectedHash: data.notes[0].hash, meta: { privacy: 'local' } });
  const denied = local.requestSourceStructure(data.source.id);
  while (local.store.records('jobs').some(j => j.state === 'queued')) await local.runJobs();
  assert.equal(calls.length, 0); assert.equal(local.store.get('jobs', denied.id).code, 'PRIVACY_LOCAL');
  let finish, notes;
  const { service: s } = setup(t, () => new Promise(resolve => { finish = () => resolve({ text: JSON.stringify({ structure: forNotes(notes) }) }); }));
  const m = material(s); notes = m.notes;
  const job = s.requestSourceStructure(m.source.id), running = s.runJobs();
  s.editNote(notes[0].id, { expectedHash: notes[0].hash, meta: { privacy: 'local' } });
  finish(); await running;
  assert.equal(s.store.get('jobs', job.id).code, 'PRIVACY_LOCAL');
  assert.equal(s.store.get('sourceStructures', m.source.id), null);
});

test('cancelled and changed-snapshot jobs cannot publish; explicit retries capture the current snapshot', async t => {
  let finish, notes;
  const { service: s } = setup(t, () => new Promise(resolve => { finish = () => resolve({ text: JSON.stringify({ structure: forNotes(notes) }) }); }));
  const m = material(s); notes = m.notes;
  const first = s.requestSourceStructure(m.source.id); let running = s.runJobs();
  s.jobAction(first.id, { action: 'cancel' }); finish(); await running;
  assert.equal(s.store.get('sourceStructures', m.source.id), null);
  s.editNote(m.source.id, { expectedHash: m.source.hash, body: '更新后的合成原文' });
  const retry = s.jobAction(first.id, { action: 'retry' });
  assert.equal(retry.payload.basis.sourceHash, s.getNote(m.source.id).hash);
  running = s.runJobs(); finish(); await running;
  assert.equal(s.readPublicNote(m.source.id).structure.state, 'ready');
  const changed = s.requestSourceStructure(m.source.id); running = s.runJobs();
  s.editNote(m.source.id, { expectedHash: s.getNote(m.source.id).hash, body: '生成期间再次修改' });
  finish(); await running;
  assert.equal(s.store.get('jobs', changed.id).code, 'SOURCE_CHANGED');
  assert.equal(s.readPublicNote(m.source.id).structure.state, 'stale');
});

test('structure records remain isolated across formal and practice stores and reject cross-purpose restore', async t => {
  let notes;
  const { service: formal } = setup(t, async () => ({ text: JSON.stringify({ structure: forNotes(notes) }) }));
  const m = material(formal); notes = m.notes;
  formal.requestSourceStructure(m.source.id); await formal.runJobs();
  const { service: practice } = setup(t, undefined, true);
  assert.equal(practice.store.get('sourceStructures', m.source.id), null);
  assert.throws(() => practice.requestSourceStructure(m.source.id), { code: 'NOT_FOUND' });
  assert.throws(() => formal.restore({ backup: practice.backup() }), { code: 'BACKUP_PURPOSE_MISMATCH' });
  assert.equal(formal.readPublicNote(m.source.id).structure.edges.length, 1);
});

test('mind-map collapse retains independent hierarchy and all logical nodes including isolated ones', () => {
  const notes = ['a','b','c','isolated'].map(id => ({ id }));
  const hierarchy = [{ child: 'b', parent: 'a' }, { child: 'c', parent: 'b' }];
  const collapsed = layoutSourceMap(notes, [], hierarchy, 'mind', new Set(['a']));
  assert.deepEqual([...collapsed.positions.keys()].sort(), ['__source__', 'a', 'isolated']);
  const logic = layoutSourceMap(notes, [{ from: 'a', to: 'c' }], hierarchy);
  assert.equal(logic.positions.size, 4);
  assert.ok(logic.positions.get('c').y > logic.positions.get('a').y);
});

test('layouts size changing long titles and root names without overlaps or lost nodes', () => {
  for (const count of [1, 5, 8, 16]) {
    const notes = Array.from({ length: count }, (_, i) => ({ id: `sample-${i}`, title: i % 2 ? '长标题包含条件、过程、实例和适用边界'.repeat(5) : `短标题${i}` }));
    const hierarchy = notes.slice(1).map((n, i) => ({ child: n.id, parent: notes[Math.floor(i / 2)].id }));
    for (const mode of ['logic', 'mind']) {
      const layout = layoutSourceMap(notes, notes.slice(1).map((n, i) => ({ from: notes[i].id, to: n.id })), hierarchy, mode, new Set(), '任意变化的来源标题'.repeat(8));
      const positions = [...layout.positions.values()];
      assert.equal(positions.length, count + (mode === 'mind' ? 1 : 0));
      for (let i = 0; i < positions.length; i++) {
        const a = positions[i];
        assert.ok(a.x >= 0 && a.y >= 0 && a.x + layout.cardWidth <= layout.width && a.y + layout.cardHeight <= layout.height);
        for (const b of positions.slice(i + 1)) assert.ok(Math.abs(a.x - b.x) >= layout.cardWidth || Math.abs(a.y - b.y) >= layout.cardHeight, 'cards must not overlap');
      }
    }
  }
});
