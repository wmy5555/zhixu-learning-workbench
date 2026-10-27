import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { syncBuiltinESMExports } from 'node:module';
import { decodeFile, readAttachment } from '../src/attachments.mjs';
import { tinyPng, tinyPdf } from './fixtures/source-files.mjs';

const pngSha = '54d8b23bb06862419b9e8757c522350f1609af47cc8276f7003475e347127b06';
const changedSha = 'b05b8225520ce3fd66c1b2b04a9dc7f28a251dbe79eb5144a76bf8652ac9c518';
const pdfSha = '91c4ca074dd9480fc03dbfb34a61150a57ed3d2ca0a575d4ce2bf033decd0e48';

function countHashes(t) {
  const original = crypto.createHash;
  const spy = t.mock.method(crypto, 'createHash', function (...args) { return original.apply(this, args); });
  syncBuiltinESMExports();
  t.after(() => { spy.mock.restore(); syncBuiltinESMExports(); });
  return spy.mock;
}

test('attachment decoding hashes once per call and preserves Buffer/base64 descriptors and bytes', t => {
  const hashes = countHashes(t);
  for (const [index, sample] of [
    { input: { name: '合成.png', bytes: tinyPng }, bytes: tinyPng, sha: pngSha, kind: 'image', ext: 'png', mime: 'image/png' },
    { input: { name: '合成.pdf', bytes: tinyPdf }, bytes: tinyPdf, sha: pdfSha, kind: 'pdf', ext: 'pdf', mime: 'application/pdf' },
    { input: { name: '编码.png', base64: tinyPng.toString('base64') }, bytes: tinyPng, sha: pngSha, kind: 'image', ext: 'png', mime: 'image/png' },
  ].entries()) {
    const file = decodeFile(sample.input);
    assert.deepEqual(file.bytes, sample.bytes);
    if (sample.input.bytes) assert.equal(file.bytes, sample.input.bytes);
    assert.deepEqual(file.descriptor, { id: sample.sha + '.' + sample.ext, name: sample.input.name, mime: sample.mime, size: sample.bytes.length, sha256: sample.sha, kind: sample.kind, format: sample.ext });
    assert.equal(hashes.callCount(), index + 1);
    assert.deepEqual(hashes.calls.at(-1).arguments, ['sha256']);
  }
});

test('reusing and mutating the same Buffer still computes a new digest on every decode', t => {
  const bytes = Buffer.from(tinyPng), hashes = countHashes(t);
  assert.equal(decodeFile({ name: '合成.png', bytes }).descriptor.sha256, pngSha);
  bytes[bytes.length - 1] ^= 1;
  assert.equal(decodeFile({ name: '合成.png', bytes }).descriptor.sha256, changedSha);
  assert.equal(decodeFile({ name: '合成.png', bytes }).descriptor.sha256, changedSha);
  assert.equal(hashes.callCount(), 3, 'neither Buffer identity nor identical contents may cache a digest across calls');
});

test('invalid attachment inputs retain exact errors and reject before hashing', t => {
  const hashes = countHashes(t), largePixels = Buffer.from(tinyPng); largePixels.writeUInt32BE(100000, 16);
  for (const [input, code, status, message] of [
    [{ name: '../a.png', bytes: tinyPng }, 'ATTACHMENT_INVALID', 400, '文件名无效，请使用不含路径的普通文件名。'],
    [{ name: 'a.png', bytes: tinyPng, mime: 'text/html' }, 'ATTACHMENT_INVALID', 400, '文件类型与扩展名不一致。'],
    [{ name: 'a.png', bytes: Buffer.alloc(0) }, 'TOO_LARGE', 413, '每个文件最多 50 MB（50,000,000 字节）。'],
    [{ name: 'a.png', bytes: Buffer.alloc(24) }, 'ATTACHMENT_INVALID', 400, '文件内容与格式不符，未导入。'],
    [{ name: 'a.png', base64: 'invalid' }, 'ATTACHMENT_INVALID', 400, '文件为空、编码无效或超过 50 MB（50,000,000 字节）。'],
    [{ name: 'a.png', bytes: largePixels }, 'ATTACHMENT_INVALID', 400, '图片尺寸无效或超过 4000 万像素 / 单边 16000 像素限制。'],
  ]) assert.throws(() => decodeFile(input), { code, status, message });
  assert.equal(hashes.callCount(), 0);
});

test('each disk read rehashes current attachment bytes and preserves tamper and size errors', t => {
  const temporaryRoot = path.resolve(import.meta.dirname, '..', '.tmp'); fs.mkdirSync(temporaryRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(temporaryRoot, 'attachment-digest-'));
  assert.equal(path.dirname(root), temporaryRoot);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const descriptor = decodeFile({ name: '磁盘合成.png', bytes: tinyPng }).descriptor;
  const file = path.join(root, '.zhixu-attachments', descriptor.id); fs.mkdirSync(path.dirname(file)); fs.writeFileSync(file, tinyPng);
  const hashes = countHashes(t);
  for (let index = 1; index <= 2; index++) {
    const result = readAttachment(root, descriptor);
    assert.deepEqual(result.bytes, tinyPng); assert.deepEqual(result.descriptor, descriptor);
    assert.equal(hashes.callCount(), index);
  }
  const changed = Buffer.from(tinyPng); changed[changed.length - 1] ^= 1; fs.writeFileSync(file, changed);
  assert.throws(() => readAttachment(root, descriptor), { code: 'ATTACHMENT_CHANGED', status: 409, message: '附件内容已变化。' });
  assert.equal(hashes.callCount(), 3);
  fs.writeFileSync(file, tinyPng.subarray(0, -1));
  assert.throws(() => readAttachment(root, descriptor), { code: 'ATTACHMENT_CHANGED', status: 409, message: '附件大小已变化。' });
  assert.equal(hashes.callCount(), 3, 'size rejection still precedes hashing');
});
