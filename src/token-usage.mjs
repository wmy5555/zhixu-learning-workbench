// Provider-reported counts only. Cache and reasoning counts are subsets, not extra tokens.
export const tokenCount = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const price = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

export function readTokenUsage(usage = {}, { embedding = false } = {}) {
  usage ||= {};
  const inputTokens = tokenCount(usage.prompt_tokens ?? usage.input_tokens ?? (embedding ? usage.total_tokens : undefined));
  const outputTokens = embedding ? 0 : tokenCount(usage.completion_tokens ?? usage.output_tokens);
  const cached = tokenCount(usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens);
  const reasoning = tokenCount(usage.completion_tokens_details?.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens);
  const derived = inputTokens !== null && outputTokens !== null ? tokenCount(inputTokens + outputTokens) : null;
  return {
    inputTokens, outputTokens,
    totalTokens: derived ?? tokenCount(usage.total_tokens),
    cachedInputTokens: cached !== null && inputTokens !== null && cached <= inputTokens ? cached : null,
    reasoningTokens: reasoning !== null && outputTokens !== null && reasoning <= outputTokens ? reasoning : null,
  };
}

export function tokenCost(usage, config, { embedding = false } = {}) {
  const inputPrice = price(config.inputPrice), outputPrice = embedding ? 0 : price(config.outputPrice);
  const cachedPrice = price(config.cachedInputPrice);
  if (usage.inputTokens === null || usage.outputTokens === null || inputPrice === null || outputPrice === null) return null;
  // An explicit discounted rate needs a reported cache split; unknown never means zero.
  if (cachedPrice !== null && usage.cachedInputTokens === null) return null;
  const cached = cachedPrice === null ? 0 : usage.cachedInputTokens;
  const cost = ((usage.inputTokens - cached) * inputPrice + cached * (cachedPrice ?? 0) + usage.outputTokens * outputPrice) / 1_000_000;
  return price(cost);
}
