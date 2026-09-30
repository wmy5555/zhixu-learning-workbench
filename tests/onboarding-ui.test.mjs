import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { chapters, flatSteps } from '../public/onboarding-curriculum.mjs';

const apiSource = await readFile(new URL('../public/api.mjs', import.meta.url), 'utf8');
const uiSource = await readFile(new URL('../public/ui.mjs', import.meta.url), 'utf8');
const onboardingSource = await readFile(new URL('../public/onboarding.mjs', import.meta.url), 'utf8');
const store = initial => {
  const values = new Map(Object.entries(initial || {}));
  return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key), values };
};
function apiBrowser(fetcher, initial = {}) {
  const sessionStorage = store(initial);
  const context = vm.createContext({ fetch: fetcher, Headers, URLSearchParams, sessionStorage });
  vm.runInContext(apiSource.replaceAll('export ', '') + '\nthis.surface = {api, request, startSession};', context);
  return { ...context.surface, sessionStorage };
}
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

test('practice requests use an explicit tab context while shared configuration and onboarding stay on main', async () => {
  const calls = [];
  const client = apiBrowser(async (path, options) => { calls.push({ path, options }); return response(path === '/api/session' ? { csrf: 'test-csrf' } : { ok: true }); });
  client.api.setContext('practice-one');
  await client.api.note('note-one');
  await client.api.import({ items: [{ title: '虚构练习', body: '合成内容' }] });
  await client.api.updateMainSettings({ ai: { apiKey: 'synthetic-only' } });
  await client.api.onboarding('checkpoint', { practiceId: 'practice-one', stepId: 'capture-save', mode: 'check' });
  assert.deepEqual(calls.map(call => call.path), ['/api/practice/practice-one/notes/note-one', '/api/session', '/api/practice/practice-one/import', '/api/settings', '/api/onboarding/checkpoint']);
  assert.equal(calls[2].options.headers.get('X-CSRF-Token'), 'test-csrf');
  assert.deepEqual([...client.sessionStorage.values.values()], ['practice-one']);
  assert.ok(![...client.sessionStorage.values.values()].some(value => value.includes('synthetic-only')));
});

test('a stored invalid practice identity fails explicitly and never retries against the real library', async () => {
  const paths = [];
  const client = apiBrowser(async path => { paths.push(path); return response({ error: '练习库不存在', code: 'PRACTICE_NOT_FOUND' }, 404); }, { 'zhixu.practiceContext.v1': 'missing-practice' });
  await assert.rejects(client.api.bootstrap(), error => error.code === 'PRACTICE_NOT_FOUND');
  assert.deepEqual(paths, ['/api/practice/missing-practice/bootstrap']);
  assert.equal(client.api.getContext().practiceId, 'missing-practice');
});

test('switching libraries is blocked while a request is in flight and becomes possible after completion', async () => {
  let finish;
  const client = apiBrowser(() => new Promise(resolve => { finish = resolve; }));
  client.api.setContext('practice-one');
  const pending = client.api.library();
  assert.throws(() => client.api.setContext(''), error => error.code === 'CONTEXT_BUSY');
  assert.equal(client.api.getContext().practiceId, 'practice-one');
  finish(response({ groups: [], standalone: [] }));
  await pending;
  client.api.setContext('');
  assert.equal(client.api.getContext().pending, 0);
  assert.equal(client.api.getContext().practiceId, '');
});

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.events = {}; this.dataset = {}; this.attributes = {};
    this.parentElement = null; this.hidden = false; this.value = ''; this.disabled = false; this._text = ''; this.className = '';
    this.classList = {
      add: name => { this.className = [...new Set([...this.className.split(' '), name])].join(' ').trim(); },
      remove: name => { this.className = this.className.split(' ').filter(value => value !== name).join(' '); },
      contains: name => this.className.split(' ').includes(name),
      toggle: (name, force) => { if (force ?? !this.classList.contains(name)) this.classList.add(name); else this.classList.remove(name); },
    };
  }
  set textContent(value) { this._text = String(value); this.replaceChildren(); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  append(...children) { for (const child of children) { if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(item => item !== child); child.parentElement = this; this.children.push(child); } }
  prepend(...children) { this.append(...children); this.children = [...children, ...this.children.filter(child => !children.includes(child))]; }
  replaceChildren(...children) { this.children.forEach(child => { child.parentElement = null; }); this.children = []; this.append(...children); }
  addEventListener(type, handler) { this.events[type] = handler; }
  setAttribute(name, value) { this.attributes[name] = value; }
  contains(target) { return target === this || this.children.some(child => child.contains(target)); }
  getClientRects() { return this.hidden ? [] : [{}]; }
  scrollIntoView() {}
  querySelectorAll(selector) { return descend(this).slice(1).filter(node => selector === '[data-tour]' ? node.dataset.tour : false); }
}
function descend(node) { return [node, ...node.children.flatMap(descend)]; }
function findButton(root, label) { return descend(root).find(node => node.tagName === 'BUTTON' && node.textContent === label); }
async function click(node) { assert.ok(node, 'button exists'); assert.equal(node.disabled, false, `button ${node.textContent} is enabled`); await node.events.click({ target: node, preventDefault() {} }); }

async function tutorialBrowser({ modelReady = true, exists = true, narrow = false, query = '' } = {}) {
  const body = new Element('body'), workspace = new Element(), main = new Element('main'), drawer = new Element(), drawerBody = new Element(), launcher = new Element('button');
  body.append(workspace, drawer, launcher); workspace.append(main); drawer.append(drawerBody);
  const roots = { '.workspace': workspace, '#main': main, '#drawer': drawer, '#drawer-body': drawerBody, '#onboarding-launcher': launcher };
  const document = { body, createElement: tag => new Element(tag), createTextNode: text => { const node = new Element('text'); node.textContent = text; return node; }, querySelector: selector => roots[selector] || null, querySelectorAll: selector => selector === '[data-tour]' ? descend(body).filter(node => node.dataset.tour) : [] };
  const requests = [], navigations = [], contexts = [];
  let practiceId = '', state = { practiceId: exists ? 'practice-one' : null, status: exists ? 'paused' : 'not_started', modelReady, progress: {}, roles: {}, clock: { now: '2026-09-30T08:00:00Z' }, busy: false };
  const api = {
    getContext: () => ({ practiceId, pending: 0 }),
    setContext: id => { practiceId = id; contexts.push(id); },
    onboarding: async (action, data = {}) => {
      requests.push({ action, data: structuredClone(data) });
      if (action === 'start' || action === 'resume') state = { ...state, practiceId: 'practice-one', status: 'active' };
      if (action === 'checkpoint') state.currentStepId = data.stepId;
      if (action === 'pause') state.status = 'paused';
      return structuredClone(state);
    },
  };
  const context = vm.createContext({ api, chapters, flatSteps, document, Node: Element, URLSearchParams, localStorage: store(), sessionStorage: store(), MutationObserver: class { observe() {} disconnect() {} },
    window: { location: { search: query }, matchMedia: () => ({ matches: narrow }), addEventListener() {}, setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {} },
  });
  const stripped = onboardingSource.replace(/^import .*;\s*$/gm, '').replaceAll('export ', '');
  vm.runInContext(uiSource.replaceAll('export ', '') + '\n' + stripped + '\nthis.make = createOnboarding; this.progress = getStepProgress;', context);
  const adapter = { navigate: async step => { navigations.push(step.id || step.view); }, contextChanged: async () => {}, refresh: async () => {}, fillSample: async () => {} };
  const tutorial = context.make(adapter); await tutorial.init();
  return { tutorial, body, workspace, main, drawer, drawerBody, requests, navigations, contexts, progress: context.progress, get state() { return state; }, setState: value => { state = { ...state, ...value }; } };
}

test('guide deep link only displays onboarding and does not create data or call an AI service', async () => {
  const ui = await tutorialBrowser({ exists: false, modelReady: false, query: '?onboarding=start' });
  assert.deepEqual(ui.requests.map(call => call.action), ['state']);
  assert.ok(findButton(ui.body, '创建独立练习库'));
  assert.equal(ui.contexts.length, 0);
  ui.tutorial.dispose();
});

test('AI gate prevents chapter two navigation and check cannot manufacture completed progress', async () => {
  const ui = await tutorialBrowser({ exists: false, modelReady: false });
  await click(findButton(ui.tutorial.entryCard(), '开始新手引导'));
  const capture = descend(ui.body).find(node => node.tagName === 'BUTTON' && node.textContent.includes(chapters[1].title.replace(/^\d+\.\s*/, '')));
  await click(capture);
  assert.ok(!ui.navigations.includes('capture-save'));
  assert.match(ui.body.textContent, /第一章保存 AI 配置并测试成功/);
  await click(findButton(ui.body, '检查这一步'));
  assert.equal(ui.state.progress['capture-save'], undefined);
  assert.match(ui.body.textContent, /尚未找到这一步的完成记录/);
  assert.equal(ui.requests.at(-1).data.mode, 'check');
  assert.ok(!('done' in ui.requests.at(-1).data));
  ui.tutorial.dispose();
});

test('each chapter persists the selected step before navigating, with real and demonstrated progress distinct', async () => {
  const ui = await tutorialBrowser();
  await ui.tutorial.open();
  for (const chapter of chapters) {
    const choice = descend(ui.body).find(node => node.tagName === 'BUTTON' && node.textContent.includes(chapter.title.replace(/^\d+\.\s*/, '')));
    await click(choice);
    assert.equal(ui.requests.at(-1).action, 'checkpoint');
    assert.equal(ui.requests.at(-1).data.stepId, chapter.steps[0].id);
    assert.equal(ui.navigations.at(-1), chapter.steps[0].id);
  }
  assert.equal(ui.progress({ progress: { a: { status: 'demonstrated' } } }, { id: 'a' }).label, '已看案例');
  assert.equal(ui.progress({ progress: { a: { status: 'needs_setup' } } }, { id: 'a' }).complete, false);
  ui.tutorial.dispose();
});

test('narrow-screen instructions move into the drawer in normal flow and return on close', async () => {
  const ui = await tutorialBrowser({ narrow: true });
  await ui.tutorial.open();
  const panel = descend(ui.workspace).find(node => node.classList.contains('onboarding-panel'));
  ui.drawer.classList.add('is-open'); ui.tutorial.rendered();
  assert.equal(panel.parentElement, ui.drawerBody);
  ui.drawer.classList.remove('is-open'); ui.tutorial.rendered();
  assert.equal(panel.parentElement, ui.workspace);
  ui.tutorial.dispose();
});

test('dismissing the first-use card leaves a compact entry and existing practice offers restart', async () => {
  const fresh = await tutorialBrowser({ exists: false });
  assert.match(fresh.tutorial.entryCard().textContent, /先配置 AI/);
  await click(findButton(fresh.tutorial.entryCard(), '暂时关闭提示'));
  const compact = fresh.tutorial.entryCard();
  assert.ok(compact.classList.contains('onboarding-entry-compact'));
  assert.doesNotMatch(compact.textContent, /第一次使用|先配置 AI/);
  assert.ok(findButton(compact, '开始新手引导'));
  fresh.tutorial.dispose();
  const active = await tutorialBrowser();
  assert.ok(findButton(active.tutorial.entryCard(), '继续新手引导'));
  assert.ok(findButton(active.tutorial.entryCard(), '重新练习'));
  active.tutorial.dispose();
});

test('external experience summary distinguishes call evidence from self-reported experience', async () => {
  const ui = await tutorialBrowser();
  ui.setState({ externalConnections: { mcp: { status: 'observed', lastSeenAt: '2026-09-30T08:00:00Z' }, obsidian: { status: 'reported', editReported: false } } });
  await ui.tutorial.open();
  await click(descend(ui.body).find(node => node.tagName === 'BUTTON' && node.textContent.includes(chapters.at(-1).title.replace(/^\d+\.\s*/, ''))));
  assert.match(ui.body.textContent, /发现正式通道调用记录/);
  assert.match(ui.body.textContent, /不等于此刻在线/);
  assert.match(ui.body.textContent, /用户确认已打开；外部编辑待体验/);
  ui.tutorial.dispose();
});
