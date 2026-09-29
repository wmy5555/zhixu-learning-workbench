import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import { Store } from '../src/store.mjs';

const tempRoot = path.resolve(import.meta.dirname, '..', '.tmp');
fs.mkdirSync(tempRoot, { recursive: true });

function harness(t) {
  const root = fs.mkdtempSync(path.join(tempRoot, 'store-alignment-'));
  const vaultDir = path.join(root, 'vault'), stores = [];
  const open = (data = 'data') => {
    const store = new Store({ dataDir: path.join(root, data), vaultDir });
    stores.push(store); return store;
  };
  t.after(() => {
    for (const store of stores) store.close();
    const relative = path.relative(tempRoot, root);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, vaultDir, open, store: open() };
}
const note = (store, title, body = '用户的原始正文', meta = {}) => store.create({ kind: 'knowledge', title, body, meta: { privacy: 'local', stage: 'candidate', ...meta } });
const chunks = (store, id) => store.db.prepare('SELECT * FROM index_chunks WHERE noteId=? ORDER BY id').all(id);
function fillVectors(store, id, model = 'test-model') {
  for (const [i, chunk] of chunks(store, id).entries()) store.db.prepare('UPDATE index_chunks SET vector=?,model=? WHERE id=?').run(JSON.stringify([0.2 + i, 0.4, 0.6]), model, chunk.id);
}
function externalEdit(h, id, transform) {
  const current = h.store.read(id), file = path.join(h.vaultDir, current.path), raw = fs.readFileSync(file, 'utf8');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const meta = YAML.parse(match[1]);
  const body = transform(meta, raw.slice(match[0].length));
  fs.writeFileSync(file, `---\n${YAML.stringify(meta)}---\n${body ?? raw.slice(match[0].length)}`);
  return file;
}
function accept(store, left, right, extra = {}) {
  const relation = { id: `relation-${left.id}`, fromId: left.id, toId: right.id, state: 'accepted', type: 'support', explanation: '支持这个解释', use: '帮助比较', boundary: '仅限当前材料', ...extra };
  const current = store.read(left.id);
  store.update(left.id, { expectedHash: current.hash, meta: { relations: [relation] } });
  return relation;
}

test('a fresh application database reconstructs confirmed relations and topic state from the Vault', t => {
  const h = harness(t), left = note(h.store, '左'), right = note(h.store, '右');
  const relation = accept(h.store, left, right);
  const topic = h.store.create({ kind: 'topic', title: '主题', body: '学习顺序', meta: { noteIds: [right.id, left.id], paused: true } });
  const before = fs.readFileSync(path.join(h.vaultDir, left.path), 'utf8');
  const restored = h.open('fresh-data');
  assert.equal(restored.get('relations', relation.id).state, 'accepted');
  assert.deepEqual(restored.get('relations', relation.id).vaultOwnerIds, [left.id]);
  assert.deepEqual(restored.get('topics', topic.id).noteIds, [right.id, left.id]);
  assert.equal(restored.get('topics', topic.id).paused, true);
  assert.equal(fs.readFileSync(path.join(h.vaultDir, left.path), 'utf8'), before);
});

test('external relationship and topic edits update mirrors without discarding suggestion or rejection history', t => {
  const h = harness(t), left = note(h.store, '左'), right = note(h.store, '右'), third = note(h.store, '第三条');
  const relation = accept(h.store, left, right);
  const topic = h.store.create({ kind: 'topic', title: '主题', body: '主题正文', meta: { noteIds: [left.id], paused: false } });
  h.store.put('relations', 'suggested-history', { id: 'suggested-history', state: 'suggested' });
  h.store.put('relations', 'rejected-history', { id: 'rejected-history', state: 'rejected' });
  externalEdit(h, left.id, meta => { meta.relations[0].explanation = '来自外部的新解释'; });
  externalEdit(h, topic.id, meta => { meta.noteIds = [third.id]; meta.paused = true; });
  h.store.scan();
  assert.equal(h.store.get('relations', relation.id).explanation, '来自外部的新解释');
  assert.deepEqual(h.store.get('topics', topic.id).noteIds, [third.id]);
  assert.equal(h.store.get('topics', topic.id).paused, true);
  externalEdit(h, left.id, meta => { meta.relations = []; });
  fs.unlinkSync(path.join(h.vaultDir, topic.path));
  h.store.scan();
  assert.equal(h.store.get('relations', relation.id).state, 'rejected');
  assert.ok(h.store.get('relations', relation.id).vaultRemovedAt);
  assert.equal(h.store.get('topics', topic.id), null);
  assert.equal(h.store.get('relations', 'suggested-history').state, 'suggested');
  assert.equal(h.store.get('relations', 'rejected-history').state, 'rejected');
});

test('conflicting relation definitions are isolated until the owner files agree, never rewritten by scanning', t => {
  const h = harness(t), left = note(h.store, '左'), right = note(h.store, '右');
  const relation = accept(h.store, left, right);
  h.store.update(right.id, { expectedHash: h.store.read(right.id).hash, meta: { relations: [{ ...relation, explanation: '另一份冲突解释' }] } });
  const file = path.join(h.vaultDir, right.path), before = fs.readFileSync(file, 'utf8');
  h.store.scan();
  assert.equal(h.store.get('relations', relation.id).state, 'conflict');
  assert.ok(h.store.conflicts.some(item => item.relationId === relation.id));
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  externalEdit(h, right.id, meta => { meta.relations = [relation]; });
  h.store.scan();
  assert.equal(h.store.get('relations', relation.id).state, 'accepted');
  assert.equal(h.store.conflicts.length, 0);
});

test('an unreadable owner is a conflict, while a deleted target keeps an orphaned relationship for recovery', t => {
  const h = harness(t), left = note(h.store, '左'), right = note(h.store, '右');
  const relation = accept(h.store, left, right);
  const file = path.join(h.vaultDir, left.path), original = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, '---\n[invalid yaml\n---\n保留正文');
  h.store.scan();
  assert.equal(h.store.get('relations', relation.id).state, 'conflict');
  h.store.scan();
  assert.equal(h.store.get('relations', relation.id).state, 'conflict');
  const renamed = path.join(path.dirname(file), '外部改名且属性损坏.md');
  fs.renameSync(file, renamed);
  h.store.scan();
  assert.equal(h.store.get('relations', relation.id).state, 'conflict');
  fs.renameSync(renamed, file);
  fs.writeFileSync(file, original);
  fs.unlinkSync(path.join(h.vaultDir, right.path));
  h.store.scan();
  assert.equal(h.store.get('relations', relation.id).state, 'orphaned');
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('metadata-only edits preserve embeddings and an external rename preserves all unchanged chunks', t => {
  const h = harness(t), saved = note(h.store, '向量', '这是不可外发的合成测试材料。'.repeat(90));
  fillVectors(h.store, saved.id);
  const before = chunks(h.store, saved.id);
  h.store.update(saved.id, { expectedHash: saved.hash, meta: { stage: 'integrated', confirmedBy: 'user', topic: '新主题' } });
  assert.deepEqual(chunks(h.store, saved.id), before);
  const target = path.join(path.dirname(path.join(h.vaultDir, saved.path)), '外部改名.md');
  fs.renameSync(path.join(h.vaultDir, saved.path), target);
  h.store.scan();
  assert.match(h.store.read(saved.id).path, /外部改名\.md$/);
  assert.deepEqual(chunks(h.store, saved.id), before);
  assert.deepEqual(h.store.missingEmbeddings({ model: 'test-model', noteIds: [saved.id] }), []);
});

test('a content edit clears only changed chunks and reports gaps by note and embedding model', t => {
  const h = harness(t), body = 'A'.repeat(700) + 'B'.repeat(700) + 'C'.repeat(700) + 'D'.repeat(700);
  const saved = note(h.store, '分段', body);
  fillVectors(h.store, saved.id);
  const before = chunks(h.store, saved.id);
  const edited = `${body.slice(0, 1200)}X${body.slice(1201)}`;
  h.store.update(saved.id, { expectedHash: saved.hash, body: edited });
  const after = chunks(h.store, saved.id);
  let retained = 0, missing = 0;
  for (const chunk of after) {
    const old = before.find(item => item.body === chunk.body);
    if (old) { assert.equal(chunk.vector, old.vector); retained++; }
    else { assert.equal(chunk.vector, null); missing++; }
  }
  assert.ok(retained > 0); assert.ok(missing > 0);
  assert.equal(h.store.missingEmbeddings({ model: 'test-model', noteIds: [saved.id] }).length, missing);
  assert.equal(h.store.missingEmbeddings({ model: 'replacement-model', noteIds: [saved.id] }).length, after.length);
  assert.ok(h.store.missingEmbeddings().every(chunk => chunk.noteId === saved.id && chunk.vector === null));
  assert.deepEqual(h.store.missingEmbeddings({ model: 'test-model', noteIds: [] }), []);
});

test('managed Obsidian links are previewed first and refreshed after a rename without rewriting other files', t => {
  const h = harness(t), left = note(h.store, '左', '用户正文\n\n[[手工链接]]'), right = note(h.store, '目标'), untouched = note(h.store, '未涉及');
  accept(h.store, left, right);
  const file = path.join(h.vaultDir, left.path), before = fs.readFileSync(file, 'utf8');
  const unrelated = fs.readFileSync(path.join(h.vaultDir, untouched.path), 'utf8');
  const preview = h.store.managedLinksPreview(left.id);
  assert.ok(preview.changed); assert.equal(preview.conflict, null);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.ok(preview.body.startsWith(left.body));
  assert.ok(preview.body.includes(`[[${right.path.replace(/\.md$/, '')}|目标]]`));
  h.store.syncManagedLinks(left.id, { expectedHash: preview.expectedHash });
  assert.deepEqual(h.store.pendingManagedLinks(), []);
  const oldRight = path.join(h.vaultDir, right.path), newRight = path.join(path.dirname(oldRight), '改名后的目标.md');
  fs.renameSync(oldRight, newRight);
  const beforeRenameSync = fs.readFileSync(file, 'utf8');
  const pending = h.store.pendingManagedLinks();
  assert.deepEqual(pending.map(item => item.id), [left.id]);
  assert.match(pending[0].body, /\[\[02 知识\/改名后的目标\|目标\]\]/);
  assert.equal(fs.readFileSync(file, 'utf8'), beforeRenameSync);
  h.store.syncManagedLinks(left.id, { expectedHash: pending[0].expectedHash });
  assert.ok(h.store.read(left.id).body.startsWith(left.body));
  assert.equal(fs.readFileSync(path.join(h.vaultDir, untouched.path), 'utf8'), unrelated);
});

test('external changes to a managed block or a stale preview are rejected without losing user edits', t => {
  const h = harness(t), left = note(h.store, '左'), right = note(h.store, '右');
  accept(h.store, left, right);
  const initial = h.store.managedLinksPreview(left.id);
  h.store.syncManagedLinks(left.id, { expectedHash: initial.expectedHash });
  const file = path.join(h.vaultDir, left.path);
  externalEdit(h, left.id, (_meta, body) => body.replace('支持这个解释', '用户在这里改过解释'));
  const before = fs.readFileSync(file, 'utf8');
  const preview = h.store.managedLinksPreview(left.id);
  assert.match(preview.conflict, /外部修改/);
  assert.throws(() => h.store.syncManagedLinks(left.id, { expectedHash: initial.expectedHash }), error => error.code === 'CONFLICT');
  assert.throws(() => h.store.syncManagedLinks(left.id, { expectedHash: preview.expectedHash }), error => error.code === 'MANAGED_LINK_CONFLICT');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('a topic link preview follows the authoritative note order and removing relations removes only the managed block', t => {
  const h = harness(t), left = note(h.store, '第一'), right = note(h.store, '第二');
  const topic = h.store.create({ kind: 'topic', title: '主题', body: '我的学习计划', meta: { noteIds: [right.id, left.id] } });
  const preview = h.store.managedLinksPreview(topic.id);
  assert.ok(preview.body.indexOf('|第二]]') < preview.body.indexOf('|第一]]'));
  h.store.syncManagedLinks(topic.id, { expectedHash: preview.expectedHash });
  externalEdit(h, topic.id, meta => { meta.noteIds = []; });
  const removal = h.store.managedLinksPreview(topic.id);
  assert.equal(removal.conflict, null); assert.equal(removal.changed, true);
  h.store.syncManagedLinks(topic.id, { expectedHash: removal.expectedHash });
  assert.equal(h.store.read(topic.id).body.trim(), '我的学习计划');
  assert.deepEqual(h.store.pendingManagedLinks(), []);
});

test('links to local targets tighten source privacy, including when the rendered block has not changed', t => {
  const h = harness(t), left = note(h.store, '允许外发', '获准外发的正文', { privacy: 'cloud' }), right = note(h.store, '仅本地标题');
  accept(h.store, left, right);
  const preview = h.store.managedLinksPreview(left.id);
  assert.equal(preview.privacyChanged, true);
  assert.equal(preview.meta.privacy, 'local');
  assert.match(preview.privacyNotice, /仅本地/);
  const saved = h.store.syncManagedLinks(left.id, { expectedHash: preview.expectedHash });
  assert.equal(saved.meta.privacy, 'local');
  const managedBody = saved.body;
  externalEdit(h, left.id, meta => { meta.privacy = 'cloud'; });
  const sameBlock = h.store.managedLinksPreview(left.id);
  assert.equal(sameBlock.body, managedBody);
  assert.equal(sameBlock.changed, true);
  assert.equal(sameBlock.privacyChanged, true);
  assert.equal(h.store.syncManagedLinks(left.id, { expectedHash: sameBlock.expectedHash }).meta.privacy, 'local');
});

test('outbound privacy reads a linked target changed to local even before any index scan or link refresh', t => {
  const h = harness(t), left = note(h.store, '来源', '来源正文', { privacy: 'cloud' }), right = note(h.store, '目标标题', '目标正文', { privacy: 'cloud' });
  accept(h.store, left, right);
  const preview = h.store.managedLinksPreview(left.id);
  const saved = h.store.syncManagedLinks(left.id, { expectedHash: preview.expectedHash });
  assert.deepEqual(saved.meta.managedLinkIds, [right.id]);
  assert.equal(h.store.outboundPrivacy(saved), 'cloud');
  const leftFile = path.join(h.vaultDir, saved.path), before = fs.readFileSync(leftFile, 'utf8');
  externalEdit(h, right.id, meta => { meta.privacy = 'local'; });
  assert.equal(h.store.read(right.id).meta.privacy, 'cloud', 'The target index intentionally remains stale');
  h.store.scan = () => { throw new Error('The privacy guard must not recursively scan or write'); };
  assert.equal(h.store.outboundPrivacy(saved), 'local');
  assert.equal(h.store.outboundPrivacy(saved.id), 'local');
  assert.equal(fs.readFileSync(leftFile, 'utf8'), before);
  assert.equal(h.store.read(saved.id).meta.privacy, 'cloud', 'The guard must not silently change source metadata');
});

test('outbound privacy follows accepted relation and topic dependencies recursively and terminates cycles', t => {
  const h = harness(t), first = note(h.store, '第一', '第一正文', { privacy: 'cloud' }), second = note(h.store, '第二', '第二正文', { privacy: 'cloud' }), third = note(h.store, '第三', '第三正文', { privacy: 'cloud' });
  accept(h.store, first, second);
  accept(h.store, second, third);
  accept(h.store, third, first);
  const topic = h.store.create({ kind: 'topic', title: '云端主题', body: '主题正文', meta: { privacy: 'cloud', noteIds: [first.id] } });
  assert.equal(h.store.outboundPrivacy(topic.id), 'cloud');
  externalEdit(h, third.id, meta => { meta.privacy = 'local'; });
  assert.equal(h.store.outboundPrivacy(first.id), 'local');
  assert.equal(h.store.outboundPrivacy(topic.id), 'local');
});

test('missing targets, edited managed blocks, missing target IDs and stale source snapshots fail closed', t => {
  const h = harness(t), left = note(h.store, '来源', '来源正文', { privacy: 'cloud' }), right = note(h.store, '目标', '目标正文', { privacy: 'cloud' });
  accept(h.store, left, right);
  const preview = h.store.managedLinksPreview(left.id);
  const saved = h.store.syncManagedLinks(left.id, { expectedHash: preview.expectedHash });
  const file = path.join(h.vaultDir, saved.path), original = fs.readFileSync(file, 'utf8');
  externalEdit(h, left.id, (_meta, body) => body.replace('支持这个解释', '外部修改了关系说明'));
  assert.equal(h.store.outboundPrivacy(left.id), 'local');
  fs.writeFileSync(file, original);
  externalEdit(h, left.id, meta => { delete meta.managedLinkIds; });
  assert.equal(h.store.outboundPrivacy(left.id), 'local');
  fs.writeFileSync(file, original);
  externalEdit(h, left.id, (_meta, body) => `${body}\n用户后来新增的正文`);
  assert.equal(h.store.outboundPrivacy(saved), 'local', 'Do not authorize sending a stale snapshot');
  fs.writeFileSync(file, original);
  fs.unlinkSync(path.join(h.vaultDir, right.path));
  assert.equal(h.store.outboundPrivacy(left.id), 'local');
});
