import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import { createService } from '../src/service.mjs';
import { hash } from '../src/store.mjs';

const tempRoot = path.resolve(import.meta.dirname, '../.tmp');
await mkdir(tempRoot, { recursive: true });
const candidate = { title: '合成知识单元', body: '合成材料中的机制与适用条件。', claims: [] };
const extraction = title => ({ ...(title === undefined ? {} : { sourceTitle: title }), candidates: [candidate], structure: { hierarchy: [{ child: '0', parent: null }], edges: [] } });
async function harness(t, generate) {
  const root = await mkdtemp(path.join(tempRoot, 'capture-title-'));
  const service = createService({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'), ...(generate ? { aiOverride: { generate } } : {}) });
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  return service;
}
const input = (title = '', privacy = 'cloud') => ({ title, body: '合成材料：条件不同，检索策略也需要调整。\n下一段保留原文。', privacy });
async function drain(service) {
  for (let i = 0; i < 12 && service.store.records('jobs').some(job => job.state === 'queued'); i++) await service.runJobs();
}

test('blank title saves the source first and generates without decomposition using the shared AI', async t => {
  const calls = [];
  const s = await harness(t, async request => { calls.push(request); return { text: JSON.stringify({ sourceTitle: '条件变化下的检索策略' }) }; });
  s.updatePrompts({ prompts: { sourceTitle: 'CUSTOM_TITLE 原文：{{source}}' } });
  const result = s.importItems({ items: [input('  \t ')] });
  assert.equal(calls.length, 0);
  const source = result.notes[0];
  assert.equal(source.body, input().body);
  assert.equal(source.meta.titleOrigin, 'temporary');
  assert.equal(result.jobs[0].type, 'title');
  assert.match(source.title, /合成材料/);
  assert.doesNotMatch(source.title, /\n/);
  assert.equal(s.readPublicNote(source.id).titleGeneration.state, 'queued');
  assert.equal(s.jobStatuses().jobs[0].type, 'title');
  await s.runJobs();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].prompt, 'CUSTOM_TITLE 原文：' + input().body);
  assert.equal(calls[0].privacy, 'cloud');
  assert.equal(s.getNote(source.id).title, '条件变化下的检索策略');
  assert.equal(s.getNote(source.id).body, source.body);
  assert.equal(s.readPublicNote(source.id).titleGeneration.state, 'done');
  assert.equal(s.listNotes({ kind: 'knowledge' }).length, 0);
});

test('capture and decomposition share one generation and use the updated version for results', async t => {
  let calls = 0;
  const s = await harness(t, async request => {
    calls++;
    assert.match(request.system, /原始资料标题约定.*sourceTitle/);
    assert.match(request.prompt, /sourceTitle/);
    return { text: JSON.stringify(extraction('检索策略的条件与调整')) };
  });
  const { notes: [source], jobs: [job] } = s.importItems({ items: [input()], process: true });
  await s.runJobs();
  const current = s.getNote(source.id), saved = s.store.get('jobs', job.id), [child] = s.listNotes({ kind: 'knowledge' });
  assert.equal(calls, 1);
  assert.equal(saved.state, 'done');
  assert.equal(saved.payload.hash, current.hash);
  assert.equal(saved.payload.savedCandidates.hash, current.hash);
  assert.equal(child.meta.processKey, current.id + ':' + current.hash + ':0');
  assert.equal(s.publicJob(saved).extractionSaved, true);
  assert.equal(s.readPublicNote(source.id).structure.state, 'ready');
  assert.equal(s.processNote(source.id).id, job.id);
  assert.equal(calls, 1);
});

test('manual, file and URL-source titles stay intact, including duplicate imports', async t => {
  let calls = 0;
  const s = await harness(t, async () => { calls++; return { text: JSON.stringify(extraction('不能覆盖这个标题')) }; });
  for (const [index, extra] of [{ title: '我手填的标题' }, { title: '附件名字', platform: '本地文件', locator: '附件名字.md' }, { title: '网页自带标题', url: 'https://example.invalid/article' }].entries()) {
    const item = { ...input(), ...extra, body: input().body + index };
    const { notes: [source], jobs } = s.importItems({ items: [item] });
    assert.equal(jobs.length, 0);
    assert.equal(source.title, extra.title);
    assert.equal(s.importItems({ items: [{ ...item, title: '' }] }).notes[0].title, extra.title);
    const task = s.processNote(source.id);
    await drain(s);
    assert.equal(s.store.get('jobs', task.id).state, 'done');
    assert.equal(s.getNote(source.id).title, extra.title);
    assert.equal(s.getNote(source.id).meta.titleOrigin, 'manual');
  }
  assert.equal(calls, 3);
});

test('duplicate blank captures append origins and keep a single current title request', async t => {
  let calls = 0;
  const s = await harness(t, async () => { calls++; return { text: JSON.stringify({ sourceTitle: '保留出处的合成标题' }) }; });
  const first = s.importItems({ items: [input()] });
  const second = s.importItems({ items: [{ ...input(), title: '重新提交不能覆盖标题', platform: '另一来源' }] });
  assert.equal(second.notes[0].id, first.notes[0].id);
  assert.equal(second.notes[0].meta.origins.length, 2);
  assert.equal(s.store.records('jobs').length, 1);
  await s.runJobs();
  assert.equal(calls, 1);
  assert.equal(s.getNote(first.notes[0].id).title, '保留出处的合成标题');
  assert.equal(s.store.get('jobs', first.jobs[0].id).state, 'done');
});

test('pending title requests combine with processing instead of making a second model call', async t => {
  let calls = 0;
  const s = await harness(t, async () => { calls++; return { text: JSON.stringify(extraction('合并请求的标题')) }; });
  const { notes: [source], jobs: [title] } = s.importItems({ items: [input()] });
  const job = s.processNote(source.id);
  await drain(s);
  assert.equal(calls, 1);
  assert.equal(s.store.get('jobs', title.id).state, 'cancelled');
  assert.equal(s.store.get('jobs', job.id).state, 'done');
});

test('a title already running can finish before queued processing without losing the version', async t => {
  let calls = 0, release, ready;
  const started = new Promise(resolve => { ready = resolve; });
  const s = await harness(t, async request => {
    calls++;
    if (request.system.includes('资料拆解输出约定')) return { text: JSON.stringify(extraction('不能再次覆盖')) };
    ready(); return await new Promise(resolve => { release = () => resolve({ text: JSON.stringify({ sourceTitle: '先完成标题' }) }); });
  });
  const { notes: [source] } = s.importItems({ items: [input()] });
  const running = s.runJobs(); await started;
  const process = s.processNote(source.id);
  release(); await running; await drain(s);
  assert.equal(calls, 2);
  assert.equal(s.getNote(source.id).title, '先完成标题');
  assert.equal(s.store.get('jobs', process.id).state, 'done');
});

for (const [label, value] of [['missing', undefined], ['blank', '   '], ['too long', '字'.repeat(81)], ['multiline', '标题\n另一行'], ['Markdown', '# 标题'], ['nontext', { title: '对象' }]]) {
  test('invalid sourceTitle (' + label + ') retains extraction; title-only retry carries evidence forward', async t => {
    let extractCalls = 0, titleCalls = 0;
    const s = await harness(t, async request => {
      if (request.system.includes('资料拆解输出约定')) { extractCalls++; return { text: JSON.stringify(extraction(value)) }; }
      titleCalls++; return { text: JSON.stringify({ sourceTitle: '补全后的检索标题' }) };
    });
    s.updatePrompts({ prompts: { sourceExtract: '旧自定义拆解模板：{{source}}' } });
    const { notes: [source], jobs: [process] } = s.importItems({ items: [input()], process: true });
    await s.runJobs();
    const before = s.getNote(source.id), [child] = s.listNotes({ kind: 'knowledge' });
    const title = s.store.records('jobs').find(job => job.type === 'title');
    assert.equal(title.state, 'failed');
    assert.equal(title.code, 'MODEL_FORMAT');
    assert.equal(s.store.get('jobs', process.id).state, 'done');
    assert.equal(s.readPublicNote(source.id).structure.state, 'ready');
    s.store.put('research', hash('合成核验' + ':' + before.hash), { result: { conclusion: '合成证据，仅用于版本衔接回归' }, at: new Date().toISOString() });
    s.store.update(child.id, { expectedHash: child.hash, meta: { claims: ['合成核验'], userEdited: true }, body: child.body + '\n人工补充保持完整。' });
    const edited = s.getNote(child.id);
    s.store.put('proposals', 'synthetic-proposal', { id: 'synthetic-proposal', noteId: child.id, state: 'pending', expectedHash: edited.hash, body: '合成建议', meta: { processKey: edited.meta.processKey } });
    s.jobAction(title.id, { action: 'retry' }); await drain(s);
    const current = s.getNote(source.id), preserved = s.getNote(child.id);
    assert.equal(current.title, '补全后的检索标题');
    assert.equal(current.body, before.body);
    assert.equal(preserved.body, edited.body);
    assert.equal(preserved.meta.userEdited, true);
    assert.equal(preserved.meta.processKey, current.id + ':' + current.hash + ':0');
    assert.equal(s.store.get('proposals', 'synthetic-proposal').expectedHash, preserved.hash);
    assert.ok(s.store.get('research', hash('合成核验' + ':' + current.hash)));
    assert.equal(s.publicJob(s.store.get('jobs', process.id)).extractionSaved, true);
    assert.equal(s.processNote(source.id).id, process.id);
    assert.equal(extractCalls, 1);
    assert.equal(titleCalls, 1);
  });
}

for (const [label, privacy] of [['model disabled', 'cloud'], ['local only', 'local']]) {
  test(label + ' preserves blank-title input and waits without automatically resubmitting', async t => {
    const s = await harness(t);
    const { notes: [source], jobs: [job] } = s.importItems({ items: [input('', privacy)] });
    await s.runJobs();
    const waiting = s.store.get('jobs', job.id);
    assert.equal(waiting.state, 'waiting');
    assert.ok(['DISABLED', 'CAPABILITY_DISABLED', 'PRIVACY_LOCAL'].includes(waiting.code));
    assert.equal(s.getNote(source.id).body, input().body);
    assert.equal(s.getNote(source.id).title, source.title);
    assert.equal(s.getNote(source.id).meta.titlePending, true);
    await s.runJobs();
    assert.equal(s.store.get('jobs', job.id).attempts, 1);
    assert.equal(s.store.records('calls').length, 0);
  });
}

test('title failures keep source and temporary title and expose the original error', async t => {
  const s = await harness(t, async () => { const error = new Error('受控网络失败'); error.code = 'NETWORK_ERROR'; throw error; });
  const { notes: [source], jobs: [job] } = s.importItems({ items: [input()] });
  await s.runJobs();
  assert.equal(s.store.get('jobs', job.id).state, 'failed');
  assert.equal(s.readPublicNote(source.id).titleGeneration.code, 'NETWORK_ERROR');
  assert.equal(s.getNote(source.id).body, source.body);
  assert.equal(s.getNote(source.id).title, source.title);
});

for (const change of ['title', 'body', 'privacy', 'external title', 'delete', 'cancel']) {
  test('delayed generated title cannot overwrite a concurrent ' + change + ' change', async t => {
    let release, ready;
    const started = new Promise(resolve => { ready = resolve; });
    const s = await harness(t, async () => { ready(); return new Promise(resolve => { release = () => resolve({ text: JSON.stringify({ sourceTitle: '不能覆盖当前资料' }) }); }); });
    const { notes: [source], jobs: [job] } = s.importItems({ items: [input()] });
    const running = s.runJobs(); await started;
    if (change === 'delete') s.store.delete(source.id, source.hash);
    else if (change === 'cancel') s.jobAction(job.id, { action: 'cancel' });
    else if (change === 'external title') {
      const file = path.join(s.store.vaultDir, source.path);
      const raw = await readFile(file, 'utf8'), match = raw.match(/^---\n([\s\S]*?)\n---\n/);
      const meta = YAML.parse(match[1]); meta.title = '外部人工标题';
      await writeFile(file, '---\n' + YAML.stringify(meta) + '---\n' + raw.slice(match[0].length));
    } else s.editNote(source.id, { expectedHash: source.hash, ...(change === 'privacy' ? { meta: { privacy: 'local' } } : { [change]: change === 'title' ? '用户人工标题' : '用户修改过的原文' }) });
    release(); await running;
    assert.ok(['failed', 'cancelled'].includes(s.store.get('jobs', job.id).state));
    if (change !== 'delete') {
      const current = s.getNote(source.id);
      assert.notEqual(current.title, '不能覆盖当前资料');
      if (change === 'title') { assert.equal(current.title, '用户人工标题'); assert.equal(current.meta.titlePending, false); assert.throws(() => s.jobAction(job.id, { action: 'retry' }), { code: 'TITLE_ALREADY_SET' }); }
      if (change === 'body') assert.equal(current.body, '用户修改过的原文');
      if (change === 'privacy') assert.equal(current.meta.privacy, 'local');
      if (change === 'external title') { assert.equal(s.readPublicNote(source.id).meta.titlePending, false); assert.equal(current.title, '外部人工标题'); assert.throws(() => s.jobAction(job.id, { action: 'retry' }), { code: 'TITLE_ALREADY_SET' }); }
    }
  });
}


test('title-only retry keeps a current existing structure and completed extraction reusable', async t => {
  let calls = 0;
  const s = await harness(t, async request => { calls++; return { text: JSON.stringify(request.system.includes('资料拆解输出约定') ? extraction(undefined) : { sourceTitle: '单独补充的标题' }) }; });
  const { notes: [source], jobs: [process] } = s.importItems({ items: [input()], process: true });
  await s.runJobs();
  const title = s.store.records('jobs').find(job => job.type === 'title');
  const [before] = s.listNotes({ kind: 'knowledge' });
  s.jobAction(title.id, { action: 'retry' }); await drain(s);
  assert.equal(s.readPublicNote(source.id).structure.state, 'ready');
  assert.equal(s.listNotes({ kind: 'knowledge' })[0].id, before.id);
  assert.equal(s.processNote(source.id).id, process.id);
  assert.equal(calls, 2);
});


test('missing credentials stop generation without losing source or making a supplier request', async t => {
  const s = await harness(t);
  s.updateSettings({ ai: { enabled: true, baseUrl: 'https://8.8.8.8/v1', model: 'synthetic-no-key' } });
  const { notes: [source], jobs: [job] } = s.importItems({ items: [input()] });
  await s.runJobs();
  assert.equal(s.store.get('jobs', job.id).state, 'waiting');
  assert.equal(s.store.get('jobs', job.id).code, 'MISSING_CREDENTIALS');
  assert.equal(s.getNote(source.id).body, source.body);
  assert.equal(s.store.records('calls').length, 0);
});


for (const [label, value] of [['null JSON', null], ['missing title', {}], ['empty title', { sourceTitle: '  ' }], ['Unicode line break', { sourceTitle: '标题\u2028续行' }]]) {
  test('invalid standalone title output (' + label + ') keeps the placeholder and reports a format error', async t => {
    const s = await harness(t, async () => ({ text: JSON.stringify(value) }));
    const { notes: [source], jobs: [job] } = s.importItems({ items: [input()] });
    await s.runJobs();
    assert.equal(s.store.get('jobs', job.id).state, 'failed');
    assert.equal(s.store.get('jobs', job.id).code, 'MODEL_FORMAT');
    assert.equal(s.getNote(source.id).body, source.body);
    assert.equal(s.getNote(source.id).title, source.title);
    assert.equal(s.getNote(source.id).meta.titlePending, true);
  });
}


const syntheticFeedback = { assessment: 'correct', feedback: '合成反馈，仅验证任务衔接。', nextQuestion: '合成后续问题' };
async function sourceAwaitingTitle(t, multiple = false) {
  const events = [];
  const s = await harness(t, async request => {
    if (request.system.includes('资料拆解输出约定')) {
      events.push('extract');
      const result = extraction(undefined);
      if (multiple) result.candidates.push({ title: '另一合成知识', body: '另一合成知识的正文，条件和用途明确。', claims: [] });
      return { text: JSON.stringify(result) };
    }
    if (request.prompt.includes('依据材料评价理解')) { events.push('grade'); return { text: JSON.stringify(syntheticFeedback) }; }
    events.push('title'); return { text: JSON.stringify({ sourceTitle: '不会打断学习的补充标题' }) };
  });
  const { notes: [source] } = s.importItems({ items: [input()], process: true });
  await drain(s);
  const title = s.store.records('jobs').find(job => job.type === 'title');
  const child = s.listNotes({ kind: 'knowledge' })[0];
  return { s, source, title, child, events };
}

test('automatic title migration preserves active reading, feedback and pending grading sessions exactly', async t => {
  const { s, title, child, events } = await sourceAwaitingTitle(t);
  const learning = s.promote(child.id, { stage: 'learning', reason: '合成回归中明确加入学习' });
  const reading = s.startStudy({ noteId: child.id });
  const feedback = s.startStudy({ noteId: child.id });
  s.answerStudy(feedback.id, { answer: '已经得到合成反馈的原始回答', requestId: 'synthetic-feedback' });
  await drain(s);
  s.jobAction(title.id, { action: 'retry' });
  const waiting = s.startStudy({ noteId: child.id });
  s.answerStudy(waiting.id, { answer: '仍在等待批改的完整原始回答', requestId: 'synthetic-waiting' });
  const before = [reading, feedback, waiting].map(session => s.store.get('sessions', session.id));
  const grade = s.store.get('jobs', before[2].pendingJobId);
  const evidenceBefore = s.store.records('studyEvidence'), reviewsBefore = s.store.records('reviews');
  await s.runJobs(); // The earlier queued title runs before the pending grading task.
  const migrated = s.getNote(child.id);
  assert.notEqual(migrated.hash, learning.hash);
  assert.equal(migrated.body, learning.body);
  assert.equal(migrated.title, learning.title);
  assert.equal(migrated.meta.stage, 'learning');
  for (const session of before) assert.deepEqual(s.store.get('sessions', session.id), { ...session, sourceHash: migrated.hash });
  assert.deepEqual(s.store.get('jobs', grade.id), grade);
  assert.deepEqual(s.store.records('studyEvidence'), evidenceBefore);
  assert.deepEqual(s.store.records('reviews'), reviewsBefore);
  assert.deepEqual(events, ['extract', 'grade', 'title']);
  await s.runJobs();
  assert.equal(s.store.get('jobs', grade.id).state, 'done');
  assert.equal(s.session(waiting.id).turns[0].answer, '仍在等待批改的完整原始回答');
  assert.deepEqual(s.session(waiting.id).turns[0].feedback, syntheticFeedback);
  assert.equal(s.finishStudy(waiting.id).status, 'completed');
  assert.equal(s.finishStudy(feedback.id).status, 'completed');
  assert.equal(s.session(reading.id).status, 'reading');
});

test('title migration preserves confirmed understanding while grading is pending', async t => {
  const { s, title, child } = await sourceAwaitingTitle(t);
  s.promote(child.id, { stage: 'learning', reason: '合成回归中明确加入学习' });
  const study = s.startStudy({ noteId: child.id });
  s.jobAction(title.id, { action: 'retry' });
  s.answerStudy(study.id, { answer: '等待批改期间的完整合成回答', requestId: 'synthetic-confirm-pending' });
  const confirmed = s.confirmStudy(study.id, { body: '用户明确确认的个人理解，合成回归专用。' });
  const before = s.store.get('sessions', study.id), grade = s.store.get('jobs', before.pendingJobId);
  assert.equal(before.sourceHash, confirmed.hash);
  assert.equal(before.material, study.material);
  assert.notEqual(before.material, confirmed.body);
  assert.equal(before.status, 'awaiting_feedback');
  const evidence = s.store.records('studyEvidence'), reviews = s.store.records('reviews');
  await s.runJobs();
  const migrated = s.getNote(child.id);
  assert.notEqual(migrated.hash, confirmed.hash);
  assert.equal(migrated.body, confirmed.body);
  assert.equal(migrated.meta.personalUnderstanding, confirmed.meta.personalUnderstanding);
  assert.equal(migrated.meta.stage, confirmed.meta.stage);
  assert.deepEqual(s.store.get('sessions', study.id), { ...before, sourceHash: migrated.hash });
  assert.deepEqual(s.store.get('jobs', grade.id), grade);
  assert.deepEqual(s.store.records('studyEvidence'), evidence);
  assert.deepEqual(s.store.records('reviews'), reviews);
  await s.runJobs();
  assert.equal(s.store.get('jobs', grade.id).state, 'done');
  assert.equal(s.session(study.id).material, before.material);
  assert.equal(s.session(study.id).turns[0].answer, before.turns[0].answer);
  assert.deepEqual(s.session(study.id).turns[0].feedback, syntheticFeedback);
  assert.equal(s.finishStudy(study.id).status, 'completed');
});

test('title migration rejects body changes after pending confirmation', async t => {
  const { s, title, child } = await sourceAwaitingTitle(t);
  s.promote(child.id, { stage: 'learning', reason: '合成回归中明确加入学习' });
  const study = s.startStudy({ noteId: child.id });
  s.jobAction(title.id, { action: 'retry' });
  s.answerStudy(study.id, { answer: '随后材料变化前的合成回答', requestId: 'synthetic-confirm-body' });
  const confirmed = s.confirmStudy(study.id, { body: '用户确认的合成个人理解。' });
  s.editNote(child.id, { expectedHash: confirmed.hash, body: confirmed.body + '\n确认后真实修改正文。' });
  const before = s.store.get('sessions', study.id), grade = s.store.get('jobs', before.pendingJobId);
  await s.runJobs();
  assert.deepEqual(s.store.get('sessions', study.id), before);
  await s.runJobs();
  assert.equal(s.store.get('jobs', grade.id).code, 'SOURCE_CHANGED');
  assert.equal(s.session(study.id).turns[0].feedback, undefined);
  assert.throws(() => s.finishStudy(study.id), { code: 'FEEDBACK_PENDING' });
});

test('automatic title migration rebinds both current pending relation endpoints but never stale suggestions', async t => {
  const { s, title, child } = await sourceAwaitingTitle(t, true);
  const sibling = s.listNotes({ kind: 'knowledge' }).find(note => note.id !== child.id);
  const other = s.store.create({ kind: 'knowledge', title: '另一份独立知识', body: '独立知识的合成正文，可比较条件和用途。', meta: { privacy: 'cloud', stage: 'candidate' } });
  const relation = (id, from, to, overrides = {}) => ({ id, fromId: from.id, toId: to.id, fromHash: from.hash, toHash: to.hash, state: 'suggested', type: 'application', highValue: true, valueScore: 90, explanation: '合成关系说明', use: '比较条件', boundary: '合成测试范围', sourceExcerpt: from.body.slice(0, 12), targetExcerpt: to.body.slice(0, 12), ...overrides });
  const records = [relation('forward-current', child, other), relation('reverse-current', other, child, { state: 'candidate' }), relation('both-current', child, sibling, { state: 'candidate' }), relation('stale-child', child, other, { fromHash: 'obsolete-child-version' }), relation('stale-other', child, other, { toHash: 'obsolete-other-version' })];
  for (const record of records) s.store.put('relations', record.id, record);
  s.jobAction(title.id, { action: 'retry' }); await s.runJobs();
  const current = s.getNote(child.id), currentSibling = s.getNote(sibling.id);
  assert.deepEqual(s.store.get('relations', 'forward-current'), { ...records[0], fromHash: current.hash });
  assert.deepEqual(s.store.get('relations', 'reverse-current'), { ...records[1], toHash: current.hash });
  assert.deepEqual(s.store.get('relations', 'both-current'), { ...records[2], fromHash: current.hash, toHash: currentSibling.hash });
  assert.deepEqual(s.store.get('relations', 'stale-child'), records[3]);
  assert.deepEqual(s.store.get('relations', 'stale-other'), records[4]);
  const review = s.relationReview();
  assert.ok(review.relations.some(record => record.id === 'forward-current'));
  assert.ok(review.candidates.some(record => record.id === 'reverse-current'));
  assert.ok(review.candidates.some(record => record.id === 'both-current'));
  assert.ok(!review.relations.some(record => record.id.startsWith('stale-')));
  assert.throws(() => s.relationAction('stale-other', { action: 'accept' }), { code: 'CONFLICT' });
  assert.equal(s.relationAction('forward-current', { action: 'accept' }).state, 'accepted');
});

test('title migration keeps obsolete teaching snapshots and completed history untouched', async t => {
  const { s, title, child } = await sourceAwaitingTitle(t);
  let note = s.promote(child.id, { stage: 'learning', reason: '合成回归中明确加入学习' });
  const finished = s.startStudy({ noteId: child.id });
  s.answerStudy(finished.id, { answer: '用于历史保留的合成回答', requestId: 'synthetic-history' });
  await drain(s); s.finishStudy(finished.id);
  const stale = s.startStudy({ noteId: child.id });
  s.answerStudy(stale.id, { answer: '原正文对应的旧回答', requestId: 'synthetic-stale' });
  const staleJob = s.store.get('jobs', s.session(stale.id).pendingJobId);
  note = s.editNote(child.id, { expectedHash: note.hash, body: note.body + '\n用户后来确实改动了正文。' });
  const mismatch = s.startStudy({ noteId: child.id });
  const mismatchedSnapshot = { ...s.store.get('sessions', mismatch.id), material: '另一份不能冒充当前材料的教学快照' };
  s.store.put('sessions', mismatch.id, mismatchedSnapshot);
  // Run the obsolete grade once; title retry is explicit and remains separately queued.
  await s.runJobs();
  assert.equal(s.store.get('jobs', staleJob.id).code, 'SOURCE_CHANGED');
  const before = [finished, stale, mismatch].map(session => s.store.get('sessions', session.id));
  s.jobAction(title.id, { action: 'retry' }); await s.runJobs();
  for (const session of before) assert.deepEqual(s.store.get('sessions', session.id), session);
  assert.notEqual(s.getNote(child.id).hash, note.hash);
  s.jobAction(staleJob.id, { action: 'retry' }); await s.runJobs();
  assert.equal(s.store.get('jobs', staleJob.id).code, 'SOURCE_CHANGED');
  assert.equal(s.session(stale.id).turns[0].answer, '原正文对应的旧回答');
  assert.equal(s.session(stale.id).turns[0].feedback, undefined);
});
