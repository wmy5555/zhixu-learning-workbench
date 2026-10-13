import test from 'node:test';
import assert from 'node:assert/strict';
import { createIOSClient, sourceInput, iosCapabilities } from '../apps/ios/web/ios-client.mjs';
import { createPreviewPlugin } from '../scripts/fixtures/ios-preview-native.mjs';

const input = () => ({ title: '', body: '  原始正文\n\n保留空白与 🧠。\n', meta: { date: '2024年春', locator: '第 1 段' } });
test('iOS capture preserves exact source and textual dates; unsupported cloud/AI fields reject', () => {
  const result = sourceInput(input());
  assert.equal(result.body, input().body); assert.equal(result.meta.date, '2024年春');
  assert.equal(result.meta.author, ''); assert.ok(result.title);
  for (const unsupported of [{ ...input(), privacy: 'cloud' }, { ...input(), process: true }, { ...input(), meta: { credentials: 'synthetic' } }, { ...input(), meta: { url: 'https://user:pass@example.com/' } }, { ...input(), meta: { author: '署名\n另一行' } }, { ...input(), title: '🧠'.repeat(101) }, { ...input(), body: '\ud800' }, { ...input(), body: 'x'.repeat(128 * 1024 + 1) }]) assert.throws(() => sourceInput(unsupported), { code: 'VALIDATION' });
  const emoji = sourceInput({ title: '', body: '🧠'.repeat(60) });
  assert.equal([...emoji.title].length, 36); assert.equal(emoji.title.endsWith('🧠'), true);
});
test('double capture calls share intent; successful new intent gets a new ID', async () => {
  const { plugin, controls } = createPreviewPlugin(), client = createIOSClient(plugin);
  const before = (await client.list()).notes.length;
  const [first, repeated] = await Promise.all([client.save(input()), client.save(input())]);
  assert.equal(first.note.id, repeated.note.id);
  assert.equal((await client.list()).notes.length, before + 1);
  await client.save(input());
  const calls = controls.calls.filter(value => Array.isArray(value));
  assert.equal(calls[0][1], calls[1][1]); assert.notEqual(calls[1][1], calls[2][1]);
});
test('unknown committed result retries the same request without duplicate source', async () => {
  const { plugin, controls } = createPreviewPlugin(), client = createIOSClient(plugin);
  const before = (await client.list()).notes.length;
  controls.dropNextSaveResponse = true;
  await assert.rejects(client.save(input()), { code: 'COMMIT_UNKNOWN' });
  assert.equal(client.pending(), 1);
  const saved = await client.save(input());
  assert.equal((await client.list()).notes.length, before + 1);
  assert.equal(saved.note.body, input().body); assert.equal(client.pending(), 0);
  const calls = controls.calls.filter(value => Array.isArray(value)); assert.equal(calls[0][1], calls[1][1]);
});
test('precommit failures keep exact intent and captured inputs; stale edits reject', async () => {
  const { plugin, controls } = createPreviewPlugin(), client = createIOSClient(plugin), request = input();
  controls.failNextSave = true;
  const operation = client.save(request); request.body = '不应进入已捕获的请求';
  await assert.rejects(operation, { code: 'STORE_ERROR' });
  const saved = await client.save(input()); assert.equal(saved.note.body, input().body);
  const edit = { ...input(), title: saved.note.title, id: saved.note.id, expectedHash: saved.note.hash, body: '新正文' };
  await client.save(edit);
  await assert.rejects(client.save({ ...edit, body: '旧页面请求' }), { code: 'CONFLICT' });
});
test('history restore and backup restore are version-bound and repeat idempotently after a lost response', async () => {
  const { plugin } = createPreviewPlugin(), client = createIOSClient(plugin);
  const current = (await client.list()).notes[0], old = (await client.history(current.id)).versions[0];
  const restored = await client.restoreVersion({ id: current.id, expectedHash: current.hash, versionId: old.hash });
  assert.equal(restored.note.body, old.body);
  assert.throws(() => client.restoreVersion({ id: current.id, expectedHash: current.hash, versionId: '../other' }), { code: 'VALIDATION' });
  const preview = await client.previewBackup();
  await client.save({ ...input(), body: '预览后新增合成资料' });
  await assert.rejects(client.restoreBackup(preview.token), { code: 'PREVIEW_EXPIRED' });
  const next = await client.previewBackup(), original = plugin.restoreBackup;
  let drop = true;
  plugin.restoreBackup = async value => { const result = await original(value); if (drop) { drop = false; throw Object.assign(new Error('合成恢复响应丢失'), { code: 'COMMIT_UNKNOWN' }); } return result; };
  await assert.rejects(client.restoreBackup(next.token), { code: 'COMMIT_UNKNOWN' });
  const result = await client.restoreBackup(next.token); assert.equal(result.imported, 1);
  assert.equal((await client.list()).notes.filter(note => note.id === '33333333-3333-4333-8333-333333333333').length, 1);
});
test('source exports validate the shared exchange grammar and bind the native version', async () => {
  const { plugin } = createPreviewPlugin(), client = createIOSClient(plugin), note = (await client.list()).notes[0];
  let exported = null;
  plugin.exportSource = async value => { exported = value; return { saved: true }; };
  await client.exportSource(note.id); assert.deepEqual(exported, { id: note.id, expectedHash: note.hash });
  plugin.read = async () => ({ note: { ...note, meta: { ...note.meta, url: 'file:///private' } } });
  exported = null;
  await assert.rejects(client.exportSource(note.id), { code: 'SOURCE_FILE_INVALID' }); assert.equal(exported, null);
});
test('unimplemented iOS capabilities are explicit and cannot be confused with native acceptance', () => {
  for (const key of ['learning', 'onboarding', 'ai', 'embedding', 'search', 'structure', 'sync']) assert.equal(iosCapabilities[key], false);
  assert.throws(() => createIOSClient({}), { code: 'VALIDATION' });
});
