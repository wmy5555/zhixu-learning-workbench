import { z } from 'zod';
import { conversationOrigin } from './chatgpt-source-metadata.mjs';
import { fail, hash, now } from './store.mjs';
import { readCapturePersisted, assertCaptureRecord, captureVerification, historicalVerification } from './chatgpt-integrity.mjs';

const identifier = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const cursor = z.object({ message: z.number().int().min(0).max(200), offset: z.number().int().min(0).max(120000) }).strict();
export const syncSchema = z.object({
  conversationId: identifier, branchId: identifier, snapshotId: identifier,
  mode: z.enum(['snapshot', 'delta']), complete: z.boolean(),
  baseRevision: z.number().int().min(1).optional(),
  readerEvidence: z.object({
    transcriptSha256: z.string().regex(/^[a-f0-9]{64}$/),
    pages: z.array(z.object({ range: z.object({ start: cursor, end: cursor }).strict(), hasMore: z.boolean() }).strict()).min(1).max(1000),
  }).strict().optional(),
}).strict();
export const structuredSchema = z.object({
  version: z.literal(1),
  items: z.array(z.object({
    id: identifier, title: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(30000),
    type: z.enum(['knowledge', 'conclusion', 'unverified_fact']),
    sourceMessageIds: z.array(identifier).min(1).max(200),
    uncertainties: z.array(z.string().trim().min(1).max(2000)).max(20),
  }).strict()).max(100),
}).strict();

export function validateSync(value) {
  if (!value.sync && (value.structured || value.coverage === 'visible_history' || value.messages.some(m => m.id))) fail('消息编号和结构化导入需要显式提供 sync；旧保存方式仍可使用。', 'CHATGPT_SYNC_INVALID');
  if (!value.sync) return;
  const ids = value.messages.map(m => m.id);
  if (ids.some(id => !identifier.safeParse(id).success) || new Set(ids).size !== ids.length) fail('增量保存需要真实、唯一、稳定的消息编号，不能用位置或内容猜测。', 'CHATGPT_MESSAGE_IDS');
  if (value.sync.complete && (value.sync.mode !== 'snapshot' || value.coverage !== 'visible_history')) fail('只有已读到末尾的可见历史快照可声明完整；增量和当前上下文不能声明完整。', 'CHATGPT_COVERAGE_INVALID');
  if (value.sync.complete && !value.sync.readerEvidence) fail('完整范围声明需要历史读取器的分页范围和快照摘要证据；服务端仍未独立核对网页。', 'CHATGPT_COVERAGE_INVALID');
  const pages = value.sync.readerEvidence?.pages;
  if (pages) {
    const equal = (a, b) => a.message === b.message && a.offset === b.offset;
    const compare = (a, b) => a.message - b.message || a.offset - b.offset;
    let end = { message: 0, offset: 0 };
    for (const [index, page] of pages.entries()) {
      if (!equal(end, page.range.start) || compare(page.range.end, page.range.start) <= 0 ||
        (index < pages.length - 1 && !page.hasMore)) fail('分页范围不连续或页末状态矛盾，不能声明已读到末尾。', 'CHATGPT_COVERAGE_INVALID');
      if (value.sync.complete && [page.range.start, page.range.end].some(point => point.message > value.messages.length ||
        (point.message === value.messages.length ? point.offset !== 0 : point.offset > value.messages[point.message].content.length))) fail('分页范围超出已收到的消息正文，不能声明完整。', 'CHATGPT_COVERAGE_INVALID');
      end = page.range.end;
    }
    if (value.sync.complete && (pages.at(-1).hasMore || !equal(end, { message: value.messages.length, offset: 0 }))) fail('分页证据尚未到收到的消息末尾，不能声明完整。', 'CHATGPT_COVERAGE_INVALID');
  }
  if (value.structured && new Set(value.structured.items.map(item => item.id)).size !== value.structured.items.length) fail('结构化条目编号不得重复。', 'CHATGPT_STRUCTURE_INVALID');
}

export function literalBlock(value) {
  let length = 3;
  for (const match of value.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  const fence = '`'.repeat(length);
  return `${fence}text\n${value}\n${fence}`;
}
const limitation = 'ChatGPT 生成的整理尚未独立核验，不代表用户理解或掌握。';
function candidateBody(item) {
  const type = { knowledge: '知识建议', conclusion: '模型结论', unverified_fact: '待验证事实' }[item.type];
  return [`## ${type}（未经独立核验）`, literalBlock(item.body), '## 来源消息编号', literalBlock(item.sourceMessageIds.join('\n')), '## 不确定性与限制', literalBlock([limitation, ...item.uncertainties].join('\n'))].join('\n\n');
}
function sessionKey(value) { return hash(JSON.stringify([value.sync.conversationId, value.sync.branchId])); }
const sourceId = key => `chatgpt_session_${key}`;
function candidateIdFor(key, snapshot, item) {
  const messageBasis = item.sourceMessageIds.map(id => snapshot.messages.find(message => message.id === id));
  if (messageBasis.some(message => !message)) fail('结构化候选引用了未收到的消息，不能导入。', 'CHATGPT_SOURCE_MESSAGE_MISSING');
  const itemHash = hash(JSON.stringify([item, messageBasis]));
  return `chatgpt_item_${hash(`${key}:${item.id}:${itemHash}`)}`;
}
function ownsPath(store, id) {
  const owns = p => p?.split('/').at(-1)?.toLowerCase() === `${id}.md`;
  return store.list().some(n => owns(n.path)) || store.conflicts.some(c => c.id === id || owns(c.path));
}
function sourceMetadata(state, body) {
  const origin = state.sourceMetadataVersion === 2 ? conversationOrigin(state.snapshot, state.savedAt) : { platform: 'ChatGPT', url: state.snapshot.conversationUrl, author: '', date: '', acquiredAt: state.savedAt,
    locator: `会话分支版本 ${state.revision}；累计 ${state.snapshot.messages.length} 条消息` };
  return { privacy: 'local', stage: 'reference', ...origin, origins: [origin], fingerprint: hash(body.trim()),
    chatgptSync: { version: 1, sessionHash: state.key, revision: state.revision, requestHash: state.requestHash,
      payloadHash: state.payloadHash, snapshot: state.snapshot } };
}
export function checkSource(note, state, render, acceptedRenderers = []) {
  const marker = note.meta.chatgptSync;
  const bodyMatchesKnownTemplate = [render, ...acceptedRenderers].some(template => note.body === template(state.snapshot));
  if (note.kind !== 'source' || note.id !== sourceId(state.key) || marker?.version !== 1 || marker?.sessionHash !== state.key ||
    marker?.revision !== state.revision || marker?.requestHash !== state.requestHash || marker?.payloadHash !== state.payloadHash ||
    note.title !== state.snapshot.title || !bodyMatchesKnownTemplate || note.meta.url !== state.snapshot.conversationUrl ||
    note.meta.privacy !== 'local' || note.meta.stage !== 'reference' || JSON.stringify(marker.snapshot) !== JSON.stringify(state.snapshot) ||
    (state.noteHash && note.hash !== state.noteHash)) fail('原资料已由用户或外部编辑，无法安全更新；请在知序核对并保留编辑。', 'CHATGPT_SOURCE_EDITED', 409);
  // Before the first hash checkpoint, verify every generated metadata field too.
  // Unmanaged user fields may be retained but never establish generated provenance.
  if (!state.noteHash && Object.entries(sourceMetadata(state, note.body)).some(([name, expected]) =>
    JSON.stringify(note.meta[name]) !== JSON.stringify(expected))) {
    fail('原资料的来源信息已由用户或外部编辑，无法安全恢复；请在知序保留编辑。', 'CHATGPT_SOURCE_EDITED', 409);
  }
}

function checkStructuredCandidate(store, state, item, { allowMissing = false, strict = true, persisted = false } = {}) {
  const key = state.key, noteId = sourceId(key);
  const messageBasis = item.sourceMessageIds.map(id => state.snapshot.messages.find(message => message.id === id));
  if (messageBasis.some(message => !message)) fail('结构化条目引用了未保存的消息，不能导入。', 'CHATGPT_SOURCE_MESSAGE_MISSING');
  const itemHash = hash(JSON.stringify([item, messageBasis]));
  const id = `chatgpt_item_${hash(`${key}:${item.id}:${itemHash}`)}`;
  const sourceRevisionFor = () => {
    const provenance = state.candidateSourceRevisions?.[id];
    if (provenance) {
      if (provenance.itemHash !== itemHash || JSON.stringify(provenance.sourceMessageIds) !== JSON.stringify(item.sourceMessageIds) ||
        !Number.isInteger(provenance.sourceRevision) || provenance.sourceRevision < 1 || provenance.sourceRevision > state.revision) {
        fail('结构化候选来源版本无法核对；为保护人工修改，未继续写入。', 'CHATGPT_STRUCTURE_EDITED', 409);
      }
      return provenance.sourceRevision;
    }
    const revisions = store.records('chatgptCaptures').map(record => record.receipt).filter(receipt =>
      receipt?.noteId === sourceId(key) && receipt.importedNoteIds?.includes(id) &&
      Number.isInteger(receipt.syncRevision) && receipt.syncRevision >= 1 && receipt.syncRevision <= state.revision)
      .map(receipt => receipt.syncRevision);
    if (!revisions.length) fail('结构化候选缺少可核对的原始来源版本；为保护数据，未继续写入。', 'CHATGPT_STRUCTURE_EDITED', 409);
    return Math.min(...revisions);
  };
  const row = store.row(id);
  if (!row) {
    if (store.get('deleted', id)) fail('结构化候选已删除，不会自动重新创建。', 'CHATGPT_STRUCTURE_CONFLICT', 409);
    if (ownsPath(store, id)) fail('结构化候选存在文件冲突，不会自动重建。', 'CHATGPT_STRUCTURE_CONFLICT', 409);
    if (store.history(id).length) fail('结构化候选曾经存在但现已缺失，不会自动重新创建。', 'CHATGPT_STRUCTURE_CONFLICT', 409);
    if (allowMissing) {
      const intent = state.candidateWrites?.[id];
      if (intent?.phase !== 'prepared' || intent.itemHash !== itemHash) {
        fail('结构化候选的写入已开始或状态未知但文件缺失，不会猜测并重建。', 'CHATGPT_STRUCTURE_CONFLICT', 409);
      }
      return { id, itemHash, exists: false, sourceRevision: state.revision };
    }
    fail('结构化候选缺失，不能把未完成导入当作成功。', 'CHATGPT_STRUCTURE_UNAVAILABLE', 409);
  }
  const existing = persisted ? readCapturePersisted(store, id) : store.read(id), body = candidateBody(item), marker = existing.meta.chatgptImport;
  if (!strict) {
    if (existing.kind !== 'knowledge' || marker?.sessionHash !== key || marker?.itemHash !== itemHash) {
      fail('结构化条目标记存在冲突，请在知序核对。', 'CHATGPT_STRUCTURE_CONFLICT', 409);
    }
    return { id, itemHash, exists: true, sourceRevision: sourceRevisionFor() };
  }
  const expectedMeta = {
    privacy: 'local', stage: 'candidate', sources: [{ id: noteId, role: 'input' }],
    claimType: 'fact', researchLimitations: [limitation, ...item.uncertainties], generatedBodyHash: hash(body),
    chatgptImport: { version: 1, sessionHash: key, itemId: item.id, itemHash, type: item.type, sourceRevision: sourceRevisionFor(), sourceMessageIds: item.sourceMessageIds },
  };
  if (existing.kind !== 'knowledge' || existing.title !== item.title || existing.body !== body ||
    JSON.stringify(existing.meta) !== JSON.stringify(expectedMeta)) {
    fail('结构化候选已被编辑或标记无法核对；不会覆盖人工内容。', 'CHATGPT_STRUCTURE_EDITED', 409);
  }
  return { id, itemHash, exists: true, sourceRevision: sourceRevisionFor() };
}

export function checkStructuredCandidates(store, state) {
  for (const item of state.snapshot.structured?.items || []) checkStructuredCandidate(store, state, item);
}

export function verifySyncCapture(store, state, render, acceptedRenderers = []) {
  assertCaptureRecord(store, 'chatgptSyncSessions', state.key, state);
  const source = readCapturePersisted(store, sourceId(state.key));
  checkSource(source, state, render, acceptedRenderers);
  const candidates = (state.snapshot.structured?.items || []).map(item => {
    const id = candidateIdFor(state.key, state.snapshot, item);
    let candidate, status = 'verified';
    try { candidate = checkStructuredCandidate(store, state, item, { persisted: true }); }
    catch (error) {
      // Reuse keeps prior user edits; it must never label those contents as the AI input.
      if (error.code !== 'CHATGPT_STRUCTURE_EDITED' || (state.pending && !state.candidateWrites?.[id]?.existing)) throw error;
      candidate = checkStructuredCandidate(store, state, item, { persisted: true, strict: false });
      status = 'preserved_edits';
    }
    const note = readCapturePersisted(store, id);
    return { noteId: id, itemId: item.id, type: item.type, sourceRevision: candidate.sourceRevision,
      sourceMessageIds: item.sourceMessageIds, rawSha256: note.hash, bodySha256: hash(note.body),
      provenanceVerified: status === 'verified', status };
  });
  return captureVerification(state.snapshot, source, candidates, { revision: state.revision, historyVerified: Boolean(state.historyHandoff) });
}

export function verifySyncReceipt(store, receipt, state, render, acceptedRenderers = []) {
  if (!state || receipt.syncRevision > state.revision) fail('保存回执版本无法核对。', 'CHATGPT_CAPTURE_UNVERIFIABLE', 409);
  const source = readCapturePersisted(store, receipt.noteId);
  const storedRevision = source.meta.chatgptSync?.revision;
  const currentRevision = Number.isSafeInteger(storedRevision) && storedRevision > 0 ? storedRevision : null;
  if (!(state.pending && source.hash === state.previousHash)) {
    try { checkSource(source, state, render, acceptedRenderers); }
    catch (error) {
      if (error.code !== 'CHATGPT_SOURCE_EDITED') throw error;
      return historicalVerification(receipt, { currentRevision, pending: state.pending === true });
    }
  }
  const savedSourceHash = receipt.verification?.source?.rawSha256;
  // Undo can restore an earlier number; a later save can reuse that number for different bytes.
  const sameGeneration = typeof savedSourceHash === 'string' && savedSourceHash === source.hash;
  if (receipt.syncRevision === state.revision && currentRevision === state.revision && sameGeneration) {
    for (const id of receipt.importedNoteIds || []) readCapturePersisted(store, id);
    return verifySyncCapture(store, state, render, acceptedRenderers);
  }
  return historicalVerification(receipt, { currentRevision, pending: state.pending === true });
}

function mergeSnapshot(previous, value) {
  if (!previous) {
    if (value.sync.mode !== 'snapshot' || value.sync.baseRevision !== undefined) fail('首次保存必须提供快照，不得携带旧版本。', 'CHATGPT_REVISION_CONFLICT', 409);
    return { snapshot: value, added: value.messages.length, modified: 0 };
  }
  const old = previous.snapshot.messages, incoming = new Map(value.messages.map(m => [m.id, m]));
  const oldIds = new Set(old.map(m => m.id));
  const common = value.messages.filter(m => oldIds.has(m.id)).map(m => m.id);
  if (JSON.stringify(common) !== JSON.stringify(old.filter(m => incoming.has(m.id)).map(m => m.id)) ||
    (value.sync.complete && old.some(m => !incoming.has(m.id)))) fail('消息发生分支、重排或删失；请使用明确的新分支编号保存，不会覆盖旧分支。', 'CHATGPT_BRANCH_CONFLICT', 409);
  let modified = 0;
  const messages = old.map(m => {
    const next = incoming.get(m.id);
    if (!next) return m;
    if (next.role !== m.role) fail('同一消息编号的角色发生变化，无法安全合并。', 'CHATGPT_MESSAGE_CONFLICT', 409);
    if (next.content !== m.content) modified++;
    return next;
  });
  const added = value.messages.filter(m => !oldIds.has(m.id));
  // A partial reading cannot insert messages into an unknown historical position.
  if (!value.sync.complete && added.length && (common.at(-1) !== old.at(-1).id ||
    value.messages.findIndex(m => !oldIds.has(m.id)) < value.messages.findLastIndex(m => oldIds.has(m.id)))) fail('新增消息未接在已保存的末尾之后，顺序无法核对；请包含旧末尾消息或读取完整分支。', 'CHATGPT_BRANCH_CONFLICT', 409);
  messages.push(...added);
  const snapshot = { ...value, messages: value.sync.complete ? value.messages : messages,
    limitations: [...new Set([previous.snapshot.limitations, value.limitations].filter(Boolean))].join('\n'), sync: { ...value.sync, complete: value.sync.complete } };
  if (JSON.stringify(snapshot).length > 1000000 || messages.length > 200 || messages.reduce((n, m) => n + m.content.length, snapshot.summary.length) > 500000) fail('累计会话超过保存上限，请按主题另存资料。', 'CHATGPT_TOO_LARGE', 413);
  return { snapshot, added: added.length, modified };
}

// All persisted inputs are data. This path never invokes a model, fetches a URL, or changes permissions.
export function captureIncremental(store, value, render, { acceptedRenderers = [], historyHandoff, resumePending } = {}) {
  const key = sessionKey(value), noteId = sourceId(key), requestHash = hash(value.requestId);
  const { requestId: _requestId, ...payload } = value;
  const payloadHash = resumePending?.payloadHash || hash(JSON.stringify(payload));
  if (resumePending && (resumePending.requestHash !== requestHash || !/^[a-f0-9]{64}$/.test(payloadHash))) {
    fail('待恢复导入状态无法核对；不会继续写入。', 'CHATGPT_CAPTURE_UNVERIFIABLE', 409);
  }
  store.scan();
  const priorReceipt = store.get('chatgptCaptures', requestHash);
  if (priorReceipt) {
    if (historyHandoff && (priorReceipt.historyHandoff?.referenceHash !== historyHandoff.referenceHash || priorReceipt.historyHandoff?.inputDigest !== historyHandoff.inputDigest)) {
      fail('同一请求编号的历史读取引用或整理内容发生变化。', 'CHATGPT_REQUEST_CONFLICT', 409);
    }
    if (!historyHandoff && priorReceipt.historyHandoff) fail('此请求编号已用于受验证的历史导入，不能改用其他保存路径。', 'CHATGPT_REQUEST_CONFLICT', 409);
    if (priorReceipt.payloadHash !== payloadHash) fail('同一请求编号的内容发生变化。', 'CHATGPT_REQUEST_CONFLICT', 409);
    if (!store.row(priorReceipt.noteId)) fail('已保存原资料已删除或存在冲突，不会自动重建。', 'CHATGPT_CAPTURE_UNAVAILABLE', 409);
    const pending = store.get('chatgptSyncSessions', key);
    const verification = verifySyncReceipt(store, priorReceipt.receipt, pending, render, acceptedRenderers);
    if (pending?.pending && pending.requestHash === requestHash) {
      checkSource(store.read(priorReceipt.noteId), pending, render, acceptedRenderers);
      store.put('chatgptSyncSessions', key, { ...pending, pending: false, noteHash: store.read(priorReceipt.noteId).hash, receipt: priorReceipt.receipt });
    }
    return { ...priorReceipt.receipt, verification, status: 'already_saved', duplicate: true };
  }
  let state = store.get('chatgptSyncSessions', key);
  const recoveringPending = state?.pending === true;
  if (resumePending && (!state?.pending || state.key !== resumePending.key || state.requestHash !== requestHash ||
    state.payloadHash !== payloadHash || state.historyHandoff?.referenceHash !== historyHandoff?.referenceHash ||
    state.historyHandoff?.inputDigest !== historyHandoff?.inputDigest)) {
    fail('历史导入待恢复状态已变化；不会继续写入。', 'CHATGPT_CAPTURE_UNVERIFIABLE', 409);
  }
  const copies = store.list().filter(n => n.meta.chatgptSync?.sessionHash === key);
  if (copies.length > 1) fail('发现会话副本，不能选择任一副本更新。', 'CHATGPT_CAPTURE_AMBIGUOUS', 409);
  if (!state && (copies.length || store.row(noteId) || ownsPath(store, noteId))) fail('增量运行记录缺失，无法核对旧版本；请在知序检查，不会自动覆盖或重建。', 'CHATGPT_CAPTURE_UNVERIFIABLE', 409);
  if (!state && store.get('deleted', noteId)) fail('原资料已删除，不会自动重新创建。', 'CHATGPT_CAPTURE_UNAVAILABLE', 409);
  if (state && !state.pending && !store.row(noteId)) fail('原资料已删除或存在冲突，不会自动重建。', 'CHATGPT_CAPTURE_UNAVAILABLE', 409);
  if (state?.pending && (state.requestHash !== requestHash || state.payloadHash !== payloadHash)) fail('上次导入尚未完成，请先使用原请求重试。', 'CHATGPT_IMPORT_PENDING', 409);
  if (state && !state.pending && state.payloadHash === payloadHash) {
    checkSource(store.read(noteId), state, render, acceptedRenderers);
    const saved = { ...state.receipt, verification: verifySyncCapture(store, state, render, acceptedRenderers), status: 'already_saved', duplicate: true };
    store.put('chatgptCaptures', requestHash, { noteId, payloadHash, receipt: saved, sessionKey: key,
      ...(historyHandoff ? { historyHandoff } : {}) });
    return saved;
  }
  if (!state?.pending) {
    if (state) checkSource(store.read(noteId), state, render, acceptedRenderers);
    const merged = mergeSnapshot(state, value);
    const ids = new Set(merged.snapshot.messages.map(m => m.id));
    for (const item of value.structured?.items || []) if (item.sourceMessageIds.some(id => !ids.has(id))) fail('结构化条目引用了未保存的消息，不能导入。', 'CHATGPT_SOURCE_MESSAGE_MISSING');
    if (state && value.sync.baseRevision !== state.revision) fail('原资料已更新；请使用最近一次回执的版本，不会覆盖新内容。', 'CHATGPT_REVISION_CONFLICT', 409);
    const timestamp = Date.now(), recent = store.get('chatgptCaptureRate', 'recent', []).filter(at => Number.isFinite(at) && at <= timestamp && timestamp - at < 60000);
    if (recent.length >= 30) fail('一分钟内保存过于频繁，请稍后继续。', 'CHATGPT_RATE_LIMIT', 429);
    store.put('chatgptCaptureRate', 'recent', [...recent, timestamp]);
    const candidateSourceRevisions = {}, candidateWrites = {};
    for (const item of merged.snapshot.structured?.items || []) {
      const id = candidateIdFor(key, merged.snapshot, item);
      const provenance = state?.candidateSourceRevisions?.[id];
      if (provenance) candidateSourceRevisions[id] = provenance;
      const messageBasis = item.sourceMessageIds.map(messageId => merged.snapshot.messages.find(message => message.id === messageId));
      candidateWrites[id] = { phase: 'prepared', itemHash: hash(JSON.stringify([item, messageBasis])), existing: Boolean(store.row(id)) };
    }
    state = { key, requestHash, payloadHash, pending: true, revision: (state?.revision || 0) + 1, snapshot: merged.snapshot,
      candidateSourceRevisions, candidateWrites, sourceMetadataVersion: 2,
      ...(historyHandoff ? { historyHandoff } : {}),
      previousHash: state?.noteHash || null, sourceWritePhase: 'prepared', added: merged.added, modified: merged.modified, savedAt: now() };
    store.put('chatgptSyncSessions', key, state);
  }
  const body = render(state.snapshot);
  let note = store.row(noteId) && store.read(noteId);
  if (note?.meta.chatgptSync?.revision === state.revision) checkSource(note, state, render, acceptedRenderers);
  else {
    if (note && note.hash !== state.previousHash) fail('导入过程中原资料发生变化，不会覆盖。', 'CHATGPT_SOURCE_EDITED', 409);
    if (!note && (state.sourceWritePhase !== 'prepared' || state.noteHash || state.previousHash || ownsPath(store, noteId) || store.get('deleted', noteId))) fail('原资料缺失或写入状态无法核对，不会重建；请在知序核对。', 'CHATGPT_CAPTURE_UNAVAILABLE', 409);
    const meta = sourceMetadata(state, body);
    // Persist intent before any source write: a missing file afterwards may have been deleted.
    state = { ...state, sourceWritePhase: 'started' };
    store.put('chatgptSyncSessions', key, state);
    note = note ? store.update(noteId, { expectedHash: state.previousHash, title: state.snapshot.title, body, meta }) : store.create({ id: noteId, kind: 'source', title: state.snapshot.title, body, meta });
    state.noteHash = note.hash;
    store.put('chatgptSyncSessions', key, state);
  }
  const importedNoteIds = [];
  for (const item of state.snapshot.structured?.items || []) {
    const candidate = checkStructuredCandidate(store, state, item, { allowMissing: true, strict: recoveringPending });
    const { id, itemHash } = candidate;
    if (!state.candidateSourceRevisions?.[id]) {
      state = { ...state, candidateSourceRevisions: { ...(state.candidateSourceRevisions || {}), [id]: {
        itemHash, sourceMessageIds: item.sourceMessageIds, sourceRevision: candidate.sourceRevision,
      } } };
      store.put('chatgptSyncSessions', key, state);
    }
    if (!candidate.exists) {
      // A later missing file cannot distinguish an interrupted write from external deletion.
      state = { ...state, candidateWrites: { ...state.candidateWrites, [id]: { ...state.candidateWrites[id], phase: 'started', itemHash } } };
      store.put('chatgptSyncSessions', key, state);
      store.create({ id, kind: 'knowledge', title: item.title, body: candidateBody(item), meta: {
        privacy: 'local', stage: 'candidate', sources: [{ id: noteId, role: 'input' }],
        claimType: 'fact', researchLimitations: [limitation, ...item.uncertainties], generatedBodyHash: hash(candidateBody(item)),
        chatgptImport: { version: 1, sessionHash: key, itemId: item.id, itemHash, type: item.type, sourceRevision: candidate.sourceRevision, sourceMessageIds: item.sourceMessageIds },
      } });
    }
    state = { ...state, candidateWrites: { ...state.candidateWrites, [id]: { ...state.candidateWrites[id], phase: 'written', itemHash } } };
    store.put('chatgptSyncSessions', key, state);
    importedNoteIds.push(id);
  }
  const verification = verifySyncCapture(store, state, render, acceptedRenderers);
  const receipt = { status: state.revision === 1 ? 'saved' : 'updated', duplicate: false, noteId, layer: 1, kind: 'source', verification,
    savedAt: state.savedAt, messageCount: state.snapshot.messages.length, coverage: state.snapshot.coverage,
    syncRevision: state.revision, addedMessages: state.added, modifiedMessages: state.modified,
    complete: state.snapshot.sync.complete, importedNoteIds, importedItems: importedNoteIds.length,
    notice: '完整性仅指调用方声明的当前可见分支；未独立核对网页、隐藏分支或附件。结构化条目未经核验，未加入学习。', location: '知序 → 知识库 → 原始资料' };
  const captureRecord = { noteId, payloadHash, receipt, sessionKey: key, previousHash: state.previousHash ?? null, ...(historyHandoff ? { historyHandoff } : {}) };
  store.put('chatgptCaptures', requestHash, captureRecord);
  assertCaptureRecord(store, 'chatgptCaptures', requestHash, captureRecord);
  const completed = { ...state, pending: false, noteHash: note.hash, receipt };
  try {
    store.put('chatgptSyncSessions', key, completed);
    assertCaptureRecord(store, 'chatgptSyncSessions', key, completed);
  } catch (error) {
    // Keep the already written files; an unverifiable completion remains retryable.
    try { store.put('chatgptSyncSessions', key, state); } catch { /* A database failure is not a successful completion. */ }
    throw error;
  }
  return receipt;
}
