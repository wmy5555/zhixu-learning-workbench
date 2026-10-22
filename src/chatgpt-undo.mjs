import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { fail, hash, now } from './store.mjs';

const namespace = 'chatgptUndo';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const selectorSchema = z.object({ requestId: z.string().trim().min(8).max(128), noteId: id,
  syncRevision: z.number().int().min(1).nullable().default(null) }).strict();
const previewSchema = z.object({ previewId: z.string().uuid() }).strict();
const restoreSchema = z.object({ undoId: z.string().uuid() }).strict();
const clone = value => JSON.parse(JSON.stringify(value));
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const digest = value => hash(canonical(value));
const conflict = () => fail('保存后的资料、运行版本或依赖已变化，未覆盖或删除新内容。', 'CHATGPT_UNDO_CONFLICT', 409);
const parsed = (schema, input) => { const result = schema.safeParse(input); if (!result.success) fail('撤销对象必须是指定的成功保存回执。', 'CHATGPT_UNDO_INVALID'); return result.data; };
function metadata(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const document = YAML.parseDocument(match?.[1] || '{}');
  if (document.errors.length) conflict();
  return document.toJS({ maxAliasCount: 50 });
}
function versionFor(store, noteId, expectedHash, expectedPath) {
  const version = store.history(noteId).find(item => item.hash === expectedHash && item.path === expectedPath && hash(item.raw) === expectedHash);
  if (!version || metadata(version.raw)?.id !== noteId) conflict();
  return version;
}
function references(value, ids) {
  if (typeof value === 'string') return [...ids].some(noteId => value.includes(noteId));
  if (Array.isArray(value)) return value.some(item => references(item, ids));
  return value && typeof value === 'object' && Object.entries(value).some(([key, item]) => ids.has(key) || references(item, ids));
}
function family(store, sourceId) {
  return store.records('chatgptCaptures').filter(record => record.noteId === sourceId).toSorted((a, b) => digest(a).localeCompare(digest(b)));
}
function dependencyDigest(store, plan) {
  const targets = new Set(plan.steps.map(step => step.noteId)), outside = [];
  const allowed = new Set(plan.priorCandidateIds);
  for (const note of store.list()) {
    if (targets.has(note.id)) continue;
    if (references(note, targets)) {
      if (!allowed.has(note.id)) conflict();
      outside.push(['note', note.id, note.hash, note.path]);
    }
  }
  for (const version of store.db.prepare('SELECT id,noteId,hash,raw FROM versions ORDER BY id').all()) {
    if (targets.has(version.noteId) || !references(version.raw, targets)) continue;
    const marker = metadata(version.raw)?.chatgptImport;
    if (!allowed.has(version.noteId) || !Number.isSafeInteger(marker?.sourceRevision) || marker.sourceRevision >= plan.revision) conflict();
    outside.push(['version', version.id, version.hash]);
  }
  for (const row of store.db.prepare("SELECT namespace,key,json FROM records WHERE namespace NOT IN ('settings','changed','deleted','mcpCalls','chatgptCaptureRate','chatgptUndo','fileRecovery') ORDER BY namespace,key").all()) {
    const value = JSON.parse(row.json);
    if (row.namespace === 'chatgptCaptures' && value.noteId === plan.sourceId) continue;
    if (row.namespace === 'chatgptSyncSessions' && value.key === plan.sessionKey) continue;
    if (references(value, targets)) conflict();
  }
  return digest(outside);
}
function versionsSnapshot(store, plan) {
  return plan.guards.map(guard => [guard.noteId, store.history(guard.noteId).map(version =>
    [version.versionId, version.path, version.hash, version.reason, version.createdAt]).toSorted((a, b) => a[0].localeCompare(b[0]))]);
}
function versionsDigest(store, plan) { return digest(versionsSnapshot(store, plan)); }
function runtimeDigest(store, plan) {
  return digest({ captures: family(store, plan.sourceId), session: plan.sessionKey ? store.get('chatgptSyncSessions', plan.sessionKey) : null });
}
function validateVersion(store, step, versionId) {
  const version = store.history(step.noteId).find(item => item.versionId === versionId);
  if (!version || version.path !== step.path || hash(version.raw) !== version.hash) conflict();
  return version;
}
function previousSession(store, current, version) {
  const marker = metadata(version.raw).chatgptSync;
  if (marker?.sessionHash !== current.key || marker.revision !== current.revision - 1 || !marker.snapshot) conflict();
  const prior = store.get('chatgptCaptures', marker.requestHash);
  if (!prior?.receipt || prior.receipt.syncRevision !== marker.revision || prior.payloadHash !== marker.payloadHash) conflict();
  const candidateSourceRevisions = {}, candidateWrites = {};
  for (const noteId of prior.receipt.importedNoteIds) {
    const note = store.readPersisted(noteId), imported = note.meta.chatgptImport;
    if (imported?.sessionHash !== current.key || !Number.isSafeInteger(imported.sourceRevision) || imported.sourceRevision > marker.revision) conflict();
    candidateSourceRevisions[noteId] = { itemHash: imported.itemHash, sourceMessageIds: imported.sourceMessageIds, sourceRevision: imported.sourceRevision };
    candidateWrites[noteId] = { phase: 'written', itemHash: imported.itemHash, existing: imported.sourceRevision < marker.revision };
  }
  let previousHash = prior.previousHash ?? null;
  if (marker.revision > 1 && !previousHash) {
    const predecessors = store.history(version.noteId).filter(item => {
      const previous = metadata(item.raw)?.chatgptSync;
      const receipt = previous && store.get('chatgptCaptures', previous.requestHash)?.receipt;
      return item.path === version.path && previous?.sessionHash === current.key && previous.revision === marker.revision - 1 &&
        receipt?.verification?.source?.rawSha256 === item.hash && hash(item.raw) === item.hash;
    });
    const hashes = [...new Set(predecessors.map(item => item.hash))];
    if (hashes.length !== 1) conflict();
    previousHash = hashes[0];
  }
  return { key: current.key, requestHash: marker.requestHash, payloadHash: marker.payloadHash, pending: false,
    revision: marker.revision, snapshot: marker.snapshot, candidateSourceRevisions, candidateWrites,
    previousHash, sourceWritePhase: 'restored', added: prior.receipt.addedMessages, modified: prior.receipt.modifiedMessages,
    savedAt: prior.receipt.savedAt, noteHash: version.hash, receipt: prior.receipt,
    ...(prior.historyHandoff ? { historyHandoff: prior.historyHandoff } : {}) };
}
function planFor(store, selector) {
  store.scan();
  const requestHash = hash(selector.requestId), capture = store.get('chatgptCaptures', requestHash);
  if (!capture || capture.noteId !== selector.noteId) conflict();
  const receipt = capture.receipt || { status: 'saved', noteId: capture.noteId, syncRevision: null, importedNoteIds: [], verification: capture.verification };
  if (receipt.duplicate || receipt.status === 'already_saved') fail('这次请求没有新建或更新内容，无需撤销。', 'CHATGPT_UNDO_NO_CHANGE', 409);
  if (!['saved', 'updated'].includes(receipt.status) || (receipt.syncRevision ?? null) !== selector.syncRevision ||
    receipt.verification?.version !== 1 || receipt.verification?.source?.noteId !== capture.noteId) conflict();
  const source = store.readPersisted(capture.noteId);
  if (source.kind !== 'source' || source.hash !== receipt.verification.source.rawSha256) conflict();
  const sessionKey = capture.sessionKey || null, current = sessionKey ? store.get('chatgptSyncSessions', sessionKey) : null;
  if (current && (current.pending || current.requestHash !== requestHash || current.revision !== receipt.syncRevision || current.noteHash !== source.hash)) conflict();
  if (!current && (receipt.syncRevision !== null && receipt.syncRevision !== undefined || capture.requestHash !== requestHash)) conflict();
  if (receipt.structure?.version === 2) fail('此导入含新版结构，暂不支持整组撤销；现有内容已保留。','CHATGPT_UNDO_UNAVAILABLE',409);
  const revision = receipt.syncRevision ?? null, steps = [], guards = [{ noteId: source.id, hash: source.hash, path: source.path }];
  const priorCandidateIds = [], reusedCandidates = [];
  for (const noteId of receipt.importedNoteIds || []) {
    const candidate = store.readPersisted(noteId), proof = receipt.verification.candidates?.find(item => item.noteId === noteId);
    if (!proof || candidate.hash !== proof.rawSha256 || candidate.meta.chatgptImport?.sessionHash !== sessionKey) conflict();
    guards.push({ noteId, hash: candidate.hash, path: candidate.path });
    if (current.candidateWrites?.[noteId]?.existing === false) {
      if (candidate.meta.chatgptImport.sourceRevision !== revision || !proof.provenanceVerified) conflict();
      const recovery = versionFor(store, noteId, candidate.hash, candidate.path);
      steps.push({ noteId, title: candidate.title, path: candidate.path, action: 'recycle', beforeHash: candidate.hash, recoveryVersionId: recovery.versionId });
    } else {
      if (current.candidateWrites?.[noteId]?.existing !== true || candidate.meta.chatgptImport.sourceRevision >= revision) conflict();
      priorCandidateIds.push(noteId); reusedCandidates.push(noteId);
    }
  }
  let priorState = null;
  if (current && revision > 1) {
    const previous = versionFor(store, source.id, current.previousHash, source.path);
    priorState = previousSession(store, current, previous);
    for (const noteId of priorState.receipt.importedNoteIds || []) if (!priorCandidateIds.includes(noteId)) {
      const note = store.readPersisted(noteId), originalProof = priorState.receipt.verification?.candidates?.find(item => item.noteId === noteId);
      if (!originalProof || note.hash !== originalProof.rawSha256) conflict();
      priorCandidateIds.push(noteId);
      if (!guards.some(guard => guard.noteId === noteId)) guards.push({ noteId, hash: note.hash, path: note.path });
    }
    steps.push({ noteId: source.id, title: source.title, path: source.path, action: 'restore_previous_revision',
      beforeHash: source.hash, afterHash: previous.hash, restoreVersionId: previous.versionId });
  } else {
    const original = versionFor(store, source.id, source.hash, source.path);
    steps.push({ noteId: source.id, title: source.title, path: source.path, action: 'recycle', beforeHash: source.hash, recoveryVersionId: original.versionId });
  }
  const plan = { version: 1, requestHash, sourceId: source.id, revision, sessionKey, currentState: current,
    priorState, priorCandidateIds, reusedCandidates, guards, steps };
  plan.dependencies = dependencyDigest(store, plan);
  plan.runtime = runtimeDigest(store, plan);
  plan.versions = versionsDigest(store, plan);
  return plan;
}
function publicPreview(record) {
  return { previewId: record.id, undoId: record.undoId ?? record.id, kind: record.kind, state: record.state,
    createdAt: record.createdAt, expiresAt: record.expiresAt,
    requiresLocalConfirmation: true, planDigest: record.planDigest, noteId: record.plan.sourceId,
    requestedRevision: record.plan.revision, restoreToRevision: record.plan.priorState?.revision ?? null,
    recycledCandidates: record.plan.steps.filter(step => step.action === 'recycle' && step.noteId !== record.plan.sourceId).length,
    preservedCandidateIds: record.plan.reusedCandidates,
    items: record.plan.steps.map(step => ({ noteId: step.noteId, title: step.title, action: record.kind === 'restore' ? 'restore_from_undo' : step.action })),
    notice: '只影响指定保存回执；原文和版本进入可恢复记录，不永久删除。必须在本机审阅并确认。' };
}

export function createChatgptUndo({ getStore, localAuthority = Symbol('private local user confirmation'), clock = Date.now, ttl = 15 * 60 * 1000 }) {
  if (typeof getStore !== 'function' || typeof localAuthority !== 'symbol') throw new Error('Private local confirmation authority is required');
  const authorized = authority => { if (authority !== localAuthority) fail('撤销或恢复只能在本机预览后由用户确认；模型参数不能授权。', 'CHATGPT_UNDO_LOCAL_CONFIRMATION', 403); };
  const save = (store, record) => { store.put(namespace, record.id, record); if (digest(store.get(namespace, record.id)) !== digest(record)) fail('撤销审计尚未完成保存。', 'CHATGPT_UNDO_AUDIT_FAILED', 409); return record; };
  const load = (store, previewId, kind) => { const record = store.get(namespace, previewId); if (!record || record.kind !== kind) fail('撤销预览不存在。', 'CHATGPT_UNDO_NOT_FOUND', 404); return record; };
  function reconcileStarted(store, record, restoring = false) {
    if (!record.steps.some(step => step.state === 'started') && !record.steps.every(step => step.state === 'done')) return record;
    store.scan();
    let changed = false;
    for (const step of record.steps) {
      if (step.state !== 'started') continue;
      const operation = step.operationId && store.get('fileRecovery', step.operationId);
      if (!operation || operation.state !== 'complete') continue;
      const targetHash = restoring ? step.beforeHash : step.action === 'recycle' ? null : step.afterHash;
      const originHash = restoring ? step.action === 'recycle' ? null : step.afterHash : step.beforeHash;
      if (operation.noteId !== step.noteId || operation.path !== step.path || operation.afterHash !== targetHash ||
        operation.beforeHash !== originHash || !Array.isArray(operation.versions) ||
        operation.kind !== (!restoring && step.action === 'recycle' ? 'recycle' : 'restore') || !Array.isArray(step.beforeVersions)) conflict();
      const before = step.beforeVersions.find(([noteId]) => noteId === step.noteId)?.[1];
      if (!before || before.some(entry => !operation.versions.some(item => digest(item) === digest(entry)))) conflict();
      const expectedVersions = step.beforeVersions.map(([noteId, entries]) => [noteId, noteId === step.noteId ? operation.versions : entries]);
      if (digest(versionsSnapshot(store, record.plan)) !== digest(expectedVersions)) conflict();
      if (targetHash === null) {
        const deleted = store.get('deleted', step.noteId);
        if (store.row(step.noteId) || existsSync(path.resolve(store.vaultDir, step.path)) || deleted?.operationId !== operation.id ||
          deleted?.chatgptUndoId !== record.undoId || deleted?.rawSha256 !== step.beforeHash) conflict();
      } else {
        const note = store.readPersisted(step.noteId);
        if (note.hash !== targetHash || note.path !== step.path) conflict();
      }
      if (!restoring && step.action !== 'recycle') step.recoveryVersionId = versionFor(store, step.noteId, step.beforeHash, step.path).versionId;
      step.state = 'done'; record.expected.versions = versionsDigest(store, record.plan); changed = true;
    }
    if (record.plan.sessionKey && record.steps.every(step => step.state === 'done') && runtimeDigest(store, record.plan) !== record.expected.runtime) {
      const target = restoring ? record.plan.currentState : record.plan.priorState;
      const baseline = restoring ? record.plan.priorState ?? record.plan.currentState : record.plan.currentState;
      if (!target || digest(store.get('chatgptSyncSessions', record.plan.sessionKey)) !== digest(target) ||
        digest({ captures: family(store, record.plan.sourceId), session: baseline }) !== record.expected.runtime) conflict();
      record.expected.runtime = runtimeDigest(store, record.plan); changed = true;
    }
    return changed ? save(store, record) : record;
  }
  function check(store, record, restoring = false) {
    store.scan();
    if (dependencyDigest(store, record.plan) !== record.expected.dependencies || runtimeDigest(store, record.plan) !== record.expected.runtime ||
      versionsDigest(store, record.plan) !== record.expected.versions) conflict();
    for (const guard of record.plan.guards) {
      const step = record.steps.find(item => item.noteId === guard.noteId);
      if (restoring && step && step.state !== 'done' && step.action !== 'recycle') {
        const note = store.readPersisted(guard.noteId);
        if (note.hash !== step.afterHash || note.path !== guard.path) conflict();
      } else if (!step || (!restoring && step.state !== 'done')) {
        const note = store.readPersisted(guard.noteId);
        if (note.hash !== guard.hash || note.path !== guard.path) conflict();
      } else if (step.action === 'recycle' && (restoring ? step.state !== 'done' : true)) {
        const deleted = store.get('deleted', step.noteId);
        if (store.row(step.noteId) || existsSync(path.resolve(store.vaultDir, step.path)) || deleted?.chatgptUndoId !== record.undoId || deleted?.rawSha256 !== step.beforeHash) conflict();
        validateVersion(store, step, step.recoveryVersionId);
      } else {
        const note = store.readPersisted(guard.noteId);
        const expected = restoring ? step.beforeHash : step.afterHash;
        if (note.hash !== expected || note.path !== guard.path) conflict();
      }
    }
  }
  function executeUndo(store, record) {
    let working = save(store, { ...record, state: 'pending', confirmedAt: record.confirmedAt || now() });
    try {
      check(store, working);
      for (let index = 0; index < working.steps.length; index++) {
        const step = working.steps[index];
        if (step.state === 'done') continue;
        check(store, working);
        working.steps[index] = { ...step, state: 'started', operationId: randomUUID(), beforeVersions: versionsSnapshot(store, working.plan) }; save(store, working);
        if (step.action === 'recycle') {
          store.delete(step.noteId, step.beforeHash, { operationId: working.steps[index].operationId, undoId: working.id });
        } else {
          store.restoreVersionExact(step.noteId, step.restoreVersionId, { expectedHash: step.beforeHash, operationId: working.steps[index].operationId });
          working.steps[index].recoveryVersionId = versionFor(store, step.noteId, step.beforeHash, step.path).versionId;
        }
        working.steps[index].state = 'done';
        working.expected.versions = versionsDigest(store, working.plan);
        save(store, working);
      }
      if (working.plan.sessionKey && working.plan.priorState) store.put('chatgptSyncSessions', working.plan.sessionKey, working.plan.priorState);
      working.expected.runtime = runtimeDigest(store, working.plan);
      check(store, working);
      working = { ...working, state: 'undone', completedAt: now(), receipt: { status: 'undone', undoId: working.id,
        noteId: working.plan.sourceId, requestHash: working.plan.requestHash, requestedRevision: working.plan.revision,
        currentRevision: working.plan.priorState?.revision ?? null, recyclable: true, completedItems: working.steps.length } };
      save(store, working); return working.receipt;
    } catch (error) {
      const failed = { ...working, state: working.steps.some(step => step.state === 'done') ? 'partial' : 'pending', errorCode: error.code || 'CHATGPT_UNDO_IO', failedAt: now() };
      let auditPersisted = true;
      try { save(store, failed); } catch { auditPersisted = false; }
      return { status: failed.state, undoId: working.id, noteId: working.plan.sourceId, completedItems: working.steps.filter(step => step.state === 'done').length,
        totalItems: working.steps.length, errorCode: failed.errorCode, recyclable: true, auditPersisted,
        notice: auditPersisted ? '撤销尚未全部完成，现有文件和原始版本均保留；须在本机核对后继续。' : '撤销尚未全部完成，最新审计也未能持久保存；原始版本保留，须在本机人工核对，不能据旧回执自动重做。' };
    }
  }
  return {
    // Local server UI only: never register this enumeration as an external MCP tool.
    list() {
      return getStore().records(namespace).map(record => publicPreview(record.state === 'preview' && record.expiresAt <= clock()
        ? { ...record, state: 'expired' } : record));
    },
    preview(input) {
      const selector = parsed(selectorSchema, input), store = getStore(), plan = planFor(store, selector);
      const record = { id: randomUUID(), kind: 'undo', state: 'preview', plan, planDigest: digest(plan),
        createdAt: now(), expiresAt: clock() + ttl, expected: { dependencies: plan.dependencies, runtime: plan.runtime, versions: plan.versions },
        steps: plan.steps.map(step => ({ ...step, state: 'pending' })) };
      record.undoId = record.id;
      save(store, record); return publicPreview(record);
    },
    confirmUndo(input, authority) {
      authorized(authority); const { previewId } = parsed(previewSchema, input), store = getStore(); let record = load(store, previewId, 'undo');
      if (record.state === 'undone') return { ...record.receipt, status: 'already_undone' };
      if (record.state === 'restored') return { ...record.restoreReceipt, status: 'already_restored' };
      if (record.state === 'preview' && record.expiresAt <= clock()) fail('撤销预览已到期，请重新预览。', 'CHATGPT_UNDO_EXPIRED', 409);
      if (record.planDigest !== digest(record.plan)) conflict();
      record = reconcileStarted(store, record);
      check(store, record);
      return executeUndo(store, record);
    },
    previewRestore(input) {
      const { undoId } = parsed(restoreSchema, input), store = getStore(), undo = load(store, undoId, 'undo');
      if (undo.state !== 'undone') fail('只有已完成撤销的明确回收记录可恢复。', 'CHATGPT_UNDO_RESTORE_UNAVAILABLE', 409);
      check(store, undo);
      const record = { ...clone(undo), id: randomUUID(), undoId, kind: 'restore', state: 'preview', createdAt: now(), expiresAt: clock() + ttl,
        steps: undo.steps.map(step => ({ ...step, state: 'pending' })) };
      save(store, record); return publicPreview(record);
    },
    confirmRestore(input, authority) {
      authorized(authority); const { previewId } = parsed(previewSchema, input), store = getStore(); let record = load(store, previewId, 'restore');
      const undo = load(store, record.undoId, 'undo');
      if (record.state === 'restored') return { ...record.receipt, status: 'already_restored' };
      if (undo.state !== 'undone') conflict();
      if (record.state === 'preview' && record.expiresAt <= clock()) fail('恢复预览已到期，请重新预览。', 'CHATGPT_UNDO_EXPIRED', 409);
      if (record.planDigest !== digest(record.plan)) conflict();
      record = reconcileStarted(store, record, true);
      // Every still-recycled or already-restored file is checked before the next write.
      check(store, record, true);
      let working = save(store, { ...record, state: 'pending', confirmedAt: record.confirmedAt || now() });
      try {
        if (dependencyDigest(store, working.plan) !== working.expected.dependencies || runtimeDigest(store, working.plan) !== working.expected.runtime ||
          versionsDigest(store, working.plan) !== working.expected.versions) conflict();
        for (let index = working.steps.length - 1; index >= 0; index--) {
          const step = working.steps[index]; if (step.state === 'done') continue;
          check(store, working, true);
          const version = validateVersion(store, step, step.recoveryVersionId);
          if (version.hash !== step.beforeHash) conflict();
          working.steps[index] = { ...step, state: 'started', operationId: randomUUID(), beforeVersions: versionsSnapshot(store, working.plan) }; save(store, working);
          if (step.action === 'recycle') {
            const deleted = store.get('deleted', step.noteId);
            if (deleted?.chatgptUndoId !== working.undoId || deleted?.rawSha256 !== step.beforeHash) conflict();
            store.restoreVersionExact(step.noteId, step.recoveryVersionId, { expectMissing: true, operationId: working.steps[index].operationId });
          } else store.restoreVersionExact(step.noteId, step.recoveryVersionId, { expectedHash: step.afterHash, operationId: working.steps[index].operationId });
          working.steps[index].state = 'done'; working.expected.versions = versionsDigest(store, working.plan); save(store, working);
        }
        if (working.plan.sessionKey) store.put('chatgptSyncSessions', working.plan.sessionKey, working.plan.currentState);
        working.expected.runtime = runtimeDigest(store, working.plan);
        check(store, working, true);
        working = { ...working, state: 'restored', completedAt: now(), receipt: { status: 'restored', undoId: working.undoId,
          noteId: working.plan.sourceId, currentRevision: working.plan.revision, restoredItems: working.steps.length } };
        save(store, working); save(store, { ...undo, state: 'restored', restoreReceipt: working.receipt, restoredAt: now() });
        return working.receipt;
      } catch (error) {
        let auditPersisted = true;
        try { save(store, { ...working, state: working.steps.some(step => step.state === 'done') ? 'partial' : 'pending', errorCode: error.code || 'CHATGPT_UNDO_IO', failedAt: now() }); }
        catch { auditPersisted = false; }
        return { status: working.steps.some(step => step.state === 'done') ? 'partial' : 'pending', undoId: working.undoId,
          restoredItems: working.steps.filter(step => step.state === 'done').length, totalItems: working.steps.length,
          errorCode: error.code || 'CHATGPT_UNDO_IO', auditPersisted,
          notice: auditPersisted ? '恢复尚未全部完成，不会覆盖冲突内容；原始版本继续保留。' : '恢复尚未全部完成，最新审计也未能持久保存；原始版本保留，须在本机人工核对。' };
      }
    },
  };
}
