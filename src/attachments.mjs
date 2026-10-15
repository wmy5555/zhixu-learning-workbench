import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { MAX_FILE_BYTES } from '../public/source-file-limits.mjs';
import { outboundText } from './outbound-text.mjs';

export { MAX_FILE_BYTES };
export const MAX_ATTACHMENT_STORAGE_BYTES = 256 * 1024 * 1024;
export const MAX_ATTACHMENT_STORAGE_FILES = 1000;
const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const reject = (message, code = 'ATTACHMENT_INVALID', status = 400) => { throw Object.assign(new Error(message), { code, status }); };
function fileType(input) {
  const name = input?.name;
  if (typeof name !== 'string' || !name || name.length > 180 || /[\\/\x00-\x1f<>:"|?*]/u.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) reject('文件名无效，请使用不含路径的普通文件名。');
  const ext = name.split('.').at(-1).toLowerCase(), mime = types[ext];
  if (!mime) reject('支持 PNG/JPEG/GIF/WebP、PDF、DOC 和 DOCX；不接受 HTML、SVG 或宏文档扩展名。');
  if (input.mime && input.mime !== 'application/octet-stream' && input.mime.toLowerCase() !== mime) reject('文件类型与扩展名不一致。');
  return { name, ext, mime };
}
export function assertAttachmentDescriptor(descriptor, content) {
  const { ext, mime } = fileType(descriptor);
  const kind = mime.startsWith('image/') ? 'image' : ext === 'pdf' ? 'pdf' : 'word';
  if (descriptor.id !== content.id || descriptor.sha256 !== content.sha256 || descriptor.size !== content.size
    || descriptor.id !== content.sha256 + '.' + (ext === 'jpeg' ? 'jpg' : ext)
    || descriptor.mime !== mime || mime !== content.mime || descriptor.kind !== kind || kind !== content.kind || descriptor.format !== ext) {
    reject('附件描述与已核验的原字节不一致。', 'ATTACHMENT_CHANGED', 409);
  }
}
export function decodeFile(input) {
  const { name, ext, mime } = fileType(input);
  // Avoid a repeated-group regexp: large valid base64 can exhaust its stack.
  if (!Buffer.isBuffer(input.bytes) && (typeof input.base64 !== 'string' || !input.base64.length || input.base64.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || input.base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64))) reject('文件为空、编码无效或超过 50 MB（50,000,000 字节）。');
  const bytes = input.bytes || Buffer.from(input.base64, 'base64');
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) reject('每个文件最多 50 MB（50,000,000 字节）。', 'TOO_LARGE', 413);
  const hex = bytes.subarray(0, 12).toString('hex'), ascii = bytes.subarray(0, 12).toString('ascii');
  const valid = ext === 'png' ? hex.startsWith('89504e470d0a1a0a') && bytes.length >= 24
    : ['jpg','jpeg'].includes(ext) ? hex.startsWith('ffd8ff')
    : ext === 'gif' ? /^GIF8[79]a/.test(ascii)
    : ext === 'webp' ? ascii.startsWith('RIFF') && ascii.slice(8) === 'WEBP'
    : ext === 'pdf' ? /^%PDF-1\.[0-9]|^%PDF-2\.0/.test(ascii) && bytes.subarray(-1024).includes(Buffer.from('%%EOF'))
    : ext === 'doc' ? hex.startsWith('d0cf11e0a1b11ae1') && bytes.includes(Buffer.from('WordDocument', 'utf16le'))
    : hex.startsWith('504b0304');
  if (!valid) reject('文件内容与格式不符，未导入。');
  if (mime.startsWith('image/')) {
    const [width, height] = imageDimensions(bytes, ext);
    if (!width || !height || width > 16000 || height > 16000 || width * height > 40_000_000) reject('图片尺寸无效或超过 4000 万像素 / 单边 16000 像素限制。');
  }
  return { bytes, descriptor: { id: digest(bytes) + '.' + (ext === 'jpeg' ? 'jpg' : ext), name, mime, size: bytes.length, sha256: digest(bytes), kind: mime.startsWith('image/') ? 'image' : ext === 'pdf' ? 'pdf' : 'word', format: ext } };
}
function imageDimensions(b, ext) {
  if (ext === 'png') return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (ext === 'gif' && b.length >= 10) return [b.readUInt16LE(6), b.readUInt16LE(8)];
  if (ext === 'webp' && b.length >= 30) {
    const mode = b.toString('ascii', 12, 16);
    if (mode === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    if (mode === 'VP8 ' && b.subarray(23, 26).equals(Buffer.from([157,1,42]))) return [b.readUInt16LE(26) & 16383, b.readUInt16LE(28) & 16383];
    if (mode === 'VP8L' && b[20] === 47) return [1 + (((b[22] & 63) << 8) | b[21]), 1 + (((b[24] & 15) << 10) | (b[23] << 2) | ((b[22] & 192) >> 6))];
  }
  if (['jpg','jpeg'].includes(ext)) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i++] !== 255) break;
      while (b[i] === 255) i++;
      if (i + 3 > b.length) break;
      const marker = b[i++], length = b.readUInt16BE(i);
      if (length < 2 || i + length > b.length) break;
      if (length >= 8 && [192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) return [b.readUInt16BE(i + 5), b.readUInt16BE(i + 3)];
      i += length;
    }
  }
  return [0, 0];
}
export function attachmentPath(root, id) {
  if (typeof id !== 'string' || !/^[a-f0-9]{64}\.(png|jpg|gif|webp|pdf|doc|docx)$/.test(id)) reject('附件身份无效。');
  const dir = path.join(root, '.zhixu-attachments'), file = path.join(dir, id);
  for (const target of [root, dir, file]) if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) reject('附件路径不能是链接。', 'SYMLINK', 403);
  return file;
}
export function statAttachment(root, descriptor) {
  const file = attachmentPath(root, descriptor?.id);
  if (!fs.existsSync(file)) reject('原始附件缺失，请从包含附件的备份恢复。', 'ATTACHMENT_MISSING', 409);
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES || stat.size !== descriptor.size) reject('附件大小已变化。', 'ATTACHMENT_CHANGED', 409);
  return { file, size: stat.size };
}
export function readAttachment(root, descriptor) {
  const { file } = statAttachment(root, descriptor);
  const bytes = fs.readFileSync(file);
  const checked = decodeFile({ name: descriptor.name, mime: descriptor.mime, bytes });
  if (checked.descriptor.id !== descriptor.id || checked.descriptor.sha256 !== descriptor.sha256) reject('附件内容已变化。', 'ATTACHMENT_CHANGED', 409);
  return { ...checked, descriptor: { ...descriptor, ...checked.descriptor } };
}
export function assertAttachmentCapacity(root, descriptors, { maxBytes = MAX_ATTACHMENT_STORAGE_BYTES, maxFiles = MAX_ATTACHMENT_STORAGE_FILES } = {}) {
  let addedBytes = 0, addedFiles = 0;
  for (const descriptor of new Map(descriptors.map(item => [item.id, item])).values()) {
    const target = attachmentPath(root, descriptor.id);
    if (!Number.isSafeInteger(descriptor.size) || descriptor.size < 1 || descriptor.size > MAX_FILE_BYTES) reject('附件大小无效。');
    if (!fs.existsSync(target)) { addedBytes += descriptor.size; addedFiles++; }
  }
  // Existing originals can still be read, rebound and restored when at capacity.
  if (!addedFiles) return;
  const dir = path.join(root, '.zhixu-attachments');
  let bytes = 0, files = 0;
  const check = () => {
    if (bytes + addedBytes > maxBytes || files + addedFiles > maxFiles) reject('附件存储已达到容量上限（256 MiB 或 1000 个文件）。原件与历史均保留，新增上传或恢复已停止；请先完整备份，再使用独立资料库或联系维护者调整容量。', 'ATTACHMENT_STORAGE_LIMIT', 413);
  };
  check();
  if (fs.existsSync(dir)) {
    const directory = fs.opendirSync(dir);
    try {
      let entry;
      while ((entry = directory.readSync())) {
        const stat = fs.lstatSync(path.join(dir, entry.name));
        if (!stat.isFile()) reject('附件目录包含链接或子目录，请先备份并核对。', 'ATTACHMENT_STORAGE_INVALID', 409);
        // Count every retained file, including revoked/orphaned bytes and leftovers.
        bytes += stat.size; files++; check();
      }
    } finally { directory.closeSync(); }
  }
}
export function writeAttachment(root, file, limits) {
  const target = attachmentPath(root, file.descriptor.id);
  if (fs.existsSync(target)) { readAttachment(root, file.descriptor); return; }
  assertAttachmentCapacity(root, [file.descriptor], limits);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = target + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, file.bytes, { flag: 'wx', mode: 0o600 });
    try { fs.linkSync(temporary, target); }
    catch (error) { if (error.code !== 'EEXIST') throw error; readAttachment(root, file.descriptor); }
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
let activeConversions = 0;
export function extractWord(file, { timeoutMs = 10000 } = {}) {
  if (file.descriptor.format !== 'docx') return Promise.resolve({ status: 'unsupported', text: '', warnings: ['旧版 DOC 仅保存原件；请用你信任的编辑器另存为 DOCX 后重新导入。'], tool: null });
  if (activeConversions >= 2) reject('已有两份 Word 正在转换，请稍后重试。', 'CONVERSION_BUSY', 409);
  return new Promise(resolve => {
    const worker = new Worker(new URL('./word-worker.mjs', import.meta.url), { workerData: { bytes: file.bytes, format: file.descriptor.format }, resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } });
    activeConversions++;
    let finished = false;
    const finish = result => { if (finished) return; finished = true; clearTimeout(timer); void worker.terminate().finally(() => { activeConversions--; }); resolve(result); };
    const timer = setTimeout(() => finish({ status: 'failed', text: '', warnings: ['转换超过时限；原文件保留，可下载后另存为普通 DOCX 再导入。'] }), timeoutMs);
    worker.once('message', finish);
    worker.once('error', () => finish({ status: 'failed', text: '', warnings: ['转换器未能读取文件；可能已加密、损坏或超出资源限制。原文件保留。'] }));
    worker.once('exit', () => finish({ status: 'failed', text: '', warnings: ['转换未完成，原文件保留。'] }));
  });
}
export function assertTextSource(note) {
  if (!note.meta?.sourceFile) return;
  const extraction = note.meta.textExtraction;
  if (!(note.meta.sourceFile.format === 'docx' && typeof extraction?.text === 'string' && extraction.text.trim() && extraction.sourceSha256 === note.meta.sourceFile.sha256)) reject('图片、PDF及未提取到文字的Word仅保存在第一层，不能拆解或整理为知识。', 'SOURCE_FILE_ONLY', 409);
  if (digest(extraction.text) !== extraction.textSha256) reject('Word 提取文字与保存的校验值不一致，已停止加工。请核对外部编辑并从可信版本恢复提取记录；原件和当前文字均保留。', 'EXTRACTION_CHANGED', 409);
}
export const processingText = note => { assertTextSource(note); return outboundText(note.meta.sourceFile ? note.meta.textExtraction.text : note.body); };
