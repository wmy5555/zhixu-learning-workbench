import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import YAML from 'yaml';
import { createService } from '../src/service.mjs';
import { createApp } from '../src/server.mjs';
import { decodeFile, extractWord, MAX_FILE_BYTES, MAX_ATTACHMENT_STORAGE_FILES, processingText, writeAttachment, readAttachment } from '../src/attachments.mjs';
import { MAX_UPLOAD_RECEIPTS } from '../src/source-files.mjs';
import { installAttachments } from '../src/attachment-backup.mjs';
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

async function attachmentHttpHarness(t) {
  const temporaryRoot = path.resolve(import.meta.dirname, '..', '.tmp');
  const root = fs.mkdtempSync(path.join(temporaryRoot, 'source-files-http-'));
  assert.equal(path.dirname(root), temporaryRoot);
  const app = createApp({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'), scheduler: false });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(async () => { await app.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const session = await fetch(base + '/api/session');
  const headers = { Cookie: session.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': (await session.json()).csrf };
  return { ...app, base, headers };
}

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

test('published Word fixtures preserve actual format coverage and survive multi-file backup restore', async t => {
  const h = await harness(t), samples = path.resolve(import.meta.dirname, '../node_modules/mammoth/test/test-data');
  const cases = [
    ['tables.docx', /Top left[\s\S]*Bottom right/, 'partial'],
    ['simple-list.docx', /Apple[\s\S]*Banana/, 'partial'],
    ['text-box.docx', /Datum plane/, 'partial'],
    ['strict-format.docx', /Test/, 'partial'],
    ['footnotes.docx', /^Ouch\.\s*$/, 'partial'],
    ['endnotes.docx', /^Ouch\.\s*$/, 'partial'],
    ['comments.docx', /^Ouch\.\s*$/, 'partial'],
    ['tiny-picture.docx', /^$/, 'empty'],
  ];
  const imported = [];
  for (const [name, expected, status] of cases) {
    const bytes = fs.readFileSync(path.join(samples, name)), uploaded = upload(h.service, name, bytes);
    await h.reopen();
    assert.ok(h.service.pendingUploads().some(item => item.id === uploaded.id));
    const { note } = await h.service.commitFile({ uploadId: uploaded.id });
    assert.equal(note.meta.textExtraction.status, status);
    assert.match(note.meta.textExtraction.text, expected);
    if (status === 'partial') assert.match(note.meta.textExtraction.warnings.join(''), /脚注、尾注、批注/);
    else assert.throws(() => h.service.processNote(note.id), { code: 'SOURCE_FILE_ONLY' });
    imported.push({ note, bytes, uploaded });
  }
  const backup = h.service.backup(), other = await harness(t);
  assert.equal(backup.version, 2);
  assert.equal(backup.attachments.length, cases.length);
  const preview = other.service.restore({ backup });
  other.service.restore({ backup, preview: false, token: preview.token });
  await other.reopen();
  for (const { note, bytes, uploaded } of imported) {
    assert.deepEqual(other.service.readFile(note.id, uploaded.attachment.id).bytes, bytes);
    assert.deepEqual(other.service.getNote(note.id).meta.textExtraction, note.meta.textExtraction);
  }
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

test('attachment HTTP boundaries reject foreign origins, unbound reads and unrelated-note downloads', async t => {
  const h = await attachmentHttpHarness(t);
  const endpoint = '/api/uploads?name=' + encodeURIComponent('公开原件.pdf') + '&uploadId=' + randomUUID();
  const denied = await fetch(h.base + endpoint, { method: 'POST', body: tinyPdf, headers: { ...h.headers, Origin: 'https://attacker.invalid', 'Content-Type': 'application/pdf' } });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, 'ORIGIN_DENIED');
  assert.equal(h.service.pendingUploads().length, 0);

  const response = await fetch(h.base + endpoint, { method: 'POST', body: tinyPdf, headers: { ...h.headers, 'Content-Type': 'application/pdf' } });
  assert.equal(response.status, 200);
  const receipt = await response.json();
  const route = id => h.base + '/api/notes/' + id + '/attachments?asset=' + receipt.attachment.id + '&download=1';
  assert.equal((await fetch(route(receipt.noteId), { headers: h.headers })).status, 404);
  const { note } = await h.service.commitFile({ uploadId: receipt.id });
  const unrelated = h.service.importItems({ items: [{ title: '另一份合成资料', body: '没有绑定附件。' }] }).notes[0];
  assert.equal((await fetch(route(unrelated.id), { headers: h.headers })).status, 404);
  assert.equal((await fetch(route(note.id))).status, 401);
  assert.equal((await fetch(route(note.id), { headers: { ...h.headers, Origin: 'https://attacker.invalid' } })).status, 403);
  const download = await fetch(route(note.id), { headers: h.headers });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/pdf');
  assert.equal(download.headers.get('content-length'), String(tinyPdf.length));
  assert.equal(download.headers.get('cache-control'), 'no-store');
  assert.match(download.headers.get('content-disposition'), /^attachment;/);
  assert.ok(download.headers.get('content-disposition').includes(encodeURIComponent('公开原件.pdf')));
  assert.match(download.headers.get('content-security-policy'), /sandbox/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), tinyPdf);
  assert.equal(h.service.store.records('jobs').length, 0);
});

test('attachment HTTP boundaries isolate practice receipts, pending lists and bound originals', async t => {
  const h = await attachmentHttpHarness(t), practice = h.onboarding.start();
  const prefix = '/api/practice/' + practice.practiceId;
  const lease = h.onboarding.acquire(practice.practiceId, { resource: 'uploads', method: 'GET' });
  try {
    const mainFile = upload(h.service, '正式合成.png', tinyPng);
    const practiceFile = upload(lease.service, '练习合成.pdf', tinyPdf);
    const mainPending = await (await fetch(h.base + '/api/uploads', { headers: h.headers })).json();
    const practicePending = await (await fetch(h.base + prefix + '/uploads', { headers: h.headers })).json();
    assert.deepEqual(mainPending.uploads.map(file => file.id), [mainFile.id]);
    assert.deepEqual(practicePending.uploads.map(file => file.id), [practiceFile.id]);
    await assert.rejects(h.service.commitFile({ uploadId: practiceFile.id }), { code: 'UPLOAD_MISSING' });
    await assert.rejects(lease.service.commitFile({ uploadId: mainFile.id }), { code: 'UPLOAD_MISSING' });
    const main = await h.service.commitFile({ uploadId: mainFile.id });
    const training = await lease.service.commitFile({ uploadId: practiceFile.id });
    const route = (scope, note, file) => h.base + scope + '/notes/' + note.id + '/attachments?asset=' + file.attachment.id + '&download=1';
    assert.equal((await fetch(route('/api', training.note, practiceFile), { headers: h.headers })).status, 404);
    assert.equal((await fetch(route(prefix, main.note, mainFile), { headers: h.headers })).status, 404);
    const ownPractice = await fetch(route(prefix, training.note, practiceFile), { headers: h.headers });
    assert.equal(ownPractice.status, 200);
    assert.deepEqual(Buffer.from(await ownPractice.arrayBuffer()), tinyPdf);
    const blockedWrite = await fetch(h.base + prefix + '/uploads?name=blocked.png&uploadId=' + randomUUID(), { method: 'POST', body: tinyPng, headers: { ...h.headers, 'Content-Type': 'image/png' } });
    assert.equal(blockedWrite.status, 409);
    assert.equal((await blockedWrite.json()).code, 'MODEL_TEST_REQUIRED');
    assert.equal(h.service.store.records('jobs').length, 0);
    assert.equal(lease.service.store.records('jobs').length, 0);
  } finally { lease.release(); }
});

test('attachment reads reject same-size byte tampering and retain the saved note', async t => {
  const h = await harness(t), file = upload(h.service, '完整性.png', tinyPng);
  const { note } = await h.service.commitFile({ uploadId: file.id });
  const target = path.join(h.options.vaultDir, '.zhixu-attachments', file.attachment.id);
  const changed = Buffer.from(tinyPng); changed[changed.length - 1] ^= 1;
  fs.writeFileSync(target, changed);
  assert.throws(() => h.service.readFile(note.id, file.attachment.id), { code: 'ATTACHMENT_CHANGED' });
  assert.throws(() => h.service.backup(), { code: 'ATTACHMENT_CHANGED' });
  assert.equal(h.service.getNote(note.id).hash, note.hash);
  assert.deepEqual(fs.readFileSync(target), changed);
  fs.writeFileSync(target, tinyPng);
  assert.deepEqual(h.service.readFile(note.id, file.attachment.id).bytes, tinyPng);
  assert.equal(h.service.backup().version, 2);
});

test('attachment storage rejects new bytes at the byte limit and retains existing originals', async t => {
  const h = await harness(t), files = [0, 1, 2].map(index => {
    const bytes = Buffer.from(tinyPng); bytes[bytes.length - 1] ^= index;
    return decodeFile({ name: '容量.png', bytes });
  });
  const limits = { maxBytes: tinyPng.length * 2, maxFiles: 10 };
  writeAttachment(h.options.vaultDir, files[0], limits);
  writeAttachment(h.options.vaultDir, files[1], limits);
  assert.throws(() => writeAttachment(h.options.vaultDir, files[2], limits), { code: 'ATTACHMENT_STORAGE_LIMIT' });
  assert.equal(fs.readdirSync(path.join(h.options.vaultDir, '.zhixu-attachments')).length, 2);
  // A full or externally over-capacity directory must not prevent byte reuse.
  writeAttachment(h.options.vaultDir, files[0], { maxBytes: 1, maxFiles: 1 });
  assert.deepEqual(readAttachment(h.options.vaultDir, files[0].descriptor).bytes, tinyPng);
});

test('attachment storage counts revoked and orphaned files and preflights restore before any writes', async t => {
  const h = await harness(t), original = upload(h.service, '原件.png', tinyPng);
  const { note } = await h.service.commitFile({ uploadId: original.id });
  const directory = path.join(h.options.vaultDir, '.zhixu-attachments');
  for (let index = 0; index < MAX_ATTACHMENT_STORAGE_FILES - 2; index++) fs.writeFileSync(path.join(directory, 'retained-' + index + '.tmp'), 'x');
  const b = Buffer.from(tinyPng); b[b.length - 1] ^= 1;
  const c = Buffer.from(tinyPng); c[c.length - 1] ^= 2;
  const revoked = upload(h.service, '撤销.png', b);
  h.service.revertUpload(revoked.id);
  assert.equal(h.service.pendingUploads().length, 0);
  await h.reopen();
  assert.throws(() => upload(h.service, '不能新增.png', c), { code: 'ATTACHMENT_STORAGE_LIMIT' });
  assert.deepEqual(h.service.readFile(note.id, original.attachment.id).bytes, tinyPng);
  assert.ok(fs.existsSync(path.join(directory, revoked.attachment.id)));
  const duplicate = upload(h.service, '重用原件.png', tinyPng);
  assert.equal((await h.service.commitFile({ uploadId: duplicate.id })).note.id, note.id);

  // A batch needing two new files is rejected before even the first is installed.
  const other = await harness(t), destination = path.join(other.options.vaultDir, '.zhixu-attachments');
  fs.mkdirSync(destination, { recursive: true });
  for (let index = 0; index < MAX_ATTACHMENT_STORAGE_FILES - 1; index++) fs.writeFileSync(path.join(destination, 'retained-' + index + '.tmp'), 'x');
  const files = [b, c].map(bytes => decodeFile({ name: '恢复.png', bytes }));
  assert.throws(() => installAttachments(other.options.vaultDir, files), { code: 'ATTACHMENT_STORAGE_LIMIT' });
  assert.ok(files.every(file => !fs.existsSync(path.join(destination, file.descriptor.id))));
  const reuse = upload(h.service, '保留的撤销原件.png', b);
  await h.service.commitFile({ uploadId: reuse.id });
  assert.throws(() => other.service.restore({ backup: h.service.backup() }), { code: 'ATTACHMENT_STORAGE_LIMIT' });
  assert.equal(other.service.store.list().length, 0);
  assert.equal(fs.readdirSync(destination).length, MAX_ATTACHMENT_STORAGE_FILES - 1);
});

test('upload receipt total remains bounded after revocation while an existing pending upload can finish', async t => {
  const h = await harness(t), existing = upload(h.service, '已有.png', tinyPng);
  h.service.store.db.exec('BEGIN');
  try {
    for (let index = 1; index < MAX_UPLOAD_RECEIPTS; index++) h.service.store.put('attachmentUploads', randomUUID(), { state: 'reverted' });
    h.service.store.db.exec('COMMIT');
  } catch (error) { h.service.store.db.exec('ROLLBACK'); throw error; }
  await h.reopen();
  assert.throws(() => upload(h.service, '新回执.png', tinyPng), { code: 'UPLOAD_HISTORY_LIMIT' });
  assert.equal(h.service.store.records('attachmentUploads').length, MAX_UPLOAD_RECEIPTS);
  const { note } = await h.service.commitFile({ uploadId: existing.id });
  assert.equal(upload(h.service, '已有.png', tinyPng, { uploadId: existing.id }).state, 'bound');
  assert.deepEqual(h.service.readFile(note.id, existing.attachment.id).bytes, tinyPng);
});

test('oversize attachment backup is rejected from stat totals before any original is read or encoded', async t => {
  const h = await harness(t), bytes = Buffer.alloc(8 * 1024 * 1024, 32), paths = new Set();
  bytes.write('%PDF-1.4\n'); bytes.write('%%EOF\n', bytes.length - 6);
  for (let index = 0; index < 8; index++) {
    bytes[32] = index;
    const file = upload(h.service, '合成容量.pdf', bytes);
    await h.service.commitFile({ uploadId: file.id });
    paths.add(path.join(h.options.vaultDir, '.zhixu-attachments', file.attachment.id));
  }
  const originalRead = fs.readFileSync;
  let reads = 0;
  const mocked = t.mock.method(fs, 'readFileSync', (target, ...args) => {
    if (paths.has(String(target))) { reads++; throw new Error('Attachment read before capacity rejection'); }
    return originalRead(target, ...args);
  });
  try {
    assert.throws(() => h.service.backup(), { code: 'ATTACHMENT_BACKUP' });
    assert.equal(reads, 0);
    assert.ok([...paths].every(file => fs.statSync(file).size === bytes.length));
  } finally { mocked.mock.restore(); }
});
