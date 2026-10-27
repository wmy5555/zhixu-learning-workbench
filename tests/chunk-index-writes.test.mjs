import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../src/store.mjs';
import { createService } from '../src/service.mjs';

const temp = path.resolve(import.meta.dirname, '../.tmp');
function harness(t, embed) {
  fs.mkdirSync(temp, { recursive: true });
  const root = fs.mkdtempSync(path.join(temp, 'chunk-writes-'));
  const options = { dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault') };
  const service = embed ? createService({ ...options, aiOverride: { embed } }) : null;
  const store = service?.store || new Store(options);
  t.after(async () => {
    if (service) await service.close(); else store.close();
    assert.equal(path.dirname(root), temp);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { store, service };
}
const rows = store => store.db.prepare('SELECT * FROM index_chunks ORDER BY id').all().map(row => ({ ...row }));
const changes = store => store.db.prepare('SELECT total_changes() n').get().n;
const writeCount = (store, action) => { const before = changes(store); action(); return changes(store) - before; };

test('unchanged chunk content, vectors and models cause zero SQLite row writes', t => {
  const { store } = harness(t);
  store.index('same', 'A'.repeat(900) + 'B'.repeat(700));
  store.db.prepare('UPDATE index_chunks SET vector=?,model=? WHERE id=?').run('[1,0]', 'old-model', 'same:0');
  store.db.prepare('UPDATE index_chunks SET vector=?,model=? WHERE id=?').run('[0,1]', null, 'same:700');
  const before = rows(store);
  const writes = writeCount(store, () => store.index('same', 'A'.repeat(900) + 'B'.repeat(700)));
  t.diagnostic(`unchanged three-chunk index row writes: ${writes}`);
  assert.deepEqual(rows(store), before);
  assert.equal(store.missingEmbeddings({ model: 'new-model' }).length, 3, 'a new embedding model still sees every missing or mismatched vector');
  assert.equal(writes, 0);
});

test('indexing still repairs missing bodies and obsolete split positions and deletes extra chunks', t => {
  const { store } = harness(t), body = 'A'.repeat(900) + 'B'.repeat(700);
  store.index('repair', body);
  store.db.prepare('UPDATE index_chunks SET vector=?,model=?').run('[1,0]', 'saved-model');
  const expected = rows(store).map(row => ({ ...row, ...(row.id !== 'repair:1400' ? { vector: null, model: null } : {}) }));
  store.db.prepare('DELETE FROM index_chunks WHERE id=?').run('repair:0');
  store.db.prepare('UPDATE index_chunks SET body=? WHERE id=?').run('CORRUPT_BODY', 'repair:700');
  store.db.prepare('UPDATE index_chunks SET id=? WHERE id=?').run('repair:old-offset', 'repair:1400');
  store.db.prepare('INSERT INTO index_chunks VALUES(?,?,?,?,?)').run('repair:extra', 'repair', 'STALE_EXTRA', null, null);
  assert.equal(writeCount(store, () => store.index('repair', body)), 5);
  assert.deepEqual(rows(store), expected, 'repair retains only vectors whose exact source chunk remains available');
  assert.equal(writeCount(store, () => store.index('repair', body)), 0);
  store.db.prepare('DELETE FROM index_chunks WHERE noteId=?').run('repair');
  assert.equal(writeCount(store, () => store.index('repair', body)), 3, 'a fully missing projection must be rebuilt even for identical input');
  assert.ok(rows(store).every(row => row.vector === null && row.model === null));
});

test('identical text with different reusable vectors still follows existing vector selection and re-splitting rules', t => {
  const { store } = harness(t), body = 'A'.repeat(1600);
  store.index('repeat', body);
  const fill = store.db.prepare('UPDATE index_chunks SET vector=?,model=? WHERE id=?');
  fill.run('[1,0]', 'first-model', 'repeat:0');
  fill.run('[0,1]', 'chosen-model', 'repeat:700');
  fill.run('[1,1]', 'tail-model', 'repeat:1400');
  const writes = writeCount(store, () => store.index('repeat', body));
  assert.deepEqual(rows(store).map(({ id, vector, model }) => ({ id, vector, model })), [
    { id: 'repeat:0', vector: '[0,1]', model: 'chosen-model' },
    { id: 'repeat:1400', vector: '[1,1]', model: 'tail-model' },
    { id: 'repeat:700', vector: '[0,1]', model: 'chosen-model' },
  ]);
  assert.equal(writes, 1, 'unchanged body alone is not enough to skip a vector/model change');
  assert.equal(writeCount(store, () => store.index('repeat', body)), 0);
  store.index('repeat', 'NEW_TITLE\n' + body);
  assert.deepEqual(rows(store).map(({ id, vector, model }) => ({ id, vector, model })), [
    { id: 'repeat:0', vector: null, model: null },
    { id: 'repeat:1400', vector: null, model: null },
    { id: 'repeat:700', vector: '[0,1]', model: 'chosen-model' },
  ]);
  store.index('repeat', 'SHORT_BODY');
  assert.deepEqual(rows(store), [{ id: 'repeat:0', noteId: 'repeat', body: 'SHORT_BODY', vector: null, model: null }]);
});

test('changed chunk write errors still propagate and the caller transaction can roll back', t => {
  const { store } = harness(t);
  store.index('failure', 'A'.repeat(1600));
  const before = rows(store);
  store.db.exec("CREATE TRIGGER reject_chunk BEFORE UPDATE ON index_chunks WHEN NEW.id='failure:700' BEGIN SELECT RAISE(ABORT,'synthetic chunk failure'); END");
  store.db.exec('SAVEPOINT caller');
  try {
    assert.throws(() => store.index('failure', 'B'.repeat(1600)), /synthetic chunk failure/);
  } finally { store.db.exec('ROLLBACK TO caller; RELEASE caller'); }
  assert.deepEqual(rows(store), before);
});

test('rebuild skips unchanged chunk writes while model changes and explicit FTS repair still work', async t => {
  const sent = [];
  const { store, service: s } = harness(t, async ({ texts }) => { sent.push(texts); return { vectors: texts.map(() => [1,0]) }; });
  s.updateSettings({ embedding: { enabled: true, model: 'model-one' } });
  const note = store.create({ id: 'source', kind: 'source', title: 'SYNTHETIC_TITLE', body: 'SYNTHETIC_BODY' });
  const run = async key => { const job = s.queue('index', {}, key); await s.runJobs(); assert.equal(store.get('jobs', job.id).state, 'done'); };
  await run('initial');
  store.searchIndex.sync();
  const before = rows(store), documents = store.db.prepare('SELECT * FROM search_documents').all();
  const fts = store.db.prepare('SELECT rowid,grams FROM search_fts').all();
  store.db.exec('CREATE TABLE chunk_write_events(n INTEGER); CREATE TRIGGER chunk_write AFTER UPDATE ON index_chunks BEGIN INSERT INTO chunk_write_events VALUES(1); END');
  await run('unchanged');
  assert.equal(store.db.prepare('SELECT count(*) n FROM chunk_write_events').get().n, 0);
  assert.equal(sent.length, 1);
  assert.deepEqual(rows(store), before);
  assert.deepEqual(store.db.prepare('SELECT * FROM search_documents').all(), documents);
  assert.deepEqual(store.db.prepare('SELECT rowid,grams FROM search_fts').all(), fts);
  s.updateSettings({ embedding: { model: 'model-two' } });
  await run('changed-model');
  assert.equal(sent.length, 2);
  assert.equal(rows(store)[0].model, 'model-two');
  store.update(note.id, { expectedHash: note.hash, title: 'CHANGED_TITLE', body: 'CHANGED_BODY' });
  store.searchIndex.sync();
  assert.deepEqual(store.searchIndex.candidates('CHANGED_BODY').map(hit => hit.note.id), ['source']);
  assert.deepEqual(store.searchIndex.candidates('SYNTHETIC_BODY').map(hit => hit.note.id), []);
  store.db.exec('DELETE FROM search_fts');
  store.searchIndex.rebuild();
  assert.deepEqual(store.searchIndex.candidates('CHANGED_BODY').map(hit => hit.note.id), ['source']);
});
