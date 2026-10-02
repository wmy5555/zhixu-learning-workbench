import test from 'node:test';
import assert from 'node:assert/strict';
import { createAI } from '../src/ai.mjs';

const PUBLIC_BASE = 'https://8.8.8.8/v1';

test('model requests use a long configurable deadline and never auto-repeat paid failures', async (t) => {
  const deadlines=[];
  const original=AbortSignal.timeout;
  t.mock.method(AbortSignal,'timeout',ms=>{deadlines.push(ms);return original(ms);});
  const h=harness({fetchImpl:async()=>jsonResponse({error:{message:'temporary failure'}},503)});
  await assert.rejects(h.ai.generate({prompt:'long structured task',privacy:'cloud',json:true}));
  assert.equal(h.fetchCount,1);
  assert.equal(deadlines[0],180000);
  const custom=harness({settings:baseSettings({ai:{timeoutMs:240000}}),fetchImpl:async()=>jsonResponse({choices:[{message:{content:'{}'}}]})});
  await custom.ai.generate({prompt:'JSON',privacy:'cloud',json:true});
  assert.equal(deadlines.at(-1),240000);
});

test('empty and truncated paid model outputs are rejected without another request', async()=>{
  for(const [content,finish_reason,code] of [['','stop','INVALID_RESPONSE'],['{"candidates":','length','MODEL_TRUNCATED']]){
    const h=harness({fetchImpl:async()=>jsonResponse({choices:[{message:{content},finish_reason}]})});
    await assert.rejects(h.ai.generate({prompt:'JSON',privacy:'cloud',json:true}),{code});
    assert.equal(h.fetchCount,1);
  }
});

function baseSettings(overrides = {}) {
  return {
    ai: {
      enabled: true,
      baseUrl: PUBLIC_BASE,
      model: 'test-chat',
      dailyCallLimit: 30,
      monthlyBudget: 0,
      inputPrice: null,
      outputPrice: null,
      ...(overrides.ai ?? {}),
    },
    embedding: {
      enabled: true,
      baseUrl: PUBLIC_BASE,
      model: 'test-embedding',
      ...(overrides.embedding ?? {}),
    },
    search: {
      enabled: true,
      baseUrl: 'https://8.8.8.8',
      ...(overrides.search ?? {}),
    },
    fetch: { enabled: true, ...(overrides.fetch ?? {}) },
  };
}

function harness({ settings = baseSettings(), secrets = {}, usage = { callsToday: 0, costMonth: 0 }, fetchImpl } = {}) {
  const calls = [];
  let fetchCount = 0;
  const ai = createAI({
    getSettings: async () => settings,
    getSecret: async (capability) => secrets[capability] ?? 'test-secret',
    getUsage: async () => usage,
    recordCall: async (call) => calls.push(call),
    fetchImpl: async (...args) => {
      fetchCount += 1;
      if (!fetchImpl) throw new Error('unexpected network call');
      return fetchImpl(...args);
    },
  });
  return { ai, calls, get fetchCount() { return fetchCount; } };
}

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

test('model accounting persists cached tokens once and matches returned estimated cost', async () => {
  const h = harness({ settings: baseSettings({ ai: { inputPrice: 2, outputPrice: 5, cachedInputPrice: .5 } }), fetchImpl: async () => jsonResponse({ choices: [{ message: { content: 'synthetic' } }], usage: { prompt_tokens: 100, completion_tokens: 30, prompt_cache_hit_tokens: 40, completion_tokens_details: { reasoning_tokens: 10 } } }) });
  const result = await h.ai.generate({ prompt: 'synthetic', privacy: 'cloud' });
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].cachedInputTokens, 40); assert.equal(h.calls[0].totalTokens, 130);
  assert.equal(h.calls[0].reasoningTokens, 10); assert.equal(h.calls[0].cost, .00029); assert.equal(result.usage.cost, h.calls[0].cost);
});

test('embedding total-only usage and successful search prices are recorded; local cache adds no calls', async () => {
  const h = harness({ settings: baseSettings({ embedding: { inputPrice: 2 }, search: { requestPrice: .01 } }), fetchImpl: async url => String(url).includes('embeddings') ? jsonResponse({ data: [{ index: 0, embedding: [.1, .2] }], usage: { total_tokens: 100 } }) : jsonResponse({ results: [] }) });
  await h.ai.embed({ texts: ['synthetic'], privacy: 'cloud' });
  await h.ai.embed({ texts: ['synthetic'], privacy: 'cloud' });
  await h.ai.search({ query: 'synthetic', privacy: 'cloud' });
  await h.ai.search({ query: 'synthetic', privacy: 'cloud' });
  assert.equal(h.calls.length, 2); assert.equal(h.calls[0].cost, .0002); assert.equal(h.calls[1].cost, .01);
});

test('privacy=local blocks every outward capability before a network call', async () => {
  const h = harness({ fetchImpl: async () => jsonResponse({}) });
  const cases = [
    () => h.ai.generate({ prompt: 'private', privacy: 'local' }),
    () => h.ai.embed({ texts: ['private'], privacy: 'local' }),
    () => h.ai.search({ query: 'private', privacy: 'local' }),
    () => h.ai.readPage({ url: 'https://8.8.8.8/private', privacy: 'local' }),
    () => h.ai.research({ claim: 'private', privacy: 'local' }),
  ];
  for (const invoke of cases) await assert.rejects(invoke, { code: 'PRIVACY_LOCAL' });
  assert.equal(h.fetchCount, 0);
  assert.equal(h.calls.length, 0);
});

test('daily call budget blocks the request without contacting or recording a provider', async () => {
  const h = harness({
    settings: baseSettings({ ai: { dailyCallLimit: 1 } }),
    usage: { callsToday: 1, costMonth: 0 },
    fetchImpl: async () => jsonResponse({}),
  });
  await assert.rejects(() => h.ai.generate({ prompt: 'hello', privacy: 'cloud' }), { code: 'BUDGET_EXCEEDED' });
  assert.equal(h.fetchCount, 0);
  assert.equal(h.calls.length, 0);
});

test('unknown monthly cost fails closed when a positive monthly budget is enabled', async () => {
  const h = harness({
    settings: baseSettings({ ai: { monthlyBudget: 10 } }),
    usage: { callsToday: 0, costMonth: null },
    fetchImpl: async () => jsonResponse({}),
  });
  await assert.rejects(() => h.ai.search({ query: 'test', privacy: 'cloud' }), { code: 'BUDGET_UNKNOWN' });
  assert.equal(h.fetchCount, 0);
});

test('an already-aborted signal cancels before transport', async () => {
  const h = harness({ fetchImpl: async () => jsonResponse({}) });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => h.ai.generate({ prompt: 'hello', privacy: 'cloud', signal: controller.signal }),
    { code: 'CANCELLED' },
  );
  assert.equal(h.fetchCount, 0);
  assert.equal(h.calls.length, 0);
});

test('provider base URLs cannot target localhost or private addresses, even with injected fetch', async () => {
  for (const baseUrl of ['http://127.0.0.1:9999/v1', 'http://[::1]/v1', 'http://10.2.3.4/v1']) {
    const h = harness({
      settings: baseSettings({ ai: { baseUrl } }),
      fetchImpl: async () => jsonResponse({}),
    });
    await assert.rejects(() => h.ai.generate({ prompt: 'hello', privacy: 'cloud' }), { code: 'SSRF_BLOCKED' });
    assert.equal(h.fetchCount, 0);
    assert.equal(h.calls.length, 0);
  }
});

test('readPage rechecks redirect targets and blocks a redirect into a private network', async () => {
  const h = harness({
    fetchImpl: async () => new Response('', {
      status: 302,
      headers: { location: 'https://169.254.169.254/latest/meta-data/' },
    }),
  });
  await assert.rejects(
    () => h.ai.readPage({ url: 'https://8.8.8.8/start', privacy: 'cloud' }),
    { code: 'SSRF_BLOCKED' },
  );
  assert.equal(h.fetchCount, 1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].cost, 0);
});

test('missing credentials fail before a network call', async () => {
  const h = harness({ secrets: { model: '' }, fetchImpl: async () => jsonResponse({}) });
  await assert.rejects(() => h.ai.generate({ prompt: 'hello', privacy: 'cloud' }), { code: 'MISSING_CREDENTIALS' });
  assert.equal(h.fetchCount, 0);
  assert.equal(h.calls.length, 0);
});

test('generate uses chat completions and records measured token cost', async () => {
  const settings = baseSettings({ ai: { inputPrice: 2, outputPrice: 8 } });
  const h = harness({
    settings,
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://8.8.8.8/v1/chat/completions');
      assert.equal(options.redirect, 'manual');
      assert.match(options.headers.authorization, /^Bearer /);
      const request = JSON.parse(options.body);
      assert.equal(request.model, 'test-chat');
      return jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'answer' } }],
        usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
      });
    },
  });
  const result = await h.ai.generate({ prompt: 'hello', privacy: 'cloud' });
  assert.equal(result.text, 'answer');
  assert.equal(result.usage.cost, 0.0004);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(
    { inputTokens: h.calls[0].inputTokens, outputTokens: h.calls[0].outputTokens, cost: h.calls[0].cost, ok: h.calls[0].ok },
    { inputTokens: 100, outputTokens: 25, cost: 0.0004, ok: true },
  );
});

test('provider errors are truncated and scrubbed before recordCall', async () => {
  const secret = 'sk-super-secret-value';
  const h = harness({
    secrets: { model: secret },
    fetchImpl: async () => jsonResponse({ error: { message: `bad key ${secret}; Authorization: Bearer also-secret` } }, 401),
  });
  await assert.rejects(() => h.ai.generate({ prompt: 'hello', privacy: 'cloud' }), { code: 'PROVIDER_ERROR' });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].ok, false);
  assert.doesNotMatch(h.calls[0].error, /sk-super-secret-value|also-secret/);
  assert.ok(h.calls[0].error.length <= 500);
});

test('research reads both search directions and uses model semantics rather than query direction', async () => {
  const seenQueries = [];
  const h = harness({
    fetchImpl: async (url, options) => {
      const parsed = new URL(url);
      if (parsed.pathname === '/search') {
        const request = JSON.parse(options.body);
        seenQueries.push(request.query);
        assert.equal('api_key' in request, false);
        assert.match(options.headers.authorization, /^Bearer /);
        const opposing = request.query.includes('contradictory evidence');
        return jsonResponse({ results: [{
          title: opposing ? 'Opposing page' : 'Supporting page',
          url: `https://8.8.8.8/${opposing ? 'oppose' : 'support'}`,
          content: 'SEARCH_SNIPPET_MUST_NOT_BECOME_EVIDENCE',
        }] });
      }
      if (parsed.pathname === '/v1/chat/completions') {
        return jsonResponse({
          choices: [{ message: { role: 'assistant', content: JSON.stringify({
            assessments: [
              { index: 0, role: 'oppose', rationale: 'The first page contradicts the claim.', excerpt: 'FULL_PAGE_SUPPORT claim context' },
              { index: 1, role: 'support', rationale: 'The second page supports a limited version.', excerpt: 'FULL_PAGE_OPPOSE claim context' },
            ],
            conclusion: 'The read pages conflict, but the stated conditions resolve the difference.',
            evidenceSufficient: true,
            unresolvedConflict: false,
            limitations: [],
          }) } }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        });
      }
      const opposing = parsed.pathname === '/oppose';
      return new Response(
        `<html><title>${opposing ? 'Opposing' : 'Supporting'}</title><body>FULL_PAGE_${opposing ? 'OPPOSE' : 'SUPPORT'} claim context and details.</body></html>`,
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    },
  });
  const result = await h.ai.research({ claim: 'claim context', privacy: 'cloud' });
  assert.equal(seenQueries.length, 2);
  assert.ok(seenQueries.some((query) => query.includes('primary source evidence')));
  assert.ok(seenQueries.some((query) => query.includes('contradictory evidence')));
  assert.deepEqual(new Set(result.evidence.map((item) => item.role)), new Set(['support', 'oppose']));
  assert.ok(result.evidence.every((item) => item.excerpt.includes('FULL_PAGE_')));
  assert.ok(result.evidence.every((item) => !item.excerpt.includes('SEARCH_SNIPPET')));
  assert.equal(result.limitations.length, 0);
  assert.match(result.conclusion, /conflict/);
  assert.match(result.notice, /模型/);
  assert.equal(h.fetchCount, 5);
});

test('research rejects model excerpts that are not exact substrings of fetched pages', async () => {
  const h = harness({
    fetchImpl: async (url, options) => {
      const parsed = new URL(url);
      if (parsed.pathname === '/search') {
        const opposing = JSON.parse(options.body).query.includes('contradictory evidence');
        return jsonResponse({ results: [{
          title: opposing ? 'Second' : 'First',
          url: `https://8.8.8.8/${opposing ? 'two' : 'one'}`,
          content: 'snippet only',
        }] });
      }
      if (parsed.pathname === '/v1/chat/completions') {
        return jsonResponse({
          choices: [{ message: { role: 'assistant', content: JSON.stringify({
            assessments: [
              { index: 0, role: 'support', rationale: 'claimed support', excerpt: 'THIS QUOTE WAS INVENTED' },
              { index: 1, role: 'oppose', rationale: 'claimed opposition', excerpt: 'ANOTHER INVENTED QUOTE' },
            ],
            conclusion: 'Unsupported model conclusion.',
            evidenceSufficient: false,
            unresolvedConflict: false,
            limitations: ['No exact evidence remains.'],
          }) } }],
          usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 },
        });
      }
      return new Response(`<html><body>Actual fetched body for ${parsed.pathname}.</body></html>`, {
        headers: { 'content-type': 'text/html' },
      });
    },
  });
  const result = await h.ai.research({ claim: 'a disputed claim', privacy: 'cloud' });
  assert.deepEqual(result.evidence, []);
  assert.ok(result.limitations.length > 0);
  assert.doesNotMatch(result.conclusion, /Unsupported model conclusion/);
  assert.match(result.notice, /丢弃 2 条/);
});

test('external request concurrency is limited to three', async () => {
  let active = 0;
  let peak = 0;
  const h = harness({
    fetchImpl: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return new Response('<html><body>page text</body></html>', { headers: { 'content-type': 'text/html' } });
    },
  });
  await Promise.all(Array.from({ length: 8 }, (_, index) => h.ai.readPage({
    url: `https://8.8.8.8/page-${index}`,
    privacy: 'cloud',
  })));
  assert.equal(peak, 3);
});
