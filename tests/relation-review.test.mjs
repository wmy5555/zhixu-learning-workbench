import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createService } from '../src/service.mjs';

const projectDir = path.resolve(import.meta.dirname, '..');
const tempRoot = path.join(projectDir, '.tmp');
await mkdir(tempRoot, { recursive: true });

async function harness(t) {
  const root = await mkdtemp(path.join(tempRoot, 'relation-review-'));
  const service = createService({
    dataDir: path.join(root, 'data'),
    vaultDir: path.join(root, 'vault'),
  });
  t.after(async () => {
    await service.close();
    await rm(root, { recursive: true, force: true });
  });
  return service;
}

function createKnowledge(service, {
  title,
  body,
  stage = 'candidate',
  sources = [],
  supersededBy,
  researchLimitations = [],
}) {
  return service.store.create({
    kind: 'knowledge',
    title,
    body,
    meta: {
      privacy: 'local',
      stage,
      sources,
      researchLimitations,
      ...(supersededBy ? { supersededBy } : {}),
    },
  });
}

function putRelation(service, id, from, to, overrides = {}) {
  const relation = {
    id,
    fromId: from.id,
    toId: to.id,
    fromHash: from.hash,
    toHash: to.hash,
    state: 'suggested',
    type: 'application',
    highValue: true,
    valueScore: 10,
    explanation: `${from.title} 与 ${to.title} 存在可复核联系。`,
    use: '帮助比较两个知识条目的适用条件。',
    boundary: '只适用于各自正文明确给出的条件。',
    sourceExcerpt: from.body.slice(0, 18),
    targetExcerpt: to.body.slice(0, 18),
    createdAt: '2026-09-20T00:00:00.000Z',
    ...overrides,
  };
  service.store.put('relations', id, relation);
  return relation;
}

test('relationReview shows only the three highest-value valid suggestions and keeps raw history', async t => {
  const service = await harness(t);
  const eligible = Array.from({ length: 10 }, (_, index) => createKnowledge(service, {
    title: `有效知识 ${index + 1}`,
    body: `有效知识 ${index + 1} 的正文片段，可用于逐字核对关系依据。`,
  }));
  const scores = [15, 45, 25, 55, 35];
  const valid = scores.map((valueScore, index) => putRelation(
    service,
    `valid-${index + 1}`,
    eligible[index * 2],
    eligible[index * 2 + 1],
    { valueScore },
  ));

  const noiseLeft = createKnowledge(service, { title: '历史噪声左端', body: '历史噪声左端正文可供匹配。' });
  const noiseRight = createKnowledge(service, { title: '历史噪声右端', body: '历史噪声右端正文可供匹配。' });
  putRelation(service, 'old-similarity', noiseLeft, noiseRight, {
    type: 'similarity',
    valueScore: 999,
  });
  putRelation(service, 'old-low-value', noiseLeft, noiseRight, {
    highValue: false,
    valueScore: 998,
  });
  putRelation(service, 'old-incomplete-fields', noiseLeft, noiseRight, {
    boundary: '',
    valueScore: 997,
  });
  putRelation(service, 'old-unmatched-excerpt', noiseLeft, noiseRight, {
    sourceExcerpt: '这段文字不在左端正文中',
    valueScore: 996,
  });

  const sharedSource = service.store.create({
    kind: 'source',
    title: '共同输入来源',
    body: '共同输入来源正文。',
    meta: { privacy: 'local', stage: 'reference' },
  });
  const siblingLeft = createKnowledge(service, {
    title: '同源兄弟一',
    body: '同源兄弟一正文。',
    sources: [{ id: sharedSource.id, role: 'input' }],
  });
  const siblingRight = createKnowledge(service, {
    title: '同源兄弟二',
    body: '同源兄弟二正文。',
    sources: [{ id: sharedSource.id, role: 'input' }],
  });
  putRelation(service, 'same-input-siblings', siblingLeft, siblingRight, { valueScore: 995 });

  const rawBefore = service.store.records('relations');
  const report = service.store.create({
    kind: 'report',
    title: '关系检查报告',
    body: '这是本地关系检查报告。',
    meta: { privacy: 'local', generated: true },
  });
  const review = service.relationReview();

  assert.deepEqual(Object.keys(review).sort(), ['deferredCount', 'relations', 'reports']);
  const suggested = review.relations.filter(relation => relation.state === 'suggested');
  assert.deepEqual(suggested.map(relation => relation.id), ['valid-4', 'valid-2', 'valid-5']);
  assert.deepEqual(suggested.map(relation => relation.valueScore), [55, 45, 35]);
  assert.equal(review.deferredCount, 2);
  assert.deepEqual(review.reports.map(item => item.id), [report.id]);
  for (const relation of suggested) {
    assert.equal(relation.fromTitle, service.getNote(relation.fromId).title);
    assert.equal(relation.toTitle, service.getNote(relation.toId).title);
  }
  assert.equal(review.relations.some(relation => relation.id.startsWith('old-')), false);
  assert.equal(review.relations.some(relation => relation.id === 'same-input-siblings'), false);

  const rawAfter = service.store.records('relations');
  assert.equal(rawAfter.length, rawBefore.length);
  assert.deepEqual(
    rawAfter.map(relation => relation.id).sort(),
    rawBefore.map(relation => relation.id).sort(),
  );
  assert.deepEqual(
    new Set(rawAfter.filter(relation => relation.id.startsWith('valid-')).map(relation => relation.id)),
    new Set(valid.map(relation => relation.id)),
  );
});

test('relationReview excludes stale, missing, retired, superseded, and research-limited endpoints', async t => {
  const service = await harness(t);
  const activeLeft = createKnowledge(service, { title: '当前左端', body: '当前左端正文片段。' });
  const activeRight = createKnowledge(service, { title: '当前右端', body: '当前右端正文片段。' });
  putRelation(service, 'stale-hash', activeLeft, activeRight, {
    fromHash: 'outdated-hash',
    valueScore: 100,
  });
  putRelation(service, 'missing-endpoint', activeLeft, activeRight, {
    toId: 'missing-note-id',
    valueScore: 99,
  });

  const retired = createKnowledge(service, {
    title: '已退休端点',
    body: '已退休端点正文。',
    stage: 'retired',
  });
  putRelation(service, 'retired-endpoint', activeLeft, retired, { valueScore: 98 });
  const superseded = createKnowledge(service, {
    title: '已替代端点',
    body: '已替代端点正文。',
    supersededBy: activeRight.id,
  });
  putRelation(service, 'superseded-endpoint', activeLeft, superseded, { valueScore: 97 });
  const limited = createKnowledge(service, {
    title: '待核验端点',
    body: '待核验端点正文。',
    researchLimitations: ['关键事实尚待核验。'],
  });
  putRelation(service, 'limited-endpoint', activeLeft, limited, { valueScore: 96 });

  const rawIds = service.store.records('relations').map(relation => relation.id).sort();
  const review = service.relationReview();
  assert.deepEqual(review.relations, []);
  assert.equal(review.deferredCount, 0);
  assert.deepEqual(service.store.records('relations').map(relation => relation.id).sort(), rawIds);
});

test('relationReview keeps valid accepted relations and enriches UUID-like labels from current titles', async t => {
  const service = await harness(t);
  const from = createKnowledge(service, {
    title: '当前清晰标题：来源知识',
    body: '来源知识当前正文。',
  });
  const to = createKnowledge(service, {
    title: '当前清晰标题：目标知识',
    body: '目标知识当前正文。',
  });
  const accepted = putRelation(service, 'accepted-existing', from, to, {
    state: 'accepted',
    type: 'similarity',
    highValue: false,
    valueScore: 0,
    explanation: '',
    use: '',
    boundary: '',
    sourceExcerpt: '',
    targetExcerpt: '',
    fromTitle: '7d5c9668-4218-46ed-bfdf-22d4d2b4c311',
    toTitle: '044a2b67-fca0-4896-b469-81201297b138',
  });

  const review = service.relationReview();
  assert.equal(review.relations.length, 1);
  assert.equal(review.relations[0].id, accepted.id);
  assert.equal(review.relations[0].state, 'accepted');
  assert.equal(review.relations[0].fromTitle, from.title);
  assert.equal(review.relations[0].toTitle, to.title);
  assert.equal(service.store.get('relations', accepted.id).fromTitle, accepted.fromTitle);
  assert.equal(service.store.get('relations', accepted.id).toTitle, accepted.toTitle);
});

test('remove accepted relation after note changes clears stored links without deleting notes', async t => {
  const service=await harness(t);
  const left=createKnowledge(service,{title:'左侧',body:'左侧正文'});
  const right=createKnowledge(service,{title:'右侧',body:'右侧正文'});
  const r={id:'remove-test',fromId:left.id,toId:right.id,fromHash:left.hash,toHash:right.hash,state:'suggested',type:'similarity'};
  service.store.put('relations',r.id,r);
  service.relationAction(r.id,{action:'accept'});
  const updated=service.getNote(left.id);
  service.store.update(left.id,{expectedHash:updated.hash,body:'后来修改的正文'});
  service.relationAction(r.id,{action:'remove'});
  assert.equal(service.store.get('relations',r.id).state,'rejected');
  assert.equal(service.getNote(left.id).body,'后来修改的正文');
  assert.equal(service.getNote(right.id).body,'右侧正文');
  assert.ok(!service.getNote(left.id).meta.relations.some(x=>x.id===r.id));
  assert.ok(!service.related(left.id).relations.some(x=>x.id===r.id));
  assert.ok(!service.relationReview().relations.some(x=>x.id===r.id));
  service.relationAction(r.id,{action:'remove'});
});
