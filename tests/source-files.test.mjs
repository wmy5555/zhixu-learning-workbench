import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import YAML from 'yaml';
import { createService } from '../src/service.mjs';
import { createApp } from '../src/server.mjs';
import { decodeFile, extractWord, MAX_FILE_BYTES, processingText } from '../src/attachments.mjs';
import { tinyPng, tinyPdf, legacyDoc, docx } from './fixtures/source-files.mjs';

fs.mkdirSync(new URL('../.tmp/', import.meta.url), { recursive: true });
async function harness(t) {
  const root = fs.mkdtempSync(path.join(import.meta.dirname, '..', '.tmp', 'source-files-'));
  const options = { dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault') };
  let service = createService(options);
  t.after(async () => { await service.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { get service() { return service; }, root, options,
    async reopen() { await service.close(); service = createService(options); return service; } };
}
const upload = (service, name, bytes, extra = {}) => service.uploadFile({ name, bytes, mime: '', uploadId: randomUUID(), ...extra });

test('binary sources persist exactly, deduplicate by bytes regardless of name, and survive reload', async t => {
  const h = await harness(t), a = upload(h.service, '合成.png', tinyPng);
  const first = await h.service.commitFile({ uploadId: a.id });
  assert.equal(first.note.kind, 'source');
  assert.equal(first.note.meta.privacy, 'local');
  assert.deepEqual(h.service.readFile(first.note.id, a.attachment.id).bytes, tinyPng);
  assert.equal((await h.service.commitFile({ uploadId: a.id })).note.id, first.note.id);
  const duplicate = upload(h.service, '另一名称.png', tinyPng);
  assert.equal((await h.service.commitFile({ uploadId: duplicate.id, privacy: 'cloud' })).note.id, first.note.id);
  assert.equal(h.service.getNote(first.note.id).meta.privacy, 'local');
  const pdf = upload(h.service, '合成.png.pdf', tinyPdf);
  const second = await h.service.commitFile({ uploadId: pdf.id });
  assert.notEqual(second.note.id, first.note.id);
  await h.reopen();
  assert.deepEqual(h.service.readFile(first.note.id, a.attachment.id).bytes, tinyPng);
  assert.equal(h.service.store.list().length, 2);
  const cancelledDuplicate = upload(h.service, '取消重复.png', tinyPng);
  assert.equal(h.service.revertUpload(cancelledDuplicate.id).reverted, true);
  assert.ok(!h.service.pendingUploads().some(item => item.id === cancelledDuplicate.id));
  assert.deepEqual(h.service.readFile(first.note.id, a.attachment.id).bytes, tinyPng);
});

test('image, PDF and legacy DOC cannot be processed, structured or promoted', async t => {
  const h = await harness(t);
  for (const [name, bytes] of [['a.png', tinyPng], ['b.pdf', tinyPdf], ['c.doc', legacyDoc]]) {
    const value = upload(h.service, name, bytes), { note } = await h.service.commitFile({ uploadId: value.id });
    assert.throws(() => h.service.processNote(note.id), { code: 'SOURCE_FILE_ONLY' });
    assert.throws(() => h.service.extractNote(note.id, { title: '测试', body: '描述' }), { code: 'SOURCE_FILE_ONLY' });
    assert.throws(() => h.service.requestSourceStructure(note.id), { code: 'SOURCE_FILE_ONLY' });
    assert.throws(() => h.service.promote(note.id, { stage: 'candidate' }));
    assert.equal(h.service.store.records('jobs').length, 0);
  }
});

test('DOCX text retains immutable original relation and explicit partial coverage', async t => {
  const h = await harness(t), file = upload(h.service, '中文.docx', await docx('合成原始正文'));
  const { note } = await h.service.commitFile({ uploadId: file.id });
  assert.match(note.meta.textExtraction.text, /合成原始正文/);
  assert.equal(note.meta.textExtraction.status, 'partial');
  assert.equal(note.meta.textExtraction.sourceSha256, file.attachment.sha256);
  assert.match(note.meta.textExtraction.warnings.join(''), /不代表完整/);
  const edit = h.service.editNote(note.id, { expectedHash: note.hash, body: '用户补充说明' });
  assert.match(edit.meta.textExtraction.text, /合成原始正文/);
  assert.throws(() => h.service.editNote(note.id, { expectedHash: edit.hash, meta: { textExtraction: {} } }));
  assert.equal(h.service.processNote(note.id).type, 'process');
  await h.reopen();
  assert.equal(h.service.getNote(note.id).meta.textExtraction.text, note.meta.textExtraction.text);
});

test('externally changed DOCX extraction is blocked before processing and preserved for recovery', async t => {
  const h = await harness(t), bytes = await docx('首次提取正文'), file = upload(h.service, '校验.docx', bytes);
  const { note } = await h.service.commitFile({ uploadId: file.id, privacy: 'cloud' });
  const target = path.join(h.options.vaultDir, note.path), original = fs.readFileSync(target, 'utf8');
  assert.equal(processingText(note), note.meta.textExtraction.text);
  for (const change of [extraction => { extraction.text = '外部改写文字'; }, extraction => { delete extraction.textSha256; }]) {
    const frontmatter = original.match(/^---\n([\s\S]*?)\n---\n/), meta = YAML.parse(frontmatter[1]);
    change(meta.textExtraction);
    const modified = '---\n' + YAML.stringify(meta) + '---\n' + original.slice(frontmatter[0].length);
    fs.writeFileSync(target, modified);
    await h.reopen();
    assert.throws(() => h.service.processNote(note.id), { code: 'EXTRACTION_CHANGED' });
    assert.throws(() => h.service.requestSourceStructure(note.id), { code: 'EXTRACTION_CHANGED' });
    assert.throws(() => h.service.extractNote(note.id, { title: '标题', body: '正文' }), { code: 'EXTRACTION_CHANGED' });
    assert.throws(() => processingText(h.service.getNote(note.id)), { code: 'EXTRACTION_CHANGED' });
    assert.equal(h.service.store.records('jobs').length, 0);
    assert.equal(fs.readFileSync(target, 'utf8'), modified);
    assert.deepEqual(h.service.readFile(note.id, file.attachment.id).bytes, bytes);
  }
  fs.writeFileSync(target, original);
  assert.equal(processingText(h.service.getNote(note.id)), note.meta.textExtraction.text);
  assert.equal(h.service.processNote(note.id).type, 'process');
});

test('empty, corrupt, macro, encrypted and zipbomb DOCX retain files with AI blocked', async t => {
  const h = await harness(t);
  const corrupt = Buffer.from('504b0304000000000000', 'hex');
  const encrypted = await docx('保留'); const central = encrypted.indexOf(Buffer.from('504b0102', 'hex')); encrypted.writeUInt16LE(encrypted.readUInt16LE(central + 8) | 1, central + 8);
  for (const bytes of [await docx(''), corrupt, await docx('宏', { extra: { 'word/vbaProject.bin': 'not-executed' } }), encrypted, await docx('炸弹', { bomb: true })]) {
    const value = upload(h.service, randomUUID() + '.docx', bytes), { note } = await h.service.commitFile({ uploadId: value.id });
    assert.ok(['empty', 'failed'].includes(note.meta.textExtraction.status));
    assert.equal(note.meta.textExtraction.text, '');
    assert.deepEqual(h.service.readFile(note.id, value.attachment.id).bytes, bytes);
    assert.throws(() => h.service.processNote(note.id), { code: 'SOURCE_FILE_ONLY' });
  }
});

test('converter terminates on timeout and subsequent conversion is usable', async () => {
  const file = decodeFile({ name: 'test.docx', bytes: await docx() });
  const timed = await extractWord(file, { timeoutMs: 1 });
  assert.equal(timed.status, 'failed');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal((await extractWord(file)).status, 'partial');
});

test('validation rejects traversal, disguised MIME, active formats, empty/large files and huge pixels', () => {
  const largeImage = Buffer.from(tinyPng); largeImage.writeUInt32BE(100000, 16);
  for (const input of [
    { name: '../a.png', bytes: tinyPng }, { name: 'a\\b.png', bytes: tinyPng },
    { name: 'x.png', bytes: tinyPng, mime: 'text/html' }, { name: 'x.jpg', bytes: tinyPng },
    { name: 'a.svg', bytes: Buffer.from('<svg onload="alert(1)"/>') }, { name: 'a.html', bytes: tinyPng },
    { name: 'a.pdf', bytes: Buffer.from('<html/>') }, { name: 'a.png', bytes: Buffer.alloc(0) },
    { name: 'a.png', bytes: Buffer.alloc(MAX_FILE_BYTES + 1) }, { name: 'a.png', bytes: largeImage },
  ]) assert.throws(() => decodeFile(input));
});

test('revert is idempotent and isolated; same upload identity cannot change bytes', async t => {
  const h = await harness(t), a = upload(h.service, 'a.png', tinyPng), b = upload(h.service, 'b.pdf', tinyPdf);
  assert.throws(() => upload(h.service, 'a.pdf', tinyPdf, { uploadId: a.id }), { code: 'UPLOAD_CONFLICT' });
  assert.equal(h.service.revertUpload(a.id).reverted, true);
  assert.equal(h.service.revertUpload(a.id).reverted, true);
  await assert.rejects(h.service.commitFile({ uploadId: a.id }), { code: 'UPLOAD_MISSING' });
  const { note } = await h.service.commitFile({ uploadId: b.id });
  assert.equal(h.service.revertUpload(b.id).retained, true);
  h.service.store.delete(note.id, note.hash);
  await assert.rejects(h.service.commitFile({ uploadId: b.id }), { code: 'SOURCE_REMOVED' });
});

test('inline attachment binding honors expectedHash, source-only and retained history', async t => {
  const h = await harness(t), source = h.service.importItems({ items: [{ title: '原文', body: '中文文字' }] }).notes[0];
  const image = upload(h.service, '图.png', tinyPng), markup = '![图](../.zhixu-attachments/' + image.attachment.id + ')';
  assert.throws(() => h.service.editNote(source.id, { body: markup, expectedHash: 'old', attachmentUploadIds: [image.id] }), { code: 'CONFLICT' });
  const saved = h.service.editNote(source.id, { body: source.body + '\n' + markup, expectedHash: source.hash, attachmentUploadIds: [image.id] });
  assert.equal(saved.meta.attachments[0].id, image.attachment.id);
  assert.equal(h.service.revertUpload(image.id).retained, true);
  const next = h.service.editNote(source.id, { body: '改后原文', expectedHash: saved.hash });
  const version = h.service.store.history(source.id).find(row => row.hash === saved.hash);
  h.service.store.restoreVersion(source.id, version.versionId, next.hash);
  assert.deepEqual(h.service.readFile(source.id, image.attachment.id).bytes, tinyPng);
  const knowledge = h.service.store.create({ title: '知识', body: '文字' });
  assert.throws(() => h.service.editNote(knowledge.id, { body: markup, expectedHash: knowledge.hash, attachmentUploadIds: [image.id] }), { code: 'SOURCE_FILE_ONLY' });
});

test('backup includes live/history attachments and restores into an empty vault; old backup remains supported', async t => {
  const h = await harness(t), oldBackup = h.service.backup();
  assert.equal(oldBackup.version, 1);
  const a = upload(h.service, '测试.png', tinyPng), { note } = await h.service.commitFile({ uploadId: a.id });
  h.service.store.delete(note.id, note.hash);
  const backup = h.service.backup();
  assert.equal(backup.version, 2); assert.equal(backup.attachments.length, 1);
  assert.ok(!backup.records.some(row => row.namespace === 'attachmentUploads'));
  const other = await harness(t), preview = other.service.restore({ backup });
  other.service.restore({ backup, preview: false, token: preview.token });
  const version = other.service.store.history(note.id)[0];
  other.service.store.restoreVersion(note.id, version.versionId);
  assert.deepEqual(other.service.readFile(note.id, a.attachment.id).bytes, tinyPng);
  assert.throws(() => other.service.store.validateBackup({ ...backup, attachments: [] }));
  const bad = structuredClone(backup); bad.attachments[0].base64 = tinyPdf.toString('base64');
  assert.throws(() => other.service.store.validateBackup(bad));
  assert.equal(other.service.store.validateBackup(oldBackup).notes, 0);
  assert.throws(() => other.service.store.validateBackup({ ...oldBackup, records: [{ namespace: 'attachmentUploads', key: randomUUID(), json: '{}' }] }));
});

test('pending uploads recover across restart and concurrent cancellation cannot create a source', async t => {
  const h = await harness(t), pending = upload(h.service, '待保存.docx', await docx('取消中的原文'));
  await h.reopen();
  assert.equal(h.service.pendingUploads()[0].id, pending.id);
  const saving = h.service.commitFile({ uploadId: pending.id });
  h.service.revertUpload(pending.id);
  await assert.rejects(saving, { code: 'UPLOAD_MISSING' });
  assert.equal(h.service.store.list().length, 0);
  assert.equal(h.service.pendingUploads().length, 0);
});

test('Word extraction keeps customXml text, marks limited revision coverage and ignores external image targets', async () => {
  const file = decodeFile({ name: '边界.docx', bytes: await docx('正文', {
    rawXml: '<w:customXml><w:p><w:r><w:t>自定义包装文字</w:t></w:r></w:p></w:customXml><w:ins><w:p><w:r><w:t>修订插入</w:t></w:r></w:p></w:ins>',
    extra: { 'word/_rels/document.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="file:///never-read-synthetic.png" TargetMode="External"/></Relationships>' },
  }) });
  const result = await extractWord(file);
  assert.match(result.text, /正文/);
  assert.match(result.text, /自定义包装文字/);
  assert.equal(result.status, 'partial');
  assert.match(result.warnings.join(''), /修订/);
});

test('HTTP upload and preview enforce session, CSRF, isolation, and safe response headers', async t => {
  const h = await harness(t), app = createApp({ ...h.options, scheduler: false, service: h.service });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(() => new Promise(resolve => app.server.close(resolve)));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const session = await fetch(base + '/api/session'), cookie = session.headers.get('set-cookie').split(';')[0], { csrf } = await session.json();
  const endpoint = '/api/uploads?name=test.png&uploadId=' + randomUUID();
  assert.equal((await fetch(base + endpoint, { method: 'POST', body: tinyPng })).status, 401);
  assert.equal((await fetch(base + endpoint, { method: 'POST', body: tinyPng, headers: { Cookie: cookie } })).status, 403);
  const response = await fetch(base + endpoint, { method: 'POST', body: tinyPng, headers: { Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'image/png' } });
  assert.equal(response.status, 200);
  const uploaded = await response.json(), { note } = await h.service.commitFile({ uploadId: uploaded.id });
  const url = base + '/api/notes/' + note.id + '/attachments?asset=' + uploaded.attachment.id;
  assert.equal((await fetch(url)).status, 401);
  const preview = await fetch(url, { headers: { Cookie: cookie } });
  assert.equal(preview.headers.get('content-type'), 'image/png');
  assert.equal(preview.headers.get('x-content-type-options'), 'nosniff');
  assert.match(preview.headers.get('content-security-policy'), /sandbox/);
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()), tinyPng);
  assert.equal((await fetch(base + '/vendor/filepond.esm.js')).status, 200);
  assert.equal((await fetch(base + '/vendor/package.json')).status, 404);
});
