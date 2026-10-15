import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { createApp } from '../src/server.mjs';
import { createService } from '../src/service.mjs';
import { MAX_FILE_BYTES, decodeFile } from '../src/attachments.mjs';
import { MAX_BACKUP_BYTES, MAX_RESTORE_REQUEST_BYTES } from '../src/attachment-backup.mjs';
import { tinyPdf, docx } from './fixtures/source-files.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const temporaryRoot = path.resolve(import.meta.dirname, '..', '.tmp');
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(temporaryRoot, 'source-file-limits-'));
  assert.equal(path.dirname(root), temporaryRoot);
  const options = { dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'), scheduler: false };
  const app = createApp(options);
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await app.close(); } };
  t.after(async () => { await close(); fs.rmSync(root, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const response = await fetch(base + '/api/session');
  const headers = { Cookie: response.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': (await response.json()).csrf };
  const json = async (route, body) => fetch(base + route, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { ...app, options, root, base, headers, json, close };
}
const uploadRoute = (h, name) => h.base + '/api/uploads?name=' + encodeURIComponent(name) + '&uploadId=' + randomUUID();

test('50 MB boundary survives HTTP upload, original preview and large-base64 backup restore', async t => {
  assert.equal(MAX_FILE_BYTES, 50_000_000);
  assert.equal(MAX_BACKUP_BYTES, 100_000_000);
  assert.equal(MAX_RESTORE_REQUEST_BYTES, MAX_BACKUP_BYTES + 65_536);
  const h = await fixture(t), destination = await fixture(t);
  let bytes = Buffer.alloc(MAX_FILE_BYTES, 32);
  tinyPdf.copy(bytes); bytes.write('%%EOF\n', bytes.length - 6);
  const expectedHash = sha(bytes);
  assert.equal(decodeFile({ name: '边界.pdf', bytes: bytes.subarray(0, -1) }).bytes.length, MAX_FILE_BYTES - 1);
  const uploaded = await fetch(uploadRoute(h, '中文 50 MB.pdf'), { method: 'POST', headers: { ...h.headers, 'Content-Type': 'application/pdf' }, body: bytes });
  assert.equal(uploaded.status, 200);
  const receipt = await uploaded.json();
  assert.equal(receipt.attachment.size, MAX_FILE_BYTES);
  const committed = await h.json('/api/file-import', { uploadId: receipt.id });
  assert.equal(committed.status, 200);
  const { note } = await committed.json();
  const originalRoute = h.base + '/api/notes/' + note.id + '/attachments?asset=' + receipt.attachment.id;
  const preview = await fetch(originalRoute, { headers: h.headers });
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('content-length'), String(MAX_FILE_BYTES));
  assert.match(preview.headers.get('content-disposition'), /^inline;/);
  assert.match(preview.headers.get('content-security-policy'), /sandbox/);
  assert.equal(sha(Buffer.from(await preview.arrayBuffer())), expectedHash);
  const download = await fetch(originalRoute + '&download=1', { headers: h.headers });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-length'), String(MAX_FILE_BYTES));
  assert.match(download.headers.get('content-disposition'), /^attachment;/);
  assert.equal(sha(Buffer.from(await download.arrayBuffer())), expectedHash);

  const directory = path.join(h.options.vaultDir, '.zhixu-attachments');
  const before = fs.readdirSync(directory);
  const oversized = Buffer.concat([bytes, Buffer.from('\n')]);
  const rejected = await fetch(uploadRoute(h, '超出一字节.pdf'), { method: 'POST', headers: { ...h.headers, 'Content-Type': 'application/pdf' }, body: oversized });
  assert.equal(rejected.status, 413);
  assert.equal((await rejected.json()).code, 'TOO_LARGE');
  assert.throws(() => decodeFile({ name: '超限.pdf', base64: oversized.toString('base64') }), { code: 'TOO_LARGE' });
  assert.deepEqual(fs.readdirSync(directory), before);
  assert.equal(h.service.store.records('attachmentUploads').length, 1);

  // A real temporary-file write followed by a failed atomic install must clean up.
  bytes[64] ^= 1;
  const link = t.mock.method(fs, 'linkSync', () => { throw Object.assign(new Error('synthetic disk install failure'), { code: 'ENOSPC' }); });
  try { assert.throws(() => h.service.uploadFile({ name: '安装失败.pdf', mime: '', bytes, uploadId: randomUUID() }), { code: 'ENOSPC' }); }
  finally { link.mock.restore(); }
  assert.deepEqual(fs.readdirSync(directory), before);
  assert.equal(h.service.store.records('attachmentUploads').length, 1);
  bytes = null;

  const exported = await fetch(h.base + '/api/backup', { headers: h.headers });
  assert.equal(exported.status, 200);
  const backup = await exported.json();
  assert.equal(backup.version, 2);
  assert.equal(backup.attachments[0].size, MAX_FILE_BYTES);
  assert.equal(backup.attachments[0].base64.length, 4 * Math.ceil(MAX_FILE_BYTES / 3));
  assert.ok(Buffer.byteLength(JSON.stringify(backup)) < MAX_BACKUP_BYTES);
  const encoded = backup.attachments[0].base64;
  backup.attachments[0].base64 = oversized.toString('base64');
  const rejectedRestore = await destination.json('/api/restore', { backup });
  assert.equal(rejectedRestore.status, 413);
  assert.equal((await rejectedRestore.json()).code, 'TOO_LARGE');
  assert.equal(destination.service.store.list().length, 0);
  assert.ok(!fs.existsSync(path.join(destination.options.vaultDir, '.zhixu-attachments')));
  backup.attachments[0].base64 = encoded;
  const restoredPreview = await destination.json('/api/restore', { backup });
  assert.equal(restoredPreview.status, 200);
  const restore = await restoredPreview.json();
  const restored = await destination.json('/api/restore', { backup, preview: false, token: restore.token });
  assert.equal(restored.status, 200);
  await restored.json();
  assert.equal(sha(destination.service.readFile(note.id, receipt.attachment.id).bytes), expectedHash);
  assert.equal(fs.statSync(path.join(destination.options.vaultDir, '.zhixu-attachments', receipt.attachment.id)).size, MAX_FILE_BYTES);
  assert.equal(destination.service.store.records('jobs').length, 0);
  await destination.close();
  const reopened = createService(destination.options);
  try { assert.equal(sha(reopened.readFile(note.id, receipt.attachment.id).bytes), expectedHash); }
  finally { await reopened.close(); }
});

test('aborted binary upload leaves no original, temporary file or receipt', async t => {
  const h = await fixture(t);
  const aborted = new Promise(resolve => h.server.once('request', incoming => {
    incoming.once('aborted', resolve);
    incoming.once('data', () => client.destroy());
  }));
  const client = http.request(uploadRoute(h, '中断.pdf'), { method: 'POST', headers: { ...h.headers, 'Content-Type': 'application/pdf', 'Content-Length': MAX_FILE_BYTES } });
  client.on('error', () => {});
  client.write(tinyPdf);
  await aborted;
  assert.equal(h.service.pendingUploads().length, 0);
  assert.equal(h.service.store.records('attachmentUploads').length, 0);
  assert.ok(!fs.existsSync(path.join(h.options.vaultDir, '.zhixu-attachments')));
});

test('DOCX over the former byte limit converts within unchanged ZIP limits and retains rejected originals', async t => {
  const h = await fixture(t);
  const safe = await docx('较大DOCX仍提取正文', { compression: 'STORE', extra: { 'word/media/a.bin': Buffer.alloc(6 * 1024 * 1024), 'word/media/b.bin': Buffer.alloc(6 * 1024 * 1024) } });
  assert.ok(safe.length > 10 * 1024 * 1024 && safe.length < MAX_FILE_BYTES);
  const good = h.service.uploadFile({ name: '大原件.docx', mime: '', bytes: safe, uploadId: randomUUID() });
  const { note } = await h.service.commitFile({ uploadId: good.id });
  assert.equal(note.meta.textExtraction.status, 'partial');
  assert.match(note.meta.textExtraction.text, /较大DOCX仍提取正文/);
  assert.equal(sha(h.service.readFile(note.id, good.attachment.id).bytes), sha(safe));
  const unsafe = await docx('不能放宽解析上限', { compression: 'STORE', extra: { 'word/oversize.bin': Buffer.alloc(11 * 1024 * 1024) } });
  const bad = h.service.uploadFile({ name: '解压单项超限.docx', mime: '', bytes: unsafe, uploadId: randomUUID() });
  const failed = (await h.service.commitFile({ uploadId: bad.id })).note;
  assert.equal(failed.meta.textExtraction.status, 'failed');
  assert.throws(() => h.service.processNote(failed.id), { code: 'SOURCE_FILE_ONLY' });
  assert.equal(sha(h.service.readFile(failed.id, bad.attachment.id).bytes), sha(unsafe));
  assert.equal(h.service.store.records('jobs').length, 0);
});
