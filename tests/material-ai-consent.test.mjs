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

function scopedAI(t, onGenerate = () => {}) {
  const sent = []; let packageId;
  const h = harness(t, {
    async generate(request) {
      sent.push({ capability: 'generate', ...request });
      await onGenerate(request, sent.length, h.service);
      return { text: JSON.stringify({ queries: ['SCOPE_QUERY'], relations: [], packages: [{ title: '合成学习包', problem: '范围', noteIds: [packageId], prerequisites: [], minutes: 5 }] }) };
    },
    async embed(request) { sent.push({ capability: 'embed', ...request }); return { vectors: request.texts.map(() => [1, 0]) }; },
  });
  h.service.updateSettings({ ai: { enabled: true } });
  const knowledge = (title, body) => h.service.store.create({ kind: 'knowledge', title, body, meta: { stage: 'learning', topic: title } });
  const primary = knowledge('SCOPE_QUERY 主知识', 'CAPTURED_PRIMARY'); packageId = primary.id;
  const other = knowledge('SCOPE_QUERY 比较材料', 'CAPTURED_OTHER');
  const enqueue = type => type === 'relate' ? h.service.requestRelations(primary.id, { useAI: true }) : h.service.queue(type, { useAI: true }, `scope:${type}`);
  return { h, primary, other, knowledge, enqueue, sent };
}

for (const type of ['relate', 'discover', 'topics']) for (const restart of [false, true]) test(`${type} external work keeps enqueue-time materials after changes (restart=${restart})`, async t => {
  const { h, primary, other, knowledge, enqueue, sent } = scopedAI(t);
  const changed = knowledge('SCOPE_QUERY 待修改', 'OLD_CHANGED_VERSION');
  const removed = knowledge('SCOPE_QUERY 待删除', 'REMOVED_AFTER_QUEUE');
  const job = enqueue(type);
  h.service.editNote(changed.id, { expectedHash: changed.hash, body: 'EDITED_AFTER_QUEUE' });
  knowledge('SCOPE_QUERY 后来新增', 'ADDED_AFTER_QUEUE');
  h.service.store.delete(removed.id, removed.hash);
  const s = restart ? await h.reopen() : h.service;
  await s.runJobs();
  assert.equal(s.store.get('jobs', job.id).state, 'done');
  const prompts = JSON.stringify(sent);
  assert.ok(prompts.includes(primary.body));
  assert.ok(prompts.includes(other.body));
  for (const body of ['OLD_CHANGED_VERSION', 'EDITED_AFTER_QUEUE', 'ADDED_AFTER_QUEUE', 'REMOVED_AFTER_QUEUE']) assert.equal(prompts.includes(body), false, `${type} must not send ${body}`);
});

for (const change of ['edit', 'delete']) test(`AI relation rejects a primary note changed before execution (${change})`, async t => {
  const { h, primary, enqueue, sent } = scopedAI(t);
  const job = enqueue('relate');
  if (change === 'edit') h.service.editNote(primary.id, { expectedHash: primary.hash, body: 'PRIMARY_EDITED_AFTER_QUEUE' });
  else h.service.store.delete(primary.id, primary.hash);
  await h.service.runJobs();
  assert.equal(sent.length, 0);
  assert.equal(h.service.store.get('jobs', job.id).code, 'SOURCE_CHANGED');
});

for (const type of ['relate', 'discover', 'topics']) test(`retained ${type} AI work without scope waits; explicit retry captures current versions`, async t => {
  const { h, primary, knowledge, enqueue, sent } = scopedAI(t);
  const job = enqueue(type); delete job.payload.snapshots; h.service.store.put('jobs', job.id, job);
  const s = await h.reopen();
  assert.equal(s.store.get('jobs', job.id).state, 'waiting');
  assert.equal(s.store.get('jobs', job.id).code, 'OUTBOUND_INTENT_REQUIRED');
  await s.runJobs(); assert.equal(sent.length, 0);
  const edited = s.editNote(primary.id, { expectedHash: primary.hash, body: 'PRIMARY_EXPLICIT_RETRY_VERSION' });
  const added = knowledge('SCOPE_QUERY 明确重试新增', 'ADDED_BY_EXPLICIT_RETRY');
  const retry = s.jobAction(job.id, { action: 'retry' });
  assert.equal(retry.payload.snapshots.find(n => n.noteId === primary.id).hash, edited.hash);
  assert.ok(retry.payload.snapshots.some(n => n.noteId === added.id));
  await s.runJobs();
  assert.equal(s.store.get('jobs', job.id).state, 'done');
  assert.ok(JSON.stringify(sent).includes(edited.body));
  assert.ok(JSON.stringify(sent).includes(added.body));
});

test('AI relation rechecks candidate scope after query generation and semantic lookup', async t => {
  let changed;
  const { h, primary, other, knowledge, enqueue, sent } = scopedAI(t, (_request, count, s) => {
    if (count === 1) {
      s.editNote(changed.id, { expectedHash: changed.hash, body: 'EDITED_DURING_QUERY' });
      knowledge('SCOPE_QUERY 在检索时新增', 'ADDED_DURING_QUERY');
    }
  });
  changed = knowledge('SCOPE_QUERY 检索前存在', 'BEFORE_QUERY_VERSION');
  h.service.updateSettings({ embedding: { enabled: true, model: 'synthetic-relation-scope' } });
  const job = enqueue('relate'); await h.service.runJobs();
  assert.equal(h.service.store.get('jobs', job.id).state, 'done');
  assert.ok(sent.some(r => r.capability === 'embed'), 'exercise query embedding');
  assert.ok(sent.filter(r => r.capability === 'generate').length >= 2, 'exercise second model request');
  const prompts = JSON.stringify(sent);
  assert.ok(prompts.includes(primary.body)); assert.ok(prompts.includes(other.body));
  for (const body of ['EDITED_DURING_QUERY', 'ADDED_DURING_QUERY', 'BEFORE_QUERY_VERSION']) assert.equal(prompts.includes(body), false);
});

test('AI discovery passes its original scope to nested relation lookups', async t => {
  const { h, knowledge, enqueue, sent } = scopedAI(t, (_request, count) => {
    if (count === 1) knowledge('SCOPE_QUERY 在发现后新增', 'ADDED_DURING_DISCOVERY');
  });
  const job = enqueue('discover'); await h.service.runJobs();
  assert.equal(h.service.store.get('jobs', job.id).state, 'done');
  assert.ok(sent.length >= 3, 'exercise nested relation requests');
  assert.equal(JSON.stringify(sent).includes('ADDED_DURING_DISCOVERY'), false);
});

test('non-boolean AI flags cannot bypass relation snapshots through a retained local job', async t => {
  const { h, primary, sent } = scopedAI(t);
  for (const useAI of ['true', 1]) {
    h.service.queue('relate', { noteId: primary.id, useAI }, `non-boolean:${useAI}`);
  }
  const s = await h.reopen();
  await s.runJobs(); await s.runJobs();
  assert.equal(sent.length, 0);
  assert.ok(s.store.records('jobs').every(job => job.state === 'done'));
});
