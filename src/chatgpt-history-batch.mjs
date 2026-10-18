import { validateImportedStructure } from './chatgpt-structure.mjs';
import { historySourceMetadata } from './chatgpt-source-metadata.mjs';
import { createHash } from 'node:crypto';

export const historyBatchLimits = Object.freeze({ maxCharacters: 500000, maxMessages: 200,
  maxMessageCharacters: 120000, maxSummaryCharacters: 30000, maxPayloadJsonCharacters: 1000000,
  maxFrameBytes: 2 * 1024 * 1024, snapshotLifetimeMilliseconds: 5 * 60 * 1000 });
const id = /^[A-Za-z0-9_-]{1,200}$/;
const sha = /^[a-f0-9]{64}$/;
const digest = value => createHash('sha256').update(value).digest('hex');
const jsonHash = value => digest(JSON.stringify(value));
const equal = (a, b) => a?.message === b?.message && a?.offset === b?.offset;
const after = (a, b) => a.message > b.message || a.message === b.message && a.offset > b.offset;
const accepted = new Set(['saved', 'updated', 'already_saved']);
function invalid(message, code = 'CHATGPT_BATCH_INVALID') {
  throw Object.assign(new Error(message), { code });
}
function clone(value) {
  try { return JSON.parse(JSON.stringify(value)); }
  catch { invalid('历史分片输入不是可序列化的数据。'); }
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}
function pointValid(point, units) {
  return point && Number.isSafeInteger(point.message) && point.message >= 0 && point.message <= units.length &&
    Number.isSafeInteger(point.offset) && point.offset >= 0 &&
    (point.message === units.length ? point.offset === 0 : point.offset < units[point.message].content.length);
}
function boundary(text, end) {
  if (end < text.length && end > 0 && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) return end - 1;
  return end;
}
function validateSnapshot(snapshot, currentTime) {
  if (snapshot?.version !== 1 || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(snapshot.conversation_id || '') ||
    snapshot.branch !== 'active' || !/^[a-f0-9]{32}$/.test(snapshot.snapshot_id || '') || !sha.test(snapshot.transcript_sha256 || '') ||
    typeof snapshot.title !== 'string' || !snapshot.title.trim() || snapshot.title.length > 200 ||
    snapshot.coverage?.text !== 'complete_visible_active_branch' ||
    (snapshot.warnings !== undefined && (!Array.isArray(snapshot.warnings) || snapshot.warnings.some(warning => typeof warning !== 'string'))) ||
    !Array.isArray(snapshot.units) || !snapshot.units.length ||
    !Array.isArray(snapshot.pages) || !snapshot.pages.length || snapshot.pages.length > 1000 || !Number.isSafeInteger(currentTime) ||
    !Number.isSafeInteger(snapshot.issued_at) || snapshot.issued_at > currentTime ||
    snapshot.issued_at < currentTime - historyBatchLimits.snapshotLifetimeMilliseconds ||
    !Number.isSafeInteger(snapshot.expires_at) || snapshot.expires_at <= currentTime ||
    snapshot.expires_at > snapshot.issued_at + historyBatchLimits.snapshotLifetimeMilliseconds) {
    invalid('快照身份、完整范围或五分钟有效期无法核对。', 'CHATGPT_BATCH_SNAPSHOT');
  }
  const seen = new Set();
  for (const [index, unit] of snapshot.units.entries()) {
    if (unit?.index !== index || !id.test(unit.message_id || '') || seen.has(unit.message_id) ||
      !['user', 'assistant'].includes(unit.role) || typeof unit.content !== 'string' || !unit.content.trim()) {
      invalid('快照缺少真实唯一消息编号、原文或顺序。', 'CHATGPT_BATCH_MESSAGES');
    }
    seen.add(unit.message_id);
  }
  if (jsonHash(snapshot.units) !== snapshot.transcript_sha256) invalid('快照正文摘要不一致。', 'CHATGPT_BATCH_HASH');
  let end = { message: 0, offset: 0 };
  for (const [index, page] of snapshot.pages.entries()) {
    if (!pointValid(page?.range?.start, snapshot.units) || !pointValid(page?.range?.end, snapshot.units) ||
      !equal(end, page.range.start) || !after(page.range.end, end) || page.hasMore !== (index < snapshot.pages.length - 1)) {
      invalid('历史分页范围不连续、越界或未到末页。', 'CHATGPT_BATCH_PAGES');
    }
    end = page.range.end;
  }
  if (!equal(end, { message: snapshot.units.length, offset: 0 })) invalid('历史分页未覆盖完整末尾。', 'CHATGPT_BATCH_PAGES');
}
function validateStructured(value, units) {
  try { validateImportedStructure(value, units.map(unit => ({ id:unit.message_id, content:unit.content }))); }
  catch(error) { if (error.code === 'CHATGPT_STRUCTURE_INVALID') invalid(error.message,'CHATGPT_BATCH_STRUCTURE'); throw error; }
  return value?.items || [];
}

const unitFrom = (fragment, content) => Object.fromEntries(fragment.unitFields.map(key =>
  [key, key === 'content' ? content : fragment.unitMetadata[key]]));
function fragmentFor(unit, from, to) {
  const content = unit.content.slice(from, to);
  return { messageIndex: unit.index, messageId: unit.message_id, role: unit.role,
    charStart: from, charEnd: to, messageCharacters: unit.content.length,
    fullMessageSha256: digest(unit.content), unitSha256: jsonHash(unit), contentSha256: digest(content), content,
    unitFields: Object.keys(unit), unitMetadata: Object.fromEntries(Object.entries(unit).filter(([key]) => key !== 'content')) };
}
const fragmentEnd = fragment => fragment.charEnd === fragment.messageCharacters
  ? { message: fragment.messageIndex + 1, offset: 0 } : { message: fragment.messageIndex, offset: fragment.charEnd };
function fragmentValid(fragment) {
  return Number.isSafeInteger(fragment?.messageIndex) && fragment.messageIndex >= 0 && id.test(fragment.messageId || '') &&
    ['user', 'assistant'].includes(fragment.role) && Number.isSafeInteger(fragment.charStart) && fragment.charStart >= 0 &&
    Number.isSafeInteger(fragment.charEnd) && fragment.charEnd > fragment.charStart &&
    Number.isSafeInteger(fragment.messageCharacters) && fragment.charEnd <= fragment.messageCharacters &&
    typeof fragment.content === 'string' && fragment.content.length === fragment.charEnd - fragment.charStart &&
    fragment.content.length <= historyBatchLimits.maxMessageCharacters && digest(fragment.content) === fragment.contentSha256 &&
    sha.test(fragment.fullMessageSha256 || '') && sha.test(fragment.unitSha256 || '') && Array.isArray(fragment.unitFields) &&
    new Set(fragment.unitFields).size === fragment.unitFields.length && fragment.unitFields.includes('content') &&
    fragment.unitMetadata?.index === fragment.messageIndex && fragment.unitMetadata?.message_id === fragment.messageId &&
    fragment.unitMetadata?.role === fragment.role && !Object.hasOwn(fragment.unitMetadata, 'content') &&
    JSON.stringify(Object.keys(fragment.unitMetadata)) === JSON.stringify(fragment.unitFields.filter(key => key !== 'content'));
}
const partFits = part => part.fragments.length <= historyBatchLimits.maxMessages &&
  part.fragments.reduce((n, fragment) => n + fragment.content.length, part.summary.length) <= historyBatchLimits.maxCharacters &&
  JSON.stringify(part).length <= historyBatchLimits.maxPayloadJsonCharacters &&
  Buffer.byteLength(JSON.stringify(part)) <= historyBatchLimits.maxFrameBytes;

// Internal planning contract only. The caller MUST authenticate the snapshot envelope
// before calling this function. Hash/page checks do not authenticate a producer.
// This module does not perform I/O, create credentials, write notes, or invoke tools.
export function planHistoryBatch(input, { summary, structured, now = Date.now() } = {}) {
  const snapshot = clone(input);
  validateSnapshot(snapshot, now);
  const items = clone(validateStructured(structured, snapshot.units));
  if (typeof summary !== 'string' || !summary.trim() || summary.length > historyBatchLimits.maxSummaryCharacters) invalid('摘要不能为空或超过原有限额。');
  const global = { conversationId: snapshot.conversation_id, branchId: snapshot.branch, snapshotId: snapshot.snapshot_id,
    transcriptSha256: snapshot.transcript_sha256, pagesSha256: jsonHash(snapshot.pages),
    snapshotPayloadSha256: jsonHash(snapshot), issuedAt: snapshot.issued_at, expiresAt: snapshot.expires_at,
    messageCount: snapshot.units.length, textCharacters: snapshot.units.reduce((n, unit) => n + unit.content.length, 0),
    coverage: snapshot.coverage, limitations: ['仅含已授权的当前可见分支正文；隐藏分支、隐藏推理和附件字节未读取。', ...(snapshot.warnings || [])] };
  const batchId = jsonHash({ version: 1, global, summary, structured: structured?.version === 2 ? structured : items, limits: historyBatchLimits });
  const parts = [];
  let current = null;
  const startPart = point => ({ version: 1, batchId, global, title: snapshot.title, summary,
    partId: '0'.repeat(64), requestId: 'history_part_' + '0'.repeat(64), partIndex: 999999999999999,
    partCount: 999999999999999, range: { start: point, end: point }, fragments: [] });
  for (const unit of snapshot.units) {
    let offset = 0;
    while (offset < unit.content.length) {
      current ??= startPart({ message: unit.index, offset });
      const room = historyBatchLimits.maxCharacters - summary.length - current.fragments.reduce((n, fragment) => n + fragment.content.length, 0);
      let length = Math.min(historyBatchLimits.maxMessageCharacters, room, unit.content.length - offset);
      let candidate;
      while (length > 0) {
        const end = boundary(unit.content, offset + length);
        if (end === offset) break;
        const fragment = fragmentFor(unit, offset, end);
        candidate = { ...current, range: { ...current.range, end: fragmentEnd(fragment) }, fragments: [...current.fragments, fragment] };
        if (partFits(candidate)) break;
        candidate = null;
        length = Math.floor(length / 2);
      }
      if (!candidate) {
        if (!current.fragments.length) invalid('单个分片的消息元数据超过原有限额，不能截断来源。', 'CHATGPT_BATCH_METADATA_LIMIT');
        parts.push(current); current = null; continue;
      }
      current = candidate;
      offset = current.fragments.at(-1).charEnd;
      if (current.fragments.length === historyBatchLimits.maxMessages || room === current.fragments.at(-1).content.length) {
        parts.push(current); current = null;
      }
    }
  }
  if (current) parts.push(current);
  for (const [index, part] of parts.entries()) {
    part.partIndex = index; part.partCount = parts.length;
    part.partId = jsonHash([batchId, index, parts.length, part.range, part.fragments]);
    part.requestId = 'history_part_' + part.partId;
    if (!partFits(part)) invalid('分片超过原有限额。', 'CHATGPT_BATCH_METADATA_LIMIT');
  }
  const deferredStructured = items.map(item => ({ item, status: 'deferred_not_persisted',
    sourceLocations: item.sourceMessageIds.map(messageId => ({ messageId, parts: parts.filter(part =>
      part.fragments.some(fragment => fragment.messageId === messageId)).map(part => ({ partId: part.partId, partIndex: part.partIndex,
        ranges: part.fragments.filter(fragment => fragment.messageId === messageId).map(fragment => ({ start: fragment.charStart, end: fragment.charEnd })) })) })) }));
  const payloadBytes = Buffer.byteLength(JSON.stringify(snapshot));
  return freeze({ version: 1, batchId, global, parts, deferredStructured,
    ...(structured?.version === 2 ? { structureInput: structured } : {}),
    manifestSha256: jsonHash({ parts, deferredStructured }),
    execution: { status: 'planning_only', persisted: false, storageContract: 'independent_batch_parts_required',
      cumulativeSyncSupported: false, authenticatedTransportRequired: true },
    transport: { protocol: 1, fullSnapshotPayloadBytes: payloadBytes, maxFrameBytes: historyBatchLimits.maxFrameBytes,
      fullSnapshotBlocked: payloadBytes > historyBatchLimits.maxFrameBytes,
      status: payloadBytes > historyBatchLimits.maxFrameBytes ? 'blocked_by_existing_full_snapshot_frame' : 'signed_envelope_frame_measurement_required',
      notice: '现有 v1 仍传完整快照；分片规划不改变 2 MiB 帧限制或五分钟有效期。' },
    summary: { partCount: parts.length, messageCount: global.messageCount, textCharacters: global.textCharacters,
      transcriptSha256: global.transcriptSha256, structuredItems: items.length, structuredPersisted: false } });
}

function checkPlan(plan) {
  if (plan?.version !== 1 || !Array.isArray(plan.parts) || !plan.parts.length || !Array.isArray(plan.deferredStructured) ||
    !sha.test(plan.batchId || '') || jsonHash({ parts: plan.parts, deferredStructured: plan.deferredStructured }) !== plan.manifestSha256) invalid('分片计划已变化。', 'CHATGPT_BATCH_PLAN_HASH');
  let end = { message: 0, offset: 0 }, active = null;
  const units = [];
  for (const [index, part] of plan.parts.entries()) {
    if (part.version !== 1 || part.batchId !== plan.batchId || jsonHash(part.global) !== jsonHash(plan.global) ||
      part.partIndex !== index || part.partCount !== plan.parts.length || !equal(end, part.range?.start) || !partFits(part) ||
      part.partId !== jsonHash([plan.batchId, index, plan.parts.length, part.range, part.fragments]) ||
      part.requestId !== 'history_part_' + part.partId || !part.fragments.length) invalid('分片身份、顺序或范围无法核对。', 'CHATGPT_BATCH_PLAN_HASH');
    for (const fragment of part.fragments) {
      if (!fragmentValid(fragment) || !equal(end, { message: fragment.messageIndex, offset: fragment.charStart })) invalid('消息片段不连续或摘要不一致。', 'CHATGPT_BATCH_PLAN_HASH');
      if (!active) active = { fragment, content: '' };
      else if (fragment.messageId !== active.fragment.messageId || fragment.unitSha256 !== active.fragment.unitSha256 ||
        fragment.fullMessageSha256 !== active.fragment.fullMessageSha256 || fragment.messageCharacters !== active.fragment.messageCharacters ||
        jsonHash(fragment.unitFields) !== jsonHash(active.fragment.unitFields) || jsonHash(fragment.unitMetadata) !== jsonHash(active.fragment.unitMetadata)) invalid('跨分片消息身份变化。', 'CHATGPT_BATCH_PLAN_HASH');
      active.content += fragment.content;
      end = fragmentEnd(fragment);
      if (end.offset === 0) {
        const unit = unitFrom(active.fragment, active.content);
        if (digest(active.content) !== fragment.fullMessageSha256 || jsonHash(unit) !== fragment.unitSha256) invalid('完整原消息无法重建。', 'CHATGPT_BATCH_PLAN_HASH');
        units.push(unit); active = null;
      }
    }
    if (!equal(end, part.range.end)) invalid('分片末尾范围不一致。', 'CHATGPT_BATCH_PLAN_HASH');
  }
  if (active || !equal(end, { message: plan.global.messageCount, offset: 0 }) ||
    units.reduce((n, unit) => n + unit.content.length, 0) !== plan.global.textCharacters ||
    new Set(units.map(unit => unit.message_id)).size !== units.length || jsonHash(units) !== plan.global.transcriptSha256) invalid('分片重建没有覆盖完整快照。', 'CHATGPT_BATCH_PLAN_HASH');
}
const receiptBound = (receipt, part) => receipt && accepted.has(receipt.status) &&
  receipt.batchId === part.batchId && receipt.partId === part.partId && receipt.partIndex === part.partIndex &&
  receipt.partCount === part.partCount && receipt.requestId === part.requestId && receipt.partSha256 === jsonHash(part) &&
  typeof receipt.noteId === 'string' && id.test(receipt.noteId);

// The callback is mandatory and must be provided by the service, never by MCP input.
// It must freshly read the managed part and its durable receipt from disk/SQLite.
// A boolean, saved status, or historical receipt alone cannot establish completeness.
export async function verifyHistoryBatchReceipts(plan, attempts, { verifyPersistedPart } = {}) {
  checkPlan(plan);
  if (!Array.isArray(attempts) || typeof verifyPersistedPart !== 'function') invalid('批次核验需要服务端实际持久化读回。', 'CHATGPT_BATCH_READBACK_REQUIRED');
  const verified = new Set(), issues = [], seen = new Set(), noteIds = new Map();
  let retries = 0, failedAttempts = 0;
  for (const attempt of attempts) {
    const part = plan.parts.find(value => value.partId === attempt?.partId);
    if (!part || !receiptBound(attempt, part)) {
      failedAttempts++;
      issues.push({ partIndex: part?.partIndex ?? null, code: 'receipt_binding_or_status_invalid' }); continue;
    }
    if (noteIds.has(part.partId) && noteIds.get(part.partId) !== attempt.noteId) {
      issues.push({ partIndex: part.partIndex, code: 'part_storage_identity_conflict' }); continue;
    }
    noteIds.set(part.partId, attempt.noteId);
    const retryKey = jsonHash([attempt.partId, attempt.requestId, attempt.noteId]);
    if (seen.has(retryKey)) { retries++; continue; }
    let result;
    try { result = await verifyPersistedPart({ partId: part.partId, requestId: part.requestId, noteId: attempt.noteId }); }
    catch { issues.push({ partIndex: part.partIndex, code: 'persisted_readback_failed' }); continue; }
    if (!result || result.persistence?.method !== 'fresh_disk_and_sqlite_readback' || !receiptBound(result.receipt, part) ||
      result.receipt.noteId !== attempt.noteId || result.part?.partId !== part.partId || jsonHash(result.part) !== jsonHash(part) ||
      typeof result.raw !== 'string' || digest(result.raw) !== result.receipt.rawSha256 ||
      result.persistence.rawSha256 !== result.receipt.rawSha256) {
      issues.push({ partIndex: part.partIndex, code: 'persisted_payload_or_receipt_mismatch' }); continue;
    }
    seen.add(retryKey);
    verified.add(part.partIndex);
  }
  const missingParts = plan.parts.filter(part => !verified.has(part.partIndex)).map(part => part.partIndex);
  const textComplete = !missingParts.length && !issues.length;
  const complete = textComplete && plan.deferredStructured.length === 0;
  return { version: 1, batchId: plan.batchId,
    status: complete ? 'verified' : textComplete ? 'text_verified_structure_pending' : 'incomplete', complete, textComplete,
    method: 'all_parts_fresh_disk_and_sqlite_readback', expectedParts: plan.parts.length,
    verifiedParts: verified.size, duplicateRetries: retries, failedAttempts, missingParts, issues,
    transcriptSha256: plan.global.transcriptSha256, scope: 'authorized_visible_branch_text_only',
    structured: { status: plan.deferredStructured.length ? 'deferred_not_persisted' : 'none',
      expectedItems: plan.deferredStructured.length, persistedItems: 0, complete: plan.deferredStructured.length === 0 },
    notice: '正文分片核验不代表结构化候选已入库、事实已核验或附件与隐藏分支已读取。' };
}
