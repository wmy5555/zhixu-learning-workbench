import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { sqliteStatement } from '../src/platform/sqlite-contract.mjs';
import { fileStat } from '../src/platform/file-stat.mjs';
import { SearchIndex } from '../src/core/search-index.mjs';

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
