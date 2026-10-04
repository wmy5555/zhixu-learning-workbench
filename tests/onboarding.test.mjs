import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createService } from '../src/service.mjs';
import { createOnboarding } from '../src/onboarding.mjs';
import { createApp } from '../src/server.mjs';
import { flatSteps } from '../public/onboarding-curriculum.mjs';

const tempRoot = path.resolve('.tmp');
fs.mkdirSync(tempRoot, { recursive: true });
function harness(t, { ai } = {}) {
  const root = fs.mkdtempSync(path.join(tempRoot, 'onboarding-'));
  const calls = [];
  const mockAI = ai || {
    async test(capability) { calls.push({ capability }); return { message: '受控测试响应，非真实供应商成功' }; },
    async generate(input) {
      assert.equal(input.privacy, 'cloud'); calls.push({ capability: 'model' });
      return { text: JSON.stringify({ assessment: 'correct', feedback: '受控离线反馈', nextQuestion: '如何换个场景说明？' }) };
    },
  };
  const dataDir = path.join(root, 'data');
  const main = createService({ dataDir, vaultDir: path.join(root, 'vault'), aiOverride: mockAI });
  const manager = createOnboarding({ dataDir, mainService: main });
  let current = manager;
  const beforeClose = [];
  t.after(async () => {
    for (const fn of beforeClose) await fn();
    await current.close(); await main.close();
    assert.ok(root.startsWith(tempRoot + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, main, manager, calls, dataDir, beforeClose: fn => beforeClose.push(fn), async reopen() {
    await current.close(); current = createOnboarding({ dataDir, mainService: main }); return current;
  }, async ready() {
    main.updateSettings({ ai: { enabled: true, baseUrl: 'https://example.com/v1', model: 'controlled-offline' } });
    manager.settingsChanged({ ai: {} }); await manager.test('model');
  } };
}

test('practice starts without mastery and requires a tested model for writes; unknown identities never fall back', async t => {
  const h = harness(t);
  const real = h.main.store.create({ kind: 'knowledge', title: '正式合成资料', body: '不得串库', meta: { privacy: 'local' } });
  const started = h.manager.start(), p = h.manager.currentService;
  assert.equal(started.modelReady, false);
  assert.ok(p.store.list().length >= 5);
  assert.equal(p.store.records('studyEvidence').length, 0);
  assert.equal(p.store.records('sessions').length, 0);
  assert.equal(p.store.list().some(n => n.meta.confirmedAt), false);
  assert.equal(p.store.row(real.id), undefined);
  assert.throws(() => h.manager.acquire(started.practiceId, { resource: 'import', method: 'POST' }), { code: 'MODEL_TEST_REQUIRED' });
  assert.throws(() => h.manager.acquire('../vault', { resource: 'notes', method: 'GET' }), { code: 'PRACTICE_NOT_FOUND' });
  assert.throws(() => h.manager.clientEvent(started.practiceId, 'study-feedback'), { code: 'INVALID_EVENT' });
  await h.ready();
  const lease = h.manager.acquire(started.practiceId, { resource: 'import', method: 'POST' });
  const imported = lease.service.importItems({ items: [{ title: '仅属于练习', body: '合成正文' }] });
  lease.release();
  assert.equal(h.main.store.row(imported.notes[0].id), undefined);
  assert.equal(h.main.store.read(real.id).body, '不得串库');
  assert.equal(p.ai, h.main.ai);
  assert.throws(() => p.updateSettings({ ai: { enabled: false } }), { code: 'PRACTICE_SETTINGS_LOCKED' });
  assert.equal(h.main.settings().ai.enabled, true);
});

test('practice clock advances actual review rules while main dates, files and API time remain real', async t => {
  const h = harness(t); const state = h.manager.start(); await h.ready();
  const p = h.manager.currentService;
  const note = p.store.create({ kind: 'knowledge', title: '合成复习目标', body: '只针对虚构报告保留出处。', meta: { stage: 'learning', depth: 'explain', privacy: 'cloud' } });
  const mainDay = h.main.today().date;
  async function practice() {
    const session = p.startStudy({ noteId: note.id });
    p.answerStudy(session.id, { answer: '虚构项目中我会保留原文与定位，方便核对。', requestId: randomUUID() });
    for (let i = 0; i < 15 && p.store.records('jobs').some(j => j.state === 'queued'); i++) await h.manager.pump();
    return p.finishStudy(session.id);
  }
  assert.equal((await practice()).completion.interval, 1);
  assert.equal((await practice()).completion.interval, 1);
  const due = p.store.get('reviews', note.id).dueAt;
  const next = h.manager.advance(state.practiceId, 'next');
  assert.ok(Date.parse(next.clock.now) > Date.parse(due));
  assert.equal((await practice()).completion.interval, 2);
  assert.equal(h.main.today().date, mainDay);
  assert.ok(Date.parse(p.store.read(note.id).updatedAt) < Date.parse(next.clock.now));
  assert.equal(h.manager.state().modelReady, true);
  assert.equal(h.main.store.records('studyEvidence').length, 0);
});

test('pause, restart and resume keep unstarted paid jobs waiting and preserve the simulated date', async t => {
  const h = harness(t); const start = h.manager.start(); await h.ready();
  const p = h.manager.currentService;
  const advanced = h.manager.advance(start.practiceId, 'day');
  const j = p.queue('process', { noteId: start.roles.source, hash: p.getNote(start.roles.source).hash }, 'pending-test');
  const count = h.calls.length;
  const reopened = await h.reopen(); const state = reopened.state();
  assert.equal(state.practiceId, start.practiceId); assert.equal(state.status, 'paused');
  assert.equal(reopened.currentService.store.get('jobs', j.id).state, 'waiting');
  assert.ok(Math.abs(Date.parse(state.clock.now) - Date.parse(advanced.clock.now)) < 1000);
  reopened.resume(start.practiceId); await reopened.pump();
  assert.equal(h.calls.length, count);
});

test('next review ignores overdue preset and paused items and prioritizes the main learning example', async t => {
  const h = harness(t), s = h.manager.start(); await h.ready();
  const p = h.manager.currentService;
  h.manager.caseAction(s.practiceId, 'hints');
  p.promote(s.roles.explain, { stage: 'learning', depth: 'explain', reason: '合成测试' });
  const dueAt = new Date(Date.parse(h.manager.state().clock.now) + 3 * 86400000).toISOString();
  p.store.put('reviews', s.roles.explain, { noteId: s.roles.explain, dueAt });
  const hint = h.manager.state().roles.hintKnowledge;
  p.store.put('reviews', hint, { noteId: hint, dueAt: '2020-01-01T00:00:00.000Z', presetCase: 'hints' });
  const advanced = h.manager.advance(s.practiceId, 'next');
  assert.ok(Date.parse(advanced.clock.now) > Date.parse(dueAt));
  assert.equal(p.store.records('studyEvidence').length, 0);
});

test('restoring an earlier practice also restores its object identities without importing completion evidence', async t => {
  const h = harness(t), first = h.manager.start(); await h.ready();
  h.manager.caseAction(first.practiceId, 'duplicates');
  const original = h.manager.state(), backup = h.manager.currentService.backup();
  const reset = await h.manager.reset(first.practiceId), p = h.manager.currentService;
  assert.notEqual(reset.roles.explain, original.roles.explain);
  const preview = p.restore({ backup });
  const result = p.restore({ backup, preview: false, token: preview.token });
  h.manager.observe(reset.practiceId, { resource: 'restore', method: 'POST', body: { backup, preview: false }, query: {}, result });
  const restored = h.manager.state();
  assert.deepEqual(restored.roles, original.roles);
  assert.deepEqual(restored.cases, original.cases);
  assert.equal(p.getNote(restored.roles.explain).id, original.roles.explain);
  assert.equal(restored.progress['library-merge-preview'].status, 'pending');
  assert.equal(h.main.store.list().length, 0);
});

test('restoring a legacy practice backup clears a newer scenario identity', async t => {
  const h = harness(t), first = h.manager.start(); await h.ready();
  const backup = h.manager.currentService.backup();
  const identity = backup.records.find(record => record.namespace === 'onboardingContext' && record.key === 'identity');
  const context = JSON.parse(identity.json); delete context.materialId;
  identity.json = JSON.stringify(context);
  const reset = await h.manager.reset(first.practiceId, 'reading'), service = h.manager.currentService;
  assert.equal(reset.materialId, 'reading');
  const preview = service.restore({ backup });
  const result = service.restore({ backup, preview: false, token: preview.token });
  h.manager.observe(reset.practiceId, { resource: 'restore', method: 'POST', body: { backup, preview: false }, query: {}, result });
  const restored = h.manager.state();
  assert.equal(restored.materialId, null);
  assert.deepEqual(restored.roles, first.roles);
  assert.equal(service.store.get('onboardingContext', 'identity').materialId, null);
  service.promote(restored.roles.explain, { stage: 'learning', depth: 'explain', reason: '受控旧备份测试' });
  assert.ok(service.startStudy({ noteId: restored.roles.explain }).question.includes(service.getNote(restored.roles.explain).title));
  assert.equal(h.main.store.list().length, 0);
});

test('pause waits for active requests; reset invalidates old identities and leaves main intact', async t => {
  const h = harness(t), first = h.manager.start(); await h.ready();
  const mainBefore = h.main.backup();
  const lease = h.manager.acquire(first.practiceId, { resource: 'notes', method: 'GET' });
  let paused = false;
  const pending = h.manager.pause(first.practiceId).then(() => { paused = true; });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(paused, false);
  assert.throws(() => h.manager.advance(first.practiceId, 'day'), { code: 'PRACTICE_BUSY' });
  lease.release(); await pending;
  const second = await h.manager.reset(first.practiceId);
  assert.notEqual(second.practiceId, first.practiceId);
  assert.throws(() => h.manager.acquire(first.practiceId, { resource: 'notes', method: 'GET' }), { code: 'PRACTICE_NOT_FOUND' });
  assert.deepEqual(h.main.backup().notes, mainBefore.notes);
});

test('connection receipts expire on configuration changes and a racing old test cannot restore readiness', async t => {
  let resolveTest;
  const h = harness(t, { ai: { test: () => new Promise(resolve => { resolveTest = resolve; }) } });
  h.manager.start(); h.main.updateSettings({ ai: { enabled: true, baseUrl: 'https://example.com', model: 'one' } });
  const testing = h.manager.test('model');
  h.manager.settingsChanged({ ai: {} }); resolveTest({ message: 'controlled' });
  await assert.rejects(testing, { code: 'CONFIG_CHANGED' });
  assert.equal(h.manager.state().modelReady, false);
});

test('checking or reading a step cannot fabricate successful AI processing', t => {
  const h = harness(t), s = h.manager.start();
  const step = flatSteps.find(item => item.check === 'process-done');
  assert.ok(step);
  const result = h.manager.checkpoint(s.practiceId, { stepId: step.id, mode: 'read', done: true });
  assert.notEqual(result.progress[step.id].status, 'done');
  assert.notEqual(result.progress[step.id].status, 'demonstrated');
});

test('external experience confirmations remain separate from observed MCP channel calls', t => {
  const h = harness(t), s = h.manager.start();
  h.manager.checkpoint(s.practiceId, { stepId: 'mcp-read', mode: 'external' });
  h.manager.checkpoint(s.practiceId, { stepId: 'obsidian-open', mode: 'external' });
  let state = h.manager.state();
  assert.equal(state.externalConnections.mcp.status, 'reported');
  assert.equal(state.externalConnections.obsidian.status, 'reported');
  assert.notEqual(state.progress['mcp-read'].status, 'done');
  h.main.store.put('mcpCalls', 'synthetic-channel-receipt', { operation: 'search', at: '2026-09-29T01:00:00.000Z', id: 'private-id-not-returned', resultCount: 0 });
  state = h.manager.state();
  assert.equal(state.externalConnections.mcp.status, 'observed');
  assert.deepEqual(state.externalConnections.mcp.operations, ['search']);
  assert.equal(JSON.stringify(state.externalConnections).includes('private-id-not-returned'), false);
  assert.equal(state.externalConnections.obsidian.editReported, false);
});

test('case loading alone never finishes a main or case exercise, and its actual action is only demonstrated', async t => {
  const h = harness(t), s = h.manager.start(); await h.ready();
  h.manager.caseAction(s.practiceId, 'hints');
  const loaded = h.manager.state(), p = h.manager.currentService;
  const step = flatSteps.find(item => item.id === 'review-hint-finish');
  assert.equal(loaded.progress[step.id].status, 'pending');
  const before = loaded.cases.hints.at;
  const result = p.finishStudy(loaded.roles.hintSession);
  h.manager.observe(s.practiceId, { resource: 'study', itemId: loaded.roles.hintSession, action: 'finish', method: 'POST', body: {}, query: {}, result });
  assert.equal(h.manager.state().progress[step.id].status, 'demonstrated');
  assert.notEqual(h.manager.state().progress['study-finish'].status, 'done');
  h.manager.caseAction(s.practiceId, 'hints');
  assert.equal(h.manager.state().cases.hints.at, before);
  assert.equal(h.manager.state().progress[step.id].status, 'demonstrated');
});

test('fallback answers and semantic fallback never become successful AI or embedding exercises', async t => {
  const h = harness(t), s = h.manager.start(); await h.ready();
  const p = h.manager.currentService;
  const answer = await p.ask({ question: '读书', privacy: 'local', mode: 'draft' });
  h.manager.observe(s.practiceId, { resource: 'ask', method: 'POST', body: { mode: 'draft' }, query: {}, result: answer });
  const searched = await p.search('读书', { mode: 'semantic', privacy: 'local' });
  h.manager.observe(s.practiceId, { resource: 'search', method: 'GET', body: {}, query: { mode: 'semantic' }, result: searched });
  const state = h.manager.state();
  assert.notEqual(state.progress['output-draft'].status, 'done');
  assert.notEqual(state.progress['search-semantic'].status, 'done');
});

test('queued feedback blocks time jumps, and preconfigured jobs never spend money after a connection change', async t => {
  const h = harness(t), s = h.manager.start(); await h.ready();
  const p = h.manager.currentService;
  p.queue('grade', { sessionId: 'placeholder' }, 'guard');
  assert.throws(() => h.manager.advance(s.practiceId, 'day'), { code: 'PRACTICE_BUSY' });
  h.manager.settingsChanged({ ai: {} });
  const count = h.calls.length;
  await h.manager.pump();
  assert.equal(h.calls.length, count);
  assert.equal(p.store.records('jobs')[0].state, 'queued');
});

test('explicitly ending an invalid unfinished practice preserves answers and unlocks time without mastery', async t => {
  const h = harness(t), state = h.manager.start(); await h.ready();
  const p = h.manager.currentService;
  const note = p.store.create({ kind: 'knowledge', title: '受控失效会话', body: '仅用于本次练习', meta: { privacy: 'cloud', stage: 'learning', depth: 'explain' } });
  const session = p.startStudy({ noteId: note.id });
  p.answerStudy(session.id, { answer: '我提交的原回答需要原样保留。', requestId: randomUUID() });
  p.editNote(note.id, { expectedHash: note.hash, body: '材料已改变，旧会话不能继续结算。' });
  for (let i = 0; i < 10 && p.store.records('jobs').some(j => j.state === 'queued'); i++) await h.manager.pump();
  assert.throws(() => h.manager.advance(state.practiceId, 'day'), { code: 'PRACTICE_BUSY' });
  assert.ok(h.manager.state().unfinishedSessions.some(s => s.id === session.id));
  const calls = h.calls.length;
  const ended = h.manager.abandon(state.practiceId, session.id);
  assert.equal(ended.unfinishedSessions.length, 0);
  assert.equal(p.session(session.id).turns[0].answer, '我提交的原回答需要原样保留。');
  assert.equal(p.session(session.id).completion.abandoned, true);
  const oldJob = p.store.records('jobs').find(j => j.type === 'grade');
  p.jobAction(oldJob.id, { action: 'retry' }); await h.manager.pump();
  assert.equal(h.calls.length, calls, 'Retrying an explicitly ended session cannot make another paid request');
  h.manager.advance(state.practiceId, 'day');
  assert.equal(p.store.records('studyEvidence').length, 0);
  assert.equal(p.store.records('reviews').length, 0);
  const finished = p.finishStudy(session.id);
  h.manager.observe(state.practiceId, { resource: 'study', itemId: session.id, action: 'finish', method: 'POST', body: {}, query: {}, result: finished });
  assert.equal(h.manager.state().progress['study-finish'].status, 'pending');
});

test('sample permissions and depth steps are proved for their own role, not another note', async t => {
  const h = harness(t), s = h.manager.start(); await h.ready();
  const p = h.manager.currentService, source = p.getNote(s.roles.source);
  const result = p.editNote(source.id, { expectedHash: source.hash, meta: { privacy: 'cloud' } });
  h.manager.observe(s.practiceId, { resource: 'notes', itemId: source.id, method: 'PUT', body: { meta: { privacy: 'cloud' } }, query: {}, result });
  assert.equal(h.manager.state().progress['study-source-permission'].status, 'done');
  assert.notEqual(h.manager.state().progress['study-permission'].status, 'done');
  const aware = p.getNote(s.roles.aware);
  const edited = p.editNote(aware.id, { expectedHash: aware.hash, meta: { depth: 'aware' } });
  h.manager.observe(s.practiceId, { resource: 'notes', itemId: aware.id, method: 'PUT', body: { meta: { depth: 'aware' } }, query: {}, result: edited });
  assert.equal(h.manager.state().progress['library-aware'].status, 'pending');
  const promoted = p.promote(aware.id, { stage: 'reference', depth: 'aware', reason: '虚构练习只需知道存在' });
  h.manager.observe(s.practiceId, { resource: 'notes', itemId: aware.id, action: 'promote', method: 'POST', body: { stage: 'reference', depth: 'aware' }, query: {}, result: promoted });
  assert.equal(h.manager.state().progress['library-aware'].status, 'done');
});

test('unchanged edits preserve source versions while stale saves and real edits retain their restrictions', async t => {
  const h = harness(t), state = h.manager.start(); await h.ready();
  const p = h.manager.currentService, source = p.getNote(state.roles.source);
  const knowledge = p.store.create({ kind: 'knowledge', title: '合成拆解', body: '保留版本', meta: { stage: 'learning', sources: [{ id: source.id, role: 'input' }], processKey: `${source.id}:${source.hash}:0` } });
  const historyLength = p.store.history(source.id).length;
  assert.equal(p.editNote(source.id, { expectedHash: source.hash, title: source.title, body: source.body, meta: { privacy: source.meta.privacy } }).hash, source.hash);
  assert.equal(p.store.history(source.id).length, historyLength);
  assert.deepEqual(p.noteEvidence(knowledge.id).limitations, []);
  const edited = p.editNote(source.id, { expectedHash: source.hash, body: source.body + '\n真实修改（合成数据）' });
  assert.notEqual(edited.hash, source.hash);
  assert.match(p.noteEvidence(knowledge.id).limitations.join(), /原始资料已修改/);
  assert.ok(!p.today().items.some(item => item.noteId === knowledge.id));
  assert.equal(p.today().unavailable.find(item => item.noteId === knowledge.id).sourceId, source.id);
  assert.throws(() => p.editNote(source.id, { expectedHash: source.hash, body: edited.body }), { code: 'CONFLICT' });
  assert.throws(() => p.editNote(source.id, { body: edited.body }), { code: 'CONFLICT' });
  const revised = p.editNote(source.id, { expectedHash: edited.hash, meta: { locator: '新增合成来源定位' } });
  assert.notEqual(revised.hash, edited.hash, 'a real metadata change still creates a new version');
});

test('old unscoped generate clicks need actual main plan use or completion to preserve progress', async t => {
  const h = harness(t), started = h.manager.start(); await h.ready();
  await h.manager.close();
  const file = path.join(h.dataDir, 'onboarding', 'state.json'), saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  saved.practice.events['today-generate'] = [{ at: new Date().toISOString(), entities: ['generate'] }];
  fs.writeFileSync(file, JSON.stringify(saved));
  const restored = await h.reopen(); restored.resume(started.practiceId);
  const p = restored.currentService;
  assert.equal(restored.state().progress['study-plan'].status, 'pending', 'an old empty click is insufficient');
  const unrelated = p.store.create({ kind: 'knowledge', title: '非主线', body: '合成正文', meta: { stage: 'learning' } });
  p.today();
  assert.equal(restored.state().progress['study-plan'].status, 'pending', 'unrelated plans cannot prove the main step');
  p.promote(started.roles.explain, { stage: 'learning', reason: '合成选学' });
  const plan = p.today().items.find(item => item.noteId === started.roles.explain);
  assert.equal(restored.state().progress['study-plan'].status, 'pending', 'a pending plan alone cannot upgrade an old empty click');
  const session = p.startStudy({ noteId: started.roles.explain, planId: plan.id });
  assert.equal(restored.state().progress['study-plan'].status, 'done');
  p.store.remove('sessions', session.id);
  p.store.put('plans', plan.id, { ...plan, state: 'done' });
  assert.equal(restored.state().progress['study-plan'].status, 'done', 'finished plans preserve old actual scheduling even across later dates');
  restored.advance(started.practiceId, 'day');
  assert.equal(restored.state().progress['study-plan'].status, 'done');
  p.store.put('plans', plan.id, { ...plan, state: 'done', presetCase: 'hints' });
  assert.equal(restored.state().progress['study-plan'].status, 'pending', 'preset cases do not repair real progress');
  assert.ok(p.store.row(unrelated.id));
});

test('HTTP scopes keep CSRF, reuse browser sessions and reject cross-purpose restores and settings writes', async t => {
  const h = harness(t); const app = createApp({ dataDir: h.dataDir, service: h.main, scheduler: false });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  h.beforeClose(async () => { await new Promise(resolve => app.server.close(resolve)); await app.onboarding.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const sessionRes = await fetch(base + '/api/session');
  const cookie = sessionRes.headers.get('set-cookie').split(';')[0], session = await sessionRes.json();
  async function req(route, body, { csrf = session.csrf } = {}) {
    const res = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, data: await res.json() };
  }
  assert.equal((await req('/api/session')).data.csrf, session.csrf);
  assert.equal((await req('/api/onboarding/start', {}, { csrf: 'wrong' })).status, 403);
  const started = (await req('/api/onboarding/start', {})).data;
  h.main.updateSettings({ ai: { enabled: true, baseUrl: 'https://example.com', model: 'controlled' } });
  assert.equal((await req('/api/onboarding/test', { capability: 'model' })).data.modelReady, true);
  const prefix = `/api/practice/${started.practiceId}`;
  const imported = (await req(prefix + '/import', { items: [{ title: 'HTTP练习', body: '虚构' }] })).data;
  assert.equal(h.main.store.row(imported.notes[0].id), undefined);
  const backup = (await req(prefix + '/backup')).data;
  assert.equal(backup.purpose, 'onboarding-practice');
  assert.equal((await req('/api/restore', { backup })).status, 409);
  assert.equal((await req(`/api/practice/${randomUUID()}/bootstrap`)).status, 404);
  const preview = await req(prefix + '/restore', { backup, preview: true });
  assert.equal(preview.status, 200);
  assert.equal((await req(prefix + '/restore', { backup, preview: false, token: preview.data.token })).status, 200);
});
