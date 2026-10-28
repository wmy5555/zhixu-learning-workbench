import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../src/store.mjs';

function fixture(t) {
  const parent = path.resolve(import.meta.dirname, '../.tmp');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'history-restore-conflict-'));
  const store = new Store({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault') });
  t.after(() => { store.close(); assert.equal(path.dirname(root), parent); fs.rmSync(root, { recursive: true, force: true }); });
  const note = store.create({ kind: 'knowledge', title: '合成恢复资料', body: '应可恢复的合成正文', meta: { customField: '保留属性' } });
  const version = store.history(note.id)[0], file = path.join(store.vaultDir, note.path);
  store.delete(note.id, note.hash);
  return { store, note, version, file, deleted: store.get('deleted', note.id) };
}

test('history restore rejects an externally occupied path without removing the deletion receipt', t => {
  const { store, note, version, file, deleted } = fixture(t);
  const occupant = '外部新建的另一份合成资料，必须保留。';
  fs.writeFileSync(file, occupant);
  assert.throws(() => store.restoreVersion(note.id, version.versionId), { code: 'CONFLICT', status: 409 });
  assert.equal(fs.readFileSync(file, 'utf8'), occupant);
  assert.deepEqual(store.get('deleted', note.id), deleted);
});

test('history restore detects an externally restored identity at a renamed path', t => {
  const { store, note, version, file, deleted } = fixture(t);
  const renamed = path.join(path.dirname(file), '外部 恢复.md');
  const current = version.raw.replace('应可恢复的合成正文', '外部恢复后继续编辑的正文');
  fs.writeFileSync(renamed, current);
  assert.throws(() => store.restoreVersion(note.id, version.versionId), { code: 'CONFLICT', status: 409 });
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.readFileSync(renamed, 'utf8'), current);
  assert.deepEqual(store.get('deleted', note.id), deleted);
});

test('history restore keeps duplicate identities isolated instead of creating a third copy', t => {
  const { store, note, version, file, deleted } = fixture(t);
  const first = path.join(path.dirname(file), '合成冲突甲.md'), second = path.join(path.dirname(file), '合成冲突乙.md');
  fs.writeFileSync(first, version.raw);
  fs.writeFileSync(second, version.raw);
  assert.throws(() => store.restoreVersion(note.id, version.versionId), { code: 'CONFLICT', status: 409 });
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.readFileSync(first, 'utf8'), version.raw);
  assert.equal(fs.readFileSync(second, 'utf8'), version.raw);
  assert.deepEqual(store.get('deleted', note.id), deleted);
});

test('history restore cannot replace an occupant that arrives after its scan', t => {
  const { store, note, version, file, deleted } = fixture(t), write = fs.writeFileSync;
  const occupant = '在恢复写入期间出现的合成新内容。';
  t.mock.method(fs, 'writeFileSync', (target, ...args) => {
    const result = write(target, ...args);
    if (String(target).startsWith(file + '.') && String(target).endsWith('.tmp')) write(file, occupant);
    return result;
  });
  assert.throws(() => store.restoreVersion(note.id, version.versionId), { code: 'CONFLICT', status: 409 });
  assert.equal(fs.readFileSync(file, 'utf8'), occupant);
  assert.deepEqual(store.get('deleted', note.id), deleted);
});

test('failed history restore leaves the deleted item available for retry', t => {
  const { store, note, version, file, deleted } = fixture(t), write = fs.writeFileSync;
  const failure = Object.assign(new Error('synthetic restore disk failure'), { code: 'ENOSPC' });
  const mock = t.mock.method(fs, 'writeFileSync', (target, ...args) => {
    if (String(target).startsWith(file + '.') && String(target).endsWith('.tmp')) throw failure;
    return write(target, ...args);
  });
  assert.throws(() => store.restoreVersion(note.id, version.versionId), error => error === failure);
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(store.get('deleted', note.id), deleted);
  mock.mock.restore();
  const restored = store.restoreVersion(note.id, version.versionId);
  assert.equal(restored.body, '应可恢复的合成正文');
  assert.equal(restored.meta.customField, '保留属性');
  assert.equal(store.get('deleted', note.id), null);
  assert.throws(() => store.restoreVersion(note.id, version.versionId), { code: 'CONFLICT', status: 409 });
});
