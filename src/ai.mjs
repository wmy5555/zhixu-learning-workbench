import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import { AsyncLocalStorage } from 'node:async_hooks';
import { renderPrompt, validatePromptOverrides } from './prompts.mjs';

const DEFAULT_TIMEOUT_MS = 30_000;
const PAGE_TIMEOUT_MS = 20_000;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_PAGE_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const MAX_RETRIES = 2;
const MAX_CONCURRENCY = 3;

const blockedIPv4 = new BlockList();
const blockedIPv6 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10],
  ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blockedIPv4.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['::', 96], ['::ffff:0:0', 96],
  ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
  ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
]) blockedIPv6.addSubnet(network, prefix, 'ipv6');

class AIError extends Error {
  constructor(code, message, options = undefined) {
    super(message, options);
    this.name = 'AIError';
    this.code = code;
  }
}

function fail(code, message, cause) {
  return new AIError(code, message, cause ? { cause } : undefined);
}

function assertCloud(privacy) {
  if (privacy !== 'cloud') {
    throw fail('PRIVACY_LOCAL', '该内容标记为仅本地，禁止发送到外部服务。');
  }
}

function safeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clampInteger(value, fallback, min, max) {
  return Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function hashKey(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function makeCache(maxEntries = 128) {
  const values = new Map();
  return {
    get(key) {
      const entry = values.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        values.delete(key);
        return undefined;
      }
      values.delete(key);
      values.set(key, entry);
      return structuredClone(entry.value);
    },
    set(key, value, ttlMs) {
      values.delete(key);
      values.set(key, { value: structuredClone(value), expiresAt: Date.now() + ttlMs });
      while (values.size > maxEntries) values.delete(values.keys().next().value);
    },
  };
}

function createSemaphore(limit) {
  let active = 0;
  const queue = [];

  const drain = () => {
    while (active < limit && queue.length) {
      const item = queue.shift();
      if (item.signal?.aborted) {
        item.reject(fail('CANCELLED', '请求已取消。'));
        continue;
      }
      active += 1;
      item.cleanup?.();
      item.resolve(() => {
        active -= 1;
        drain();
      });
    }
  };

  return async function withPermit(signal, task) {
    if (signal?.aborted) throw fail('CANCELLED', '请求已取消。');
    const release = await new Promise((resolve, reject) => {
      const item = { resolve, reject, signal, cleanup: null };
      if (signal) {
        const onAbort = () => {
          const index = queue.indexOf(item);
          if (index >= 0) queue.splice(index, 1);
          reject(fail('CANCELLED', '请求已取消。'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        item.cleanup = () => signal.removeEventListener('abort', onAbort);
      }
      queue.push(item);
      drain();
    });
    try {
      return await task();
    } finally {
      release();
    }
  };
}

function composeSignal(userSignal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signals = userSignal ? [userSignal, timeoutSignal] : [timeoutSignal];
  return { signal: AbortSignal.any(signals), timeoutSignal };
}

function classifyAbort(error, userSignal, timeoutSignal) {
  if (userSignal?.aborted) return fail('CANCELLED', '请求已取消。', error);
  if (timeoutSignal?.aborted) return fail('REQUEST_TIMEOUT', '外部请求超时。', error);
  return null;
}

function isBlockedHostname(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local');
}

function isPublicAddress(address, family) {
  const normalizedFamily = family || isIP(address);
  if (normalizedFamily === 4) return !blockedIPv4.check(address, 'ipv4');
  if (normalizedFamily === 6) return !blockedIPv6.check(address, 'ipv6');
  return false;
}

function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? fail('CANCELLED', '请求已取消。'));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? fail('CANCELLED', '请求已取消。'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

async function resolvePublicTarget(input, signal) {
  let url;
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(input);
  } catch (error) {
    throw fail('INVALID_URL', '地址格式无效。', error);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw fail('INVALID_URL', '只允许 HTTP 或 HTTPS 地址。');
  }
  if (url.username || url.password) {
    throw fail('INVALID_URL', '地址中不能包含用户名或密码。');
  }
  if (url.href.length > 4_096 || isBlockedHostname(url.hostname)) {
    throw fail('SSRF_BLOCKED', '目标地址不在允许的公网范围内。');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  const literalFamily = isIP(hostname);
  try {
    addresses = literalFamily
      ? [{ address: hostname, family: literalFamily }]
      : await abortable(dns.lookup(hostname, { all: true, verbatim: true }), signal);
  } catch (error) {
    throw fail('DNS_FAILED', '无法解析目标主机。', error);
  }
  if (!addresses.length || addresses.some(({ address, family }) => !isPublicAddress(address, family))) {
    throw fail('SSRF_BLOCKED', '目标解析到未授权或非公网地址。');
  }
  return { url, addresses };
}

function headerObject(headers) {
  const result = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (value !== undefined && value !== null) result[key] = String(value);
  }
  return result;
}

function normalizeResponseHeaders(headers) {
  const result = new Map();
  if (headers?.forEach) headers.forEach((value, key) => result.set(key.toLowerCase(), value));
  else for (const [key, value] of Object.entries(headers ?? {})) {
    result.set(key.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value ?? ''));
  }
  return { get: (name) => result.get(String(name).toLowerCase()) ?? null };
}

async function injectedRequest(fetchImpl, target, options, maxBytes) {
  const response = await fetchImpl(target.url.href, {
    method: options.method,
    headers: options.headers,
    body: options.body,
    signal: options.signal,
    redirect: 'manual',
  });
  const length = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(length) && length > maxBytes) throw fail('RESPONSE_TOO_LARGE', '外部响应超过大小限制。');
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > maxBytes) throw fail('RESPONSE_TOO_LARGE', '外部响应超过大小限制。');
  return { status: response.status, headers: normalizeResponseHeaders(response.headers), body };
}

function pinnedRequest(target, options, maxBytes) {
  const address = target.addresses[0].address;
  const family = target.addresses[0].family;
  const url = target.url;
  const client = url.protocol === 'https:' ? https : http;
  const defaultPort = url.protocol === 'https:' ? 443 : 80;
  const hostHeader = url.port && Number(url.port) !== defaultPort ? `${url.hostname}:${url.port}` : url.hostname;
  const requestOptions = {
    protocol: url.protocol,
    hostname: address,
    family,
    port: url.port || defaultPort,
    method: options.method,
    path: `${url.pathname}${url.search}`,
    headers: { ...options.headers, host: hostHeader },
    signal: options.signal,
  };
  if (url.protocol === 'https:') requestOptions.servername = isIP(url.hostname.replace(/^\[|\]$/g, '')) ? undefined : url.hostname;

  return new Promise((resolve, reject) => {
    const request = client.request(requestOptions, (response) => {
      const chunks = [];
      let size = 0;
      const declared = Number(response.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) {
        response.destroy();
        reject(fail('RESPONSE_TOO_LARGE', '外部响应超过大小限制。'));
        return;
      }
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          response.destroy(fail('RESPONSE_TOO_LARGE', '外部响应超过大小限制。'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        headers: normalizeResponseHeaders(response.headers),
        body: Buffer.concat(chunks),
      }));
      response.on('error', reject);
    });
    request.on('error', reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

function sanitizeError(value, secrets = []) {
  let text = value instanceof Error ? value.message : String(value ?? '');
  for (const secret of secrets) {
    if (secret) text = text.split(String(secret)).join('[REDACTED]');
  }
  text = text
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
    .replace(/(["']?(?:api[_-]?key|authorization|token)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[REDACTED]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  return text.slice(0, 500) || '外部服务请求失败。';
}

function providerMessage(response, secrets) {
  const raw = response.body.toString('utf8');
  try {
    const data = JSON.parse(raw);
    return sanitizeError(data?.error?.message ?? data?.message ?? data?.detail ?? raw, secrets);
  } catch {
    return sanitizeError(raw, secrets);
  }
}

function shouldRetry(error) {
  if (['CANCELLED', 'REQUEST_TIMEOUT', 'PRIVACY_LOCAL', 'SSRF_BLOCKED', 'INVALID_URL', 'BUDGET_EXCEEDED', 'BUDGET_UNKNOWN', 'SOURCE_BUDGET'].includes(error?.code)) return false;
  if (Number.isInteger(error?.status)) return error.status === 408 || error.status === 409 || error.status === 425 || error.status === 429 || error.status >= 500;
  return !error?.code || error.code === 'NETWORK_ERROR';
}

function mustPropagateResearchError(error) {
  return [
    'CANCELLED', 'PRIVACY_LOCAL', 'BUDGET_EXCEEDED', 'BUDGET_UNKNOWN',
    'SOURCE_BUDGET', 'CAPABILITY_DISABLED', 'MISSING_CREDENTIALS', 'INVALID_CONFIG',
  ].includes(error?.code);
}

function delay(ms, signal) {
  if (signal?.aborted) return Promise.reject(fail('CANCELLED', '请求已取消。'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(fail('CANCELLED', '请求已取消。'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    timer.unref?.();
  });
}

function endpoint(baseUrl, suffix) {
  let base;
  try {
    base = new URL(baseUrl);
  } catch (error) {
    throw fail('INVALID_CONFIG', '外部服务地址无效。', error);
  }
  const normalizedSuffix = suffix.replace(/^\//, '');
  if (base.pathname.replace(/\/$/, '').endsWith(`/${normalizedSuffix}`)) return base;
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return new URL(normalizedSuffix, base);
}

function jsonFormat(json) {
  if (!json) return undefined;
  if (json === true) return { type: 'json_object' };
  if (json.type) return json;
  if (json.schema) {
    return {
      type: 'json_schema',
      json_schema: {
        name: json.name || 'response',
        description: json.description,
        schema: json.schema,
        strict: json.strict ?? true,
      },
    };
  }
  throw fail('INVALID_INPUT', 'json 参数必须是 true 或有效的响应格式配置。');
}

function chatText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n');
  return '';
}

function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, entity) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? all;
    const value = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    try { return String.fromCodePoint(value); } catch { return all; }
  });
}

function htmlToText(html) {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = decodeEntities((titleMatch?.[1] ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const text = decodeEntities(html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|canvas)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|p|div|li|h[1-6]|tr|section|article|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
  return { title, text };
}

function pageWindow(text, claim, maxLength = 1_400) {
  if (text.length <= maxLength) return { text, start: 0 };
  const rawTerms = String(claim).toLowerCase().match(/[a-z0-9]{3,}|[\p{Script=Han}]{2,}/gu) ?? [];
  const terms = rawTerms.flatMap((term) => {
    if (!/[\p{Script=Han}]/u.test(term) || term.length <= 6) return [term];
    const chunks = [];
    for (let index = 0; index <= term.length - 4; index += 2) chunks.push(term.slice(index, index + 6));
    return chunks;
  });
  const lower = text.toLowerCase();
  let hit = -1;
  for (const term of terms.sort((a, b) => b.length - a.length)) {
    hit = lower.indexOf(term);
    if (hit >= 0) break;
  }
  const start = Math.max(0, (hit >= 0 ? hit : 0) - Math.floor(maxLength / 3));
  const end = Math.min(text.length, start + maxLength);
  return { text: text.slice(start, end), start };
}

function parseModelJson(text) {
  try {
    return JSON.parse(String(text).replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch (error) {
    throw fail('INVALID_RESPONSE', '研究评价模型没有返回有效 JSON。', error);
  }
}

function normalizedPassage(text) {
  return String(text).toLowerCase().replace(/\s+/g, ' ').trim();
}

function passagesOverlap(a, b) {
  const left = normalizedPassage(a);
  const right = normalizedPassage(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  return shorter.length >= 200 && longer.includes(shorter);
}

/**
 * Creates the external AI capability adapter used by the local knowledge service.
 * All outward methods require privacy === "cloud".
 */
export function createAI({ getSettings, getSecret, recordCall, getUsage, fetchImpl } = {}) {
  if (![getSettings, getSecret, recordCall, getUsage].every((fn) => typeof fn === 'function')) {
    throw fail('INVALID_CONFIG', 'createAI 缺少必需的配置、密钥、用量或记录函数。');
  }

  const withPermit = createSemaphore(MAX_CONCURRENCY);
  const searchCache = makeCache(128);
  const pageCache = makeCache(128);
  const embeddingCache = makeCache(64);
  const sourceBudget = new AsyncLocalStorage();
  let budgetTail = Promise.resolve();
  let reservedCalls = 0;

  async function withBudget({ limit, sourceId } = {}, fn) {
    if (!Number.isInteger(limit) || limit < 0) throw fail('INVALID_INPUT', '任务外部请求上限必须是非负整数。');
    if (typeof sourceId !== 'string' || !sourceId.trim()) throw fail('INVALID_INPUT', 'sourceId 不能为空。');
    if (typeof fn !== 'function') throw fail('INVALID_INPUT', 'withBudget 需要可执行的任务函数。');
    return sourceBudget.run({ limit, sourceId: sourceId.trim(), used: 0 }, fn);
  }

  function consumeSourceBudget() {
    const budget = sourceBudget.getStore();
    if (!budget) return;
    if (budget.used >= budget.limit) {
      throw fail('SOURCE_BUDGET', `来源 ${budget.sourceId} 的外部请求已达到任务上限 ${budget.limit}。`);
    }
    budget.used += 1;
  }

  async function settings() {
    return (await getSettings()) ?? {};
  }

  function capabilityConfig(allSettings, capability) {
    if (capability === 'model') return allSettings.ai ?? {};
    return allSettings[capability] ?? {};
  }

  async function requireCapability(capability, needsSecret = true) {
    const allSettings = await settings();
    const config = capabilityConfig(allSettings, capability);
    if (config.enabled !== true) throw fail('CAPABILITY_DISABLED', `${capability} 能力尚未启用。`);
    const secret = needsSecret ? await getSecret(capability) : null;
    if (needsSecret && (!secret || typeof secret !== 'string')) {
      throw fail('MISSING_CREDENTIALS', `${capability} 未配置凭据。`);
    }
    return { allSettings, config, secret };
  }

  async function reserveBudget(allSettings) {
    let unlock;
    const previous = budgetTail;
    budgetTail = new Promise((resolve) => { unlock = resolve; });
    await previous;
    try {
      const usage = (await getUsage()) ?? {};
      const dailyLimit = safeNumber(allSettings.ai?.dailyCallLimit);
      const callsToday = safeNumber(usage.callsToday) ?? 0;
      if (dailyLimit !== null && dailyLimit >= 0 && callsToday + reservedCalls >= dailyLimit) {
        throw fail('BUDGET_EXCEEDED', '今日外部调用次数已达到上限。');
      }
      const monthlyBudget = safeNumber(allSettings.ai?.monthlyBudget);
      if (monthlyBudget !== null && monthlyBudget > 0) {
        const costMonth = safeNumber(usage.costMonth);
        if (costMonth === null) throw fail('BUDGET_UNKNOWN', '本月费用未知，无法在预算保护下继续调用。');
        if (costMonth >= monthlyBudget) throw fail('BUDGET_EXCEEDED', '本月外部服务预算已用尽。');
      }
      reservedCalls += 1;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          reservedCalls -= 1;
        }
      };
    } finally {
      unlock();
    }
  }

  async function safeRecord(entry, secrets) {
    try {
      await recordCall({
        ...entry,
        inputTokens: safeNumber(entry.inputTokens),
        outputTokens: safeNumber(entry.outputTokens),
        cost: safeNumber(entry.cost),
        error: entry.error ? sanitizeError(entry.error, secrets) : undefined,
      });
    } catch {
      // A diagnostics sink must not replace the actual provider outcome.
    }
  }

  async function networkAttempt({ capability, model = null, allSettings, url, method = 'GET', headers = {}, body, signal, timeoutMs, maxBytes, secrets = [], allowRedirect = false, accounting }) {
    if (signal?.aborted) throw fail('CANCELLED', '请求已取消。');
    const { signal: combinedSignal, timeoutSignal } = composeSignal(signal, timeoutMs);
    let target;
    try {
      target = await withPermit(combinedSignal, () => resolvePublicTarget(url, combinedSignal));
    } catch (error) {
      const abort = classifyAbort(error, signal, timeoutSignal);
      if (abort) throw abort;
      throw error;
    }
    if (combinedSignal.aborted) throw classifyAbort(combinedSignal.reason, signal, timeoutSignal);
    const releaseBudget = await reserveBudget(allSettings);
    let started = Date.now();
    let sent = false;
    let response;
    let operationError;
    let measured = { inputTokens: null, outputTokens: null, cost: capability === 'fetch' ? 0 : null };
    const sourceId = sourceBudget.getStore()?.sourceId;
    try {
      response = await withPermit(combinedSignal, async () => {
        consumeSourceBudget();
        try {
          sent = true;
          started = Date.now();
          return fetchImpl
            ? await injectedRequest(fetchImpl, target, { method, headers: headerObject(headers), body, signal: combinedSignal }, maxBytes)
            : await pinnedRequest(target, { method, headers: headerObject(headers), body, signal: combinedSignal }, maxBytes);
        } catch (error) {
          const abort = classifyAbort(error, signal, timeoutSignal);
          if (abort) throw abort;
          if (error?.code) throw error;
          throw fail('NETWORK_ERROR', '无法连接外部服务。', error);
        }
      });
      if ((response.status < 200 || response.status >= 300) && !(allowRedirect && [301, 302, 303, 307, 308].includes(response.status))) {
        const error = fail('PROVIDER_ERROR', providerMessage(response, secrets));
        error.status = response.status;
        throw error;
      }
      if (typeof accounting === 'function' && response.status >= 200 && response.status < 300) {
        try { measured = { ...measured, ...accounting(response) }; } catch { /* invalid data is handled by the response parser */ }
      }
      return response;
    } catch (error) {
      operationError = error?.code ? error : fail('PROVIDER_ERROR', sanitizeError(error, secrets), error);
      throw operationError;
    } finally {
      if (sent) {
        await safeRecord({
          capability,
          model,
          inputTokens: measured.inputTokens,
          outputTokens: measured.outputTokens,
          cost: measured.cost,
          durationMs: Date.now() - started,
          ok: !operationError,
          error: operationError,
          ...(sourceId ? { sourceId } : {}),
        }, secrets);
      }
      releaseBudget();
    }
  }

  async function requestWithRetry(options) {
    let lastError;
    const retries = clampInteger(options.retries, MAX_RETRIES, 0, MAX_RETRIES);
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await networkAttempt(options);
      } catch (error) {
        lastError = error;
        if (attempt >= retries || !shouldRetry(error)) throw error;
        await delay(250 * (2 ** attempt), options.signal);
      }
    }
    throw lastError;
  }

  async function requestJson(options) {
    const response = await requestWithRetry({ ...options, maxBytes: MAX_JSON_BYTES, timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS });
    let data;
    try {
      data = JSON.parse(response.body.toString('utf8'));
    } catch (error) {
      throw fail('INVALID_RESPONSE', '外部服务返回了无效 JSON。', error);
    }
    return { data, response };
  }

  async function generate({ system = '', prompt, privacy, signal, json } = {}) {
    assertCloud(privacy);
    if (typeof prompt !== 'string' || !prompt.trim()) throw fail('INVALID_INPUT', 'prompt 不能为空。');
    const { allSettings, config, secret } = await requireCapability('model');
    if (!config.baseUrl || !config.model) throw fail('INVALID_CONFIG', '模型服务地址或模型名称未配置。');
    const responseFormat = jsonFormat(json);
    const body = JSON.stringify({
      model: config.model,
      messages: [
        ...(system ? [{ role: 'system', content: String(system) }] : []),
        { role: 'user', content: prompt },
      ],
      ...(responseFormat ? { response_format: responseFormat } : {}),
    });
    const started = Date.now();
    let result;
    try {
      result = await requestJson({
        capability: 'model', model: config.model, allSettings,
        timeoutMs: clampInteger(config.timeoutMs, 180_000, 1_000, 600_000),
        // A POST may already be generating and billed when our connection fails.
        // Never automatically repeat a model request whose outcome is uncertain.
        retries: 0,
        url: endpoint(config.baseUrl, 'chat/completions'), method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json', accept: 'application/json' },
        body, signal, secrets: [secret],
        accounting: (response) => {
          const data = JSON.parse(response.body.toString('utf8'));
          const inputTokens = safeNumber(data?.usage?.prompt_tokens);
          const outputTokens = safeNumber(data?.usage?.completion_tokens);
          const inputPrice = safeNumber(config.inputPrice);
          const outputPrice = safeNumber(config.outputPrice);
          const cost = inputTokens !== null && outputTokens !== null && inputPrice !== null && outputPrice !== null
            ? (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000
            : null;
          return { inputTokens, outputTokens, cost };
        },
      });
    } catch (error) {
      throw error;
    }
    if (result.data?.choices?.[0]?.finish_reason === 'length') throw fail('MODEL_TRUNCATED', '模型输出达到长度上限，未取得完整结果；请缩短资料或调整模型输出限制。不会自动重复请求。');
    const text = chatText(result.data?.choices?.[0]?.message?.content);
    if (!text && result.data?.choices?.[0]?.message?.refusal) {
      throw fail('MODEL_REFUSAL', '模型拒绝了该请求。');
    }
    if (typeof text !== 'string' || !text.trim() || !result.data?.choices?.length) throw fail('INVALID_RESPONSE', '模型响应没有可用的正文；可能已计费，不会自动重复请求。');
    const usage = {
      inputTokens: safeNumber(result.data?.usage?.prompt_tokens),
      outputTokens: safeNumber(result.data?.usage?.completion_tokens),
      totalTokens: safeNumber(result.data?.usage?.total_tokens),
      cost: null,
      durationMs: Date.now() - started,
    };
    const inputPrice = safeNumber(config.inputPrice);
    const outputPrice = safeNumber(config.outputPrice);
    if (usage.inputTokens !== null && usage.outputTokens !== null && inputPrice !== null && outputPrice !== null) {
      usage.cost = (usage.inputTokens * inputPrice + usage.outputTokens * outputPrice) / 1_000_000;
    }
    // The transport record is intentionally cost-unknown; append a usage record only
    // through the caller's persisted aggregation, which can use this returned usage.
    return { text, usage };
  }

  async function embed({ texts, privacy, signal } = {}) {
    assertCloud(privacy);
    if (!Array.isArray(texts) || !texts.length || texts.some((text) => typeof text !== 'string' || !text.length)) {
      throw fail('INVALID_INPUT', 'texts 必须是非空字符串数组。');
    }
    const { allSettings, config, secret } = await requireCapability('embedding');
    if (!config.baseUrl || !config.model) throw fail('INVALID_CONFIG', '嵌入服务地址或模型名称未配置。');
    const cacheKey = hashKey(['embedding', config.baseUrl, config.model, texts]);
    const cached = embeddingCache.get(cacheKey);
    if (cached) return cached;
    const { data } = await requestJson({
      capability: 'embedding', model: config.model, allSettings,
      url: endpoint(config.baseUrl, 'embeddings'), method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ model: config.model, input: texts }), signal, secrets: [secret],
      accounting: (response) => {
        const responseData = JSON.parse(response.body.toString('utf8'));
        const inputTokens = safeNumber(responseData?.usage?.prompt_tokens);
        const inputPrice = safeNumber(config.inputPrice);
        return {
          inputTokens,
          outputTokens: 0,
          cost: inputTokens !== null && inputPrice !== null ? inputTokens * inputPrice / 1_000_000 : null,
        };
      },
    });
    if (!Array.isArray(data?.data) || data.data.length !== texts.length) throw fail('INVALID_RESPONSE', '嵌入响应数量与输入不一致。');
    const vectors = [...data.data].sort((a, b) => a.index - b.index).map((item) => item.embedding);
    if (vectors.some((vector) => !Array.isArray(vector) || vector.some((value) => typeof value !== 'number' || !Number.isFinite(value)))) {
      throw fail('INVALID_RESPONSE', '嵌入响应包含无效向量。');
    }
    const value = { vectors };
    embeddingCache.set(cacheKey, value, 24 * 60 * 60 * 1000);
    return value;
  }

  async function search({ query, privacy, signal } = {}) {
    assertCloud(privacy);
    if (typeof query !== 'string' || !query.trim()) throw fail('INVALID_INPUT', 'query 不能为空。');
    const { allSettings, config, secret } = await requireCapability('search');
    const baseUrl = config.baseUrl || 'https://api.tavily.com';
    const cacheKey = hashKey(['search', baseUrl, query]);
    const cached = searchCache.get(cacheKey);
    if (cached) return cached;
    const { data } = await requestJson({
      capability: 'search', allSettings, url: endpoint(baseUrl, 'search'), method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query, search_depth: 'advanced', max_results: 6, include_answer: false, include_raw_content: false }),
      signal, secrets: [secret],
    });
    if (!Array.isArray(data?.results)) throw fail('INVALID_RESPONSE', '搜索服务响应缺少结果列表。');
    const results = data.results.flatMap((item) => {
      if (!item || typeof item.url !== 'string') return [];
      try {
        const parsed = new URL(item.url);
        if (!['http:', 'https:'].includes(parsed.protocol)) return [];
      } catch { return []; }
      return [{ title: String(item.title ?? ''), url: item.url, snippet: String(item.content ?? item.snippet ?? '') }];
    });
    const value = { results };
    searchCache.set(cacheKey, value, 15 * 60 * 1000);
    return value;
  }

  async function readPage({ url, privacy, signal } = {}) {
    assertCloud(privacy);
    if (typeof url !== 'string' && !(url instanceof URL)) throw fail('INVALID_INPUT', 'url 不能为空。');
    const { allSettings, config } = await requireCapability('fetch', false);
    let initialUrl;
    try { initialUrl = new URL(url).href; }
    catch (error) { throw fail('INVALID_URL', '地址格式无效。', error); }
    const cacheKey = hashKey(['page', initialUrl]);
    const cached = pageCache.get(cacheKey);
    if (cached) return cached;
    let current = new URL(initialUrl);
    let previousProtocol = current.protocol;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await requestWithRetry({
        capability: 'fetch', allSettings, url: current, method: 'GET',
        headers: { accept: 'text/html, text/plain;q=0.9, application/xhtml+xml;q=0.8', 'user-agent': 'LearningWorkbench/0.1 (+local research fetcher)' },
        signal, timeoutMs: clampInteger(config.timeoutMs, PAGE_TIMEOUT_MS, 1_000, 60_000), maxBytes: MAX_PAGE_BYTES, allowRedirect: true,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects === MAX_REDIRECTS) throw fail('TOO_MANY_REDIRECTS', '网页重定向次数过多。');
        const location = response.headers.get('location');
        if (!location) throw fail('INVALID_RESPONSE', '网页重定向缺少 Location。');
        const next = new URL(location, current);
        if (previousProtocol === 'https:' && next.protocol !== 'https:') throw fail('UNSAFE_REDIRECT', '拒绝 HTTPS 降级重定向。');
        await resolvePublicTarget(next);
        current = next;
        previousProtocol = next.protocol;
        continue;
      }
      const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
      if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml') && !contentType.includes('text/plain')) {
        throw fail('UNSUPPORTED_CONTENT_TYPE', '网页读取只支持 HTML 或纯文本。');
      }
      const decoded = new TextDecoder('utf-8', { fatal: false }).decode(response.body);
      const parsed = contentType.includes('text/plain') ? { title: '', text: decoded.trim() } : htmlToText(decoded);
      if (!parsed.text) throw fail('EMPTY_PAGE', '网页正文为空或无法提取。');
      const value = { url: current.href, title: parsed.title || current.hostname, text: parsed.text, fetchedAt: new Date().toISOString() };
      pageCache.set(cacheKey, value, 10 * 60 * 1000);
      if (current.href !== initialUrl) pageCache.set(hashKey(['page', current.href]), value, 10 * 60 * 1000);
      return value;
    }
    throw fail('TOO_MANY_REDIRECTS', '网页重定向次数过多。');
  }

  async function research({ claim, privacy, signal, prompts } = {}) {
    assertCloud(privacy);
    if (typeof claim !== 'string' || !claim.trim()) throw fail('INVALID_INPUT', 'claim 不能为空。');
    const promptOverrides = validatePromptOverrides(prompts ?? (await settings()).prompts);
    const directions = [
      { direction: 'support', query: renderPrompt('researchSearchSupport', { context: claim.trim() }, promptOverrides).slice(0, 350) },
      { direction: 'oppose', query: renderPrompt('researchSearchOppose', { context: claim.trim() }, promptOverrides).slice(0, 350) },
    ];
    const notes = [];
    const found = [];
    for (const direction of directions) {
      try {
        const response = await search({ query: direction.query, privacy, signal });
        notes.push(`${direction.direction === 'support' ? '支持' : '反证'}方向搜索返回 ${response.results.length} 项，选取前 ${Math.min(3, response.results.length)} 项尝试读取。`);
        for (const item of response.results.slice(0, 3)) found.push({ ...item, searchDirection: direction.direction });
      } catch (error) {
        if (mustPropagateResearchError(error)) throw error;
        notes.push(`${direction.direction === 'support' ? '支持' : '反证'}方向搜索失败：${error?.code ?? 'UNKNOWN'}`);
      }
    }
    const unique = [];
    const seen = new Set();
    for (const item of found) {
      let canonical;
      try {
        const parsed = new URL(item.url);
        parsed.hash = '';
        canonical = parsed.href;
      } catch { continue; }
      if (!seen.has(canonical)) {
        seen.add(canonical);
        unique.push({ ...item, url: canonical });
      }
    }
    const settled = await Promise.allSettled(unique.map(async (item) => {
      const page = await readPage({ url: item.url, privacy, signal });
      return { page, item, window: pageWindow(page.text, claim) };
    }));
    const pages = [];
    for (let index = 0; index < settled.length; index += 1) {
      const item = settled[index];
      if (item.status === 'fulfilled') {
        if (pages.some((existing) => passagesOverlap(existing.window.text, item.value.window.text))) {
          notes.push(`跳过与已读页面正文高度重叠的候选：${item.value.page.url}`);
        } else pages.push(item.value);
      }
      else {
        if (mustPropagateResearchError(item.reason)) throw item.reason;
        notes.push(`无法读取 ${unique[index].url}：${item.reason?.code ?? 'UNKNOWN'}`);
      }
    }
    if (!pages.length) {
      return {
        claim,
        evidence: [],
        limitations: ['未取得任何可读取且不重复的网页正文，无法评价该主张。'],
        conclusion: '当前没有足够的已读正文形成证据结论。',
        notice: `已尝试支持和反证方向搜索。${notes.join(' ')}`,
      };
    }

    const evaluationPrompt = renderPrompt('researchEvaluation', {
      claim,
      pages: JSON.stringify(pages.map((entry, index) => ({
      index,
      title: entry.page.title || entry.item.title,
      url: entry.page.url,
      text: entry.window.text,
      }))),
    }, promptOverrides);
    const evaluation = parseModelJson((await generate({
      system: renderPrompt('researchSystem', {}, promptOverrides),
      prompt: evaluationPrompt,
      privacy,
      signal,
      json: true,
    })).text);
    if (!Array.isArray(evaluation.assessments) || typeof evaluation.conclusion !== 'string' || !evaluation.conclusion.trim()) {
      throw fail('INVALID_RESPONSE', '研究评价模型返回的数据结构无效。');
    }

    const evidence = [];
    const assessedIndexes = new Set();
    let rejectedExcerptCount = 0;
    for (const assessment of evaluation.assessments) {
      const index = assessment?.index;
      if (!Number.isInteger(index) || index < 0 || index >= pages.length || assessedIndexes.has(index)) continue;
      assessedIndexes.add(index);
      if (assessment.role === 'irrelevant') continue;
      if (!['support', 'oppose', 'limit'].includes(assessment.role)) continue;
      const excerpt = typeof assessment.excerpt === 'string' ? assessment.excerpt.trim() : '';
      const page = pages[index].page;
      const offset = excerpt && excerpt.length <= 1_000 ? page.text.indexOf(excerpt) : -1;
      if (offset < 0) {
        rejectedExcerptCount += 1;
        continue;
      }
      evidence.push({
        url: page.url,
        title: page.title || pages[index].item.title,
        excerpt,
        locator: `正文字符 ${offset + 1}-${offset + excerpt.length}`,
        fetchedAt: page.fetchedAt,
        role: assessment.role,
        rationale: String(assessment.rationale ?? '').slice(0, 1_000),
      });
    }

    if (rejectedExcerptCount) notes.push(`丢弃 ${rejectedExcerptCount} 条无法在已读正文中逐字定位的模型摘录。`);
    const limitations = [];
    const modelLimitations = Array.isArray(evaluation.limitations)
      ? evaluation.limitations.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim().slice(0, 1_000))
      : [];
    if (!evidence.length) {
      limitations.push('模型评价未留下任何可在已读正文中逐字定位的相关证据。');
    }
    if (evaluation.evidenceSufficient !== true) {
      limitations.push(...(modelLimitations.length ? modelLimitations : ['现有正文证据不足以支持有边界的结论。']));
    }
    if (evaluation.unresolvedConflict === true) {
      limitations.push(...(modelLimitations.length ? modelLimitations : ['支持与反对证据存在尚未解决的冲突。']));
    }
    if (!evidence.some((item) => item.role === 'oppose')) notes.push('本轮未识别到可逐字定位的反证正文；这只描述本次有限检索范围。');
    notes.push('证据角色、理由和结论由模型依据已读正文窗口整理，摘录已经程序逐字回查；仍需结合原网页语境审阅。');
    return {
      claim,
      evidence,
      limitations: [...new Set(limitations)],
      conclusion: evidence.length ? evaluation.conclusion.trim().slice(0, 4_000) : '当前没有可逐字定位的正文证据支持自动结论。',
      notice: notes.join(' '),
    };
  }

  async function researchBatch({ claims, topic = '', privacy, signal, prompts } = {}) {
    assertCloud(privacy);
    if (!Array.isArray(claims) || !claims.length || claims.some((claim) => typeof claim !== 'string' || !claim.trim())) {
      throw fail('INVALID_INPUT', 'claims 必须是非空字符串数组。');
    }
    if (topic !== undefined && topic !== null && typeof topic !== 'string') {
      throw fail('INVALID_INPUT', 'topic 必须是字符串。');
    }

    const normalizedClaims = claims.map((claim) => claim.trim());
    const config = await settings(), promptOverrides = validatePromptOverrides(prompts ?? config.prompts);
    if (!sourceBudget.getStore()) {
      return withBudget({ limit: clampInteger(config.ai.sourceCallLimit, 12, 1, 30), sourceId: `research-batch-${hashKey(normalizedClaims).slice(0, 16)}` },
        () => researchBatch({ claims: normalizedClaims, topic, privacy, signal, prompts: promptOverrides }));
    }
    const subject = String(topic ?? '').trim();
    const compact = (value, limit) => String(value).replace(/\s+/g, ' ').trim().slice(0, limit);
    // Earlier extraction, redirects, and retries already count against this source budget.
    const budget = sourceBudget.getStore(), remaining = Math.max(0, budget.limit - budget.used);
    const pageLimit = Math.min(4, Math.max(0, remaining - 3));
    const groupLimit = pageLimit ? Math.min(3, Math.max(0, Math.floor((remaining - pageLimit - 1) / 2))) : 0;
    const groups = [];
    for (let index = 0; index < normalizedClaims.length; index += 3) groups.push(Array.from({ length: Math.min(3, normalizedClaims.length - index) }, (_, offset) => index + offset));
    const coverageLimitations = normalizedClaims.map(() => ['该主张所在检索组未纳入本轮请求预算或分组上限，尚未进行针对检索；请继续后续研究批次。']);
    const queryFor = (indexes, key) => {
      for (const title of [compact(subject, 60), '']) {
        const build = limit => renderPrompt(key, { context: [
          ...(title ? [`topic: ${title}`] : []),
          `facts: ${indexes.map(index => compact(normalizedClaims[index], limit)).join('; ')}`,
        ].join('; ') }, promptOverrides);
        if (build(24).length > 350) continue;
        let low = 24, high = 100;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (build(middle).length <= 350) low = middle;
          else high = middle - 1;
        }
        return build(low);
      }
      return null;
    };
    const selected = groups.slice(0, groupLimit).map((indexes, groupIndex) => ({ indexes, groupIndex,
      support: queryFor(indexes, 'researchSearchSupport'), oppose: queryFor(indexes, 'researchSearchOppose') }));
    const scheduled = selected.filter(group => group.support && group.oppose);
    for (const group of selected) for (const index of group.indexes) coverageLimitations[index] = group.support && group.oppose ? [] : ['搜索提示词与该组主张无法在 350 字符内共同保留，未执行该组检索；请缩短搜索模板或拆分主张。'];
    const claimIndexes = scheduled.flatMap(group => group.indexes);
    const directions = ['support', 'oppose'].flatMap(direction => scheduled.map(group => ({ direction, query: group[direction], claimIndexes: group.indexes, groupIndex: group.groupIndex })));
    const notes = [`共 ${groups.length} 个检索组，本轮安排 ${scheduled.length} 组、${claimIndexes.length} 项主张；每组同时搜索支持与反证，网页读取总上限 ${pageLimit}。`];
    const uncovered = (claim, claimIndex) => ({ claim, evidence: [], limitations: coverageLimitations[claimIndex], conclusion: '本轮未执行该主张的针对检索，暂不能形成证据结论。', notice: notes.join(' ') });
    if (!directions.length) return { results: normalizedClaims.map(uncovered) };
    const searches = await Promise.allSettled(directions.map(({ query }) => search({ query, privacy, signal })));
    const foundByDirection = directions.map(() => []);
    for (let index = 0; index < searches.length; index += 1) {
      const item = searches[index];
      const label = directions[index].direction === 'support' ? '支持' : '反证';
      if (item.status === 'fulfilled') {
        foundByDirection[index] = item.value.results;
        notes.push(`${label}方向共享搜索返回 ${item.value.results.length} 项。`);
      } else {
        if (mustPropagateResearchError(item.reason)) throw item.reason;
        notes.push(`${label}方向共享搜索失败：${item.reason?.code ?? 'UNKNOWN'}`);
        for (const claimIndex of directions[index].claimIndexes) coverageLimitations[claimIndex].push(`该主张的${label}方向检索失败，研究覆盖尚不完整。`);
      }
    }

    const unique = [];
    const seen = new Set();
    const maxCandidates = Math.max(...foundByDirection.map((items) => items.length), 0);
    for (let rank = 0; rank < maxCandidates && unique.length < pageLimit; rank += 1) {
      for (let directionIndex = 0; directionIndex < foundByDirection.length && unique.length < pageLimit; directionIndex += 1) {
        const item = foundByDirection[directionIndex][rank];
        if (!item) continue;
        let canonical;
        try {
          const parsed = new URL(item.url);
          parsed.hash = '';
          canonical = parsed.href;
        } catch { continue; }
        if (seen.has(canonical)) continue;
        seen.add(canonical);
        unique.push({ ...item, url: canonical, searchDirection: directions[directionIndex].direction });
      }
    }
    notes.push(`${directions.length} 次分组搜索合并去重后，选取 ${unique.length} 个网页尝试读取（上限 ${pageLimit} 个）。`);

    const settled = await Promise.allSettled(unique.map(async (item) => {
      const page = await readPage({ url: item.url, privacy, signal });
      return {
        page,
        item,
        windows: claimIndexes.map(index => pageWindow(page.text, normalizedClaims[index])),
      };
    }));
    const pages = [];
    for (let index = 0; index < settled.length; index += 1) {
      const item = settled[index];
      if (item.status === 'fulfilled') {
        const comparisonText = item.value.windows.map((window) => window.text).join('\n');
        if (pages.some((existing) => passagesOverlap(
          existing.windows.map((window) => window.text).join('\n'),
          comparisonText,
        ))) {
          notes.push(`跳过与已读页面正文高度重叠的候选：${item.value.page.url}`);
        } else pages.push(item.value);
      } else {
        if (mustPropagateResearchError(item.reason)) throw item.reason;
        notes.push(`无法读取 ${unique[index].url}：${item.reason?.code ?? 'UNKNOWN'}`);
      }
    }

    if (!pages.length) {
      return {
        results: normalizedClaims.map((claim, claimIndex) => ({
          claim,
          evidence: [],
          limitations: [...coverageLimitations[claimIndex], '未取得任何可读取且不重复的网页正文，无法评价该主张。'],
          conclusion: '当前没有足够的已读正文形成证据结论。',
          notice: notes.join(' '),
        })),
      };
    }

    const evaluationPages = pages.map((entry, pageIndex) => {
      const groupedWindows = [];
      const byText = new Map();
      for (let windowIndex = 0; windowIndex < entry.windows.length; windowIndex += 1) {
        const claimIndex = claimIndexes[windowIndex], text = entry.windows[windowIndex].text;
        const existing = byText.get(text);
        if (existing) existing.claimIndexes.push(claimIndex);
        else {
          const grouped = { claimIndexes: [claimIndex], text };
          byText.set(text, grouped);
          groupedWindows.push(grouped);
        }
      }
      return {
        pageIndex,
        title: entry.page.title || entry.item.title,
        url: entry.page.url,
        windows: groupedWindows,
      };
    });
    const evaluationPrompt = renderPrompt('researchBatchEvaluation', {
      topic: subject || '未单独提供主题',
      claims: JSON.stringify(claimIndexes.map(claimIndex => ({ claimIndex, claim: normalizedClaims[claimIndex] }))),
      pages: JSON.stringify(evaluationPages),
    }, promptOverrides);
    const evaluation = parseModelJson((await generate({
      system: renderPrompt('researchSystem', {}, promptOverrides),
      prompt: evaluationPrompt,
      privacy,
      signal,
      json: true,
    })).text);
    if (!Array.isArray(evaluation.results)) {
      throw fail('INVALID_RESPONSE', '批量研究评价模型返回的数据结构无效。');
    }

    const evaluations = new Map();
    for (const item of evaluation.results) {
      const claimIndex = item?.claimIndex;
      if (!Number.isInteger(claimIndex) || claimIndex < 0 || claimIndex >= normalizedClaims.length || evaluations.has(claimIndex)) continue;
      evaluations.set(claimIndex, item);
    }

    return {
      results: normalizedClaims.map((claim, claimIndex) => {
        if (!claimIndexes.includes(claimIndex)) return uncovered(claim, claimIndex);
        const item = evaluations.get(claimIndex);
        const claimNotes = [...notes];
        if (!item || !Array.isArray(item.assessments) || !item.assessments.length) {
          claimNotes.push('批量评价没有返回该主张的逐页评估。');
          return {
            claim,
            evidence: [],
            limitations: [...coverageLimitations[claimIndex], '研究评价模型未返回该主张的评估，不能将其视为已核实。'],
            conclusion: '本轮缺少该主张的模型评估，不能判定为已核实。',
            notice: claimNotes.join(' '),
          };
        }

        const evidence = [];
        const assessedPages = new Set();
        let rejectedExcerptCount = 0;
        for (const assessment of item.assessments) {
          const pageIndex = assessment?.pageIndex;
          if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pages.length || assessedPages.has(pageIndex)) continue;
          assessedPages.add(pageIndex);
          if (assessment.role === 'irrelevant') continue;
          if (!['support', 'oppose', 'limit'].includes(assessment.role)) continue;
          const excerpt = typeof assessment.excerpt === 'string' ? assessment.excerpt.trim() : '';
          const page = pages[pageIndex].page;
          const offset = excerpt && excerpt.length <= 1_000 ? page.text.indexOf(excerpt) : -1;
          if (offset < 0) {
            rejectedExcerptCount += 1;
            continue;
          }
          evidence.push({
            url: page.url,
            title: page.title || pages[pageIndex].item.title,
            excerpt,
            locator: `正文字符 ${offset + 1}-${offset + excerpt.length}`,
            fetchedAt: page.fetchedAt,
            role: assessment.role,
            rationale: String(assessment.rationale ?? '').slice(0, 1_000),
          });
        }

        if (rejectedExcerptCount) claimNotes.push(`丢弃 ${rejectedExcerptCount} 条无法在已读正文中逐字定位的模型摘录。`);
        const modelLimitations = Array.isArray(item.limitations)
          ? item.limitations.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim().slice(0, 1_000))
          : [];
        const limitations = [...coverageLimitations[claimIndex]];
        if (!evidence.length) limitations.push('模型评价未留下任何可在已读正文中逐字定位的相关证据。');
        if (item.evidenceSufficient !== true) {
          limitations.push(...(modelLimitations.length ? modelLimitations : ['现有正文证据不足以支持有边界的结论。']));
        }
        if (item.unresolvedConflict === true) {
          limitations.push(...(modelLimitations.length ? modelLimitations : ['支持与反对证据存在尚未解决的冲突。']));
        }
        const conclusion = typeof item.conclusion === 'string' ? item.conclusion.trim() : '';
        if (!conclusion) limitations.push('研究评价模型未提供该主张的综合结论。');
        if (!evidence.some((entry) => entry.role === 'oppose')) claimNotes.push('本轮未识别到可逐字定位的反证正文；这只描述本次有限检索范围。');
        claimNotes.push('证据角色、理由和结论由模型依据共享的已读正文窗口整理，摘录已经程序逐字回查；仍需结合原网页语境审阅。');
        return {
          claim,
          evidence,
          limitations: [...new Set(limitations)],
          conclusion: evidence.length && conclusion
            ? conclusion.slice(0, 4_000)
            : '当前没有可逐字定位的正文证据支持自动结论。',
          notice: claimNotes.join(' '),
        };
      }),
    };
  }

  async function test(capability) {
    if (capability === 'model') {
      const result = await generate({ system: 'Return only OK.', prompt: 'Connection test.', privacy: 'cloud' });
      return { ok: true, capability, detail: result.text.slice(0, 100), usage: result.usage };
    }
    if (capability === 'embedding') {
      const result = await embed({ texts: ['connection test'], privacy: 'cloud' });
      return { ok: true, capability, dimensions: result.vectors[0]?.length ?? 0 };
    }
    if (capability === 'search') {
      const result = await search({ query: 'connection test', privacy: 'cloud' });
      return { ok: true, capability, resultCount: result.results.length };
    }
    if (capability === 'fetch') {
      const allSettings = await settings();
      const url = allSettings.fetch?.testUrl || 'https://example.com/';
      const result = await readPage({ url, privacy: 'cloud' });
      return { ok: true, capability, url: result.url, title: result.title };
    }
    throw fail('INVALID_CAPABILITY', '未知的外部能力。');
  }

  return { generate, embed, search, readPage, research, researchBatch, withBudget, test };
}
