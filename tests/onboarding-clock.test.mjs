import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createService } from '../src/service.mjs';
import { createAI } from '../src/ai.mjs';
import { promptDefaults } from '../src/prompts.mjs';

const tempRoot = path.resolve(import.meta.dirname, '..', '.tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const correct = { assessment: 'correct', feedback: '受控离线反馈：本轮解释满足目标。', nextQuestion: '换一个场景如何保留来源？' };
const offlineAI = { async generate() { return { text: JSON.stringify(correct) }; } };

function harness(t) {
  const root = fs.mkdtempSync(path.join(tempRoot, 'onboarding-clock-'));
  const services = new Set();
  const make = (name, options = {}) => {
    const service = createService({ dataDir: path.join(root, name, 'data'), vaultDir: path.join(root, name, 'vault'), aiOverride: offlineAI, ...options });
    services.add(service); return service;
  };
  t.after(async () => {
    for (const service of services) await service.close();
    const target = path.resolve(root);
    assert.ok(target.startsWith(`${tempRoot}${path.sep}`));
    assert.match(path.basename(target), /^onboarding-clock-/);
    fs.rmSync(target, { recursive: true, force: true });
  });
  return { root, make, async close(service) { await service.close(); services.delete(service); } };
}

function knowledge(service, title = '读书记录与出处', meta = {}) {
  return service.store.create({ kind: 'knowledge', title, body: '【虚构练习】小林记录读书观点时，同时保存原文、页码、自己的解释和适用条件。', meta: { privacy: 'cloud', stage: 'learning', depth: 'explain', ...meta } });
}

async function drain(service) {
  let iterations = 0;
  while (service.store.records('jobs').some(job => job.state === 'queued')) {
    assert.ok(iterations++ < 30, 'unexpected endless queue');
    await service.runJobs();
  }
}

async function practiceOnce(service, noteId) {
  const session = service.startStudy({ noteId });
  service.answerStudy(session.id, { answer: '先保留原文和页码，再写自己的理解，避免把推断当成原作者观点。', requestId: randomUUID() });
  await drain(service);
  return service.finishStudy(session.id);
}

test('practice advances independent study and adoption days without changing real files or another service', async t => {
  const h = harness(t), main = h.make('main');
  let simulated = Date.UTC(2040, 0, 1, 16);
  const practice = h.make('practice', { practice: true, learningClock: () => new Date(simulated), getExternalSettings: main.settings, aiOverride: main.ai });
  let note = knowledge(practice);
  const actualUpdatedAt = note.updatedAt;
  note = practice.confirmNote(note.id, { body: '我的理解：保留出处让读者能核对观点，区分原文和自己的推断。', expectedHash: note.hash });
  assert.equal(note.meta.confirmedAt, '2040-01-01T16:00:00.000Z');
  assert.ok(Math.abs(Date.parse(actualUpdatedAt) - Date.now()) < 5000);
  const mainDate = main.today().date;
  const initial = await practiceOnce(practice, note.id);
  assert.equal(initial.createdAt, '2040-01-01T16:00:00.000Z');
  assert.equal(initial.completion.interval, 1);
  assert.equal(initial.completion.evidence.day, '2040-01-02');
  assert.equal((await practiceOnce(practice, note.id)).completion.interval, 1);
  const firstDraft = await practice.ask({ question: '读书记录', privacy: 'local' });
  assert.equal(firstDraft.generated, false);
  practice.updateDraft(firstDraft.draftId, { usedIds: [note.id] });
  assert.equal(practice.store.records('uses')[0].at, '2040-01-01T16:00:00.000Z');
  simulated += 86400000;
  assert.equal(practice.today().items.find(item => item.noteId === note.id).kind, 'review');
  const second = await practiceOnce(practice, note.id);
  assert.equal(second.completion.interval, 2);
  assert.equal(second.completion.evidence.spacedRecall, true);
  const secondDraft = await practice.ask({ question: '读书记录', privacy: 'local' });
  practice.updateDraft(secondDraft.draftId, { usedIds: [note.id] });
  assert.equal(practice.recommendations().suggestions.some(item => item.targetStage === 'core'), false);
  simulated += 2 * 86400000;
  assert.equal((await practiceOnce(practice, note.id)).completion.interval, 4);
  assert.equal(practice.recommendations().suggestions.some(item => item.targetStage === 'core'), true);
  assert.equal(main.today().date, mainDate);
  assert.deepEqual(main.store.records('reviews'), []);
  assert.deepEqual(main.store.records('sessions'), []);
  assert.deepEqual(main.store.records('uses'), []);
  assert.ok(Math.abs(Date.parse(practice.getNote(note.id).updatedAt) - Date.now()) < 5000);
});

test('practice dates respect timezone and postponement uses the simulated clock', async t => {
  const h = harness(t);
  let simulated = Date.UTC(2040, 0, 1, 15, 59);
  const service = h.make('practice', { practice: true, learningClock: () => new Date(simulated) });
  service.updateSettings({ timezone: 'Asia/Singapore' });
  const note = knowledge(service), plan = service.today().items.find(item => item.noteId === note.id);
  assert.equal(plan.date, '2040-01-01');
  service.planAction(plan.id, { action: 'defer', days: 3 });
  assert.equal(service.store.get('reviews', note.id).dueAt, '2040-01-04T15:59:00.000Z');
  simulated += 120000;
  assert.equal(service.today().date, '2040-01-02');
  assert.equal(service.today().items.length, 0);
  simulated += 3 * 86400000;
  assert.equal(service.today().items.find(item => item.noteId === note.id).kind, 'review');
});

test('practice capability settings stay live and safe while secrets and paths cannot be written', async t => {
  const h = harness(t);
  let external = { ai: { enabled: true, baseUrl: 'https://8.8.8.8/v1', model: 'first', hasKey: true, apiKey: 'not-a-real-secret' }, fetch: { enabled: true, testUrl: 'https://example.com/' }, mcp: { enabled: true } };
  const service = h.make('practice', { practice: true, getExternalSettings: () => external });
  assert.equal(service.settings().ai.model, 'first');
  assert.equal(service.settings().ai.hasKey, true);
  assert.equal(service.settings().ai.apiKey, undefined);
  assert.equal(service.settings().mcp.enabled, false);
  for (const field of ['ai','embedding','search','fetch','mcp','vaultDir','dataDir','apiKey','clearKey']) {
    assert.throws(() => service.updateSettings({ [field]: field.endsWith('Dir') ? h.root : { enabled: true, apiKey: 'never-write' } }), { code: 'PRACTICE_SETTINGS_LOCKED' });
  }
  external = { ai: { enabled: true, model: 'second', hasKey: false } };
  assert.equal(service.settings().ai.model, 'second');
  service.updateSettings({ dailyMinutes: 15, focusTopics: ['读书'] });
  assert.equal(service.settings().dailyMinutes, 15);
  assert.equal(service.store.get('settings', 'main').ai, undefined);
  assert.equal(fs.existsSync(path.join(service.store.dataDir, 'secrets.enc.json')), false);
  assert.throws(() => createService({ practice: true }), { code: 'PRACTICE_PATH_REQUIRED' });
});

test('practice prompt edits invalidate only its own research results and never its unrelated cache', async t => {
  const h = harness(t), main = h.make('main'), practice = h.make('practice', { practice: true, getExternalSettings: main.settings });
  main.store.put('research', 'real-cache', { at: new Date().toISOString() });
  practice.store.put('research', 'practice-cache', { at: new Date().toISOString() });
  practice.updatePrompts({ prompts: { grade: `${promptDefaults.grade.template}\n请用简短中文反馈。` } });
  assert.equal(practice.store.records('research').length, 1);
  practice.updatePrompts({ prompts: { researchSearchSupport: '{{context}} 原始出处' } });
  assert.equal(practice.store.records('research').length, 0);
  assert.equal(main.store.records('research').length, 1);
  assert.equal(main.settings().prompts.researchSearchSupport, undefined);
});

test('pausing stops only practice jobs and retains the answer for explicit retry', async t => {
  const h = harness(t);
  let attempts = 0, interrupt = true;
  const ai = { async generate({ signal }) {
    attempts++;
    if (!interrupt) return { text: JSON.stringify(correct) };
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('offline cancelled'), { code: 'CANCELLED' })), { once: true }));
  } };
  const main = h.make('main'), service = h.make('practice', { practice: true, aiOverride: ai });
  const mainJob = main.queue('index', {}, 'main-index');
  const note = knowledge(service), session = service.startStudy({ noteId: note.id });
  const answer = service.answerStudy(session.id, { answer: '我先保存原文页码，再补充自己的理解。', requestId: 'once' });
  service.queue('index', {}, 'practice-index');
  const running = service.runJobs();
  assert.equal(service.processing, true);
  assert.equal(service.hasPendingOperations, true);
  await service.pauseJobs(); await running;
  assert.equal(service.processing, false);
  assert.equal(service.hasPendingOperations, false);
  assert.equal(service.session(session.id).pendingJobId, answer.pendingJobId);
  assert.equal(service.session(session.id).turns.length, 1);
  assert.ok(service.store.records('jobs').every(job => job.state === 'waiting'));
  await service.runJobs();
  assert.equal(attempts, 1);
  assert.equal(main.store.get('jobs', mainJob.id).state, 'queued');
  interrupt = false;
  service.jobAction(answer.pendingJobId, { action: 'retry' });
  await service.runJobs();
  assert.equal(service.session(session.id).status, 'feedback');
  assert.equal(attempts, 2);
});

test('practice pause waits for a direct output before the database can be closed', async t => {
  const h = harness(t);
  let release, answerStarted;
  const started = new Promise(resolve => { answerStarted = resolve; });
  let noteId;
  const service = h.make('practice', { practice: true, getExternalSettings: () => ({ ai: { enabled: true } }), aiOverride: { async generate() {
    answerStarted();
    await new Promise(resolve => { release = resolve; });
    return { text: JSON.stringify({ answer: `保留原文与自己的解释 [${noteId}]`, citationIds: [noteId] }) };
  } } });
  noteId = knowledge(service).id;
  const output = service.ask({ question: '读书记录', privacy: 'cloud' });
  await started;
  assert.equal(service.hasPendingOperations, true);
  let paused = false;
  const pendingPause = service.pauseJobs().then(() => { paused = true; });
  await Promise.resolve();
  assert.equal(paused, false);
  release();
  const result = await output;
  assert.equal(result.generated, true);
  await pendingPause;
  assert.equal(service.store.get('drafts', result.draftId).citations[0].id, noteId);
  assert.equal(service.hasPendingOperations, false);
});

test('an empty retrieval is explicitly not a model-generated draft', async t => {
  const h = harness(t);
  let calls = 0;
  const service = h.make('empty', { aiOverride: { async generate() { calls++; throw new Error('unexpected model call'); } } });
  const result = await service.ask({ question: '没有任何素材的虚构问题', mode: 'draft', privacy: 'cloud' });
  assert.equal(result.generated, false);
  assert.equal(calls, 0);
  assert.equal(typeof result.draftId, 'string');
  assert.deepEqual(result.citations, []);
});

test('semantic diagnostics distinguish real vector comparisons from every keyword fallback', async t => {
  const h = harness(t);
  let enabled = false, failure = false, calls = 0;
  const service = h.make('practice', { practice: true, getExternalSettings: () => ({ embedding: { enabled, model: 'controlled-vector' } }), aiOverride: { async embed() {
    calls++;
    if (failure) throw new Error('controlled embedding failure');
    return { vectors: [[1, 0]] };
  } } });
  const note = knowledge(service), local = knowledge(service, '本地资料', { privacy: 'local' });
  const search = (mode = 'semantic', privacy = 'cloud', question = '读书记录') => service.search(question, { mode, privacy });
  assert.equal((await search()).diagnostics.semanticUsed, false);
  assert.equal(calls, 0);
  enabled = true;
  assert.equal((await search('semantic', 'local')).diagnostics.semanticUsed, false);
  assert.equal((await search('keyword')).diagnostics.semanticUsed, false);
  assert.equal((await search('semantic', 'cloud', '')).diagnostics.semanticUsed, false);
  assert.equal(calls, 0);
  assert.equal((await search()).diagnostics.semanticUsed, false);
  const vectors = (id, vector, model = 'controlled-vector') => service.store.db.prepare('UPDATE index_chunks SET vector=?,model=? WHERE noteId=?').run(JSON.stringify(vector), model, id);
  vectors(local.id, [1, 0]);
  assert.equal((await search()).diagnostics.semanticUsed, false, 'private vectors must not qualify');
  vectors(note.id, [1, 0], 'old-model');
  assert.equal((await search()).diagnostics.semanticUsed, false, 'another embedding model must not qualify');
  vectors(note.id, [1]);
  assert.equal((await search()).diagnostics.semanticUsed, false, 'incompatible vector dimensions must not qualify');
  vectors(note.id, [0, 1]);
  const noMatch = await search();
  assert.equal(noMatch.diagnostics.semanticUsed, true, 'valid comparisons count even without a matching result');
  assert.deepEqual(noMatch.diagnostics.semanticIds, []);
  vectors(note.id, [1, 0]);
  for (const mode of ['semantic', 'hybrid']) {
    const result = await search(mode);
    assert.equal(result.diagnostics.semanticUsed, true);
    assert.deepEqual(result.diagnostics.semanticIds, [note.id]);
  }
  failure = true;
  const failed = await search('hybrid');
  assert.equal(failed.diagnostics.semanticUsed, false);
  assert.ok(failed.diagnostics.limitations.includes('controlled embedding failure'));
});

test('preset scenarios retain their label on derived learning records while preserving actual answers', async t => {
  const h = harness(t);
  for (const practice of [true, false]) {
    const service = h.make(practice ? 'practice' : 'main', { practice, aiOverride: { async generate() { return { text: JSON.stringify({ assessment: 'incorrect', feedback: '受控测试反馈。', omission: '遗漏出处', correction: '应保留原文和页码。' }) }; } } });
    const note = knowledge(service, '预设场景衍生记录', { presetCase: 'mistakes', demo: true, practice: true });
    const plan = service.today().items.find(item => item.noteId === note.id);
    service.planAction(plan.id, { action: 'defer' });
    assert.equal(service.store.get('reviews', note.id).presetCase, practice ? 'mistakes' : undefined);
    const session = service.startStudy({ noteId: note.id });
    const answer = '这是用户本次新写的真实回答，必须逐字保留。';
    service.answerStudy(session.id, { answer, requestId: randomUUID() });
    await drain(service);
    const finished = service.finishStudy(session.id);
    const mistake = service.store.list().find(item => item.kind === 'mistake');
    for (const record of [plan, session, finished.completion, finished.completion.evidence, service.store.get('studyEvidence', session.id), service.store.get('reviews', note.id), mistake.meta]) {
      assert.equal(record.presetCase, practice ? 'mistakes' : undefined);
      assert.equal(record.practice, practice ? true : undefined);
      assert.equal(record.demo, practice ? true : undefined);
    }
    assert.equal(finished.turns[0].answer, answer);
    assert.equal(finished.turns[0].presetCase, undefined, 'the new answer itself is not a preset');
    assert.ok(mistake.body.includes(answer));
    const plain = knowledge(service, '纠错练习继承场景');
    const labeledMistake = service.store.create({ kind: 'mistake', title: '预设错题', body: '预设错误上下文', meta: { noteId: plain.id, privacy: 'cloud', correctionState: 'open', presetCase: 'mistakes' } });
    assert.equal(service.startStudy({ mistakeId: labeledMistake.id }).presetCase, practice ? 'mistakes' : undefined);
  }
});

test('practice backup restore rejects the wrong destination and cannot replace external settings or resume jobs', async t => {
  const h = harness(t), main = h.make('main');
  const source = h.make('source', { practice: true });
  knowledge(source);
  source.updateSettings({ dailyMinutes: 15 });
  source.queue('index', {}, 'saved-work');
  const backup = source.backup();
  assert.equal(backup.purpose, 'onboarding-practice');
  assert.equal(backup.preferences.ai, undefined);
  assert.equal(backup.preferences.vaultDir, undefined);
  assert.throws(() => main.restore({ backup }), { code: 'BACKUP_PURPOSE_MISMATCH' });
  assert.throws(() => source.restore({ backup: main.backup() }), { code: 'BACKUP_PURPOSE_MISMATCH' });
  const target = h.make('target', { practice: true, getExternalSettings: () => ({ ai: { model: 'shared-model' } }) });
  const expectedVault = target.store.vaultDir;
  backup.preferences = { ...backup.preferences, vaultDir: h.root, dataDir: h.root, ai: { enabled: true, apiKey: 'never-restored' }, mcp: { enabled: true } };
  const preview = target.restore({ backup });
  const result = target.restore({ backup, preview: false, token: preview.token });
  assert.equal(target.store.vaultDir, expectedVault);
  assert.equal(target.settings().dailyMinutes, 15);
  assert.equal(target.settings().ai.model, 'shared-model');
  assert.equal(target.settings().mcp.enabled, false);
  assert.ok(target.store.records('jobs').every(job => job.state === 'waiting'));
  await target.runJobs();
  assert.ok(target.store.records('jobs').every(job => job.state === 'waiting'));
  assert.equal(fs.existsSync(path.join(target.store.dataDir, 'secrets.enc.json')), false);
  assert.equal(JSON.parse(fs.readFileSync(result.safetyBackup, 'utf8')).purpose, 'onboarding-practice');
});

test('practice restart holds both queued and running jobs without changing formal restart behavior', async t => {
  const h = harness(t), writer = h.make('restart');
  writer.queue('index', {}, 'queued');
  const running = writer.queue('index', {}, 'running');
  writer.store.put('jobs', running.id, { ...running, state: 'running' });
  await h.close(writer);
  const practice = h.make('restart', { practice: true });
  assert.ok(practice.store.records('jobs').every(job => job.state === 'waiting'));
  const main = h.make('main'); main.queue('index', {}, 'main'); await h.close(main);
  const reopened = h.make('main');
  assert.equal(reopened.store.records('jobs')[0].state, 'queued');
});

test('practice tick does not automatically schedule discoveries or daily plans', async t => {
  const h = harness(t), service = h.make('practice', { practice: true });
  knowledge(service);
  await service.tick();
  assert.deepEqual(service.store.records('jobs'), []);
  assert.deepEqual(service.store.records('plans'), []);
});

test('research expiry uses learning time while research cache timestamps stay real and prompts reach AI', async t => {
  const h = harness(t);
  let simulated = Date.UTC(2040, 0, 1), seenPrompts;
  const service = h.make('practice', { practice: true, learningClock: () => new Date(simulated), aiOverride: {
    async generate() { return { text: JSON.stringify({ candidates: [{ title: '读书项目主张', body: '【虚构】保存出处方便核对读书观点。', claims: ['合成可核查主张'] }] }) }; },
    async researchBatch({ claims, prompts }) { seenPrompts = prompts; return { results: claims.map(claim => ({ claim, conclusion: '受控离线研究结果', limitations: [], evidence: [{ title: '合成证据', url: 'https://example.com/fixture', excerpt: '合成正文片段', role: 'support', fetchedAt: new Date().toISOString() }] })) }; },
  } });
  service.updatePrompts({ prompts: { researchSearchSupport: '{{context}} 练习出处' } });
  const source = service.importItems({ items: [{ title: '合成输入', body: '【虚构】读书项目需要给观点保留出处。', privacy: 'cloud' }] }).notes[0];
  service.processNote(source.id, { research: true });
  await drain(service);
  const note = service.listNotes({ kind: 'knowledge' })[0];
  assert.equal(note.meta.reviewAfter, '2040-01-31T00:00:00.000Z');
  assert.equal(seenPrompts.researchSearchSupport, '{{context}} 练习出处');
  assert.ok(Math.abs(Date.parse(service.store.records('research')[0].at) - Date.now()) < 5000);
  service.promote(note.id, { stage: 'learning', reason: '练习复查到期' });
  assert.equal(service.getNote(note.id).meta.promotedAt, '2040-01-01T00:00:00.000Z');
  simulated += 31 * 86400000;
  assert.throws(() => service.startStudy({ noteId: note.id }), { code: 'RESEARCH_REQUIRED' });
  assert.match(service.noteEvidence(note.id).limitations.join(' '), /需要重新研究/);
});

test('shared AI keeps distinct per-request research templates across batch recursion and concurrent callers', async () => {
  const queries = [], calls = [];
  const settings = { ai: { enabled: true, baseUrl: 'https://8.8.8.8/v1', model: 'offline', dailyCallLimit: 30, sourceCallLimit: 12 }, search: { enabled: true, baseUrl: 'https://8.8.8.8' }, fetch: { enabled: true }, prompts: { researchSearchSupport: '{{context}} 正式支持', researchSearchOppose: '{{context}} 正式反证' } };
  const ai = createAI({ getSettings: () => settings, getSecret: () => 'offline-fixture', getUsage: () => ({ callsToday: calls.length, costMonth: 0 }), recordCall: call => calls.push(call), fetchImpl: async (url, options) => {
    assert.equal(new URL(url).pathname, '/search');
    queries.push(JSON.parse(options.body).query);
    return new Response(JSON.stringify({ results: [] }), { headers: { 'content-type': 'application/json' } });
  } });
  await Promise.all([
    ai.researchBatch({ claims: ['batch claim'], privacy: 'cloud', prompts: { researchSearchSupport: '{{context}} 练习支持', researchSearchOppose: '{{context}} 练习反证' } }),
    ai.research({ claim: 'single claim', privacy: 'cloud' }),
  ]);
  assert.equal(queries.filter(query => query.includes('练习')).length, 2);
  assert.equal(queries.filter(query => query.includes('正式')).length, 2);
  assert.equal(queries.some(query => query.includes('batch claim') && query.includes('正式')), false);
  assert.equal(settings.prompts.researchSearchSupport, '{{context}} 正式支持');
  assert.equal(calls.length, 4);
  await assert.rejects(ai.research({ claim: 'invalid', privacy: 'cloud', prompts: { researchSearchSupport: '缺少变量' } }), { code: 'INVALID_PROMPT' });
  assert.equal(calls.length, 4);
});

test('shared AI reserves one real daily budget across concurrent practice and formal requests', async () => {
  const calls = [];
  let sent = 0;
  const ai = createAI({ getSettings: () => ({ ai: { enabled: true, baseUrl: 'https://8.8.8.8/v1', model: 'offline', dailyCallLimit: 1 } }), getSecret: () => 'offline-fixture', getUsage: () => ({ callsToday: calls.length, costMonth: 0 }), recordCall: call => calls.push(call), fetchImpl: async () => {
    sent++; await new Promise(resolve => setTimeout(resolve, 5));
    return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { headers: { 'content-type': 'application/json' } });
  } });
  const results = await Promise.allSettled([ai.generate({ prompt: 'practice', privacy: 'cloud' }), ai.generate({ prompt: 'formal', privacy: 'cloud' })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'BUDGET_EXCEEDED');
  assert.equal(sent, 1);
  assert.equal(calls.length, 1);
});
