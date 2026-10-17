import { conversationOrigin } from './chatgpt-source-metadata.mjs';
import { createHash } from 'node:crypto';
import { planHistoryBatch, verifyHistoryBatchReceipts } from './chatgpt-history-batch.mjs';
import { literalBlock } from './chatgpt-sync.mjs';

const states = 'chatgptHistoryBatches', leaves = 'chatgptHistoryBatchLeaves';
const active = new WeakSet();
const digest = value => createHash('sha256').update(value).digest('hex');
const jsonHash = value => digest(JSON.stringify(value));
const copy = value => JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const identifier = /^[A-Za-z0-9_-]{1,200}$/;
const sha = /^[a-f0-9]{64}$/;
const sourceId = part => `chatgpt_history_part_${part.partId}`;
const candidateId = (plan, deferred) => `chatgpt_history_item_${jsonHash([plan.batchId, deferred])}`;
const inputBinding = input => ({ referenceHash: digest(input.historySnapshotRef),
  inputDigest: jsonHash([input.summary, input.structured ?? null, input.baseRevision ?? null]) });
function fail(message, code = 'CHATGPT_BATCH_INVALID', status = 409) {
  throw Object.assign(new Error(message), { code, status });
}
function parseInput(input) {
  if (!input || typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(input.requestId) ||
    !/^zhixu-history-v1:[a-f0-9]{64}$/.test(input.historySnapshotRef || '') ||
    typeof input.summary !== 'string' || !input.summary.trim() || input.summary.length > 30000 || input.baseRevision !== undefined) {
    fail('分批历史导入参数无效；它创建独立工件，不是累计更新。', 'CHATGPT_BATCH_INVALID', 400);
  }
  return { requestHash: digest(input.requestId), binding: inputBinding(input) };
}
function sourceSpec(state, part) {
  const noteId = sourceId(part);
  const origin = state.sourceMetadataVersion === 2
    ? conversationOrigin({ ...part.global.sourceMetadata, title: part.title }, state.savedAt) : null;
  const body = ['## 保存范围', '已授权当前可见分支的独立原文分片；隐藏分支、隐藏推理及附件字节未读取。',
    `本分片 ${part.partIndex + 1}/${part.partCount}；消息编号和字符偏移保留原始身份，不是新的会话分支。`,
    '## 整理摘要（模型生成，未经独立核验）', literalBlock(part.summary),
    '## 原始消息片段', ...part.fragments.flatMap(fragment => [
      `### ${fragment.messageIndex + 1}. ${fragment.role === 'user' ? '用户' : 'ChatGPT'}`,
      '原消息编号与字符范围：', literalBlock(JSON.stringify({ messageId: fragment.messageId,
        start: fragment.charStart, end: fragment.charEnd, messageCharacters: fragment.messageCharacters })), literalBlock(fragment.content),
    ])].join('\n\n');
  return { id: noteId, kind: 'source', title: `${part.title.slice(0, 165)} · 原文 ${part.partIndex + 1}/${part.partCount}`,
    body, meta: { privacy: 'local', stage: 'reference', platform: 'ChatGPT',
      url: `https://chatgpt.com/c/${part.global.conversationId}`, acquiredAt: state.savedAt,
      ...(origin ? { ...origin, origins: [origin] } : {}),
      fingerprint: digest(body.trim()), chatgptHistoryBatchPart: { version: 1, noteId, requestHash: state.requestHash,
        binding: state.binding, batchId: part.batchId, partSha256: jsonHash(part), savedAt: state.savedAt, part } } };
}
function candidateSpec(state, deferred) {
  const item = deferred.item, noteId = candidateId(state.plan, deferred);
  const type = { knowledge: '知识建议', conclusion: '模型结论', unverified_fact: '待验证事实' }[item.type];
  const sourceNoteIds = [...new Set(deferred.sourceLocations.flatMap(location => location.parts.map(part =>
    sourceId(state.plan.parts[part.partIndex]))))];
  const limitations = ['ChatGPT 生成的整理尚未独立核验，不代表用户理解或掌握。', ...item.uncertainties];
  const body = [`## ${type}（未经独立核验）`, literalBlock(item.body), '## 原始来源消息',
    literalBlock(item.sourceMessageIds.join('\n')), '## 来源分片与原消息位置', literalBlock(JSON.stringify(deferred.sourceLocations, null, 2)),
    '## 不确定性与限制', literalBlock(limitations.join('\n'))].join('\n\n');
  return { id: noteId, kind: 'knowledge', title: item.title, body, meta: { privacy: 'local', stage: 'candidate', claimType: 'fact',
    generatedBodyHash: digest(body), researchLimitations: limitations, sources: sourceNoteIds.map(id => ({ id, role: 'input' })),
    chatgptHistoryBatchImport: { version: 1, noteId, requestHash: state.requestHash, binding: state.binding,
      batchId: state.plan.batchId, transcriptSha256: state.plan.global.transcriptSha256, itemId: item.id,
      type: item.type, itemSha256: jsonHash(item), item, sourceMessageIds: item.sourceMessageIds,
      sourceLocations: deferred.sourceLocations, sourceNoteIds } } };
}
function expectedSpecs(state) {
  return [...state.plan.parts.map(part => ({ type: 'part', key: part.partId, spec: sourceSpec(state, part), part })),
    ...state.plan.deferredStructured.map(deferred => ({ type: 'candidate', key: deferred.item.id,
      spec: candidateSpec(state, deferred), deferred }))];
}
const writeFor = (state, entry) => state[entry.type === 'part' ? 'partWrites' : 'candidateWrites'][entry.key];
function checkState(state, input, binding) {
  if (state?.version !== 1 || state.requestHash !== digest(input.requestId) || !same(state.binding, binding) ||
    state.inputDigest !== binding.inputDigest || !state.plan || state.planSha256 !== jsonHash(state.plan) ||
    state.plan.parts.some(part => part.summary !== input.summary) ||
    !same(state.plan.deferredStructured.map(deferred => deferred.item), input.structured?.items ?? []) ||
    !state.partWrites || !state.candidateWrites || !Number.isFinite(Date.parse(state.savedAt))) {
    fail('同一批次请求的引用、整理内容或本机状态发生变化，不会覆盖。', 'CHATGPT_REQUEST_CONFLICT');
  }
}
function errorCode(error) { return /^[A-Z][A-Z0-9_]{1,80}$/.test(error?.code || '') ? error.code : 'CHATGPT_BATCH_PERSISTENCE'; }

// snapshot is internal, authenticated data supplied only after the bridge verifies
// its envelope. This factory never accepts an MCP-supplied snapshot or grants access.
export function createHistoryBatchStore({ getStore, enabled }) {
  const guard = store => {
    if (enabled() === false) fail('ChatGPT 接入已关闭。', 'CHATGPT_DISABLED', 403);
    if (store && getStore() !== store) fail('资料库已切换，已停止本次批量导入。', 'CHATGPT_BATCH_CONTEXT_CHANGED', 409);
  };
  const locked = async (store, action) => {
    guard(store);
    if (active.has(store)) fail('另一个批次正在进行，请稍后使用原请求重试。', 'CHATGPT_BATCH_BUSY');
    active.add(store);
    try { return await action(); } finally { active.delete(store); }
  };
  function persist(store, state) {
    guard(store); store.put(states, state.requestHash, state);
    if (!same(store.get(states, state.requestHash), state)) fail('批次运行记录未能持久读回。', 'CHATGPT_BATCH_STATE_MISMATCH');
  }
  function rejectOtherCapture(store, requestHash) {
    if (store.get('chatgptCaptures', requestHash) || store.records('chatgptSyncSessions').some(state => state.requestHash === requestHash)) {
      fail('请求编号已用于其他保存操作。', 'CHATGPT_REQUEST_CONFLICT');
    }
  }
  function readLeaf(store, state, entry, { allowMissing = false } = {}) {
    guard(store);
    const intent = writeFor(state, entry);
    if (!intent || intent.noteId !== entry.spec.id || !['prepared', 'started', 'written'].includes(intent.phase)) fail('分片写入意图无法核对。', 'CHATGPT_BATCH_STATE_MISMATCH');
    let note;
    try { note = store.readPersisted(entry.spec.id, { includeRaw: true }); }
    catch (error) {
      if (allowMissing && error.code === 'PERSISTED_UNAVAILABLE' && intent.phase === 'prepared') return null;
      fail('已写入或开始写入的批次工件缺失、冲突或无法核对；不会自动重建。', 'CHATGPT_BATCH_LEAF_UNAVAILABLE');
    }
    if (intent.phase === 'prepared') fail('目标稳定编号已存在，无法证明属于本次写入；不会覆盖。', 'CHATGPT_BATCH_ID_CONFLICT');
    if (note.id !== entry.spec.id || note.kind !== entry.spec.kind || note.title !== entry.spec.title ||
      note.body !== entry.spec.body || !same(note.meta, entry.spec.meta) ||
      typeof note.raw !== 'string' || digest(note.raw) !== note.hash || (intent.rawSha256 && note.hash !== intent.rawSha256)) {
      fail('批次工件已被编辑或来源标记发生变化；已保留现有内容。', 'CHATGPT_BATCH_LEAF_EDITED');
    }
    const marker = store.get(leaves, entry.spec.id);
    if (!marker || marker.requestHash !== state.requestHash || marker.batchId !== state.plan.batchId || marker.type !== entry.type || marker.key !== entry.key) {
      fail('批次叶记录与持久化工件不一致。', 'CHATGPT_BATCH_STATE_MISMATCH');
    }
    return note;
  }
  function writeLeaf(store, state, entry) {
    let note = readLeaf(store, state, entry, { allowMissing: true });
    const intent = writeFor(state, entry);
    if (!note) {
      const scan = store.scan(), owns = file => file?.split('/').at(-1)?.toLowerCase() === `${entry.spec.id}.md`;
      if (store.get('deleted', entry.spec.id) || scan.conflicts.some(conflict => conflict.id === entry.spec.id || owns(conflict.path) || owns(conflict.other))) {
        fail('目标文件存在删除或路径冲突记录，不会重新创建。', 'CHATGPT_BATCH_LEAF_UNAVAILABLE');
      }
      guard(store);
      intent.phase = 'started'; persist(store, state);
      store.create({ ...entry.spec, exclusive: true });
      note = readLeaf(store, state, entry);
    }
    intent.phase = 'written'; intent.rawSha256 = note.hash;
    if (entry.type === 'part') intent.receipt = { status: 'saved', batchId: entry.part.batchId, partId: entry.part.partId,
      partIndex: entry.part.partIndex, partCount: entry.part.partCount, requestId: entry.part.requestId,
      partSha256: jsonHash(entry.part), noteId: note.id, rawSha256: note.hash };
    persist(store, state);
  }
  async function verification(store, state) {
    const specs = expectedSpecs(state), sources = [], candidates = [], problems = [];
    const typeCounts = { knowledge: 0, conclusion: 0, unverified_fact: 0 };
    const readable = new Map();
    for (const entry of specs) {
      try {
        const note = readLeaf(store, state, entry);
        readable.set(entry.spec.id, note);
        const proof = { noteId: note.id, rawSha256: note.hash, bodySha256: digest(note.body) };
        if (entry.type === 'part') sources.push({ ...proof, partId: entry.part.partId, partIndex: entry.part.partIndex,
          partSha256: jsonHash(note.meta.chatgptHistoryBatchPart.part), range: entry.part.range });
        else {
          const marker = note.meta.chatgptHistoryBatchImport;
          candidates.push({ ...proof, itemId: marker.itemId, type: marker.type, status: 'verified',
            itemSha256: marker.itemSha256, sourceMessageIds: marker.sourceMessageIds, sourceNoteIds: marker.sourceNoteIds,
            sourceLocations: marker.sourceLocations, provenanceVerified: true });
          typeCounts[marker.type]++;
        }
      } catch (error) {
        if (['CHATGPT_DISABLED', 'CHATGPT_BATCH_CONTEXT_CHANGED'].includes(error.code)) throw error;
        problems.push({ type: entry.type, code: errorCode(error), noteId: entry.spec.id });
      }
    }
    const attempts = state.plan.parts.flatMap(part => {
      const receipt = state.partWrites[part.partId]?.receipt;
      return readable.has(sourceId(part)) && receipt ? [receipt] : [];
    });
    const text = await verifyHistoryBatchReceipts(state.plan, attempts, { verifyPersistedPart: async query => {
      guard(store);
      const entry = specs.find(candidate => candidate.type === 'part' && candidate.part.partId === query.partId);
      const note = readLeaf(store, state, entry);
      const durable = store.get(states, state.requestHash);
      if (!durable || durable.planSha256 !== state.planSha256 || !same(durable.binding, state.binding)) fail('批次记录发生变化。', 'CHATGPT_BATCH_STATE_MISMATCH');
      return { receipt: durable.partWrites[query.partId]?.receipt, part: note.meta.chatgptHistoryBatchPart.part, raw: note.raw,
        persistence: { method: 'fresh_disk_and_sqlite_readback', rawSha256: note.hash } };
    } });
    guard(store);
    // The aggregation above awaits several part readbacks. Recheck every leaf
    // synchronously afterwards so a candidate edited in that interval cannot
    // inherit the earlier successful proof.
    for (const entry of specs) {
      const previous = readable.get(entry.spec.id);
      if (!previous) continue;
      try {
        const fresh = readLeaf(store, state, entry);
        if (fresh.hash !== previous.hash) fail('最终核验期间工件发生变化。', 'CHATGPT_BATCH_LEAF_EDITED');
      } catch (error) {
        if (['CHATGPT_DISABLED', 'CHATGPT_BATCH_CONTEXT_CHANGED'].includes(error.code)) throw error;
        readable.delete(entry.spec.id);
        problems.push({ type: entry.type, code: errorCode(error), noteId: entry.spec.id });
        const proofs = entry.type === 'part' ? sources : candidates;
        const index = proofs.findIndex(proof => proof.noteId === entry.spec.id);
        if (index >= 0) proofs.splice(index, 1);
        if (entry.type === 'part') {
          text.textComplete = false;
          text.verifiedParts = Math.min(text.verifiedParts, sources.length);
          if (!text.missingParts.includes(entry.part.partIndex)) text.missingParts.push(entry.part.partIndex);
          text.issues.push({ partIndex: entry.part.partIndex, code: 'final_persisted_recheck_failed' });
        } else typeCounts[entry.deferred.item.type]--;
      }
    }
    const structuredComplete = candidates.length === state.plan.deferredStructured.length && !problems.some(problem => problem.type === 'candidate');
    const complete = text.textComplete && structuredComplete && !problems.length;
    return { version: 1, status: complete ? 'verified' : 'partial', method: 'fresh_disk_and_sqlite_readback',
      complete, textComplete: text.textComplete, reader: { evidence: 'authenticated_local_snapshot',
        transcriptSha256: state.plan.global.transcriptSha256, snapshotPayloadSha256: state.plan.global.snapshotPayloadSha256,
        pagesSha256: state.plan.global.pagesSha256, scope: 'authorized_visible_branch_text_only' },
      text: { status: text.textComplete ? 'verified' : 'incomplete', expectedParts: text.expectedParts, verifiedParts: text.verifiedParts,
        missingParts: text.missingParts, issues: text.issues, transcriptSha256: text.transcriptSha256 },
      sources, candidates, structured: { expectedItems: state.plan.deferredStructured.length, verifiedItems: candidates.length,
        complete: structuredComplete, typeCounts, manifestSha256: jsonHash(candidates) }, problems,
      notice: '读回核验只证明收到的可见分支正文和候选来源已保存；候选事实未核验，附件字节、隐藏分支和推理未读取。' };
  }
  function reply(state, proof, { duplicate = false, code = null } = {}) {
    const complete = proof.complete;
    return { status: complete ? duplicate ? 'already_saved' : 'saved' : proof.sources.length || proof.candidates.length ? 'partial' : 'pending',
      duplicate, complete, textComplete: proof.textComplete, ...(code ? { code } : {}), batchId: state.plan.batchId,
      savedAt: state.savedAt, coverage: 'visible_history', partCount: state.plan.parts.length,
      sourceIds: proof.sources.map(source => source.noteId), candidateIds: proof.candidates.map(candidate => candidate.noteId),
      importedNoteIds: proof.candidates.map(candidate => candidate.noteId), importedItems: proof.candidates.length,
      messageCount: state.plan.global.messageCount, textCharacters: state.plan.global.textCharacters,
      expectedSources: state.plan.parts.length, verifiedSources: proof.sources.length,
      expectedCandidates: state.plan.deferredStructured.length, verifiedCandidates: proof.candidates.length,
      verification: proof, undo: { supported: false, leafUndoAllowed: false, reason: 'whole_batch_undo_not_implemented' },
      notice: complete ? '分片正文和全部候选已实际落库并读回；候选仍未经事实核验，也不代表个人掌握。'
        : '本批次未全部完成；保留已写内容和待恢复记录，不把部分成功当作完整入库。' };
  }
  async function run(store, state, { duplicate = false } = {}) {
    const specs = expectedSpecs(state);
    try {
      if (state.pending) {
        for (const entry of specs) {
          const marker = { version: 1, requestHash: state.requestHash, batchId: state.plan.batchId,
            type: entry.type, key: entry.key, undoSupported: false };
          const prior = store.get(leaves, entry.spec.id);
          if (prior && !same(prior, marker)) fail('分片叶记录属于其他写入，不会覆盖。', 'CHATGPT_BATCH_ID_CONFLICT');
          if (!prior) { guard(store); store.put(leaves, entry.spec.id, marker); }
          if (!same(store.get(leaves, entry.spec.id), marker)) fail('分片叶记录未持久读回。', 'CHATGPT_BATCH_STATE_MISMATCH');
        }
        // Check all prior writes before creating another leaf. Changed/deleted files
        // never get repaired by overwrite, even during a partial retry.
        for (const entry of specs) readLeaf(store, state, entry, { allowMissing: true });
        for (const entry of specs) writeLeaf(store, state, entry);
      }
      const proof = await verification(store, state);
      if (!proof.complete) return reply(state, proof, { duplicate, code: proof.problems[0]?.code || 'CHATGPT_BATCH_INCOMPLETE' });
      const receipt = reply(state, proof, { duplicate });
      if (state.pending) { state.pending = false; state.receipt = receipt; persist(store, state); }
      return receipt;
    } catch (error) {
      if (['CHATGPT_DISABLED', 'CHATGPT_BATCH_CONTEXT_CHANGED'].includes(error.code)) throw error;
      // A failed completion write must not become a completion claim. A later retry
      // may finish from durable started/written intents without consulting the pipe.
      state.pending = true;
      try { persist(store, state); } catch { /* Readback below reports only actual surviving data. */ }
      const proof = await verification(store, state);
      proof.complete = false; proof.status = 'partial';
      return reply(state, proof, { duplicate, code: errorCode(error) });
    }
  }
  return {
    async findRetry(input) {
      guard(); const requested = parseInput(input), store = getStore();
      return locked(store, async () => {
        rejectOtherCapture(store, requested.requestHash);
        const state = store.get(states, requested.requestHash);
        if (!state) return null;
        checkState(state, input, requested.binding); store.scan();
        return run(store, state, { duplicate: !state.pending });
      });
    },
    async capture(snapshot, input, binding) {
      guard(); const requested = parseInput(input), store = getStore();
      if (!binding || !sha.test(binding.referenceHash || '') || !sha.test(binding.inputDigest || '') || !same(binding, requested.binding)) {
        fail('批次引用与认证整理请求不匹配。', 'CHATGPT_REQUEST_CONFLICT');
      }
      return locked(store, async () => {
        rejectOtherCapture(store, requested.requestHash);
        const prior = store.get(states, requested.requestHash);
        if (prior) {
          checkState(prior, input, binding);
          if (jsonHash(snapshot) !== prior.plan.global.snapshotPayloadSha256) fail('同一请求收到另一份快照。', 'CHATGPT_REQUEST_CONFLICT');
          store.scan(); return run(store, prior, { duplicate: !prior.pending });
        }
        const plan = planHistoryBatch(snapshot, { summary: input.summary, structured: input.structured });
        if (plan.transport.fullSnapshotBlocked) return { status: 'blocked', complete: false, textComplete: false,
          code: 'CHATGPT_HISTORY_FRAME_LIMIT', expectedSources: plan.parts.length, verifiedSources: 0,
          expectedCandidates: plan.deferredStructured.length, verifiedCandidates: 0, transport: plan.transport,
          notice: '整份已签名快照仍超过现有 2 MiB 传输上限；未写入，不会截断后声称完整。' };
        const timestamp = Date.now(), recent = store.get('chatgptCaptureRate', 'recent', [])
          .filter(at => Number.isFinite(at) && at <= timestamp && timestamp - at < 60000);
        if (recent.length >= 30) fail('一分钟内保存过于频繁，请稍后继续。', 'CHATGPT_RATE_LIMIT', 429);
        guard(store); store.put('chatgptCaptureRate', 'recent', [...recent, timestamp]);
        const state = { version: 1, sourceMetadataVersion: 2, requestHash: requested.requestHash, binding: copy(binding), inputDigest: binding.inputDigest,
          plan: copy(plan), planSha256: jsonHash(plan), pending: true, savedAt: new Date(timestamp).toISOString(),
          partWrites: Object.fromEntries(plan.parts.map(part => [part.partId, { phase: 'prepared', noteId: sourceId(part) }])),
          candidateWrites: Object.fromEntries(plan.deferredStructured.map(deferred => [deferred.item.id,
            { phase: 'prepared', noteId: candidateId(plan, deferred) }])) };
        try { persist(store, state); }
        catch (error) {
          if (['CHATGPT_DISABLED', 'CHATGPT_BATCH_CONTEXT_CHANGED'].includes(error.code)) throw error;
          const proof = await verification(store, state);
          proof.complete = false; proof.status = 'partial';
          return { ...reply(state, proof, { code: errorCode(error) }), statePersisted: false,
            notice: '批次运行记录尚未确认持久保存，本次没有开始写入工件；不能报告完整入库，重试可能仍需原快照。' };
        }
        store.scan(); return run(store, state);
      });
    },
  };
}
