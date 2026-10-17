import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import dns from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import { createAI } from '../src/ai.mjs';

const baseUrl = 'https://8.8.8.8/v1';
const fakeKey = 'synthetic-discovery-credential';
const config = { baseUrl, apiKey: fakeKey };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
function harness(fetchImpl = async () => json({ data: [] }), saved = { baseUrl, model: 'saved-model' }) {
  const requests = [], secrets = [], writes = [];
  const ai = createAI({
    getSettings: async () => ({ ai: saved, embedding: saved }),
    getSecret: async (...args) => { secrets.push(args); return fakeKey; },
    getUsage: async () => { throw new Error('Catalogue must not consume inference budget'); },
    recordCall: async entry => writes.push(entry),
    callLedger: new Proxy({}, { get(_target, property) { if (property === 'evidence') return undefined; throw new Error('Catalogue must not persist credentials or response'); } }),
    fetchImpl: async (...args) => { requests.push(args); return fetchImpl(...args); },
  });
  return { ai, requests, secrets, writes };
}

test('catalogue uses GET /models, returns full IDs without name-based capability filtering or persistence', async () => {
  const h = harness(async () => json({ data: [{ id: 'vendor/model:preview-v2', owner: fakeKey }, { id: 'embedding-name' }, { id: 'vendor/model:preview-v2' }] }));
  // No selected model or enabled setting is required for discovery.
  const result = await h.ai.discoverModels('model', config);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.models, ['vendor/model:preview-v2', 'embedding-name']);
  assert.equal(result.source, 'provider');
  assert.match(result.message, /不代表.*可调用/);
  const [url, options] = h.requests[0];
  assert.equal(url, `${baseUrl}/models`);
  assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'manual');
  assert.deepEqual(options.headers, { authorization: `Bearer ${fakeKey}`, accept: 'application/json' });
  assert.equal(options.body, undefined);
  assert.equal(h.secrets.length, 0); assert.equal(h.writes.length, 0);
  assert.ok(!JSON.stringify(result).includes(fakeKey));
});

test('saved credentials stay bound to original endpoint and model', async () => {
  const h = harness();
  const result = await h.ai.discoverModels('embedding', { baseUrl: `${baseUrl}/` });
  assert.equal(result.status, 'empty');
  assert.deepEqual(h.secrets, [['embedding', { baseUrl, model: 'saved-model' }]]);
  for (const draft of [{ baseUrl: 'https://1.1.1.1/v1' }, { baseUrl, model: 'changed-model' }]) {
    const other = harness();
    assert.equal((await other.ai.discoverModels('model', draft)).status, 'missing_key');
    assert.equal(other.requests.length, 0); assert.equal(other.secrets.length, 0);
  }
});

test('non-model capabilities, unexpected headers and malformed drafts never dispatch', async () => {
  for (const [capability, draft, expected] of [
    ['search', config, 'unsupported'], ['fetch', config, 'unsupported'],
    ['model', { ...config, headers: { 'X-Test': 'no' } }, 'invalid_config'],
    ['model', { ...config, baseUrl: 'http://8.8.8.8/v1' }, 'invalid_config'],
    ['model', { ...config, baseUrl: 'https://user:secret@8.8.8.8/v1' }, 'invalid_config'],
    ['model', { ...config, baseUrl: `${baseUrl}?token=private` }, 'invalid_config'],
    ['model', { ...config, apiKey: 'synthetic\r\ninjected' }, 'invalid_config'],
    ['model', null, 'invalid_config'],
  ]) {
    const h = harness();
    assert.equal((await h.ai.discoverModels(capability, draft)).status, expected);
    assert.equal(h.requests.length, 0);
  }
});

test('existing SSRF public target policy blocks local targets before mock transport', async () => {
  for (const host of ['127.0.0.1', '[::1]', '10.0.0.1', '169.254.169.254', 'localhost', 'internal.local']) {
    const h = harness();
    const result = await h.ai.discoverModels('model', { ...config, baseUrl: `https://${host}/v1` });
    assert.equal(result.status, 'blocked', host); assert.equal(h.requests.length, 0);
  }
});

test('fallback categories stay distinct and provider errors never reflect secrets', async () => {
  for (const [status, expected] of [[404, 'unsupported'], [405, 'unsupported'], [401, 'unauthorized'], [403, 'unauthorized'], [429, 'rate_limited'], [500, 'provider_error'], [302, 'provider_error']]) {
    const h = harness(async () => json({ error: { message: fakeKey } }, status));
    const result = await h.ai.discoverModels('model', config);
    assert.equal(result.status, expected); assert.deepEqual(result.models, []);
    assert.ok(!JSON.stringify(result).includes(fakeKey)); assert.equal(h.requests.length, 1);
  }
  for (const body of [{ models: ['x'] }, { data: 'x' }, { data: [{ name: 'x' }] }]) {
    assert.equal((await harness(async () => json(body)).ai.discoverModels('model', config)).status, 'invalid_response');
  }
  assert.equal((await harness(async () => new Response('<html>bad</html>')).ai.discoverModels('model', config)).status, 'invalid_response');
  const network = await harness(async () => { throw new Error(`network ${fakeKey}`); }).ai.discoverModels('model', config);
  assert.equal(network.status, 'network_error'); assert.ok(!JSON.stringify(network).includes(fakeKey));
});

test('limits response bytes, ID size, list size and secret reflection without truncating IDs', async () => {
  const items = [{ id: fakeKey }, { id: `prefix-${fakeKey}` }, { id: 'line\nbreak' }, { id: 'x'.repeat(501) }, ...Array.from({ length: 510 }, (_, i) => ({ id: `provider/model-${i}` }))];
  const result = await harness(async () => json({ data: items })).ai.discoverModels('embedding', config);
  assert.equal(result.status, 'ready'); assert.equal(result.models.length, 500); assert.equal(result.truncated, true);
  assert.equal(result.models[499], 'provider/model-499'); assert.ok(!JSON.stringify(result).includes(fakeKey));
  const big = await harness(async () => new Response('x'.repeat(256 * 1024 + 1))).ai.discoverModels('model', config);
  assert.equal(big.status, 'too_large');
  const declared = await harness(async () => new Response('{}', { headers: { 'content-length': String(256 * 1024 + 1) } })).ai.discoverModels('model', config);
  assert.equal(declared.status, 'too_large');
});

test('backend enforces cooldown and concurrent-request guard independently of UI', async () => {
  let finish;
  const h = harness(() => new Promise(resolve => { finish = resolve; }));
  const pending = h.ai.discoverModels('model', config);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await h.ai.discoverModels('model', config)).status, 'rate_limited');
  finish(json({ data: [] })); await pending;
  assert.equal((await h.ai.discoverModels('model', config)).status, 'rate_limited');
  assert.equal(h.requests.length, 1);
});

test('timeout is bounded and cancellation never exposes transport errors', async t => {
  const controller = new AbortController();
  const requested = [];
  t.mock.method(AbortSignal, 'timeout', ms => { requested.push(ms); return controller.signal; });
  const h = harness(() => new Promise(() => {}));
  const pending = h.ai.discoverModels('model', config);
  await new Promise(resolve => setImmediate(resolve)); controller.abort();
  assert.equal((await pending).status, 'timeout'); assert.deepEqual(requested, [10000]);
  const user = new AbortController(); user.abort();
  assert.equal((await harness().ai.discoverModels('model', config, { signal: user.signal })).status, 'cancelled');
});

test('route fragment rejects practice access and does not save or issue test receipts', async () => {
  const source = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');
  const start = source.indexOf("      else if(resource==='settings'&&id==='models'");
  const end = source.indexOf("      else if(resource==='settings'&&id==='test'", start);
  assert.ok(start > 0 && end > start);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const route = new AsyncFunction('body', 'practiceId', 'mainService', 'fail', 'res', `let result;const resource='settings',id='models',action=undefined,method='POST';if(false){} ${source.slice(start, end)} return result;`);
  const calls = [];
  const service = { ai: { discoverModels: async (...args) => { calls.push(args); return { status: 'empty', models: [] }; } } };
  const fail = (message, code) => { throw Object.assign(new Error(message), { code }); };
  const res = new EventEmitter();
  await assert.rejects(route({ capability: 'model', config }, 'practice', service, fail, res), { code: 'PRACTICE_SETTINGS_LOCKED' });
  assert.equal(calls.length, 0);
  assert.deepEqual(await route({ capability: 'model', config }, null, service, fail, res), { status: 'empty', models: [] });
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].slice(0, 2), ['model', config]);
  assert.ok(calls[0][2].signal instanceof AbortSignal); assert.equal(res.listenerCount('close'), 0);
  const pending = route({ capability: 'model', config }, null, { ai: { discoverModels: async (_capability, _config, { signal }) => {
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    return { status: 'cancelled' };
  } } }, fail, res);
  res.emit('close'); assert.equal((await pending).status, 'cancelled'); assert.equal(res.listenerCount('close'), 0);
});


test('mixed public/private DNS answers fail closed; redirects are not followed', async t => {
  t.mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]);
  const mixed = harness();
  assert.equal((await mixed.ai.discoverModels('model', { ...config, baseUrl: 'https://synthetic.invalid/v1' })).status, 'blocked');
  assert.equal(mixed.requests.length, 0);
  const redirect = harness(async () => new Response('', { status: 307, headers: { location: 'https://127.0.0.1/private' } }));
  assert.equal((await redirect.ai.discoverModels('model', config)).status, 'provider_error');
  assert.equal(redirect.requests.length, 1);
});

test('key absence and lock stay local; explicit new key allows new endpoint without consulting saved key', async () => {
  const outcomes = [async () => '', async () => { throw Object.assign(new Error('private key detail'), { code: 'SECRET_LOCKED' }); }];
  for (const getSecret of outcomes) {
    const ai = createAI({ getSettings: async () => ({ ai: { baseUrl, model: 'saved' } }), getSecret,
      getUsage: () => ({}), recordCall: () => {}, fetchImpl: () => { throw new Error('Must not dispatch'); } });
    assert.equal((await ai.discoverModels('model', { baseUrl })).status, 'missing_key');
  }
  const h = harness();
  assert.equal((await h.ai.discoverModels('model', { ...config, baseUrl: 'https://1.1.1.1/v1' })).status, 'empty');
  assert.equal(h.requests.length, 1); assert.equal(h.secrets.length, 0);
});
