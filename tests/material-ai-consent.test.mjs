import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createService } from '../src/service.mjs';

const tempRoot = path.resolve(import.meta.dirname, '../.tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const extraction = { sourceTitle: '合成资料标题', candidates: [{ title: '合成观点', body: '合成观点与条件。', claims: [], claimType: 'opinion' }] };
function harness(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(tempRoot, 'material-intent-')), calls = [];
  const options = { dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'), aiOverride: {
    async generate(request) { calls.push(request); return { text: JSON.stringify(extraction) }; },
    async embed(request) { calls.push(request); throw new Error('Unexpected embedding'); },
    async research(request) { calls.push(request); throw new Error('Unexpected research'); },
    ...overrides,
  } };
  let service = createService(options);
  t.after(async () => {
    await service.close();
    assert.ok(path.resolve(root).startsWith(tempRoot + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { get service() { return service; }, calls, async reopen() { await service.close(); service = createService(options); return service; } };
}
const item = (body = '合成原文用于权限状态转换回归。') => ({ title: '', body });

test('plain capture, reads, restart and scheduled discovery create no external request or title task', async t => {
  const h = harness(t), s = h.service;
  for (const process of [false, 'true', 1]) {
    const captured = s.importItems({ items: [item(String(process))], process, research: true, generateTitle: true });
    assert.equal(captured.jobs.length, 0);
    assert.equal(s.readPublicNote(captured.notes[0].id).titleGeneration.state, 'idle');
  }
  s.store.create({ kind: 'knowledge', title: '合成知识', body: '只供本地调度。', meta: { stage: 'learning' } });
  const reopened = await h.reopen();
  await reopened.tick();
  assert.equal(h.calls.length, 0);
  assert.equal(reopened.store.records('jobs').some(j => j.type === 'title'), false);
});

for (const privacy of [undefined, 'local', 'cloud']) test(`explicit decomposition uses required text without material consent (${privacy})`, async t => {
  const h = harness(t), s = h.service;
  const { notes: [source], jobs: [job] } = s.importItems({ items: [{ ...item(), privacy }], process: true });
  await s.runJobs();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].privacy, 'cloud');
  assert.ok(h.calls[0].prompt.includes(source.body));
  assert.equal(s.store.get('jobs', job.id).state, 'done');
  assert.equal(s.getNote(source.id).body, source.body);
  assert.equal(s.getNote(source.id).title, extraction.sourceTitle);
  const publicNote = s.readPublicNote(source.id);
  assert.equal(Object.hasOwn(publicNote.meta, 'privacy'), false);
  assert.equal(Object.hasOwn(publicNote.meta, 'effectivePrivacy'), false);
  assert.equal(s.settings().ai.enabled, false, 'using an operation never enables global capabilities');
  assert.notEqual(s.getNote(source.id).meta.privacy, 'cloud', 'new notes stay conservative for rollback');
});

test('legacy queued tasks pause on upgrade; clicking decomposition renews only that explicit task', async t => {
  const h = harness(t), s = h.service;
  const a = s.importItems({ items: [item('合成旧资料甲')] }).notes[0];
  const b = s.importItems({ items: [item('合成旧资料乙')] }).notes[0];
  for (const note of [a, b]) {
    const job = s.queue('process', { noteId: note.id, hash: note.hash, research: false }, `process:${note.id}:${note.hash}`);
    delete job.outboundIntentVersion;
    s.store.put('jobs', job.id, job);
  }
  const upgraded = await h.reopen();
  assert.ok(upgraded.store.records('jobs').every(j => j.state === 'waiting' && j.code === 'OUTBOUND_INTENT_REQUIRED'));
  await upgraded.runJobs(); assert.equal(h.calls.length, 0);
  const active = upgraded.processNote(a.id);
  assert.equal(active.state, 'queued');
  await upgraded.runJobs(); assert.equal(h.calls.length, 1);
  assert.equal(upgraded.store.records('jobs').find(j => j.payload.noteId === b.id).state, 'waiting');
});

test('restored queued tasks wait even when their new-operation marker is present', async t => {
  const h = harness(t), s = h.service;
  const { jobs: [job] } = s.importItems({ items: [item()], process: true });
  const backup = s.backup(), preview = s.restore({ backup });
  s.restore({ backup, preview: false, token: preview.token });
  assert.equal(s.store.get('jobs', job.id).state, 'waiting');
  await s.runJobs(); assert.equal(h.calls.length, 0);
  s.jobAction(job.id, { action: 'retry' });
  await s.runJobs(); assert.equal(h.calls.length, 1);
});

test('legacy metadata survives reads and ignored old-client inputs without a destructive migration', t => {
  const h = harness(t), s = h.service;
  for (const privacy of ['cloud', 'local']) {
    const note = s.store.create({ kind: 'source', title: '合成旧版原文', body: '原样保留。', meta: { privacy, customProperty: '保留未知属性' } });
    const file = path.join(s.store.vaultDir, note.path), before = fs.readFileSync(file);
    s.bootstrap(); s.readPublicNote(note.id);
    const result = s.editNote(note.id, { expectedHash: note.hash, meta: { privacy: privacy === 'cloud' ? 'local' : 'cloud' } });
    assert.equal(result.hash, note.hash);
    assert.deepEqual(fs.readFileSync(file), before);
    assert.equal(s.getNote(note.id).meta.privacy, privacy);
    assert.equal(s.store.outboundPrivacy(note), 'cloud', 'metadata no longer authorizes an operation');
  }
});

test('local search and output remain local after a source has been actively decomposed', async t => {
  const h = harness(t), s = h.service;
  s.importItems({ items: [item('合成检索标识松柏')], process: true });
  await s.runJobs();
  const count = h.calls.length;
  await s.search('松柏', { mode: 'hybrid' });
  await s.ask({ question: '松柏' });
  await s.tick();
  assert.equal(h.calls.length, count);
});

for (const restart of [false, true]) test(`indexing keeps the enqueue-time list and hashes across queued changes (restart=${restart})`, async t => {
  const sent = [], h = harness(t, { async embed({ texts }) { sent.push(...texts); return { vectors: texts.map(() => [1, 0]) }; } });
  const s = h.service;
  s.updateSettings({ embedding: { enabled: true, model: 'synthetic-enqueue-snapshot' } });
  const stable = s.store.create({ kind: 'source', title: '合成未改动资料', body: 'ONLY_CAPTURED_VERSION' });
  const changed = s.store.create({ kind: 'source', title: '合成将改动资料', body: 'QUEUED_OLD_VERSION' });
  const removed = s.store.create({ kind: 'source', title: '合成将删除资料', body: 'QUEUED_DELETED_VERSION' });
  const job = s.queue('index', {}, 'enqueue-index');
  s.editNote(changed.id, { expectedHash: changed.hash, body: 'CHANGED_AFTER_QUEUE' });
  s.store.create({ kind: 'source', title: '合成后来资料', body: 'ADDED_AFTER_QUEUE' });
  s.store.delete(removed.id, removed.hash);
  const active = restart ? await h.reopen() : s;
  await active.runJobs();
  assert.equal(active.store.get('jobs', job.id).state, 'done');
  assert.deepEqual(sent, [`${stable.title}\n${stable.body}`]);
  assert.equal(active.store.read(changed.id).body, 'CHANGED_AFTER_QUEUE');
});

test('explicit index retry captures the new intent, including new notes and revisions', async t => {
  const sent = [], h = harness(t, { async embed({ texts }) { sent.push(...texts); return { vectors: texts.map(() => [1, 0]) }; } });
  const s = h.service;
  s.updateSettings({ embedding: { enabled: true, model: 'synthetic-index-retry' } });
  const note = s.store.create({ kind: 'source', title: '合成原资料', body: 'BEFORE_RETRY' });
  const job = s.queue('index', {}, 'retry-index');
  s.store.put('jobs', job.id, { ...job, state: 'waiting' });
  const edited = s.editNote(note.id, { expectedHash: note.hash, body: 'EXPLICIT_RETRY_VERSION' });
  const added = s.store.create({ kind: 'source', title: '合成新增资料', body: 'EXPLICIT_RETRY_ADDITION' });
  const retry = s.jobAction(job.id, { action: 'retry' });
  assert.deepEqual(new Map(retry.payload.snapshots.map(n => [n.noteId, n.hash])), new Map([[edited.id, edited.hash], [added.id, added.hash]]));
  await s.runJobs();
  assert.equal(sent.length, 2);
  assert.ok(sent.some(text => text.includes('EXPLICIT_RETRY_VERSION')));
  assert.ok(sent.some(text => text.includes('EXPLICIT_RETRY_ADDITION')));
});

test('retained index jobs without an enqueue snapshot wait until an explicit retry', async t => {
  const sent = [], h = harness(t, { async embed({ texts }) { sent.push(...texts); return { vectors: texts.map(() => [1, 0]) }; } });
  const s = h.service;
  s.updateSettings({ embedding: { enabled: true, model: 'synthetic-old-index' } });
  s.store.create({ kind: 'source', title: '合成旧任务资料', body: 'LEGACY_INDEX_SOURCE' });
  const job = s.queue('index', {}, 'legacy-index');
  delete job.payload.snapshots;
  s.store.put('jobs', job.id, job);
  const reopened = await h.reopen();
  await reopened.runJobs();
  assert.equal(sent.length, 0);
  assert.equal(reopened.store.get('jobs', job.id).code, 'OUTBOUND_INTENT_REQUIRED');
  reopened.jobAction(job.id, { action: 'retry' });
  await reopened.runJobs();
  assert.equal(sent.length, 1);
});

for (const action of ['decompose', 'task-retry']) test(`resuming legacy research uses the current action (${action})`, async t => {
  const sent = [], h = harness(t, {
    async generate() { sent.push('generate'); return { text: JSON.stringify({ ...extraction, candidates: [{ ...extraction.candidates[0], claims: ['合成待核验主张'] }] }) }; },
    async researchBatch({ claims }) { sent.push('research'); return { results: claims.map(claim => ({ claim, evidence: [], limitations: ['合成受控结果'] })) }; },
    async search() { sent.push('search'); throw new Error('Unexpected search'); },
    async readPage() { sent.push('fetch'); throw new Error('Unexpected fetch'); },
  });
  const source = h.service.importItems({ items: [{ ...item(), title: '合成旧联网任务' }] }).notes[0];
  const old = h.service.queue('process', { noteId: source.id, hash: source.hash, research: true }, `process:${source.id}:${source.hash}:research`);
  delete old.outboundIntentVersion;
  h.service.store.put('jobs', old.id, old);
  const s = await h.reopen();
  const job = action === 'decompose' ? s.processNote(source.id, { research: false }) : s.jobAction(old.id, { action: 'retry' });
  await s.runJobs();
  assert.equal(s.store.get('jobs', job.id).payload.research, action === 'task-retry');
  assert.deepEqual(sent, action === 'task-retry' ? ['generate', 'research'] : ['generate']);
  assert.equal(s.store.get('jobs', job.id).dedupKey, `process:${source.id}:${source.hash}${action === 'task-retry' ? ':research' : ''}`);
});
