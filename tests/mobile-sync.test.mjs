import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../src/server.mjs';
import { MOBILE_FORMAT, newSyncState, validateTransfer, exportMobileSnapshot, applyMobileTransfer } from '../src/mobile-sync.mjs';
import { connectLocalApi, localBase, main } from '../scripts/mobile-sync.mjs';

async function fixture(t) {
  await fs.mkdir('.tmp', { recursive: true });
  const root = await fs.mkdtemp(path.resolve('.tmp', 'mobile-sync-'));
  const app = createApp({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'), scheduler: false });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { app, api: await connectLocalApi(`http://127.0.0.1:${app.server.address().port}`), state: newSyncState() };
}
const envelope = (state, notes) => ({ format: MOBILE_FORMAT, version: 1, libraryId: state?.libraryId || '', notes });
const collected = (id = 'phone-001', body = '合成手机原文') => ({ id, desktopId: '', kind: 'source', baseHash: '', dirty: true, title: '合成手机收集', body });

test('mobile collection writes only local source content and repeated transfer has one identity', async t => {
  const { app, api, state } = await fixture(t);
  const transfer = envelope(null, [collected()]);
  let saves = 0;
  const first = await applyMobileTransfer({ api, state, transfer, checkpoint: async () => { saves++; } });
  assert.equal(first.results[0].status, 'saved'); assert.equal(saves, 1);
  const note = app.service.getNote(first.notes[0].desktopId);
  assert.equal(note.meta.privacy, 'local'); assert.equal(note.kind, 'source');
  assert.equal(app.service.store.records('jobs').length, 0);
  const again = await applyMobileTransfer({ api, state, transfer });
  assert.equal(again.notes[0].desktopId, note.id);
  assert.equal(again.notes[0].baseHash, note.hash);
  assert.equal(app.service.listNotes().length, 1);
  assert.equal(app.service.getNote(note.id).meta.origins.length, 1);
});

test('selected source edits use desktop expectedHash and preserve existing metadata', async t => {
  const { app, api, state } = await fixture(t);
  const original = app.service.store.create({ kind: 'source', title: '合成原文', body: '旧正文', meta: { privacy: 'local', custom: '保留字段' } });
  const snapshot = await exportMobileSnapshot({ api, state, noteIds: [original.id] });
  const changed = { ...snapshot.notes[0], dirty: true, title: '手机改标题', body: '手机改正文', privacy: 'cloud', meta: { stage: 'core', privacy: 'cloud' } };
  const result = await applyMobileTransfer({ api, state, transfer: envelope(state, [changed]) });
  assert.equal(result.results[0].status, 'saved');
  const updated = app.service.getNote(original.id);
  assert.equal(updated.body, changed.body); assert.equal(updated.meta.custom, '保留字段');
  assert.equal(updated.meta.privacy, 'local'); assert.notEqual(updated.meta.stage, 'core');
  assert.ok(updated.hash !== original.hash);
});

test('concurrent desktop edits retain both versions and deletion never recreates a source', async t => {
  const { app, api, state } = await fixture(t);
  const original = app.service.store.create({ kind: 'source', title: '合成并发', body: '共同基线' });
  const snapshot = await exportMobileSnapshot({ api, state, noteIds: [original.id] });
  const mobile = { ...snapshot.notes[0], dirty: true, body: '手机版本' };
  const desktop = app.service.editNote(original.id, { expectedHash: original.hash, body: '电脑版本' });
  let result = await applyMobileTransfer({ api, state, transfer: envelope(state, [mobile]) });
  assert.equal(result.results[0].status, 'conflict'); assert.equal(result.notes[0].body, '电脑版本');
  assert.equal(mobile.body, '手机版本'); assert.equal(app.service.getNote(original.id).hash, desktop.hash);
  app.service.store.delete(original.id, desktop.hash);
  result = await applyMobileTransfer({ api, state, transfer: envelope(state, [mobile]) });
  assert.equal(result.results[0].status, 'conflict'); assert.equal(result.notes.length, 0);
  assert.equal(app.service.listNotes().length, 0);
});

test('wrong library and duplicate mobile identities reject the entire transfer before writes', async t => {
  const { app, api, state } = await fixture(t);
  await assert.rejects(applyMobileTransfer({ api, state, transfer: envelope(newSyncState(), [collected()]) }), /另一知识库/);
  await assert.rejects(applyMobileTransfer({ api, state, transfer: envelope(state, [collected(), collected()]) }), /重复身份/);
  assert.equal(app.service.listNotes().length, 0);
});

test('unselected IDs and knowledge writes cannot bypass desktop learning protections', async t => {
  const { app, api, state } = await fixture(t);
  const source = app.service.store.create({ kind: 'source', title: '未选择资料', body: '不可改动' });
  const knowledge = app.service.store.create({ kind: 'knowledge', title: '合成知识', body: '只读学习知识', meta: { stage: 'candidate' } });
  const snapshot = await exportMobileSnapshot({ api, state, noteIds: [knowledge.id] });
  assert.equal(snapshot.notes[0].readOnly, true);
  assert.doesNotMatch(JSON.stringify(snapshot), /vaultDir|dataDir|secrets|calls|settings/);
  const forbidden = { id: source.id, desktopId: source.id, baseHash: source.hash, kind: 'source', title: source.title, body: '不应写入', dirty: true };
  const result = await applyMobileTransfer({ api, state, transfer: envelope(state, [forbidden]) });
  assert.equal(result.results[0].status, 'conflict'); assert.equal(app.service.getNote(source.id).hash, source.hash);
  await assert.rejects(applyMobileTransfer({ api, state, transfer: envelope(state, [{ ...snapshot.notes[0], dirty: true }]) }), /只能修改原始资料/);
  const impersonated = { ...snapshot.notes[0], kind: 'source', dirty: true, body: '伪装来源' };
  await assert.rejects(applyMobileTransfer({ api, state, transfer: envelope(state, [impersonated]) }), /不再是原始资料/);
  assert.equal(app.service.getNote(knowledge.id).hash, knowledge.hash);
});

test('duplicate body never silently adds origin or overwrites an unrelated source', async t => {
  const { app, api, state } = await fixture(t);
  const original = app.service.importItems({ items: [{ title: '另一原文', body: '合成手机原文' }] }).notes[0];
  const result = await applyMobileTransfer({ api, state, transfer: envelope(null, [collected()]) });
  assert.equal(result.results[0].status, 'conflict'); assert.equal(app.service.getNote(original.id).hash, original.hash);
  assert.throws(() => app.service.importItems({ items: [{ title: '新身份', body: '合成手机原文' }], rejectDuplicates: true }), { code: 'CONFLICT' });
  assert.equal(app.service.getNote(original.id).meta.origins.length, 1);
  const raced = await applyMobileTransfer({ api: { ...api, sources: async () => [] }, state, transfer: envelope(null, [collected('racing-phone')]) });
  assert.equal(raced.results[0].status, 'conflict');
  assert.equal(app.service.getNote(original.id).hash, original.hash);
});

test('interruption after desktop import is safe even without a saved receipt', async t => {
  const { app, api, state } = await fixture(t);
  const prior = structuredClone(state), transfer = envelope(null, [collected()]);
  await assert.rejects(applyMobileTransfer({ api, state, transfer, checkpoint: async () => { throw new Error('合成磁盘中断'); } }), /磁盘中断/);
  const retried = await applyMobileTransfer({ api, state: prior, transfer });
  assert.equal(retried.results[0].status, 'conflict'); assert.equal(app.service.listNotes().length, 1);
  assert.equal(app.service.listNotes()[0].meta.origins.length, 1);
});

test('desktop adapter rejects remote URLs and malformed transfers do not consume writes', () => {
  for (const base of ['http://0.0.0.0:4318', 'http://192.0.2.1:4318', 'https://localhost:4318', 'http://a:b@127.0.0.1:4318', 'http://127.0.0.1:4318/path']) assert.throws(() => localBase(base));
  assert.equal(localBase(), 'http://127.0.0.1:4318');
  assert.throws(() => validateTransfer(envelope(null, [{ ...collected(), title: '甲'.repeat(201) }])));
  assert.throws(() => validateTransfer(envelope(null, [{ ...collected(), desktopId: 'target' }])));
  assert.throws(() => validateTransfer(envelope(null, [{ ...collected(), dirty: false }])));
  assert.throws(() => validateTransfer(envelope(null, [{ ...collected(), id: '__proto__' }])));
});

test('command-line preview makes no connection or output; explicit apply returns a usable receipt', async t => {
  const { app } = await fixture(t);
  const root = await fs.mkdtemp(path.resolve('.tmp', 'mobile-command-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const input = path.join(root, 'phone.json'), output = path.join(root, 'receipt.json'), stateDir = path.join(root, 'state');
  await fs.writeFile(input, JSON.stringify(envelope(null, [collected('command-phone')])));
  const args = ['--state-dir', stateDir, '--push', input, '--out', output];
  await main([...args, '--base', 'http://127.0.0.1:1']); // An unreachable service proves preview needs no session.
  await assert.rejects(fs.stat(stateDir), { code: 'ENOENT' }); await assert.rejects(fs.stat(output), { code: 'ENOENT' });
  await main([...args, '--base', `http://127.0.0.1:${app.server.address().port}`, '--apply']);
  const result = JSON.parse(await fs.readFile(output, 'utf8'));
  assert.equal(result.results[0].status, 'saved'); assert.equal(result.notes[0].body, '合成手机原文');
  const state = JSON.parse(await fs.readFile(path.join(stateDir, 'mobile-sync-state.json'), 'utf8'));
  assert.equal(state.bindings['command-phone'], result.notes[0].desktopId);
  assert.equal(JSON.parse(await fs.readFile(input, 'utf8')).notes[0].desktopId, '');
  await assert.rejects(main([...args, '--out', input, '--base', `http://127.0.0.1:${app.server.address().port}`, '--apply']), /不能覆盖/);
});
