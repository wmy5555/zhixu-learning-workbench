import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { createService } from '../src/service.mjs';

const projectDir = path.resolve(import.meta.dirname, '..');
const tempRoot = path.join(projectDir, '.tmp');
await mkdir(tempRoot, { recursive: true });
const root = await mkdtemp(path.join(tempRoot, 'quality-'));
const service = createService({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault') });

try {
  const notes = [];
  for (let index = 0; index < 17; index += 1) {
    notes.push(service.store.create({
      kind: 'knowledge',
      title: `质量样本 ${String(index + 1).padStart(2, '0')}`,
      body: `离线质量检查的普通材料 ${index + 1}，主题编号 Q${index + 1}。`,
      meta: { stage: 'candidate', privacy: 'local', topic: `样本主题 ${index % 4}` },
    }));
  }
  const exact = service.store.create({
    kind: 'knowledge',
    title: '拉格朗日中值定理',
    body: '在满足连续与可导条件时讨论函数增量和导数的关系。',
    meta: { stage: 'candidate', privacy: 'local', topic: '数学分析' },
  });
  const related = service.store.create({
    kind: 'knowledge',
    title: '导数与局部变化率',
    body: '这是中值定理的前置概念测试材料。',
    meta: { stage: 'candidate', privacy: 'local', topic: '数学分析' },
  });
  const excluded = service.store.create({
    kind: 'knowledge',
    title: '已停用样本',
    body: '隔离专用词朱雀只存在于停用材料。',
    meta: { stage: 'retired', privacy: 'local' },
  });
  const relationId = 'quality-relation';
  service.store.put('relations', relationId, {
    id: relationId,
    fromId: exact.id,
    toId: related.id,
    fromHash: exact.hash,
    toHash: related.hash,
    type: 'prerequisite',
    state: 'suggested',
    explanation: '导数概念是理解该定理陈述的前置。',
    evidence: [exact.id, related.id],
  });
  service.relationAction(relationId, {action:'accept',reason:'合成质量样本中明确确认的前置联系。'});

  const started = performance.now();
  const exactResult = await service.search('拉格朗日中值定理');
  const excludedResult = await service.search('朱雀');
  const relatedResult = service.related(exact.id);
  const elapsedMs = performance.now() - started;
  const output = {
    measuredAt: new Date().toISOString(),
    runtime: process.version,
    sampleSize: service.store.list().length,
    checks: {
      exactChineseTerm: {
        passed: exactResult.results[0]?.id === exact.id,
        resultIds: exactResult.results.map(item => item.id),
      },
      acceptedRelation: {
        passed: relatedResult.notes.some(item => item.id === related.id),
        relationCount: relatedResult.relations.length,
      },
      retiredIsolation: {
        passed: !excludedResult.results.some(item => item.id === excluded.id),
        resultCount: excludedResult.results.length,
      },
    },
    measuredElapsedMs: Number(elapsedMs.toFixed(3)),
    limitations: [
      '这是 20 条本地合成材料上的可重复功能检查，不代表真实知识库容量或语义质量。',
      '未启用向量、模型、搜索或网络能力；相关知识检查使用明确保存的关系。',
      '单次耗时受当前机器、磁盘缓存和后台负载影响，不能作为性能保证。',
    ],
  };
  output.passed = Object.values(output.checks).every(check => check.passed);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!output.passed) process.exitCode = 1;
} finally {
  service.close();
  await rm(root, { recursive: true, force: true });
}
