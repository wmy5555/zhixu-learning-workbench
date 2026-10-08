// Browser-safe helpers for the frozen learning module. Versions are opaque UUIDs.
export function fail(message, code = 'INVALID', status = 400) {
  const error = new Error(message); Object.assign(error, { code, status }); throw error;
}
export function randomUUID() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) fail('安全随机数暂不可用，请重新打开应用。', 'LOCAL_STORAGE_FAILED');
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const text = [...bytes].map(n => n.toString(16).padStart(2, '0')).join('');
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}
// Used only to identify an AI misconception in the original grade path, which
// Android always rejects. This is not a content checksum or security primitive.
export function hash(value) {
  let code = 2166136261;
  for (const point of String(value)) { code ^= point.codePointAt(0); code = Math.imul(code, 16777619); }
  return `portable-${(code >>> 0).toString(16).padStart(8, '0')}`;
}
export const clone = value => structuredClone(value);
export const learningLimits = Object.freeze({ notes: 200, snapshots: 1000, bodyBytes: 128 * 1024, recordsBytes: 8 * 1024 * 1024, stateBytes: 16 * 1024 * 1024, requestId: 128 });
const invalidKeys = new Set(['__proto__', 'prototype', 'constructor']);
export function jsonObject(value, label = '数据') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label}应为键值对象。`);
  return value;
}
export function jsonValue(value, depth = 0) {
  if (depth > 24) fail('数据层级过深。', 'LIMIT_REACHED');
  if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value === 'string') { text(value, '文本', learningLimits.bodyBytes, { empty: true }); return; }
  if (Array.isArray(value)) { if (value.length > 2000) fail('列表项过多。', 'LIMIT_REACHED'); for (const item of value) jsonValue(item, depth + 1); return; }
  jsonObject(value);
  const entries = Object.entries(value);
  if (entries.length > 2000) fail('数据项过多。', 'LIMIT_REACHED');
  for (const [key, item] of entries) { if (invalidKeys.has(key) || !key || key.length > 256) fail('数据包含无效字段。'); jsonValue(item, depth + 1); }
}
export function text(value, label, maxBytes = 1024, { empty = false } = {}) {
  if (typeof value !== 'string' || !empty && !value.trim() || value.includes('\0') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) fail(`${label}格式无效。`);
  if (value.length > maxBytes || new TextEncoder().encode(value).length > maxBytes) fail(`${label}过长。`, 'LIMIT_REACHED');
  return value;
}
export function inputObject(value, allowed, label = '请求') {
  jsonObject(value, label); jsonValue(value);
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(`${label}包含不支持的字段。`);
  return value;
}
export const idText = value => text(value, '条目标识', 256);
export function titleText(value) { text(value, '标题', 800); if (value.length > 200) fail('标题最多 200 个字符。', 'LIMIT_REACHED'); if (/[\u0000-\u001f\u007f-\u009f]/u.test(value)) fail('标题不能包含控制字符。'); return value; }
export function strings(value, label, max = 200) {
  if (!Array.isArray(value) || value.length > max) fail(`${label}应为有限文本列表。`);
  for (const item of value) text(item, label, 256);
  return [...new Set(value)];
}
export function validateNote(note, { sourceOnly = false, summary = false, persisted = false } = {}) {
  inputObject(note, persisted ? ['id', 'kind', 'title', 'body', 'hash', 'meta'] : ['id', 'kind', 'title', 'body', 'hash', 'path', 'meta', 'createdAt', 'updatedAt', 'limitations', 'children', 'structure', 'titleGeneration']);
  idText(note.id); if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(note.id)) fail('条目标识应为 UUID。');
  text(note.hash, '版本标识', 256);
  if (!persisted && sourceOnly) {
    // LocalSourceStore's existing source contract counts Unicode code points,
    // so 200 emoji are valid even though they occupy 400 UTF-16 code units.
    // Preserve that original title; new learning notes keep their stricter cap.
    text(note.title, '标题', 800);
    if ([...note.title].length > 200 || /[\u0000-\u001f\u007f-\u009f]/u.test(note.title)) fail('原文标题格式无效。');
  } else titleText(note.title);
  if (!summary || note.body !== undefined) text(note.body, '正文', learningLimits.bodyBytes);
  if (!['source', 'knowledge', 'topic', 'mistake'].includes(note.kind) || sourceOnly && note.kind !== 'source') fail('条目类型无效。');
  jsonObject(note.meta, '条目属性'); jsonValue(note.meta);
  for (const key of ['stage', 'depth', 'privacy', 'claimType', 'correctionState', 'processKey', 'reviewAfter', 'supersededBy', 'confirmedAt']) if (note.meta[key] !== undefined && note.meta[key] !== null) text(note.meta[key], key, 1024);
  if (note.meta.stage !== undefined && !['reference', 'candidate', 'learning', 'integrated', 'core', 'retired'].includes(note.meta.stage)) fail('学习阶段无效。');
  if (note.meta.depth !== undefined && !['aware', 'find', 'explain', 'apply'].includes(note.meta.depth)) fail('学习目标无效。');
  if (note.meta.privacy !== undefined && !['local', 'cloud'].includes(note.meta.privacy)) fail('隐私范围无效。');
  for (const key of ['noteIds', 'prerequisites', 'researchLimitations', 'sessions']) if (note.meta[key] !== undefined) strings(note.meta[key], key, key === 'noteIds' ? 500 : key === 'sessions' ? 1000 : 100);
  for (const key of ['paused', 'userEdited', 'userStructured', 'demo', 'practice']) if (note.meta[key] !== undefined && typeof note.meta[key] !== 'boolean') fail(`${key}应为开关值。`);
  if (note.meta.reviewAfter && !Number.isFinite(Date.parse(note.meta.reviewAfter))) fail('核验期限无效。');
  if (note.meta.sources !== undefined) {
    if (!Array.isArray(note.meta.sources) || note.meta.sources.length > 100) fail('来源引用格式无效。');
    for (const ref of note.meta.sources) { jsonObject(ref, '来源引用'); idText(ref.id); text(ref.role, '来源角色', 64); if (ref.hash !== undefined) text(ref.hash, '来源版本', 256); }
  }
  return note;
}

export function createMemoryStore(state, sources, now) {
  const external = new Map(sources.map(note => [note.id, clone(note)]));
  let transaction = null;
  const current = id => state.notes.find(n => n.id === id) || external.get(id);
  const present = note => ({ ...clone(note), path: note.path || `learning/${note.kind}/${note.id}.md`, ...(note.meta.createdAt ? { createdAt: note.meta.createdAt } : {}), ...(note.meta.updatedAt ? { updatedAt: note.meta.updatedAt } : {}) });
  const store = {
    scan() {},
    list() { return [...external.values(), ...state.notes].map(present); },
    row(id) { return current(id) ? clone(current(id)) : null; },
    read(id) { const note = current(id); if (!note) fail('条目不存在。', 'NOT_FOUND', 404); return present(note); },
    get(namespace, key, fallback) { return clone(Object.hasOwn(state.records[namespace] || {}, key) ? state.records[namespace][key] : fallback); },
    records(namespace) { return clone(Object.values(state.records[namespace] || {})); },
    put(namespace, key, value) {
      // Mirror Store's JSON persistence: optional undefined fields are omitted.
      value = JSON.parse(JSON.stringify(value));
      idText(namespace); idText(key); jsonValue(value);
      if (invalidKeys.has(namespace) || invalidKeys.has(key)) fail('记录字段无效。');
      state.records[namespace] ||= {}; state.records[namespace][key] = clone(value); return clone(value);
    },
    create({ id = randomUUID(), kind = 'knowledge', title, body, meta = {} }) {
      if (current(id)) fail('条目已存在。', 'CONFLICT', 409);
      if (state.notes.length >= learningLimits.notes) fail('手机最多保存 200 条学习内容，请先导出备份。', 'LIMIT_REACHED');
      const timestamp = now(), note = { id, kind, title, body, hash: randomUUID(),
        meta: { ...clone(meta), id, kind, title, createdAt: timestamp, updatedAt: timestamp } };
      validateNote(note, { persisted: true }); state.notes.push(note); return present(note);
    },
    update(id, { title, body, meta = {}, expectedHash }) {
      const note = store.read(id);
      if (external.has(id)) fail('正式原文请通过原文编辑入口保存。', 'ANDROID_UNAVAILABLE', 409);
      if (!expectedHash || expectedHash !== note.hash) fail('内容已发生变化，请刷新后合并修改。', 'CONFLICT', 409);
      const safeMeta = Object.fromEntries(Object.entries(meta).filter(([key]) => !['id', 'kind', 'title', 'createdAt', 'updatedAt'].includes(key)));
      const timestamp = now(), next = { id: note.id, kind: note.kind, title: title ?? note.title, body: body ?? note.body, hash: randomUUID(),
        meta: { ...note.meta, ...clone(safeMeta), title: title ?? note.title, updatedAt: timestamp } };
      validateNote(next, { persisted: true }); state.notes[state.notes.findIndex(item => item.id === id)] = next; return present(next);
    },
    managedLinksPreview(id) {
      const n = store.read(id);
      // Opaque mobile version identifiers cannot validate the desktop SHA-256
      // managed block. Preserve every byte and explicitly expose the limitation.
      return { id, path: n.path, expectedHash: n.hash, before: n.body, body: n.body, meta: {}, changed: false,
        conflict: '手机端保留已有链接区与正文；自动链接同步暂未接入，请在电脑端核对后更新。', supported: false };
    },
    syncManagedLinks() { fail('手机端尚未接入自动链接同步，原文已保留。', 'ANDROID_UNAVAILABLE', 409); },
    db: { exec(command) {
      if (command === 'BEGIN IMMEDIATE') { if (transaction) fail('重复事务。'); transaction = clone(state); }
      else if (command === 'COMMIT') transaction = null;
      else if (command === 'ROLLBACK' && transaction) { Object.assign(state, transaction); transaction = null; }
      else fail('不支持的事务命令。');
    } },
  };
  return store;
}
