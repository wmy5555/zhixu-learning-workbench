import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import YAML from 'yaml';
import { createService } from '../src/service.mjs';
import { createApp } from '../src/server.mjs';
import { tinyPng } from './fixtures/source-files.mjs';

async function harness(t) {
  const temporaryRoot = path.resolve(import.meta.dirname, '..', '.tmp');
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(temporaryRoot, 'attachment-read-'));
  assert.equal(path.dirname(root), temporaryRoot);
  const service = createService({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault') });
  t.after(async () => { await service.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const images = [0, 1, 2].map(index => {
    const bytes = Buffer.from(tinyPng); bytes[bytes.length - 1] ^= index;
    return { bytes, receipt: service.uploadFile({ name: `合成-${index}.png`, bytes, uploadId: randomUUID() }) };
  });
  const note = service.store.create({ kind: 'source', title: '多图合成原文', body: '合成正文', meta: { attachments: images.map(image => image.receipt.attachment) } });
  service.store.scan();
  const file = path.join(service.store.vaultDir, note.path), raw = fs.readFileSync(file, 'utf8');
  const rewrite = (change, target = file, text = raw) => {
    const match = text.match(/^---\n([\s\S]*?)\n---\n/), meta = YAML.parse(match[1]);
    change(meta);
    fs.writeFileSync(target, '---\n' + YAML.stringify(meta) + '---\n' + text.slice(match[0].length));
  };
  const read = () => service.readFile(note.id, images[0].receipt.attachment.id);
  return { service, root, note, images, file, raw, rewrite, read };
}

test('repeated attachment GETs read only the target Markdown and retain periodic full reconciliation', async t => {
  const h = await harness(t), store = h.service.store;
  for (let index = 0; index < 20; index++) store.create({ title: `其他合成资料-${index}`, body: '其他正文'.repeat(200) });
  store.scan();
  const app = createApp({ service: h.service, scheduler: false });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(() => new Promise(resolve => app.server.close(resolve)));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const session = await fetch(base + '/api/session'), headers = { Cookie: session.headers.get('set-cookie').split(';')[0] };
  const reads = [], original = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', function (file, ...args) {
    if (typeof file === 'string' && file.startsWith(store.vaultDir + path.sep) && file.endsWith('.md')) reads.push(file);
    return original.call(this, file, ...args);
  });
  const prefixReads = [], originalRead = fs.readSync;
  t.mock.method(fs, 'readSync', function (fd, bytes, offset, length, position) {
    prefixReads.push(length);
    return originalRead.call(this, fd, bytes, offset, length, position);
  });
  const request = async image => {
    const response = await fetch(`${base}/api/notes/${h.note.id}/attachments?asset=${image.receipt.attachment.id}`, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-security-policy'), /sandbox/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), image.bytes);
  };
  for (const image of h.images) await request(image);
  assert.equal(reads.length, 3, 'three images must not reread the other 20 note bodies');
  assert.ok(reads.every(file => file === h.file));
  assert.ok(prefixReads.length >= 63, 'current headers must also be checked for conflicting IDs');
  assert.ok(prefixReads.every(length => length <= 1024), 'header checks must not read the long synthetic bodies');
  t.diagnostic(`three warm GETs: ${reads.length} full Markdown reads; header reads stay within 1024 bytes for these fixtures`);
  reads.length = 0; store.lastFullScan = Date.now() - 60_001;
  await request(h.images[0]);
  assert.equal(new Set(reads).size, 21, 'the existing full reconciliation interval still applies');
  reads.length = 0;
  await request(h.images[1]);
  assert.deepEqual(reads, [h.file]);
});

test('attachment authorization immediately follows external reference removal and kind changes', async t => {
  const h = await harness(t);
  assert.deepEqual(h.read().bytes, tinyPng);
  for (const change of [meta => { meta.attachments = []; }, meta => { meta.kind = 'knowledge'; }]) {
    h.rewrite(change);
    assert.throws(h.read, { code: 'NOT_FOUND', status: 404 });
    fs.writeFileSync(h.file, h.raw);
    assert.deepEqual(h.read().bytes, tinyPng);
  }
  h.rewrite(meta => { meta.sourceFile = meta.attachments[0]; delete meta.attachments; });
  assert.deepEqual(h.read().bytes, tinyPng);
  const sourceRaw = fs.readFileSync(h.file, 'utf8');
  h.rewrite(meta => { delete meta.sourceFile; }, h.file, sourceRaw);
  assert.throws(h.read, { code: 'NOT_FOUND', status: 404 });
});

test('unchanged reported file stamps cannot authorize a removed attachment reference', async t => {
  const h = await harness(t), stamp = fs.statSync(h.file, { bigint: true }), original = fs.statSync;
  // Model a filesystem returning the cached identity/stamps despite changed bytes.
  t.mock.method(fs, 'statSync', function (file, options) {
    if (file === h.file && options?.bigint === true) return stamp;
    return original.call(this, file, options);
  });
  h.rewrite(meta => { meta.attachments = []; });
  assert.throws(h.read, { code: 'NOT_FOUND', status: 404 });
  fs.writeFileSync(h.file, h.raw);
  assert.deepEqual(h.read().bytes, tinyPng);
});

test('unchanged reported stamps on another note cannot hide a conflicting attachment owner ID', async t => {
  const h = await harness(t), store = h.service.store;
  const other = store.create({ title: '另一份合成资料', body: '其他正文'.repeat(200) });
  const file = path.join(store.vaultDir, other.path), raw = fs.readFileSync(file, 'utf8');
  store.scan();
  const stamp = fs.statSync(file, { bigint: true }), original = fs.statSync;
  t.mock.method(fs, 'statSync', function (target, options) {
    if (target === file && options?.bigint === true) return stamp;
    return original.call(this, target, options);
  });
  h.rewrite(meta => { meta.id = h.note.id; }, file, raw);
  assert.throws(h.read, { code: 'NOT_FOUND', status: 404 });
  fs.writeFileSync(file, raw);
  assert.deepEqual(h.read().bytes, tinyPng);
});

test('fresh identity checks honor plain files, short files, unclosed headers, CRLF and EOF delimiters', async t => {
  for (const format of ['plain', 'short', 'unclosed', 'crlf', 'eof']) {
    const h = await harness(t), file = path.join(path.dirname(h.file), '其他格式.md');
    const ownerHeader = `---\nid: ${h.note.id}\n---`;
    const initial = format === 'plain' ? '普通合成正文'.repeat(200)
      : format === 'short' ? '---'
      : format === 'unclosed' ? `---\nid: ${h.note.id}\n尚未闭合`
      : format === 'crlf' ? `---\r\nid: ${randomUUID()}\r\n---\r\n合成正文`
      : ownerHeader;
    fs.writeFileSync(file, initial); h.service.store.scan();
    const stamp = fs.statSync(file, { bigint: true }), original = fs.statSync;
    const statSpy = t.mock.method(fs, 'statSync', function (target, options) {
      if (target === file && options?.bigint === true) return stamp;
      return original.call(this, target, options);
    });
    try {
      fs.writeFileSync(file, format === 'eof' ? initial + 'x' : (ownerHeader + '\n合成正文').replaceAll('\n', format === 'crlf' ? '\r\n' : '\n'));
      if (format === 'eof') assert.deepEqual(h.read().bytes, tinyPng, 'an invalidated EOF delimiter no longer claims the owner ID');
      else assert.throws(h.read, { code: 'NOT_FOUND', status: 404 }, format);
    } finally { statSpy.mock.restore(); }
  }
});

test('attachment reads reconcile moves, duplicate IDs, replacement IDs and deletion', async t => {
  const h = await harness(t), moved = path.join(path.dirname(h.file), '已移动.md');
  fs.renameSync(h.file, moved);
  assert.deepEqual(h.read().bytes, tinyPng);
  const duplicate = path.join(path.dirname(moved), '冲突.md');
  fs.copyFileSync(moved, duplicate);
  assert.throws(h.read, { code: 'NOT_FOUND', status: 404 });
  fs.unlinkSync(duplicate);
  assert.deepEqual(h.read().bytes, tinyPng);
  const replacement = path.join(h.root, 'replacement.md');
  h.rewrite(meta => { meta.attachments = []; }, replacement);
  fs.unlinkSync(moved); fs.renameSync(replacement, moved);
  assert.throws(h.read, { code: 'NOT_FOUND', status: 404 });
  fs.writeFileSync(moved, h.raw);
  assert.deepEqual(h.read().bytes, tinyPng);
  h.rewrite(meta => { meta.id = randomUUID(); }, moved);
  assert.throws(h.read, { code: 'NOT_FOUND', status: 404 });
  fs.writeFileSync(moved, h.raw);
  assert.deepEqual(h.read().bytes, tinyPng);
  fs.unlinkSync(moved);
  assert.throws(h.read, { code: 'NOT_FOUND', status: 404 });
});

test('a same-size external edit with restored mtime still revokes the attachment', async t => {
  const h = await harness(t), stat = fs.statSync(h.file), asset = h.images[0].receipt.attachment.id;
  const modified = h.raw.replaceAll(asset, 'f'.repeat(64) + '.png');
  assert.equal(Buffer.byteLength(modified), Buffer.byteLength(h.raw));
  fs.writeFileSync(h.file, modified); fs.utimesSync(h.file, stat.atime, stat.mtime);
  assert.throws(h.read, { code: 'NOT_FOUND', status: 404 });
});

test('warm attachment reads reject linked note directories, attachment directories and Vault roots', async t => {
  const h = await harness(t), store = h.service.store;
  const outside = path.join(h.root, 'outside'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, path.basename(h.file)), h.raw);
  for (const [directory, code, status] of [
    [path.dirname(h.file), 'NOT_FOUND', 404],
    [path.join(store.vaultDir, '.zhixu-attachments'), 'SYMLINK', 403],
    [store.vaultDir, 'SYMLINK', 403],
  ]) {
    const saved = path.join(h.root, 'saved-directory'); fs.renameSync(directory, saved);
    try {
      fs.symlinkSync(outside, directory, process.platform === 'win32' ? 'junction' : 'dir');
      assert.equal(fs.lstatSync(directory).isSymbolicLink(), true, 'fixture must be a real directory link');
      assert.throws(h.read, { code, status });
    } finally {
      if (fs.lstatSync(directory, { throwIfNoEntry: false })?.isSymbolicLink()) fs.unlinkSync(directory);
      fs.renameSync(saved, directory);
    }
    assert.deepEqual(h.read().bytes, tinyPng);
  }
});

test('warm reads retain attachment path, MIME, size and byte-hash checks', async t => {
  const h = await harness(t), asset = h.images[0].receipt.attachment.id;
  h.rewrite(meta => { meta.attachments[0].id = '../outside.png'; });
  assert.throws(() => h.service.readFile(h.note.id, '../outside.png'), { code: 'ATTACHMENT_INVALID', status: 400 });
  h.rewrite(meta => { meta.attachments[0].mime = 'text/html'; });
  assert.throws(h.read, { code: 'ATTACHMENT_INVALID', status: 400 });
  fs.writeFileSync(h.file, h.raw);
  const file = path.join(h.service.store.vaultDir, '.zhixu-attachments', asset), changed = Buffer.from(tinyPng);
  changed[changed.length - 1] ^= 4; fs.writeFileSync(file, changed);
  assert.throws(h.read, { code: 'ATTACHMENT_CHANGED', status: 409 });
  fs.writeFileSync(file, tinyPng.subarray(0, -1));
  assert.throws(h.read, { code: 'ATTACHMENT_CHANGED', status: 409 });
  fs.writeFileSync(file, tinyPng);
  assert.deepEqual(h.read().bytes, tinyPng);
});
