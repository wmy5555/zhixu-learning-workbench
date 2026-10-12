import { createHash } from 'node:crypto';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fail } from './store.mjs';

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

export async function receiveHistorySnapshot(reference, { timeout = 65000, maxBytes = 2 * 1024 * 1024 } = {}) {
  const path = snapshotPipePath(reference);
  return new Promise((resolve, reject) => {
    const socket = connect({ path });
    const chunks = [];
    let size = 0, settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      error ? reject(error) : resolve(value);
    };
    socket.setTimeout(timeout, () => finish(new Error('历史快照传输超时。')));
    socket.on('error', () => finish(new Error('历史快照不可用或已过期；请重新读取。')));
    socket.on('close', () => finish(new Error('历史快照传输提前中断；请重新读取。')));
    socket.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) return finish(new Error('历史快照超过本地导入上限。'));
      chunks.push(chunk);
    });
    socket.on('end', () => {
      try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { finish(new Error('历史快照传输格式无效。')); }
    });
  });
}

export function verifiedHistoryCapture(snapshot, input) {
  const { requestId, summary, structured, baseRevision } = input;
  if (snapshot?.version !== 1 || !idPattern.test(snapshot.conversation_id || '') ||
    !/^[a-f0-9]{32}$/.test(snapshot.snapshot_id || '') ||
    !/^[a-f0-9]{64}$/.test(snapshot.transcript_sha256 || '') ||
    typeof snapshot.title !== 'string' || !snapshot.title.trim() || snapshot.title.length > 200 ||
    snapshot.branch !== 'active' || snapshot.coverage?.text !== 'complete_visible_active_branch' ||
    !Array.isArray(snapshot.units) || snapshot.units.length < 1 || snapshot.units.length > 200 ||
    !Array.isArray(snapshot.pages) || snapshot.pages.length < 1 || snapshot.pages.length > 1000 ||
    !Number.isFinite(snapshot.expires_at) || snapshot.expires_at <= Date.now()) {
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
    conversationUrl: `https://chatgpt.com/c/${snapshot.conversation_id}`,
    sync: {
      conversationId: snapshot.conversation_id, branchId: 'active', snapshotId: snapshot.snapshot_id,
      mode: 'snapshot', complete: true,
      ...(baseRevision === undefined ? {} : { baseRevision }),
      readerEvidence: { transcriptSha256: digest, pages: snapshot.pages },
    },
    ...(structured === undefined ? {} : { structured }),
  };
}
