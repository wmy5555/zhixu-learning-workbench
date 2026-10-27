import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../src/store.mjs';

const temp = path.resolve(import.meta.dirname, '../.tmp');
const select = 'SELECT * FROM index_chunks WHERE noteId=?';
const remove = 'DELETE FROM index_chunks WHERE noteId=?';
const rows = db => db.prepare('SELECT * FROM index_chunks ORDER BY noteId,id').all().map(row => ({ ...row }));
const plan = (db, sql) => db.prepare('EXPLAIN QUERY PLAN ' + sql).all('first').map(row => row.detail);

for (const legacy of [false, true]) test(`chunk note lookup and deletion use one nonunique index across reopen (legacy=${legacy})`, t => {
  fs.mkdirSync(temp, { recursive: true });
  const root = fs.mkdtempSync(path.join(temp, 'chunk-note-index-'));
  const options = { dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault') };
  let store = new Store(options);
  t.after(() => {
    store?.close();
    assert.equal(path.dirname(root), temp);
    fs.rmSync(root, { recursive: true, force: true });
  });
  for (const id of ['first', 'second']) store.create({ id, kind: 'knowledge', title: id, body: id.repeat(180) });
  store.db.prepare('UPDATE index_chunks SET vector=?,model=? WHERE id=?').run('[1,0]', 'synthetic-model', 'first:0');
  if (legacy) {
    // Reproduce the previous on-disk schema while retaining populated rows/vectors.
    store.db.exec('DROP INDEX IF EXISTS index_chunks_note');
    assert.deepEqual(store.db.prepare("PRAGMA index_list('index_chunks')").all().map(row => row.origin), ['pk']);
    assert.deepEqual(plan(store.db, select), ['SCAN index_chunks']);
    assert.deepEqual(plan(store.db, remove), ['SCAN index_chunks']);
  }
  const before = rows(store.db), selected = store.db.prepare(select).all('first');
  const missing = store.missingEmbeddings({ model: 'synthetic-model' });
  const files = store.list().map(note => [path.join(options.vaultDir, note.path), fs.readFileSync(path.join(options.vaultDir, note.path))]);
  // Legacy mode adds the index to an existing database; both modes reopen twice
  // to catch duplicate initialization and accidental changes to persisted rows.
  for (let attempt = 0; attempt < 2; attempt++) {
    store.close(); store = null;
    store = new Store(options);
    const lookupPlan = plan(store.db, select), deletePlan = plan(store.db, remove);
    t.diagnostic(JSON.stringify({ legacy, attempt, lookupPlan, deletePlan }));
    for (const result of [lookupPlan, deletePlan]) {
      assert.ok(result.some(detail => /SEARCH index_chunks USING INDEX \S+ \(noteId=\?\)/.test(detail)), JSON.stringify(result));
      assert.ok(!result.includes('SCAN index_chunks'));
    }
    const indexes = store.db.prepare("PRAGMA index_list('index_chunks')").all().filter(row => row.origin !== 'pk');
    assert.equal(indexes.length, 1, 'reinitialization must not add redundant indexes');
    assert.equal(indexes[0].unique, 0, 'several chunks must remain valid for one note');
    assert.deepEqual(store.db.prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno').all(indexes[0].name).map(row => row.name), ['noteId']);
    assert.deepEqual(rows(store.db), before);
    assert.deepEqual(store.db.prepare(select).all('first'), selected);
    assert.deepEqual(store.missingEmbeddings({ model: 'synthetic-model' }), missing, 'existing explicit ordering and vector filtering are preserved');
    for (const [file, bytes] of files) assert.deepEqual(fs.readFileSync(file), bytes);
  }
  store.db.exec('BEGIN');
  try {
    assert.equal(store.db.prepare(remove).run('first').changes, 2);
    assert.deepEqual(store.db.prepare(select).all('first'), []);
    assert.deepEqual(rows(store.db), before.filter(row => row.noteId === 'second'));
  } finally { store.db.exec('ROLLBACK'); }
  assert.deepEqual(rows(store.db), before, 'rollback restores all original chunk content and vectors');
});
