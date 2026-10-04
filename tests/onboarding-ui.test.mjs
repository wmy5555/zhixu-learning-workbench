import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { chapters, flatSteps, coreChapters, coreSteps, extensionChapters, getCurriculum } from '../public/onboarding-curriculum.mjs';
import { materials, customMaterial, customSample, getMaterial, materialSample } from '../public/onboarding-materials.mjs';

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

test('background job status reads allow a library switch and discard old results while writes still block', async () => {
  let finish;
  const calls = [];
  const client = apiBrowser((path, options) => { calls.push({ path, method: options.method }); return new Promise(resolve => { finish = resolve; }); });
  client.api.setContext('practice-one');
  const pending = client.api.jobStatuses();
  assert.equal(client.api.getContext().pending, 0);
  client.api.setContext('');
  finish(response({ jobs: [{ id: 'old', state: 'done' }] }));
  await assert.rejects(pending, error => error.code === 'STALE_CONTEXT');
  assert.equal(calls[0].path, '/api/practice/practice-one/jobs?view=status');
  const session = client.startSession(); finish(response({ csrf: 'synthetic-csrf' })); await session;
  const write = client.request('/api/jobs?view=status', { method: 'POST', body: {} });
  assert.equal(client.api.getContext().pending, 1);
  assert.throws(() => client.api.setContext('practice-two'), error => error.code === 'CONTEXT_BUSY');
  finish(response({ ok: true })); await write;
  assert.equal(client.api.getContext().pending, 0);
});

test('background source reads allow a library switch and cannot exempt foreground reads or writes', async () => {
  let finish;
  const client = apiBrowser(() => new Promise(resolve => { finish = resolve; }));
  client.api.setContext('practice-one');
  const background = client.api.note('synthetic-source', { background: true });
  assert.equal(client.api.getContext().pending, 0);
  client.api.setContext('');
  finish(response({ id: 'old-source' }));
  await assert.rejects(background, error => error.code === 'STALE_CONTEXT');
  const foreground = client.api.note('synthetic-source');
  assert.throws(() => client.api.setContext('practice-one'), error => error.code === 'CONTEXT_BUSY');
  finish(response({})); await foreground;
  const session = client.startSession(); finish(response({ csrf: 'synthetic-csrf' })); await session;
  const write = client.request('/api/notes/synthetic-source', { method: 'PUT', background: true, body: {} });
  assert.throws(() => client.api.setContext('practice-one'), error => error.code === 'CONTEXT_BUSY');
  finish(response({})); await write;
});

test('background onboarding proof reads do not block switching and cannot exempt writes or foreground reads', async () => {
  let finish;
  const client = apiBrowser(() => new Promise(resolve => { finish = resolve; }));
  const proof = client.api.onboarding('state', { practiceId: 'practice-one' }, { background: true });
  assert.equal(client.api.getContext().pending, 0);
  client.api.setContext('practice-one');
  finish(response({ practiceId: 'old-practice' }));
  await assert.rejects(proof, error => error.code === 'STALE_CONTEXT');
  const foreground = client.api.onboarding('state');
  assert.throws(() => client.api.setContext(''), error => error.code === 'CONTEXT_BUSY');
  finish(response({})); await foreground;
  const session = client.startSession(); finish(response({ csrf: 'synthetic-csrf' })); await session;
  const write = client.api.onboarding('pause', {}, { background: true });
  assert.throws(() => client.api.setContext(''), error => error.code === 'CONTEXT_BUSY');
  finish(response({})); await write;
});

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.events = {}; this.dataset = {}; this.attributes = {};
    this.parentElement = null; this.hidden = false; this.open = false; this.value = ''; this.disabled = false; this._text = ''; this.className = ''; this.animations = []; this.scrolls = [];
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
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
  replaceChildren(...children) { this.children.forEach(child => { child.parentElement = null; }); this.children = []; this.append(...children); }
  addEventListener(type, handler) { this.events[type] = handler; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  contains(target) { return target === this || this.children.some(child => child.contains(target)); }
  getClientRects() { return this.hidden ? [] : [{}]; }
  scrollIntoView(options) { this.scrolls.push(options); }
  focus() { Element.activeElement = this; }
  animate(frames, options) { const animation = { frames, options, cancelled: false, cancel() { this.cancelled = true; } }; this.animations.push(animation); return animation; }
  querySelectorAll(selector) { return descend(this).slice(1).filter(node => selector === '[data-tour]' ? node.dataset.tour : selector === '[data-onboarding-toggle]' ? node.dataset.onboardingToggle : selector.startsWith('.') ? node.classList.contains(selector.slice(1)) : false); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
function descend(node) { return [node, ...node.children.flatMap(descend)]; }
function findButton(root, label) { return descend(root).find(node => node.tagName === 'BUTTON' && node.textContent === label); }
async function click(node) { assert.ok(node, 'button exists'); assert.equal(node.disabled, false, `button ${node.textContent} is enabled`); await node.events.click({ target: node, preventDefault() {} }); }
async function startTutorial(ui) {
  const pending = click(findButton(ui.tutorial.entryCard(), '开始新手引导'));
  assert.equal(descend(ui.body).filter(node => node.getAttribute('name') === 'tutorial-material').length, 6);
  await click(findButton(ui.body, '使用这份材料'));
  await pending;
}

async function tutorialBrowser({ modelReady = true, exists = true, narrow = false, reducedMotion = false, query = '', checkpoint, advance, resetRequest, stateRead, currentStepId, savedStepId, progress = {} } = {}) {
  const body = new Element('body'), workspace = new Element(), main = new Element('main'), drawer = new Element(), drawerBody = new Element(), launcher = new Element('button'), toasts = new Element();
  body.append(workspace, drawer, launcher, toasts); workspace.append(main); drawer.append(drawerBody);
  const roots = { '.workspace': workspace, '#main': main, '#drawer': drawer, '#drawer-body': drawerBody, '#onboarding-launcher': launcher, '#toast-region': toasts };
  const document = { body, get activeElement() { return Element.activeElement; }, createElement: tag => new Element(tag), createTextNode: text => { const node = new Element('text'); node.textContent = text; return node; }, querySelector: selector => roots[selector] || null, querySelectorAll: selector => selector === '[data-tour]' ? descend(body).filter(node => node.dataset.tour) : [] };
  const requests = [], navigations = [], contexts = [], intervals = [], windowEvents = {};
  let practiceId = '', version = 0, state = { practiceId: exists ? 'practice-one' : null, status: exists ? 'paused' : 'not_started', modelReady, currentStepId, progress, roles: {}, clock: { now: '2026-09-30T08:00:00Z' }, busy: false };
  const api = {
    getContext: () => ({ practiceId, version, pending: 0 }),
    setContext: id => { if (practiceId !== id) version++; practiceId = id; contexts.push(id); },
    onboarding: async (action, data = {}, options = {}) => {
      requests.push({ action, data: structuredClone(data), options: structuredClone(options) });
      if (action === 'state' && stateRead) { const read = await stateRead(); if (read) return structuredClone(read); }
      if (action === 'advance' && advance) await advance(data, state);
      if (action === 'reset' && resetRequest) await resetRequest();
      if (action === 'start' || action === 'resume') state = { ...state, practiceId: 'practice-one', status: 'active', ...(action === 'start' ? { materialId: data.materialId, customSample: data.materialId === 'custom' ? customSample(data.customMaterial) : null } : {}) };
      if (action === 'checkpoint') {
        if (checkpoint) await checkpoint(data, state);
        if (data.mode === 'read') state.progress[data.stepId] = { status: 'demonstrated' };
        state.currentStepId = data.stepId;
      }
      if (action === 'pause') state.status = 'paused';
      return structuredClone(state);
    },
  };
  const context = vm.createContext({ api, chapters, flatSteps, coreChapters, coreSteps, extensionChapters, getCurriculum, materials, customMaterial, customSample, getMaterial, materialSample, document, Node: Element, URLSearchParams, localStorage: store(), sessionStorage: store(savedStepId ? { 'zhixu.onboarding.currentStep.v1': savedStepId } : {}), MutationObserver: class { observe() {} disconnect() {} },
    window: { location: { search: query }, matchMedia: query => ({ matches: query.includes('prefers-reduced-motion') ? reducedMotion : narrow }), addEventListener(type, handler) { windowEvents[type] = handler; }, setTimeout() {}, clearTimeout() {}, setInterval(handler) { intervals.push(handler); }, clearInterval() {} },
  });
  const stripped = onboardingSource.replace(/^import .*;\s*$/gm, '').replaceAll('export ', '');
  vm.runInContext(uiSource.replaceAll('export ', '') + '\n' + stripped + '\nthis.make = createOnboarding; this.progress = getStepProgress;', context);
  const adapter = { navigate: async step => { navigations.push(step.id || step.view); }, contextChanged: async () => {}, refresh: async () => {}, fillSample: async () => {}, processStatus: () => null };
  const tutorial = context.make(adapter); await tutorial.init();
  return { tutorial, adapter, body, workspace, main, drawer, drawerBody, toasts, requests, navigations, contexts, intervals, document, setNarrow(value) { narrow = value; windowEvents.resize?.(); }, progress: context.progress, get state() { return state; }, setState: value => { state = { ...state, ...value }; } };
}

test('the AI decomposition step shows waiting progress without changing evidence or notifying preset completion', async () => {
  const ui = await tutorialBrowser({ currentStepId: 'process-ai' });
  ui.setState({ roles: { capturedSource: 'synthetic-source' } });
  let status = { state: 'queued', active: true, message: 'AI 拆解已排队，请等待…' };
  ui.adapter.processStatus = noteId => { assert.equal(noteId, 'synthetic-source'); return status; };
  await ui.tutorial.open();
  assert.ok(descend(ui.body).some(node => node.classList.contains('process-spinner')));
  assert.match(ui.body.textContent, /已排队/);
  assert.equal(ui.state.progress['process-ai'], undefined);
  for (const state of ['waiting', 'failed', 'cancelled', 'done']) {
    status = { state, active: false, message: '合成任务状态：' + state }; await ui.tutorial.refresh();
    assert.ok(!descend(ui.body).some(node => node.classList.contains('process-spinner')));
    assert.equal(ui.state.progress['process-ai'], undefined);
  }
  assert.equal(ui.toasts.children.length, 0, 'the global task monitor owns completion notifications');
  ui.tutorial.dispose();
});

test('a delayed background proof cannot overwrite a practice pause or report an obsolete error', async () => {
  let release, delayed = false;
  const ui = await tutorialBrowser({ stateRead: () => delayed ? new Promise(resolve => { release = resolve; }) : undefined });
  await ui.tutorial.open();
  const stale = structuredClone(ui.state);
  delayed = true;
  const refresh = ui.tutorial.refresh();
  assert.equal(ui.requests.at(-1).options.background, true);
  await click(findButton(ui.body, '暂停并回正式库'));
  release(stale); await refresh;
  assert.equal(ui.tutorial.state.status, 'paused');
  assert.equal(ui.contexts.at(-1), '');
  ui.tutorial.dispose();
});

test('a delayed background proof cannot roll back a newer checkpoint in the same practice', async () => {
  let release, delayed = false;
  const ui = await tutorialBrowser({ stateRead: () => delayed ? new Promise(resolve => { release = resolve; }) : undefined });
  await ui.tutorial.open();
  const stale = structuredClone(ui.state);
  delayed = true;
  const refresh = ui.tutorial.refresh();
  await click(findButton(ui.body, '我已阅读'));
  const first = flatSteps[0], next = flatSteps[1];
  release(stale); await refresh;
  assert.equal(ui.tutorial.state.progress[first.id].status, 'demonstrated');
  assert.equal(ui.tutorial.state.currentStepId, next.id);
  ui.tutorial.dispose();
});

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
  const actionNavigationCount = ui.navigations.length;
  await click(findButton(ui.body, '检查这一步'));
  assert.equal(ui.navigations.length, actionNavigationCount, 'checking an action does not auto-advance');
  assert.equal(ui.state.currentStepId, actionStep.id);
  assert.equal(ui.state.progress[actionStep.id], undefined);
  ui.tutorial.dispose();
});

test('successful action check waits for evidence, shows a toast, and offers explicit one-step navigation', async () => {
  let release, checking = false;
  const ui = await tutorialBrowser({ currentStepId: 'capture-save', checkpoint: async (data, state) => {
    if (checking && data.stepId === 'capture-save') {
      await new Promise(resolve => { release = resolve; });
      state.progress[data.stepId] = { status: 'done' };
    }
  } });
  await ui.tutorial.open(); checking = true;
  const before = ui.navigations.length;
  const pending = click(findButton(ui.body, '检查这一步'));
  assert.equal(findButton(ui.body, '检查这一步').disabled, true);
  assert.equal(findButton(ui.body, '进行下一步'), undefined);
  assert.equal(ui.toasts.children.length, 0);
  release(); await pending;
  assert.equal(ui.state.currentStepId, 'capture-save');
  assert.equal(ui.navigations.length, before, 'success leaves the current step visible');
  assert.match(ui.toasts.textContent, /这一步已完成，可以继续了/);
  assert.equal(ui.toasts.children[0].classList.contains('toast-success'), true);
  assert.ok(findButton(ui.body, '进行下一步').classList.contains('primary-button'));
  assert.equal(findButton(ui.body, '检查这一步'), undefined);
  const checks = ui.requests.length;
  await click(findButton(ui.body, '进行下一步'));
  assert.equal(ui.state.currentStepId, 'capture-source');
  assert.equal(ui.navigations.length, before + 1);
  assert.deepEqual(ui.requests.slice(checks).map(call => [call.action, call.data.stepId, call.data.mode]), [['checkpoint', 'capture-source', 'check']]);
  assert.equal(ui.state.progress['capture-source'], undefined);
  assert.ok(findButton(ui.body, '我已阅读'));
  ui.tutorial.dispose();
});

test('missing evidence and failed checks keep the check button, show no success, and allow retry', async () => {
  let outcome = 'pending';
  const ui = await tutorialBrowser({ currentStepId: 'capture-save', checkpoint: async (data, state) => {
    if (data.stepId !== 'capture-save') return;
    if (outcome === 'error') throw new Error('检查请求未完成，请重试');
    state.progress[data.stepId] = { status: outcome, message: outcome === 'pending' ? '请先保存资料' : '' };
  } });
  await ui.tutorial.open();
  for (const value of ['pending', 'error']) {
    outcome = value;
    await click(findButton(ui.body, '检查这一步'));
    assert.equal(ui.state.currentStepId, 'capture-save');
    assert.equal(findButton(ui.body, '进行下一步'), undefined);
    assert.ok(findButton(ui.body, '检查这一步'));
    assert.equal(ui.toasts.children.length, 0);
    assert.match(ui.body.textContent, value === 'pending' ? /请先保存资料/ : /检查请求未完成，请重试/);
  }
  outcome = 'done';
  await click(findButton(ui.body, '检查这一步'));
  assert.ok(findButton(ui.body, '进行下一步'));
  assert.equal(ui.toasts.children.length, 1);
  assert.doesNotMatch(ui.body.textContent, /检查请求未完成，请重试/);
  ui.tutorial.dispose();
});

test('resumed and refreshed completion offers next without repeated toasts and reverts when evidence is missing', async () => {
  const ui = await tutorialBrowser({ currentStepId: 'capture-save', progress: { 'capture-save': { status: 'done' } } });
  await ui.tutorial.open();
  assert.ok(findButton(ui.body, '进行下一步'));
  await ui.tutorial.refresh();
  assert.equal(ui.toasts.children.length, 0);
  ui.setState({ progress: {} }); await ui.tutorial.refresh();
  assert.ok(findButton(ui.body, '检查这一步'));
  assert.equal(findButton(ui.body, '进行下一步'), undefined);
  ui.tutorial.dispose();
});

test('queued completion clears a stale check error without repeated notifications or premature navigation', async () => {
  const ui = await tutorialBrowser({ currentStepId: 'capture-save' });
  ui.setState({ jobs: [{ id: 'synthetic-job', state: 'queued' }] });
  await ui.tutorial.open();
  await click(findButton(ui.body, '检查这一步'));
  assert.match(ui.body.textContent, /尚未找到这一步的完成记录/);
  await ui.tutorial.refresh();
  assert.match(ui.body.textContent, /尚未找到这一步的完成记录/, 'pending evidence keeps the explanation');
  ui.setState({ progress: { 'capture-save': { status: 'done' } }, jobs: [{ id: 'synthetic-job', state: 'done' }] });
  ui.intervals[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.doesNotMatch(ui.body.textContent, /尚未找到这一步的完成记录/);
  assert.ok(findButton(ui.body, '进行下一步'));
  assert.equal(ui.toasts.children.length, 0);
  assert.equal(ui.state.currentStepId, 'capture-save');
  assert.equal(ui.navigations.length, 1);
  ui.tutorial.dispose();
});

test('refreshing completed evidence preserves an unrelated clock operation error', async () => {
  const ui = await tutorialBrowser({ currentStepId: 'review-clock-due', progress: { 'review-clock-due': { status: 'done' } }, advance: async () => { throw new Error('请先结束练习'); } });
  await ui.tutorial.open();
  await click(findButton(ui.body, '前进 1 天'));
  await ui.tutorial.refresh();
  assert.match(ui.body.textContent, /请先结束练习/);
  assert.equal(ui.toasts.children.length, 0);
  ui.tutorial.dispose();
});

test('case and external confirmations retain truthful feedback and stay within the selected route', async () => {
  for (const [id, expected, label] of [
    ['proposal-accept', /这一步已完成，进度已记为“已看案例”/, '检查这一步'],
    ['obsidian-open', /体验进度已记录，可以继续下一步/, '记录我已在外部体验'],
  ]) {
    let checking = false;
    const target = flatSteps.find(step => step.id === id);
    const route = extensionChapters.find(chapter => chapter.steps.some(step => step.id === id)).steps;
    const next = route[route.findIndex(step => step.id === id) + 1];
    const ui = await tutorialBrowser({ currentStepId: id, checkpoint: async (data, state) => {
      if (checking && data.stepId === id) state.progress[id] = { status: 'demonstrated' };
    } });
    await ui.tutorial.open(); checking = true;
    await click(findButton(ui.body, label));
    assert.equal(ui.requests.at(-1).data.mode, target.kind === 'external' ? 'external' : 'check');
    assert.match(ui.toasts.textContent, expected);
    await click(findButton(ui.body, '进行下一步'));
    assert.equal(ui.state.currentStepId, next.id);
    assert.equal(ui.state.progress[next.id], undefined);
    ui.tutorial.dispose();
  }
  const route = extensionChapters.find(chapter => chapter.id === 'external').steps;
  const last = route.at(-1);
  assert.notEqual(last.kind, 'read');
  const ui = await tutorialBrowser({ currentStepId: last.id, progress: { [last.id]: { status: 'done' } } });
  await ui.tutorial.open();
  assert.equal(findButton(ui.body, '进行下一步'), undefined);
  await click(findButton(ui.body, '返回核心流程'));
  assert.equal(ui.state.currentStepId, 'setup-welcome');
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
  await startTutorial(ui);
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

test('custom material validates locally, retains typed text across preview choices and only fills capture on request', async () => {
  const ui = await tutorialBrowser({ exists: false });
  const pending = click(findButton(ui.tutorial.entryCard(), '开始新手引导'));
  const radio = descend(ui.body).find(node => node.value === 'custom');
  radio.events.change({ target: { value: 'custom' } });
  await click(findButton(ui.body, '使用这份材料'));
  assert.ok(ui.body.textContent.includes('材料字段为空或过长'));
  assert.ok(!ui.requests.some(call => call.action === 'start'));
  const input = name => descend(ui.body).find(node => node.getAttribute('name') === `custom-${name}`);
  assert.equal(input('title').getAttribute('max-length'), '200');
  input('title').value = '合成自选输入'; input('body').value = '合成原文第一段。\n第二段保持换行。'; input('note').value = '合成心得，不是确认理解。';
  descend(ui.body).find(node => node.value === 'reading').events.change({ target: { value: 'reading' } });
  radio.events.change({ target: { value: 'custom' } });
  assert.equal(input('body').value, '合成原文第一段。\n第二段保持换行。');
  await click(findButton(ui.body, '使用这份材料')); await pending;
  assert.equal(ui.requests.find(call => call.action === 'start').data.materialId, 'custom');
  const samples = []; ui.adapter.fillSample = async sample => samples.push(sample);
  await click(descend(ui.body).find(node => node.tagName === 'BUTTON' && node.textContent.startsWith(coreChapters[1].title)));
  assert.equal(samples.length, 0);
  await click(findButton(ui.body, '填入示例（不提交）'));
  assert.ok(samples[0].body.includes('合成原文第一段。\n第二段保持换行。'));
  assert.ok(samples[0].body.includes('用户填写，尚未确认理解'));
  assert.ok(!ui.requests.some(call => call.action === 'import'));
  ui.tutorial.dispose();
});

test('goal extensions reuse non-main candidates and offer manual creation when only the main candidate exists', async () => {
  const ui = await tutorialBrowser({ currentStepId: 'library-aware' });
  ui.setState({ materialId: 'reading', roles: { capturedSource: 'source', explain: 'main', apply: 'other' }, learningCandidates: [{ id: 'main', title: '主线', limitations: [] }, { id: 'other', title: '扩展', limitations: [] }] });
  await ui.tutorial.open();
  let select = descend(ui.body).find(node => node.dataset.tour === 'onboarding-knowledge');
  assert.equal(select.children.find(node => node.value === 'main').disabled, true);
  assert.equal(select.children.find(node => node.value === 'other').disabled, false);
  ui.setState({ learningCandidates: [{ id: 'main', title: '主线', limitations: [] }] });
  await ui.tutorial.refresh();
  assert.match(ui.body.textContent, /手动整理另一项内容/);
  await click(findButton(ui.body, '整理另一条知识'));
  assert.equal(ui.navigations.at(-1), 'process-manual');
  assert.ok(!ui.requests.some(call => call.action === 'import' || call.data.mode === 'read'));
  assert.equal(ui.state.progress['library-aware'], undefined);
  ui.tutorial.dispose();
});

test('planning a selected candidate offers the actual join-learning prerequisite without promoting it', async () => {
  const ui = await tutorialBrowser({ currentStepId: 'study-plan' });
  ui.setState({ materialId: 'reading', roles: { explain: 'main' }, learningCandidates: [{ id: 'main', title: '合成主线', stage: 'candidate', depth: 'explain', limitations: [] }] });
  await ui.tutorial.open();
  assert.match(ui.body.textContent, /选中的解释知识还未加入学习/);
  await click(findButton(ui.body, '回到加入学习这一步'));
  assert.equal(ui.navigations.at(-1), 'library-explain');
  assert.equal(ui.state.learningCandidates[0].stage, 'candidate');
  assert.ok(ui.requests.every(call => ['state', 'resume', 'checkpoint'].includes(call.action)));
  assert.notEqual(ui.state.progress['study-plan']?.status, 'done');
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
  await startTutorial(ui);
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

test('missing review routes back to a new attempt without creating evidence or submitting an answer', async () => {
  const progress = { 'study-finish': { status: 'done' } };
  const ui = await tutorialBrowser({ currentStepId: 'review-clock-due', progress, advance: async () => { throw Object.assign(new Error('暂无未来的复习安排'), { code: 'NO_REVIEW' }); } });
  await ui.tutorial.open();
  await click(findButton(ui.body, '跳到下次复习'));
  assert.equal(ui.state.currentStepId, 'study-start');
  assert.equal(ui.navigations.at(-1), 'study-start');
  assert.match(ui.body.textContent, /反馈存在争议时/);
  assert.deepEqual(ui.state.progress, progress);
  assert.ok(ui.requests.every(call => ['state', 'resume', 'checkpoint', 'advance'].includes(call.action)));
  assert.ok(ui.requests.filter(call => call.action === 'checkpoint').every(call => call.data.mode === 'check'));
  ui.tutorial.dispose();
});

test('an unsettled review offers explicit retry while other clock errors keep their current step', async () => {
  const ui = await tutorialBrowser({ currentStepId: 'review-finish', advance: async () => { throw Object.assign(new Error('请先结束练习'), { code: 'PRACTICE_BUSY' }); } });
  await ui.tutorial.open();
  assert.match(ui.body.textContent, /不会创建或更新复习安排/);
  await click(findButton(ui.body, '跳到下次复习'));
  assert.equal(ui.state.currentStepId, 'review-finish');
  assert.match(ui.body.textContent, /请先结束练习/);
  await click(findButton(ui.body, '重新练习这条知识'));
  assert.equal(ui.state.currentStepId, 'study-start');
  assert.deepEqual(ui.state.progress, {});
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

test('floating instructions stay outside the transformed drawer when it opens or rerenders', async () => {
  const ui = await tutorialBrowser({ narrow: true });
  await ui.tutorial.open();
  const panel = descend(ui.workspace).find(node => node.classList.contains('onboarding-panel'));
  ui.drawer.classList.add('is-open'); ui.tutorial.rendered();
  assert.equal(panel.parentElement, ui.workspace);
  ui.drawerBody.replaceChildren(new Element('form')); ui.tutorial.rendered();
  assert.equal(panel.parentElement, ui.workspace);
  ui.drawer.classList.remove('is-open'); ui.tutorial.rendered();
  assert.equal(panel.parentElement, ui.workspace);
  ui.tutorial.dispose();
});

test('narrow locate collapses into a keyboard-accessible small window and retains progress on refresh', async () => {
  const ui = await tutorialBrowser({ narrow: true });
  const target = new Element('button'); target.dataset.tour = 'nav-today'; ui.main.append(target);
  await ui.tutorial.open();
  const panel = descend(ui.workspace).find(node => node.classList.contains('onboarding-panel'));
  const originalProgress = structuredClone(ui.state.progress);
  await click(findButton(ui.body, '定位操作位置'));
  assert.equal(panel.classList.contains('is-compact'), true);
  assert.equal(panel.querySelectorAll('.onboarding-content')[0].hidden, true);
  assert.equal(ui.document.activeElement, findButton(panel, '展开步骤'));
  assert.equal(findButton(panel, '展开步骤').attributes['aria-expanded'], 'false');
  assert.equal(target.animations.length, 1);
  await ui.tutorial.refresh();
  assert.equal(panel.classList.contains('is-compact'), true);
  assert.equal(ui.document.activeElement, findButton(panel, '展开步骤'));
  await click(findButton(panel, '展开步骤'));
  assert.equal(panel.querySelectorAll('.onboarding-content')[0].hidden, false);
  const content = panel.querySelectorAll('.onboarding-content')[0]; content.scrollTop = 180;
  await ui.tutorial.refresh();
  assert.equal(panel.querySelectorAll('.onboarding-content')[0].scrollTop, 180);
  assert.equal(findButton(panel, '收成小窗').attributes['aria-expanded'], 'true');
  let prevented = false, stopped = false;
  panel.events.keydown({ key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.ok(prevented && stopped, 'Escape collapses without closing the underlying drawer');
  assert.equal(ui.document.activeElement, findButton(panel, '展开步骤'));
  assert.deepEqual(ui.state.progress, originalProgress, 'window controls never complete a step');
  ui.setNarrow(false);
  await click(findButton(panel, '展开步骤'));
  assert.ok(findButton(panel, '折叠步骤'));
  await click(findButton(ui.body, '定位操作位置'));
  assert.equal(panel.classList.contains('is-compact'), false, 'wide sidebar stays expanded');
  ui.setNarrow(true);
  assert.ok(findButton(panel, '收成小窗'));
  await click(findButton(panel, '我已阅读'));
  assert.equal(panel.querySelectorAll('.onboarding-content')[0].scrollTop, 0, 'a new step starts at its beginning');
  ui.tutorial.dispose();
});

test('failed or unavailable narrow locate keeps instructions and errors visible', async () => {
  const ui = await tutorialBrowser({ narrow: true });
  await ui.tutorial.open();
  const panel = descend(ui.workspace).find(node => node.classList.contains('onboarding-panel'));
  await click(findButton(panel, '定位操作位置'));
  assert.equal(panel.classList.contains('is-compact'), false, 'missing target must not hide the instructions');
  ui.tutorial.dispose();
  const blocked = await tutorialBrowser({ narrow: true, checkpoint: async data => { if (data.mode === 'check') throw new Error('模拟保存失败'); } });
  await blocked.tutorial.open();
  await click(findButton(blocked.body, '收成小窗'));
  await blocked.tutorial.open();
  assert.ok(findButton(blocked.body, '收成小窗'));
  assert.match(blocked.body.textContent, /模拟保存失败/);
  blocked.tutorial.dispose();
});

test('background refresh failure expands a located small window without changing progress', async () => {
  let failRefresh = false;
  const ui = await tutorialBrowser({ narrow: true, stateRead: async () => { if (failRefresh) throw new Error('模拟会话刷新失败'); } });
  const target = new Element('button'); target.dataset.tour = 'nav-today'; ui.main.append(target);
  await ui.tutorial.open();
  await click(findButton(ui.body, '定位操作位置'));
  const panel = descend(ui.workspace).find(node => node.classList.contains('onboarding-panel'));
  assert.equal(panel.classList.contains('is-compact'), true);
  const progress = structuredClone(ui.state.progress);
  failRefresh = true;
  await ui.tutorial.refresh();
  assert.equal(panel.classList.contains('is-compact'), false);
  assert.equal(panel.querySelectorAll('.onboarding-content')[0].hidden, false);
  assert.ok(descend(panel).some(node => node.attributes.role === 'alert' && node.textContent === '模拟会话刷新失败'));
  assert.deepEqual(ui.state.progress, progress);
  ui.tutorial.dispose();
});

test('locating a step restarts its finite highlight pulse and moving on cancels the old target', async () => {
  const ui = await tutorialBrowser();
  const target = new Element('button'); target.dataset.tour = 'nav-today'; ui.main.append(target);
  await ui.tutorial.open();
  assert.equal(target.animations.length, 0, 'normal navigation does not flash');
  await click(findButton(ui.body, '定位操作位置'));
  assert.equal(target.animations.length, 1);
  assert.equal(target.animations[0].options.iterations, 3);
  assert.equal(target.scrolls.at(-1).behavior, 'smooth');
  await ui.tutorial.refresh();
  assert.equal(target.animations.length, 1);
  assert.equal(target.animations[0].cancelled, false, 'progress refresh must not stop the active pulse');
  await click(findButton(ui.body, '定位操作位置'));
  assert.equal(target.animations.length, 2);
  assert.equal(target.animations[0].cancelled, true);
  await click(findButton(ui.body, '我已阅读'));
  assert.equal(target.animations[1].cancelled, true);
  assert.equal(target.classList.contains('tour-target'), false);
  ui.tutorial.dispose();
});

test('navigation targets are revealed on resume and restored when leaving or disposing the tutorial', async () => {
  for (const savedStepId of ['setup-welcome', 'complete-review']) {
    const ui = await tutorialBrowser({ savedStepId });
    const target = new Element('button'); target.dataset.tour = 'nav-today'; target.inert = true; ui.main.append(target);
    ui.adapter.revealTarget = node => {
      if (node !== target) return;
      target.inert = false;
      return () => { target.inert = true; };
    };
    await ui.tutorial.open();
    assert.equal(target.inert, false);
    assert.equal(target.classList.contains('tour-target'), true);
    if (savedStepId === 'setup-welcome') {
      await click(findButton(ui.body, '我已阅读'));
      assert.equal(target.inert, true);
    }
    ui.tutorial.dispose();
    assert.equal(target.inert, true);
  }
});

test('reduced motion keeps the highlight static and disables smooth scrolling', async () => {
  const ui = await tutorialBrowser({ reducedMotion: true });
  const target = new Element('button'); target.dataset.tour = 'nav-today'; ui.main.append(target);
  await ui.tutorial.open();
  await click(findButton(ui.body, '定位操作位置'));
  assert.equal(target.animations.length, 0);
  assert.equal(target.classList.contains('tour-target'), true);
  assert.ok(target.scrolls.length > 0);
  assert.ok(target.scrolls.every(options => options.behavior === 'auto'));
  ui.tutorial.dispose();
});

test('locating ignores closed drawers and opens folded ancestors before highlighting', async () => {
  const ui = await tutorialBrowser({ currentStepId: 'process-ai' });
  const hidden = new Element(); hidden.dataset.tour = 'note-process'; ui.drawerBody.append(hidden);
  ui.drawer.setAttribute('aria-hidden', 'true');
  await ui.tutorial.open();
  assert.equal(hidden.classList.contains('tour-target'), false);
  await click(findButton(ui.body, '定位操作位置'));
  assert.match(ui.body.textContent, /当前操作尚未出现/);
  const details = new Element('details'), target = new Element('button');
  target.dataset.tour = 'note-process'; details.append(target); ui.main.append(details);
  await click(findButton(ui.body, '定位操作位置'));
  assert.equal(details.open, true);
  assert.equal(target.classList.contains('tour-target'), true);
  assert.equal(hidden.classList.contains('tour-target'), false);
  ui.tutorial.dispose();
});

test('clock steps frame the actual time controls and keep them visible in a narrow panel', async () => {
  for (const id of ['review-clock-day', 'review-clock-due']) {
    const ui = await tutorialBrowser({ currentStepId: id, narrow: true });
    await ui.tutorial.open();
    await click(findButton(ui.body, '定位操作位置'));
    const target = descend(ui.body).find(node => node.classList.contains('tour-target'));
    assert.equal(target.dataset.tour, flatSteps.find(step => step.id === id).focusTarget);
    assert.equal(target.animations.length, 1, 'the pulse belongs to the final rendered control');
    assert.equal(ui.workspace.querySelectorAll('.onboarding-content')[0].hidden, false);
    assert.equal(ui.requests.some(request => request.action === 'advance'), false, 'locating does not advance time');
    ui.tutorial.dispose();
  }
});

test('a missing case frames preparation, and an explicit prerequisite frames its navigation button', async () => {
  for (const location of [
    { target: 'onboarding-case', message: '请先准备演示案例' },
    { target: 'onboarding-prerequisite', prerequisite: 'capture-save', message: '请先保存练习资料' },
    { target: 'onboarding-reset', message: '初始示例缺失，确认重置后重新准备' },
  ]) {
    const ui = await tutorialBrowser({ currentStepId: 'library-history', narrow: true });
    ui.adapter.navigate = async () => location;
    await ui.tutorial.open();
    await click(findButton(ui.body, '定位操作位置'));
    assert.equal(descend(ui.body).find(node => node.classList.contains('tour-target')).dataset.tour, location.target);
    assert.equal(ui.workspace.querySelectorAll('.onboarding-content')[0].hidden, false);
    assert.match(ui.body.textContent, new RegExp(location.message));
    assert.equal(ui.requests.some(request => request.action === 'reset'), false, 'locating reset must not reset practice');
    ui.tutorial.dispose();
  }
});

test('extension capability configuration opens the shared editable settings explicitly', async () => {
  for (const currentStepId of ['process-search-config', 'search-embedding', 'mcp-config']) {
    const ui = await tutorialBrowser({ currentStepId });
    await ui.tutorial.open();
    assert.equal(ui.contexts.at(-1), '');
    assert.match(ui.body.textContent, /正式知识库/);
    assert.match(ui.body.textContent, /API 配置保存在这里/);
    ui.tutorial.dispose();
  }
});

test('an open confirmation drawer takes precedence over the covered page button', async () => {
  const ui = await tutorialBrowser({ currentStepId: 'study-confirm' });
  const covered = new Element('button'); covered.dataset.tour = 'study-confirm'; ui.main.append(covered);
  const form = new Element('form'); form.dataset.tour = 'note-confirm'; ui.drawerBody.append(form);
  ui.drawer.classList.add('is-open'); ui.drawer.setAttribute('aria-hidden', 'false');
  await ui.tutorial.open();
  assert.equal(form.classList.contains('tour-target'), true);
  assert.equal(covered.classList.contains('tour-target'), false);
  ui.tutorial.dispose();
});

test('a rejected checkpoint can clear its own error when saved evidence arrives', async () => {
  let reject = false;
  const ui = await tutorialBrowser({ currentStepId: 'process-ai', checkpoint: async () => { if (reject) throw new Error('模拟检查请求失败'); } });
  await ui.tutorial.open(); reject = true;
  await click(findButton(ui.body, '检查这一步'));
  assert.match(ui.body.textContent, /模拟检查请求失败/);
  ui.setState({ progress: { 'process-ai': { status: 'done' } } });
  await ui.tutorial.refresh();
  assert.doesNotMatch(ui.body.textContent, /模拟检查请求失败/);
  assert.ok(findButton(ui.body, '进行下一步'));
  ui.tutorial.dispose();
});

test('a reset failure replaces check provenance and survives later completion', async () => {
  const ui = await tutorialBrowser({ currentStepId: 'process-ai', resetRequest: async () => { throw new Error('模拟重置失败'); } });
  await ui.tutorial.open(); await click(findButton(ui.body, '检查这一步'));
  await click(findButton(ui.body, '重置练习'));
  await click(findButton(ui.body, '使用这份材料'));
  await new Promise(resolve => setImmediate(resolve));
  const confirm = descend(ui.body).find(node => node.tagName === 'BUTTON' && node.textContent === '重置练习' && node.classList.contains('danger-button'));
  await click(confirm);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(ui.body.textContent, /模拟重置失败/);
  ui.setState({ progress: { 'process-ai': { status: 'done' } } });
  await ui.tutorial.refresh();
  assert.match(ui.body.textContent, /模拟重置失败/);
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
  assert.match(ui.body.textContent, /已找到调用记录/);
  assert.match(ui.body.textContent, /可在诊断页查看详情/);
  assert.match(ui.body.textContent, /用户确认已打开；外部编辑待体验/);
  ui.tutorial.dispose();
});
