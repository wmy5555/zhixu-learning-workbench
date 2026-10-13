import { parseSourceFile } from './source-exchange.mjs';

const sourceFields = ['platform', 'author', 'url', 'date', 'locator', 'topic'];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const iosCapabilities = Object.freeze({ sources: true, files: true, history: true, backup: true,
  learning: false, onboarding: false, ai: false, embedding: false, search: false, structure: false, sync: false });
function invalid(message) { throw Object.assign(new Error(message), { code: 'VALIDATION' }); }
function valueText(value, label, max, { empty = false } = {}) {
  if (typeof value !== 'string' || !empty && !value.trim() || value.includes('\0')
    || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
    || value.length > max || new TextEncoder().encode(value).length > max) invalid(`${label}格式无效或超过上限。`);
  return value;
}
export function sourceInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['title', 'body', 'meta', 'id', 'expectedHash'].includes(key))) invalid('原文包含不支持的字段。');
  const body = valueText(input.body, '原文', 128 * 1024);
  const title = input.title?.trim() ? valueText(input.title, '标题', 800) : [...body.replace(/\s+/g, ' ').trim()].slice(0, 36).join('');
  if (title.length > 200 || title !== title.trim() || /[\u0000-\u001f\u007f-\u009f]/u.test(title)) invalid('标题最多 200 个字符，不能包含控制字符或首尾空白。');
  const supplied = input.meta || {};
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied) || Object.keys(supplied).some(key => !sourceFields.includes(key))) invalid('来源字段无效。');
  const meta = Object.fromEntries(sourceFields.map(key => {
    const value = valueText(supplied[key] ?? '', key, ['url', 'locator'].includes(key) ? 8192 : 800, { empty: true });
    if (value.length > (['url', 'locator'].includes(key) ? 2048 : 200)) invalid('来源字段超过长度上限。');
    return [key, value];
  }));
  if (Object.values(meta).some(value => /[\u0000-\u001f\u007f-\u009f]/u.test(value) || value !== value.trim())) invalid('来源信息不能包含换行、控制字符或首尾空白。');
  if (meta.url) {
    let url; try { url = new URL(meta.url); } catch { invalid('来源地址应为完整 HTTP/HTTPS 网址。'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) invalid('来源地址不支持这种协议或凭据。');
  }
  const output = { title, body, meta };
  if (input.id !== undefined) {
    if (!uuid.test(input.id) || !uuid.test(input.expectedHash)) invalid('原文身份或当前版本无效。');
    Object.assign(output, { id: input.id, expectedHash: input.expectedHash });
  } else if (input.expectedHash !== undefined) invalid('新资料不能携带旧版本。');
  return output;
}

// A failed/unknown native commit retains the exact request ID for the same intent.
// A confirmed success releases it, so an intentional new capture can create a new source.
export function createIOSClient(plugin, { randomUUID = () => crypto.randomUUID() } = {}) {
  for (const name of ['list', 'read', 'save', 'history', 'restoreVersion', 'pickSource', 'exportSource', 'exportBackup', 'previewBackup', 'restoreBackup']) if (typeof plugin?.[name] !== 'function') invalid(`缺少 iOS 本地接口：${name}`);
  let tail = Promise.resolve();
  const pending = new Map();
  const serialize = operation => { const next = tail.then(operation); tail = next.catch(() => {}); return next; };
  function mutation(name, payload) {
    const captured = structuredClone(payload);
    const intent = `${name}:${JSON.stringify(captured)}`;
    if (!pending.has(intent) && pending.size >= 32) invalid('未确认的保存请求过多，请先核对现有保存结果。');
    const requestId = pending.get(intent) || randomUUID();
    pending.set(intent, requestId);
    return serialize(async () => {
      try {
        const result = await plugin[name]({ ...captured, requestId });
        pending.delete(intent);
        return result;
      } catch (error) {
        if (['PREVIEW_EXPIRED', 'CONFLICT', 'INVALID', 'VALIDATION', 'NOT_FOUND', 'REQUEST_CONFLICT'].includes(error?.code)) pending.delete(intent);
        throw error;
      }
    });
  }
  return Object.freeze({
    capabilities: iosCapabilities,
    list: () => serialize(() => plugin.list({})),
    read: id => { if (!uuid.test(id)) invalid('原文身份无效。'); return serialize(() => plugin.read({ id })); },
    save: input => mutation('save', sourceInput(input)),
    history: id => { if (!uuid.test(id)) invalid('原文身份无效。'); return serialize(() => plugin.history({ id })); },
    restoreVersion: input => {
      if (!input || Object.keys(input).sort().join(',') !== 'expectedHash,id,versionId' || ![input.id, input.versionId, input.expectedHash].every(value => typeof value === 'string' && uuid.test(value))) invalid('恢复版本参数无效。');
      return mutation('restoreVersion', input);
    },
    pickSource: () => serialize(() => plugin.pickSource({})),
    exportSource: id => {
      if (!uuid.test(id)) invalid('原文身份无效。');
      return serialize(async () => {
        const { note } = await plugin.read({ id });
        const source = Object.fromEntries(sourceFields.map(key => [key, note.meta?.[key] || '']));
        parseSourceFile({ name: 'source.md', text: `---\n${JSON.stringify({ format: 'zhixu-source-exchange', version: 1, title: note.title, source })}\n---\n${note.body}` });
        return plugin.exportSource({ id, expectedHash: note.hash });
      });
    },
    exportBackup: () => serialize(() => plugin.exportBackup({})),
    rebuildIndex: () => serialize(() => plugin.rebuildIndex({})),
    previewBackup: () => serialize(() => plugin.previewBackup({})),
    restoreBackup: token => { if (!uuid.test(token)) invalid('恢复预览凭据无效。'); return mutation('restoreBackup', { token }); },
    pending: () => pending.size,
  });
}
