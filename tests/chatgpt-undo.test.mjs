import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createService } from '../src/service.mjs';
import { createChatgptUndo } from '../src/chatgpt-undo.mjs';
import { hash } from '../src/store.mjs';

const tempRoot = path.resolve(import.meta.dirname, '../.tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const input = () => ({ requestId: randomUUID(), title: '合成撤销会话', summary: '合成摘要。',
  messages: [{ id: 'source_a', role: 'user', content: '合成问题🙂\r\n保留空白。' }, { id: 'source_b', role: 'assistant', content: '合成回答。' }],
  coverage: 'visible_history', sync: { conversationId: 'synthetic_undo', branchId: 'active', snapshotId: 'one', mode: 'snapshot', complete: true,
    readerEvidence: { transcriptSha256: 'a'.repeat(64), pages: [{ range: { start: { message: 0, offset: 0 }, end: { message: 2, offset: 0 } }, hasMore: false }] } },
  structured: { version: 1, items: ['one', 'two'].map(id => ({ id, title: '合成候选 ' + id, body: '合成建议 ' + id,
    type: 'knowledge', sourceMessageIds: ['source_b'], uncertainties: ['合成未核验。'] })) } });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(tempRoot, 'chatgpt-undo-'));
  const config = { dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'), scheduler: false };
  const service = createService(config); service.updateSettings({ mcp: { chatgptEnabled: true } });
  const authority = Symbol('synthetic local user confirmation'); let clock = Date.now();
  const undo = createChatgptUndo({ getStore: () => service.store, localAuthority: authority, clock: () => clock, ttl: 60000 });
  t.after(() => { service.store.db.close(); assert.ok(root.startsWith(tempRoot + path.sep)); fs.rmSync(root, { recursive: true, force: true }); });
  return { service, store: service.store, config, undo, authority, expire() { clock += 60001; },
    file(noteId) { return path.join(config.vaultDir, service.store.read(noteId).path); } };
}
const selector = (value, receipt) => ({ requestId: value.requestId, noteId: receipt.noteId, syncRevision: receipt.syncRevision ?? null });
const ownedNotes = store => store.list().map(note => [note.id, note.hash]).toSorted((a, b) => a[0].localeCompare(b[0]));

test('preview cannot grant deletion through a JSON confirmation flag or impersonated authority', t => {
  const f = fixture(t), value = input(), saved = f.service.chatgpt.capture(value), before = ownedNotes(f.store);
  const preview = f.undo.preview(selector(value, saved));
  assert.equal(preview.requiresLocalConfirmation, true); assert.equal(preview.items.length, 3);
  assert.ok(!JSON.stringify(preview).includes(value.messages[0].content));
  assert.throws(() => f.undo.confirmUndo({ previewId: preview.previewId, confirm: true }), { code: 'CHATGPT_UNDO_LOCAL_CONFIRMATION' });
  assert.throws(() => f.undo.confirmUndo({ previewId: preview.previewId }, 'synthetic local user confirmation'), { code: 'CHATGPT_UNDO_LOCAL_CONFIRMATION' });
  assert.throws(() => f.undo.confirmUndo({ previewId: preview.previewId, confirm: true }, f.authority), { code: 'CHATGPT_UNDO_INVALID' });
  assert.deepEqual(ownedNotes(f.store), before); assert.equal(f.service.settings().mcp.chatgptAllowRead, false);
});

test('local operation list exposes only public previews and identifies expired entries', t => {
  const f = fixture(t), value = input(), saved = f.service.chatgpt.capture(value), preview = f.undo.preview(selector(value, saved));
  const listed = f.undo.list()[0];
  assert.equal(listed.previewId, preview.previewId); assert.equal(listed.kind, 'undo'); assert.equal(typeof listed.createdAt, 'string');
  assert.equal(listed.state, 'preview');
  for (const privateField of ['plan', 'body', 'raw', 'path', 'requestHash']) assert.ok(!Object.hasOwn(listed, privateField));
  assert.ok(!JSON.stringify(listed).includes(value.messages[0].content));
  assert.ok(!JSON.stringify(listed).includes(value.requestId)); assert.ok(!JSON.stringify(listed).includes(f.config.vaultDir));
  f.expire(); assert.equal(f.undo.list()[0].state, 'expired');
});

test('initial save recycles only the owned source/candidates and restores byte-identical originals idempotently', t => {
  const f = fixture(t), value = input(), saved = f.service.chatgpt.capture(value), before = ownedNotes(f.store);
  const original = f.store.row(saved.noteId).raw;
  const unrelated = f.store.create({ title: '另一份合成资料', body: '不属于本次保存。' });
  const preview = f.undo.preview(selector(value, saved)), undone = f.undo.confirmUndo({ previewId: preview.previewId }, f.authority);
  assert.equal(undone.status, 'undone'); assert.equal(undone.completedItems, 3); assert.equal(undone.recyclable, true);
  assert.deepEqual(ownedNotes(f.store), [[unrelated.id, unrelated.hash]]);
  for (const [noteId] of before) {
    assert.ok(f.store.history(noteId).length > 0);
    assert.equal(f.store.get('deleted', noteId).chatgptUndoId, undone.undoId);
  }
  const versions = f.store.history(saved.noteId).length;
  assert.equal(f.undo.confirmUndo({ previewId: preview.previewId }, f.authority).status, 'already_undone');
  assert.equal(f.store.history(saved.noteId).length, versions);
  const restore = f.undo.previewRestore({ undoId: undone.undoId }), restored = f.undo.confirmRestore({ previewId: restore.previewId }, f.authority);
  assert.equal(restored.status, 'restored'); assert.equal(restored.restoredItems, 3);
  assert.equal(fs.readFileSync(f.file(saved.noteId), 'utf8'), original);
  assert.deepEqual(ownedNotes(f.store).filter(([noteId]) => noteId !== unrelated.id), before);
  assert.equal(f.undo.confirmRestore({ previewId: restore.previewId }, f.authority).status, 'already_restored');
  assert.equal(f.undo.confirmUndo({ previewId: preview.previewId }, f.authority).status, 'already_restored');
  assert.equal(f.store.readPersisted(unrelated.id).hash, unrelated.hash);
});

test('updating undo restores the previous source revision and recycles only newly added candidates', t => {
  const f = fixture(t), firstInput = input(), first = f.service.chatgpt.capture(firstInput), priorRaw = f.store.row(first.noteId).raw;
  const nextInput = { ...firstInput, requestId: randomUUID(), summary: '第二版摘要。', sync: { ...firstInput.sync, snapshotId: 'two', baseRevision: 1 },
    structured: { version: 1, items: [firstInput.structured.items[0], { ...firstInput.structured.items[1], id: 'new', title: '新增候选', body: '第二版新增建议。' }] } };
  const next = f.service.chatgpt.capture(nextInput), nextRaw = f.store.row(next.noteId).raw;
  const older = first.importedNoteIds.map(noteId => f.store.readPersisted(noteId));
  const preview = f.undo.preview(selector(nextInput, next));
  assert.equal(preview.restoreToRevision, 1); assert.equal(preview.recycledCandidates, 1);
  assert.deepEqual(preview.preservedCandidateIds, [next.importedNoteIds[0]]);
  const undone = f.undo.confirmUndo({ previewId: preview.previewId }, f.authority);
  assert.equal(undone.status, 'undone'); assert.equal(undone.currentRevision, 1);
  assert.equal(f.store.row(first.noteId).raw, priorRaw); assert.equal(f.store.readPersisted(first.noteId).meta.chatgptSync.revision, 1);
  for (const old of older) assert.equal(f.store.readPersisted(old.id).hash, old.hash);
  assert.equal(f.store.row(next.importedNoteIds[1]), undefined);
  assert.equal(f.store.get('chatgptSyncSessions', f.store.read(first.noteId).meta.chatgptSync.sessionHash).revision, 1);
  const restore = f.undo.previewRestore({ undoId: undone.undoId });
  assert.equal(f.undo.confirmRestore({ previewId: restore.previewId }, f.authority).status, 'restored');
  assert.equal(f.store.row(next.noteId).raw, nextRaw); assert.equal(f.store.readPersisted(next.noteId).meta.chatgptSync.revision, 2);
  assert.equal(f.service.chatgpt.capture(nextInput).duplicate, true);
});

test('legacy current-context capture can be recycled and recovered without new library read permission', t => {
  const f = fixture(t), value = { requestId: randomUUID(), title: '合成旧形式保存', summary: '摘要。', messages: [{ role: 'user', content: '原文。' }], coverage: 'current_context' };
  const saved = f.service.chatgpt.capture(value), preview = f.undo.preview(selector(value, saved));
  const undone = f.undo.confirmUndo({ previewId: preview.previewId }, f.authority);
  assert.equal(undone.status, 'undone'); assert.equal(f.store.row(saved.noteId), undefined);
  const restore = f.undo.previewRestore({ undoId: undone.undoId });
  assert.equal(f.undo.confirmRestore({ previewId: restore.previewId }, f.authority).status, 'restored');
  assert.equal(f.service.chatgpt.capture(value).duplicate, true); assert.equal(f.service.settings().mcp.chatgptAllowRead, false);
});

test('restored previous runtime retains the original ownership needed for a later explicitly selected undo', t => {
  const f = fixture(t), firstInput = input(), first = f.service.chatgpt.capture(firstInput);
  const secondInput = { ...firstInput, requestId: randomUUID(), summary: '第二次保存。', sync: { ...firstInput.sync, snapshotId: 'two', baseRevision: 1 } };
  const second = f.service.chatgpt.capture(secondInput), secondPreview = f.undo.preview(selector(secondInput, second));
  assert.equal(f.undo.confirmUndo({ previewId: secondPreview.previewId }, f.authority).status, 'undone');
  const firstPreview = f.undo.preview(selector(firstInput, first));
  assert.equal(firstPreview.recycledCandidates, 2);
  assert.equal(f.undo.confirmUndo({ previewId: firstPreview.previewId }, f.authority).status, 'undone');
  assert.equal(f.store.list().length, 0);
});

test('a deduplicated alias request cannot revoke another request that created the source', t => {
  const f = fixture(t), value = input(); f.service.chatgpt.capture(value);
  const duplicateInput = { ...value, requestId: randomUUID() }, duplicate = f.service.chatgpt.capture(duplicateInput);
  assert.throws(() => f.undo.preview(selector(duplicateInput, duplicate)), { code: 'CHATGPT_UNDO_NO_CHANGE' });
  assert.equal(f.store.list().length, 3);
});

for (const change of ['source', 'candidate', 'dependency', 'runtime']) test(`a later ${change} change conflicts before any undo writes`, t => {
  const f = fixture(t), value = input(), saved = f.service.chatgpt.capture(value), preview = f.undo.preview(selector(value, saved));
  if (change === 'source' || change === 'candidate') {
    const note = f.store.read(change === 'source' ? saved.noteId : saved.importedNoteIds[0]);
    f.store.update(note.id, { expectedHash: note.hash, body: '后来的人工修改。' });
  } else if (change === 'dependency') f.store.create({ title: '后来依赖', body: '必须保留。', meta: { sources: [{ id: saved.noteId, role: 'input' }] } });
  else { const state = f.store.records('chatgptSyncSessions')[0]; f.store.put('chatgptSyncSessions', state.key, { ...state, pending: true }); }
  const before = ownedNotes(f.store);
  assert.throws(() => f.undo.confirmUndo({ previewId: preview.previewId }, f.authority), { code: 'CHATGPT_UNDO_CONFLICT' });
  assert.deepEqual(ownedNotes(f.store), before); assert.equal(f.store.records('chatgptUndo')[0].state, 'preview');
});

test('a batch manifest dependency prevents unsafe isolated-part undo', t => {
  const f = fixture(t), value = input(), saved = f.service.chatgpt.capture(value);
  f.store.put('chatgptHistoryBatches', 'synthetic_batch', { version: 1, sourceNoteIds: [saved.noteId], state: 'complete' });
  assert.throws(() => f.undo.preview(selector(value, saved)), { code: 'CHATGPT_UNDO_CONFLICT' });
  assert.equal(f.store.list().length, 3);
});

test('an expired preview or mismatched receipt identity cannot be executed', t => {
  const f = fixture(t), value = input(), saved = f.service.chatgpt.capture(value);
  assert.throws(() => f.undo.preview({ ...selector(value, saved), syncRevision: 2 }), { code: 'CHATGPT_UNDO_CONFLICT' });
  const preview = f.undo.preview(selector(value, saved)); f.expire();
  assert.throws(() => f.undo.confirmUndo({ previewId: preview.previewId }, f.authority), { code: 'CHATGPT_UNDO_EXPIRED' });
  assert.equal(f.store.list().length, 3);
});

test('partial undo keeps recoverable originals and resumes only the same journal', t => {
  const f = fixture(t), value = input(), saved = f.service.chatgpt.capture(value), preview = f.undo.preview(selector(value, saved));
  const remove = f.store.delete.bind(f.store); let attempted = 0;
  f.store.delete = (...args) => { if (++attempted === 2) throw new Error('synthetic second file failure'); return remove(...args); };
  const partial = f.undo.confirmUndo({ previewId: preview.previewId }, f.authority);
  assert.equal(partial.status, 'partial'); assert.equal(partial.completedItems, 1); assert.equal(f.store.list().length, 2);
  assert.ok(f.store.history(saved.importedNoteIds[0]).length > 0);
  f.store.delete = remove;
  const resumed = f.undo.confirmUndo({ previewId: preview.previewId }, f.authority);
  assert.equal(resumed.status, 'undone'); assert.equal(resumed.completedItems, 3);
  const restore = f.undo.previewRestore({ undoId: resumed.undoId });
  assert.equal(f.undo.confirmRestore({ previewId: restore.previewId }, f.authority).status, 'restored');
});

test('partial restoration reports incomplete state and safely resumes without overwriting restored files', t => {
  const f = fixture(t), value = input(), saved = f.service.chatgpt.capture(value), original = ownedNotes(f.store);
  const preview = f.undo.preview(selector(value, saved)), undone = f.undo.confirmUndo({ previewId: preview.previewId }, f.authority);
  const restore = f.undo.previewRestore({ undoId: undone.undoId }), recover = f.store.restoreVersionExact.bind(f.store); let attempted = 0;
  f.store.restoreVersionExact = (...args) => { if (++attempted === 2) throw new Error('synthetic restore failure'); return recover(...args); };
  const partial = f.undo.confirmRestore({ previewId: restore.previewId }, f.authority);
  assert.equal(partial.status, 'partial'); assert.equal(partial.restoredItems, 1);
  f.store.restoreVersionExact = recover;
  assert.equal(f.undo.confirmRestore({ previewId: restore.previewId }, f.authority).status, 'restored');
  assert.deepEqual(ownedNotes(f.store), original);
});

test('an audit persistence failure after a file operation is explicitly partial and never a false success', t => {
  const f = fixture(t), value = input(), saved = f.service.chatgpt.capture(value), preview = f.undo.preview(selector(value, saved));
  const put = f.store.put.bind(f.store);
  f.store.put = (namespace, key, record) => {
    if (namespace === 'chatgptUndo' && record.steps?.some(step => step.state === 'done')) throw new Error('synthetic audit persistence failure');
    return put(namespace, key, record);
  };
  const result = f.undo.confirmUndo({ previewId: preview.previewId }, f.authority);
  assert.equal(result.status, 'partial'); assert.equal(result.auditPersisted, false);
  assert.equal(result.completedItems, 1); assert.equal(f.store.list().length, 2);
  assert.ok(f.store.history(saved.importedNoteIds[0]).length > 0);
  assert.notEqual(f.store.get('chatgptUndo', preview.previewId).state, 'undone');
});

test('restore refuses reused identities before writes', t => {
  const f = fixture(t), value = input(), saved = f.service.chatgpt.capture(value);
  const preview = f.undo.preview(selector(value, saved)), undone = f.undo.confirmUndo({ previewId: preview.previewId }, f.authority);
  const foreign = f.store.create({ id: saved.noteId, kind: 'source', title: '新身份占用', body: '不能覆盖。' });
  assert.throws(() => f.undo.previewRestore({ undoId: undone.undoId }), { code: 'CHATGPT_UNDO_CONFLICT' });
  assert.equal(f.store.readPersisted(foreign.id).body, '不能覆盖。');
});

test('a later historical dependency is retained and prevents undo even after its active link was removed', t => {
  const f = fixture(t), value = input(), saved = f.service.chatgpt.capture(value);
  const dependent = f.store.create({ title: '合成历史关联', body: '关联版本。', meta: { sources: [{ id: saved.noteId, role: 'input' }] } });
  f.store.update(dependent.id, { expectedHash: dependent.hash, body: '当前未关联。', meta: { sources: [] } });
  assert.throws(() => f.undo.preview(selector(value, saved)), { code: 'CHATGPT_UNDO_CONFLICT' });
  assert.ok(f.store.history(dependent.id).some(version => version.raw.includes(saved.noteId)));
  assert.equal(f.store.list().length, 4);
});

for (const change of ['dependency', 'missing_version']) test(`restore detects ${change} after preview before creating any files`, t => {
  const f = fixture(t), value = input(), saved = f.service.chatgpt.capture(value);
  const preview = f.undo.preview(selector(value, saved)), undone = f.undo.confirmUndo({ previewId: preview.previewId }, f.authority);
  const restore = f.undo.previewRestore({ undoId: undone.undoId });
  if (change === 'dependency') f.store.create({ title: '后来引用回收对象', body: '须保留。', meta: { sources: [{ id: saved.noteId, role: 'input' }] } });
  else f.store.db.prepare('DELETE FROM versions WHERE noteId=?').run(saved.noteId); // Synthetic loss injection only.
  const before = ownedNotes(f.store);
  assert.throws(() => f.undo.confirmRestore({ previewId: restore.previewId }, f.authority), { code: 'CHATGPT_UNDO_CONFLICT' });
  assert.deepEqual(ownedNotes(f.store), before);
});

test('tampering with the persisted plan cannot expand a previously previewed scope', t => {
  const f = fixture(t), value = input(), saved = f.service.chatgpt.capture(value);
  const unrelated = f.store.create({ title: '不能扩大到这份', body: '无关资料。' });
  const preview = f.undo.preview(selector(value, saved)), record = f.store.get('chatgptUndo', preview.previewId);
  record.plan.steps.push({ noteId: unrelated.id, action: 'recycle', beforeHash: unrelated.hash, path: unrelated.path });
  f.store.put('chatgptUndo', record.id, record);
  assert.throws(() => f.undo.confirmUndo({ previewId: preview.previewId }, f.authority), { code: 'CHATGPT_UNDO_CONFLICT' });
  assert.equal(f.store.list().length, 4);
});

test('an edit during exact-restore audit is retained instead of overwritten', t => {
  const f = fixture(t), note = f.store.create({ kind: 'source', title: '合成恢复竞态', body: '最初。' });
  const firstVersion = f.store.history(note.id).find(version => version.hash === note.hash);
  const current = f.store.update(note.id, { expectedHash: note.hash, body: '保存的新版本。' }), audit = f.store.version.bind(f.store);
  f.store.version = (row, reason) => { audit(row, reason); if (reason === '受限撤销或恢复前原始版本') fs.appendFileSync(f.file(note.id), '\n审计期间的人工修改。'); };
  assert.throws(() => f.store.restoreVersionExact(note.id, firstVersion.versionId, { expectedHash: current.hash }), { code: 'PERSISTED_MISMATCH' });
  assert.ok(fs.readFileSync(f.file(note.id), 'utf8').endsWith('审计期间的人工修改。'));
});

test('an edit during recycle audit is retained instead of unlinked', t => {
  const f = fixture(t), value = input(), saved = f.service.chatgpt.capture(value), preview = f.undo.preview(selector(value, saved));
  const candidateId = saved.importedNoteIds[0], file = f.file(candidateId), audit = f.store.version.bind(f.store);
  f.store.version = (row, reason) => { audit(row, reason); if (row.id === candidateId && reason === '用户删除') fs.appendFileSync(file, '\n回收审计期间的人工修改。'); };
  const result = f.undo.confirmUndo({ previewId: preview.previewId }, f.authority);
  assert.equal(result.status, 'pending'); assert.equal(result.completedItems, 0);
  assert.equal(result.errorCode, 'CONFLICT');
  assert.ok(fs.readFileSync(file, 'utf8').endsWith('回收审计期间的人工修改。'));
});

test('exact raw restoration removes newly introduced metadata and retains original createdAt and all histories', t => {
  const f = fixture(t), note = f.store.create({ kind: 'source', title: '合成精确版本', body: '原始正文。', meta: { privacy: 'local' } });
  const firstVersion = f.store.history(note.id).find(version => version.hash === note.hash), firstRaw = f.store.row(note.id).raw;
  const updated = f.store.update(note.id, { expectedHash: note.hash, body: '新正文。', meta: { onlyInNewVersion: '不能混入旧版本' } });
  assert.throws(() => f.store.restoreVersionExact(note.id, firstVersion.versionId, { expectMissing: true }), { code: 'EXACT_RESTORE_CONFLICT' });
  const restored = f.store.restoreVersionExact(note.id, firstVersion.versionId, { expectedHash: updated.hash });
  assert.equal(f.store.row(note.id).raw, firstRaw); assert.equal(restored.meta.onlyInNewVersion, undefined);
  assert.equal(hash(fs.readFileSync(f.file(note.id))), firstVersion.hash);
  assert.ok(f.store.history(note.id).some(version => version.hash === updated.hash));
});

test('readPersisted includeRaw returns the actual disk bytes as text without changing the default shape', t => {
  const f = fixture(t), note = f.store.create({ kind: 'source', title: '合成原始读取', body: '合成正文🙂\r\n' });
  const basic = f.store.readPersisted(note.id), withRaw = f.store.readPersisted(note.id, { includeRaw: true });
  assert.equal(basic.raw, undefined); assert.deepEqual(basic, note);
  assert.equal(withRaw.raw, fs.readFileSync(f.file(note.id), 'utf8'));
  assert.equal(hash(withRaw.raw), withRaw.hash); const { raw: _raw, ...rest } = withRaw; assert.deepEqual(rest, basic);
});

test('exclusive create commits a complete file atomically and leaves no staging links behind', t => {
  const f = fixture(t), note = f.store.create({ id: 'exclusive_synthetic', kind: 'source', title: '独占合成资料', body: '完整内容🙂', exclusive: true });
  assert.equal(f.store.readPersisted(note.id, { includeRaw: true }).raw, fs.readFileSync(f.file(note.id), 'utf8'));
  assert.equal(fs.statSync(f.file(note.id)).nlink, 1);
  assert.deepEqual(fs.readdirSync(path.dirname(f.file(note.id))).filter(file => file.endsWith('.tmp')), []);
});

test('a competing writer at the atomic exclusive claim cannot be overwritten or indexed as our source', t => {
  const f = fixture(t), link = fs.linkSync; let claimedFile;
  fs.linkSync = (staged, target) => { claimedFile = target; fs.writeFileSync(target, '合成竞争写入，不能覆盖。'); return link(staged, target); };
  try {
    assert.throws(() => f.store.create({ id: 'exclusive_race', kind: 'source', title: '合成占位竞争', body: '待保存。', exclusive: true }), { code: 'CONFLICT' });
  } finally { fs.linkSync = link; }
  assert.equal(fs.readFileSync(claimedFile, 'utf8'), '合成竞争写入，不能覆盖。');
  assert.equal(f.store.row('exclusive_race'), undefined);
  assert.deepEqual(fs.readdirSync(path.dirname(claimedFile)).filter(file => file.endsWith('.tmp')), []);
});

test('exclusive create fails closed when the filesystem cannot atomically claim without replacement', t => {
  const f = fixture(t), link = fs.linkSync;
  fs.linkSync = () => { const error = new Error('synthetic unsupported hard links'); error.code = 'ENOTSUP'; throw error; };
  try {
    assert.throws(() => f.store.create({ id: 'exclusive_unsupported', kind: 'source', title: '合成不支持', body: '待保存。', exclusive: true }), { code: 'ENOTSUP' });
  } finally { fs.linkSync = link; }
  assert.equal(f.store.row('exclusive_unsupported'), undefined);
  const target = path.join(f.config.vaultDir, '01 原始资料', 'exclusive_unsupported.md');
  assert.equal(fs.existsSync(target), false);
  assert.deepEqual(fs.readdirSync(path.dirname(target)).filter(file => file.endsWith('.tmp')), []);
});

test('restoration of a missing source also uses an atomic claim and preserves a concurrent new occupant', t => {
  const f = fixture(t), value = input(), saved = f.service.chatgpt.capture(value);
  const preview = f.undo.preview(selector(value, saved)), undone = f.undo.confirmUndo({ previewId: preview.previewId }, f.authority);
  const restore = f.undo.previewRestore({ undoId: undone.undoId }), link = fs.linkSync; let claimedFile;
  fs.linkSync = (staged, target) => { claimedFile = target; fs.writeFileSync(target, '恢复期间出现的新文件，不能覆盖。'); return link(staged, target); };
  try {
    const result = f.undo.confirmRestore({ previewId: restore.previewId }, f.authority);
    assert.equal(result.status, 'pending'); assert.equal(result.restoredItems, 0);
    assert.equal(result.errorCode, 'EXACT_RESTORE_CONFLICT');
  } finally { fs.linkSync = link; }
  assert.equal(fs.readFileSync(claimedFile, 'utf8'), '恢复期间出现的新文件，不能覆盖。');
  assert.equal(f.store.row(saved.noteId), undefined);
});
