import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createService } from '../src/service.mjs';
import { createAI } from '../src/ai.mjs';
import { processingText } from '../src/attachments.mjs';
import { outboundText } from '../src/outbound-text.mjs';
import { tinyPng } from './fixtures/source-files.mjs';

test('outgoing views remove managed inline, reference and HTML images while preserving handwritten text and local offsets', () => {
  const url = '../.zhixu-attachments/' + 'a'.repeat(64) + '.png';
  const handwriting = '[unfinished handwritten aside\r\n![remote description](https://example.com/image.png)\r\n';
  const input = handwriting + `![local filename](${url} "local title")\r\n![private alt][local]\r\n[local]: <${url}>\r\n<img alt="private html filename" src="${url}">\r\nHANDWRITTEN_AFTER`;
  assert.equal(outboundText(input), handwriting + '\r\n\r\n\r\n\r\nHANDWRITTEN_AFTER');
  const masked = outboundText(input, { preserveOffsets: true });
  assert.equal(masked.length, input.length);
  assert.equal(masked.indexOf('HANDWRITTEN_AFTER'), input.indexOf('HANDWRITTEN_AFTER'));
  assert.equal(masked.slice(0, handwriting.length), handwriting);
  assert.ok(!/local filename|private|\.zhixu-attachments|a{64}/.test(masked));
});

test('all external text transports filter managed images and still require explicit cloud permission', async () => {
  const markup = `![private filename](../.zhixu-attachments/${'b'.repeat(64)}.png)`, sent = [];
  const ai = createAI({ getSettings: () => ({ ai: { enabled: true, baseUrl: 'https://8.8.8.8/v1', model: 'synthetic' }, embedding: { enabled: true, baseUrl: 'https://8.8.8.8/v1', model: 'synthetic' }, search: { enabled: true, baseUrl: 'https://8.8.8.8' } }), getSecret: () => 'synthetic', getUsage: () => ({}), recordCall() {},
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body); sent.push(body);
      return new Response(JSON.stringify(String(url).includes('/embeddings') ? { data: [{ index: 0, embedding: [1] }] } : String(url).includes('/search') ? { results: [] } : { choices: [{ message: { content: 'synthetic' } }] }));
    } });
  await ai.generate({ prompt: 'HANDWRITTEN ' + markup, system: markup, privacy: 'cloud' });
  await ai.embed({ texts: ['HANDWRITTEN ' + markup], privacy: 'cloud' });
  await ai.search({ query: 'HANDWRITTEN ' + markup, privacy: 'cloud' });
  assert.equal(sent.length, 3);
  assert.ok(!/private filename|b{64}|\.zhixu-attachments/.test(JSON.stringify(sent)));
  assert.ok(sent.every(body => JSON.stringify(body).includes('HANDWRITTEN')));
  for (const operation of [() => ai.generate({ prompt: markup, privacy: 'local' }), () => ai.embed({ texts: [markup], privacy: 'local' }), () => ai.search({ query: markup, privacy: 'local' })]) await assert.rejects(operation, { code: 'PRIVACY_LOCAL' });
  assert.equal(sent.length, 3);
});

function fixture(t, offset = 0, temporaryTitle = false) {
  const parent = path.resolve(import.meta.dirname, '../.tmp');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'managed-image-outbound-'));
  let ai, reply = { candidates: [{ title: '合成观点', body: '合成手写观点。', claims: [], claimType: 'opinion' }], findings: [], queries: [], relations: [] };
  const sent = [];
  const service = createService({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'), aiOverride: {
    generate: options => ai.generate(options), embed: options => ai.embed(options),
    withBudget: (...args) => ai.withBudget(...args), withCallContext: (...args) => ai.withCallContext(...args),
  } });
  ai = createAI({ getSettings: () => service.settings(), getSecret: () => 'synthetic-test-only', getUsage: () => service.usage(), recordCall() {},
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body); sent.push({ url: String(url), body });
      const result = String(url).includes('/embeddings') ? { data: body.input.map((_, index) => ({ index, embedding: [1, 0] })) }
        : { choices: [{ message: { content: JSON.stringify(typeof reply === 'function' ? reply() : reply) } }] };
      return new Response(JSON.stringify(result));
    } });
  service.updateSettings({ ai: { enabled: true, baseUrl: 'https://8.8.8.8/v1', model: 'synthetic-model' }, embedding: { baseUrl: 'https://8.8.8.8/v1', model: 'synthetic-embedding' } });
  const receipt = service.uploadFile({ name: 'PRIVATE_IMAGE_FILENAME.png', bytes: tinyPng, mime: '', uploadId: randomUUID() });
  const markup = `![${receipt.attachment.name}](../.zhixu-attachments/${receipt.attachment.id})`;
  const body = temporaryTitle ? markup + '\nHANDWRITTEN_BEFORE\nHANDWRITTEN_AFTER' : 'HANDWRITTEN_BEFORE\n' + '甲'.repeat(offset) + markup + '\nHANDWRITTEN_AFTER';
  const imported = service.importItems({ items: [{ ...(!temporaryTitle ? { title: '合成外发边界' } : {}), body }] }).notes[0];
  const source = service.editNote(imported.id, { expectedHash: imported.hash, attachmentUploadIds: [receipt.id] });
  t.after(async () => { await service.close(); assert.equal(path.dirname(root), parent); fs.rmSync(root, { recursive: true, force: true }); });
  return { service, source, receipt, body, markup, sent, set reply(value) { reply = value; }, async run(job) {
    await service.runJobs();
    assert.equal(service.store.get('jobs', job.id).state, 'done', service.store.get('jobs', job.id).error);
  }, assertBoundary() {
    assert.ok(sent.length > 0);
    const outgoing = JSON.stringify(sent);
    assert.ok(!outgoing.includes(receipt.attachment.name), 'the generated image alt filename must stay local');
    assert.ok(!outgoing.includes(receipt.attachment.sha256), 'the image content identity must stay local');
    assert.ok(!outgoing.includes('.zhixu-attachments/'), 'the managed address must stay local');
    assert.match(outgoing, /HANDWRITTEN_BEFORE/);
    assert.equal(service.getNote(source.id).body, body);
    assert.ok(fs.readFileSync(path.join(service.store.vaultDir, source.path), 'utf8').includes(markup));
  } };
}

test('processing a text source with inline attachments keeps only its outgoing text representation clean', t => {
  const h = fixture(t);
  assert.equal(processingText(h.source), 'HANDWRITTEN_BEFORE\n\nHANDWRITTEN_AFTER');
  assert.ok(h.service.getNote(h.source.id).body.includes(h.markup));
});

test('a temporary title derived from an image-led source does not reintroduce truncated filenames into outgoing chunks', async t => {
  const h = fixture(t, 0, true), s = h.service;
  assert.ok(h.source.title.includes(h.receipt.attachment.name), 'the untouched local temporary title reproduces the derived-prefix boundary');
  s.updateSettings({ embedding: { enabled: true } });
  await h.run(s.queue('index', {}, 'synthetic-image-temporary-title'));
  h.assertBoundary();
});

for (const [operation, offset] of [['decomposition', 0], ['structure', 0], ['title', 0], ['ask', 5900], ['embedding', 660], ['relations', 4420], ['discovery', 820], ['topics', 1110], ['grading', 0]]) {
  test(`${operation} sends handwriting without local image details, including truncated or overlapping chunks`, async t => {
    const h = fixture(t, offset), s = h.service;
    if (operation === 'decomposition') await h.run(s.processNote(h.source.id));
    if (operation === 'structure') {
      s.store.create({ kind: 'knowledge', title: '合成子条目', body: '合成手写观点。', meta: { sources: [{ id: h.source.id, role: 'input' }], stage: 'candidate' } });
      h.reply = { structure: { hierarchy: [], edges: [] } };
      await h.run(s.requestSourceStructure(h.source.id));
    }
    if (operation === 'title') {
      const source = s.store.update(h.source.id, { expectedHash: h.source.hash, meta: { titlePending: true, titlePlaceholder: h.source.title } });
      h.reply = { sourceTitle: '合成新标题' };
      await h.run(s.queue('title', { noteId: source.id, hash: source.hash }, 'synthetic-title'));
    }
    if (operation === 'ask') {
      h.reply = { answer: `合成回答 [${h.source.id}]`, citationIds: [h.source.id] };
      await s.ask({ question: h.source.title, scope: ['source'], privacy: 'cloud', requestId: 'synthetic-image-ask' });
    }
    if (operation === 'embedding') {
      s.updateSettings({ embedding: { enabled: true } });
      await h.run(s.queue('index', {}, 'synthetic-image-index'));
      assert.ok(s.store.db.prepare('SELECT body FROM index_chunks WHERE noteId=?').all(h.source.id).some(chunk => chunk.body.includes(h.receipt.attachment.name)), 'local index and source remain intact');
    }
    if (['relations', 'discovery', 'topics', 'grading'].includes(operation)) {
      const note = s.store.create({ kind: 'knowledge', title: '合成手写知识', body: h.body, meta: { stage: 'learning' } });
      if (operation === 'relations') {
        s.store.create({ kind: 'knowledge', title: '合成比较观点', body: 'HANDWRITTEN_BEFORE\n' + '乙'.repeat(2970) + h.markup, meta: { stage: 'integrated' } });
        h.reply = { queries: [], relations: [] };
        await h.run(s.requestRelations(note.id, { useAI: true }));
      }
      if (operation === 'discovery') await h.run(s.queue('discover', { useAI: true }, 'synthetic-image-discovery'));
      if (operation === 'topics') {
        h.reply = { packages: [{ title: '合成学习包', noteIds: [note.id] }] };
        await h.run(s.queue('topics', {}, 'synthetic-image-topics'));
      }
      if (operation === 'grading') {
        h.reply = { assessment: 'correct', feedback: '合成反馈。', nextQuestion: '合成下一问。' };
        const session = s.startStudy({ noteId: note.id });
        s.answerStudy(session.id, { answer: '合成手写回答。', requestId: 'synthetic-image-answer' });
        await h.run(s.store.get('jobs', s.session(session.id).pendingJobId));
        assert.equal(s.session(session.id).material, h.body, 'the local learning snapshot is retained');
      }
    }
    h.assertBoundary();
  });
}
