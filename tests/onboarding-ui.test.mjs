import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { chapters, flatSteps, coreChapters, coreSteps, extensionChapters } from '../public/onboarding-curriculum.mjs';

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
    this.parentElement = null; this.hidden = false; this.open = false; this.value = ''; this.disabled = false; this._text = ''; this.className = '';
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

async function tutorialBrowser({ modelReady = true, exists = true, narrow = false, query = '', checkpoint, currentStepId, savedStepId, progress = {} } = {}) {
  const body = new Element('body'), workspace = new Element(), main = new Element('main'), drawer = new Element(), drawerBody = new Element(), launcher = new Element('button');
  body.append(workspace, drawer, launcher); workspace.append(main); drawer.append(drawerBody);
  const roots = { '.workspace': workspace, '#main': main, '#drawer': drawer, '#drawer-body': drawerBody, '#onboarding-launcher': launcher };
  const document = { body, createElement: tag => new Element(tag), createTextNode: text => { const node = new Element('text'); node.textContent = text; return node; }, querySelector: selector => roots[selector] || null, querySelectorAll: selector => selector === '[data-tour]' ? descend(body).filter(node => node.dataset.tour) : [] };
  const requests = [], navigations = [], contexts = [], intervals = [];
  let practiceId = '', state = { practiceId: exists ? 'practice-one' : null, status: exists ? 'paused' : 'not_started', modelReady, currentStepId, progress, roles: {}, clock: { now: '2026-09-30T08:00:00Z' }, busy: false };
  const api = {
    getContext: () => ({ practiceId, pending: 0 }),
    setContext: id => { practiceId = id; contexts.push(id); },
    onboarding: async (action, data = {}) => {
      requests.push({ action, data: structuredClone(data) });
      if (action === 'start' || action === 'resume') state = { ...state, practiceId: 'practice-one', status: 'active' };
      if (action === 'checkpoint') {
        if (checkpoint) await checkpoint(data, state);
        if (data.mode === 'read') state.progress[data.stepId] = { status: 'demonstrated' };
        state.currentStepId = data.stepId;
      }
      if (action === 'pause') state.status = 'paused';
      return structuredClone(state);
    },
  };
  const context = vm.createContext({ api, chapters, flatSteps, coreChapters, coreSteps, extensionChapters, document, Node: Element, URLSearchParams, localStorage: store(), sessionStorage: store(savedStepId ? { 'zhixu.onboarding.currentStep.v1': savedStepId } : {}), MutationObserver: class { observe() {} disconnect() {} },
    window: { location: { search: query }, matchMedia: () => ({ matches: narrow }), addEventListener() {}, setTimeout() {}, clearTimeout() {}, setInterval(handler) { intervals.push(handler); }, clearInterval() {} },
  });
  const stripped = onboardingSource.replace(/^import .*;\s*$/gm, '').replaceAll('export ', '');
  vm.runInContext(uiSource.replaceAll('export ', '') + '\n' + stripped + '\nthis.make = createOnboarding; this.progress = getStepProgress;', context);
  const adapter = { navigate: async step => { navigations.push(step.id || step.view); }, contextChanged: async () => {}, refresh: async () => {}, fillSample: async () => {} };
  const tutorial = context.make(adapter); await tutorial.init();
  return { tutorial, body, workspace, main, drawer, drawerBody, requests, navigations, contexts, intervals, progress: context.progress, get state() { return state; }, setState: value => { state = { ...state, ...value }; } };
}

test('reading confirmation waits for saving, then navigates exactly one step without completing the next action', async () => {
  let release;
  const ui = await tutorialBrowser({ checkpoint: async data => {
    if (data.mode === 'read') await new Promise(resolve => { release = resolve; });
  } });
  await ui.tutorial.open();
  const first = flatSteps[0], next = flatSteps[1];
  const pending = click(findButton(ui.body, '我已阅读'));
  assert.equal(ui.state.currentStepId, first.id, 'stay on the current step while saving');
  assert.equal(ui.navigations.at(-1), first.id);
  assert.equal(findButton(ui.body, '我已阅读').disabled, true);
  release(); await pending;
  assert.equal(ui.state.progress[first.id].status, 'demonstrated');
  assert.equal(ui.state.currentStepId, next.id);
  assert.equal(ui.navigations.at(-1), next.id);
  assert.equal(ui.state.progress[next.id], undefined, 'navigation cannot manufacture completion');
  assert.deepEqual(ui.requests.filter(call => call.action === 'checkpoint').map(call => [call.data.stepId, call.data.mode]), [[first.id, 'check'], [first.id, 'read'], [next.id, 'check']]);
  const secondReading = click(findButton(ui.body, '我已阅读'));
  release(); await secondReading;
  const actionStep = flatSteps[2];
  assert.equal(actionStep.kind, 'action');
  assert.equal(ui.navigations.at(-1), actionStep.id);
  assert.equal(ui.state.progress[actionStep.id], undefined);
  ui.setState({ progress: { ...ui.state.progress, [actionStep.id]: { status: 'done' } } });
  await ui.tutorial.refresh();
  const actionNavigationCount = ui.navigations.length;
  await click(findButton(ui.body, '检查这一步'));
  assert.equal(ui.navigations.length, actionNavigationCount, 'checking an action does not auto-advance');
  assert.equal(ui.state.currentStepId, actionStep.id);
  ui.tutorial.dispose();
});

test('failed reading confirmation stays on the same step and can be retried explicitly', async () => {
  let failed = true;
  const ui = await tutorialBrowser({ checkpoint: async data => { if (data.mode === 'read' && failed) throw new Error('阅读确认未保存，请重试'); } });
  await ui.tutorial.open();
  const originalNavigationCount = ui.navigations.length;
  await click(findButton(ui.body, '我已阅读'));
  assert.equal(ui.navigations.length, originalNavigationCount);
  assert.equal(ui.state.currentStepId, flatSteps[0].id);
  assert.equal(ui.state.progress[flatSteps[0].id], undefined);
  assert.match(ui.body.textContent, /阅读确认未保存，请重试/);
  failed = false;
  await click(findButton(ui.body, '我已阅读'));
  assert.equal(ui.state.currentStepId, flatSteps[1].id);
  ui.tutorial.dispose();
});

test('queued jobs keep polling the emitted state field and refresh tutorial evidence on completion', async () => {
  const ui = await tutorialBrowser();
  await ui.tutorial.open();
  ui.setState({ busy: false, jobs: [{ id: 'queued-job', state: 'queued' }] });
  await ui.tutorial.refresh();
  const before = ui.requests.length;
  ui.setState({ jobs: [{ id: 'queued-job', state: 'done' }], progress: { 'capture-process': { status: 'done' } } });
  ui.intervals[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.requests.length, before + 1);
  assert.equal(ui.tutorial.state.progress['capture-process'].status, 'done');
  ui.intervals[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.requests.length, before + 1, 'completed jobs do not trigger ongoing polling');
  ui.tutorial.dispose();
});

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
  const capture = descend(ui.body).find(node => node.tagName === 'BUTTON' && node.textContent.startsWith(coreChapters[1].title));
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
  for (const chapter of [...coreChapters, ...extensionChapters]) {
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

test('first-use next and reading navigation stay on the core route without completing skipped actions', async () => {
  const ui = await tutorialBrowser({ exists: false });
  assert.match(ui.tutorial.entryCard().textContent, /先走通核心学习流程/);
  await click(findButton(ui.tutorial.entryCard(), '开始新手引导'));
  assert.equal(descend(ui.body).find(node => node.classList.contains('onboarding-extensions')).open, false);
  for (const [index, step] of coreSteps.entries()) {
    assert.equal(ui.state.currentStepId, step.id);
    assert.match(ui.body.textContent, new RegExp(`核心流程 · 当前第 ${index + 1}/${coreSteps.length} 步`));
    if (index === coreSteps.length - 1) break;
    await click(findButton(ui.body, step.kind === 'read' ? '我已阅读' : '先看下一步'));
  }
  assert.deepEqual(ui.navigations, coreSteps.map(step => step.id));
  assert.ok(!ui.requests.some(call => ['case', 'test', 'advance'].includes(call.action)));
  assert.ok(!ui.requests.some(call => flatSteps.find(step => step.id === call.data.stepId)?.priority === 'extension'));
  assert.doesNotMatch(ui.body.textContent, /核心流程已完成/);
  assert.equal(findButton(ui.body, '完成体验，回正式库'), undefined);
  await click(findButton(ui.body, '继续核心流程'));
  assert.equal(ui.state.currentStepId, 'setup-save', 'return to the first action without completion evidence');
  assert.equal(ui.state.progress['setup-save'], undefined);
  ui.tutorial.dispose();
});

test('an optional topic is chosen explicitly and its last reading does not enroll another topic', async () => {
  const ui = await tutorialBrowser();
  await ui.tutorial.open();
  const topic = extensionChapters.find(chapter => chapter.id === 'setup');
  await click(descend(ui.body).find(node => node.tagName === 'BUTTON' && node.textContent.includes(`${topic.title.replace(/^\d+\.\s*/, '')} · 可选`)));
  assert.equal(ui.state.currentStepId, 'setup-preferences');
  assert.match(ui.body.textContent, /扩展阅读（可选） · 当前第 1\/2 步/);
  await click(findButton(ui.body, '先看下一步'));
  assert.equal(ui.state.currentStepId, 'setup-storage');
  await click(findButton(ui.body, '我已阅读'));
  assert.equal(ui.state.currentStepId, 'setup-storage');
  assert.match(ui.body.textContent, /核心完成进度：0\/28/);
  await click(findButton(ui.body, '返回核心流程'));
  assert.equal(ui.state.currentStepId, 'setup-welcome');
  ui.tutorial.dispose();
});

test('selected position, completed core count and chapter count stay independent when revisiting steps', async () => {
  const ui = await tutorialBrowser({ progress: {
    'setup-welcome': { status: 'demonstrated' }, 'setup-model': { status: 'demonstrated' }, 'setup-save': { status: 'done' },
    'backup-download': { status: 'done' },
  } });
  await ui.tutorial.open();
  assert.match(ui.body.textContent, /核心流程 · 当前第 1\/28 步/);
  assert.match(ui.body.textContent, /核心完成进度：3\/28 步/);
  assert.ok(findButton(ui.body, '1. 配好 AI · 已完成 3/5 步'));
  await click(findButton(ui.body, '3. 学习并确认理解 · 已完成 0/9 步'));
  assert.match(ui.body.textContent, /核心流程 · 当前第 12\/28 步/);
  assert.match(ui.body.textContent, /核心完成进度：3\/28 步/);
  await click(findButton(ui.body, '1. 配好 AI · 已完成 3/5 步'));
  assert.match(ui.body.textContent, /核心流程 · 当前第 1\/28 步/);
  assert.match(ui.body.textContent, /核心完成进度：3\/28 步/);
  assert.ok(findButton(ui.body, '维护与备份 · 可选 · 已完成 1/13 步'));
  ui.tutorial.dispose();
});

test('core completion ignores optional setup, preserves evidence, and offers optional learning after exit', async () => {
  const progress = Object.fromEntries(coreSteps.map(step => [step.id, { status: step.kind === 'read' ? 'demonstrated' : 'done' }]));
  progress['search-embedding'] = { status: 'needs_setup' };
  progress['mcp-read'] = { status: 'needs_setup' };
  const ui = await tutorialBrowser({ progress, currentStepId: 'complete-review' });
  await ui.tutorial.open();
  assert.match(ui.body.textContent, /核心流程已完成/);
  assert.match(ui.body.textContent, /核心完成进度：28\/28/);
  assert.doesNotMatch(ui.body.textContent, /外部工具体验状态/);
  await click(findButton(ui.body, '完成体验，回正式库'));
  assert.equal(ui.state.status, 'paused');
  assert.equal(ui.contexts.at(-1), '');
  assert.deepEqual(ui.state.progress, progress);
  const entry = ui.tutorial.entryCard();
  assert.match(entry.textContent, /核心流程已完成/);
  await click(findButton(entry, '查看扩展阅读'));
  assert.equal(descend(ui.body).find(node => node.classList.contains('onboarding-extensions')).open, true);
  assert.equal(ui.state.currentStepId, 'complete-review', 'opening the catalog must not select an optional topic');
  ui.tutorial.dispose();
});

test('existing optional progress resumes from saved step IDs and can return to unfinished core work', async () => {
  for (const source of ['currentStepId', 'savedStepId']) {
    const progress = { 'setup-welcome': { status: 'demonstrated' }, 'backup-download': { status: 'done' } };
    const ui = await tutorialBrowser({ [source]: 'backup-preview', progress });
    await ui.tutorial.open();
    assert.equal(ui.state.currentStepId, 'backup-preview');
    assert.match(ui.body.textContent, /扩展阅读（可选）/);
    await click(findButton(ui.body, '返回核心流程'));
    assert.equal(ui.state.currentStepId, 'setup-model');
    assert.deepEqual(ui.state.progress, progress);
    ui.tutorial.dispose();
  }
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
