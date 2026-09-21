import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createService } from '../src/service.mjs';
import { hash } from '../src/store.mjs';

const projectDir = path.resolve(import.meta.dirname, '..');
const tempRoot = path.join(projectDir, '.tmp');
await mkdir(tempRoot, { recursive: true });

async function harness(t, aiOverride) {
  const root = await mkdtemp(path.join(tempRoot, 'grouped-processing-'));
  const service = createService({
    dataDir: path.join(root, 'data'),
    vaultDir: path.join(root, 'vault'),
    ...(aiOverride ? { aiOverride } : {}),
  });
  t.after(async () => {
    await service.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, service };
}

function createSource(service, { title, body, excerptOnly = false }) {
  return service.store.create({
    kind: 'source',
    title,
    body,
    meta: {
      privacy: 'cloud',
      stage: 'reference',
      ...(excerptOnly ? { excerptOnly: true, url: 'https://example.invalid/internal-evidence' } : {}),
    },
  });
}

function createGeneratedKnowledge(service, {
  source,
  evidenceSource,
  title,
  visibleText,
  index,
  stage = 'candidate',
  linkBy = 'sources',
}) {
  const body = `## 原资料拆解（AI 整理）\n\n${visibleText}\n\n## 证据与适用范围\n\n公开核验结论 ${index}\n\n- [内部证据](https://example.invalid/internal-evidence)（support）\n  INTERNAL_EVIDENCE_${index}\n\n### 研究范围\n内部研究过程 ${index}`;
  const sources = linkBy === 'sources'
    ? [{ id: source.id, role: 'input' }, { id: evidenceSource.id, role: 'support' }]
    : [{ id: evidenceSource.id, role: 'support' }];
  return service.store.create({
    kind: 'knowledge',
    title,
    body,
    meta: {
      stage,
      privacy: 'cloud',
      sources,
      processKey: `${source.id}:${source.hash}:${index}`,
      generatedBodyHash: hash(body),
      evidence: [{
        url: 'https://example.invalid/internal-evidence',
        excerpt: `INTERNAL_EVIDENCE_${index}`,
        role: 'support',
      }],
      researchConclusions: `公开核验结论 ${index}`,
      researchLimitations: [],
    },
  });
}

test('library groups children, applies filters, hides internal evidence, and does not delete stored records', async t => {
  const { service } = await harness(t);
  const source = createSource(service, { title: '分组原始资料', body: '分组来源正文。' });
  const evidenceSource = createSource(service, {
    title: '内部证据摘录',
    body: 'INTERNAL_SOURCE_BODY',
    excerptOnly: true,
  });
  const bySourceRole = createGeneratedKnowledge(service, {
    source,
    evidenceSource,
    title: '角色关联子知识',
    visibleText: 'ROLE_CHILD_TOKEN',
    index: 0,
    stage: 'candidate',
  });
  const byProcessKey = createGeneratedKnowledge(service, {
    source,
    evidenceSource,
    title: '加工键关联子知识',
    visibleText: 'PROCESS_CHILD_TOKEN',
    index: 1,
    stage: 'learning',
    linkBy: 'processKey',
  });
  const standalone = service.store.create({
    kind: 'knowledge',
    title: '独立知识',
    body: 'STANDALONE_TOKEN',
    meta: { stage: 'candidate', privacy: 'local', sources: [] },
  });
  const originalCount = service.store.list().length;

  const library = service.library();
  assert.deepEqual(Object.keys(library).sort(), ['groups', 'standalone']);
  assert.equal(library.groups.length, 1);
  assert.equal(library.groups[0].source.id, source.id);
  assert.deepEqual(
    new Set(library.groups[0].children.map(note => note.id)),
    new Set([bySourceRole.id, byProcessKey.id]),
  );
  assert.deepEqual(library.groups[0].jobs, []);
  assert.deepEqual(library.standalone.map(note => note.id), [standalone.id]);
  assert.equal(
    [...library.groups.flatMap(group => [group.source, ...group.children]), ...library.standalone]
      .some(note => note.id === evidenceSource.id || note.meta.excerptOnly),
    false,
  );

  const publicChild = library.groups[0].children.find(note => note.id === bySourceRole.id);
  assert.equal('evidence' in publicChild.meta, false);
  assert.deepEqual(publicChild.meta.sources, [{ id: source.id, role: 'input' }]);
  assert.match(publicChild.body, /ROLE_CHILD_TOKEN/);
  assert.match(publicChild.body, /## 核验结论/);
  assert.doesNotMatch(publicChild.body, /## 证据与适用范围|INTERNAL_EVIDENCE|internal-evidence/);

  const filteredByQuery = service.library({ q: 'PROCESS_CHILD_TOKEN' });
  assert.deepEqual(filteredByQuery.groups.map(group => group.source.id), [source.id]);
  assert.equal(filteredByQuery.groups[0].children.length, 2);
  assert.deepEqual(filteredByQuery.standalone, []);
  const filteredByKindAndStage = service.library({ kind: 'knowledge', stage: 'learning' });
  assert.deepEqual(filteredByKindAndStage.groups.map(group => group.source.id), [source.id]);
  assert.equal(filteredByKindAndStage.groups[0].children.length, 2);
  assert.deepEqual(service.library({ q: 'STANDALONE_TOKEN' }).standalone.map(note => note.id), [standalone.id]);

  const readSource = service.readPublicNote(source.id);
  assert.deepEqual(new Set(readSource.children.map(note => note.id)), new Set([bySourceRole.id, byProcessKey.id]));
  assert.throws(
    () => service.readPublicNote(evidenceSource.id),
    error => error.code === 'NOT_FOUND',
  );

  assert.equal(service.store.list().length, originalCount);
  assert.equal(service.getNote(evidenceSource.id).body, 'INTERNAL_SOURCE_BODY');
  assert.equal(service.getNote(bySourceRole.id).meta.evidence[0].excerpt, 'INTERNAL_EVIDENCE_0');
});

test('public reads preserve a body that was actually edited outside the service', async t => {
  const { service } = await harness(t);
  const source = createSource(service, { title: '外部编辑来源', body: '来源正文。' });
  const evidenceSource = createSource(service, {
    title: '外部编辑测试内部证据',
    body: 'INTERNAL_SOURCE_BODY',
    excerptOnly: true,
  });
  const child = createGeneratedKnowledge(service, {
    source,
    evidenceSource,
    title: '会被外部编辑的子知识',
    visibleText: '自动生成正文',
    index: 2,
  });
  const externalBody = '用户在 Markdown 编辑器中写下的完整正文。\n\n## 证据与适用范围\n\n这段标题和说明也是用户正文的一部分，应原样保留。';
  const file = path.join(service.store.vaultDir, ...child.path.split('/'));
  const raw = await readFile(file, 'utf8');
  await writeFile(file, raw.replace(child.body, externalBody), 'utf8');

  const externallyEdited = service.getNote(child.id);
  assert.equal(externallyEdited.body, externalBody);
  assert.equal(externallyEdited.meta.userEdited, undefined);
  const publicChild = service.readPublicNote(child.id);
  assert.equal(publicChild.body, externalBody);
  assert.equal('evidence' in publicChild.meta, false);
  assert.deepEqual(publicChild.meta.sources, [{ id: source.id, role: 'input' }]);
});

test('processing batches unique claims once inside the source budget and leaves partial research ineligible', async t => {
  const events = [];
  const ai = {
    async withBudget(options, fn) {
      events.push({ type: 'withBudget', options });
      return fn();
    },
    async generate(input) {
      events.push({ type: 'generate', input });
      return {
        text: JSON.stringify({
          candidates: [
            {
              title: '批量子知识一',
              body: '第一个候选正文。',
              topic: '批量研究主题',
              claims: ['共享主张', '第一项独有主张'],
              prerequisites: [],
              reason: '测试共享主张只研究一次。',
              depth: 'explain',
            },
            {
              title: '批量子知识二',
              body: '第二个候选正文。',
              topic: '批量研究主题',
              claims: ['共享主张', '第二项仍不完整'],
              prerequisites: [],
              reason: '测试部分结果仍被隔离。',
              depth: 'apply',
            },
          ],
        }),
      };
    },
    async researchBatch(input) {
      events.push({ type: 'researchBatch', input });
      const complete = claim => ({
        claim,
        conclusion: `${claim} 的受控结论。`,
        notice: '测试桩结果，只验证编排。',
        limitations: [],
        evidence: [{
          url: `https://example.invalid/${encodeURIComponent(claim)}`,
          title: `${claim} 证据`,
          excerpt: `${claim} 的受控证据摘录。`,
          locator: '测试段落',
          fetchedAt: '2026-09-20T00:00:00.000Z',
          role: 'support',
          rationale: '受控对应关系。',
        }],
      });
      return {
        results: [
          complete('共享主张'),
          complete('第一项独有主张'),
          {
            claim: '第二项仍不完整',
            conclusion: '',
            notice: '测试桩未取得充分证据。',
            limitations: ['第二项证据仍不完整。'],
            evidence: [],
          },
        ],
      };
    },
    async research() {
      assert.fail('存在 researchBatch 时不应逐条调用 research');
    },
  };
  const { service } = await harness(t, ai);
  const imported = service.importItems({
    items: [{ title: '批量研究原始资料', body: '两个候选会共享一项事实主张。', privacy: 'cloud' }],
    process: true, research: true,
  });
  const source = imported.notes[0];

  await service.runJobs();

  const budgetEvents = events.filter(event => event.type === 'withBudget');
  assert.equal(budgetEvents.length, 1);
  assert.deepEqual(budgetEvents[0].options, { limit: 12, sourceId: source.id });
  const batchEvents = events.filter(event => event.type === 'researchBatch');
  assert.equal(batchEvents.length, 1);
  assert.deepEqual(batchEvents[0].input.claims, ['共享主张', '第一项独有主张', '第二项仍不完整']);
  assert.equal(batchEvents[0].input.topic, source.title);
  assert.equal(batchEvents[0].input.privacy, 'cloud');
  assert.ok(batchEvents[0].input.signal instanceof AbortSignal);
  assert.equal(events.filter(event => event.type === 'generate').length, 1);

  const processJob = service.store.get('jobs', imported.jobs[0].id);
  assert.equal(processJob.state, 'waiting');
  assert.equal(processJob.code, 'RESEARCH_INCOMPLETE');
  assert.equal(service.store.records('jobs').some(job => job.type === 'relate'), false);

  const group = service.library().groups.find(item => item.source.id === source.id);
  assert.ok(group);
  assert.equal(group.children.length, 2);
  assert.deepEqual(group.jobs, [{ id: processJob.id, state: 'waiting', progress: 100 }]);
  const completeChild = service.listNotes({ kind: 'knowledge' }).find(note => note.title === '批量子知识一');
  let partialChild = service.listNotes({ kind: 'knowledge' }).find(note => note.title === '批量子知识二');
  assert.deepEqual(completeChild.meta.researchLimitations, []);
  assert.ok(partialChild.meta.researchLimitations.includes('第二项证据仍不完整。'));
  assert.equal(
    completeChild.meta.sources.filter(ref => ref.role === 'support').some(
      ref => partialChild.meta.sources.some(other => other.id === ref.id && other.role === 'support'),
    ),
    true,
  );

  partialChild = service.promote(partialChild.id, {
    stage: 'learning',
    reason: '验证部分研究结果不能进入学习计划。',
    depth: 'apply',
  });
  assert.equal(service.today().items.some(item => item.noteId === partialChild.id), false);
  assert.throws(
    () => service.startStudy({ noteId: partialChild.id }),
    error => error.code === 'RESEARCH_REQUIRED',
  );
});
