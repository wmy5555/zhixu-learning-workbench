import { z } from 'zod';
import { fail } from './store.mjs';
import { validatePromptOverrides } from './prompts.mjs';

const numeric = z.union([z.number(), z.string().trim().min(1)]).transform(Number).pipe(z.number().finite());
const price = z.union([z.literal(''), z.null(), numeric.pipe(z.number().nonnegative())]).transform(value => value === '' ? null : value);
const serviceUrl = z.string().max(2000).refine(value => {
  if (!value) return true;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}, '服务地址须为不含凭据的 HTTPS 地址。');
const credential = { apiKey: z.string().max(10000).optional(), clearKey: z.boolean().optional(), hasKey: z.boolean().optional() };
const currency = z.union([z.literal(''), z.string().regex(/^[A-Z]{3}$/)]).nullish();
const pricingIdentity = { currency, providerId: z.string().max(500).optional(), billingMode: z.enum(['standard','batch','priority','flex']).optional(), pricingMode: z.enum(['auto','manual']).optional() };
const prices = { ...pricingIdentity, inputPrice: price.nullish(), outputPrice: price.nullish(), cachedInputPrice: price.nullish() };
const schema = z.object({
  dailyMinutes: numeric.pipe(z.number().min(5).max(240)),
  timezone: z.string().min(1).max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, '时区无效。'),
  scheduleTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  focusTopics: z.array(z.string().max(1000)).max(1000), pausedIds: z.array(z.string().max(500)).max(100000),
  discoveryDays: numeric.pipe(z.number().int().min(1).max(3650)), prompts: z.record(z.string()),
  pricingCatalog: z.object({ enabled: z.boolean() }),
  ai: z.object({ budgetCurrency: currency, enabled: z.boolean(), baseUrl: serviceUrl, model: z.string().max(500),
    timeoutMs: numeric.pipe(z.number().int().min(1000).max(600000)), dailyCallLimit: numeric.pipe(z.number().int().nonnegative()),
    sourceCallLimit: numeric.pipe(z.number().int().min(1).max(300)), monthlyBudget: numeric.pipe(z.number().nonnegative()), ...prices, ...credential }),
  embedding: z.object({ enabled: z.boolean(), baseUrl: serviceUrl, model: z.string().max(500), ...prices, ...credential }),
  search: z.object({ currency, enabled: z.boolean(), baseUrl: serviceUrl, requestPrice: price.nullish(), ...credential }),
  fetch: z.object({ enabled: z.boolean(), testUrl: serviceUrl.optional() }),
  mcp: z.object({ enabled: z.boolean(), allowProposals: z.boolean(), chatgptEnabled: z.boolean(), chatgptAllowRead: z.boolean() }),
});

export function validateSettings(input, old, defaults) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('设置须为键值对象。');
  const draft = {};
  for (const key of Object.keys(defaults)) {
    const group = defaults[key] && typeof defaults[key] === 'object' && !Array.isArray(defaults[key]);
    if (group && input[key] !== undefined && (!input[key] || typeof input[key] !== 'object' || Array.isArray(input[key]))) fail('设置分组须为键值对象。');
    draft[key] = group ? { ...defaults[key], ...old[key], ...input[key] } : input[key] ?? old[key] ?? defaults[key];
    // Explicit null remains invalid rather than silently keeping the old setting.
    if (!group && Object.hasOwn(input, key)) draft[key] = input[key];
  }
  for (const group of ['ai','embedding','search']) {
    const config = draft[group], changed = config.baseUrl !== old[group].baseUrl || config.model !== old[group].model || config.providerId !== old[group].providerId || config.billingMode !== old[group].billingMode;
    if (changed && !Object.hasOwn(input[group] || {}, 'currency')) config.currency = null;
    for (const key of group === 'search' ? ['requestPrice'] : ['inputPrice','outputPrice','cachedInputPrice']) {
      if (changed && !Object.hasOwn(input[group] || {}, key) || config[key] === undefined) config[key] = null;
    }
  }
  const parsed = schema.safeParse(draft);
  if (!parsed.success) fail(`设置无效（${parsed.error.issues[0].path.join('.')}）：${parsed.error.issues[0].message}`);
  const next = parsed.data, credentials = [];
  next.prompts = validatePromptOverrides(next.prompts);
  if (!next.mcp.enabled) next.mcp.allowProposals = false;
  if (!next.mcp.chatgptEnabled) next.mcp.chatgptAllowRead = false;
  for (const group of ['ai','embedding','search']) {
    const config = next[group], capability = group === 'ai' ? 'model' : group;
    if (config.clearKey === true) credentials.push({ capability, clear: true });
    else if (config.apiKey) credentials.push({ capability, value: config.apiKey, binding: credentialBinding(config) });
    delete config.apiKey; delete config.clearKey; delete config.hasKey;
  }
  if (Object.hasOwn(input, 'vaultDir') && (typeof input.vaultDir !== 'string' || !input.vaultDir.trim() || input.vaultDir.includes('\0'))) fail('Vault 目录无效。');
  return { next, credentials };
}

export function credentialBinding(config = {}) {
  let baseUrl = config.baseUrl || '';
  try { const url = new URL(baseUrl); url.pathname = url.pathname.replace(/\/+$/, '') || '/'; baseUrl = url.href; } catch { /* Empty legacy endpoint stays bound to empty. */ }
  return { baseUrl, model: config.model || '' };
}
