import { validPricingSnapshot, validPriceConfirmation } from './pricing.mjs';
import path from 'node:path';
import YAML from 'yaml';

// Count the final UTF-8 JSON, including escaping, records, history and preferences.
export const BACKUP_MAX_BYTES = 100_000_000;
export const BACKUP_REQUEST_MAX_BYTES = BACKUP_MAX_BYTES + 65_536;
export const BACKUP_ITEM_MAX_BYTES = 5_000_000;
export const BACKUP_RESPONSE_BODY_MAX_BYTES = 3 * 1024 * 1024;
// A one-byte control character can occupy six bytes in serialized JSON. Keep
// the existing metadata allowance while measuring response text after decoding.
const BACKUP_CALL_RESULT_MAX_BYTES = 6 * BACKUP_RESPONSE_BODY_MAX_BYTES + BACKUP_ITEM_MAX_BYTES;
export const validBackupId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
export const backupObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function invalid(message, code = 'INVALID', status = 400) {
  throw Object.assign(new Error(message), { code, status });
}
export function assertBackupSize(backup) {
  let raw;
  try { raw = JSON.stringify(backup); } catch { invalid('备份包含无法保存的 JSON 数据。'); }
  if (typeof raw !== 'string') invalid('备份格式不正确。');
  if (Buffer.byteLength(raw, 'utf8') > BACKUP_MAX_BYTES) invalid('备份完整 JSON 超过 100 MB 限制；请另行复制整个 Vault 和数据目录。', 'TOO_LARGE', 413);
  return raw;
}
export function validateBackupPath(value) {
  if (typeof value !== 'string' || !value || value.length > 1_000 || value.includes('\\') || /[\x00-\x1f\x7f]/.test(value) || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) invalid('备份包含非法 Markdown 路径。');
  const parts = value.split('/'), device = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  if (parts.some(part => !part || part === '.' || part === '..' || part.startsWith('.') || /[<>:"|?*]/.test(part) || /[. ]$/.test(part) || device.test(part)) || path.extname(value).toLowerCase() !== '.md') invalid('备份包含非法 Markdown 路径。');
  return parts.join('/');
}
const date = value => typeof value === 'string' && value.length <= 100 && Number.isFinite(Date.parse(value));
const stringList = value => Array.isArray(value) && value.every(item => typeof item === 'string');
export function validateBackupMarkdown(raw, id) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > BACKUP_ITEM_MAX_BYTES) invalid('备份包含非法 Markdown。');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (/^---(?:\r?\n|$)/.test(raw) && !match) invalid('备份 Markdown 属性头未闭合。', 'FRONTMATTER');
  let meta;
  try {
    const doc = YAML.parseDocument(match?.[1] || '{}');
    if (doc.errors.length) invalid('备份 Markdown 属性格式错误。', 'FRONTMATTER');
    meta = doc.toJS({ maxAliasCount: 50 });
  } catch { invalid('备份 Markdown 属性格式错误。', 'FRONTMATTER'); }
  if (!backupObject(meta)) invalid('备份 Markdown 属性必须为键值对象。');
  if (meta.id !== undefined && meta.id !== id) invalid('备份 Markdown 的稳定身份不一致。');
  const enums = { kind: ['source','knowledge','mistake','topic','report'], privacy: ['local','cloud'], stage: ['reference','candidate','learning','integrated','core','retired'], depth: ['aware','find','explain','apply'] };
  for (const [key, values] of Object.entries(enums)) if (meta[key] !== undefined && !values.includes(meta[key])) invalid(`备份 Markdown 的 ${key} 属性无效。`);
  for (const key of ['title','processKey','generatedBodyHash','reviewAfter','confirmedAt','topic','supersededBy']) if (meta[key] !== undefined && meta[key] !== null && typeof meta[key] !== 'string') invalid(`备份 Markdown 的 ${key} 属性无效。`);
  for (const key of ['createdAt','updatedAt']) if (meta[key] !== undefined && !date(meta[key])) invalid(`备份 Markdown 的 ${key} 时间无效。`);
  for (const key of ['paused','userEdited','userStructured','excerptOnly','titlePending']) if (meta[key] !== undefined && typeof meta[key] !== 'boolean') invalid(`备份 Markdown 的 ${key} 属性无效。`);
  for (const key of ['noteIds','managedLinkIds','researchLimitations','claims','prerequisites']) if (meta[key] !== undefined && !stringList(meta[key])) invalid(`备份 Markdown 的 ${key} 属性无效。`);
  for (const key of ['sources','evidence','relations']) if (meta[key] !== undefined && (!Array.isArray(meta[key]) || meta[key].some(item => !backupObject(item)))) invalid(`备份 Markdown 的 ${key} 属性无效。`);
  if (meta.sources?.some(item => !validBackupId(item.id) || typeof item.role !== 'string')) invalid('备份 Markdown 来源属性无效。');
  if (meta.relations?.some(item => !validBackupId(item.id) || !validBackupId(item.fromId) || !validBackupId(item.toId) || item.fromId === item.toId || ![item.fromId,item.toId].includes(id) || ![undefined,'accepted'].includes(item.state))) invalid('备份 Markdown 关系属性无效。');
  return meta;
}
export function validateBackupRecord(row) {
  const maxBytes = row?.namespace === 'callResults' ? BACKUP_CALL_RESULT_MAX_BYTES : BACKUP_ITEM_MAX_BYTES;
  if (!backupObject(row) || typeof row.namespace !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(row.namespace) || ['settings','changed','restore','attachmentUploads'].includes(row.namespace) || typeof row.key !== 'string' || !row.key || row.key.length > 500 || /[\x00-\x1f\x7f]/.test(row.key) || typeof row.json !== 'string' || Buffer.byteLength(row.json) > maxBytes) invalid('备份运行记录不正确。');
  let value;
  try { value = JSON.parse(row.json); } catch { invalid('备份运行记录不是有效 JSON。'); }
  if (row.namespace === 'chatgptCaptureRate') {
    if (!Array.isArray(value) || value.some(item => !Number.isFinite(item) || item < 0)) invalid('备份调用频率记录无效。');
    return value;
  }
  if (!backupObject(value)) invalid('备份运行记录必须为键值对象。');
  if (value.id !== undefined && (typeof value.id !== 'string' || !value.id || value.id !== row.key)) invalid('备份运行记录身份不一致。');
  for (const key of ['noteId','fromId','toId']) if (value[key] !== undefined && !validBackupId(value[key])) invalid('备份运行记录引用身份无效。');
  if (row.namespace === 'jobs' && (!validBackupId(value.id) || typeof value.type !== 'string' || !backupObject(value.payload) || !['queued','running','waiting','failed','done','cancelled'].includes(value.state) || !Number.isInteger(value.attempts) || value.attempts < 0)) invalid('备份任务记录无效。');
  if (['calls','callLedger'].includes(row.namespace) && value.pricingConfirmation != null && !validPriceConfirmation(value.pricingConfirmation)) invalid('备份价格核对记录无效。');
  const snapshotOwner = row.namespace === 'callResults' ? value.entry : value;
  if (['calls','callLedger','callResults'].includes(row.namespace) && snapshotOwner?.pricingSnapshot !== undefined && (!validPricingSnapshot(snapshotOwner.pricingSnapshot) || snapshotOwner.pricingSnapshot.identity.capability !== snapshotOwner.capability || snapshotOwner.pricingSnapshot.identity.model !== (snapshotOwner.model || null))) invalid('备份价格快照无效。');
  if (row.namespace === 'calls' && !date(value.createdAt)) invalid('备份调用记录时间无效。');
  if (row.namespace === 'calls' && value.cost !== undefined && value.cost !== null && (!Number.isFinite(value.cost) || value.cost < 0)) invalid('备份调用费用无效。');
  if (row.namespace === 'sessions' && value.turns !== undefined && (!Array.isArray(value.turns) || value.turns.some(item => !backupObject(item)))) invalid('备份学习回答记录无效。');
  if (row.namespace === 'askRequests') {
    const input = value.input, prepared = value.prepared;
    if (value.callId !== undefined && (!validBackupId(value.callId) || value.completed !== true || value.generated !== true)) invalid('备份问答完成调用身份无效。');
    if ((prepared !== undefined || value.completed) && (typeof value.basisHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.basisHash))) invalid('备份问答取材身份无效。');
    if (!validBackupId(value.id) || !validBackupId(value.draftId) || !date(value.createdAt) || !backupObject(input) || typeof input.question !== 'string' || !input.question.trim() || input.question.length > 500000 || !Array.isArray(input.scope) || !input.scope.length || input.scope.some(kind => !['knowledge','source'].includes(kind)) || !['answer','outline','draft'].includes(input.mode) || !['local','cloud'].includes(input.privacy) || value.completed !== undefined && value.completed !== true || value.completed && typeof value.generated !== 'boolean') invalid('备份问答请求无效。');
    if (prepared !== undefined && (!backupObject(prepared) || typeof prepared.generated !== 'boolean' || !Array.isArray(prepared.references) || prepared.references.some(item => !backupObject(item) || !validBackupId(item.id) || typeof item.hash !== 'string' || !/^[a-f0-9]{64}$/.test(item.hash) || typeof item.cloud !== 'boolean') || !Array.isArray(prepared.citations) || prepared.citations.some(item => !backupObject(item) || !validBackupId(item.id) || typeof item.title !== 'string' || typeof item.excerpt !== 'string' || !Array.isArray(item.sources)) || !stringList(prepared.limitations) || !prepared.generated && typeof prepared.answer !== 'string')) invalid('备份问答准备状态无效。');
  }
  if (row.namespace === 'topics' && (value.noteIds !== undefined && !stringList(value.noteIds) || value.paused !== undefined && typeof value.paused !== 'boolean')) invalid('备份主题运行记录无效。');
  if (row.namespace === 'vaultRelations' && (!stringList(value.ownerIds) || !Array.isArray(value.ownerPaths) || value.ownerPaths.some(item => !backupObject(item) || !validBackupId(item.id) || typeof item.path !== 'string'))) invalid('备份关系镜像记录无效。');
  if (row.namespace === 'callLedger' && (!validBackupId(value.id) || !['reserved','dispatch','received','unknown','accounted','cancelled','resolved_unknown'].includes(value.phase) || !['model','embedding','search','fetch'].includes(value.capability) || !date(value.createdAt) || !date(value.updatedAt) || value.reservedCost !== null && (!Number.isFinite(value.reservedCost) || value.reservedCost < 0))) invalid('备份调用账本无效。');
  if (row.namespace === 'callResults' && (!validBackupId(value.id) || !backupObject(value.response) || !Number.isInteger(value.response.status) || value.response.status < 100 || value.response.status > 599 || typeof value.response.body !== 'string' || Buffer.byteLength(value.response.body) > BACKUP_RESPONSE_BODY_MAX_BYTES || !backupObject(value.response.headers) || !backupObject(value.entry) || !date(value.receivedAt))) invalid('备份调用响应无效。');
  if (row.namespace === 'callResults') {
    if (Buffer.byteLength(JSON.stringify({ ...value, response: { ...value.response, body: '' } })) > BACKUP_ITEM_MAX_BYTES) invalid('备份调用响应附加字段超限。');
    const entry = value.entry;
    if (!['model','embedding','search','fetch'].includes(entry.capability) || entry.model !== null && typeof entry.model !== 'string' || entry.cost !== null && (!Number.isFinite(entry.cost) || entry.cost < 0) || typeof entry.ok !== 'boolean' || !Number.isFinite(entry.durationMs) || entry.durationMs < 0) invalid('备份调用响应记账字段无效。');
    for (const key of ['inputTokens','outputTokens','cachedInputTokens','embeddingTokens','searchCount']) if (entry[key] !== undefined && entry[key] !== null && (!Number.isInteger(entry[key]) || entry[key] < 0)) invalid('备份调用响应用量字段无效。');
    if (Object.entries(value.response.headers).some(([key, item]) => !['content-type','location'].includes(key) || typeof item !== 'string')) invalid('备份调用响应头无效。');
  }
  return value;
}
