import { createHash } from 'node:crypto';
import { tokenCost } from './token-usage.mjs';

export const priceValue = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export const currencyValue = value => typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : null;
const digest = value => createHash('sha256').update(value).digest('hex');
export function endpointIdentity(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    return url.href.replace(/\/+$/, '');
  } catch { return null; }
}
export const endpointId = value => value ? digest(String(value)) : null;
export const freezePricing = snapshot => Object.freeze({ ...snapshot, identity: Object.freeze({ ...snapshot.identity }), rates: Object.freeze({ ...snapshot.rates }), limitations: Object.freeze([...(snapshot.limitations || [])]) });

// A snapshot is selected once before reservation. Never consult current settings
// or the live catalog when accounting/recovering an already dispatched request.
export function resolvePricing(config = {}, capability = 'model', catalog = null, at = new Date()) {
  const endpoint = endpointIdentity(config.baseUrl), embedding = capability === 'embedding';
  const currency = currencyValue(config.currency);
  const identity = { capability, provider: config.providerId || null, endpointId: endpointId(endpoint || config.baseUrl), model: config.model || null, billingMode: config.billingMode || 'standard', currency };
  const base = { version: 1, selectedAt: at.toISOString(), identity, unit: embedding || capability === 'model' ? 'per-million-tokens' : 'per-request', rates: {}, source: 'unknown', status: 'unknown', stale: false, limitations: [] };
  if (capability === 'fetch') return freezePricing({ ...base, source: 'local_policy', status: 'known', unit: 'per-request', rates: { requestPrice: 0 } });
  if (capability === 'search') return freezePricing({ ...base, source: currency ? 'manual_override' : 'legacy_manual', status: priceValue(config.requestPrice) === null ? 'unknown' : 'known', rates: { requestPrice: priceValue(config.requestPrice) } });
  const manual = ['inputPrice', 'outputPrice', 'cachedInputPrice'].some(key => priceValue(config[key]) !== null);
  if (manual || config.pricingMode === 'manual') {
    const rates = { inputPrice: priceValue(config.inputPrice), outputPrice: embedding ? 0 : priceValue(config.outputPrice), cachedInputPrice: priceValue(config.cachedInputPrice) };
    return freezePricing({ ...base, source: currency ? 'manual_override' : 'legacy_manual', status: rates.inputPrice !== null && rates.outputPrice !== null ? 'known' : 'partial', rates });
  }
  if (identity.billingMode !== 'standard') return freezePricing({ ...base, limitations: ['unsupported_billing_mode'] });
  const matches = (catalog?.entries || []).filter(entry => entry.endpoint === endpoint && endpoint && entry.model === identity.model && (!identity.provider || identity.provider === entry.provider));
  if (matches.length !== 1) return freezePricing({ ...base, limitations: [matches.length ? 'ambiguous_identity' : 'exact_identity_not_found'] });
  const match = matches[0];
  const limitations = [...match.limitations];
  if (embedding && match.type !== 'embedding' || !embedding && match.type === 'embedding') limitations.push('capability_mismatch');
  const rates = { inputPrice: match.inputPrice, outputPrice: embedding ? 0 : match.outputPrice, cachedInputPrice: match.cachedInputPrice };
  const complete = rates.inputPrice !== null && rates.outputPrice !== null;
  return freezePricing({ ...base, identity: { ...identity, provider: match.provider, currency: 'USD' }, unit: 'per-million-tokens', source: 'models.dev', sourceUrl: 'https://models.dev/api.json', revision: catalog.revision, fetchedAt: catalog.fetchedAt, stale: at.getTime() - Date.parse(catalog.fetchedAt) > 86400000, canonicalModel: match.canonicalModel, rates, status: limitations.length || !complete ? 'partial' : 'known', limitations });
}

export function snapshotCost(usage, snapshot) {
  if (!snapshot || snapshot.status !== 'known') return null;
  if (['search', 'fetch'].includes(snapshot.identity.capability)) return priceValue(snapshot.rates.requestPrice);
  return tokenCost(usage, snapshot.rates, { embedding: snapshot.identity.capability === 'embedding' });
}

export function costCurrency(call) { return currencyValue(call.pricingSnapshot?.identity?.currency) || currencyValue(call.currency); }
export function summarizeCosts(calls) {
  const groups = new Map();
  let unknownCostCalls = 0;
  for (const call of calls) {
    const currency = costCurrency(call), key = currency || 'legacy_manual';
    const amount = priceValue(call.cost);
    if (!groups.has(key)) groups.set(key, { currency, knownCost: 0, unknownCostCalls: 0, calls: 0 });
    const group = groups.get(key); group.calls++;
    if (amount === null) { group.unknownCostCalls++; unknownCostCalls++; }
    else group.knownCost += amount;
  }
  const byCurrency = [...groups.values()];
  const meaningful = byCurrency.filter(group => group.knownCost > 0 || group.unknownCostCalls > 0);
  const mixedCurrency = meaningful.length > 1;
  const knownCost = mixedCurrency ? null : byCurrency.reduce((sum, group) => sum + group.knownCost, 0);
  return { byCurrency, mixedCurrency, currency: meaningful.length === 1 ? meaningful[0].currency : null, knownCost, unknownCostCalls, cost: unknownCostCalls || mixedCurrency ? null : knownCost };
}

export function validPricingSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || snapshot.version !== 1 || !['known','partial','unknown'].includes(snapshot.status) || !['unknown','local_policy','manual_override','legacy_manual','models.dev'].includes(snapshot.source) || !Number.isFinite(Date.parse(snapshot.selectedAt)) || typeof snapshot.stale !== 'boolean') return false;
  const identity = snapshot.identity, rates = snapshot.rates;
  if (!identity || !['model','embedding','search','fetch'].includes(identity.capability) || identity.currency !== null && !currencyValue(identity.currency) || !rates || typeof rates !== 'object' || Array.isArray(rates)) return false;
  for (const [key, value] of Object.entries(rates)) if (!['inputPrice','outputPrice','cachedInputPrice','requestPrice'].includes(key) || value !== null && priceValue(value) === null) return false;
  return ['provider','endpointId','model','billingMode'].every(key => identity[key] === null || typeof identity[key] === 'string' && identity[key].length <= 500) && Array.isArray(snapshot.limitations) && snapshot.limitations.length <= 50 && snapshot.limitations.every(item => typeof item === 'string' && item.length <= 100);
}

// A bill confirmation is separate evidence. It never replaces the immutable
// request snapshot or the original accounted estimate.
export function validPriceConfirmation(value) {
  return Boolean(value && priceValue(value.cost) !== null && (value.currency === null || currencyValue(value.currency)) && typeof value.reason === 'string' && value.reason.trim() && value.reason.length <= 1000 && Number.isFinite(Date.parse(value.at)));
}
export function budgetAccounting(call) {
  const confirmed = validPriceConfirmation(call.pricingConfirmation);
  return { cost: confirmed ? call.pricingConfirmation.cost : call.cost, currency: confirmed ? call.pricingConfirmation.currency : costCurrency(call), trusted: confirmed || !(call.pricingSnapshot?.source === 'models.dev' && call.pricingSnapshot.stale), confirmed };
}
