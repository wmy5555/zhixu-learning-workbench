import test from 'node:test';
import assert from 'node:assert/strict';
import { createAI } from '../src/ai.mjs';

const PUBLIC_BASE = 'https://8.8.8.8/v1';

function settings() {
  return {
    ai: {
      enabled: true,
      baseUrl: PUBLIC_BASE,
      model: 'test-chat',
      dailyCallLimit: 100,
      monthlyBudget: 0,
      inputPrice: null,
      outputPrice: null,
    },
    embedding: { enabled: true, baseUrl: PUBLIC_BASE, model: 'test-embedding' },
    search: { enabled: true, baseUrl: 'https://8.8.8.8' },
    fetch: { enabled: true },
  };
}

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function harness(fetchImpl) {
  const calls = [];
  const requests = [];
  const ai = createAI({
    getSettings: async () => settings(),
    getSecret: async () => 'test-secret',
    getUsage: async () => ({ callsToday: 0, costMonth: 0 }),
    recordCall: async (call) => calls.push(call),
    fetchImpl: async (...args) => {
      requests.push(args);
      return fetchImpl(...args);
    },
  });
  return { ai, calls, requests };
}

test('researchBatch shares two searches, four pages, and one conservative model evaluation', async () => {
  let searchCount = 0;
  let pageCount = 0;
  let modelCount = 0;
  const h = harness(async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/search') {
      searchCount += 1;
      const query = JSON.parse(options.body).query;
      const opposing = query.includes('conditions limitations');
      return jsonResponse({ results: Array.from({ length: 4 }, (_, index) => ({
        title: `${opposing ? 'Oppose' : 'Support'} ${index}`,
        url: `https://8.8.8.8/${opposing ? 'oppose' : 'support'}-${index}`,
        content: 'A search snippet is not evidence.',
      })) });
    }
    if (parsed.pathname === '/v1/chat/completions') {
      modelCount += 1;
      const prompt = JSON.parse(options.body).messages.at(-1).content;
      assert.match(prompt, /Alpha claim/);
      assert.match(prompt, /Beta claim/);
      return jsonResponse({
        choices: [{ message: { content: JSON.stringify({
          results: [
            {
              claimIndex: 0,
              assessments: [
                { pageIndex: 0, role: 'support', rationale: 'Direct support.', excerpt: 'PAGE support-0 supports Alpha claim.' },
                { pageIndex: 1, role: 'oppose', rationale: 'Invented quote.', excerpt: 'FABRICATED EXCERPT' },
              ],
              conclusion: 'Alpha has limited support in the fetched material.',
              evidenceSufficient: true,
              unresolvedConflict: false,
              limitations: [],
            },
            {
              claimIndex: 1,
              assessments: [],
              conclusion: 'VERIFIED despite no assessment',
              evidenceSufficient: true,
              unresolvedConflict: false,
              limitations: [],
            },
          ],
        }) } }],
      });
    }
    pageCount += 1;
    const name = parsed.pathname.slice(1);
    return new Response(`<html><title>${name}</title><body>PAGE ${name} supports Alpha claim. It discusses Beta claim without deciding it.</body></html>`, {
      headers: { 'content-type': 'text/html' },
    });
  });

  const result = await h.ai.researchBatch({
    claims: ['Alpha claim', 'Beta claim'],
    topic: 'Shared topic',
    privacy: 'cloud',
  });

  assert.deepEqual({ searchCount, pageCount, modelCount }, { searchCount: 2, pageCount: 4, modelCount: 1 });
  assert.equal(h.requests.length, 7);
  assert.deepEqual(result.results.map((item) => item.claim), ['Alpha claim', 'Beta claim']);
  assert.equal(result.results[0].evidence.length, 1);
  assert.equal(result.results[0].evidence[0].excerpt, 'PAGE support-0 supports Alpha claim.');
  assert.match(result.results[0].notice, /丢弃 1 条/);
  assert.deepEqual(result.results[1].evidence, []);
  assert.match(result.results[1].limitations.join(' '), /不能将其视为已核实/);
  assert.doesNotMatch(result.results[1].conclusion, /VERIFIED/);
});

test('researchBatch bounds grouped queries and covers the tail in subsequent batches', async () => {
  const tailClaim = `TAIL_SENTINEL ${'very long tail fact '.repeat(20)}`;
  const claims = [
    ...Array.from({ length: 19 }, (_, index) => `Fact ${index} ${'descriptive detail '.repeat(12)}`),
    tailClaim,
  ];
  const queries = [];
  let modelPrompt;
  const h = harness(async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/search') {
      queries.push(JSON.parse(options.body).query);
      return jsonResponse({ results: [{ title: 'Shared page', url: 'https://8.8.8.8/shared' }] });
    }
    if (parsed.pathname === '/v1/chat/completions') {
      modelPrompt = JSON.parse(options.body).messages.at(-1).content;
      return jsonResponse({ choices: [{ message: { content: JSON.stringify({
        results: [{
          claimIndex: 0,
          assessments: [{ pageIndex: 0, role: 'support', rationale: 'Exact text.', excerpt: 'Shared short page text.' }],
          conclusion: '',
          evidenceSufficient: true,
          unresolvedConflict: false,
          limitations: [],
        }],
      }) } }] });
    }
    return new Response('<html><body>Shared short page text.</body></html>', {
      headers: { 'content-type': 'text/html' },
    });
  });

  const result = await h.ai.researchBatch({
    claims,
    topic: `A focused topic ${'topic detail '.repeat(30)}`,
    privacy: 'cloud',
  });

  assert.equal(queries.length, 14);
  assert.ok(queries.every((query) => query.length <= 350));
  assert.ok(queries.some((query) => query.includes('TAIL_SENTINEL')));
  assert.match(modelPrompt, /TAIL_SENTINEL/);
  assert.equal(result.results.at(-1).coverage, 'searched');
  assert.deepEqual(result.results.at(-1).evidence, []);
  const candidatePages = JSON.parse(modelPrompt.match(/候选正文：(.*?)\n\n输出 JSON：/s)[1]);
  assert.equal(candidatePages.length, 1);
  assert.equal(candidatePages[0].windows.length, 1);
  assert.deepEqual(candidatePages[0].windows[0].claimIndexes, Array.from({ length: 2 }, (_, index) => index));
  assert.match(result.results[0].limitations.join(' '), /未提供该主张的综合结论/);
  assert.equal(result.results[0].conclusion, '当前没有可逐字定位的正文证据支持自动结论。');
});

test('withBudget counts retry attempts and stops before the next transport', async () => {
  const h = harness(async () => jsonResponse({ error: { message: 'retry me' } }, 503));

  await assert.rejects(
    () => h.ai.withBudget({ limit: 1, sourceId: 'source-retry' }, () => h.ai.readPage({
      url: 'https://8.8.8.8/retry',
      privacy: 'cloud',
    })),
    { code: 'SOURCE_BUDGET' },
  );

  assert.equal(h.requests.length, 1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].sourceId, 'source-retry');
});

test('withBudget counts redirects and keeps source ids scoped to their task', async () => {
  const h = harness(async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/start') {
      return new Response('', { status: 302, headers: { location: 'https://8.8.8.8/final' } });
    }
    return new Response('<html><body>final page</body></html>', { headers: { 'content-type': 'text/html' } });
  });

  await assert.rejects(
    () => h.ai.withBudget({ limit: 1, sourceId: 'source-redirect' }, () => h.ai.readPage({
      url: 'https://8.8.8.8/start',
      privacy: 'cloud',
    })),
    { code: 'SOURCE_BUDGET' },
  );
  assert.equal(h.requests.length, 1);
  assert.equal(h.calls[0].sourceId, 'source-redirect');

  await h.ai.readPage({ url: 'https://8.8.8.8/outside', privacy: 'cloud' });
  assert.equal(h.requests.length, 2);
  assert.equal(Object.hasOwn(h.calls[1], 'sourceId'), false);
});
