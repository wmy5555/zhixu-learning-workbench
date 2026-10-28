import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../src/store.mjs';

const temp = path.resolve(import.meta.dirname, '../.tmp');
function harness(t) {
  fs.mkdirSync(temp, { recursive: true });
  const root = fs.mkdtempSync(path.join(temp, 'search-metadata-'));
  const store = new Store({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault') });
  t.after(() => {
    store.close();
    assert.equal(path.dirname(root), temp);
    fs.rmSync(root, { recursive: true, force: true });
  });
  store.db.exec(`CREATE TABLE segment_events (operation TEXT NOT NULL);
    CREATE TRIGGER segment_insert AFTER INSERT ON search_segments BEGIN INSERT INTO segment_events VALUES('insert'); END;
    CREATE TRIGGER segment_delete AFTER DELETE ON search_segments BEGIN INSERT INTO segment_events VALUES('delete'); END;`);
  return store;
}
const segments = store => store.db.prepare('SELECT rowid,grams FROM search_fts ORDER BY rowid').all();
const events = store => store.db.prepare('SELECT operation,count(*) count FROM segment_events GROUP BY operation ORDER BY operation').all().map(row => ({ ...row }));
const clearEvents = store => store.db.exec('DELETE FROM segment_events');

test('metadata-only updates refresh search filters and hashes without rebuilding long-body FTS segments', t => {
  const store = harness(t);
  const original = store.create({ id: 'large', kind: 'knowledge', title: 'SYNTHETIC_TITLE', body: 'Synthetic searchable passage. '.repeat(3200), meta: { stage: 'candidate', topic: 'before' } });
  assert.equal(store.searchIndex.sync(), 1);
  const before = segments(store), revision = store.searchIndex.revision();
  assert.ok(before.length > 10, 'the fixture must exercise multiple FTS segments');
  clearEvents(store);

  const updated = store.update(original.id, { expectedHash: original.hash, meta: { stage: 'core', topic: 'after' } });
  assert.equal(store.searchIndex.sync(), 1);
  assert.ok(store.searchIndex.revision() > revision);
  assert.deepEqual(store.searchIndex.candidates('searchable', { topic: 'before' }), []);
  const hit = store.searchIndex.candidates('searchable', { topic: 'after', stage: 'core' })[0];
  assert.equal(hit.note.id, original.id);
  assert.equal(hit.note.hash, updated.hash);
  assert.equal(hit.note.updatedAt, updated.updatedAt);
  assert.equal(hit.note.meta.stage, 'core');
  assert.deepEqual(segments(store), before);
  t.diagnostic(`metadata-only update over ${before.length} FTS segments: ${JSON.stringify(events(store))}`);
  assert.deepEqual(events(store), [], 'metadata changes must not delete and regenerate unchanged gram segments');

  const retired = store.update(original.id, { expectedHash: updated.hash, meta: { stage: 'retired' } });
  store.searchIndex.sync();
  assert.deepEqual(store.searchIndex.candidates('searchable'), []);
  assert.equal(store.searchIndex.candidates('searchable', { browse: true, stage: 'retired' })[0].note.hash, retired.hash);
  assert.deepEqual(events(store), []);
});

test('title and body changes replace FTS terms while deletion and explicit rebuild still remove stale projection', t => {
  const store = harness(t);
  const original = store.create({ id: 'changed', kind: 'knowledge', title: 'OLDTITLE', body: 'OLDBODY', meta: { stage: 'candidate' } });
  store.searchIndex.sync();
  clearEvents(store);
  const renamed = store.update(original.id, { expectedHash: original.hash, title: 'NEWTITLE' });
  store.searchIndex.sync();
  assert.deepEqual(store.searchIndex.candidates('OLDTITLE'), []);
  assert.equal(store.searchIndex.candidates('NEWTITLE')[0].note.title, 'NEWTITLE');
  assert.deepEqual(events(store), [{ operation: 'delete', count: 1 }, { operation: 'insert', count: 1 }]);
  clearEvents(store);
  const edited = store.update(original.id, { expectedHash: renamed.hash, body: 'NEWBODY' });
  store.searchIndex.sync();
  assert.deepEqual(store.searchIndex.candidates('OLDBODY'), []);
  assert.equal(store.searchIndex.candidates('NEWBODY')[0].note.hash, edited.hash);
  assert.deepEqual(events(store), [{ operation: 'delete', count: 1 }, { operation: 'insert', count: 1 }]);
  store.db.exec('DELETE FROM search_fts');
  store.searchIndex.rebuild();
  assert.equal(store.searchIndex.candidates('NEWBODY')[0].note.id, original.id);
  clearEvents(store);
  store.delete(original.id, edited.hash);
  store.searchIndex.sync();
  assert.deepEqual(store.searchIndex.candidates('NEWBODY'), []);
  assert.deepEqual(segments(store), []);
  assert.equal(store.db.prepare('SELECT count(*) count FROM search_documents').get().count, 0);
  assert.deepEqual(events(store), [{ operation: 'delete', count: 1 }]);
});

test('failed metadata projection updates keep old filters and durable pending work for retry', t => {
  const store = harness(t);
  const original = store.create({ id: 'failure', kind: 'knowledge', title: 'SYNTHETIC', body: 'searchterm', meta: { topic: 'before' } });
  store.searchIndex.sync();
  const before = segments(store);
  clearEvents(store);
  const changed = store.update(original.id, { expectedHash: original.hash, meta: { topic: 'after' } });
  store.db.exec("CREATE TRIGGER reject_summary BEFORE UPDATE ON search_documents BEGIN SELECT RAISE(ABORT,'synthetic summary failure'); END");
  assert.throws(() => store.searchIndex.sync(), /synthetic summary failure/);
  assert.equal(store.searchIndex.candidates('searchterm', { topic: 'before' })[0].note.hash, original.hash);
  assert.deepEqual(segments(store), before);
  assert.deepEqual(events(store), []);
  assert.ok(store.db.prepare('SELECT 1 FROM search_dirty WHERE id=?').get(original.id));
  store.db.exec('DROP TRIGGER reject_summary');
  assert.equal(store.searchIndex.sync(), 1);
  assert.equal(store.searchIndex.candidates('searchterm', { topic: 'after' })[0].note.hash, changed.hash);
  assert.deepEqual(events(store), []);
});
