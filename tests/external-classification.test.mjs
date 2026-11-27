import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../src/server.mjs';
import test from 'node:test';
import { createService } from '../src/service.mjs';
import { unknownClassificationFields } from '../public/note-classification.mjs';

const root = path.resolve(import.meta.dirname, '../.tmp');
function fixture(t) {
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(path.join(root, 'external-classification-'));
  const config = { dataDir: path.join(dir, 'data'), vaultDir: path.join(dir, 'vault') };
  let service = createService(config);
  t.after(async () => { await service.close(); rmSync(dir, { recursive: true, force: true }); });
  return { get service() { return service; }, async reopen() { await service.close(); service = createService(config); },
    file(name) { return path.join(config.vaultDir, name + '.md'); } };
}
function external(h, id, meta) {
  const raw = '---\r\n' + JSON.stringify({ id, title: '测试原文', ...meta }) + '\r\n---\r\n带有原始空格。  \r\n# 第二节\r\n';
  writeFileSync(h.file(id), raw);
  return raw;
}

test('unknown external values stay readable and byte-exact; reopening repairs an old knowledge projection', async t => {
  const h = fixture(t);
  const label = { first: 3, nested: ['原始值'] };
  const raw = external(h, 'external', { kind: label, stage: 42, depth: null });
  external(h, 'legacy-default', {});
  external(h, 'healthy', { kind: 'knowledge', stage: 'learning', depth: 'explain' });
  const displayed = h.service.readPublicNote('external');
  assert.deepEqual(displayed.kind, label);
  assert.equal(displayed.meta.stage, 42); assert.equal(displayed.meta.depth, null);
  assert.deepEqual(unknownClassificationFields(displayed), ['kind','stage','depth']);
  assert.deepEqual(unknownClassificationFields(h.service.getNote('legacy-default')), []);
  assert.equal(h.service.getNote('legacy-default').kind, 'knowledge');
  const row = h.service.store.row('external');
  const oldProjection = JSON.parse(row.json); oldProjection.kind = 'knowledge';
  h.service.store.db.prepare('UPDATE notes SET json=? WHERE id=?').run(JSON.stringify(oldProjection), 'external');
  await h.reopen();
  assert.deepEqual(h.service.store.read('external').kind, label);
  assert.deepEqual(h.service.store.readPersisted('external').kind, label);
  assert.equal(readFileSync(h.file('external'), 'utf8'), raw);
  assert.ok(h.service.bootstrap().notes.some(n => n.id === 'healthy'));
  assert.throws(() => h.service.startStudy({ noteId: 'external' }), { code: 'CLASSIFICATION_REQUIRED' });
  assert.equal(h.service.store.records('sessions').length, 0);
});

test('safe unknown labels round-trip in a full backup; confirmation is exact and hash-bound without moving the file', t => {
  const h = fixture(t), destination = fixture(t);
  const raw = external(h, 'source-file', { kind: '旧资料', stage: '自定阶段', depth: '自定目标', topic: '原主题' });
  const original = h.service.getNote('source-file'), backup = h.service.backup();
  const preview = destination.service.restore({ backup, preview: true });
  destination.service.restore({ backup, preview: false, token: preview.token });
  assert.equal(readFileSync(destination.file('source-file'), 'utf8'), raw);
  assert.deepEqual(destination.service.getNote('source-file').kind, original.kind);
  const s = h.service, correct = { kind: 'knowledge', stage: 'learning', depth: 'explain' };
  const confirm = (replacement, hash = original.hash) => s.confirmClassification(original.id, { expectedHash: hash, classification: replacement });
  assert.throws(() => confirm({ kind: 'knowledge' }), { code: 'INVALID' });
  assert.throws(() => confirm({ ...correct, kind: 'unknown' }), { code: 'INVALID' });
  assert.throws(() => confirm({ ...correct, stage: 'core' }), /先以自己的语言确认/);
  assert.throws(() => confirm({ ...correct, title: 'overwrite' }), { code: 'INVALID' });
  assert.throws(() => confirm(correct, 'stale'), { code: 'CONFLICT' });
  assert.equal(readFileSync(h.file('source-file'), 'utf8'), raw);
  const saved = confirm(correct);
  assert.equal(saved.path, original.path); assert.equal(saved.body, original.body);
  assert.equal(saved.meta.topic, '原主题'); assert.deepEqual(unknownClassificationFields(saved), []);
  assert.ok(s.store.history(saved.id).some(v => v.hash === original.hash));
  assert.equal(s.startStudy({ noteId: saved.id }).noteId, saved.id);
  assert.throws(() => confirm(correct), { code: 'CONFLICT' });
});

test('old study receipts remain readable while unknown depth blocks fresh answers, hints, grading and promotion', async t => {
  const h = fixture(t), s = h.service;
  external(h, 'material', { kind: 'knowledge', stage: 'learning', depth: 'explain' });
  const old = s.startStudy({ noteId: 'material', requestId: 'old-start' });
  const pending = s.answerStudy(old.id, { answer: '保留之前已提交的答案。', requestId: 'old-answer' });
  const second = s.startStudy({ noteId: 'material', requestId: 'other-start' });
  external(h, 'material', { kind: 'knowledge', stage: 'learning', depth: '未来深度' });
  assert.equal(s.startStudy({ noteId: 'material', requestId: 'old-start' }).id, old.id);
  assert.equal(s.answerStudy(old.id, { answer: '保留之前已提交的答案。', requestId: 'old-answer' }).turns.length, 1);
  const current = s.getNote('material');
  assert.throws(() => s.answerStudy(second.id, { answer: '新答题', requestId: 'new-answer' }), { code: 'CLASSIFICATION_REQUIRED' });
  assert.throws(() => s.hintStudy(second.id), { code: 'CLASSIFICATION_REQUIRED' });
  assert.throws(() => s.confirmStudy(old.id, { body: '不应写入' }), { code: 'CLASSIFICATION_REQUIRED' });
  assert.throws(() => s.promote('material', { stage:'learning', depth:'apply' }), { code: 'CLASSIFICATION_REQUIRED' });
  assert.throws(() => s.editNote('material', { expectedHash: current.hash, meta: { depth: 'apply' } }), { code: 'CLASSIFICATION_REQUIRED' });
  assert.equal(s.session(old.id).turns[0].answer, pending.turns[0].answer);
  assert.equal(s.session(second.id).hintCount, 0);
  // Prior releases could create a session even when the Markdown already had this depth.
  const stored = s.store.get('sessions', old.id);
  s.store.put('sessions', old.id, { ...stored, sourceHash: current.hash });
  await s.runJobs();
  assert.equal(s.session(old.id).turns[0].feedback, undefined);
  assert.equal(s.store.get('jobs', pending.pendingJobId).code, 'CLASSIFICATION_REQUIRED');
  const completedTurn = { ...stored.turns[0], feedback: { assessment: 'correct', feedback: '先前的合成反馈' } };
  s.store.put('sessions', old.id, { ...stored, sourceHash: current.hash, pendingJobId: null, status: 'feedback', turns: [completedTurn] });
  assert.throws(() => s.finishStudy(old.id), { code: 'CLASSIFICATION_REQUIRED' });
  assert.equal(s.store.get('studyEvidence', old.id), null);

  const plan = s.today();
  assert.ok(!plan.items.some(p => p.noteId === current.id && p.state === 'pending'));
  assert.match(plan.unavailable.find(n => n.noteId === current.id).reason, /分类尚未确认/);
});

test('classification confirmation requires the current public version and the local authenticated write channel', async t => {
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(path.join(root, 'http-external-classification-')), vault = path.join(dir, 'vault');
  const app = createApp({ dataDir: path.join(dir, 'data'), vaultDir: vault, scheduler: false });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const auth = await fetch(base + '/api/session'), cookie = auth.headers.get('set-cookie').split(';')[0];
  const { csrf } = await auth.json();
  const file = path.join(vault, 'file.md');
  const raw = '---\nid: external-http\nkind: knowledge\nstage: learning\ndepth: 旧学习目标\n---\n正文与用户的追加保留。';
  writeFileSync(file, raw);
  const hiddenFile = path.join(vault, 'hidden.md');
  writeFileSync(hiddenFile, '---\nid: hidden-excerpt\nkind: source\nstage: 外部分类\nexcerptOnly: true\n---\n内部核验原文');
  const hiddenHash = app.service.getNote('hidden-excerpt').hash;
  const denied = await fetch(base + '/api/notes/hidden-excerpt/classification', {
    method:'POST', headers:{ Cookie: cookie, 'X-CSRF-Token':csrf, 'Content-Type':'application/json' },
    body: JSON.stringify({ expectedHash:hiddenHash, classification:{ stage:'reference' } }),
  });
  assert.equal(denied.status, 404); assert.ok(!(await denied.text()).includes('内部核验原文'));
  const url = base + '/api/notes/external-http';
  const read = async () => (await fetch(url, { headers: { Cookie: cookie } })).json();
  const submit = (expectedHash, classification, headers = { Cookie: cookie, 'X-CSRF-Token': csrf }) =>
    fetch(url + '/classification', { method: 'POST', headers: { ...headers, 'Content-Type':'application/json' }, body: JSON.stringify({ expectedHash, classification }) });
  const old = await read();
  assert.deepEqual(unknownClassificationFields(old), ['depth']);
  assert.equal((await submit(old.hash, { depth: 'apply' }, { Cookie: cookie })).status, 403);
  assert.equal((await submit(old.hash, { depth:'explain', stage:'core' })).status, 400);
  writeFileSync(file, raw + '\n用户新写下的一行。');
  assert.equal((await submit(old.hash, { depth: 'apply' })).status, 409);
  const latest = await read(), res = await submit(latest.hash, { depth: 'apply' });
  assert.equal(res.status, 200);
  const updated = await res.json();
  assert.equal(updated.meta.depth, 'apply'); assert.equal(updated.meta.stage, 'learning');
  assert.equal(updated.body, latest.body); assert.notEqual(updated.hash, old.hash);
  assert.equal((await submit(latest.hash, { depth: 'explain' })).status, 409);
});

test('steady-state hints and answers read only session materials, and a changed target triggers reconciliation', t => {
  const h = fixture(t), s = h.service, store = s.store;
  for (let i = 0; i < 25; i++) external(h, 'unrelated-' + i, { kind: 'knowledge' });
  external(h, 'target', { kind: 'knowledge', stage: 'learning', depth:'explain' });
  const study = s.startStudy({ noteId: 'target' });
  const scan = t.mock.method(store, 'scan'), persisted = t.mock.method(store, 'readPersisted');
  s.hintStudy(study.id);
  s.answerStudy(study.id, { requestId:'current', answer:'合成回答。' });
  assert.equal(scan.mock.callCount(), 0);
  assert.deepEqual(persisted.mock.calls.map(call => call.arguments[0]), ['target', 'target']);
  external(h, 'target', { kind: 'knowledge', stage: 'learning', depth: '新目标' });
  assert.throws(() => s.hintStudy(study.id), { code: 'CLASSIFICATION_REQUIRED' });
  assert.equal(scan.mock.callCount(), 1);
});
