import fs from 'node:fs';
import YAML from 'yaml';
import { BACKUP_MAX_BYTES, BACKUP_REQUEST_MAX_BYTES } from './backup-contract.mjs';
import { attachmentPath, decodeFile, statAttachment, readAttachment, writeAttachment, assertAttachmentCapacity } from './attachments.mjs';

const invalid = message => { throw Object.assign(new Error(message), { code: 'ATTACHMENT_BACKUP', status: 400 }); };
// Attachments, billing evidence, history and preferences share the complete JSON budget.
export const MAX_BACKUP_BYTES = BACKUP_MAX_BYTES;
export const MAX_RESTORE_REQUEST_BYTES = BACKUP_REQUEST_MAX_BYTES;
function references(backup) {
  const descriptors = new Map();
  for (const row of [...backup.notes, ...backup.versions]) {
    const frontmatter = row.raw?.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
    const meta = frontmatter ? YAML.parse(frontmatter, { maxAliasCount: 50 }) : {};
    if (meta.attachments !== undefined && !Array.isArray(meta.attachments)) invalid('附件索引格式无效。');
    for (const item of [meta.sourceFile, ...(meta.attachments || [])].filter(Boolean)) {
      if (meta.kind !== 'source') invalid('非文本附件只能属于第一层原始资料。');
      attachmentPath('.', item.id);
      const prior = descriptors.get(item.id);
      if (prior && (prior.sha256 !== item.sha256 || prior.size !== item.size || prior.mime !== item.mime)) invalid('附件身份定义冲突。');
      descriptors.set(item.id, item);
    }
  }
  return descriptors;
}
export function includeAttachments(root, backup) {
  const refs = references(backup);
  if (!refs.size) return backup;
  const envelope = { ...backup, version: 2, scope: { ...backup.scope, attachments: true }, attachments: [] };
  let estimatedBytes = Buffer.byteLength(JSON.stringify(envelope)), index = 0;
  // Reject before reading any attachment or allocating its base64 representation.
  // The final exact check also covers descriptor normalization and file changes.
  for (const descriptor of refs.values()) {
    const { size } = statAttachment(root, descriptor);
    estimatedBytes += (index++ ? 1 : 0) + Buffer.byteLength(JSON.stringify({ ...descriptor, base64: '' })) + 4 * Math.ceil(size / 3);
    if (estimatedBytes > MAX_BACKUP_BYTES) invalid('包含附件的 JSON 备份预计超过 100 MB（100,000,000 字节）；请另行完整复制 Vault 与运行数据。尚未读取或编码附件，没有生成不完整备份。');
  }
  const attachments = [...refs.values()].map(descriptor => {
    const file = readAttachment(root, descriptor);
    return { ...file.descriptor, base64: file.bytes.toString('base64') };
  });
  const result = { ...envelope, attachments };
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_BACKUP_BYTES) invalid('包含附件的 JSON 备份超过 100 MB（100,000,000 字节）；请另行完整复制 Vault 与运行数据。没有生成不完整备份。');
  return result;
}
export function validateAttachments(root, backup) {
  const refs = references(backup);
  if (backup.version === 1) { if (refs.size || backup.attachments?.length) invalid('含受管理附件的备份必须使用版本 2。'); return []; }
  if (!Array.isArray(backup.attachments) || backup.attachments.length !== refs.size || Buffer.byteLength(JSON.stringify(backup)) > MAX_BACKUP_BYTES) invalid('附件备份清单缺失、重复或超过容量限制。');
  const files = [], seen = new Set();
  for (const item of backup.attachments) {
    const file = decodeFile(item), reference = refs.get(item.id);
    if (!reference || seen.has(item.id) || file.descriptor.id !== item.id || reference.sha256 !== file.descriptor.sha256 || reference.mime !== file.descriptor.mime || reference.size !== file.bytes.length) invalid('附件哈希、格式、身份或引用不匹配。');
    // Names may differ between references to identical bytes; validate all via the reader on use.
    const target = attachmentPath(root, item.id);
    if (fs.existsSync(target)) readAttachment(root, file.descriptor);
    seen.add(item.id); files.push(file);
  }
  assertAttachmentCapacity(root, files.map(file => file.descriptor));
  return files;
}
export function installAttachments(root, files) {
  // Add-only, content-addressed installation. A failed Markdown restore may leave
  // unreferenced bytes; neither existing attachments nor external files are removed.
  assertAttachmentCapacity(root, files.map(file => file.descriptor));
  for (const file of files) writeAttachment(root, file);
}
