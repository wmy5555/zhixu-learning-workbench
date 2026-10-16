import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../src/store.mjs';

function fixture(t) {
  const tempRoot = path.resolve(import.meta.dirname, '..', '.tmp');
  fs.mkdirSync(tempRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(tempRoot, 'history-events-'));
  const store = new Store({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault') });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const note = store.create({ kind: 'source', title: '合成历史测试', body: '原始正文', meta: { customField: '保留属性' } });
  return { store, note, file: path.join(store.vaultDir, note.path) };
}

test('one Web update adds one exact before-version and preserves existing snapshots', t => {
  const { store, note } = fixture(t), before = store.history(note.id);
  const updated = store.update(note.id, { expectedHash: note.hash, body: '修改后的正文' });
  const added = store.history(note.id).filter(v => !before.some(old => old.versionId === v.versionId));
  assert.equal(added.length, 1);
  assert.equal(added[0].reason, 'Web 修改前');
  assert.equal(added[0].hash, note.hash);
  assert.equal(added[0].raw, before[0].raw);
  assert.ok(store.history(note.id).some(v => v.versionId === before[0].versionId));
  assert.equal(updated.meta.customField, '保留属性');
  store.scan(); store.scan();
  assert.equal(store.history(note.id).length, 2);
});

test('real external edits keep their history and reject stale Web writes', t => {
  const { store, note, file } = fixture(t);
  const oldRaw = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, oldRaw.replace('原始正文', '外部修改正文'));
  assert.throws(() => store.update(note.id, { expectedHash: note.hash, body: '过期网页正文' }), { code: 'CONFLICT' });
  assert.equal(store.read(note.id).body, '外部修改正文');
  const versions = store.history(note.id);
  assert.equal(versions.length, 2);
  assert.equal(versions.filter(v => v.reason === '外部修改或历史版本').length, 1);
  assert.equal(versions.find(v => v.reason === '外部修改或历史版本').raw, oldRaw);
  const current = store.read(note.id);
  store.update(note.id, { expectedHash: current.hash, body: '重新核对后的修改' });
  assert.equal(store.history(note.id).length, 3);
});

test('repeated edits and explicit restoration retain distinct events without rewriting old history', t => {
  const { store, note } = fixture(t), original = store.history(note.id)[0];
  let current = store.update(note.id, { expectedHash: note.hash, body: '第二版' });
  current = store.update(note.id, { expectedHash: current.hash, body: '第三版' });
  const priorIds = store.history(note.id).map(v => v.versionId);
  assert.equal(priorIds.length, 3);
  const restored = store.restoreVersion(note.id, original.versionId, current.hash);
  assert.equal(restored.body, '原始正文');
  const history = store.history(note.id);
  assert.equal(history.length, 4);
  for (const id of priorIds) assert.ok(history.some(v => v.versionId === id));
  assert.ok(history.some(v => v.raw.includes('第三版')));
});

test('returning to identical bytes retains each real external change event', t => {
  const { store, note, file } = fixture(t);
  const originalRaw = fs.readFileSync(file, 'utf8');
  const changedRaw = originalRaw.replace('原始正文', '外部第二版');
  for (const raw of [changedRaw, originalRaw, changedRaw]) {
    fs.writeFileSync(file, raw); store.scan();
  }
  const history = store.history(note.id);
  assert.equal(history.length, 4);
  const events = history.filter(v => v.reason === '外部修改或历史版本');
  assert.equal(events.length, 3);
  assert.equal(events.filter(v => v.raw === originalRaw).length, 2);
  assert.equal(events.filter(v => v.raw === changedRaw).length, 1);
  store.scan();
  assert.equal(store.history(note.id).length, 4);
});
