import { fail, hash, now } from './store.mjs';

export function readCapturePersisted(store, id) {
  try { return store.readPersisted(id); }
  catch { fail('保存文件与数据库不一致或缺失，尚未完成完整性核验；不会覆盖现有内容。', 'CHATGPT_PERSISTENCE_MISMATCH', 409); }
}

export function assertCaptureRecord(store, namespace, key, expected) {
  if (JSON.stringify(store.get(namespace, key)) !== JSON.stringify(expected)) {
    fail('保存运行记录无法读回核对，尚未完成完整性核验。', 'CHATGPT_PERSISTENCE_MISMATCH', 409);
  }
}

export function captureVerification(value, source, candidates = [], { revision = null, historyVerified = false } = {}) {
  const messages = value.messages.map((message, index) => ({ index, id: message.id ?? null,
    role: message.role, characters: message.content.length, contentSha256: hash(message.content) }));
  const preserved = candidates.filter(item => item.status !== 'verified').length;
  const typeCounts = { knowledge: 0, conclusion: 0, unverified_fact: 0 };
  for (const item of candidates) typeCounts[item.type]++;
  return { version: 1, status: preserved ? 'preserved_edits' : 'verified', method: 'fresh_disk_and_sqlite_readback',
    checkedAt: now(), requestedRevision: revision, currentRevision: revision,
    scope: value.sync?.complete ? 'complete_visible_branch_received_text' : 'received_messages_only',
    source: { noteId: source.id, rawSha256: source.hash, bodySha256: hash(source.body),
      messageCount: messages.length, textCharacters: messages.reduce((n, message) => n + message.characters, 0),
      stableMessageIds: messages.every(message => message.id !== null),
      messageManifestSha256: hash(JSON.stringify(messages)),
      orderedMessageIdsSha256: hash(JSON.stringify(messages.map(message => message.id))), summarySha256: hash(value.summary) },
    messageFingerprints: messages,
    reader: { evidence: historyVerified ? 'authenticated_local_snapshot' : value.sync?.readerEvidence ? 'caller_declaration' : 'none',
      transcriptSha256: value.sync?.readerEvidence?.transcriptSha256 ?? null },
    structured: { expectedItems: candidates.length, verifiedItems: candidates.length - preserved,
      preservedItems: preserved, typeCounts, manifestSha256: hash(JSON.stringify(candidates)) },
    candidates,
    notice: '核验仅证明收到的文本与指定保存文件一致；模型摘要和结构化建议的事实未核验。附件字节、隐藏分支和推理不在范围内。' };
}

export function historicalVerification(receipt, { currentRevision = null, pending = false } = {}) {
  return { version: 1, status: 'historical_receipt', method: 'durable_receipt_only', checkedAt: now(),
    requestedRevision: receipt.syncRevision ?? null, currentRevision, currentPending: pending,
    originallyVerified: receipt.verification?.status === 'verified',
    originalCheckedAt: receipt.verification?.checkedAt ?? null,
    notice: '本次只确认该请求过去的保存回执；当前文件或待完成版本不同，不代表旧正文已在本次重新核验。' };
}
