import test from 'node:test';
import assert from 'node:assert/strict';
import { createAI } from '../src/ai.mjs';
import { promptDefaults, renderPrompt, validatePromptOverrides, extractionResearchContract } from '../src/prompts.mjs';

const PUBLIC_BASE = 'https://8.8.8.8/v1';

test('legacy defaults become neutral queries, while custom prompts retain their content and receive factual boundaries', () => {
  const legacy = { researchSearchOppose: '{{context}} criticism counterexample contradictory evidence' };
  assert.equal(renderPrompt('researchSearchOppose', { context: 'division' }, legacy), 'division conditions limitations exceptions counterexamples');
  assert.equal(renderPrompt('researchSearchOppose', { context: 'division' }, { researchSearchOppose: 'CUSTOM {{context}} boundary' }), 'CUSTOM division boundary');
  const prompt = renderPrompt('researchEvaluation', { claim: 'a=b implies a/c=b/c for c≠0', pages: '[]' }, { researchEvaluation: 'CUSTOM {{claim}} {{pages}}' });
  assert.match(prompt, /^CUSTOM a=b/);
  for (const rule of [/必要前提/, /改变或违反前提.*limit/, /不因此填写 limitations 或 unresolvedConflict/, /没有反例不等于已证明正确/, /经验事实检查支持、反对证据/, /原始出处/]) assert.match(prompt, rule);
  assert.match(extractionResearchContract, /claimChecks/);
  assert.match(extractionResearchContract, /formal/);
});

test('prompt metadata exposes complete defaults and renders values literally', () => {
  for (const key of [
    'serviceSystem', 'sourceExtract', 'grade', 'relate', 'discover', 'topics', 'ask',
    'researchSystem', 'researchSearchSupport', 'researchSearchOppose',
    'researchEvaluation', 'researchBatchEvaluation',
  ]) {
    assert.equal(Object.hasOwn(promptDefaults, key), true);
    assert.equal(typeof promptDefaults[key].title, 'string');
    assert.equal(typeof promptDefaults[key].description, 'string');
    assert.equal(typeof promptDefaults[key].template, 'string');
    assert.ok(Array.isArray(promptDefaults[key].variables));
  }

  const rendered = renderPrompt('researchEvaluation', {
    claim: 'literal {{pages}} and $&',
    pages: '[{"text":"page"}]',
  });
  assert.match(rendered, /literal \{\{pages\}\} and \$&/);
  assert.match(rendered, /\[{"text":"page"}\]/);
});

test('prompt overrides reject unknown keys, variables, omissions, and oversized text', () => {
  for (const overrides of [
    { constructor: 'unsafe' },
    JSON.parse('{"__proto__":"unsafe"}'),
    { researchSearchSupport: '{{context}} {{unknown}}' },
    { researchSearchSupport: 'no required placeholder' },
    { researchSystem: 'x'.repeat(30_001) },
  ]) {
    assert.throws(() => validatePromptOverrides(overrides), { code: 'INVALID_PROMPT' });
  }
  assert.throws(
    () => renderPrompt('researchEvaluation', { claim: 'missing pages' }),
    { code: 'INVALID_PROMPT' },
  );

  const overrides = validatePromptOverrides({
    researchSearchSupport: 'CUSTOM {{context}}',
  });
  assert.deepEqual(overrides, { researchSearchSupport: 'CUSTOM {{context}}' });
});

test('researchBatch uses saved search, system, and evaluation prompt overrides', async () => {
  const prompts = {
    researchSearchSupport: 'CUSTOM SUPPORT {{context}}',
    researchSearchOppose: 'CUSTOM OPPOSE {{context}}',
    researchSystem: 'CUSTOM RESEARCH SYSTEM',
    researchBatchEvaluation: 'CUSTOM BATCH topic={{topic}} claims={{claims}} pages={{pages}}',
  };
  const searches = [];
  let modelRequest;
  const ai = createAI({
    getSettings: async () => ({
      ai: { enabled: true, baseUrl: PUBLIC_BASE, model: 'test-chat', dailyCallLimit: 30, monthlyBudget: 0 },
      search: { enabled: true, baseUrl: 'https://8.8.8.8' },
      fetch: { enabled: true },
      embedding: { enabled: false },
      prompts,
    }),
    getSecret: async () => 'test-secret',
    getUsage: async () => ({ callsToday: 0, costMonth: 0 }),
    recordCall: async () => {},
    fetchImpl: async (url, options) => {
      const parsed = new URL(url);
      if (parsed.pathname === '/search') {
        searches.push(JSON.parse(options.body).query);
        return jsonResponse({ results: [{ title: 'Page', url: 'https://8.8.8.8/page' }] });
      }
      if (parsed.pathname === '/v1/chat/completions') {
        modelRequest = JSON.parse(options.body);
        return jsonResponse({ choices: [{ message: { content: JSON.stringify({
          results: [{
            claimIndex: 0,
            assessments: [{ pageIndex: 0, role: 'support', rationale: 'Exact.', excerpt: 'Exact evidence.' }],
            conclusion: 'Supported within this page.',
            evidenceSufficient: true,
            unresolvedConflict: false,
            limitations: [],
          }],
        }) } }] });
      }
      return new Response('<html><body>Exact evidence.</body></html>', {
        headers: { 'content-type': 'text/html' },
      });
    },
  });

  const result = await ai.researchBatch({ claims: ['A claim'], topic: 'A topic', privacy: 'cloud' });

  assert.equal(searches.length, 2);
  assert.match(searches[0], /^CUSTOM SUPPORT /);
  assert.match(searches[1], /^CUSTOM OPPOSE /);
  assert.ok(searches.every((query) => query.length <= 350));
  assert.match(modelRequest.messages[0].content, /^CUSTOM RESEARCH SYSTEM/);
  assert.match(modelRequest.messages[0].content, /不强行寻找反例/);
  assert.match(modelRequest.messages[1].content, /^CUSTOM BATCH topic=A topic /);
  assert.match(modelRequest.messages[1].content, /"A claim"/);
  assert.equal(result.results[0].evidence[0].excerpt, 'Exact evidence.');
});

test('single research uses its saved evaluation prompt override', async () => {
  let modelRequest;
  const ai = createAI({
    getSettings: async () => ({
      ai: { enabled: true, baseUrl: PUBLIC_BASE, model: 'test-chat', dailyCallLimit: 30, monthlyBudget: 0 },
      search: { enabled: true, baseUrl: 'https://8.8.8.8' },
      fetch: { enabled: true },
      embedding: { enabled: false },
      prompts: {
        researchEvaluation: 'CUSTOM SINGLE claim={{claim}} pages={{pages}}',
      },
    }),
    getSecret: async () => 'test-secret',
    getUsage: async () => ({ callsToday: 0, costMonth: 0 }),
    recordCall: async () => {},
    fetchImpl: async (url, options) => {
      const parsed = new URL(url);
      if (parsed.pathname === '/search') {
        return jsonResponse({ results: [{ title: 'Page', url: 'https://8.8.8.8/page' }] });
      }
      if (parsed.pathname === '/v1/chat/completions') {
        modelRequest = JSON.parse(options.body);
        return jsonResponse({ choices: [{ message: { content: JSON.stringify({
          assessments: [{ index: 0, role: 'support', rationale: 'Exact.', excerpt: 'Exact evidence.' }],
          conclusion: 'Supported.',
          evidenceSufficient: true,
          unresolvedConflict: false,
          limitations: [],
        }) } }] });
      }
      return new Response('<html><body>Exact evidence.</body></html>', {
        headers: { 'content-type': 'text/html' },
      });
    },
  });

  await ai.research({ claim: 'Single claim', privacy: 'cloud' });
  assert.match(modelRequest.messages[1].content, /^CUSTOM SINGLE claim=Single claim /);
  assert.match(modelRequest.messages[1].content, /Exact evidence/);
});

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
