import { tokenCount } from './token-usage.mjs';

const capabilities = new Set(['model', 'embedding', 'search', 'fetch']);
const finiteCost = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const empty = () => ({ calls: 0, failedCalls: 0, tokenCalls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, unknownTokenCalls: 0, unknownCacheCalls: 0, unknownReasoningCalls: 0, knownCost: 0, unknownCostCalls: 0 });
const shiftDay = (day, offset) => new Date(Date.parse(`${day}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
const invalid = message => { throw Object.assign(new Error(message), { code: 'INVALID_USAGE_FILTER', status: 400 }); };

function add(bucket, call) {
  bucket.calls++;
  if (call.ok === false) bucket.failedCalls++;
  const cost = finiteCost(call.cost);
  if (cost === null) bucket.unknownCostCalls++;
  else bucket.knownCost += cost;
  if (!['model', 'embedding'].includes(call.capability)) return;
  bucket.tokenCalls++;
  const input = tokenCount(call.inputTokens), output = tokenCount(call.outputTokens);
  const total = input !== null && output !== null ? tokenCount(input + output) : tokenCount(call.totalTokens);
  bucket.inputTokens += input ?? 0;
  bucket.outputTokens += output ?? 0;
  bucket.totalTokens += total ?? 0;
  if (input === null || output === null || total === null) bucket.unknownTokenCalls++;
  const cache = tokenCount(call.cachedInputTokens), reasoning = tokenCount(call.reasoningTokens);
  if (cache === null || input === null || cache > input) bucket.unknownCacheCalls++;
  else bucket.cachedInputTokens += cache;
  if (call.capability === 'model') {
    if (reasoning === null || output === null || reasoning > output) bucket.unknownReasoningCalls++;
    else bucket.reasoningTokens += reasoning;
  }
}

const finish = bucket => ({ ...bucket, cost: bucket.unknownCostCalls ? null : bucket.knownCost });

// Aggregate the complete local call ledger. Presentation pagination must never cap totals.
export function buildUsageReport(calls, { timezone = 'Asia/Shanghai', period = 'month', capability = '', model = '', at = new Date() } = {}) {
  if (!['today', '7d', '30d', 'month'].includes(period)) invalid('请选择今天、近 7 天、近 30 天或本月。');
  if (capability && !capabilities.has(capability)) invalid('调用类型无效。');
  if (typeof model !== 'string' || model.length > 300) invalid('模型筛选无效。');
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayOf = value => { const date = new Date(value); return Number.isFinite(date.getTime()) ? formatter.format(date) : null; };
  const to = dayOf(at), from = period === 'month' ? `${to.slice(0, 7)}-01` : shiftDay(to, period === 'today' ? 0 : period === '7d' ? -6 : -29);
  const days = new Map(), models = new Map(), availableModels = new Set(), selected = [], totals = empty();
  for (let day = from; day <= to; day = shiftDay(day, 1)) days.set(day, { date: day, ...empty() });
  let invalidDateCalls = 0;
  for (const call of calls) {
    const day = dayOf(call.createdAt);
    if (!day) { invalidDateCalls++; continue; }
    if (day < from || day > to || capability && call.capability !== capability) continue;
    if (call.model) availableModels.add(String(call.model));
    if (model && call.model !== model) continue;
    add(totals, call); add(days.get(day), call); selected.push(call);
    const key = JSON.stringify([call.capability, call.model || '']);
    if (!models.has(key)) models.set(key, { capability: call.capability, model: call.model || '', ...empty() });
    add(models.get(key), call);
  }
  const recentCalls = selected.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 100).map(call => ({
    // Only accounting metadata: no note IDs, prompts, errors, credentials or endpoint paths.
    createdAt: call.createdAt, capability: call.capability, model: call.model || '', ok: typeof call.ok === 'boolean' ? call.ok : null,
    inputTokens: tokenCount(call.inputTokens), outputTokens: tokenCount(call.outputTokens),
    cachedInputTokens: tokenCount(call.cachedInputTokens), cost: finiteCost(call.cost),
  }));
  return {
    period, from, to, timezone, generatedAt: at.toISOString(), filters: { capability, model },
    availableModels: [...availableModels].sort(), totals: finish(totals),
    daily: [...days.values()].map(finish),
    models: [...models.values()].sort((a, b) => b.totalTokens - a.totalTokens || b.calls - a.calls).map(finish),
    recentCalls, recentLimit: 100, invalidDateCalls,
  };
}
