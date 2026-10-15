import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createService } from '../src/service.mjs';

const tempRoot = path.resolve(import.meta.dirname, '../.tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const extraction = { sourceTitle: '合成资料标题', candidates: [{ title: '合成观点', body: '合成观点与条件。', claims: [], claimType: 'opinion' }] };
function harness(t) {
  const root = fs.mkdtempSync(path.join(tempRoot, 'material-intent-')), calls = [];
  const options = { dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'), aiOverride: {
    async generate(request) { calls.push(request); return { text: JSON.stringify(extraction) }; },
    async embed(request) { calls.push(request); throw new Error('Unexpected embedding'); },
    async research(request) { calls.push(request); throw new Error('Unexpected research'); },
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
