import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createService } from '../src/service.mjs';
import { createRecycleBin } from '../src/recycle-bin.mjs';
import { missingLocalSourceWarning, sourceBindingWarning } from '../public/source-membership.mjs';
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

test('confirmed local source removals isolate only their existing references and recovery resumes planning', async t => {
  const prompts = [];
  const { service, vaultDir } = library(t, {
    async generate({ prompt }) { prompts.push(prompt); return { text: JSON.stringify({ findings: [], relations: [] }) }; },
  });
  const store = service.store;
  const source = title => store.create({ kind: 'source', title, body: '可核对的合成原文 ' + title });
  const appSource = source('由网页删除'), fileSource = source('由外部文件删除'), live = source('仍在库的旧来源'), edited = source('保持学习的改版原文');
  const explicit = note(service, '显式输入待恢复', appSource);
  const legacy = note(service, '旧键输入待恢复', null, { processKey: key(appSource, '旧顺序') });
  const mixed = note(service, '多来源输入待恢复', live, { sources: [ref(live), ref(appSource)], processKey: key(live) });
  const external = note(service, '外部移除输入待恢复', fileSource);
  const historical = note(service, '合法历史排序仍可学', null, { processKey: key(live, '旧顺序') });
  const revised = note(service, '改版输入仍可学', edited, { processKey: key(edited) });
  const unknown = note(service, '外部来源从未收录仍可学', null, { sources: [{ id: 'never-indexed-external', role: 'input' }], url: 'https://example.invalid/reference' });
  const independent = note(service, '无关联的知识仍可学', null);
  const before = service.today();
  assert.equal(pendingIds(before).size, 8);

  store.delete(appSource.id, appSource.hash);
  const file = path.join(vaultDir, fileSource.path), raw = fs.readFileSync(file);
  fs.unlinkSync(file);
  service.editNote(edited.id, { expectedHash: edited.hash, body: edited.body + '\n合成修订' });
  assert.equal(store.get('deleted', fileSource.id), null, 'an external removal has history without an application tombstone');

  const prepared = store.db.prepare.bind(store.db), probed = [];
  const probes = t.mock.method(store.db, 'prepare', sql => {
    const statement = prepared(sql);
    if (!sql.includes('FROM versions WHERE noteId=?')) return statement;
    return { get(id) { probed.push(id); return statement.get(id); } };
  });
  const after = service.today();
  probes.mock.restore();
  assert.deepEqual(new Set(probed), new Set([appSource.id, fileSource.id, 'never-indexed-external']));
  assert.equal(probed.length, 3, 'one indexed history probe per distinct missing identity, even when several notes share one source');
  assert.deepEqual(pendingIds(after), new Set([historical.id, revised.id, unknown.id, independent.id]));
  for (const damaged of [explicit, legacy, mixed, external]) {
    const unavailable = after.unavailable.find(item => item.noteId === damaged.id);
    assert.equal(unavailable.reason, missingLocalSourceWarning);
    assert.equal(unavailable.sourceId, undefined);
    assert.equal(store.get('plans', before.items.find(item => item.noteId === damaged.id).id).state, 'paused');
    assert.ok(service.noteEvidence(damaged.id).limitations.includes(missingLocalSourceWarning));
    assert.equal(store.outboundPrivacy(service.getNote(damaged.id)), 'local');
    assert.match(service.readPublicNote(damaged.id).body, /原样可读的末段/);
  }
  assert.match(after.items.find(item => item.noteId === revised.id).materialWarnings.join(), /原始资料已修改/);
  assert.deepEqual(service.noteEvidence(unknown.id).limitations, []);
  assert.deepEqual(service.noteEvidence(mixed.id).evidence.map(item => [item.sourceId, item.excerpt]), [[live.id, live.body]]);
  assert.equal(service.readPublicNote(live.id).body, live.body);
  const boot = service.bootstrap(), reader = createReaderData({
    getContext: () => ({ version: 0, revision: 0 }),
    get: async route => route === '/api/relations' ? { relations: [] }
      : route.endsWith('/evidence') ? service.noteEvidence(mixed.id) : service.readPublicNote(mixed.id),
  });
  for (const reading of [reader.peek(mixed.id, boot), await reader.load(mixed.id, boot)]) {
    assert.deepEqual(reading.readiness.warnings, [missingLocalSourceWarning]);
    assert.equal(reading.readiness.ready, true);
    assert.equal(reading.readiness.sourceId, undefined);
    assert.match(reading.note.body, /原样可读的末段/);
  }
  assert.equal(service.getNote(mixed.id).meta.researchLimitations, undefined);
  assert.throws(() => service.requestSourceStructure(live.id), { code: 'SOURCE_BINDING_INVALID', message: missingLocalSourceWarning });

  await service.tick();
  const localReport = service.listNotes({ kind: 'report' })[0];
  assert.match(localReport.body, /合法历史排序仍可学|无关联的知识仍可学/);
  for (const damaged of [explicit, legacy, mixed, external]) assert.ok(!localReport.body.includes(damaged.title));
  service.updateSettings({ ai: { enabled: true, model: 'synthetic', baseUrl: 'https://example.invalid/v1' } });
  const cloud = service.queue('discover', { useAI: true }, 'synthetic-discovery-after-removal');
  await service.runJobs();
  assert.equal(store.get('jobs', cloud.id).state, 'done');
  assert.match(prompts[0], /无关联的知识仍可学/);
  for (const damaged of [explicit, legacy, mixed, external]) assert.ok(prompts.every(prompt => !prompt.includes(damaged.title)));

  const localStudy = service.startStudy({ noteId: explicit.id, requestId: 'synthetic-study-with-missing-source' });
  assert.equal(localStudy.privacy, 'local');
  assert.ok(localStudy.materialWarnings.includes(missingLocalSourceWarning));
  const saved = service.answerStudy(localStudy.id, { answer: '原件恢复前的本人本地回答', requestId: 'synthetic-answer-before-source-recovery' });
  const beforeRestore = prompts.length;

  const removedVersion = store.history(appSource.id).find(item => item.reason === '用户删除');
  store.restoreVersion(appSource.id, removedVersion.versionId);
  fs.writeFileSync(file, raw);
  const resumed = service.today();
  assert.equal(pendingIds(resumed).size, 8);
  assert.equal(service.readPublicNote(fileSource.id).body, fileSource.body);
  assert.equal(service.readPublicNote(appSource.id).body, appSource.body);
  await service.runJobs();
  assert.equal(store.get('jobs', saved.pendingJobId).code, 'PRIVACY_LOCAL');
  assert.equal(service.session(localStudy.id).turns[0].answer, '原件恢复前的本人本地回答');
  assert.equal(prompts.length, beforeRestore);
});

test('emptying the recycle bin retains only the identity needed by surviving source references', async t => {
  const { service, vaultDir } = library(t), store = service.store, bin = createRecycleBin(store);
  const original = store.create({ kind: 'source', title: '需要确实删除的合成标题', body: '需要确实删除的合成正文', meta: { custom: '需要确实删除的合成属性' } });
  const unused = store.create({ kind: 'source', title: '没有入站引用的合成文件', body: '无引用合成正文' });
  const explicit = note(service, '仍有显式来源关联', original);
  const legacy = note(service, '仍有旧加工键关联', null, { processKey: key(original, '旧顺序') });
  const external = note(service, '从未收录的外部引用', null, { sources: [{ id: 'never-seen-local-original', role: 'input' }] });
  const originalPath = path.join(vaultDir, original.path), raw = fs.readFileSync(originalPath);
  store.delete(original.id, original.hash);
  store.delete(unused.id, unused.hash);
  assert.deepEqual(pendingIds(service.today()), new Set([external.id]));
  const preview = bin.list(), trashed = preview.items.find(item => item.id === original.id);
  const claims = store.records('fileRecovery').map(item => path.join(vaultDir, item.holdingPath));
  const remove = store.remove.bind(store), failure = new Error('合成事务中断');
  const interruption = t.mock.method(store, 'remove', (namespace, id) => {
    if (namespace === 'deleted' && id === original.id) throw failure;
    return remove(namespace, id);
  });
  assert.throws(() => bin.clear({ confirmed: true, revision: preview.revision }), error => error === failure);
  interruption.mock.restore();
  assert.equal(store.get('purgedSourceIds', original.id), null);
  assert.equal(bin.list().revision, preview.revision);
  assert.ok(claims.every(file => fs.existsSync(file)));
  assert.deepEqual(bin.clear({ confirmed: true, revision: preview.revision }), { cleared: 2 });

  assert.deepEqual(pendingIds(service.today()), new Set([external.id]));
  for (const child of [explicit, legacy]) {
    assert.equal(store.outboundPrivacy(service.getNote(child.id)), 'local');
    assert.deepEqual(service.noteEvidence(child.id).limitations, [missingLocalSourceWarning]);
    assert.match(service.readPublicNote(child.id).body, /原样可读的末段/);
  }
  assert.equal(store.outboundPrivacy(service.getNote(external.id)), 'cloud');
  assert.deepEqual(service.getNote(explicit.id).meta.sources, [ref(original)]);
  assert.deepEqual(store.history(original.id), []);
  assert.equal(store.get('deleted', original.id), null);
  assert.ok([originalPath, ...claims].every(file => !fs.existsSync(file)));
  assert.equal(bin.list().pendingCleanup, 0);
  assert.throws(() => bin.restore(original.id, trashed.versionId), { code: 'RECYCLE_CONFLICT' });

  const serialized = JSON.stringify(service.backup());
  const backup = JSON.parse(serialized), marker = { namespace: 'purgedSourceIds', key: original.id, json: '{}' };
  assert.deepEqual(backup.records.filter(r => r.namespace === marker.namespace), [marker]);
  for (const text of [original.title, original.body, original.meta.custom, original.path]) assert.ok(!serialized.includes(text));
  const { service: restored } = library(t);
  const invalid = { ...backup, records: backup.records.map(r => r.namespace === marker.namespace ? { ...r, json: '{"title":"合成多余属性"}' } : r) };
  assert.throws(() => restored.restore({ backup: invalid }), /备份缺失来源记录无效/);
  const { token } = restored.restore({ backup });
  restored.restore({ backup, preview: false, token });
  assert.deepEqual(pendingIds(restored.today()), new Set([external.id]));
  assert.equal(restored.store.outboundPrivacy(restored.getNote(explicit.id)), 'local');

  fs.writeFileSync(originalPath, raw);
  assert.deepEqual(pendingIds(service.today()), new Set([explicit.id, legacy.id, external.id]));
  assert.equal(store.outboundPrivacy(service.getNote(explicit.id)), 'cloud');
  store.delete(original.id, original.hash);
  const next = bin.list();
  assert.deepEqual(bin.purge(original.id, next.items[0].versionId, { confirmed: true, revision: next.revision }), { cleared: 1 });
  assert.deepEqual(bin.clear({ confirmed: true, revision: bin.list().revision }), { cleared: 0 });
  assert.deepEqual(pendingIds(service.today()), new Set([external.id]));
  assert.deepEqual(service.backup().records.filter(r => r.namespace === marker.namespace).map(r => ({ ...r })), [marker]);
});
