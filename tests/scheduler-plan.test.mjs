import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createService } from '../src/service.mjs';

const tempRoot = path.resolve(import.meta.dirname, '..', '.tmp');
fs.mkdirSync(tempRoot, { recursive: true });

function harness(t, time = '2026-10-27T01:00:00.000Z') {
  const root = fs.mkdtempSync(path.join(tempRoot, 'scheduler-plan-'));
  let clock = time;
  const service = createService({
    dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'),
    learningClock: () => new Date(clock),
    aiOverride: { generate: async () => { throw new Error('No AI calls in scheduler tests'); } },
  });
  t.after(async () => {
    await service.close();
    assert.ok(root.startsWith(`${tempRoot}${path.sep}`));
    assert.match(path.basename(root), /^scheduler-plan-/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  service.updateSettings({ timezone: 'Asia/Shanghai', scheduleTime: '08:00', dailyMinutes: 25 });
  // Keep unrelated discovery work outside this synthetic scheduler fixture.
  service.store.put('schedule', 'discovery', { at: '2099-01-01T00:00:00.000Z' });
  const scans = [], writes = [], store = service.store;
  const scan = store.scan.bind(store), put = store.put.bind(store);
  t.mock.method(store, 'scan', (...args) => { const result = scan(...args); scans.push(result); return result; });
  t.mock.method(store, 'put', (namespace, key, value) => {
    if (namespace === 'plans') writes.push({ key, value });
    return put(namespace, key, value);
  });
  return {
    service, store, scans, writes,
    at(value) { clock = value; },
    reset() { scans.length = 0; writes.length = 0; },
    knowledge(title, meta = {}) {
      return store.create({ kind: 'knowledge', title, body: `【合成测试】${title}的依据与边界。`, meta: { stage: 'learning', privacy: 'local', depth: 'explain', ...meta } });
    },
    plans() { return store.records('plans').filter(plan => plan.date === clock.slice(0, 10)); },
  };
}

test('idle scheduled ticks check freshness once without rereading unchanged Markdown', async t => {
  const h = harness(t);
  h.knowledge('合成学习');
  h.store.create({ kind: 'source', title: '合成原文', body: '【合成测试】原文。' });
  await h.service.tick();
  h.reset();
  for (let i = 0; i < 3; i++) await h.service.tick();
  assert.deepEqual(h.scans.map(({ mode, checkedFiles, readFiles }) => ({ mode, checkedFiles, readFiles })),
    Array.from({ length: 3 }, () => ({ mode: 'incremental', checkedFiles: 2, readFiles: 0 })));
  h.reset();
  const today = h.service.today();
  assert.deepEqual(h.service.today(), today);
  assert.deepEqual(h.scans.map(({ mode, readFiles }) => ({ mode, readFiles })),
    [{ mode: 'incremental', readFiles: 0 }, { mode: 'incremental', readFiles: 0 }]);
  assert.equal(h.writes.length, 0);
});

test('unchanged pending, budget-deferred and paused plans cause no plan or SQLite writes', async t => {
  const h = harness(t), note = h.knowledge('合成计划', { depth: 'apply' });
  await h.service.tick();
  for (const [settings, state] of [
    [{ dailyMinutes: 25, pausedIds: [] }, 'pending'],
    [{ dailyMinutes: 5, pausedIds: [] }, 'budget_deferred'],
    [{ dailyMinutes: 25, pausedIds: [note.id] }, 'paused'],
  ]) {
    h.service.updateSettings(settings);
    await h.service.tick();
    assert.equal(h.plans()[0].state, state);
    h.reset();
    const changes = h.store.db.prepare('SELECT total_changes() AS count').get().count;
    for (let i = 0; i < 3; i++) await h.service.tick();
    assert.equal(h.writes.length, 0, `${state} plans should not be rewritten`);
    assert.equal(h.store.db.prepare('SELECT total_changes() AS count').get().count, changes);
  }
});

test('scheduled plans pick up internal edits, external metadata edits, moves and removal', async t => {
  const h = harness(t), note = h.knowledge('合成原题');
  await h.service.tick();
  const saved = h.store.update(note.id, { expectedHash: note.hash, title: '合成新题' });
  await h.service.tick();
  assert.equal(h.plans()[0].title, '合成新题');
  const file = path.join(h.store.vaultDir, saved.path), original = fs.statSync(file);
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(raw.includes('depth: explain'));
  fs.writeFileSync(file, raw.replace('depth: explain', 'depth: apply  '));
  fs.utimesSync(file, original.atime, original.mtime);
  await h.service.tick();
  assert.equal(h.plans()[0].minutes, 8, 'same-size edit with restored mtime must be detected');
  const moved = path.join(path.dirname(file), 'synthetic-moved.md');
  fs.renameSync(file, moved);
  await h.service.tick();
  assert.equal(h.plans()[0].state, 'pending');
  assert.equal(h.store.read(note.id).path.endsWith('synthetic-moved.md'), true);
  fs.unlinkSync(moved);
  await h.service.tick();
  assert.equal(h.plans()[0].state, 'paused');
});

test('due reviews, settings and local day changes keep their scheduling semantics', async t => {
  const h = harness(t, '2026-10-27T00:59:59.000Z');
  const due = h.knowledge('合成到期'), fresh = h.knowledge('合成新学');
  h.service.updateSettings({ dailyMinutes: 5 });
  h.store.put('reviews', due.id, { noteId: due.id, dueAt: '2026-10-27T01:00:00.000Z' });
  await h.service.tick();
  assert.deepEqual(h.plans().map(p => p.noteId), [fresh.id]);
  h.at('2026-10-27T01:00:00.000Z');
  await h.service.tick();
  assert.equal(h.plans().find(p => p.noteId === due.id).state, 'pending');
  assert.equal(h.plans().find(p => p.noteId === fresh.id).state, 'budget_deferred');
  h.service.planAction(`2026-10-27:${due.id}`, { action: 'skip' });
  await h.service.tick();
  assert.equal(h.plans().find(p => p.noteId === due.id).state, 'skip');
  assert.equal(h.plans().find(p => p.noteId === fresh.id).state, 'pending');
  h.service.updateSettings({ pausedIds: [fresh.id] });
  await h.service.tick();
  assert.equal(h.plans().find(p => p.noteId === fresh.id).state, 'paused');
  h.service.updateSettings({ pausedIds: [], dailyMinutes: 10, scheduleTime: '00:00' });
  h.at('2026-10-27T15:59:59.000Z');
  await h.service.tick();
  assert.equal(h.service.today().date, '2026-10-27');
  h.at('2026-10-27T16:00:00.000Z');
  await h.service.tick();
  assert.deepEqual(h.service.today().items.map(p => [p.noteId, p.state]), [[due.id, 'pending'], [fresh.id, 'pending']]);
  assert.equal(h.service.today().date, '2026-10-28');
});

test('freshness checks before schedule time and periodic full reconciliation remain active', async t => {
  const h = harness(t, '2026-10-27T00:00:00.000Z'), note = h.knowledge('合成未安排');
  h.service.updateSettings({ scheduleTime: '09:00' });
  await h.service.tick();
  assert.equal(h.plans().length, 0);
  const saved = h.store.update(note.id, { expectedHash: note.hash, title: '合成已修改' });
  const file = path.join(h.store.vaultDir, saved.path);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('depth: explain', 'depth: apply'));
  await h.service.tick();
  assert.equal(h.store.read(note.id).meta.depth, 'apply');
  h.at('2026-10-27T01:00:00.000Z');
  await h.service.tick();
  assert.equal(h.plans()[0].minutes, 8);
  h.store.lastFullScan = Date.now() - 60_001;
  h.reset();
  await h.service.tick();
  assert.deepEqual(h.scans.map(({ mode, readFiles }) => ({ mode, readFiles })), [{ mode: 'full', readFiles: 1 }]);
  h.reset();
  await h.service.tick();
  assert.deepEqual(h.scans.map(({ mode, readFiles }) => ({ mode, readFiles })), [{ mode: 'incremental', readFiles: 0 }]);
});
