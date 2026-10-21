import { historySourceMetadata } from './chatgpt-source-metadata.mjs';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fail } from './store.mjs';
import { readHistoryHandoffKey } from './chatgpt-history-auth.mjs';

const referencePattern = /^zhixu-history-v1:([a-f0-9]{64})$/;
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const messageIdPattern = /^[A-Za-z0-9_-]{1,200}$/;
const same = (a, b) => a.message === b.message && a.offset === b.offset;
const after = (a, b) => a.message > b.message || (a.message === b.message && a.offset > b.offset);

export function snapshotPipePath(reference, { platform = process.platform, temp = tmpdir() } = {}) {
  const match = referencePattern.exec(reference);
  if (!match) fail('历史快照引用无效，请重新读取完整聊天。', 'CHATGPT_HISTORY_REF_INVALID');
  return platform === 'win32' ? `\\\\.\\pipe\\zhixu-history-${match[1]}` : join(temp, `zhixu-history-${match[1]}`, 'handoff.sock');
}

export function authenticateHistoryEnvelope(envelope, reference, key, expectedClaim) {
  if (!envelope || typeof envelope !== 'object' || !envelope.payload || typeof envelope.payload !== 'object' ||
    Array.isArray(envelope.payload) || !envelope.claim || typeof envelope.claim !== 'object' || typeof envelope.mac !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.mac) ||
    !Buffer.isBuffer(key) || key.length !== 32) {
    fail('历史快照来源无法认证；不会保存。', 'CHATGPT_HISTORY_AUTH');
  }
  const claim = envelope.claim;
  if (!expectedClaim || claim.requestId !== expectedClaim.requestId || claim.inputDigest !== expectedClaim.inputDigest ||
    claim.nonce !== expectedClaim.nonce || claim.issuedAt !== expectedClaim.issuedAt) {
    fail('历史读取响应与本次请求不匹配；不会保存。', 'CHATGPT_HISTORY_AUTH');
  }
  const expected = createHmac('sha256', key).update(reference + '\n' + JSON.stringify({ claim, payload: envelope.payload })).digest();
  if (!timingSafeEqual(expected, Buffer.from(envelope.mac, 'hex'))) {
    fail('历史快照来源无法认证；不会保存。', 'CHATGPT_HISTORY_AUTH');
  }
  return envelope.payload;
}

export async function receiveHistorySnapshot(reference, { timeout = 65000, maxBytes = 2 * 1024 * 1024, readAuthKey = readHistoryHandoffKey, requestId, inputDigest } = {}) {
  const path = snapshotPipePath(reference);
  const deadline = Date.now() + timeout;
  let key;
  try {
    // Authentication shares the IPC deadline. A late result is cleared and never used.
    key = await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => { settled = true; reject(new Error('历史读取认证超时。')); }, Math.max(1, deadline - Date.now()));
      Promise.resolve().then(() => readAuthKey()).then(value => {
        if (settled) { if (Buffer.isBuffer(value)) value.fill(0); return; }
        settled = true; clearTimeout(timer); resolve(value);
      }, error => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    });
    if (!Buffer.isBuffer(key) || key.length !== 32 || typeof requestId !== 'string' ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(requestId) || !/^[a-f0-9]{64}$/.test(inputDigest || '')) {
      throw new Error('invalid history handoff claim');
    }
    if (Date.now() >= deadline) throw new Error('历史读取认证超时。');
    const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    const receiveOnce = claim => new Promise((resolve, reject) => {
      const socket = connect({ path });
      const header = Buffer.alloc(4), chunks = [];
      let headerBytes = 0, expectedSize = null, size = 0, settled = false, ended = false, parsed = null, ackSent = false;
      const totalTimer = setTimeout(() => finish(new Error('历史快照传输超时。')), Math.max(1, deadline - Date.now()));
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(totalTimer);
        socket.destroy();
        error ? reject(error) : resolve(value);
      };
      const completeIfDrained = () => { if (ended && parsed && ackSent) finish(null, parsed); };
      const acknowledge = () => {
        if (parsed || expectedSize === null || size !== expectedSize) return;
        try {
          const envelope = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
          parsed = authenticateHistoryEnvelope(envelope, reference, key, claim);
          ackSent = true;
          socket.end(`ack:${claim.nonce}\n`, () => completeIfDrained());
        } catch { finish(new Error('历史快照格式或来源认证无效；请重新读取。')); }
      };
      socket.on('error', error => {
        if (error.code === 'EPIPE' && ackSent && parsed) return finish(null, parsed);
        const failure = new Error('历史快照不可用或已过期；请重新读取。');
        if (error.code === 'EPIPE' && headerBytes === 0) failure.code = 'HISTORY_PIPE_BUSY';
        finish(failure);
      });
      socket.on('close', () => {
        if (parsed && ackSent) finish(null, parsed);
        else finish(new Error('历史快照传输提前中断；请重新读取。'));
      });
      socket.on('connect', () => socket.write(JSON.stringify(claim) + '\n'));
      socket.on('data', chunk => {
        let offset = 0;
        if (expectedSize === null && headerBytes < header.length) {
          const copied = Math.min(header.length - headerBytes, chunk.length);
          chunk.copy(header, headerBytes, 0, copied); headerBytes += copied; offset += copied;
          if (headerBytes === header.length) {
            expectedSize = header.readUInt32LE(0);
            if (expectedSize < 1 || expectedSize > maxBytes) return finish(new Error('历史快照超过本地导入上限。'));
          }
        }
        if (expectedSize !== null && offset < chunk.length) {
          const remaining = expectedSize - size, received = chunk.length - offset;
          if (received > remaining) return finish(new Error('历史快照帧长度无效。'));
          chunks.push(chunk.subarray(offset)); size += received; acknowledge();
        }
      });
      socket.on('end', () => {
        ended = true;
        if (parsed && ackSent) completeIfDrained();
        else if (!parsed) finish(new Error('历史快照传输提前结束；请重新读取。'));
      });
    });
    let busyRetries = 0;
    while (true) {
      const claim = { requestId, inputDigest, nonce: randomBytes(32).toString('hex'), issuedAt: Date.now() };
      claim.mac = createHmac('sha256', key).update([reference, claim.requestId, claim.inputDigest, claim.nonce, claim.issuedAt].join('\n')).digest('hex');
      try { return await receiveOnce(claim); }
      catch (error) {
        if (process.platform !== 'win32' || error.code !== 'HISTORY_PIPE_BUSY' || busyRetries >= 4 || Date.now() + 50 >= deadline) throw error;
        await delay(50 * ++busyRetries);
      }
    }
  } catch {
    throw new Error('历史读取认证或传输不可用；请重新读取。');
  } finally { key?.fill(0); }
}

export function verifiedHistoryCapture(snapshot, input) {
  const { requestId, summary, structured, baseRevision } = input;
  const receivedAt = Date.now();
  if (snapshot?.version !== 1 || !idPattern.test(snapshot.conversation_id || '') ||
    !/^[a-f0-9]{32}$/.test(snapshot.snapshot_id || '') ||
    !/^[a-f0-9]{64}$/.test(snapshot.transcript_sha256 || '') ||
    typeof snapshot.title !== 'string' || !snapshot.title.trim() || snapshot.title.length > 200 ||
    snapshot.branch !== 'active' || snapshot.coverage?.text !== 'complete_visible_active_branch' ||
    !Array.isArray(snapshot.units) || snapshot.units.length < 1 || snapshot.units.length > 200 ||
    !Array.isArray(snapshot.pages) || snapshot.pages.length < 1 || snapshot.pages.length > 1000 ||
    !Number.isSafeInteger(snapshot.issued_at) || snapshot.issued_at > receivedAt ||
    snapshot.issued_at < receivedAt - 5 * 60 * 1000 ||
    !Number.isSafeInteger(snapshot.expires_at) || snapshot.expires_at <= receivedAt ||
    snapshot.expires_at > snapshot.issued_at + 5 * 60 * 1000) {
    fail('历史快照不完整、过期或格式无效；不会保存。', 'CHATGPT_HISTORY_INVALID');
  }
  const ids = new Set();
  for (const [index, unit] of snapshot.units.entries()) {
    if (unit?.index !== index || !messageIdPattern.test(unit.message_id || '') ||
      !['user', 'assistant'].includes(unit.role) || typeof unit.content !== 'string' ||
      !unit.content.trim() || unit.content.length > 120000 || ids.has(unit.message_id)) {
      fail('历史快照含有无法安全导入的消息；不会保存。', 'CHATGPT_HISTORY_INVALID');
    }
    ids.add(unit.message_id);
  }
  const digest = createHash('sha256').update(JSON.stringify(snapshot.units)).digest('hex');
  if (digest !== snapshot.transcript_sha256) fail('历史快照摘要不一致；不会保存。', 'CHATGPT_HISTORY_HASH');
  let expected = { message: 0, offset: 0 };
  for (const [index, page] of snapshot.pages.entries()) {
    if (!page?.range || !same(page.range.start, expected) || !after(page.range.end, expected) ||
      page.hasMore !== (index < snapshot.pages.length - 1)) {
      fail('历史快照分页不连续；不会保存。', 'CHATGPT_HISTORY_PAGES');
    }
    expected = page.range.end;
  }
  if (!same(expected, { message: snapshot.units.length, offset: 0 })) {
    fail('历史快照未读到末页；不会保存。', 'CHATGPT_HISTORY_PAGES');
  }
  const limitations = [
    '仅包含已授权读取的当前可见分支正文；隐藏推理、其他分支和附件字节未读取。',
    ...(Array.isArray(snapshot.warnings) ? snapshot.warnings : []),
  ].join('\n');
  return {
    requestId, title: snapshot.title, summary,
    messages: snapshot.units.map(unit => ({ id: unit.message_id, role: unit.role, content: unit.content })),
    coverage: 'visible_history', limitations,
    ...historySourceMetadata(snapshot),
    sync: {
      conversationId: snapshot.conversation_id, branchId: 'active', snapshotId: snapshot.snapshot_id,
      mode: 'snapshot', complete: true,
      ...(baseRevision === undefined ? {} : { baseRevision }),
      readerEvidence: { transcriptSha256: digest, pages: snapshot.pages },
    },
    ...(structured === undefined ? {} : { structured }),
  };
}
