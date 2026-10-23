import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { sqliteStatement } from '../src/platform/sqlite-contract.mjs';
import { fileStat } from '../src/platform/file-stat.mjs';
import { SearchIndex } from '../src/core/search-index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../src/core/store.mjs';

test('Expo SQLite result contract rebuilds and searches a populated local index', t => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  // Node supplies SQLite here; expose exactly the public Expo helper contract.
  const expo = {
    runSync(sql, args) {
      const result = sqlite.prepare(sql).run(...args);
      return { changes: result.changes, lastInsertRowId: result.lastInsertRowid };
    },
    getFirstSync: (sql, args) => sqlite.prepare(sql).get(...args) ?? null,
    getAllSync: (sql, args) => sqlite.prepare(sql).all(...args),
    getEachSync: (sql, args) => sqlite.prepare(sql).iterate(...args),
  };
  const db = { exec: sql => sqlite.exec(sql), prepare: sql => sqliteStatement(expo, sql) };
  db.exec('CREATE TABLE notes(id TEXT PRIMARY KEY,json TEXT NOT NULL)');
  const index = new SearchIndex(db);
  for (let i = 1; i <= 2; i++) {
    const note = { id: `source-${i}`, kind: 'source', title: `合成原文 ${i}`, body: `本地资料保留引用 ${i}`, hash: `hash-${i}`, meta: {} };
    db.prepare('INSERT INTO notes VALUES(?,?)').run(note.id, JSON.stringify(note));
  }
  assert.equal(index.sync(), 2);
  assert.equal(db.prepare('SELECT count(*) n FROM search_fts JOIN search_segments ON search_fts.rowid=search_segments.id').get().n, 2);
  assert.equal(index.candidates('保留引用').length, 2);
  assert.equal(new SearchIndex(db).sync(), 0);
  assert.equal(db.prepare('SELECT id FROM notes WHERE id=?').get('missing'), undefined);
});

test('native SQLite iteration remains lazy and releases an interrupted cursor', () => {
  let active = false, read = 0;
  const statement = sqliteStatement({
    *getEachSync() {
      active = true;
      try { for (let i = 0; i < 10000; i++) { read++; yield { id: i }; } }
      finally { active = false; }
    },
  }, 'SELECT id FROM synthetic');
  for (const row of statement.iterate()) { assert.equal(row.id, 0); break; }
  assert.equal(read, 1);
  assert.equal(active, false);
});

test('native file stamps preserve same-size edits, dates and bigint identity', () => {
  const raw = { kind: 'file', size: 12, nlink: 1, dev: '7', ino: '9007199254740993', mtimeNs: '1792728000000000001', ctimeNs: '1792728000000000002' };
  const first = fileStat(raw, { bigint: true });
  const changed = fileStat({ ...raw, mtimeNs: '1792728000000000003' }, { bigint: true });
  assert.equal(first.ino, 9007199254740993n);
  assert.equal(first.size, changed.size);
  assert.notEqual(first.mtimeNs, changed.mtimeNs);
  assert.equal(first.mtime.toISOString(), new Date(1792728000000).toISOString());
  assert.equal(fileStat(raw).nlink, 1);
  assert.ok(first.isFile());
  assert.ok(!first.isSymbolicLink());
  assert.equal(fileStat({ kind: 'file', size: 1, nlink: 1, mtimeMs: 1000 }).mtime.toISOString(), '1970-01-01T00:00:01.000Z');
});

test('batched native scans retain cache refresh, fallback reads and duplicate protection', t => {
  fs.mkdirSync('.tmp', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('.tmp/native-scan-'));
  let supplyRaw = true;
  const previous = fs.scanMarkdownTree;
  fs.scanMarkdownTree = (directory, cached) => fs.readdirSync(directory).filter(name => name.endsWith('.md')).map(name => {
    const file = path.join(directory, name), stat = fs.statSync(file, { bigint: true });
    const fingerprint = [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
    return { file, fingerprint, ...(supplyRaw && cached[file] !== fingerprint ? { raw: fs.readFileSync(file, 'utf8') } : {}) };
  });
  const store = new Store({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault') });
  t.after(() => {
    store.close();
    if (previous === undefined) delete fs.scanMarkdownTree; else fs.scanMarkdownTree = previous;
    assert.ok(root.startsWith(path.resolve('.tmp') + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const file = path.join(root, 'vault', '原文.md');
  const raw = body => `---\nid: synthetic_1\nkind: source\ntitle: 合成原文\nupdatedAt: 2026-10-23T00:00:00.000Z\n---\n${body}`;
  fs.writeFileSync(file, raw('甲'));
  assert.equal(store.scan().count, 1);
  assert.equal(store.read('synthetic_1').body, '甲');
  assert.equal(store.scan({ incremental: true }).readFiles, 0);
  fs.writeFileSync(file, raw('乙'));
  fs.utimesSync(file, new Date(), new Date(Date.now() + 2000));
  store.scan({ incremental: true });
  assert.equal(store.read('synthetic_1').body, '乙');
  supplyRaw = false; // A bounded native batch may omit bytes; fresh reads still work.
  fs.writeFileSync(file, raw('丙'));
  fs.utimesSync(file, new Date(), new Date(Date.now() + 3000));
  store.scan({ incremental: true });
  assert.equal(store.read('synthetic_1').body, '丙');
  fs.writeFileSync(path.join(root, 'vault', '重复.md'), raw('丁'));
  store.scan();
  assert.equal(store.list().length, 0);
  assert.ok(store.conflicts.some(item => item.error.includes('重复稳定 id')));
  assert.equal(fs.readFileSync(file, 'utf8'), raw('丙'));
});
