import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchPage } from '../public/web/search-page.mjs';

const pageOf = (title, nextCursor = null) => ({
  results: [{ id: title, title }],
  diagnostics: { mode: 'keyword' },
  nextCursor,
});

function harness(t, respond) {
  const requests = [];
  const mode = { value: 'semantic', options: ['keyword', 'semantic', 'hybrid'].map(value => ({ value })) };
  const cloud = { checked: false };
  const form = {
    elements: { mode, cloud, q: { value: '' } },
    requestSubmit() {
      return this.submit({ q: this.elements.q.value, cloud: cloud.checked ? 'on' : undefined });
    },
  };
  const paginationHTML = '<button class="text-button" data-more>加载下一页</button>';
  const more = { setAttribute() {}, removeAttribute() {}, remove() { results.innerHTML = results.innerHTML.replace(paginationHTML, ''); } };
  const results = {
    innerHTML: '',
    isConnected: true,
    querySelector(selector) {
      assert.equal(selector, '[data-more]');
      return this.innerHTML.includes(paginationHTML) ? more : null;
    },
    insertAdjacentHTML(position, html) {
      assert.equal(position, 'beforeend');
      this.innerHTML += html;
    },
  };
  const browser = { sequence: 1, navigation: true, mounted: true };
  const document = { querySelector: selector => ({
    '#parity-search': browser.mounted ? form : null,
    '#parity-results': results,
  })[selector] };
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  t.after(() => {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globalThis.document;
  });
  const search = createSearchPage({
    api: { get: path => {
      const url = new URL(path, 'http://localhost');
      assert.equal(url.pathname, '/api/search');
      const query = Object.fromEntries(url.searchParams);
      requests.push(query);
      return respond(query);
    } },
    getNotes: () => [{ id: 'source', title: '合成原文', kind: 'source' }, { id: 'note', title: '合成知识', kind: 'knowledge' }],
    getSequence: () => browser.sequence,
    go: async route => {
      assert.equal(route, 'search');
      return browser.navigation;
    },
    submit: (boundForm, handler) => {
      assert.equal(boundForm, form);
      form.submit = handler;
    },
  });
  const page = search.page();
  page.bind();
  return { search, page, form, mode, cloud, more, results, requests, browser };
}

test('closing semantic consent disables both modes, resets the selection and submits locally', async t => {
  const h = harness(t, () => pageOf('合成结果'));
  assert.match(h.page.html, /<option value="source" >合成原文<\/option>/);
  assert.doesNotMatch(h.page.html, /合成知识/);
  assert.deepEqual(h.mode.options.map(option => option.disabled), [false, true, true]);
  h.cloud.checked = true;
  h.cloud.onchange();
  assert.deepEqual(h.mode.options.map(option => option.disabled), [false, false, false]);
  h.mode.value = 'hybrid';
  await h.form.submit({ q: '合成查询', cloud: 'on', source: 'source' });
  h.cloud.checked = false;
  h.cloud.onchange();
  assert.equal(h.mode.value, 'keyword');
  assert.deepEqual(h.mode.options.map(option => option.disabled), [false, true, true]);
  await h.form.submit({ q: '合成查询', mode: 'hybrid', cloud: 'on', source: 'source' });
  assert.deepEqual(h.requests, [
    { q: '合成查询', mode: 'hybrid', privacy: 'cloud', limit: '20', source: 'source' },
    { q: '合成查询', mode: 'keyword', privacy: 'local', limit: '20', source: 'source' },
  ]);
});

test('a failed fresh search leaves the previous result page and its query and cursor available', async t => {
  const h = harness(t, async ({ q, cursor }) => {
    if (q === '失效的检索') throw Error('合成错误');
    return cursor ? pageOf('第二页') : pageOf('第一页', 'fixed-cursor');
  });
  const filters = { q: '原查询', kind: 'knowledge', stage: 'candidate', topic: '主题', from: '2026-01-01', to: '2026-02-01' };
  await h.form.submit(filters);
  await assert.rejects(h.form.submit({ q: '失效的检索' }), /合成错误/);
  assert.match(h.results.innerHTML, /第一页/);
  await h.more.onclick({ currentTarget: h.more });
  assert.deepEqual(h.requests.at(-1), { ...filters, mode: 'keyword', privacy: 'local', limit: '20', cursor: 'fixed-cursor' });
  assert.match(h.results.innerHTML, /第一页[\s\S]*第二页/);
  assert.doesNotMatch(h.results.innerHTML, /data-more/);
});

test('superseded queries and answers arriving after navigation cannot write results', async t => {
  const first = Promise.withResolvers(), departed = Promise.withResolvers();
  const h = harness(t, ({ q }) => q === '旧查询' ? first.promise : q === '离开前' ? departed.promise : pageOf('新结果'));
  const older = h.form.submit({ q: '旧查询' });
  await h.form.submit({ q: '新查询' });
  first.resolve(pageOf('旧结果'));
  await older;
  assert.match(h.results.innerHTML, /新结果/);
  const beforeLeave = h.form.submit({ q: '离开前' });
  h.browser.sequence++;
  departed.resolve(pageOf('离开后的结果'));
  await beforeLeave;
  assert.match(h.results.innerHTML, /新结果/);
  assert.doesNotMatch(h.results.innerHTML, /旧结果|离开后的结果/);
});

test('a sidebar topic submits only after search navigation succeeds and the form is mounted', async t => {
  const h = harness(t, async ({ q }) => pageOf(q));
  await h.search.openQuery('侧栏合成主题');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.form.elements.q.value, '侧栏合成主题');
  assert.deepEqual(h.requests, [{ q: '侧栏合成主题', mode: 'keyword', privacy: 'local', limit: '20' }]);
  h.browser.navigation = false;
  await h.search.openQuery('被拦住的主题');
  h.browser.navigation = true;
  h.browser.mounted = false;
  await h.search.openQuery('尚未挂载的主题');
  assert.equal(h.requests.length, 1);
});
