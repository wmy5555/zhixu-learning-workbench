import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { Store } from '../src/store.mjs';

const tempRoot = path.resolve(import.meta.dirname, '..', '.tmp');
fs.mkdirSync(tempRoot, { recursive: true });

async function harness(t) {
  const root = await mkdtemp(path.join(tempRoot, 'restore-'));
  const dataDir = path.join(root, 'data');
  const vaultDir = path.join(root, 'vault');
  const store = new Store({ dataDir, vaultDir });
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, dataDir, vaultDir, store };
}

function createNote(store, body = '恢复前正文') {
  return store.create({
    kind: 'knowledge',
    title: '恢复原子性',
    body,
    meta: { stage: 'candidate', privacy: 'local' },
  });
}

test('restore rejects malformed version rows before touching files or creating a safety snapshot', async t => {
  const h = await harness(t);
  const note = createNote(h.store);
  const file = path.join(h.vaultDir, note.path);
  const before = await readFile(file, 'utf8');
  const backup = structuredClone(h.store.backup());
  backup.versions.push({
    id: 'bad-version',
    noteId: note.id,
    path: note.path,
    hash: '0'.repeat(64),
    raw: before,
    reason: '坏哈希测试',
    createdAt: new Date().toISOString(),
  });

  assert.throws(() => h.store.restore(backup), /历史版本内容或哈希无效/);
  assert.equal(await readFile(file, 'utf8'), before);
  assert.equal(h.store.read(note.id).body, '恢复前正文');
  assert.equal(fs.existsSync(path.join(h.dataDir, 'backups')), false);
});

test('a disk failure after current Markdown is staged rolls files and SQLite back together', async t => {
  const h = await harness(t);
  const note = createNote(h.store);
  h.store.put('sessions', 'kept-session', { id: 'kept-session', answer: '必须保留' });
  const file = path.join(h.vaultDir, note.path);
  const before = await readFile(file, 'utf8');
  const backup = structuredClone(h.store.backup());
  backup.notes[0].raw = backup.notes[0].raw.replace('恢复前正文', '备份中的新正文');

  await mkdir(path.join(h.vaultDir, '.obsidian'), { recursive: true });
  await mkdir(path.join(h.vaultDir, 'assets'), { recursive: true });
  await writeFile(path.join(h.vaultDir, '.obsidian', 'workspace.json'), '{"kept":true}');
  await writeFile(path.join(h.vaultDir, 'assets', 'diagram.bin'), Buffer.from([1, 2, 3, 4]));

  const originalRename = fs.renameSync;
  let injected = false;
  fs.renameSync = function simulatedRename(source, target) {
    const from = String(source);
    const to = String(target);
    const installsIncoming = from.includes('.learning-restore-')
      && from.includes(`${path.sep}incoming${path.sep}`)
      && !to.includes('.learning-restore-');
    if (!injected && installsIncoming) {
      injected = true;
      const error = new Error('simulated restore disk failure');
      error.code = 'EIO';
      throw error;
    }
    return originalRename.call(fs, source, target);
  };
  try {
    assert.throws(() => h.store.restore(backup), /simulated restore disk failure/);
  } finally {
    fs.renameSync = originalRename;
  }

  assert.equal(injected, true);
  assert.equal(await readFile(file, 'utf8'), before);
  assert.equal(h.store.read(note.id).body, '恢复前正文');
  assert.deepEqual(h.store.get('sessions', 'kept-session'), { id: 'kept-session', answer: '必须保留' });
  assert.equal(await readFile(path.join(h.vaultDir, '.obsidian', 'workspace.json'), 'utf8'), '{"kept":true}');
  assert.deepEqual(await readFile(path.join(h.vaultDir, 'assets', 'diagram.bin')), Buffer.from([1, 2, 3, 4]));
  assert.equal((await fs.promises.readdir(h.vaultDir)).some(name => name.startsWith('.learning-restore-')), false);
  assert.equal((await fs.promises.readdir(path.join(h.dataDir, 'backups'))).length, 1);
});

test('backup and restore refuse unresolved Markdown conflicts instead of silently omitting them', async t => {
  const h = await harness(t);
  const note = createNote(h.store);
  const backup = structuredClone(h.store.backup());
  const duplicate = path.join(h.vaultDir, 'duplicate.md');
  await writeFile(duplicate, await readFile(path.join(h.vaultDir, note.path), 'utf8'));

  assert.throws(() => h.store.backup(), error => error?.code === 'BACKUP_CONFLICT');
  assert.throws(() => h.store.restore(backup), error => error?.code === 'RESTORE_CONFLICT');
  assert.equal(await readFile(duplicate, 'utf8'), await readFile(path.join(h.vaultDir, note.path), 'utf8'));
});

