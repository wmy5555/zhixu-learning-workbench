import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createService } from '../src/service.mjs';

const projectDir = path.resolve(import.meta.dirname, '..');
const tempRoot = path.join(projectDir, '.tmp');
await mkdir(tempRoot, { recursive: true });

function orchestrationAI({ researchFailure = false } = {}) {
  const events = [];
  const state = {
    askMode: 'valid',
    answerId: null,
    topicIds: ['missing-note-id'],
    researchMode: researchFailure ? 'throw' : 'success',
    candidateBody: '编排候选独有词北辰；该主张需要受控研究结果支持。',
    candidateTopic: '编排测试',
  };
  const record = (capability, input) => events.push({
    marker: 'ORCHESTRATION_TEST_ONLY_NO_NETWORK',
    capability,
    input,
  });
  return {
    events,
    state,
    api: {
      async generate(input) {
        record('generate', input);
        if (input.prompt.includes('拆解以下资料')) {
          return { text: JSON.stringify({ candidates: [{
            title: '编排候选知识',
            body: state.candidateBody,
            topic: state.candidateTopic,
            claims: ['编排测试事实主张'],
            prerequisites: ['测试前置概念'],
            reason: '用于验证查找、学习与关联的状态转换。',
            depth: 'explain',
          }] }) };
        }
        if (input.prompt.includes('依据材料评价理解')) {
          return { text: JSON.stringify({
            assessment: 'incorrect',
            feedback: '编排测试反馈：回答遗漏适用条件。',
            omission: '遗漏连续性条件',
            correction: '应明确说明成立条件与结论边界。',
            nextQuestion: '条件不成立时会怎样？',
            suggestion: '加入条件与边界后的个人解释。',
          }) };
        }
        if (input.prompt.includes('用户目标：')) {
          if (state.askMode === 'bad-list') {
            return { text: JSON.stringify({ answer: '编造清单引用 [bogus-id]', citationIds: ['bogus-id'] }) };
          }
          if (state.askMode === 'bad-inline') {
            return { text: JSON.stringify({ answer: '正文夹带编造引用 [bogus-id]', citationIds: [state.answerId] }) };
          }
          return { text: JSON.stringify({
            answer: `受控编排回答，只引用已检索材料 [${state.answerId}]`,
            citationIds: [state.answerId],
          }) };
        }
        if (input.prompt.includes('把有限材料组织为2–5个学习包')) {
          return { text: JSON.stringify({ packages: [{
            title: '编排测试学习包',
            problem: '验证引用范围',
            noteIds: state.topicIds,
            prerequisites: [],
            minutes: 15,
          }] }) };
        }
        return { text: JSON.stringify({ relations: [] }) };
      },
      async research(input) {
        record('research', input);
        if (state.researchMode === 'throw') {
          throw Object.assign(new Error('编排测试模拟研究失败；未访问网络。'), { code: 'ORCHESTRATION_OFFLINE' });
        }
        if (state.researchMode === 'limited') {
          return {
            claim: input.claim,
            conclusion: '',
            notice: '编排测试中的不完整研究结果。',
            limitations: ['编排测试模拟证据不足。'],
            evidence: [],
          };
        }
        return {
          claim: input.claim,
          conclusion: '编排测试中的受控结论，不代表真实联网核验。',
          notice: '此证据由测试桩生成，仅验证编排和来源关系。',
          limitations: [],
          evidence: [{
            url: 'https://example.invalid/orchestration-evidence',
            title: '编排测试证据',
            excerpt: '受控证据正文，只用于测试候选知识的证据引用。',
            locator: '测试段落 1',
            fetchedAt: '2026-09-20T00:00:00.000Z',
            role: 'support',
            rationale: '受控证据与受控主张直接对应。',
          }],
        };
      },
      async embed(input) {
        record('embed', input);
        return { vectors: input.texts.map(() => [1, 0]) };
      },
      async search(input) {
        record('search', input);
        throw new Error('编排测试不允许调用独立搜索能力');
      },
      async readPage(input) {
        record('readPage', input);
        throw new Error('编排测试不允许读取网页');
      },
      async test(input) {
        record('test', input);
        return { ok: false, offline: true };
      },
    },
  };
}

async function harness(t, options = {}) {
  const root = await mkdtemp(path.join(tempRoot, 'pipeline-'));
  const mock = orchestrationAI(options);
  const service = createService({
    dataDir: path.join(root, 'data'),
    vaultDir: path.join(root, 'vault'),
    aiOverride: mock.api,
  });
  t.after(async () => {
    await service.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, service, mock };
}

async function drainQueuedJobs(service, limit = 20) {
  for (let count = 0; count < limit; count += 1) {
    if (!service.store.records('jobs').some(job => job.state === 'queued')) return;
    await service.runJobs();
  }
  assert.fail(`编排测试在 ${limit} 轮后仍有 queued job`);
}

function createKnowledge(service, { title, body, privacy = 'local', stage = 'candidate', depth = 'explain', meta = {} }) {
  return service.store.create({
    kind: 'knowledge',
    title,
    body,
    meta: { privacy, stage, depth, ...meta },
  });
}

test('default extraction does not research; explicit later research reuses extraction and preserves identity', async t => {
  const { service, mock } = await harness(t);
  const imported = service.importItems({ items: [{ title: '可选核验', body: '待验证资料', privacy: 'cloud' }], process: true });
  await drainQueuedJobs(service);
  assert.equal(mock.events.filter(e => e.capability === 'research').length, 0);
  assert.equal(service.store.get('jobs', imported.jobs[0].id).state, 'done');
  const before = service.listNotes({ kind: 'knowledge' })[0];
  assert.ok(before.meta.researchLimitations.some(l => l.includes('未执行联网检验')));
  assert.equal(before.meta.researchedAt, null);
  assert.equal(before.meta.reviewAfter, null);
  assert.equal(service.today().items.some(item => item.noteId === before.id), false);
  assert.throws(() => service.startStudy({ noteId: before.id }), error => error.code === 'RESEARCH_REQUIRED');
  const generateCount = mock.events.filter(e => e.capability === 'generate').length;
  const job = service.processNote(imported.notes[0].id, { research: true, reuseExtracted: true });
  assert.equal(service.processNote(imported.notes[0].id, { research: true, reuseExtracted: true }).id, job.id);
  await drainQueuedJobs(service);
  assert.equal(mock.events.filter(e => e.capability === 'generate').length, generateCount);
  assert.equal(mock.events.filter(e => e.capability === 'research').length, 1);
  const after = service.listNotes({ kind: 'knowledge' })[0];
  assert.equal(after.id, before.id);
  assert.deepEqual(after.meta.researchLimitations, []);
  assert.ok(after.meta.researchedAt);
  service.processNote(imported.notes[0].id);
  await drainQueuedJobs(service);
  assert.equal(service.getNote(after.id).hash, after.hash);
});

test('legacy queued extraction and non-boolean research values never opt into network research', async t => {
  const { service, mock } = await harness(t);
  let batches = 0;
  mock.api.researchBatch = async () => { batches++; throw new Error('不应自动调用批量核验'); };
  const source = service.importItems({ items: [{ title: '旧任务', body: '旧任务资料', privacy: 'cloud' }] }).notes[0];
  service.queue('process', { noteId: source.id, hash: source.hash }, 'legacy');
  await drainQueuedJobs(service);
  service.processNote(source.id, { research: 'true' });
  await drainQueuedJobs(service);
  assert.equal(mock.events.filter(e => e.capability === 'research').length, 0);
  assert.equal(batches, 0);
});

test('orchestration-only mock covers source evidence, learning, mistake dispute, and user confirmation', async t => {
  const { service, mock } = await harness(t);
  service.updateSettings({ ai: { enabled: true } });
  const imported = service.importItems({
    items: [{ title: '云端授权测试资料', body: '用于本地编排测试的来源正文。', privacy: 'cloud' }],
    process: true, research: true,
  });
  await drainQueuedJobs(service);

  const source = imported.notes[0];
  let candidate = service.listNotes({ kind: 'knowledge' }).find(note => note.meta.processKey?.startsWith(`${source.id}:`));
  assert.ok(candidate);
  assert.equal(candidate.meta.sources.some(ref => ref.id === source.id && ref.role === 'input'), true);
  assert.equal(candidate.meta.sources.some(ref => ref.role === 'support'), true);
  assert.equal(candidate.meta.evidence.length, 1);
  assert.match(candidate.body, /受控证据正文/);
  assert.equal(mock.events.some(event => event.capability === 'research'), true);

  candidate = service.promote(candidate.id, { stage: 'learning', reason: '用户主动加入编排测试学习', depth: 'explain' });
  const plan = service.today().items.find(item => item.noteId === candidate.id);
  assert.ok(plan);
  const session = service.startStudy({ noteId: candidate.id, planId: plan.id });
  service.answerStudy(session.id, { answer: '错误地忽略了成立条件。', requestId: 'pipeline-answer-1' });
  await drainQueuedJobs(service);

  const graded = service.session(session.id);
  assert.equal(graded.feedback.assessment, 'incorrect');
  const mistake = service.listNotes({ kind: 'mistake' }).find(note => note.meta.noteId === candidate.id);
  assert.ok(mistake);
  assert.match(mistake.body, /错误记录，不能作为正确知识引用/);
  const disputed = service.mistakeAction(mistake.id, { action: 'dispute', reason: '用户认为题目条件表述不完整' });
  assert.equal(disputed.meta.correctionState, 'disputed');

  const confirmed = service.confirmStudy(session.id, { body: '我的理解：结论依赖连续、可导等明确条件，并需说明适用边界。' });
  assert.equal(confirmed.meta.stage, 'integrated');
  assert.equal(confirmed.meta.confirmedBy, 'user');
  assert.match(confirmed.body, /我的理解（用户确认）/);
});

test('simulated research failure keeps a limited candidate out of learning and RAG answers', async t => {
  const { service } = await harness(t, { researchFailure: true });
  const imported = service.importItems({
    items: [{ title: '研究失败资料', body: '需要研究但测试桩故意失败。', privacy: 'cloud' }],
    process: true, research: true,
  });
  await drainQueuedJobs(service);
  const processJob = service.store.get('jobs', imported.jobs[0].id);
  assert.equal(processJob.state, 'waiting');
  assert.equal(processJob.code, 'RESEARCH_INCOMPLETE');

  let candidate = service.listNotes({ kind: 'knowledge' })[0];
  assert.ok(candidate.meta.researchLimitations.some(item => item.includes('尚待核验')));
  assert.ok(processJob.runtimeIssues.some(item => item.message.includes('模拟研究失败')));
  candidate = service.promote(candidate.id, { stage: 'learning', reason: '仅验证受限材料隔离', depth: 'explain' });
  assert.equal(service.today().items.some(item => item.noteId === candidate.id), false);
  assert.throws(() => service.startStudy({ noteId: candidate.id }), error => error.code === 'RESEARCH_REQUIRED');
  const answer = await service.ask({ question: '北辰', scope: ['knowledge'] });
  assert.equal(answer.citations.length, 0);
  assert.match(answer.answer, /没有找到可直接支持/);
});

test('a changed source makes its old processKey candidate ineligible for study and RAG answers', async t => {
  const { service } = await harness(t);
  const imported = service.importItems({
    items: [{ title: '会变化的来源', body: '来源初始版本。', privacy: 'cloud' }],
    process: true, research: true,
  });
  await drainQueuedJobs(service);
  let candidate = service.listNotes({ kind: 'knowledge' })[0];
  candidate = service.promote(candidate.id, { stage: 'learning', reason: '先加入学习再修改底层来源', depth: 'explain' });
  const source = service.getNote(imported.notes[0].id);
  service.editNote(source.id, { body: '来源已由用户外部修订后的版本。', expectedHash: source.hash });

  const found = await service.search('北辰', { scope: ['knowledge'] });
  assert.equal(found.results[0]?.id, candidate.id);
  assert.equal(found.results[0].limitations.some(item => item.includes('底层原始资料已修改')), true);
  assert.equal(service.today().items.some(item => item.noteId === candidate.id), false);
  const answer = await service.ask({ question: '北辰', scope: ['knowledge'] });
  assert.equal(answer.citations.length, 0);
  assert.match(answer.answer, /没有找到可直接支持/);
});

test('string budget settings are normalized and persisted as numbers', async t => {
  const { service } = await harness(t);
  const updated = service.updateSettings({ ai: { dailyCallLimit: '12', monthlyBudget: '34.5' } });
  assert.equal(updated.ai.dailyCallLimit, 12);
  assert.equal(updated.ai.monthlyBudget, 34.5);
  assert.equal(typeof updated.ai.dailyCallLimit, 'number');
  assert.equal(typeof updated.ai.monthlyBudget, 'number');
  const stored = service.store.get('settings', 'main');
  assert.equal(typeof stored.ai.dailyCallLimit, 'number');
  assert.equal(typeof stored.ai.monthlyBudget, 'number');
});

test('hybrid search and ask remain local by default even with cloud notes and capabilities enabled', async t => {
  const { service, mock } = await harness(t);
  service.updateSettings({ ai: { enabled: true }, embedding: { enabled: true, model: 'orchestration-test' } });
  const note = createKnowledge(service, {
    title: '默认本地查询',
    body: '默认本地独有词玄鸟',
    privacy: 'cloud',
  });
  const search = await service.search('玄鸟', { mode: 'hybrid' });
  assert.equal(search.results[0]?.id, note.id);
  assert.equal(search.diagnostics.limitations.some(item => item.includes('本次查询仅留本地')), true);
  const answer = await service.ask({ question: '玄鸟', scope: ['knowledge'] });
  assert.equal(answer.citations[0]?.id, note.id);
  assert.match(answer.answer, /本次问题仅限本地/);
  assert.deepEqual(mock.events, []);
});

test('explicit cloud privacy enables bounded embed and generation with real retrieved ids', async t => {
  const { service, mock } = await harness(t);
  service.updateSettings({ ai: { enabled: true }, embedding: { enabled: true, model: 'orchestration-test' } });
  const note = createKnowledge(service, {
    title: '显式外发测试',
    body: '显式外发独有词瑶光',
    privacy: 'cloud',
  });
  mock.state.answerId = note.id;
  const result = await service.ask({ question: '瑶光', scope: ['knowledge'], privacy: 'cloud' });
  assert.match(result.answer, new RegExp(`\\[${note.id}\\]`));
  assert.deepEqual(result.citations.map(item => item.id), [note.id]);
  assert.equal(mock.events.some(event => event.capability === 'embed' && event.input.privacy === 'cloud'), true);
  assert.equal(mock.events.some(event => event.capability === 'generate' && event.input.privacy === 'cloud'), true);
});

test('fabricated citation lists and fabricated inline ids are both rejected without saving drafts', async t => {
  const { service, mock } = await harness(t);
  service.updateSettings({ ai: { enabled: true } });
  const note = createKnowledge(service, {
    title: '引用约束测试',
    body: '引用约束独有词开阳',
    privacy: 'cloud',
  });
  mock.state.answerId = note.id;
  mock.state.askMode = 'bad-list';
  await assert.rejects(
    () => service.ask({ question: '开阳', scope: ['knowledge'], privacy: 'cloud' }),
    error => error.code === 'INVALID_CITATION',
  );
  mock.state.askMode = 'bad-inline';
  await assert.rejects(
    () => service.ask({ question: '开阳', scope: ['knowledge'], privacy: 'cloud' }),
    error => error.code === 'INVALID_CITATION',
  );
  assert.equal(service.store.records('drafts').length, 0);
});

test('merging cloud and local knowledge produces a local retained note', async t => {
  const { service } = await harness(t);
  const cloud = createKnowledge(service, { title: '云端材料', body: '云端正文', privacy: 'cloud' });
  const local = createKnowledge(service, { title: '本地材料', body: '本地正文', privacy: 'local' });
  const merged = service.merge({
    keepId: cloud.id,
    mergeId: local.id,
    expectedHash: cloud.hash,
    mergeHash: local.hash,
    preview: false,
  });
  assert.equal(merged.meta.privacy, 'local');
  const retired = service.getNote(local.id);
  assert.equal(retired.meta.stage, 'retired');
  assert.equal(retired.meta.supersededBy, cloud.id);
});

test('lowering the daily budget defers existing pending work until pending minutes fit', async t => {
  const { service } = await harness(t);
  for (let index = 0; index < 5; index += 1) {
    createKnowledge(service, {
      title: `预算缩减知识 ${index}`,
      body: `预算缩减正文 ${index}`,
      privacy: 'local',
      stage: 'learning',
    });
  }
  const initial = service.today();
  assert.equal(initial.minutes, 25);
  service.updateSettings({ dailyMinutes: 5 });
  const reduced = service.today();
  assert.ok(reduced.minutes <= 5);
  assert.equal(reduced.items.filter(item => item.state === 'pending').length, 1);
  assert.equal(service.store.records('plans').filter(item => item.state === 'budget_deferred').length, 4);
});

test('AI learning packages cannot reference ids outside the eligible material set', async t => {
  const { service, mock } = await harness(t);
  service.updateSettings({ ai: { enabled: true } });
  const note = createKnowledge(service, {
    title: '学习包现有材料',
    body: '学习包已有正文',
    privacy: 'cloud',
    stage: 'learning',
  });
  mock.state.topicIds = [note.id, 'invented-note-id'];
  const job = service.queue('topics', {}, 'pipeline-invalid-topic-ids');
  await service.runJobs();
  const failed = service.store.get('jobs', job.id);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.code, 'INVALID_CITATION');
  assert.equal(service.listNotes({ kind: 'report' }).some(item => item.title === 'AI 学习包建议'), false);
});

test('a cached research result with limitations is retried instead of suppressing research for seven days', async t => {
  const { service, mock } = await harness(t);
  mock.state.researchMode = 'limited';
  const imported = service.importItems({
    items: [{ title: '受限缓存重试', body: '第一次研究返回限制，第二次应重新研究。', privacy: 'cloud' }],
    process: true, research: true,
  });
  await drainQueuedJobs(service);
  const firstJob = service.store.get('jobs', imported.jobs[0].id);
  assert.equal(firstJob.state, 'waiting');
  assert.equal(firstJob.code, 'RESEARCH_INCOMPLETE');
  let candidate = service.listNotes({ kind: 'knowledge' })[0];
  assert.ok(candidate.meta.researchLimitations.length > 0);
  assert.equal(mock.events.filter(event => event.capability === 'research').length, 1);

  mock.state.researchMode = 'success';
  const retry = service.queue(
    'process',
    { noteId: imported.notes[0].id, hash: imported.notes[0].hash, research: true },
    `limited-cache-retry:${imported.notes[0].id}`,
  );
  await drainQueuedJobs(service);
  assert.equal(service.store.get('jobs', retry.id).state, 'done');
  assert.equal(mock.events.filter(event => event.capability === 'research').length, 2);
  candidate = service.getNote(candidate.id);
  assert.deepEqual(candidate.meta.researchLimitations, []);
  assert.equal(candidate.meta.evidence.length, 1);
});

test('reprocessing a user-edited candidate creates a pending proposal and applies it only after acceptance', async t => {
  const { service, mock } = await harness(t);
  const imported = service.importItems({
    items: [{ title: '用户编辑保护', body: '加工后用户会修改候选知识。', privacy: 'cloud' }],
    process: true, research: true,
  });
  await drainQueuedJobs(service);
  let candidate = service.listNotes({ kind: 'knowledge' })[0];
  const userBody = '用户亲自改写的正文，重新加工不能覆盖。';
  candidate = service.editNote(candidate.id, { body: userBody, expectedHash: candidate.hash });
  const userHash = candidate.hash;
  const userTopic = candidate.meta.topic;

  mock.state.candidateBody = '重新研究后建议采用的新正文。';
  mock.state.candidateTopic = '重新研究主题';
  const retry = service.queue(
    'process',
    { noteId: imported.notes[0].id, hash: imported.notes[0].hash, research: true },
    `user-edit-retry:${candidate.id}`,
  );
  await drainQueuedJobs(service);
  assert.equal(service.store.get('jobs', retry.id).state, 'done');

  const unchanged = service.getNote(candidate.id);
  assert.equal(unchanged.body, userBody);
  assert.equal(unchanged.hash, userHash);
  assert.equal(unchanged.meta.topic, userTopic);
  const proposals = service.store.records('proposals').filter(item => item.noteId === candidate.id && item.state === 'pending');
  assert.equal(proposals.length, 1);
  assert.match(proposals[0].body, /重新研究后建议采用的新正文/);
  assert.equal(proposals[0].meta.topic, '重新研究主题');

  const accepted = service.proposalAction(proposals[0].id, { action: 'accept' });
  assert.equal(accepted.state, 'accepted');
  const applied = service.getNote(candidate.id);
  assert.match(applied.body, /重新研究后建议采用的新正文/);
  assert.equal(applied.meta.topic, '重新研究主题');
  assert.equal(applied.meta.stage, 'candidate');
  assert.equal(applied.meta.userEdited, false);
});

test('reprocessing detects an external body edit through generatedBodyHash and proposes instead of overwriting', async t => {
  const { service, mock } = await harness(t);
  const imported = service.importItems({
    items: [{ title: '外部编辑保护', body: '加工后从 Vault 外部编辑候选。', privacy: 'cloud' }],
    process: true, research: true,
  });
  await drainQueuedJobs(service);
  let candidate = service.listNotes({ kind: 'knowledge' })[0];
  const file = path.join(service.store.vaultDir, candidate.path);
  const externalBody = '用户在 Obsidian 中修改的正文，必须保留。';
  const raw = await readFile(file, 'utf8');
  await writeFile(file, raw.replace(candidate.body, externalBody), 'utf8');
  candidate = service.getNote(candidate.id);
  assert.equal(candidate.body, externalBody);
  assert.equal(candidate.meta.userEdited, undefined);

  mock.state.candidateBody = '再次加工生成但尚未确认的新正文。';
  const retry = service.queue(
    'process',
    { noteId: imported.notes[0].id, hash: imported.notes[0].hash, research: true },
    `external-edit-retry:${candidate.id}`,
  );
  await drainQueuedJobs(service);
  assert.equal(service.store.get('jobs', retry.id).state, 'done');
  assert.equal(service.getNote(candidate.id).body, externalBody);
  const proposal = service.store.records('proposals').find(item => item.noteId === candidate.id && item.state === 'pending');
  assert.ok(proposal);
  assert.match(proposal.body, /再次加工生成但尚未确认的新正文/);
});
