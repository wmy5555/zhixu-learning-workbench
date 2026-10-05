import { randomUUID, createHash } from 'node:crypto';

export const MOBILE_FORMAT = 'zhixu-mobile-sync';
export const MAX_TRANSFER_BYTES = 8 * 1024 * 1024;
const kinds = new Set(['source', 'knowledge', 'mistake', 'topic', 'report']);
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fingerprint = value => createHash('sha256').update(value.replaceAll('\r\n', '\n').trim()).digest('hex');
const sameText = (a, b) => a.title === b.title && a.body === b.body;
function reject(message) { throw new Error(message); }

// The transport never carries settings, credentials, runtime records or file paths.
export function validateTransfer(input) {
  if (!input || input.format !== MOBILE_FORMAT || input.version !== 1 || !Array.isArray(input.notes)
    || input.notes.length > 100 || typeof input.libraryId !== 'string'
    || input.libraryId && !validId(input.libraryId)) reject('手机交换文件格式不正确。');
  if (Buffer.byteLength(JSON.stringify(input)) > MAX_TRANSFER_BYTES) reject('交换文件超过 8 MiB，请缩小选择范围。');
  const ids = new Set(), desktopIds = new Set();
  for (const note of input.notes) {
    if (!note || !validId(note.id) || ids.has(note.id) || !kinds.has(note.kind)
      || typeof note.title !== 'string' || !note.title.trim() || note.title.length > 200
      || typeof note.body !== 'string' || !note.body.trim() || note.body.length > 500000
      || typeof note.dirty !== 'boolean' || typeof note.desktopId !== 'string'
      || typeof note.baseHash !== 'string') reject('交换文件含重复身份或无效资料。');
    ids.add(note.id);
    if (note.desktopId) {
      if (!validId(note.desktopId) || desktopIds.has(note.desktopId) || !validHash(note.baseHash)) reject('电脑资料身份或版本不正确。');
      desktopIds.add(note.desktopId);
    } else if (note.kind !== 'source' || note.baseHash || !note.dirty) reject('手机新资料只能是尚未同步的原始资料。');
    if (note.dirty && note.kind !== 'source') reject('手机只能修改原始资料；学习知识在电脑端维护。');
  }
  return input;
}

export function newSyncState() {
  return { version: 1, libraryId: randomUUID(), bindings: {}, receipts: {} };
}

export function projectNote(note, id = note.id) {
  return { id, desktopId: note.id, kind: note.kind, title: note.title, body: note.body,
    baseHash: note.hash, dirty: false, stage: String(note.meta?.stage || 'reference'),
    privacy: 'local', readOnly: note.kind !== 'source' };
}

export async function exportMobileSnapshot({ api, state, noteIds }) {
  if (!Array.isArray(noteIds) || !noteIds.length || noteIds.length > 100 || noteIds.some(id => !validId(id))) reject('请显式选择 1–100 个资料 ID。');
  const notes = [];
  for (const desktopId of [...new Set(noteIds)]) {
    const note = await api.note(desktopId);
    if (note.meta?.excerptOnly || !kinds.has(note.kind)) reject('此资料不能导出到手机。');
    notes.push(projectNote(note));
  }
  const transfer = validateTransfer({ format: MOBILE_FORMAT, version: 1, libraryId: state.libraryId, notes });
  // Bind only after the entire selection has been read and validated successfully.
  for (const note of notes) state.bindings[note.id] = note.desktopId;
  return transfer;
}

// This uses the existing loopback HTTP API. It neither starts a listener nor opens SQLite.
// Every write retains the server's session, CSRF and expectedHash checks.
export async function applyMobileTransfer({ api, state, transfer, checkpoint = async () => {} }) {
  validateTransfer(transfer);
  if (transfer.libraryId && transfer.libraryId !== state.libraryId) reject('交换文件属于另一知识库，未写入任何资料。');
  if (!transfer.libraryId && transfer.notes.some(note => note.desktopId)) reject('未绑定知识库的文件不能修改电脑资料。');
  const results = [], notes = [];
  for (const incoming of transfer.notes.filter(note => note.dirty)) {
    const bound = state.bindings[incoming.id];
    if (incoming.desktopId && bound !== incoming.desktopId) {
      results.push({ id: incoming.id, status: 'conflict', reason: '资料未通过此交换目录导出，不能修改。' });
      continue;
    }
    const desktopId = incoming.desktopId || bound;
    try {
      let current;
      if (desktopId) {
        current = await api.note(desktopId);
        if (current.kind !== 'source') reject('同步目标不再是原始资料。');
        if (!sameText(current, incoming)) {
          // A missing/deleted or changed desktop note is never recreated or overwritten.
          if (!incoming.desktopId || current.hash !== incoming.baseHash) {
            results.push({ id: incoming.id, status: 'conflict', reason: '电脑版本已改变，保留双方版本。' });
            notes.push(projectNote(current, incoming.id));
            continue;
          }
          current = await api.edit(current.id, { title: incoming.title, body: incoming.body, expectedHash: incoming.baseHash });
        }
      } else {
        // Reject body deduplication against an unrelated source. The existing importer
        // would otherwise append provenance to that source and silently reuse its identity.
        const existing = (await api.sources()).filter(note => fingerprint(note.body) === fingerprint(incoming.body));
        if (existing.length) {
          results.push({ id: incoming.id, status: 'conflict', reason: '电脑已有相同正文，请在电脑端人工确认身份。' });
          continue;
        }
        current = (await api.import({ items: [{ title: incoming.title, body: incoming.body, privacy: 'local',
          platform: '知序 Android 文件同步', locator: incoming.id }], process: false, rejectDuplicates: true })).notes[0];
        state.bindings[incoming.id] = current.id;
      }
      state.receipts[incoming.id] = { desktopId: current.id, hash: current.hash };
      await checkpoint(state); // Persist before acknowledging; interrupted retries are safe.
      results.push({ id: incoming.id, status: 'saved' });
      notes.push(projectNote(current, incoming.id));
    } catch (error) {
      if (error.code === 'CONFLICT' || error.status === 409 || error.code === 'NOT_FOUND' || error.status === 404) {
        results.push({ id: incoming.id, status: 'conflict', reason: '电脑资料已改变或删除，手机版本继续保留。' });
      } else throw error;
    }
  }
  return validateTransfer({ format: MOBILE_FORMAT, version: 1, libraryId: state.libraryId, notes, results });
}
