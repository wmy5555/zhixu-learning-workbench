import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { chapters, flatSteps } from '../public/onboarding-curriculum.mjs';
import { caseIds, seedPractice, loadCase } from '../src/onboarding-cases.mjs';
import { createService } from '../src/service.mjs';

const root = path.resolve(import.meta.dirname, '..');
const tempRoot = path.join(root, '.tmp');
await mkdir(tempRoot, { recursive: true });

async function practiceService(t) {
  const dir = await mkdtemp(path.join(tempRoot, 'onboarding-curriculum-'));
  let calls = 0;
  const forbidden = () => { calls++; throw new Error('PRESET_CASE_MUST_NOT_CALL_EXTERNAL_SERVICE'); };
  const service = createService({ dataDir: path.join(dir, 'data'), vaultDir: path.join(dir, 'vault'), practice: true, learningClock: () => new Date('2031-04-15T04:00:00.000Z'), aiOverride: { generate: forbidden, research: forbidden, researchBatch: forbidden, embed: forbidden } });
  t.after(async () => { await service.close(); await rm(dir, { recursive: true, force: true }); });
  return { service, calls: () => calls };
}

test('curriculum covers all workspaces and system tabs with distinct verifiable steps', () => {
  assert.equal(chapters.length, 12);
  assert.equal(flatSteps.length, new Set(flatSteps.map(item => item.id)).size);
  assert.ok(flatSteps.length >= 100);
  assert.deepEqual(new Set(flatSteps.map(item => item.view)), new Set(['today', 'capture', 'library', 'study', 'topics', 'discover', 'output', 'system']));
  assert.deepEqual(new Set(flatSteps.filter(item => item.view === 'system').map(item => item.tab)), new Set(['settings', 'appearance', 'jobs', 'data', 'diagnostics', 'proposals', 'conflicts']));
  const cases = new Set(caseIds);
  for (const item of flatSteps) {
    for (const field of ['id', 'title', 'instruction', 'why', 'expected', 'view', 'target', 'kind']) assert.equal(typeof item[field], 'string', `${item.id}.${field}`);
    if (['action', 'case'].includes(item.kind)) assert.ok(item.check, `${item.id} must verify an action`);
    if (item.kind === 'case') assert.ok(cases.has(item.caseId), `${item.id} must name an allowed case`);
    assert.ok(!item.sample || !Object.hasOwn(item.sample, 'answer'), 'Do not supply answers for the learner');
  }
  assert.equal(flatSteps.find(item => item.check === 'ai-test').chapterId, 'setup');
  assert.ok(flatSteps.find(item => item.id === 'study-source-permission'), 'Cloud permission must include the original source');
  for (const id of ['library-history', 'library-restore']) {
    const item = flatSteps.find(step => step.id === id);
    assert.equal(item.kind, 'case');
    assert.equal(item.caseId, 'duplicates');
    assert.equal(item.noteRole, 'versionNote', 'Restoring history must not reset the main learning card');
  }
});

test('downloadable practice files are real, distinct, original text files', async () => {
  const files = flatSteps.flatMap(item => item.downloads || []);
  assert.equal(files.length, 2);
  assert.deepEqual(new Set(files.map(item => path.extname(item.href))), new Set(['.md', '.txt']));
  const bodies = await Promise.all(files.map(async item => {
    assert.ok(item.href.startsWith('/tutorial-examples/'));
    const body = await readFile(path.join(root, 'public', item.href), 'utf8');
    assert.match(body, /原创虚构/); return body;
  }));
  assert.equal(new Set(bodies).size, 2);
});

test('initial seed is idempotent, local and has no learned or confirmed evidence', async t => {
  const { service, calls } = await practiceService(t);
  const first = seedPractice(service), again = seedPractice(service);
  assert.deepEqual(again, first);
  assert.equal(service.store.list().length, 5);
  for (const depth of ['aware', 'find', 'explain', 'apply']) {
    const note = service.getNote(first.roles[depth]);
    assert.equal(note.meta.depth, depth);
    assert.equal(note.meta.stage, 'candidate');
    assert.equal(note.meta.privacy, 'local');
    assert.equal(note.meta.confirmedAt, undefined);
    assert.equal(note.meta.presetCase, undefined);
    assert.equal(note.meta.practice, true);
    assert.equal(note.meta.sources[0].id, first.roles.source);
  }
  for (const namespace of ['sessions', 'studyEvidence', 'uses', 'reviews', 'calls']) assert.equal(service.store.records(namespace).length, 0);
  assert.equal(calls(), 0);
});

test('all cases are explicit, labelled, idempotent and cannot issue external requests', async t => {
  const { service, calls } = await practiceService(t);
  const initial = seedPractice(service);
  const baseline = new Map(service.store.list().map(note => [note.id, note.hash]));
  for (const caseId of caseIds) {
    const first = loadCase(service, caseId, initial.roles);
    const count = service.store.list().length;
    const repeated = loadCase(service, caseId, first.roles);
    assert.equal(repeated.alreadyLoaded, true);
    assert.deepEqual(repeated.roles, first.roles);
    assert.equal(service.store.list().length, count);
    for (const id of first.createdIds) {
      const note = service.getNote(id);
      assert.equal(note.meta.presetCase, caseId);
      assert.equal(note.meta.practice, true);
      assert.equal(note.meta.demo, true);
      assert.match(note.body, /预设演示案例/);
      assert.match(note.title, /预设演示案例/);
    }
  }
  for (const [id, digest] of baseline) assert.equal(service.getNote(id).hash, digest, 'Cases do not replace the main learning cards');
  for (const namespace of ['sessions', 'studyEvidence', 'uses', 'drafts', 'proposals', 'jobs', 'onboardingConflicts', 'relations']) {
    for (const record of service.store.records(namespace)) {
      assert.ok(caseIds.includes(record.presetCase), `${namespace} contains unmarked preset data`);
      assert.equal(record.practice, true);
      assert.equal(record.demo, true);
    }
  }
  assert.equal(service.store.records('calls').length, 0);
  assert.equal(calls(), 0);
  const emptyStep = flatSteps.find(item => item.id === 'search-empty');
  assert.equal((await service.search(emptyStep.sample.query, { mode: 'keyword' })).results.length, 0, 'The empty-result lesson must not match common Chinese characters');
  assert.throws(() => loadCase(service, '../../formal-vault'), error => error.code === 'ONBOARDING_CASE');
});

test('preconditions, evidence and expiration cases retain the real learning guardrails', async t => {
  const { service } = await practiceService(t);
  const { roles } = seedPractice(service);
  const blocked = loadCase(service, 'prerequisites', roles);
  assert.equal(service.topics().find(topic => topic.id === blocked.roles.topicBlocked).progress.blockedNoteId, blocked.roles.prerequisite);
  assert.throws(() => service.startStudy({ noteId: blocked.roles.prerequisite }), error => error.code === 'RESEARCH_REQUIRED');
  const evidence = loadCase(service, 'evidence', roles);
  assert.deepEqual(new Set(service.noteEvidence(evidence.roles.evidenceKnowledge).evidence.map(item => item.role)), new Set(['support', 'oppose', 'limit', 'input']));
  assert.throws(() => service.startStudy({ noteId: evidence.roles.evidenceKnowledge }), error => error.code === 'RESEARCH_REQUIRED');
  const expired = loadCase(service, 'expired', roles);
  assert.ok(service.getNote(expired.roles.staleKnowledge).meta.reviewAfter < service.learningNow());
  assert.throws(() => service.startStudy({ noteId: expired.roles.staleKnowledge }), error => error.code === 'RESEARCH_REQUIRED');
});

test('preset sessions and lifecycle records can demonstrate actual actions without touching main cards', async t => {
  const { service, calls } = await practiceService(t);
  const seed = seedPractice(service);
  const hints = loadCase(service, 'hints', seed.roles);
  const finished = service.finishStudy(hints.roles.hintSession);
  assert.equal(finished.presetCase, 'hints');
  assert.equal(finished.completion.evidence.usedHints, true);
  assert.equal(finished.completion.interval, 1);
  const mistakes = loadCase(service, 'mistakes', seed.roles);
  for (const [action, state] of [['dispute', 'disputed'], ['reopen', 'open'], ['resolve', 'resolved'], ['revoke', 'revoked']]) {
    assert.equal(service.mistakeAction(mistakes.roles.mistake, { action, reason: '预设演示' }).meta.correctionState, state);
  }
  const core = loadCase(service, 'core-suggestion', seed.roles);
  const dismiss = service.recommendations().suggestions.find(item => item.noteId === core.roles.dismissKnowledge);
  assert.ok(dismiss, 'Dismissal must not depend on the main model producing an extra suggestion');
  service.recommendationAction(dismiss.id, { action: 'dismiss' });
  assert.equal(service.getNote(core.roles.dismissKnowledge).meta.stage, 'candidate');
  const suggestion = service.recommendations().suggestions.find(item => item.noteId === core.roles.coreKnowledge && item.targetStage === 'core');
  assert.ok(suggestion, 'Only the preset card has preset cross-day evidence');
  service.recommendationAction(suggestion.id, { action: 'accept' });
  assert.equal(service.getNote(core.roles.coreKnowledge).meta.stage, 'core');
  assert.equal(service.getNote(seed.roles.explain).meta.stage, 'candidate');
  assert.equal(calls(), 0);
});

test('schedule demonstrations leave the later main topic available', async t => {
  const { service } = await practiceService(t);
  const seed = seedPractice(service);
  for (const depth of ['explain', 'apply']) service.promote(seed.roles[depth], { stage: 'learning', depth, reason: '主线学习安排' });
  const hints = loadCase(service, 'hints', seed.roles);
  const plan = service.today();
  const skipped = plan.items.find(item => item.noteId === hints.roles.skipKnowledge);
  const paused = plan.items.find(item => item.noteId === hints.roles.pauseKnowledge);
  assert.ok(skipped);
  assert.ok(paused);
  service.planAction(skipped.id, { action: 'skip' });
  service.planAction(paused.id, { action: 'pause' });
  assert.deepEqual(service.settings().pausedIds, [hints.roles.pauseKnowledge]);
  const after = service.today();
  for (const role of ['explain', 'apply']) assert.equal(after.items.find(item => item.noteId === seed.roles[role]).state, 'pending');
  for (const [stepId, role] of [['review-skip', 'skipKnowledge'], ['review-pause', 'pauseKnowledge'], ['review-hint', 'hintSession']]) {
    const step = flatSteps.find(item => item.id === stepId);
    assert.equal(step.noteRole, role);
    assert.equal(step.kind, 'case');
  }
});

test('destructive practice, proposal and relationship branches are independent and repeat-safe', async t => {
  const { service } = await practiceService(t);
  const seed = seedPractice(service);
  let main = service.promote(seed.roles.explain, { stage: 'learning', depth: 'explain', reason: '主线练习' });
  main = service.editNote(main.id, { expectedHash: main.hash, meta: { privacy: 'cloud' } });
  const duplicates = loadCase(service, 'duplicates', seed.roles);
  const versionNote = service.getNote(duplicates.roles.versionNote);
  assert.match(versionNote.body, /版本 B/);
  const oldVersion = service.store.history(versionNote.id).find(version => version.raw.includes('版本 A（旧文）') && !version.raw.includes('版本 B（新文）'));
  assert.ok(oldVersion, 'The history lesson needs a genuinely restorable earlier version');
  service.store.restoreVersion(versionNote.id, oldVersion.versionId, versionNote.hash);
  assert.match(service.getNote(versionNote.id).body, /版本 A/);
  assert.equal(service.getNote(main.id).hash, main.hash, 'History restoration must leave main knowledge intact');
  assert.equal(service.getNote(main.id).meta.stage, 'learning');
  assert.equal(service.getNote(main.id).meta.privacy, 'cloud');
  const preview = service.merge({ keepId: duplicates.roles.mergeKeep, mergeId: duplicates.roles.mergeOther });
  service.merge({ ...preview, preview: false });
  const deletion = service.getNote(duplicates.roles.deleteNote);
  service.store.delete(deletion.id, deletion.hash);
  loadCase(service, 'duplicates', seed.roles);
  assert.equal(service.store.row(deletion.id), undefined, 'Reloading must not recreate a deleted lesson object');
  const proposals = loadCase(service, 'proposals', seed.roles);
  assert.equal(service.store.get('proposals', proposals.roles.proposal).title, '预设演示案例 · 待接受写入提案');
  assert.equal(service.store.get('proposals', proposals.roles.proposalReject).title, '预设演示案例 · 待拒绝写入提案');
  assert.equal(service.settings().mcp.allowProposals, false);
  service.proposalAction(proposals.roles.proposal, { action: 'accept' });
  service.proposalAction(proposals.roles.proposalReject, { action: 'reject' });
  assert.equal(service.store.get('proposals', proposals.roles.proposal).state, 'accepted');
  assert.equal(service.store.get('proposals', proposals.roles.proposalReject).state, 'rejected');
  const relations = loadCase(service, 'relations', seed.roles);
  assert.equal(service.relationReview().relations.filter(item => item.presetCase === 'relations').length, 2);
  service.relationAction(relations.roles.relationAccept, { action: 'accept' });
  service.relationAction(relations.roles.relationReject, { action: 'reject' });
  service.relationAction(relations.roles.relationIgnore, { action: 'reject' });
  service.relationAction(relations.roles.relationAccept, { action: 'remove' });
  assert.equal(service.relationReview().relations.filter(item => item.presetCase === 'relations').length, 0);
  const conflicts = loadCase(service, 'conflicts', seed.roles);
  const linkPreview = service.linksPreview(conflicts.roles.linkTopic);
  assert.equal(linkPreview.changed, true, 'The link tutorial must have an actual pending update');
  assert.equal(linkPreview.conflict, null);
  service.syncLinks(conflicts.roles.linkTopic, { expectedHash: linkPreview.expectedHash });
  const linked = service.getNote(conflicts.roles.linkTopic);
  assert.match(linked.body, /zhixu-managed-links:start/);
  assert.match(linked.body, /保留这段手写说明/);
  assert.equal(service.linksPreview(linked.id).changed, false);
  assert.ok(service.store.history(conflicts.roles.conflictNote).length >= 2);
  assert.equal(service.store.conflicts.length, 0, 'A simulated conflict must not corrupt the Vault or block backup');
  assert.equal(service.store.records('onboardingConflicts').length, 1);
  assert.doesNotThrow(() => service.backup());
});
