import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createService } from '../src/service.mjs';

const tempRoot = path.resolve(import.meta.dirname, '..', '.tmp');
function harness(t, aiOverride) {
  fs.mkdirSync(tempRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(tempRoot, 'design-edge-review-'));
  const service = createService({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'), aiOverride });
  t.after(async () => {
    await service.close();
    assert.ok(path.resolve(root).startsWith(`${tempRoot}${path.sep}`));
    assert.match(path.basename(root), /^design-edge-review-/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return service;
}
function knowledge(service, title, meta = {}, body = '用于受控审阅的合成正文，包含条件与边界。') {
  return service.store.create({ kind: 'knowledge', title, body, meta: { stage: 'candidate', privacy: 'cloud', depth: 'explain', ...meta } });
}

test('index batches recheck later notes after an earlier external request before sending newly local content', async t => {
  const sent = [];
  let later;
  const s = harness(t, { embed: async ({ texts }) => {
    sent.push(texts);
    if (sent.length === 1) s.store.update(later.id, { expectedHash: s.getNote(later.id).hash, meta: { privacy: 'local' }, body: '现在必须留在本地的修订正文。' });
    return { vectors: texts.map(() => [1, 0]) };
  } });
  s.updateSettings({ embedding: { enabled: true, model: 'offline-edge-test' } });
  later = knowledge(s, '第二个才被处理的笔记');
  knowledge(s, '首先处理的笔记');
  s.queue('index', { incremental: true }, 'privacy-between-notes');
  await s.runJobs();
  assert.equal(sent.length, 1, 'a later note changed to local during an earlier request must not be sent');
  assert.equal(s.store.db.prepare('SELECT body FROM index_chunks WHERE noteId=?').get(later.id).body.includes('现在必须留在本地的修订正文'), true);
});

test('index batches do not replace a later edited note with the batch opening snapshot', async t => {
  const sent = [];
  let later;
  const s = harness(t, { embed: async ({ texts }) => {
    sent.push(texts);
    if (sent.length === 1) s.store.update(later.id, { expectedHash: s.getNote(later.id).hash, body: 'EDITED_WHILE_EARLIER_NOTE_WAS_EMBEDDING' });
    return { vectors: texts.map(() => [1, 0]) };
  } });
  s.updateSettings({ embedding: { enabled: true, model: 'offline-edge-test' } });
  later = knowledge(s, '稍后处理的内容', {}, 'OLD_BATCH_OPENING_SNAPSHOT');
  knowledge(s, '先等待向量返回的内容');
  s.queue('index', {}, 'body-between-notes');
  await s.runJobs();
  assert.equal(sent[1][0].includes('EDITED_WHILE_EARLIER_NOTE_WAS_EMBEDDING'), true);
  assert.equal(s.store.db.prepare('SELECT body FROM index_chunks WHERE noteId=?').get(later.id).body.includes('EDITED_WHILE_EARLIER_NOTE_WAS_EMBEDDING'), true);
});

test('relation exploration stops before a second model request after permission is revoked during query generation', async t => {
  const prompts = [];
  let subject;
  const s = harness(t, { generate: async ({ prompt }) => {
    prompts.push(prompt);
    if (prompts.length === 1) {
      s.store.update(subject.id, { expectedHash: s.getNote(subject.id).hash, meta: { privacy: 'local' } });
      return { text: JSON.stringify({ queries: [] }) };
    }
    return { text: JSON.stringify({ relations: [] }) };
  } });
  s.updateSettings({ ai: { enabled: true } });
  subject = knowledge(s, '主知识', { topic: '领域甲' });
  knowledge(s, '可比较知识', { topic: '领域乙' });
  const job = s.requestRelations(subject.id, { useAI: true });
  await s.runJobs();
  assert.equal(prompts.length, 1, 'revoked material must not be included in a subsequent model call');
  assert.notEqual(s.store.get('jobs', job.id).state, 'done');
});

test('core suggestions count actual-use days in the same local timezone as study evidence', t => {
  const s = harness(t), note = knowledge(s, '核心建议时区边界', { stage: 'integrated', confirmedAt: '2026-08-01' });
  s.updateSettings({ timezone: 'Asia/Shanghai' });
  for (let i = 1; i <= 3; i++) s.store.put('studyEvidence', `day-${i}`, { noteId: note.id, day: `2026-09-0${i}`, completedAt: '2026-09-10T12:00:00Z', assessment: 'correct', reviewSettled: true, independent: true, depth: 'apply' });
  // Both records are on September 5 locally, despite straddling two UTC dates.
  s.store.put('uses', 'morning', { noteId: note.id, actualUse: true, at: '2026-09-04T16:01:00Z' });
  s.store.put('uses', 'night', { noteId: note.id, actualUse: true, at: '2026-09-05T15:59:00Z' });
  assert.equal(s.recommendations().suggestions.some(item => item.noteId === note.id && item.targetStage === 'core'), false);
});

test('a managed link to a newly local target cannot carry its copied title into a cloud exploration before link synchronization', async t => {
  const prompts = [];
  const s = harness(t, { generate: async ({ prompt }) => { prompts.push(prompt); return { text: JSON.stringify(prompts.length === 1 ? { queries: [] } : { relations: [] }) }; } });
  s.updateSettings({ ai: { enabled: true } });
  let from = knowledge(s, '持有管理链接的知识', { topic: '领域甲' });
  const to = knowledge(s, 'COPIED_LINK_TITLE_NOW_LOCAL', { topic: '领域乙' });
  const id = 'managed-link-privacy-edge';
  s.store.put('relations', id, { id, fromId: from.id, toId: to.id, fromHash: from.hash, toHash: to.hash, state: 'suggested', type: 'support', explanation: '合成的支持联系', use: '用于边界复现', boundary: '只有上述合成条件' });
  s.relationAction(id, { action: 'accept' });
  from = s.getNote(from.id);
  assert.equal(from.meta.privacy, 'cloud');
  assert.equal(from.body.includes('COPIED_LINK_TITLE_NOW_LOCAL'), true);
  s.store.update(to.id, { expectedHash: s.getNote(to.id).hash, meta: { privacy: 'local' } });
  assert.equal(s.linksPreview(from.id).privacyChanged, true);
  const job = s.requestRelations(from.id, { useAI: true });
  await s.runJobs();
  assert.equal(prompts.length, 0, 'a pending privacy downgrade must block sending the existing managed-link title');
  assert.notEqual(s.store.get('jobs', job.id).state, 'done');
});
