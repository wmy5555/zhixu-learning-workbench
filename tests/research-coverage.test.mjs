import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createAI } from '../src/ai.mjs';
import { createService } from '../src/service.mjs';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const chat = value => json({ choices: [{ message: { content: typeof value === 'string' ? value : JSON.stringify(value) } }] });
const claimsFor = count => Array.from({ length: count }, (_, index) => `CLAIM_${String(index).padStart(2, '0')} has a distinct synthetic condition.`);

function harness({ sourceCallLimit, prompts, allClaims = [], failOpposing = false } = {}) {
  const queries = [], pageUrls = [], modelClaims = [], requests = [], calls = [];
  const settings = {
    ai: { enabled: true, baseUrl: 'https://8.8.8.8/v1', model: 'synthetic-model', dailyCallLimit: 1000, monthlyBudget: 0, ...(sourceCallLimit === undefined ? {} : { sourceCallLimit }) },
    search: { enabled: true, baseUrl: 'https://8.8.8.8' }, fetch: { enabled: true }, prompts,
  };
  const ai = createAI({
    getSettings: () => settings,
    getSecret: () => 'synthetic-test-secret',
    getUsage: () => ({ callsToday: 0, costMonth: 0 }),
    recordCall: call => calls.push(call),
    fetchImpl: async (url, options) => {
      requests.push({ url, body: options.body });
      const target = new URL(url);
      if (target.pathname === '/search') {
        const query = JSON.parse(options.body).query;
        queries.push(query);
        if (failOpposing && query.includes('contradictory evidence')) return json({ error: 'Synthetic search failure' }, 400);
        const key = createHash('sha256').update(query).digest('hex').slice(0, 12);
        return json({ results: Array.from({ length: 4 }, (_, index) => ({ title: 'Synthetic evidence', url: `https://8.8.8.8/page-${key}-${index}`, content: 'A snippet is never evidence.' })) });
      }
      if (target.pathname === '/v1/chat/completions') {
        const prompt = JSON.parse(options.body).messages.at(-1).content;
        if (prompt === 'PRECALL') return chat('Synthetic preceding extraction call.');
        if (prompt.includes('拆解以下资料')) return chat({ candidates: [{ title: 'Synthetic grouped knowledge', body: 'Synthetic generated material, not real-world evidence.', topic: 'Synthetic', claims: allClaims, prerequisites: [], reason: 'A deterministic regression fixture.', depth: 'explain' }] });
        const match = prompt.match(/主张：(\[.*?\])\n\n候选正文：/s);
        assert.ok(match, 'Only the existing batch evaluation template should reach this branch');
        const evaluated = JSON.parse(match[1]); modelClaims.push(evaluated);
        return chat({ results: evaluated.map(({ claimIndex }) => ({ claimIndex,
          assessments: [{ pageIndex: 0, role: 'support', rationale: 'Synthetic fixture correspondence only.', excerpt: 'SYNTHETIC EVIDENCE' }],
          conclusion: 'Synthetic bounded conclusion only.', evidenceSufficient: true, unresolvedConflict: false, limitations: [] })) });
      }
      pageUrls.push(url);
      return new Response(`<html><body>SYNTHETIC EVIDENCE. ${allClaims.join(' ')} Page marker: ${target.pathname}.</body></html>`, { headers: { 'content-type': 'text/html' } });
    },
  });
  return { ai, queries, pageUrls, modelClaims, requests, calls };
}

test('later claims receive their own support and opposition queries within the shared page limit', async () => {
  const claims = claimsFor(8), h = harness({ allClaims: claims });
  const result = await h.ai.researchBatch({ claims, topic: 'A grouped synthetic topic', privacy: 'cloud' });
  assert.equal(h.queries.length, 6);
  for (const claim of claims) {
    assert.equal(h.queries.filter(query => query.includes(claim) && query.includes('primary source evidence')).length, 1);
    assert.equal(h.queries.filter(query => query.includes(claim) && query.includes('contradictory evidence')).length, 1);
  }
  assert.ok(h.queries.every(query => query.length <= 350));
  assert.ok(h.pageUrls.length <= 4);
  assert.ok(h.requests.length <= 11);
  assert.equal(h.modelClaims[0].length, 8);
  assert.ok(result.results.every(item => item.evidence.length === 1 && item.limitations.length === 0));
});

test('batches have a hard group cap even without an outer budget, and omitted claims are not sent to the evaluator', async () => {
  const claims = claimsFor(20), h = harness({ sourceCallLimit: 30, allClaims: claims });
  const result = await h.ai.researchBatch({ claims, privacy: 'cloud' });
  assert.equal(h.queries.length, 6);
  assert.ok(h.pageUrls.length <= 4);
  assert.ok(h.requests.length <= 11);
  assert.deepEqual(h.modelClaims[0].map(item => item.claim), claims.slice(0, 9));
  for (const item of result.results.slice(9)) {
    assert.match(item.limitations.join(' '), /未纳入本轮/);
    assert.deepEqual(item.evidence, []);
    assert.match(item.conclusion, /未执行/);
  }
});

test('research planning accounts for the preceding source call instead of resetting its budget', async () => {
  const claims = claimsFor(8), h = harness({ allClaims: claims });
  const result = await h.ai.withBudget({ limit: 8, sourceId: 'synthetic-source' }, async () => {
    await h.ai.generate({ system: 'Synthetic', prompt: 'PRECALL', privacy: 'cloud' });
    return h.ai.researchBatch({ claims, privacy: 'cloud' });
  });
  assert.equal(h.queries.length, 2);
  assert.ok(h.requests.length <= 8);
  assert.ok(h.calls.every(call => call.sourceId === 'synthetic-source'));
  assert.deepEqual(h.modelClaims[0].map(item => item.claim), claims.slice(0, 3));
  assert.ok(result.results.slice(3).every(item => item.limitations.some(message => message.includes('未纳入本轮'))));
});

test('insufficient budget and oversized custom search templates return explicit gaps without transport', async () => {
  const claims = claimsFor(4), small = harness({ allClaims: claims });
  const limited = await small.ai.withBudget({ limit: 3, sourceId: 'too-small' }, () => small.ai.researchBatch({ claims, privacy: 'cloud' }));
  assert.equal(small.requests.length, 0);
  assert.ok(limited.results.every(item => item.limitations.length > 0));
  const custom = harness({ allClaims: claims, prompts: { researchSearchSupport: `${'模板前缀'.repeat(100)} {{context}}` } });
  const omitted = await custom.ai.researchBatch({ claims, privacy: 'cloud' });
  assert.equal(custom.requests.length, 0);
  assert.ok(omitted.results.every(item => item.limitations.some(message => message.includes('350'))));
  await assert.rejects(() => custom.ai.researchBatch({ claims, privacy: 'local' }), { code: 'PRIVACY_LOCAL' });
  assert.equal(custom.requests.length, 0);
});

test('a failed search direction remains a coverage limitation despite a confident model response', async () => {
  const claims = claimsFor(2), h = harness({ allClaims: claims, failOpposing: true });
  const result = await h.ai.researchBatch({ claims, privacy: 'cloud' });
  assert.ok(result.results.every(item => item.limitations.some(message => message.includes('反证方向检索失败'))));
  assert.ok(result.results.every(item => item.evidence.every(evidence => evidence.excerpt === 'SYNTHETIC EVIDENCE')));
});

test('source retries reuse completed research and advance through the remaining groups without new extraction', async t => {
  const claims = claimsFor(7), h = harness({ allClaims: claims, sourceCallLimit: 8 });
  const base = path.resolve(import.meta.dirname, '..', '.tmp');
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'research-coverage-'));
  const service = createService({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'), aiOverride: h.ai });
  t.after(async () => {
    await service.close();
    const relative = path.relative(base, root);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(root, { recursive: true, force: true });
  });
  service.updateSettings({ ai: { sourceCallLimit: 8 } });
  const imported = service.importItems({ items: [{ title: 'Synthetic input', body: 'Synthetic input body.', privacy: 'cloud' }], process: true, research: true });
  const jobId = imported.jobs[0].id;
  const drain = async () => {
    for (let attempt = 0; attempt < 30 && service.store.records('jobs').some(job => job.state === 'queued'); attempt++) await service.runJobs();
    assert.equal(service.store.records('jobs').some(job => job.state === 'queued'), false);
  };
  let previousRequests = 0;
  for (let round = 0; round < 3; round++) {
    if (round) service.jobAction(jobId, { action: 'retry' });
    await drain();
    assert.ok(h.requests.length - previousRequests <= 8);
    previousRequests = h.requests.length;
    assert.equal(service.store.get('jobs', jobId).state, round < 2 ? 'waiting' : 'done');
  }
  assert.deepEqual(h.modelClaims.map(items => items.map(item => item.claim)), [claims.slice(0, 3), claims.slice(3, 6), claims.slice(6)]);
  const extractionCalls = h.requests.filter(request => request.body && new URL(request.url).pathname === '/v1/chat/completions' && JSON.parse(request.body).messages.at(-1).content.includes('拆解以下资料'));
  assert.equal(extractionCalls.length, 1);
  assert.ok(service.listNotes({ kind: 'knowledge' }).every(item => item.meta.researchLimitations.length === 0));
});
