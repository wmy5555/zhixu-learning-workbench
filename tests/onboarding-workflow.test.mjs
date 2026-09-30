import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createApp } from '../src/server.mjs';
import { createService } from '../src/service.mjs';
import { flatSteps, readingExample } from '../public/onboarding-curriculum.mjs';

const marker = '【离线受控全流程测试，非真实供应商返回】';
const tempRoot = path.resolve(import.meta.dirname, '..', '.tmp');
fs.mkdirSync(tempRoot, { recursive: true });

function controlledAI() {
  const calls = [], controls = { assessment: 'correct' };
  const record = type => calls.push({ type, marker });
  return { calls, controls, api: {
    async test(capability) { record(`test:${capability}`); return { message: marker }; },
    async generate(input) {
      assert.equal(input.privacy, 'cloud', 'Controlled responses still require real privacy authorization');
      record('generate');
      const prompt = input.prompt;
      const ids = [...new Set([...prompt.matchAll(/"id":"([a-z0-9-]+)"/g)].map(match => match[1]))];
      let result;
      if (prompt.includes('"candidates"')) result = { candidates: [{ title: `${marker} 为小岚的虚构读书报告保留出处`, body: `${marker} 在小岚的虚构任务里，观点、原文和定位分别保存，便于回到原文核对。`, topic: '读书与知识整理', claims: [], prerequisites: [], reason: marker, depth: 'explain' }] };
      else if (prompt.includes('"assessment"')) result = { assessment: controls.assessment, feedback: `${marker} 请核对原文和自己的解释。`, nextQuestion: `${marker} 换一种分享时怎样核对？`, ...(controls.assessment === 'incorrect' ? { omission: `${marker} 忽略了原文位置。`, correction: `${marker} 同时保留摘录及其位置。` } : {}) };
      else if (prompt.includes('"citationIds"')) { assert.ok(ids.length); result = { answer: `${marker} 为这次虚构报告保留原文与定位，再核对边界。 [${ids[0]}]`, citationIds: ids.slice(0, 1) }; }
      else if (prompt.includes('"packages"')) { assert.ok(ids.length); result = { packages: [{ title: `${marker} 读书学习包`, problem: '怎样为虚构报告保留出处', noteIds: ids.slice(0, 2), prerequisites: [], minutes: 20 }] }; }
      else if (prompt.includes('"queries"')) result = { queries: ['读书 出处'] };
      else if (prompt.includes('"relations"')) result = { relations: [] };
      else result = `${marker} 本地结构检查报告。`;
      return { text: typeof result === 'string' ? result : JSON.stringify(result) };
    },
    async embed({ texts, privacy }) { assert.equal(privacy, 'cloud'); record('embed'); return { vectors: texts.map(() => [1, 0.5, 0.25]) }; },
    async research() { throw new Error('The fictional opinion lesson must not fabricate external research'); },
    async researchBatch() { throw new Error('No factual claims in this controlled lesson'); },
  } };
}

test('all twelve tutorial chapters complete through isolated HTTP actions without changing formal knowledge', { timeout: 120000 }, async t => {
  const root = fs.mkdtempSync(path.join(tempRoot, 'onboarding-workflow-'));
  const ai = controlledAI();
  const dataDir = path.join(root, 'data');
  const main = createService({ dataDir, vaultDir: path.join(root, 'formal-vault'), aiOverride: ai.api });
  const formalNote = main.store.create({ kind: 'knowledge', title: '正式库合成哨兵', body: '这是隔离测试创建的正式库哨兵，练习不能更改。', meta: { privacy: 'local', stage: 'candidate' } });
  const formalNotes = main.store.list();
  const namespaces = ['sessions', 'studyEvidence', 'reviews', 'uses', 'drafts', 'topics', 'relations', 'proposals', 'jobs'];
  const formalRecords = Object.fromEntries(namespaces.map(name => [name, main.store.records(name)]));
  const app = createApp({ dataDir, service: main, scheduler: false });
  t.after(async () => { await app.close(); assert.ok(root.startsWith(tempRoot + path.sep)); fs.rmSync(root, { recursive: true, force: true }); });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const sessionRes = await fetch(base + '/api/session');
  const cookie = sessionRes.headers.get('set-cookie').split(';')[0];
  const { csrf } = await sessionRes.json();
  let practiceId;
  const verified = new Set();
  const expectedProgress = new Map();
  async function request(route, body, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(base + route, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    assert.equal(response.status, 200, `${method} ${route}: ${JSON.stringify(result)}`);
    return result;
  }
  const practice = (route, body, method) => request(`/api/practice/${practiceId}/${route}`, body, method);
  const guide = (action, body = {}) => request(`/api/onboarding/${action}`, { practiceId, ...body });
  const state = () => request('/api/onboarding/state');
  async function pump() {
    for (let i = 0; i < 80; i++) {
      const jobs = (await practice('jobs')).jobs;
      if (!jobs.some(job => job.state === 'queued')) {
        assert.equal(jobs.some(job => job.state === 'running'), false); return;
      }
      await app.onboarding.pump();
    }
    assert.fail('Practice jobs did not drain');
  }
  async function at(stepId) { await guide('checkpoint', { stepId, mode: 'check' }); }
  async function complete(stepId, expected) {
    const step = flatSteps.find(item => item.id === stepId);
    assert.ok(step, stepId);
    const result = await guide('checkpoint', { stepId, mode: 'check' });
    const expectedStatus = expected || (step.kind === 'case' ? 'demonstrated' : 'done');
    assert.equal(result.progress[stepId].status, expectedStatus, `Tutorial progress after ${stepId}`);
    expectedProgress.set(stepId, expectedStatus);
    verified.add(stepId); return result;
  }
  async function ui(stepId, event) { await at(stepId); await guide('event', { event }); return complete(stepId); }
  async function load(caseId) { return (await guide('case', { caseId })).roles; }
  async function edit(id, changes) { const note = await practice(`notes/${id}`); return practice(`notes/${id}`, { expectedHash: note.hash, ...changes }, 'PUT'); }
  async function answer(id, text = `${marker} 我会区分原文、定位与自己的理解，核对上下文。`) {
    await practice(`study/${id}/answer`, { answer: text, requestId: randomUUID() }); await pump(); return practice(`study/${id}`);
  }
  async function finishIndependent(noteId) {
    const session = await practice('study/start', { noteId }); await answer(session.id); return practice(`study/${session.id}/finish`, {});
  }

  // 1: Real configuration routes and a controlled connection receipt gate the practice.
  let current = await guide('start'); practiceId = current.practiceId;
  const roles = current.roles;
  assert.equal(current.modelReady, false);
  await request('/api/settings', { ai: { enabled: true, baseUrl: 'https://example.invalid/v1', model: 'offline-workflow' }, embedding: { enabled: true, baseUrl: 'https://example.invalid/v1', model: 'offline-vectors' }, search: { enabled: true, baseUrl: 'https://example.invalid' }, fetch: { enabled: true } }, 'PUT');
  await complete('setup-save');
  for (const capability of ['model', 'embedding', 'search', 'fetch']) await guide('test', { capability });
  await complete('setup-test');
  await practice('settings', { dailyMinutes: 25, timezone: 'Asia/Shanghai', scheduleTime: '08:00' }, 'PUT');
  await complete('setup-preferences');
  const sharedSettings = main.settings();

  // 2–3: Save original input, authorize it, process it, and retain manual structure.
  const imported = await practice('import', { items: [{ ...readingExample, privacy: 'local' }] });
  const sourceId = imported.notes[0].id;
  await complete('capture-save');
  await edit(sourceId, { meta: { privacy: 'cloud' } }); await complete('capture-permission');
  const batch = await Promise.all(['reading-card.md', 'finding-clues.txt'].map(async file => {
    const response = await fetch(base + `/tutorial-examples/${file}`); assert.equal(response.status, 200);
    return { title: file, body: await response.text(), privacy: 'local' };
  }));
  await practice('import', { items: batch }); await complete('capture-batch');
  await practice(`notes/${sourceId}/process`, { research: false }); await pump(); await complete('process-ai');
  await practice(`notes/${sourceId}/extract`, { title: '手工观点 · 知序流程受控练习', body: `${marker} 小岚在本次虚构分享中先确定问题，再选择原文，保留出处。`, depth: 'explain', claimType: 'opinion', topic: '读书与知识整理' });
  await complete('process-manual');
  await edit(sourceId, { meta: { researchIntervalDays: 7 } }); await complete('process-validity');
  await practice(`notes/${sourceId}/process`, { research: true }); await pump(); await complete('process-research');
  let cases = await load('evidence'); await practice(`notes/${cases.evidenceKnowledge}/evidence`); await complete('process-evidence');
  cases = await load('expired'); await practice(`notes/${cases.staleKnowledge}`); await complete('process-expired');

  // 4: Four distinct depths and destructive actions use dedicated practice objects.
  await edit(roles.explain, { body: (await practice(`notes/${roles.explain}`)).body + `\n${marker} 用户补充说明。` }); await complete('library-edit');
  for (const depth of ['aware', 'find', 'explain', 'apply']) {
    await edit(roles[depth], { meta: { depth } });
    assert.notEqual((await state()).progress[`library-${depth}`].status, 'done', 'Depth editing alone must not skip the stage operation');
    await practice(`notes/${roles[depth]}/promote`, { stage: ['aware', 'find'].includes(depth) ? 'reference' : 'learning', depth, reason: `${marker} 按这次练习目标安排。` });
    await complete(`library-${depth}`);
  }
  cases = await load('duplicates');
  const mainLearningHash = (await practice(`notes/${roles.explain}`)).hash;
  const history = await practice(`history/${cases.versionNote}`); await complete('library-history');
  const version = history.versions.find(item => item.raw.includes('版本 A（旧文）'));
  await practice(`history/${cases.versionNote}/restore`, { versionId: version.versionId, expectedHash: (await practice(`notes/${cases.versionNote}`)).hash });
  await complete('library-restore');
  assert.equal((await practice(`notes/${roles.explain}`)).hash, mainLearningHash);
  const mergePreview = await practice('notes/merge', { keepId: cases.mergeKeep, mergeId: cases.mergeOther, preview: true }); await complete('library-merge-preview');
  await practice('notes/merge', { ...mergePreview, preview: false }); await complete('library-merge');
  await practice(`notes/${cases.deleteNote}`, { expectedHash: (await practice(`notes/${cases.deleteNote}`)).hash }, 'DELETE'); await complete('library-delete');
  await practice('recommendations'); await complete('library-suggestions');

  // 5–6: User answers, repeated same-day work, and a genuinely due cross-day review.
  await edit(roles.source, { meta: { privacy: 'cloud' } }); await complete('study-source-permission');
  await edit(roles.explain, { meta: { privacy: 'cloud' } }); await complete('study-permission');
  const plan = await practice('today/generate', {}); await complete('study-plan');
  const applyPlan = plan.items.find(item => item.noteId === roles.apply);
  await practice(`today/${encodeURIComponent(applyPlan.id)}/action`, { action: 'defer', days: 1 }); await complete('study-defer');
  const session = await practice('study/start', { noteId: roles.explain }); await complete('study-start');
  await ui('study-hide', 'study-hide');
  await answer(session.id); await complete('study-answer'); await complete('study-feedback');
  await answer(session.id, `${marker} 我也会明确原文不能支持哪些推广。`); await complete('study-followup');
  await practice(`study/${session.id}`); await ui('study-resume', 'study-resume');
  await practice(`study/${session.id}/finish`, {}); await complete('study-finish');
  await practice(`study/${session.id}/confirm`, { body: `${marker} 这是本次受控用户输入：出处用于回到原文，而不是代替理解。` }); await pump(); await complete('study-confirm');
  assert.equal((await finishIndependent(roles.explain)).completion.interval, 1); await complete('review-same-day');
  await guide('advance', { action: 'day' }); await complete('review-clock-day');
  await guide('advance', { action: 'next' }); await complete('review-clock-due');
  assert.equal((await finishIndependent(roles.explain)).completion.interval, 2); await complete('review-finish');
  cases = await load('hints');
  await practice(`study/${cases.hintSession}/hint`, {}); await complete('review-hint');
  assert.equal((await practice(`study/${cases.hintSession}/finish`, {})).completion.interval, 1); await complete('review-hint-finish');
  let hintPlan = await practice('today/generate', {});
  for (const [role, stepId, action] of [['skipKnowledge', 'review-skip', 'skip'], ['pauseKnowledge', 'review-pause', 'pause']]) {
    let item = hintPlan.items.find(entry => entry.noteId === cases[role] && entry.state === 'pending');
    if (!item) { await guide('advance', { action: 'day' }); hintPlan = await practice('today/generate', {}); item = hintPlan.items.find(entry => entry.noteId === cases[role] && entry.state === 'pending'); }
    assert.ok(item, stepId);
    await practice(`today/${encodeURIComponent(item.id)}/action`, { action }); await complete(stepId);
  }
  assert.equal((await practice('settings')).pausedIds.includes(roles.apply), false);

  // 7: Genuine controlled incorrect feedback preserves its answer; preset state actions remain demonstrations.
  ai.controls.assessment = 'incorrect';
  const incorrect = await finishIndependent(roles.explain);
  assert.equal(incorrect.completion.interval, 1);
  assert.equal(incorrect.completion.evidence.errorObserved, true);
  assert.ok((await practice('mistakes')).mistakes.some(item => item.meta.noteId === roles.explain && item.body.includes(marker)));
  ai.controls.assessment = 'correct';
  cases = await load('mistakes');
  await ui('mistake-open', 'mistake-open');
  await practice('study/start', { mistakeId: cases.mistake }); await complete('mistake-study');
  for (const [action, expected] of [['dispute', 'disputed'], ['reopen', 'open'], ['resolve', 'resolved'], ['revoke', 'revoked']]) {
    const note = await practice(`mistakes/${cases.mistake}/action`, { action, reason: marker });
    assert.equal(note.meta.correctionState, expected); await complete(`mistake-${action}`);
  }

  // 8: Topic identities survive copy/split, and later controls still target the original.
  const topic = await practice('topics', { title: '小岚的读书分享', body: marker, noteIds: [roles.apply, roles.explain], minutes: 20 }); await complete('topic-create');
  await practice(`topics/${topic.id}`, { expectedHash: topic.hash, meta: { noteIds: [roles.explain, roles.apply], prerequisites: [], minutes: 20 } }, 'PUT'); await complete('topic-edit');
  await practice('study/start', { noteId: roles.apply, topicId: topic.id }); await ui('topic-study', 'topic-study');
  cases = await load('prerequisites'); await ui('topic-blocked', 'topic-open');
  await practice('topics', { title: '小岚的第二次分享', body: marker, noteIds: [roles.explain, roles.apply], minutes: 20 }); await ui('topic-copy', 'topic-copy');
  await practice('topics', { title: '小岚的出处核对', body: marker, noteIds: [roles.explain], minutes: 10 }); await ui('topic-split', 'topic-split');
  assert.equal((await state()).roles.createdTopic, topic.id);
  await practice(`topics/${topic.id}/action`, { action: 'pause' }); await complete('topic-pause');
  await practice(`topics/${topic.id}/action`, { action: 'resume' }); await complete('topic-resume');
  await practice('topics/suggest', {}); await pump(); await complete('topic-ai');
  const topicReport = (await practice('notes?kind=report')).notes.find(note => note.meta.packages?.length);
  assert.ok(topicReport);
  await practice('topics', { title: topicReport.meta.packages[0].title, body: marker, noteIds: topicReport.meta.packages[0].noteIds, minutes: 20 }); await complete('topic-adopt');

  // 9: Keyword, actual vector use, local/AI relation jobs, and every review branch.
  await practice(`search?q=${encodeURIComponent('出处')}&mode=keyword`); await complete('search-keyword');
  const noResult = await practice('search?q=zzzxqv_nothing_742993&mode=keyword'); assert.equal(noResult.results.length, 0); await complete('search-empty');
  await practice('index/update', {}); await pump(); await complete('search-index');
  for (const mode of ['semantic', 'hybrid']) {
    const result = await practice(`search?q=${encodeURIComponent('出处')}&mode=${mode}&privacy=cloud`); assert.equal(result.diagnostics.semanticUsed, true); await complete(`search-${mode}`);
  }
  await practice(`notes/${roles.explain}/relate`, { useAI: false }); await pump(); await complete('relation-local');
  await practice(`notes/${roles.explain}/relate`, { useAI: true }); await pump(); await complete('relation-ai');
  cases = await load('relations');
  for (const [role, action, stepId] of [['relationAccept', 'accept', 'relation-accept'], ['relationReject', 'reject', 'relation-reject'], ['relationIgnore', 'reject', 'relation-ignore'], ['relationAccept', 'remove', 'relation-remove']]) {
    await practice(`relations/${cases[role]}/action`, { action, reason: marker }); await complete(stepId);
  }
  await practice('discover', { useAI: false }); await pump(); await complete('discovery-run');

  // 10: Output types, persisted edits, reversible actual use, and explicit lifecycle choices.
  let draft;
  for (const mode of ['answer', 'outline', 'draft']) { draft = await practice('ask', { question: '读书出处', mode, privacy: 'cloud', scope: ['knowledge', 'source'] }); assert.equal(draft.generated, true); await complete(`output-${mode}`); }
  const draftBody = `${draft.answer}\n${marker} 这句是受控用户编辑。`;
  await practice(`drafts/${draft.draftId}`, { body: draftBody, usedIds: [] }, 'PUT'); await complete('output-edit');
  await practice(`drafts/${draft.draftId}`, { body: draftBody, usedIds: [draft.citations[0].id] }, 'PUT'); await complete('output-use');
  await practice(`drafts/${draft.draftId}`, { body: draftBody, usedIds: [] }, 'PUT'); await complete('output-unuse');
  assert.equal(app.onboarding.currentService.store.records('uses').filter(use => use.draftId === draft.draftId).length, 0);
  await practice(`drafts/${draft.draftId}/capture`, { title: '重新收集的受控输出', body: draftBody, privacy: 'local' }); await complete('output-capture');
  cases = await load('core-suggestion');
  let suggestions = (await practice('recommendations')).suggestions;
  await at('output-core-review'); await guide('event', { event: 'recommendations-open' }); await complete('output-core-review');
  const core = suggestions.find(item => item.noteId === cases.coreKnowledge && item.targetStage === 'core'); assert.ok(core);
  await practice(`recommendations/${core.id}/action`, { action: 'accept' }); await complete('output-core-accept');
  const dismiss = suggestions.find(item => item.noteId === cases.dismissKnowledge); assert.ok(dismiss);
  await practice(`recommendations/${dismiss.id}/action`, { action: 'dismiss' }); await complete('output-suggestion-dismiss');

  // 11: Preset job retry remains local, prompts persist, and backup restores only the practice.
  await ui('jobs-filter', 'jobs-filter');
  cases = await load('jobs'); await ui('jobs-detail', 'job-open');
  await practice(`jobs/${cases.cancelJob}/action`, { action: 'cancel' }); await complete('jobs-cancel');
  const callsBeforeRetry = ai.calls.length;
  await practice(`jobs/${cases.failedJob}/action`, { action: 'retry' }); await pump(); await complete('jobs-retry');
  assert.equal(ai.calls.length, callsBeforeRetry, 'Preset index retry must never make a model/vector request');
  await practice('diagnostics'); await ui('calls-open', 'calls-open');
  const prompts = await practice('prompts'); const template = prompts.prompts[0];
  await practice('prompts', { prompts: { [template.key]: template.template + `\n${marker}` } }, 'PUT'); await complete('prompts-save');
  await practice('prompts', { prompts: { [template.key]: template.defaultTemplate } }, 'PUT'); await ui('prompts-reset', 'prompts-reset');
  await ui('appearance-theme', 'appearance-theme'); await ui('appearance-accent', 'appearance-accent');
  const savedRoles = (await state()).roles;
  const backup = await practice('backup'); await complete('backup-download');
  const restorePreview = await practice('restore', { backup, preview: true }); await complete('backup-preview');
  await practice('restore', { backup, preview: false, token: restorePreview.token }); await complete('backup-restore');
  assert.deepEqual((await state()).roles, savedRoles, 'Restore must preserve note, session, relation, proposal and suggestion identities');
  assert.equal((await state()).progress['search-index'].status, 'pending', 'Restored keyword indexes cannot impersonate retained embedding vectors');
  await practice('index/update', {}); await pump(); await complete('search-index');

  // 12: Proposal, link and conflict cases use their actual review/update endpoints.
  cases = await load('proposals');
  await practice(`proposals/${cases.proposal}/action`, { action: 'accept' }); await complete('proposal-accept');
  await practice(`proposals/${cases.proposalReject}/action`, { action: 'reject' }); await complete('proposal-reject');
  cases = await load('conflicts');
  const links = await practice(`notes/${cases.linkTopic}/links-preview`); assert.equal(links.changed, true); await complete('links-preview');
  await practice(`notes/${cases.linkTopic}/links-sync`, { expectedHash: links.expectedHash }); await complete('links-sync');
  assert.ok((await practice('bootstrap')).conflicts.some(item => item.presetCase === 'conflicts'));
  await ui('conflicts-read', 'conflicts-open');
  for (const stepId of ['mcp-read', 'obsidian-open']) {
    const result = await guide('checkpoint', { stepId, mode: 'external' });
    assert.notEqual(result.progress[stepId].status, 'done', 'An external acknowledgement cannot prove a real client connection');
  }

  // Final checks are independent of whichever chapter happens to be selected.
  assert.equal(new Set([...verified].map(id => flatSteps.find(step => step.id === id).chapterId)).size, 12);
  assert.ok(verified.size >= 85, `${verified.size} major actions verified`);
  const finalProgress = (await state()).progress;
  for (const [stepId, expected] of expectedProgress) assert.equal(finalProgress[stepId].status, expected, `Later chapters must preserve ${stepId} completion evidence`);
  assert.deepEqual(main.store.list(), formalNotes);
  assert.equal(main.store.read(formalNote.id).hash, formalNote.hash);
  for (const namespace of namespaces) assert.deepEqual(main.store.records(namespace), formalRecords[namespace], `Formal ${namespace} must remain unchanged`);
  assert.deepEqual(main.settings(), sharedSettings, 'Practice preferences, prompts and restore cannot rewrite formal settings');
  assert.ok(ai.calls.length > 0);
  assert.ok(ai.calls.every(call => call.marker === marker));
  t.diagnostic(`${verified.size} tutorial actions across all 12 chapters verified; all AI responses were controlled offline data.`);
});
