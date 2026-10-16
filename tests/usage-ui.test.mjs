import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { buildUsageReport } from '../src/usage.mjs';
import { createAI } from '../src/ai.mjs';

const uiSource = await readFile(new URL('../public/ui.mjs', import.meta.url), 'utf8');
const usageSource = await readFile(new URL('../public/usage.mjs', import.meta.url), 'utf8');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.events = {}; this.attributes = {};
    this.value = ''; this.type = ''; this.name = ''; this.disabled = false; this.checked = false;
    this.open = false; this.dataset = {}; this.style = {}; this._text = '';
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent ?? String(child)).join(''); }
  append(...children) { this.children.push(...children.map(child => { if (child instanceof Element) return child; const text = new Element('text'); text.textContent = String(child); return text; })); }
  prepend(...children) { this.children.unshift(...children); }
  replaceChildren(...children) { this._text = ''; this.children = []; this.append(...children); }
  addEventListener(name, handler) { this.events[name] = handler; }
  setAttribute(name, value) { this.attributes[name] = value; }
  querySelectorAll(selector) { return descendants(this).slice(1).filter(node => matches(node, selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  focus() {}
  click() { this.clicked = true; }
  remove() {}
  cloneNode() { return this; }
}
function descendants(node) { return [node, ...node.children.flatMap(child => child instanceof Element ? descendants(child) : [])]; }
function matches(node, selector) {
  const match = selector.match(/^(\w+)(?:\[([^=]+)=['"]([^'"]+)['"]\])?$/);
  return Boolean(match && node.tagName === match[1] && (!match[2] || node[match[2]] === match[3]));
}
function findButton(node, text) { return descendants(node).find(item => item.tagName === 'button' && item.textContent === text); }
function control(node, name) { return descendants(node).find(item => item.name === name); }
const click = node => node.events.click({ target: node, preventDefault() {} });
const plain = value => JSON.parse(JSON.stringify(value));

function browser(api = {}) {
  const roots = new Map();
  const document = {
    body: new Element('body'),
    createElement: tag => new Element(tag),
    createTextNode: value => new Element('text'),
    querySelector(selector) { if (!roots.has(selector)) roots.set(selector, new Element()); return roots.get(selector); },
    addEventListener() {},
  };
  document.createTextNode = value => { const node = new Element('text'); node.textContent = value; return node; };
  const context = vm.createContext({
    api, document, Node: Element, Blob, URL: { createObjectURL(blob) { api.onExport?.(blob); return 'blob:synthetic-export'; }, revokeObjectURL() {} }, Intl, Date, Map, Set, crypto: { randomUUID: () => 'request-ui' },
    FormData: class {
      constructor(form) { this.form = form; }
      entries() { return descendants(this.form).filter(node => node.name && !node.disabled && ['input', 'textarea', 'select'].includes(node.tagName)).map(node => [node.name, String(node.tagName === 'textarea' ? node.textContent : node.tagName === 'select' ? node.children.find(option => option.selected)?.value || '' : node.value)]); }
    },
    ApiError: class extends Error {}, startSession: async () => {},
    window: { history: { replaceState() {} }, location: { hash: '' }, setTimeout() {}, addEventListener() {} },
  });
  vm.runInContext(uiSource.replaceAll('export ', '') + '\n' + usageSource.replace(/^import.*;$/m, '').replaceAll('export ', '') + '\nthis.app = {createUsagePanel};', context);
  return context.app;
}

const settings = { ai: { model: 'alpha', baseUrl: 'https://example.org/v1', dailyCallLimit: 20, monthlyBudget: 5, inputPrice: 2 }, embedding: {}, search: {} };
function report(options = {}) {
  return { ...buildUsageReport([{ createdAt: '2026-10-02T00:00:00Z', capability: 'model', model: '<script>bad()</script>', inputTokens: 100, outputTokens: 20, cost: null }], { at: new Date('2026-10-02T12:00:00Z') }), budget: { callsToday: 4, dailyCallLimit: 20, monthlyBudget: 5, costMonth: null, knownCostMonth: 1, unknownCostCalls: 1 }, ...options };
}

test('unknown calls require explicit acknowledgement and a reason without triggering a retry', async () => {
  const app = browser(), calls = [];
  const pending = [{ id: 'unknown-call', phase: 'unknown', capability: 'model', model: '<script>synthetic</script>', hasResult: false }];
  const panel = await app.createUsagePanel({ load: async () => report(), settings, save: async () => {}, loadRecovery: async () => ({ pending }), recoverCall: async (...args) => calls.push(plain(args)) });
  assert.equal(calls.length, 0);
  assert.match(panel.textContent, /外部调用已暂停/);
  assert.equal(descendants(panel).some(node => node.tagName === 'script'), false);
  const submit = findButton(panel, '记录核对结果，不重发');
  const form = descendants(panel).find(node => node.tagName === 'form' && node.children.includes(submit));
  assert.equal(submit.disabled, true);
  await form.events.submit({ preventDefault() {} });
  assert.equal(calls.length, 0);
  control(form, 'confirmationReason').value = '已核对，供应商暂未提供结算金额。';
  const checkbox = control(form, 'checkedProvider'); checkbox.checked = true; checkbox.events.change();
  await form.events.submit({ preventDefault() {} });
  assert.deepEqual(calls, [['unknown-call', { action: 'confirm', cost: null, reason: '已核对，供应商暂未提供结算金额。' }]]);
});

test('received-result recovery is local, prevents double clicks, and practice cannot modify it', async () => {
  const app = browser(); let finish, count = 0;
  const options = { load: async () => report(), settings, save: async () => {}, loadRecovery: async () => ({ pending: [{ id: 'received-call', hasResult: true, phase: 'received' }] }), recoverCall: async (id, payload) => { assert.equal(id, 'received-call'); assert.equal(payload.action, 'recover'); count++; await new Promise(resolve => { finish = resolve; }); } };
  const panel = await app.createUsagePanel(options);
  const action = findButton(panel, '补记已收到的结果');
  const work = click(action); assert.equal(action.disabled, true); assert.equal(count, 1); finish(); await work;
  const practice = await app.createUsagePanel({ ...options, readOnly: true });
  assert.equal(findButton(practice, '补记已收到的结果'), undefined);
  assert.match(practice.textContent, /请返回正式库/);
});

test('dashboard labels incomplete costs, renders model names as text and saves only cost settings', async () => {
  const app = browser(), saves = [], requests = [];
  const panel = await app.createUsagePanel({ load: async query => { requests.push(query); return report(); }, settings, save: async data => saves.push(data) });
  assert.match(panel.textContent, /0 \+ 未知/); assert.match(panel.textContent, /缓存输入/);
  assert.equal(descendants(panel).some(node => node.tagName === 'script'), false);
  assert.match(panel.textContent, /<script>bad\(\)<\/script>/);
  const form = descendants(panel).find(node => node.tagName === 'form');
  control(panel, 'sourceCallLimit').value = '180'; control(panel, 'monthlyBudget').value = '9'; control(panel, 'inputPrice').value = '';
  await form.events.submit({ preventDefault() {} });
  assert.equal(saves[0].ai.sourceCallLimit, 180); assert.equal(saves[0].ai.monthlyBudget, 9); assert.equal(saves[0].ai.inputPrice, null);
  assert.deepEqual(Object.keys(saves[0]).sort(), ['ai', 'embedding', 'pricingCatalog', 'pricingFor', 'search']);
  assert.equal(saves[0].pricingFor.ai.model, 'alpha'); assert.equal(requests.length, 2);
  assert.match(panel.textContent, /新单价从后续请求开始生效/);
});

test('practice disables cost changes; failed statistics cannot export previous data', async () => {
  const app = browser(); let fail = false, saves = 0;
  const panel = await app.createUsagePanel({ load: async () => { if (fail) throw new Error('offline'); return report({ sharedUsage: true }); }, settings, readOnly: true, save: async () => saves++ });
  assert.equal(findButton(panel, '保存预算与单价').disabled, true);
  const form = descendants(panel).find(node => node.tagName === 'form');
  await form.events.submit({ preventDefault() {} }); assert.equal(saves, 0);
  fail = true; await click(findButton(panel, '刷新统计'));
  assert.equal(findButton(panel, '导出统计').disabled, true); assert.match(panel.textContent, /暂时无法读取统计/);
});

test('latest filter response wins when earlier statistics return late', async () => {
  const app = browser(); let delayed, reads = 0;
  const panel = await app.createUsagePanel({ load: async () => { reads++; if (reads === 2) return new Promise(resolve => { delayed = resolve; }); return report({ from: reads === 3 ? '2026-10-01' : '2026-09-01' }); }, settings, save: async () => {} });
  const first = click(findButton(panel, '刷新统计')); await click(findButton(panel, '刷新统计'));
  delayed(report({ from: '2000-01-01' })); await first;
  assert.equal(panel.textContent.includes('2000-01-01'), false);
});

test('export serializes the currently displayed accounting report with no source content', async () => {
  let exported;
  const app = browser({ onExport: blob => { exported = blob; } });
  const input = report();
  const panel = await app.createUsagePanel({ load: async () => input, settings, save: async () => {} });
  await click(findButton(panel, '导出统计'));
  const actual = JSON.parse(await exported.text());
  assert.deepEqual(actual.totals, input.totals); assert.deepEqual(actual.filters, input.filters);
  assert.equal(actual.from, input.from); assert.equal(actual.recentLimit, 100);
  assert.equal(actual.resultScope, 'transport');
  assert.equal(Object.hasOwn(actual.recentCalls[0], 'sourceId'), false);
});

test('HTTP 200 with invalid provider content is labelled as transport success, never operation success', async () => {
  const calls = [];
  const cases = [
    ['generate', '{invalid', 200, 'INVALID_RESPONSE'],
    ['generate', { choices: [{ message: { content: '' }, finish_reason: 'stop' }] }, 200, 'INVALID_RESPONSE'],
    ['generate', { choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }, 200, 'MODEL_TRUNCATED'],
    ['embed', { data: [] }, 200, 'INVALID_RESPONSE'],
    ['search', { results: null }, 200, 'INVALID_RESPONSE'],
    ['generate', { error: { message: 'synthetic rejection' } }, 401, 'PROVIDER_ERROR'],
  ];
  for (const [method, payload, status, code] of cases) {
    const config = { enabled: true, baseUrl: 'https://8.8.8.8/v1', model: 'synthetic' };
    const ai = createAI({
      getSettings: () => ({ ai: { ...config, dailyCallLimit: 20, monthlyBudget: 0 }, embedding: config, search: config }),
      getSecret: () => 'synthetic-test-secret', getUsage: () => ({ callsToday: 0, costMonth: 0 }),
      recordCall: call => calls.push({ ...call, createdAt: '2026-10-02T00:00:00Z' }),
      fetchImpl: async () => new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }),
    });
    await assert.rejects(ai[method]({ prompt: 'synthetic', texts: ['synthetic'], query: 'synthetic', privacy: 'cloud' }), { code });
  }
  assert.equal(calls.length, cases.length);
  assert.equal(calls.filter(call => call.ok).length, 5, 'Transport ledger deliberately precedes content validation');
  const data = report(buildUsageReport(calls, { at: new Date('2026-10-02T12:00:00Z') }));
  assert.equal(data.totals.failedCalls, 1);
  const panel = await browser().createUsagePanel({ load: async () => data, settings, save: async () => {} });
  assert.match(panel.textContent, /1 次连接或 HTTP 失败/);
  assert.match(panel.textContent, /不代表生成、解析或校验成功/);
  const cells = descendants(panel).filter(node => node.tagName === 'td').map(node => node.textContent);
  assert.equal(cells.filter(text => text === 'HTTP 响应成功').length, 5);
  assert.equal(cells.filter(text => text === '连接或 HTTP 失败').length, 1);
  assert.equal(cells.some(text => text === '成功' || text === '失败'), false);
});

test('positive sub-micro costs remain distinct from free calls in tables, trends and budgets', async () => {
  const calls = [
    { model: 'tiny-paid', cost: .0000001 }, { model: 'explicit-free', cost: 0 },
  ].map(call => ({ ...call, capability: 'model', inputTokens: 1, outputTokens: 0, createdAt: '2026-10-02T00:00:00Z', ok: true }));
  const data = report({ ...buildUsageReport(calls, { at: new Date('2026-10-02T12:00:00Z') }), budget: { callsToday: 2, dailyCallLimit: 20, monthlyBudget: 5, costMonth: .0000001, knownCostMonth: .0000001, unknownCostCalls: 0 } });
  const panel = await browser().createUsagePanel({ load: async () => data, settings, save: async () => {} });
  const cells = descendants(panel).filter(node => node.tagName === 'td').map(node => node.textContent);
  assert.equal(cells.filter(text => text.startsWith('< 0.000001 ')).length, 3, 'Daily, model and recent-request costs stay visibly positive');
  const freeRows = descendants(panel).filter(node => node.tagName === 'tr' && node.textContent.includes('explicit-free'));
  assert.equal(freeRows.length, 2);
  assert.equal(freeRows.find(row => row.children[0].textContent.includes('explicit-free')).children[4].textContent, '0 币种未确认');
  assert.equal(freeRows.find(row => row.children[1].textContent === 'explicit-free').children[3].textContent, '0 币种未确认 · legacy_manual');
  assert.match(panel.textContent, /< 0\.000001 \/ 5/);
  await click(findButton(panel, '费用'));
  const paidDay = descendants(panel).find(node => node.attributes.role === 'listitem' && node.attributes['aria-label']?.startsWith('2026-10-02'));
  assert.match(paidDay.attributes['aria-label'], /< 0\.000001/);
  assert.equal(data.totals.knownCost, .0000001, 'Formatting never rounds ledger/export amounts');
});

test('mixed-currency dashboard separates amounts, hides combined fee trend and preserves unknown price labels', async () => {
  const calls = [{ currency: 'USD', cost: 2 }, { currency: 'CNY', cost: 3 }].map(row => ({ ...row, capability: 'model', model: 'alpha', createdAt: '2026-10-02T00:00:00Z' }));
  const data = report({ ...buildUsageReport(calls, { at: new Date('2026-10-02T12:00:00Z') }), pricing: { enabled: true, stale: true, fetchedAt: null, lastError: 'PRICE_CATALOG_INVALID', current: { ai: { source: 'unknown', status: 'unknown', identity: { model: '<script>synthetic</script>', currency: null }, limitations: ['exact_identity_not_found'] } } } });
  const panel = await browser().createUsagePanel({ load: async () => data, settings, save: async () => {} });
  assert.match(panel.textContent, /按币种分列/); assert.match(panel.textContent, /2 USD；3 CNY/);
  assert.equal(findButton(panel, '费用'), undefined);
  assert.match(panel.textContent, /更新失败，保留上次成功目录/); assert.match(panel.textContent, /未知\/部分覆盖/);
  assert.equal(descendants(panel).some(node => node.tagName === 'script'), false);
});

test('price refresh suppresses duplicate clicks and is disabled in practice or when auto update is off', async () => {
  let finish, requests = 0;
  const pricing = { enabled: true, stale: true, current: {} };
  const refreshPricing = async () => { requests++; await new Promise(resolve => { finish = resolve; }); };
  const options = { load: async () => report({ pricing }), settings, save: async () => {}, refreshPricing };
  const panel = await browser().createUsagePanel(options), control = findButton(panel, '更新公开价格');
  const pending = click(control); await click(control); assert.equal(requests, 1); assert.equal(control.disabled, true);
  finish(); await pending;
  for (const changes of [{ readOnly: true }, { load: async () => report({ pricing: { ...pricing, enabled: false } }) }]) {
    const disabled = await browser().createUsagePanel({ ...options, ...changes });
    assert.equal(findButton(disabled, '更新公开价格').disabled, true);
  }
});

test('budget currency mismatch never relabels spending or displays a comparable progress balance', async () => {
  for (const currency of ['USD', null]) {
    const data = report({ budget: { callsToday: 1, dailyCallLimit: 20, monthlyBudget: 100, budgetCurrency: 'CNY', currency, comparable: false, costMonth: 5, knownCostMonth: 5, unknownCostCalls: 0, byCurrency: [{ currency, knownCost: 5, unknownCostCalls: 0 }] } });
    const panel = await browser().createUsagePanel({ load: async () => data, settings, save: async () => {} });
    assert.match(panel.textContent, /月预算无法比较/); assert.match(panel.textContent, /100 CNY；费用币种不一致/);
    assert.match(panel.textContent, currency ? /本月已记录：5 USD/ : /本月已记录：5 币种未确认/);
    assert.equal(descendants(panel).filter(node => node.tagName === 'progress').length, 1, 'Only the independent daily call-count progress is comparable');
  }
});

test('accounted stale price review explains immutable estimate and submits separate amount/currency confirmation', async () => {
  const calls = [], app = browser();
  const panel = await app.createUsagePanel({ load: async () => report(), settings, save: async () => {}, loadRecovery: async () => ({ pending: [{ id: 'stale-price', phase: 'accounted', pricingReview: true, estimatedCost: .2, currency: 'USD' }] }), recoverCall: async (...args) => calls.push(plain(args)) });
  assert.match(panel.textContent, /过期估算待核对/); assert.match(panel.textContent, /原估算和价格快照保留/);
  const submit = findButton(panel, '记录核对结果，不重发');
  const form = descendants(panel).find(node => node.tagName === 'form' && node.children.includes(submit));
  control(form, 'confirmedCost').value = '.3'; control(form, 'confirmedCurrency').value = 'USD'; control(form, 'confirmationReason').value = '核对合成账单';
  const checked = control(form, 'checkedProvider'); checked.checked = true; checked.events.change();
  await form.events.submit({ preventDefault() {} });
  assert.deepEqual(calls, [['stale-price', { action: 'confirm-price', cost: .3, currency: 'USD', reason: '核对合成账单' }]]);
});
