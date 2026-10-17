import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createService } from '../src/service.mjs';
import { parseConversation } from '../src/chatgpt.mjs';
import { historySourceMetadata, validSourceDate } from '../src/chatgpt-source-metadata.mjs';

const tempRoot = path.resolve(import.meta.dirname, '../.tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function snapshot(date = '2024-02-29T00:15:42.590+08:00', count = 2) {
  const units = Array.from({ length: count }, (_, index) => ({ index, message_id: `message_${index}`,
    role: index % 2 ? 'assistant' : 'user', content: `Synthetic source ${index}`, created_at: index ? '2025-01-02T15:00:00+08:00' : date }));
  return { version: 1, conversation_id: '11111111-1111-4111-8111-111111111111', title: 'Current source title', branch: 'active',
    snapshot_id: 'a'.repeat(32), transcript_sha256: sha(units), units,
    pages: [{ range: { start: { message: 0, offset: 0 }, end: { message: count, offset: 0 } }, hasMore: false }],
    coverage: { text: 'complete_visible_active_branch' }, updated_at: '2026-01-01T00:00:00+08:00',
    issued_at: Date.now(), expires_at: Date.now() + 60000 };
}
const input = () => ({ requestId: randomUUID(), historySnapshotRef: 'zhixu-history-v1:' + 'b'.repeat(64), summary: 'Synthetic summary' });
function fixture(t, payload = snapshot()) {
  const root = fs.mkdtempSync(path.join(tempRoot, 'chat-meta-'));
  const service = createService({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'), receiveHistorySnapshot: async () => payload });
  service.updateSettings({ mcp: { chatgptEnabled: true } });
  t.after(() => { service.store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return service;
}
const manual = (extra = {}) => ({ requestId: randomUUID(), title: 'Actual current title', summary: 'Separate summary',
  coverage: 'current_context', messages: [{ role: 'user', content: 'Synthetic original' }],
  conversationUrl: 'https://chatgpt.com/g/g-synthetic/project/c/11111111-1111-4111-8111-111111111111', ...extra });

test('manual capture preserves full URL and title as locator; source date stays separate from acquisition', t => {
  const service = fixture(t), value = manual({ conversationDate: '2024-02-29', conversationDateBasis: 'Visible first message date' });
  const result = service.chatgpt.capture(value), note = service.store.read(result.noteId);
  assert.equal(note.meta.date, '2024-02-29'); assert.equal(note.meta.locator, value.title);
  assert.equal(note.meta.url, value.conversationUrl); assert.equal(note.meta.acquiredAt, result.savedAt);
  assert.equal(note.meta.dateBasis, value.conversationDateBasis);
  assert.equal(note.meta.origins[0].date, note.meta.date); assert.equal(note.meta.origins[0].locator, value.title);
  assert.equal(service.chatgpt.capture(value).duplicate, true);
});

test('unknown manual date is not inferred from title, body, or import time; invalid calendar dates reject', t => {
  const service = fixture(t), value = manual({ title: '2025-01-01 is only a title' });
  const result = service.chatgpt.capture(value), note = service.store.read(result.noteId);
  assert.equal(note.meta.date, ''); assert.match(note.meta.dateBasis, /未提供/);
  for (const date of ['2023-02-29', '2024-02-30', '2024-13-01', 'today', '2024-02-29T00:00:00Z']) {
    assert.equal(validSourceDate(date), false); assert.throws(() => parseConversation(manual({ conversationDate: date })), { code: 'CHATGPT_INVALID' });
  }
});

test('authenticated history maps first visible message date with original timezone and explicit basis', async t => {
  const payload = snapshot(), service = fixture(t, payload), request = input();
  const result = await service.chatgpt.captureHistorySnapshot(request), note = service.store.read(result.noteId);
  assert.equal(note.meta.date, '2024-02-29'); // UTC conversion would incorrectly be Feb 28.
  assert.equal(note.meta.locator, payload.title);
  assert.equal(note.meta.url, `https://chatgpt.com/c/${payload.conversation_id}`);
  assert.match(note.meta.dateBasis, /units\[0\].created_at/); assert.match(note.meta.dateBasis, /不是平台会话创建日期/);
  assert.equal(note.meta.acquiredAt, result.savedAt);
  assert.equal((await service.chatgpt.captureHistorySnapshot(request)).duplicate, true);
});

test('missing or malformed first message date never uses later messages, update time, or issuance', () => {
  for (const raw of [null, undefined, '', 0, 1740000000, '2024-02-30T12:00:00Z', '2024-02-29T99:00:00Z', '2024-02-29garbage']) {
    const payload = snapshot(); payload.units[0].created_at = raw;
    assert.equal(historySourceMetadata(payload).conversationDate, '');
  }
});

test('every independently stored history part keeps the unsuffixed source title, date and complete URL', async t => {
  const payload = snapshot('2024-02-29T00:15:42+08:00', 201), service = fixture(t, payload), request = input();
  const result = await service.chatgpt.captureHistoryBatch(request);
  assert.equal(result.complete, true);
  const notes = service.store.list().filter(note => note.kind === 'source'); assert.ok(notes.length > 1);
  for (const note of notes) {
    assert.equal(note.meta.date, '2024-02-29'); assert.equal(note.meta.locator, payload.title);
    assert.equal(note.meta.url, `https://chatgpt.com/c/${payload.conversation_id}`);
    assert.equal(note.meta.origins[0].locator, payload.title); assert.match(note.meta.dateBasis, /首条消息/);
  }
  assert.equal((await service.chatgpt.captureHistoryBatch(request)).complete, true);
});

test('new snapshot updates the received current title, while edited metadata blocks silent overwrite', async t => {
  const payload = snapshot(), service = fixture(t, payload);
  const first = await service.chatgpt.captureHistorySnapshot(input());
  payload.title = 'Renamed source conversation'; payload.snapshot_id = 'c'.repeat(32);
  const second = await service.chatgpt.captureHistorySnapshot({ ...input(), baseRevision: 1 });
  assert.equal(second.noteId, first.noteId); assert.equal(service.store.read(first.noteId).meta.locator, payload.title);
  const note = service.store.read(first.noteId);
  service.store.update(note.id, { expectedHash: note.hash, meta: { ...note.meta, date: '2020-01-01', locator: 'User correction' } });
  await assert.rejects(service.chatgpt.captureHistorySnapshot({ ...input(), baseRevision: 2 }), { code: 'CHATGPT_SOURCE_EDITED' });
  assert.equal(service.store.read(note.id).meta.locator, 'User correction');
});

test('source views show date provenance as text, separately from acquisition', () => {
  const app = fs.readFileSync(new URL('../public/app.mjs', import.meta.url), 'utf8');
  assert.equal(app.match(/text: "导入时日期依据"/g)?.length, 2);
  assert.match(app, /text: `导入时日期依据：\$\{origin.dateBasis\}`/);
});

test('pre-upgrade pending sync resumes its old origin template without a metadata migration', t => {
  const service = fixture(t);
  const value = manual({ messages: [{ id: 'message_old', role: 'user', content: 'Synthetic old source' }],
    sync: { conversationId: 'legacy_conversation', branchId: 'active', snapshotId: 'legacy_snapshot', mode: 'snapshot', complete: false } });
  const receipt = service.chatgpt.capture(value), note = service.store.read(receipt.noteId);
  const state = service.store.records('chatgptSyncSessions')[0];
  const oldOrigin = { platform: 'ChatGPT', url: value.conversationUrl, author: '', date: '', acquiredAt: state.savedAt,
    locator: '会话分支版本 1；累计 1 条消息' };
  const { dateBasis: _basis, ...oldMeta } = note.meta;
  service.store.update(note.id, { expectedHash: note.hash, meta: { ...oldMeta, ...oldOrigin, origins: [oldOrigin] } });
  const oldNote = service.store.read(note.id);
  delete state.sourceMetadataVersion; delete state.noteHash; delete state.receipt;
  state.pending = true;
  service.store.put('chatgptSyncSessions', state.key, state);
  service.store.remove('chatgptCaptures', state.requestHash);
  const resumed = service.chatgpt.capture(value);
  assert.equal(resumed.verification.status, 'verified');
  assert.equal(service.store.read(note.id).hash, oldNote.hash);
  assert.equal(service.store.read(note.id).meta.locator, oldOrigin.locator);
});

test('manual metadata readback cannot report verified after a source-date edit', t => {
  const service = fixture(t), value = manual({ conversationDate: '2024-02-29' });
  const receipt = service.chatgpt.capture(value), note = service.store.read(receipt.noteId);
  service.store.update(note.id, { expectedHash: note.hash, meta: { ...note.meta, date: '2020-01-01' } });
  assert.equal(service.chatgpt.capture(value).verification.status, 'historical_receipt');
  assert.equal(service.store.read(note.id).meta.date, '2020-01-01');
});
