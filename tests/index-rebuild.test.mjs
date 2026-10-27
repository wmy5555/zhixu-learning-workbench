import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createService } from '../src/service.mjs';

const temp = path.resolve(import.meta.dirname, '../.tmp');
function harness(t, embed) {
  fs.mkdirSync(temp, { recursive: true });
  const root = fs.mkdtempSync(path.join(temp, 'index-rebuild-'));
  const service = createService({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'), aiOverride: {
    embed: embed || (() => { throw new Error('unexpected embedding request'); }),
  } });
  t.after(async () => {
    await service.close();
    assert.equal(path.dirname(root), temp);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return service;
}
const note = (s, id, body = 'SYNTHETIC_BODY', meta = {}, kind = 'knowledge') => s.store.create({ id, kind, title: id, body, meta: { stage: 'candidate', ...meta } });
const chunks = s => s.store.db.prepare('SELECT * FROM index_chunks ORDER BY noteId,id').all().map(row => ({ ...row }));
function countScans(s) {
  const scan = s.store.scan.bind(s.store), results = [];
  s.store.scan = (...args) => { const result = scan(...args); results.push(result); return result; };
  return results;
}

for (const enabled of [false, true]) test(`index rebuild shares one scan across notes without embedding awaits (enabled=${enabled})`, async t => {
  const s = harness(t);
  s.updateSettings({ embedding: { enabled, model: 'offline-index' } });
  for (let i = 0; i < 24; i++) note(s, `note-${i}`);
  if (enabled) s.store.db.prepare('UPDATE index_chunks SET vector=?,model=?').run('[1,0]', 'offline-index');
  const expected = chunks(s), job = s.queue('index', {}, 'synchronous-rebuild');
  if (!enabled) s.store.db.exec('DELETE FROM index_chunks');
  const scans = countScans(s);
  await s.runJobs();
  assert.deepEqual(chunks(s), expected, 'rebuild restores local chunks and preserves reusable vectors');
  assert.equal(s.store.get('jobs', job.id).state, 'done');
  assert.equal(s.store.get('jobs', job.id).progress, 100);
  assert.equal(scans.length, 1, 'a synchronous batch must not read the whole vault once per note');
  assert.equal(scans.reduce((sum, scan) => sum + scan.readFiles, 0), 24);
});

test('index rebuild refreshes after awaits and keeps external edits, identity and reference checks', async t => {
  const started = Promise.withResolvers(), resume = Promise.withResolvers(), sent = [];
  const s = harness(t, async ({ texts }) => {
    sent.push(texts);
    if (sent.length === 1) { started.resolve(); await resume.promise; }
    return { vectors: texts.map(() => [1, 0]) };
  });
  s.updateSettings({ embedding: { enabled: true, model: 'offline-index' } });
  // Store order is newest first: first, edited, gone, moved, duplicate, topic, reference.
  const reference = note(s, 'reference', 'REFERENCE_BODY', {}, 'source');
  note(s, 'topic', 'TOPIC_BODY', { noteIds: [reference.id] }, 'topic');
  const duplicate = note(s, 'duplicate'), moved = note(s, 'moved');
  const gone = note(s, 'gone'), edited = note(s, 'edited'), first = note(s, 'first');
  const job = s.queue('index', {}, 'async-rebuild'), scans = countScans(s);
  const running = s.runJobs();
  await started.promise;
  const file = n => path.join(s.store.vaultDir, n.path);
  const editBody = (n, body) => fs.writeFileSync(file(n), fs.readFileSync(file(n), 'utf8').replace('SYNTHETIC_BODY', body));
  editBody(first, 'CURRENT_EDIT');
  editBody(edited, 'LATER_EDIT');
  fs.unlinkSync(file(gone));
  fs.renameSync(file(moved), path.join(s.store.vaultDir, 'renamed.md'));
  fs.copyFileSync(file(duplicate), path.join(s.store.vaultDir, 'duplicate.md'));
  fs.writeFileSync(file(reference), '---\nid: reference\nkind: source\ntitle: reference\nmanagedLinkIds: [missing-reference]\n---\nREFERENCE_BODY');
  resume.resolve();
  await running;
  assert.equal(s.store.get('jobs', job.id).state, 'done');
  assert.deepEqual(sent, [['first\nSYNTHETIC_BODY'], ['moved\nSYNTHETIC_BODY']], 'only unchanged, available material is sent, in the original order');
  assert.deepEqual(chunks(s).map(({ noteId, body, vector, model }) => ({ noteId, body, vector, model })), [
    { noteId: 'edited', body: 'edited\nLATER_EDIT', vector: null, model: null },
    { noteId: 'first', body: 'first\nCURRENT_EDIT', vector: null, model: null },
    { noteId: 'moved', body: 'moved\nSYNTHETIC_BODY', vector: '[1,0]', model: 'offline-index' },
    { noteId: 'reference', body: 'reference\nREFERENCE_BODY', vector: null, model: null },
    { noteId: 'topic', body: 'topic\nTOPIC_BODY', vector: null, model: null },
  ]);
  assert.equal(s.store.read('moved').path, 'renamed.md');
  assert.equal(s.store.outboundPrivacy(s.store.read('topic')), 'local');
  assert.ok(s.store.conflicts.some(conflict => conflict.id === 'duplicate'));
  assert.equal(scans.length, 3, 'one opening scan and one fresh scan after each embedding response');
  assert.equal(scans.reduce((sum, scan) => sum + scan.readFiles, 0), 21);
});

for (const malformed of [false, true]) test(`failed index embedding stops and explicit retry refreshes material (malformed=${malformed})`, async t => {
  let fail = true;
  const sent = [];
  const s = harness(t, async ({ texts }) => {
    sent.push(texts);
    if (fail) {
      if (malformed) return { vectors: [] };
      throw Object.assign(new Error('synthetic embedding failure'), { code: 'SYNTHETIC_FAILURE' });
    }
    return { vectors: texts.map(() => [1, 0]) };
  });
  s.updateSettings({ embedding: { enabled: true, model: 'offline-index' } });
  note(s, 'later');
  const first = note(s, 'first'), job = s.queue('index', {}, 'retry-rebuild');
  await s.runJobs();
  assert.equal(s.store.get('jobs', job.id).state, 'failed');
  assert.equal(s.store.get('jobs', job.id).code, malformed ? 'INVALID' : 'SYNTHETIC_FAILURE');
  assert.equal(sent.length, 1);
  assert.ok(chunks(s).every(chunk => chunk.vector === null));
  s.store.update(first.id, { expectedHash: first.hash, body: 'EXPLICIT_RETRY_BODY' });
  fail = false;
  s.jobAction(job.id, { action: 'retry' });
  await s.runJobs();
  assert.equal(s.store.get('jobs', job.id).state, 'done');
  assert.equal(s.store.get('jobs', job.id).attempts, 2);
  assert.deepEqual(sent, [['first\nSYNTHETIC_BODY'], ['first\nEXPLICIT_RETRY_BODY'], ['later\nSYNTHETIC_BODY']]);
  assert.ok(chunks(s).every(chunk => chunk.vector === '[1,0]' && chunk.model === 'offline-index'));
});

test('cancelling an in-flight index request preserves cancellation and stops later embedding', async t => {
  const started = Promise.withResolvers();
  const s = harness(t, ({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('synthetic abort'), { code: 'CANCELLED' })), { once: true });
    started.resolve();
  }));
  s.updateSettings({ embedding: { enabled: true, model: 'offline-index' } });
  note(s, 'later'); note(s, 'first');
  const job = s.queue('index', {}, 'cancel-rebuild'), running = s.runJobs();
  await started.promise;
  s.jobAction(job.id, { action: 'cancel' });
  await running;
  assert.equal(s.store.get('jobs', job.id).state, 'cancelled');
  assert.ok(chunks(s).every(chunk => chunk.vector === null));
});
