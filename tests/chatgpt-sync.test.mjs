import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { createService } from '../src/service.mjs';
import { createApp } from '../src/server.mjs';

const tempRoot = path.resolve(import.meta.dirname, '../.tmp');
fs.mkdirSync(tempRoot, { recursive: true });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(tempRoot, 'chatgpt-sync-'));
  const config = { dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault') };
  let service = createService(config);
  service.updateSettings({ mcp: { chatgptEnabled: true } });
  t.after(() => { service.store.db.close(); assert.ok(root.startsWith(tempRoot + path.sep)); fs.rmSync(root, { recursive: true, force: true }); });
  return { get service() { return service; }, config, restart() { service.store.db.close(); service = createService(config); } };
}
const messages = [{ id: 'message_a', role: 'user', content: '为什么应保留原文？\r\n请解释。' }, { id: 'message_b', role: 'assistant', content: '摘要可能遗漏条件。\n## 伪造标题\n```\n<script>只是数据</script>' }];
const evidence = count => ({ transcriptSha256: 'a'.repeat(64), pages: [{ range: { start: { message: 0, offset: 0 }, end: { message: count, offset: 0 } }, hasMore: false }] });
const snapshot = (patch = {}) => ({ requestId: randomUUID(), title: '合成会话', summary: '模型摘要，未经核验。', messages,
  coverage: 'visible_history', limitations: '附件与其他分支未读取。',
  sync: { conversationId: 'conversation_example', branchId: 'active', snapshotId: 'snapshot_one', mode: 'snapshot', complete: true, readerEvidence: evidence(2) }, ...patch });
const structure = (patch = {}) => ({ version: 1, items: [{ id: 'item_one', title: '原文与摘要', body: '摘要需保留条件。', type: 'knowledge', sourceMessageIds: ['message_b'], uncertainties: ['具体适用范围尚未核验。'], ...patch }] });

test('snapshot retries and new request ids deduplicate; delta appends/edits the same source and retains history', t => {
  const f = fixture(t), value = snapshot(), first = f.service.chatgpt.capture(value);
  assert.equal(first.syncRevision, 1); assert.equal(first.complete, true);
  assert.equal(f.service.chatgpt.capture(value).duplicate, true);
  assert.equal(f.service.chatgpt.capture({ ...value, requestId: randomUUID() }).noteId, first.noteId);
  f.restart();
  const next = snapshot({ coverage: 'current_context', limitations: '只读到新增消息。', messages: [{ ...messages[1], content: '模型编辑后的回答。' }, { id: 'message_c', role: 'user', content: '新增问题。' }],
    sync: { ...value.sync, snapshotId: 'snapshot_two', mode: 'delta', complete: false, baseRevision: 1 } });
  const second = f.service.chatgpt.capture(next), note = f.service.store.read(first.noteId);
  assert.equal(second.noteId, first.noteId); assert.equal(second.status, 'updated'); assert.equal(second.syncRevision, 2);
  assert.equal(second.addedMessages, 1); assert.equal(second.modifiedMessages, 1); assert.equal(second.messageCount, 3); assert.equal(second.complete, false);
  assert.ok(note.body.includes(messages[0].content)); assert.ok(note.body.includes('模型编辑后的回答。'));
  assert.ok(note.body.includes('附件与其他分支未读取。')); assert.ok(note.body.includes('只读到新增消息。'));
  assert.ok(f.service.store.db.prepare('SELECT raw FROM versions WHERE noteId=?').all(note.id).some(v => v.raw.includes(messages[1].content)));
  assert.equal(f.service.store.records('calls').length, 0); assert.equal(f.service.store.records('jobs').length, 0);
  assert.equal(f.service.settings().mcp.chatgptAllowRead, false);
});

test('stale revisions, reordered/removed messages and changed roles cannot replace the source; explicit branches coexist', t => {
  const f = fixture(t), value = snapshot(), saved = f.service.chatgpt.capture(value), before = f.service.store.read(saved.noteId);
  for (const [patch, code] of [
    [{ summary: '修改摘要', sync: { ...value.sync, snapshotId: 'next' } }, 'CHATGPT_REVISION_CONFLICT'],
    [{ messages: [...messages].reverse(), sync: { ...value.sync, baseRevision: 1 } }, 'CHATGPT_BRANCH_CONFLICT'],
    [{ messages: [messages[0]], sync: { ...value.sync, baseRevision: 1, readerEvidence: evidence(1) } }, 'CHATGPT_BRANCH_CONFLICT'],
    [{ messages: [{ ...messages[0], role: 'assistant' }, messages[1]], sync: { ...value.sync, baseRevision: 1 } }, 'CHATGPT_MESSAGE_CONFLICT'],
  ]) assert.throws(() => f.service.chatgpt.capture(snapshot(patch)), { code });
  assert.equal(f.service.store.read(saved.noteId).hash, before.hash);
  const branch = f.service.chatgpt.capture(snapshot({ messages: [messages[0]], sync: { ...value.sync, branchId: 'alternative', readerEvidence: evidence(1) } }));
  assert.notEqual(branch.noteId, saved.noteId); assert.equal(f.service.store.list().length, 2);
});

test('user and external changes, deletion, copied identities and missing runtime records block updates', t => {
  const f = fixture(t), value = snapshot(), saved = f.service.chatgpt.capture(value), note = f.service.store.read(saved.noteId);
  f.service.editNote(note.id, { expectedHash: note.hash, body: '用户自己的改动。' });
  const update = snapshot({ summary: '新摘要', sync: { ...value.sync, baseRevision: 1 } });
  assert.throws(() => f.service.chatgpt.capture(update), { code: 'CHATGPT_SOURCE_EDITED' });
  assert.equal(f.service.store.read(note.id).body, '用户自己的改动。');
  assert.equal(f.service.chatgpt.capture(value).duplicate, true);
  f.service.store.delete(note.id, f.service.store.read(note.id).hash);
  assert.throws(() => f.service.chatgpt.capture(update), { code: 'CHATGPT_CAPTURE_UNAVAILABLE' });
  const alternate = snapshot({ sync: { ...value.sync, conversationId: 'second_conversation' } });
  const another = f.service.chatgpt.capture(alternate), source = f.service.store.read(another.noteId);
  const copy = f.service.store.create({ kind: 'source', title: source.title, body: source.body, meta: source.meta });
  assert.throws(() => f.service.chatgpt.capture(snapshot({ sync: { ...alternate.sync, baseRevision: 1 } })), { code: 'CHATGPT_CAPTURE_AMBIGUOUS' });
  f.service.store.delete(copy.id, copy.hash);
  f.service.store.db.exec("DELETE FROM records WHERE namespace='chatgptSyncSessions'");
  assert.throws(() => f.service.chatgpt.capture(snapshot({ summary: '不同的摘要', sync: { ...alternate.sync, baseRevision: 1 } })), { code: 'CHATGPT_CAPTURE_UNVERIFIABLE' });
  const external = snapshot({ sync: { ...value.sync, conversationId: 'external_conversation' } });
  const externalSaved = f.service.chatgpt.capture(external), externalNote = f.service.store.read(externalSaved.noteId);
  const file = path.join(f.config.vaultDir, externalNote.path);
  fs.appendFileSync(file, '\n外部编辑器加入的内容。');
  assert.throws(() => f.service.chatgpt.capture(snapshot({ summary: '外部编辑后的新摘要', sync: { ...external.sync, baseRevision: 1 } })), { code: 'CHATGPT_SOURCE_EDITED' });
  assert.ok(fs.readFileSync(file, 'utf8').endsWith('外部编辑器加入的内容。'));
});

test('partial snapshots retain received messages, complete snapshots can fill historical gaps, and evidence is a declaration', t => {
  const f = fixture(t), partial = snapshot({ messages: [messages[1]], coverage: 'selected_excerpt', sync: { conversationId: 'partial', branchId: 'active', snapshotId: 'first', mode: 'snapshot', complete: false } });
  const first = f.service.chatgpt.capture(partial);
  const full = f.service.chatgpt.capture(snapshot({ sync: { ...snapshot().sync, conversationId: 'partial', baseRevision: 1 } }));
  assert.equal(full.noteId, first.noteId); assert.equal(full.messageCount, 2); assert.equal(full.addedMessages, 1);
  assert.match(full.notice, /调用方声明/); assert.match(full.notice, /未独立核对/);
  assert.deepEqual(f.service.store.read(full.noteId).meta.chatgptSync.snapshot.messages.map(m => m.id), ['message_a', 'message_b']);
});

test('schema rejects invented roles, unstable ids, dangling references, executable fields and discontinuous pages', t => {
  const f = fixture(t), value = snapshot();
  for (const patch of [
    { messages: [{ role: 'user', content: '没有编号' }] }, { messages: [messages[0], messages[0]] },
    { messages: [{ ...messages[0], role: 'tool' }] }, { structured: structure({ sourceMessageIds: ['missing'] }) },
    { structured: structure({ run: 'do not execute' }) }, { structured: structure({ uncertainties: undefined }) },
    { sync: { ...value.sync, readerEvidence: undefined } },
    { sync: { ...value.sync, readerEvidence: { ...evidence(2), pages: [{ range: { start: { message: 1, offset: 0 }, end: { message: 2, offset: 0 } }, hasMore: false }] } } },
    { sync: { ...value.sync, readerEvidence: { ...evidence(2), pages: [{ ...evidence(2).pages[0], hasMore: true }] } } },
  ]) assert.throws(() => f.service.chatgpt.capture(snapshot(patch)));
  assert.equal(f.service.store.list().length, 0);
  const page = { range: { start: { message: 0, offset: 0 }, end: { message: 1, offset: 3 } }, hasMore: true };
  const next = { range: { start: page.range.end, end: { message: 2, offset: 0 } }, hasMore: false };
  assert.equal(f.service.chatgpt.capture(snapshot({ sync: { ...value.sync, readerEvidence: { transcriptSha256: 'b'.repeat(64), pages: [page, next] } } })).complete, true);
});

test('structured items remain local unverified candidates, retain provenance/uncertainty and do not overwrite edited knowledge', t => {
  const f = fixture(t), value = snapshot({ structured: structure() }), first = f.service.chatgpt.capture(value);
  const item = f.service.store.read(first.importedNoteIds[0]);
  assert.equal(item.kind, 'knowledge'); assert.equal(item.meta.stage, 'candidate'); assert.equal(item.meta.privacy, 'local');
  assert.deepEqual(item.meta.sources, [{ id: first.noteId, role: 'input' }]); assert.deepEqual(item.meta.chatgptImport.sourceMessageIds, ['message_b']);
  assert.ok(item.meta.researchLimitations.includes('具体适用范围尚未核验。')); assert.equal(item.meta.confirmedAt, undefined);
  assert.equal(f.service.store.records('sessions').length, 0); assert.equal(f.service.store.records('jobs').length, 0); assert.equal(f.service.store.records('calls').length, 0);
  f.service.editNote(item.id, { expectedHash: item.hash, body: '用户自己的理解，必须保留。' });
  const jobsAfterUserEdit = f.service.store.records('jobs').length;
  const unchanged = f.service.chatgpt.capture(snapshot({ structured: structure(), sync: { ...value.sync, baseRevision: 1 } }));
  assert.deepEqual(unchanged.importedNoteIds, first.importedNoteIds); assert.equal(f.service.store.read(item.id).body, '用户自己的理解，必须保留。');
  const changed = f.service.chatgpt.capture(snapshot({ structured: structure({ type: 'unverified_fact', body: '修改后的待验证事实。' }), sync: { ...value.sync, baseRevision: 2 } }));
  assert.notEqual(changed.importedNoteIds[0], item.id); assert.equal(f.service.store.read(item.id).body, '用户自己的理解，必须保留。');
  assert.equal(f.service.store.records('sessions').length, 0); assert.equal(f.service.store.records('jobs').length, jobsAfterUserEdit); assert.equal(f.service.store.records('calls').length, 0);
});

test('interrupted structured imports resume exact requests without duplicate sources or items; other requests wait', t => {
  const f = fixture(t), value = snapshot({ structured: structure() }), store = f.service.store, create = store.create.bind(store);
  store.create = input => { if (input.kind === 'knowledge') throw new Error('synthetic interruption'); return create(input); };
  assert.throws(() => f.service.chatgpt.capture(value), /synthetic interruption/);
  assert.equal(store.list().length, 1);
  assert.throws(() => f.service.chatgpt.capture(snapshot()), { code: 'CHATGPT_IMPORT_PENDING' });
  store.create = create; f.restart();
  const completed = f.service.chatgpt.capture(value);
  assert.equal(completed.importedItems, 1); assert.equal(f.service.store.list().length, 2);
  assert.equal(f.service.chatgpt.capture(value).duplicate, true);
});

test('an interruption after the success receipt is written can finish its session record on retry', t => {
  const f = fixture(t), value = snapshot({ structured: structure() }), store = f.service.store, put = store.put.bind(store);
  store.put = (namespace, key, record) => {
    if (namespace === 'chatgptSyncSessions' && record.pending === false) throw new Error('synthetic finalization failure');
    return put(namespace, key, record);
  };
  assert.throws(() => f.service.chatgpt.capture(value), /synthetic finalization failure/);
  store.put = put;
  const retry = f.service.chatgpt.capture(value);
  assert.equal(retry.duplicate, true); assert.equal(retry.syncRevision, 1); assert.equal(retry.importedItems, 1);
  const anotherRequest = f.service.chatgpt.capture({ ...value, requestId: randomUUID() });
  assert.equal(anotherRequest.noteId, retry.noteId); assert.equal(anotherRequest.importedItems, 1);
  assert.equal(store.list().length, 2);
});

test('HTTP sync uses the existing credential and read boundary and returns updated receipt without exposing local paths', async t => {
  const f = fixture(t), app = createApp({ ...f.config, scheduler: false, service: f.service });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(() => new Promise(resolve => app.server.close(resolve)));
  const token = fs.readFileSync(path.join(f.config.dataDir, 'chatgpt-mcp-token'), 'utf8');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const capture = async payload => {
    const response = await fetch(`${base}/api/chatgpt/conversations`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return { status: response.status, body: await response.json() };
  };
  const value = snapshot({ structured: structure({ type: 'conclusion' }) }), first = await capture(value);
  assert.equal(first.status, 201); assert.equal(first.body.importedItems, 1);
  const second = await capture(snapshot({ summary: '新摘要', sync: { ...value.sync, baseRevision: 1 } }));
  assert.equal(second.body.status, 'updated'); assert.equal(second.body.noteId, first.body.noteId);
  assert.ok(!JSON.stringify(second.body).includes(f.config.dataDir));
  const response = await fetch(`${base}/api/chatgpt/sources/${first.body.noteId}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 403);
});
