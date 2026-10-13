// Phase 5A: a data-only source reconciliation protocol. No transport or live-store writes.
export const syncLimits = Object.freeze({ events: 2000, sources: 100, replicas: 32, batchEvents: 100, batchBytes: 4 * 1024 * 1024, stateBytes: 32 * 1024 * 1024 });
const FORMAT = 'zhixu-source-sync', UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const FIELDS = ['platform', 'author', 'url', 'date', 'locator', 'topic'];
const encoder = new TextEncoder();
// Match Android Character.isWhitespace || Character.isSpaceChar, not JS trim (BOM/NEL differ).
const blankBody = /^[\u0009-\u000d\u001c-\u0020\u00a0\u1680\u2000-\u200a\u2028-\u2029\u202f\u205f\u3000]*$/u;
function fail(message, code = 'SYNC_INVALID') { throw Object.assign(new Error(message), { code }); }
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.getOwnPropertySymbols(value).length || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail('同步字段无效。');
}
function uuid(value) { if (typeof value !== 'string' || !UUID.test(value)) fail('同步身份无效。'); return value; }
function integer(value, min = 0) { if (!Number.isSafeInteger(value) || value < min) fail('同步序号无效。'); return value; }
function text(value, max, singleLine = false) {
  if (typeof value !== 'string' || !value.isWellFormed() || encoder.encode(value).length > max || singleLine && /[\r\n\x00-\x1f\x7f]/.test(value)) fail('同步文本无效或超限。');
  return value;
}
function source(value) {
  object(value, ['title', 'body', 'source']); object(value.source, FIELDS);
  const title = text(value.title, 800, true), body = text(value.body, 128 * 1024);
  // Preserve valid legacy titles read by Android; this does not relax its new-save/export limit.
  if (!title || [...title].length > 200 || title !== title.trim()) fail('同步原文标题无效。');
  if (body.includes('\u0000') || blankBody.test(body)) fail('同步原文正文不能为空白或包含 NUL。');
  const result = { title, body, source: {} };
  for (const key of FIELDS) result.source[key] = text(value.source[key], 8192, true);
  // Source URLs are inert provenance here; the eventual store adapter must validate its own format.
  return result;
}
function event(value) {
  object(value, ['id', 'replicaId', 'sequence', 'sourceId', 'parents', 'operation', 'value']);
  const replicaId = uuid(value.replicaId), sequence = integer(value.sequence, 1), sourceId = uuid(value.sourceId);
  if (value.id !== `${replicaId}:${sequence}` || !Array.isArray(value.parents) || value.parents.length > syncLimits.replicas
    || new Set(value.parents).size !== value.parents.length) fail('同步版本关系无效。');
  const parents = value.parents.map(parent => { if (typeof parent !== 'string' || !/^[a-f0-9-]{36}:[1-9][0-9]*$/.test(parent)) fail('同步父版本无效。'); return parent; }).sort();
  if (!['put', 'delete'].includes(value.operation) || value.operation === 'delete' && value.value !== null) fail('同步操作无效。');
  return { id: value.id, replicaId, sequence, sourceId, parents, operation: value.operation, value: value.operation === 'put' ? source(value.value) : null };
}
function header(value, keys) {
  object(value, keys);
  if (value.format !== FORMAT || value.version !== 1 || !['formal', 'practice'].includes(value.context)) fail('同步协议版本或资料库无效。');
  uuid(value.libraryId);
}
function size(value, limit) { if (encoder.encode(JSON.stringify(value)).length > limit) fail('同步记录超过容量限制；不能丢弃历史或墓碑。', 'SYNC_LIMIT'); }
function indexEvents(events) {
  if (!Array.isArray(events) || events.length > syncLimits.events) fail('同步历史超限。', 'SYNC_LIMIT');
  const byId = new Map(), vector = {}, heads = new Map(), authored = new Map();
  for (const raw of events) {
    const item = event(raw);
    if (byId.has(item.id)) fail('同步历史中有重复身份。');
    if (item.sequence !== (vector[item.replicaId] || 0) + 1) fail('同步增量缺少前序记录。', 'SYNC_GAP');
    for (const parent of item.parents) if (!byId.has(parent) || byId.get(parent).sourceId !== item.sourceId) fail('同步增量缺少父版本或引用其他原文。', 'SYNC_GAP');
    const current = heads.get(item.sourceId) || new Set();
    // Remove every ancestor, including ancestors of another still-concurrent head.
    const ancestors = new Set(), visit = [...item.parents];
    while (visit.length) { const id = visit.pop(); if (ancestors.has(id)) continue; ancestors.add(id); visit.push(...byId.get(id).parents); }
    const authorKey = `${item.replicaId}/${item.sourceId}`, previous = authored.get(authorKey);
    if (previous && !ancestors.has(previous)) fail('同一设备的原文增量未承接旧版本。', 'SYNC_GAP');
    for (const id of ancestors) current.delete(id);
    current.add(item.id); heads.set(item.sourceId, current);
    byId.set(item.id, item); vector[item.replicaId] = item.sequence; authored.set(authorKey, item.id);
    if (Object.keys(vector).length > syncLimits.replicas || heads.size > syncLimits.sources) fail('同步身份数量超限。', 'SYNC_LIMIT');
  }
  return { byId, vector, heads };
}
export function createSyncState({ replicaId, libraryId, context = 'formal' }) {
  const state = { format: FORMAT, version: 1, replicaId: uuid(replicaId), libraryId: uuid(libraryId), context, events: [] };
  return validateSyncState(state);
}
export function validateSyncState(value) {
  header(value, ['format', 'version', 'replicaId', 'libraryId', 'context', 'events']); uuid(value.replicaId);
  const indexed = indexEvents(value.events);
  const result = { format: FORMAT, version: 1, replicaId: value.replicaId, libraryId: value.libraryId, context: value.context, events: [...indexed.byId.values()] };
  size(result, syncLimits.stateBytes); return result;
}
export function syncVector(state) { return indexEvents(validateSyncState(state).events).vector; }
export function inspectSyncSource(state, sourceId) {
  uuid(sourceId); const { byId, heads } = indexEvents(validateSyncState(state).events);
  const versions = [...(heads.get(sourceId) || [])].sort().map(id => byId.get(id));
  // Concurrent identical text still needs resolution: authorship/causality is not inferred from text.
  return { sourceId, status: !versions.length ? 'absent' : versions.length > 1 ? 'conflict' : versions[0].operation === 'delete' ? 'deleted' : 'present', versions };
}
export function recordSyncChange(state, { sourceId, expectedHeads, operation, value }) {
  const next = validateSyncState(state), view = inspectSyncSource(next, sourceId);
  if (!Array.isArray(expectedHeads) || new Set(expectedHeads).size !== expectedHeads.length
    || JSON.stringify([...expectedHeads].sort()) !== JSON.stringify(view.versions.map(item => item.id))) fail('原文版本已变化，请重新核对所有冲突分支。', 'SYNC_STALE');
  const sequence = (syncVector(next)[next.replicaId] || 0) + 1;
  next.events.push(event({ id: `${next.replicaId}:${sequence}`, replicaId: next.replicaId, sequence, sourceId, parents: expectedHeads, operation, value }));
  // A conflict is resolved only by an explicit new event whose parents cover the exact current heads.
  return validateSyncState(next);
}
function peerVector(value, known) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.keys(value).length > syncLimits.replicas || Object.getOwnPropertySymbols(value).length) fail('同步游标无效。');
  const vector = {};
  for (const [replica, sequence] of Object.entries(value)) { uuid(replica); integer(sequence); vector[replica] = Math.min(sequence, known[replica] || 0); }
  return vector;
}
export function createSyncBatch(state, cursor = {}, { maxEvents = syncLimits.batchEvents } = {}) {
  const current = validateSyncState(state), known = syncVector(current), vector = peerVector(cursor, known);
  integer(maxEvents, 1); if (maxEvents > syncLimits.batchEvents) fail('同步批次数量超限。');
  const batch = { format: FORMAT, version: 1, libraryId: current.libraryId, context: current.context, events: [] };
  for (const item of current.events) {
    if (item.sequence <= (vector[item.replicaId] || 0)) continue;
    const candidate = { ...batch, events: [...batch.events, item] };
    if (encoder.encode(JSON.stringify(candidate)).length > syncLimits.batchBytes) break;
    batch.events.push(item);
    if (batch.events.length === maxEvents) break;
  }
  return batch;
}
export function receiveSyncBatch(state, batch) {
  const current = validateSyncState(state);
  header(batch, ['format', 'version', 'libraryId', 'context', 'events']);
  if (batch.libraryId !== current.libraryId || batch.context !== current.context) fail('同步包不属于当前资料库。', 'SYNC_SCOPE');
  if (!Array.isArray(batch.events) || batch.events.length > syncLimits.batchEvents) fail('同步批次超限。', 'SYNC_LIMIT');
  const incoming = batch.events.map(event); size({ ...batch, events: incoming }, syncLimits.batchBytes);
  const known = indexEvents(current.events).byId;
  let added = 0;
  for (const item of incoming) {
    if (known.has(item.id)) {
      if (JSON.stringify(known.get(item.id)) !== JSON.stringify(item)) fail('相同同步身份包含不同内容。', 'SYNC_ID_REUSED');
      continue;
    }
    // A foreign device may replay our events but cannot originate new ones under our identity.
    if (item.replicaId === current.replicaId) fail('另一端使用了本机同步身份；须重新建立设备身份。', 'SYNC_ID_REUSED');
    current.events.push(item); known.set(item.id, item); added++;
  }
  // All validation completes on a copy; the caller atomically persists this whole result before ACK.
  const next = validateSyncState(current);
  return { state: next, added, cursor: syncVector(next) };
}
