import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createService } from '../src/service.mjs';
import { sourceBindingWarning } from '../public/source-membership.mjs';
import { createReaderData } from '../public/web/reader-data.mjs';

function library(t, aiOverride) {
  const temporary = path.resolve('.tmp');
  fs.mkdirSync(temporary, { recursive: true });
  const root = fs.mkdtempSync(path.join(temporary, 'source-integrity-'));
  const vaultDir = path.join(root, 'vault');
  const service = createService({
    dataDir: path.join(root, 'data'), vaultDir, aiOverride,
    learningClock: () => new Date('2026-11-28T12:00:00.000Z'),
  });
  t.after(async () => {
    await service.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  service.updateSettings({ dailyMinutes: 120 });
  return { service, vaultDir };
}

const ref = source => ({ id: source.id, role: 'input' });
const key = (source, order = 0) => `${source.id}:${source.hash}:${order}`;
function note(service, title, source, meta = {}) {
  return service.store.create({
    kind: 'knowledge', title, body: `合成材料正文 ${title}。\n\n## 证据与适用范围\n\n原样可读的末段。`,
    meta: { stage: 'learning', depth: 'explain', sources: source ? [ref(source)] : [], ...meta },
  });
}
function editOutside(vaultDir, note, meta) {
  const file = path.join(vaultDir, note.path);
  const data = ['---', JSON.stringify({ ...note.meta, id: note.id, kind: note.kind, title: note.title, ...meta }), '---', note.body].join('\n');
  fs.writeFileSync(file, data, 'utf8');
  return { file, data };
}
const pendingIds = plan => new Set(plan.items.filter(item => item.state === 'pending').map(item => item.noteId));

test('damaged source bindings pause only their own automatic plans while raw material stays readable', async t => {
  const { service, vaultDir } = library(t);
  const source = service.store.create({ kind: 'source', title: '合成原文', body: '完整原文仍可阅读。' });
  const healthy = note(service, '正常同组成员', source, { processKey: key(source, 2) });
  const legacy = note(service, '合法旧来源顺序', null, { processKey: key(source, '旧顺序') });
  const unrelated = note(service, '无关的正常资料', null);
  const badKey = note(service, '旧键类型损坏', source, { processKey: key(source, 3) });
  const badHash = note(service, '旧键缺少版本', source, { processKey: key(source, 4) });
  const badRefs = note(service, '关联列表中有损坏成员', source);
  const dependent = note(service, '依赖待修资料', null, { prerequisites: [badKey.id] });
  const initial = service.today();
  assert.equal(pendingIds(initial).size, 7);

  const edited = editOutside(vaultDir, badKey, { processKey: 7 });
  editOutside(vaultDir, badHash, { processKey: source.id + ':' });
  editOutside(vaultDir, badRefs, { sources: [ref(source), null] });
  const plan = service.today(), excluded = new Map(plan.unavailable.map(item => [item.noteId, item]));
  assert.deepEqual(pendingIds(plan), new Set([healthy.id, legacy.id, unrelated.id]));
  for (const damaged of [badKey, badHash, badRefs]) {
    assert.equal(excluded.get(damaged.id).code, 'material');
    assert.equal(excluded.get(damaged.id).reason, sourceBindingWarning);
    assert.equal(excluded.get(damaged.id).sourceId, undefined);
    assert.equal(service.store.get('plans', initial.items.find(item => item.noteId === damaged.id).id).state, 'paused');
  }
  assert.equal(excluded.get(dependent.id).prerequisiteId, badKey.id);

  const boot = service.bootstrap();
  const group = service.library().groups.find(group => group.source.id === source.id);
  const detail = service.readPublicNote(source.id);
  const reader = createReaderData({ getContext: () => ({ version: 0, revision: 0 }) });
  const preview = reader.peek(source.id, boot);
  const children = [healthy, legacy, badKey, badHash, badRefs].map(item => item.id);
  assert.deepEqual(new Set(group.children.map(item => item.id)), new Set(children));
  assert.deepEqual(detail.children.map(item => item.id), group.children.map(item => item.id));
  assert.deepEqual(preview.note.children, detail.children);
  assert.equal(detail.body, source.body);
  const damaged = service.readPublicNote(badKey.id);
  assert.match(damaged.body, /原样可读的末段/);
  assert.equal(damaged.sourceBindingInvalid, true);
  assert.deepEqual(service.readPublicNote(badRefs.id).meta.sources, [ref(source)]);
  const evidence = service.noteEvidence(badKey.id);
  assert.ok(evidence.limitations.includes(sourceBindingWarning));
  assert.equal(evidence.evidence[0].sourceId, source.id);
  assert.equal(evidence.evidence[0].excerpt, source.body);
  const readiness = reader.peek(badKey.id, boot).readiness;
  assert.equal(readiness.ready, true);
  assert.ok(readiness.warnings.includes(sourceBindingWarning));
  assert.equal(readiness.sourceId, undefined);
  const searched = await service.search(badKey.title, { scope: ['knowledge'], privacy: 'local' });
  assert.ok(searched.results.find(result => result.id === badKey.id)?.limitations.includes(sourceBindingWarning));
  const asked = await service.ask({ question: badKey.title, scope: ['knowledge'], privacy: 'local', requestId: 'synthetic-integrity-ask' });
  assert.equal(asked.citations.some(result => result.id === badKey.id), false);
  assert.equal(fs.readFileSync(edited.file, 'utf8'), edited.data);
  assert.throws(() => service.restore({ backup: service.backup() }), /备份 Markdown/);

  editOutside(vaultDir, badKey, { processKey: key(source, 3) });
  assert.ok(pendingIds(service.today()).has(badKey.id));
});

test('manual local practice saves answers without dispatching them or reusing them after repair', async t => {
  const prompts = [];
  const { service, vaultDir } = library(t, {
    async generate({ prompt }) {
      prompts.push(prompt);
      return { text: JSON.stringify({ assessment: 'correct', feedback: '合成反馈' }) };
    },
  });
  const source = service.store.create({ kind: 'source', title: '可读合成来源', body: '先区分来源。' });
  const item = note(service, '允许手动本地练习', source, { processKey: key(source) });
  editOutside(vaultDir, item, { processKey: false });
  const refreshed = service.getNote(item.id);
  assert.equal(service.store.outboundPrivacy(refreshed), 'local');
  assert.equal(pendingIds(service.today()).has(item.id), false);
  const session = service.startStudy({ noteId: item.id, requestId: 'synthetic-source-integrity' });
  assert.equal(session.privacy, 'local');
  assert.equal(session.outboundIntentVersion, undefined);
  assert.ok(session.materialWarnings.includes(sourceBindingWarning));
  assert.match(session.material, /原样可读的末段/);
  assert.equal(service.startStudy({ noteId: item.id, requestId: 'synthetic-source-integrity' }).id, session.id);
  const waiting = service.answerStudy(session.id, { answer: '合成的本人解释', requestId: 'synthetic-local-answer' });
  await service.runJobs();
  const job = service.store.get('jobs', waiting.pendingJobId);
  assert.equal(job.state, 'waiting');
  assert.equal(job.code, 'PRIVACY_LOCAL');
  assert.equal(service.session(session.id).turns[0].answer, '合成的本人解释');
  assert.equal(prompts.length, 0);
  assert.equal(service.store.records('calls').length, 0);

  editOutside(vaultDir, item, { processKey: key(source) });
  const repairedSession = service.startStudy({ noteId: item.id, requestId: 'synthetic-repaired-integrity' });
  assert.equal(repairedSession.privacy, 'cloud');
  const repaired = service.answerStudy(repairedSession.id, { answer: '新会话合成解释', requestId: 'synthetic-repaired-answer' });
  await service.runJobs();
  assert.equal(service.store.get('jobs', repaired.pendingJobId).state, 'done');
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /新会话合成解释/);
  assert.doesNotMatch(prompts[0], /合成的本人解释/);
});

test('background discovery still covers valid material and affected structural analysis stays blocked', async t => {
  const prompts = [];
  const { service, vaultDir } = library(t, {
    async generate({ prompt }) { prompts.push(prompt); return { text: JSON.stringify({ findings: [], relations: [] }) }; },
  });
  const source = service.store.create({ kind: 'source', title: '关联已损坏的来源', body: '第一段合成原文。' });
  const other = service.store.create({ kind: 'source', title: '关联完整的来源', body: '第二段合成原文。' });
  const broken = note(service, '隔离材料标记', source, { processKey: key(source) });
  note(service, '正常发现甲', other, { processKey: key(other), topic: '合成主题甲' });
  note(service, '正常发现乙', null, { topic: '合成主题乙' });
  const queued = service.requestSourceStructure(source.id);
  editOutside(vaultDir, broken, { processKey: { value: key(source) } });
  assert.throws(() => service.requestSourceStructure(source.id), { code: 'SOURCE_BINDING_INVALID' });
  await service.runJobs();
  assert.equal(service.store.get('jobs', queued.id).code, 'SOURCE_BINDING_INVALID');
  assert.throws(() => service.jobAction(queued.id, { action: 'retry' }), { code: 'SOURCE_BINDING_INVALID' });
  assert.equal(prompts.length, 0);

  await service.tick();
  const localReport = service.listNotes({ kind: 'report' })[0];
  assert.match(localReport.body, /正常发现甲/);
  assert.match(localReport.body, /正常发现乙/);
  assert.doesNotMatch(localReport.body, /隔离材料标记/);
  assert.ok(service.store.get('schedule', 'discovery').at);
  assert.equal(prompts.length, 0);

  service.updateSettings({ ai: { enabled: true, model: 'synthetic', baseUrl: 'https://example.invalid/v1' } });
  const requested = service.queue('discover', { useAI: true }, 'synthetic-explicit-discovery');
  await service.runJobs();
  assert.equal(service.store.get('jobs', requested.id).state, 'done');
  assert.match(prompts[0], /正常发现甲/);
  assert.match(prompts[0], /正常发现乙/);
  assert.ok(prompts.every(prompt => !prompt.includes('隔离材料标记')));
  assert.equal(service.requestSourceStructure(other.id).state, 'queued');
});
