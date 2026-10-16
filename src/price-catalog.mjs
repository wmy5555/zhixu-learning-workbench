import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { endpointIdentity, priceValue } from './pricing.mjs';

export const CATALOG_URL = 'https://models.dev/api.json';
export const CATALOG_MAX_BYTES = 16 * 1024 * 1024;
export const CATALOG_TTL_MS = 86400000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 500) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const invalid = () => { throw Object.assign(new Error('公开价格目录格式无效，保留上次成功版本。'), { code: 'PRICE_CATALOG_INVALID' }); };

// This one audited SDK default is absent in the upstream OpenAI provider record.
// Other missing endpoints remain unmatched; model names/canonical IDs are never aliases.
function validateCost(cost, depth = 0) {
  if (!object(cost) || depth > 1) invalid();
  for (const key of ['input','output','reasoning','cache_read','cache_write','input_audio','output_audio']) if (Object.hasOwn(cost, key) && priceValue(cost[key]) === null) invalid();
  if (cost.tiers !== undefined) {
    if (!Array.isArray(cost.tiers) || cost.tiers.length > 100) invalid();
    for (const tier of cost.tiers) {
      if (!object(tier) || !object(tier.tier) || tier.tier.type !== 'context' || !Number.isSafeInteger(tier.tier.size) || tier.tier.size < 0) invalid();
      validateCost(tier, depth + 1);
    }
  }
  if (cost.context_over_200k !== undefined) validateCost(cost.context_over_200k, depth + 1);
}
const defaultEndpoints = { openai: 'https://api.openai.com/v1' };
export function parsePriceCatalog(raw, fetchedAt) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > CATALOG_MAX_BYTES) invalid();
  let providers; try { providers = JSON.parse(raw); } catch { invalid(); }
  if (!object(providers) || !Object.keys(providers).length || Object.keys(providers).length > 2000) invalid();
  const entries = [];
  for (const [providerId, provider] of Object.entries(providers)) {
    if (!text(providerId) || !object(provider) || provider.id !== providerId || provider.api !== undefined && typeof provider.api !== 'string' || !object(provider.models)) invalid();
    for (const [modelId, model] of Object.entries(provider.models)) {
      if (!text(modelId) || !object(model) || model.id !== modelId || model.provider !== undefined && !object(model.provider) || entries.length >= 100000) invalid();
      const endpoint = endpointIdentity(model.provider?.api ?? provider.api ?? defaultEndpoints[providerId]);
      const cost = model.cost;
      if (cost !== undefined) validateCost(cost);
      const limitations = [];
      if (cost) {
        // Unknown future pricing dimensions are unsupported, never silently dropped.
        for (const [key, value] of Object.entries(cost)) {
          if (['input','output','reasoning','cache_read','cache_write','input_audio','output_audio'].includes(key)) {
            if (priceValue(value) === null) invalid();
          } else {
            if (!['tiers','context_over_200k'].includes(key)) limitations.push('unsupported_cost_dimension');
          }
        }
        if (cost.tiers !== undefined || cost.context_over_200k !== undefined) limitations.push('context_tiers');
        if (cost.cache_write !== undefined) limitations.push('cache_write_or_ttl');
        if (cost.reasoning !== undefined && cost.reasoning !== cost.output) limitations.push('separate_reasoning_price');
      }
      if (model.experimental?.modes) limitations.push('service_modes');
      entries.push({ provider: providerId, endpoint, model: modelId, type: model.type || null,
        canonicalModel: text(model.canonical_model_id) ? model.canonical_model_id : null,
        inputPrice: priceValue(cost?.input), outputPrice: priceValue(cost?.output), cachedInputPrice: priceValue(cost?.cache_read), limitations });
    }
  }
  if (!entries.length || !Number.isFinite(Date.parse(fetchedAt))) invalid();
  return { revision: createHash('sha256').update(raw).digest('hex'), fetchedAt, entries };
}

// Fixed URL, no credentials/cookies/referrer, no model names/prompts, no redirects.
// The same timeout covers headers and streaming body; the limit applies after decoding.
export async function downloadPriceCatalog({ fetchImpl = globalThis.fetch, signal } = {}) {
  const response = await fetchImpl(CATALOG_URL, { method: 'GET', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { accept: 'application/json' }, signal });
  if (response.status !== 200 || response.redirected || response.url && response.url !== CATALOG_URL) throw Object.assign(new Error('公开价格目录暂时不可用。'), { code: 'PRICE_CATALOG_NETWORK' });
  if (Number(response.headers.get('content-length')) > CATALOG_MAX_BYTES) { await response.body?.cancel(); invalid(); }
  const chunks = []; let size = 0;
  if (!response.body) invalid();
  const reader = response.body.getReader();
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value: chunk } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      size += chunk.byteLength;
      if (size > CATALOG_MAX_BYTES) invalid();
      chunks.push(Buffer.from(chunk));
    }
  } finally { signal?.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

export function createPriceCatalog({ dataDir, fetchImpl, at = () => new Date(), timeoutMs = 10000 } = {}) {
  const filename = path.join(dataDir, 'public-price-catalog.json');
  let active = null, pending = null, lastAttempt = null, lastError = null, closed = false, controller;
  try {
    if (fs.statSync(filename).size <= CATALOG_MAX_BYTES * 2 + 1024) {
      const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (Date.parse(saved.fetchedAt) <= at().getTime()) active = parsePriceCatalog(saved.raw, saved.fetchedAt);
    }
  } catch { /* Missing or invalid cache is unknown, never a free catalog. */ }
  const status = () => ({ source: 'models.dev', sourceUrl: CATALOG_URL, revision: active?.revision || null, fetchedAt: active?.fetchedAt || null, stale: !active || at().getTime() - Date.parse(active.fetchedAt) > CATALOG_TTL_MS, entries: active?.entries.length || 0, refreshing: Boolean(pending), lastAttempt, lastError });
  function refresh({ force = false } = {}) {
    if (closed) return Promise.resolve(status());
    if (pending) return pending;
    const now = at().getTime();
    if (lastAttempt && now - Date.parse(lastAttempt) < (force ? 60000 : 3600000) || !force && active && now - Date.parse(active.fetchedAt) < CATALOG_TTL_MS) return Promise.resolve(status());
    lastAttempt = at().toISOString(); controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
    pending = (async () => {
      let temporary;
      try {
        const raw = await downloadPriceCatalog({ fetchImpl, signal });
        const fetchedAt = at().toISOString(), candidate = parsePriceCatalog(raw, fetchedAt);
        signal.throwIfAborted();
        temporary = `${filename}.${randomUUID()}.tmp`;
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(temporary, JSON.stringify({ fetchedAt, raw }), { flag: 'wx', mode: 0o600 });
        fs.renameSync(temporary, filename);
        active = candidate; lastError = null;
      } catch (error) {
        lastError = ['PRICE_CATALOG_INVALID', 'PRICE_CATALOG_NETWORK'].includes(error.code) ? error.code : signal.aborted ? 'PRICE_CATALOG_TIMEOUT' : 'PRICE_CATALOG_UNAVAILABLE';
      } finally {
        if (temporary) { try { fs.rmSync(temporary, { force: true }); } catch { /* Keep last-good even if temporary cleanup fails. */ } }
        pending = null;
      }
      return status();
    })();
    return pending;
  }
  return { status, current: () => active, refresh, async close() { closed = true; controller?.abort(); await pending; } };
}
