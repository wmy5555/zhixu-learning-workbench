import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createService } from '../src/service.mjs';
import { createOnboarding } from '../src/onboarding.mjs';
import { createApp } from '../src/server.mjs';

const tempRoot = path.resolve('.tmp');
fs.mkdirSync(tempRoot, { recursive: true });
function directory(t) {
  const root = fs.mkdtempSync(path.join(tempRoot, 'onboarding-isolation-'));
  const close = [];
  t.after(async () => {
    for (const fn of close.reverse()) await fn();
    assert.ok(root.startsWith(`${tempRoot}${path.sep}`));
    assert.match(path.basename(root), /^onboarding-isolation-/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, cleanup: fn => close.push(fn) };
}

async function practiceFixture(t) {
  const h = directory(t), dataDir = path.join(h.root, 'data');
  const main = createService({ dataDir, vaultDir: path.join(h.root, 'vault'), aiOverride: {
    async test() { return { message: '受控离线测试' }; },
    async generate(input) {
      assert.equal(input.privacy, 'cloud');
      return { text: JSON.stringify({ assessment: 'correct', feedback: '受控离线反馈。', nextQuestion: '怎样核对出处？' }) };
    },
  } });
  h.cleanup(() => main.close());
  const manager = createOnboarding({ dataDir, mainService: main });
  h.cleanup(() => manager.close());
  const state = manager.start();
  main.updateSettings({ ai: { enabled: true, model: 'controlled' } });
  await manager.test('model');
  const service = manager.currentService;
  const observe = details => manager.observe(state.practiceId, { method: 'POST', body: {}, query: {}, ...details });
  return { manager, service, state, observe };
}

test('practice refuses a formal Vault containing its data directory before seeding any files', async t => {
  const h = directory(t), dataDir = path.join(h.root, 'data');
  const main = createService({ dataDir, vaultDir: h.root, aiOverride: {} });
  h.cleanup(() => main.close());
  const manager = createOnboarding({ dataDir, mainService: main });
  h.cleanup(() => manager.close());
  assert.throws(() => manager.start(), { code: 'PRACTICE_VAULT_OVERLAP' });
  assert.equal(manager.state().practiceId, null);
  assert.equal(fs.existsSync(path.join(dataDir, 'onboarding')), false);
  main.store.scan();
  assert.deepEqual(main.store.list(), []);
});

test('sibling default directories remain isolated and all overlapping Vault destinations are rejected', async t => {
  const h = directory(t), dataDir = path.join(h.root, '.data'), vaultDir = path.join(h.root, 'vault');
  const main = createService({ dataDir, vaultDir, aiOverride: {} });
  h.cleanup(() => main.close());
  const manager = createOnboarding({ dataDir, mainService: main });
  h.cleanup(() => manager.close());
  const state = manager.start(), reserved = path.join(dataDir, 'onboarding');
  for (const candidate of [h.root, dataDir, reserved, manager.currentService.store.vaultDir, path.join(reserved, 'new-vault')]) {
    assert.throws(() => manager.assertVaultIsolation(candidate), { code: 'PRACTICE_VAULT_OVERLAP' });
  }
  assert.doesNotThrow(() => manager.assertVaultIsolation(vaultDir));
  assert.doesNotThrow(() => manager.assertVaultIsolation(path.join(h.root, 'another-vault')));
  assert.doesNotThrow(() => manager.assertVaultIsolation(path.join(dataDir, 'onboarding-other')));
  main.store.scan();
  assert.equal(main.store.row(state.roles.source), undefined);
  assert.equal(manager.currentService.store.list().length, 5);
});

test('existing directory aliases cannot bypass the practice Vault overlap check', async t => {
  const h = directory(t), dataDir = path.join(h.root, 'data'), vaultDir = path.join(h.root, 'vault');
  const main = createService({ dataDir, vaultDir, aiOverride: {} });
  h.cleanup(() => main.close());
  const manager = createOnboarding({ dataDir, mainService: main });
  h.cleanup(() => manager.close());
  manager.start();
  const alias = path.join(h.root, 'data-alias');
  fs.symlinkSync(dataDir, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => manager.assertVaultIsolation(path.join(alias, 'onboarding', 'new-vault')), { code: 'PRACTICE_VAULT_OVERLAP' });
  assert.doesNotThrow(() => manager.assertVaultIsolation(path.join(alias, 'unrelated-vault')));
});

test('formal settings reject a practice Vault before changing any configuration or writing a new directory', async t => {
  const h = directory(t), dataDir = path.join(h.root, 'data'), vaultDir = path.join(h.root, 'vault');
  const main = createService({ dataDir, vaultDir, aiOverride: {} });
  const app = createApp({ dataDir, service: main, scheduler: false });
  h.cleanup(() => app.close());
  const state = app.onboarding.start();
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const sessionResponse = await fetch(`${base}/api/session`);
  const cookie = sessionResponse.headers.get('set-cookie').split(';')[0], { csrf } = await sessionResponse.json();
  const settingsBefore = main.settings();
  const destinations = [app.onboarding.currentService.store.vaultDir, path.join(dataDir, 'onboarding', 'not-created')];
  for (const destination of destinations) {
    const response = await fetch(`${base}/api/settings`, { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ vaultDir: destination, dailyMinutes: 50 }) });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'PRACTICE_VAULT_OVERLAP');
    assert.deepEqual(main.settings(), settingsBefore);
    assert.equal(main.store.row(state.roles.source), undefined);
  }
  assert.equal(fs.existsSync(destinations[1]), false);
  assert.ok(app.onboarding.currentService.store.row(state.roles.source));
});

test('a submitted follow-up counts only after the second real feedback has arrived', async t => {
  const { manager, service, state, observe } = await practiceFixture(t);
  for (const id of [state.roles.source, state.roles.explain]) {
    const note = service.getNote(id);
    service.editNote(id, { expectedHash: note.hash, meta: { privacy: 'cloud' } });
  }
  service.promote(state.roles.explain, { stage: 'learning', reason: '受控练习' });
  const session = service.startStudy({ noteId: state.roles.explain });
  const answer = value => {
    const result = service.answerStudy(session.id, { answer: value, requestId: randomUUID() });
    observe({ resource: 'study', itemId: session.id, action: 'answer', result });
    return result;
  };
  answer('我的第一次真实回答：分别保存原文与解释。');
  for (let i = 0; i < 12 && service.store.records('jobs').some(job => job.state === 'queued'); i++) await manager.pump();
  const second = answer('我的补充回答：再记下章节位置，方便核对。');
  assert.equal(second.turns.filter(turn => turn.feedback).length, 1);
  assert.ok(second.pendingJobId);
  assert.equal(manager.state().progress['study-followup'].status, 'pending');
  await manager.pump();
  assert.equal(service.session(session.id).turns.filter(turn => turn.feedback).length, 2);
  assert.equal(manager.state().progress['study-followup'].status, 'done');
});

test('editing an unused draft is not evidence of removing an adoption', async t => {
  const { manager, service, state, observe } = await practiceFixture(t);
  const draft = await service.ask({ question: '读书', privacy: 'local' });
  assert.ok(draft.citations.length);
  const save = usedIds => {
    const body = { body: '我的编辑内容', usedIds }, result = service.updateDraft(draft.draftId, body);
    observe({ resource: 'drafts', itemId: draft.draftId, method: 'PUT', body, result });
    return result;
  };
  assert.deepEqual(save([]).removedUseIds, []);
  assert.equal(service.store.records('uses').length, 0);
  assert.equal(manager.state().progress['output-unuse'].status, 'pending');
  const adoptedId = draft.citations[0].id;
  save([adoptedId]);
  assert.equal(service.store.records('uses').length, 1);
  assert.equal(manager.state().progress['output-unuse'].status, 'pending');
  assert.deepEqual(save([]).removedUseIds, [adoptedId]);
  assert.equal(service.store.records('uses').length, 0);
  assert.equal(manager.state().progress['output-unuse'].status, 'done');
  assert.equal(service.store.get('drafts', draft.draftId).removedUseIds, undefined);
  assert.equal(manager.state().practiceId, state.practiceId);
});

test('finishing a preset session demonstrates only that case and leaves main practice unfinished', async t => {
  const { manager, service, state, observe } = await practiceFixture(t);
  const loaded = manager.caseAction(state.practiceId, 'hints');
  const result = service.finishStudy(loaded.roles.hintSession);
  observe({ resource: 'study', itemId: result.id, action: 'finish', result });
  assert.equal(result.status, 'completed');
  assert.equal(result.presetCase, 'hints');
  const progress = manager.state().progress;
  assert.equal(progress['review-hint-finish'].status, 'demonstrated');
  assert.equal(progress['study-finish'].status, 'pending');
  assert.equal(progress['study-feedback'].status, 'pending');
  assert.equal(progress['review-finish'].status, 'pending');
});

test('submitted answers cannot be relabeled as another day after feedback, failure or cancellation', async t => {
  for (const outcome of ['feedback', 'failed', 'cancelled']) {
    const { manager, service, state } = await practiceFixture(t);
    const note = service.store.create({ kind: 'knowledge', title: `隔日边界 ${outcome}`, body: '受控虚构练习，保存原文和出处。', meta: { privacy: 'cloud', stage: 'learning', depth: 'explain' } });
    const first = service.startStudy({ noteId: note.id });
    service.answerStudy(first.id, { answer: '第一次回答：保留出处便于核对。', requestId: randomUUID() });
    await manager.pump();
    service.finishStudy(first.id);
    const second = service.startStudy({ noteId: note.id });
    const submitted = service.answerStudy(second.id, { answer: '同一天再次回答：原文与解释分开。', requestId: randomUUID() });
    const generate = service.ai.generate;
    if (outcome === 'failed') service.ai.generate = async () => { throw new Error('受控反馈失败'); };
    if (outcome === 'cancelled') service.jobAction(submitted.pendingJobId, { action: 'cancel' });
    else await manager.pump();
    service.ai.generate = generate;
    const before = manager.state().clock.now;
    for (const action of ['day', 'next']) assert.throws(() => manager.advance(state.practiceId, action), { code: 'PRACTICE_BUSY' }, outcome);
    assert.ok(Date.parse(manager.state().clock.now) - Date.parse(before) < 1000);
    if (outcome !== 'feedback') { service.jobAction(submitted.pendingJobId, { action: 'retry' }); await manager.pump(); }
    assert.throws(() => manager.advance(state.practiceId, 'day'), { code: 'PRACTICE_BUSY' }, 'graded but unfinished answers remain on their original day');
    const finished = service.finishStudy(second.id);
    assert.equal(finished.completion.evidence.spacedRecall, false);
    assert.equal(finished.completion.sameDayPractice, true);
    assert.equal(finished.completion.interval, 1);
    assert.doesNotThrow(() => manager.advance(state.practiceId, 'day'));
  }
});

test('an empty reading session and explicitly preset answers do not block date controls', async t => {
  const { manager, service, state } = await practiceFixture(t);
  const note = service.store.create({ kind: 'knowledge', title: '尚未作答的虚构练习', body: '阅读材料。', meta: { privacy: 'cloud', stage: 'learning', depth: 'explain' } });
  const session = service.startStudy({ noteId: note.id });
  assert.deepEqual(session.turns, []);
  manager.caseAction(state.practiceId, 'hints');
  assert.doesNotThrow(() => manager.advance(state.practiceId, 'day'));
  assert.equal(service.session(session.id).status, 'reading');
});

test('a failed connection test clears earlier readiness and leaves practice writes blocked until an explicit success', async t => {
  const { manager, service, state } = await practiceFixture(t);
  assert.equal(manager.state().modelReady, true);
  let attempts = 0;
  service.ai.test = async () => { attempts++; throw Object.assign(new Error('受控连接失败，未访问外网'), { code: 'UPSTREAM_HTTP' }); };
  await assert.rejects(manager.test('model'), { code: 'UPSTREAM_HTTP' });
  assert.equal(manager.state().modelReady, false);
  assert.throws(() => manager.acquire(state.practiceId, { resource: 'import', method: 'POST' }), { code: 'MODEL_TEST_REQUIRED' });
  await manager.pump();
  assert.equal(attempts, 1, 'A failed test cannot silently retry a paid connection');
  service.ai.test = async () => { attempts++; return { message: '受控恢复成功，非供应商实测' }; };
  await manager.test('model');
  assert.equal(manager.state().modelReady, true);
  assert.equal(attempts, 2);
});

test('invalid model data and exhausted budget retain the same answer and require explicit retry without duplicate calls', async t => {
  for (const outcome of ['format', 'budget', 'connection']) {
    const { manager, service, state } = await practiceFixture(t);
    const note = service.store.create({ kind: 'knowledge', title: `受控故障 ${outcome}`, body: '原创虚构任务：为读书摘录保留位置。', meta: { privacy: 'cloud', stage: 'learning', depth: 'explain' } });
    const session = service.startStudy({ noteId: note.id });
    const answer = '保留原文与页码，读书分享时再核对适用范围。', requestId = randomUUID();
    let calls = 0, failing = true;
    service.ai.generate = async input => {
      calls++; assert.equal(input.privacy, 'cloud');
      if (failing && outcome === 'format') return { text: '这不是所需的反馈 JSON' };
      if (failing) throw Object.assign(new Error(`受控 ${outcome} 故障，未访问外网`), { code: outcome === 'budget' ? 'BUDGET_EXCEEDED' : 'UPSTREAM_HTTP' });
      return { text: JSON.stringify({ assessment: 'correct', feedback: '受控反馈：回答已保留并完成手动重试。' }) };
    };
    const submitted = service.answerStudy(session.id, { answer, requestId });
    assert.equal(service.answerStudy(session.id, { answer, requestId }).pendingJobId, submitted.pendingJobId);
    await manager.pump();
    const failed = service.store.get('jobs', submitted.pendingJobId);
    assert.equal(failed.state, outcome === 'budget' ? 'waiting' : 'failed');
    assert.equal(failed.code, outcome === 'format' ? 'MODEL_FORMAT' : outcome === 'budget' ? 'BUDGET_EXCEEDED' : 'UPSTREAM_HTTP');
    assert.equal(service.session(session.id).turns.length, 1);
    assert.equal(service.session(session.id).turns[0].answer, answer);
    assert.equal(service.session(session.id).turns[0].feedback, undefined);
    await manager.pump(); await manager.pump();
    assert.equal(calls, 1, 'Polling a failed or waiting job cannot cause another model request');
    assert.equal(manager.state().progress['study-feedback'].status, 'pending');
    assert.throws(() => manager.advance(state.practiceId, 'day'), { code: 'PRACTICE_BUSY' });
    failing = false;
    service.jobAction(submitted.pendingJobId, { action: 'retry' }); await manager.pump();
    assert.equal(calls, 2);
    const finished = service.finishStudy(session.id);
    assert.equal(finished.turns.length, 1);
    assert.equal(finished.turns[0].answer, answer);
    assert.equal(finished.status, 'completed');
    assert.equal(service.store.records('studyEvidence').length, 1);
  }
});
