import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import { randomUUID } from 'node:crypto';
import { createService } from '../src/service.mjs';
import { hash } from '../src/store.mjs';
import { validateAttachments } from '../src/attachment-backup.mjs';
import { tinyPng } from './fixtures/source-files.mjs';

function fixture(t) {
  const parent = path.resolve(import.meta.dirname, '../.tmp');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'attachment-descriptors-'));
  const service = createService({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault') });
  t.after(async () => { await service.close(); assert.equal(path.dirname(root), parent); fs.rmSync(root, { recursive: true, force: true }); });
  return service;
}
const upload = (service, name) => service.uploadFile({ name, bytes: tinyPng, mime: '', uploadId: randomUUID() });
async function sourceBackup(t) {
  const source = fixture(t), first = upload(source, '原图.png'), { note } = await source.commitFile({ uploadId: first.id });
  const other = source.importItems({ items: [{ title: '同内容的另一资料', body: '保留手写内容。' }] }).notes[0];
  const second = upload(source, '另一个合法名称.PNG');
  source.editNote(other.id, { expectedHash: other.hash, attachmentUploadIds: [second.id] });
  return { backup: source.backup(), note, other, asset: first.attachment };
}
function rewrite(row, mutate) {
  const match = row.raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/), meta = YAML.parse(match[1]);
  mutate(meta);
  row.raw = '---\n' + YAML.stringify(meta) + '---\n' + row.raw.slice(match[0].length);
  if ('hash' in row) row.hash = hash(row.raw);
}

for (const [location, field, value] of [['note', 'name', 'broken.jpg'], ['note', 'kind', 'pdf'], ['history', 'format', 'jpg'], ['history', 'kind', 'word']]) {
  test(`restore rejects every ${location} reference with inconsistent ${field} before writing anything`, async t => {
    const { backup, note } = await sourceBackup(t), target = fixture(t);
    const kept = target.importItems({ items: [{ title: '保留的当前资料', body: '恢复失败不能改写这份正文。' }] }).notes[0];
    const before = fs.readFileSync(path.join(target.store.vaultDir, kept.path));
    const row = location === 'note' ? backup.notes.find(row => row.id === note.id) : backup.versions.find(row => row.noteId === note.id);
    assert.ok(row);
    rewrite(row, meta => { meta.sourceFile[field] = value; });
    assert.throws(() => target.restore({ backup }), /附件|文件/);
    assert.deepEqual(fs.readFileSync(path.join(target.store.vaultDir, kept.path)), before);
    assert.equal(target.store.list().length, 1);
    assert.equal(target.store.records('restore').length, 0);
    assert.equal(fs.existsSync(path.join(target.store.vaultDir, '.zhixu-attachments')), false);
    assert.equal(fs.existsSync(path.join(target.store.dataDir, 'backups')), false);
  });
}

test('a false package descriptor is rejected even when its bytes and every Markdown reference are valid', async t => {
  const { backup } = await sourceBackup(t), target = fixture(t);
  backup.attachments[0].kind = 'pdf';
  assert.throws(() => target.restore({ backup }), /附件|文件/);
  assert.equal(target.store.list().length, 0);
  assert.equal(fs.existsSync(path.join(target.store.vaultDir, '.zhixu-attachments')), false);
});

test('different valid names share one decoded content and remain readable through notes and history after restore', async t => {
  const { backup, note, other, asset } = await sourceBackup(t), target = fixture(t);
  assert.equal(backup.attachments.length, 1);
  const from = Buffer.from;
  let decodes = 0;
  const mocked = t.mock.method(Buffer, 'from', function (value, encoding, ...args) {
    if (encoding === 'base64' && value === backup.attachments[0].base64) decodes++;
    return from.call(Buffer, value, encoding, ...args);
  });
  try { assert.equal(validateAttachments(target.store.vaultDir, backup).length, 1); }
  finally { mocked.mock.restore(); }
  assert.equal(decodes, 1, 'duplicate descriptors must reuse the decoded original');
  const preview = target.restore({ backup });
  target.restore({ backup, preview: false, token: preview.token });
  for (const id of [note.id, other.id]) assert.deepEqual(target.readFile(id, asset.id).bytes, tinyPng);
  assert.ok(target.store.history(note.id).length > 0);
  assert.equal(target.backup().attachments.length, 1);
});
