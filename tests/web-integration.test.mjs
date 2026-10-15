import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createService } from '../src/service.mjs';
import { BACKUP_MAX_BYTES, assertBackupSize } from '../src/backup-contract.mjs';
import { includeAttachments } from '../src/attachment-backup.mjs';
import { tinyPng, tinyPdf, legacyDoc, docx } from './fixtures/source-files.mjs';

function harness(t, aiOverride) {
  const parent = path.resolve(import.meta.dirname, '../.tmp');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'web-integration-'));
  const service = createService({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'), ...(aiOverride ? { aiOverride } : {}) });
  t.after(async () => { await service.close(); assert.equal(path.dirname(root), parent); fs.rmSync(root, { recursive: true, force: true }); });
  return service;
}
const upload = (service, name, bytes) => service.uploadFile({ name, bytes, mime: '', uploadId: randomUUID() });

test('explicit DOCX decomposition uses verified extracted text while ordinary attachment saves stay local', async t => {
  const requests = [], service = harness(t, { async generate(request) {
    requests.push(request);
    return { text: JSON.stringify({ candidates: [{ title: '合成提取观点', body: '合成提取观点与边界。', claims: [], claimType: 'opinion' }] }) };
  } });
  for (const [name, bytes] of [['合成.png', tinyPng], ['合成.pdf', tinyPdf], ['合成.doc', legacyDoc]]) {
    const receipt = upload(service, name, bytes), { note } = await service.commitFile({ uploadId: receipt.id });
    assert.throws(() => service.processNote(note.id), { code: 'SOURCE_FILE_ONLY' });
    assert.equal(requests.length, 0);
  }
  const receipt = upload(service, '合成.docx', await docx('VERIFIED_ORIGINAL_EXTRACTION'));
  const { note } = await service.commitFile({ uploadId: receipt.id });
  assert.equal(requests.length, 0);
  assert.equal(service.store.records('jobs').length, 0);
  service.editNote(note.id, { expectedHash: note.hash, body: 'USER_ADDITIONAL_NOTES_ARE_NOT_EXTRACTED_TEXT' });
  const job = service.processNote(note.id);
  await service.runJobs();
  assert.equal(service.store.get('jobs', job.id).state, 'done');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].privacy, 'cloud');
  assert.match(requests[0].prompt, /VERIFIED_ORIGINAL_EXTRACTION/);
  assert.doesNotMatch(requests[0].prompt, /USER_ADDITIONAL_NOTES_ARE_NOT_EXTRACTED_TEXT/);
  assert.match(service.getNote(note.id).body, /USER_ADDITIONAL_NOTES/);
});

test('attachment restore preserves local unresolved billing, exact bytes and explicit task confirmation', async t => {
  const source = harness(t), target = harness(t), receipt = upload(source, '合成.png', tinyPng);
  const { note } = await source.commitFile({ uploadId: receipt.id });
  const material = source.importItems({ items: [{ title: '合成待处理原文', body: '需要主动继续的合成原文。' }], process: true });
  const backup = source.backup(), at = new Date().toISOString();
  assert.equal(backup.version, 2);
  assert.equal(backup.records.some(row => row.namespace === 'attachmentUploads'), false);
  const local = { id: 'local-unknown', phase: 'unknown', capability: 'model', model: 'synthetic', reservedCost: null, createdAt: at, updatedAt: at };
  target.store.put('callLedger', local.id, local);
  target.store.put('calls', local.id, { id: local.id, cost: null, createdAt: at });
  backup.records.push({ namespace: 'callLedger', key: local.id, json: JSON.stringify({ ...local, phase: 'accounted' }) });
  backup.records.push({ namespace: 'calls', key: local.id, json: JSON.stringify({ id: local.id, cost: 0, createdAt: at }) });
  backup.records.push({ namespace: 'callResults', key: local.id, json: JSON.stringify({ id: local.id,
    response: { status: 200, body: '{}', headers: {} }, entry: { capability: 'model', model: 'synthetic', cost: 0, ok: true, durationMs: 1 }, receivedAt: at }) });
  const preview = target.restore({ backup });
  target.restore({ backup, preview: false, token: preview.token });
  assert.deepEqual(target.readFile(note.id, receipt.attachment.id).bytes, tinyPng);
  assert.deepEqual(target.store.get('callLedger', local.id), local);
  assert.equal(target.store.get('calls', local.id).cost, null);
  assert.equal(target.store.get('jobs', material.jobs[0].id).state, 'waiting');
  assert.equal(target.settings().ai.enabled, false);
  assert.equal(target.settings().mcp.enabled, false);
  assert.equal(target.pendingUploads().length, 0);
  await target.runJobs();
  assert.equal(target.store.get('jobs', material.jobs[0].id).state, 'waiting');
  const restored = target.backup();
  assert.equal(restored.version, 2);
  assert.deepEqual(restored.attachments[0].base64, tinyPng.toString('base64'));
  const forged = structuredClone(restored);
  forged.records.push({ namespace: 'attachmentUploads', key: receipt.id, json: JSON.stringify(receipt) });
  assert.throws(() => target.store.validateBackup(forged), /备份运行记录/);
});

test('attachment envelopes retain the existing 100 MB complete-backup budget above 80 MB', async t => {
  const service = harness(t), receipt = upload(service, '合成.png', tinyPng);
  await service.commitFile({ uploadId: receipt.id });
  const backup = service.backup();
  const json = JSON.stringify({ text: 'x'.repeat(4_900_000) });
  for (let i = 0; i < 18; i++) backup.records.push({ namespace: 'integrationEvidence', key: 'synthetic-' + i, json });
  const combined = includeAttachments(service.store.vaultDir, backup);
  const bytes = Buffer.byteLength(assertBackupSize(combined));
  assert.ok(bytes > 80 * 1024 * 1024 && bytes < BACKUP_MAX_BYTES);
  assert.equal(service.store.validateBackup(combined).attachments, 1);
  combined.records.push(...Array.from({ length: 3 }, (_, i) => ({ namespace: 'integrationEvidence', key: 'over-' + i, json })));
  assert.throws(() => service.store.validateBackup(combined), { code: 'TOO_LARGE' });
});
