import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createAI } from '../src/ai.mjs';
import { createService } from '../src/service.mjs';

const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
function transport(limit = 120, redirects = false, transientFailure = false) {
  const requests = [], queries = [], evaluated = [], pages = new Map();
  let pageId = 0;
  const ai = createAI({
    getSettings: async () => ({ ai: { enabled: true, baseUrl: 'https://8.8.8.8/v1', model: 'synthetic', sourceCallLimit: limit, dailyCallLimit: 500 }, search: { enabled: true, baseUrl: 'https://8.8.8.8' }, fetch: { enabled: true } }),
    getSecret: async () => 'synthetic-key', getUsage: async () => ({ callsToday: 0, costMonth: 0 }), recordCall: async () => {},
    fetchImpl: async (url, options) => {
      const p = new URL(url); requests.push(p.pathname);
      if (transientFailure && p.pathname.startsWith('/page-')) { transientFailure = false; return new Response('Synthetic temporary failure', { status: 503 }); }
      if (p.pathname === '/search') {
        queries.push(JSON.parse(options.body).query);
        return json({ results: Array.from({ length: 3 }, () => ({ url: `https://8.8.8.8/${redirects ? 'redirect' : 'page'}-${++pageId}`, title: `Synthetic ${pageId}` })) });
      }
      if (p.pathname.includes('redirect')) return new Response('', { status: 302, headers: { location: p.href.replace('redirect', 'page') } });
      if (p.pathname === '/v1/chat/completions') {
        const prompt = JSON.parse(options.body).messages.at(-1).content;
        const claims = JSON.parse(prompt.match(/主张：(.*?)\n\n候选正文：/s)[1]);
        const supplied = JSON.parse(prompt.match(/候选正文：(.*?)\n\n输出 JSON：/s)[1]);
        evaluated.push(...claims.map(c => c.claim));
        return json({ choices: [{ message: { content: JSON.stringify({ results: claims.map(c => ({ claimIndex: c.claimIndex,
          assessments: [{ pageIndex: 0, role: 'support', excerpt: pages.get(new URL(supplied[0].url).pathname), rationale: 'Synthetic direct evidence.' }],
          conclusion: 'Synthetic support within stated conditions; no counterexample found.', evidenceSufficient: true, unresolvedConflict: false, limitations: [] })) }) } }] });
      }
      const text = `Unique synthetic evidence ${p.pathname}. ${'Distinct context ' + p.pathname}`;
      pages.set(p.pathname, text);
      return new Response(text, { headers: { 'content-type': 'text/plain' } });
    },
  });
  return { ai, requests, queries, evaluated };
}

for (const size of [15, 24]) test(`${size} claims reach the tail in one budget, without requiring opposition`, async () => {
  const h = transport(), claims = Array.from({ length: size }, (_, i) => `Claim ${i}: division requires a nonzero divisor`), checkpoints = [];
  const result = await h.ai.withBudget({ limit: 120, sourceId: 'synthetic-source' }, () => h.ai.researchBatch({ claims, privacy: 'cloud',
    hints: claims.map(claim => ({ claim, kind: 'formal', subject: claim })), onBatch: results => checkpoints.push(results.map(r => r.claim)) }));
  assert.deepEqual(h.evaluated, claims);
  assert.equal(checkpoints.length, size / 3);
  assert.equal(result.results.length, size);
  assert.ok(result.results.every(r => r.coverage === 'searched' && r.evidence.length && !r.limitations.length));
  assert.ok(h.requests.length <= 1 + 7 * (size / 3));
  assert.ok(h.queries.every(q => q.length <= 350 && !q.includes('criticism')));
  assert.ok(h.queries.some(q => q.includes('定义 证明 前提 适用条件')));
});

test('redirects share the outer budget and leave capacity to evaluate saved pages', async () => {
  const h = transport(12, true), claims = Array.from({ length: 15 }, (_, i) => `Synthetic fact ${i}`);
  const result = await h.ai.withBudget({ limit: 12, sourceId: 'bounded-source' }, () => h.ai.researchBatch({ claims, privacy: 'cloud' }));
  assert.ok(h.requests.length <= 12);
  assert.ok(h.evaluated.length >= 3, 'at least the first fetched group is evaluated');
  assert.equal(result.issues[0].code, 'SOURCE_BUDGET');
  assert.ok(result.results.some(r => r.coverage === 'unsearched'));
  assert.ok(result.results.some(r => r.evidence.length));
});

test('temporary page retries and redirects consume the same allowance while evaluation remains possible', async () => {
  const h = transport(12, true, true), claims = Array.from({ length: 6 }, (_, i) => `Synthetic retry fact ${i}`);
  const result = await h.ai.researchBatch({ claims, privacy: 'cloud' });
  assert.ok(h.requests.length <= 12);
  assert.ok(h.requests.filter(p => p.startsWith('/page-')).length > new Set(h.requests.filter(p => p.startsWith('/page-'))).size, 'the temporary failure was retried');
  assert.equal(h.evaluated.length, 3);
  assert.ok(result.results.slice(0, 3).every(r => r.evidence.length));
  assert.ok(result.results.slice(3).every(r => r.coverage === 'unsearched'));
});

for (const scenario of [
  { name: 'correct formal proposition needs no counterexample', claim: 'a=b and c≠0 imply a/c=b/c', role: 'support', sufficient: true, conflict: false, limitations: [] },
  { name: 'missing nonzero premise remains limited', claim: 'a=b imply a/c=b/c for any c', role: 'limit', sufficient: false, conflict: false, limitations: ['缺少除数非零的前提。'] },
  { name: 'outside-premise example is a boundary rather than a contradiction', claim: 'a=b and c≠0 imply a/c=b/c', role: 'limit', sufficient: true, conflict: false, limitations: [] },
  { name: 'empirical counterevidence retains unresolved conflict', claim: 'All observed swans are white', role: 'oppose', sufficient: true, conflict: true, limitations: ['合成观察与原结论冲突。'] },
]) test(`bounded synthetic evaluation: ${scenario.name}`, async () => {
  const excerpt = 'Synthetic quoted evidence for a bounded scenario.';
  const ai = createAI({
    getSettings: () => ({ ai: { enabled: true, baseUrl: 'https://8.8.8.8/v1', model: 'synthetic', sourceCallLimit: 120 }, search: { enabled: true, baseUrl: 'https://8.8.8.8' }, fetch: { enabled: true } }),
    getSecret: () => 'synthetic-key', getUsage: () => ({ callsToday: 0, costMonth: 0 }), recordCall: () => {},
    fetchImpl: async (url, options) => {
      const target = new URL(url);
      if (target.pathname === '/search') return json({ results: [{ url: 'https://8.8.8.8/page', title: 'Synthetic scenario' }] });
      if (target.pathname === '/page') return new Response(excerpt, { headers: { 'content-type': 'text/plain' } });
      const prompt = JSON.parse(options.body).messages.at(-1).content;
      assert.match(prompt, /同一前提下/); assert.match(prompt, /不因此填写 limitations/);
      return json({ choices: [{ message: { content: JSON.stringify({ results: [{ claimIndex: 0, assessments: [{ pageIndex: 0, role: scenario.role, excerpt, rationale: scenario.name }], conclusion: scenario.name, evidenceSufficient: scenario.sufficient, unresolvedConflict: scenario.conflict, limitations: scenario.limitations }] }) } }] });
    },
  });
  const { results: [result] } = await ai.researchBatch({ claims: [scenario.claim], privacy: 'cloud' });
  assert.equal(result.evidence[0].role, scenario.role);
  assert.equal(result.limitations.length > 0, !scenario.sufficient || scenario.conflict);
});

test('extraction is saved before research; restart resumes untouched claims and preserves IDs and edits', async t => {
  fs.mkdirSync('.tmp', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('.tmp/research-resume-'));
  let service, extractionCalls = 0, attempts = 0, entered, release;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const observed = [], claims = Array.from({ length: 15 }, (_, i) => `合成主张 ${i}`);
  const candidates = Array.from({ length: 5 }, (_, i) => ({ title: `合成条目 ${i}`, body: `合成正文 ${i}`, claims: claims.slice(i*3, i*3+3) }));
  const result = claim => ({ claim, evidence: [], limitations: ['合成证据不足'], coverage: 'searched' });
  const ai = {
    generate: async () => { extractionCalls++; return { text: JSON.stringify({ candidates }) }; },
    withBudget: async ({ limit }, fn) => { assert.equal(limit, 120); return fn(); },
    researchBatch: async ({ claims: pending, onBatch }) => {
      observed.push([...pending]); attempts++;
      if (attempts === 1) {
        entered(); await gate;
        await onBatch(pending.slice(0,3).map(result));
        throw Object.assign(new Error('synthetic budget stop'), { code: 'SOURCE_BUDGET' });
      }
      const results = pending.map(result); await onBatch(results); return { results };
    },
  };
  const open = () => createService({ dataDir: path.join(root,'data'), vaultDir: path.join(root,'vault'), aiOverride: ai });
  service = open();
  t.after(async () => { release(); await service.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const source = service.importItems({ items: [{ title: '合成预算续跑', body: '合成资料，不访问真实供应商。', privacy: 'cloud' }] }).notes[0];
  const job = service.processNote(source.id, { research: true }), running = service.runJobs(); await ready;
  const status = service.jobStatuses().jobs.find(j => j.id === job.id);
  assert.equal(status.state, 'running'); assert.equal(status.extractionSaved, true); assert.equal(status.savedCount, 5);
  assert.equal(status.phase, 'research'); assert.equal(JSON.stringify(status).includes('合成正文'), false);
  const ids = service.readPublicNote(source.id).children.map(n => n.id);
  release(); await running;
  assert.equal(service.store.get('jobs', job.id).code, 'RESEARCH_INCOMPLETE');
  assert.equal(service.store.get('jobs', job.id).stopCode, 'SOURCE_BUDGET');
  await service.close(); service = open();
  const edited = service.getNote(ids[0]); service.editNote(edited.id, { expectedHash: edited.hash, body: '用户自己的理解，必须保留。' });
  service.jobAction(job.id, { action: 'retry' }); await service.runJobs();
  assert.deepEqual(observed[1].slice(0,12), claims.slice(3));
  assert.equal(extractionCalls, 1);
  assert.deepEqual(service.readPublicNote(source.id).children.map(n => n.id), ids);
  assert.equal(service.getNote(ids[0]).body, '用户自己的理解，必须保留。');
  assert.equal(service.store.get('jobs', job.id).stopCode, null);
  assert.equal(service.jobStatuses().jobs.find(j => j.id === job.id).researchProgress.covered, 15);
  const hashes = ids.map(id => service.getNote(id).hash), proposals = service.store.records('proposals').length;
  const relationCount = service.store.records('jobs').filter(j => j.type === 'relate').length;
  service.jobAction(job.id, { action: 'retry' }); await service.runJobs();
  assert.deepEqual(ids.map(id => service.getNote(id).hash), hashes, 'unchanged results do not rewrite notes');
  assert.equal(service.store.records('proposals').length, proposals, 'same proposal is not duplicated');
  assert.equal(service.store.records('jobs').filter(j => j.type === 'relate').length, relationCount, 'unchanged facts do not create redundant relation tasks');
  service.editNote(source.id, { expectedHash: source.hash, body: '改动后的合成原文。' });
  assert.equal(service.publicJob(service.store.get('jobs', job.id)).extractionSaved, false);
});
