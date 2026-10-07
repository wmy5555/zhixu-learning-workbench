import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createProcessFeedback } from '../public/process-feedback.mjs';
import { initSidebar } from '../public/sidebar.mjs';
import { describeJobError } from '../public/ui.mjs';
import { coreSteps, flatSteps } from '../public/onboarding-curriculum.mjs';

import { tutorialFixture } from './fixtures/tutorial-ui.mjs';
const usageSource = await readFile(new URL('../public/usage.mjs', import.meta.url), 'utf8');

const uiSource = await readFile(new URL('../public/ui.mjs', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../public/app.mjs', import.meta.url), 'utf8');
const sourceMapSource = (await readFile(new URL('../public/source-map.mjs', import.meta.url), 'utf8')).replace(/^import.*;$/m, '').replaceAll('export ', '');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.events = {}; this.attributes = {};
    this.tabIndex = -1;
    this.value = ''; this.type = ''; this.name = ''; this.disabled = false; this.checked = false; this.selected = false;
    this.open = false; this.dataset = {}; this.style = { setProperty() {} }; this._text = '';
    this.classList = { add: name => { this.className = (this.className || '') + ' ' + name; }, remove: name => { this.className = (this.className || '').split(' ').filter(item => item !== name).join(' '); }, contains: name => (this.className || '').split(' ').includes(name), toggle() {} };
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  set value(value) { this._value = value; if (this.tagName === 'select') this.children.forEach(child => { child.selected = child.value === value; }); }
  get value() { return this.tagName === 'select' ? this.children.find(child => child.selected)?.value ?? this._value : this._value; }
  get textContent() { return this._text + this.children.map(child => child.textContent ?? String(child)).join(''); }
  append(...children) { this.children.push(...children.map(child => { if (child instanceof Element) { child.parentNode = this; return child; } const text = new Element('text'); text.textContent = String(child); text.parentNode = this; return text; })); }
  prepend(...children) { this.children.unshift(...children); }
  get options() { return this.children; }
  replaceChildren(...children) { this._text = ''; this.children = []; this.append(...children); }
  addEventListener(name, handler) { this.events[name] = handler; }
  setAttribute(name, value) { this.attributes[name] = value; }
  reset() {
    this.events.reset?.();
    for (const node of descendants(this)) {
      if (['input', 'textarea'].includes(node.tagName)) { node.checked = false; node.value = ''; }
    }
  }
  querySelectorAll(selector) { return descendants(this).slice(1).filter(node => matches(node, selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  insertBefore(node, reference) { const at = this.children.indexOf(reference); this.children.splice(at < 0 ? this.children.length : at, 0, node); }
  get lastChild() { return this.children.at(-1); }
  focus(options) { this.focused = true; this.focusOptions = options; }
  scrollIntoView(options) { this.scrollOptions = options; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); }
  cloneNode() { return this; }
}
function descendants(node) { return [node, ...node.children.flatMap(child => child instanceof Element ? descendants(child) : [])]; }
function matches(node, selector) {
  const named = selector.match(/^\[name=["']([^"']+)["']\]$/);
  if (named) return node.name === named[1];
  const dataPresent = selector.match(/^\[data-([\w-]+)\]$/);
  if (dataPresent) return Object.hasOwn(node.dataset, dataPresent[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()));
  const dataTour = selector.match(/^\[data-tour=["']([^"']+)["']\]$/);
  if (dataTour) return node.dataset.tour === dataTour[1];
  if (selector.startsWith('.')) return String(node.className || '').split(/\s+/).includes(selector.slice(1));
  const match = selector.match(/^(\w+)(?:\[([^=]+)=['"]([^'"]+)['"]\])?$/);
  return Boolean(match && node.tagName === match[1] && (!match[2] || node[match[2]] === match[3]));
}
function findButton(node, text) { return descendants(node).find(item => item.tagName === 'button' && item.textContent === text); }
function control(node, name) { return descendants(node).find(item => item.name === name); }
const click = node => node.events.click({ target: node, preventDefault() {} });
const plain = value => JSON.parse(JSON.stringify(value));

function browser(api = {}) {
  api = { getContext: () => ({ practiceId: '', version: 0 }), ...api };
  const roots = new Map();
  const document = {
    documentElement: new Element('html'),
    body: new Element('body'),
    createElement: tag => new Element(tag),
    createElementNS: (_, tag) => new Element(tag),
    createTextNode: value => new Element('text'),
    querySelector(selector) { if (!roots.has(selector)) roots.set(selector, new Element()); return roots.get(selector); },
    addEventListener() {},
  };
  document.createTextNode = value => { const node = new Element('text'); node.textContent = value; return node; };
  const context = vm.createContext({
    api, document, initSidebar, createProcessFeedback, Node: Element, URL, Intl, Date, Map, Set, queueMicrotask, crypto: { randomUUID: () => 'request-ui' },
    FormData: class {
      constructor(form) { this.form = form; }
      entries() { return descendants(this.form).filter(node => node.name && !node.disabled && ['input', 'textarea', 'select'].includes(node.tagName)).map(node => [node.name, String(node.tagName === 'textarea' ? node.textContent : node.tagName === 'select' ? node.children.find(option => option.selected)?.value || '' : node.value)]); }
    },
    ApiError: class extends Error {}, startSession: async () => {},
    window: { zhixuAppearance: { getAccent: () => null, getTheme: () => 'light', resolvedTheme: () => 'light', previewAccent: () => ({}), getMode: () => 'light', palette: () => ({}) }, matchMedia: () => ({ matches: false, addEventListener() {} }), history: { replaceState() {} }, location: { hash: '' }, setTimeout() {}, addEventListener() {} },
  });
  const stripped = appSource.replace(/import[\s\S]*?from "\.\/api\.mjs";\s*/, '').replace(/import[\s\S]*?from "\.\/ui\.mjs";\s*/, '').replace(/^init\(\);\s*$/m, '').replace('const { createUsagePanel } = await import("./usage.mjs");', '');
  vm.runInContext(uiSource.replaceAll('export ', '') + '\n' + sourceMapSource + '\n' + usageSource.replace(/^import.*;$/m, '').replaceAll('export ', '') + '\n' + stripped + '\nthis.app = { renderSourceGroupDrawer, confirmDirect, confirmUnderstanding, noteMeta, renderCurrent, openDraft, navigateTutorial, renderCapture, evidenceDetails, relationControls, renderRelationsPanel, topicEditor, renderStudy, renderOutput, renderNoteEditor, studySessionPanel, renderAnswer, recommendationsPanel, previewNoteLinks, diagnosticsPanel, settingsPanel, todayItem, state, refs };', context);
  context.app.manualExtract = vm.runInContext('manualExtract', context);
  context.app.serializeForm = vm.runInContext('serializeForm', context);
  context.app.processControls = vm.runInContext('processControls', context);
  context.app.refreshBootstrap = vm.runInContext('refreshBootstrap', context);
  context.app.processFeedback = vm.runInContext('processFeedback', context);
  context.app.renderSourceGroupDrawer = vm.runInContext('renderSourceGroupDrawer', context);
  context.app.toasts = document.querySelector('#toast-region');
  context.app.dialogs = document.body;
  context.app.jobsPanel = vm.runInContext('jobsPanel', context);
  context.app.generateToday = vm.runInContext('generateToday', context);
  return context.app;
}

test('recommendations keep complete evidence folded and leave actions outside the details', async () => {
  const reason = '合成说明。'.repeat(80);
  const signals = Array.from({ length: 20 }, (_, index) => `依据 ${index}：${'合成依据。'.repeat(30)}`);
  const app = browser({ recommendations: async () => ({ suggestions: [
    { id: 'long', noteId: 'synthetic', title: '合成知识', type: 'research', targetStage: 'candidate', reason, signals },
    { id: 'brief', title: '简短建议', reason: '短说明', signals: [] },
    { id: 'reason-only', title: '只有长说明', reason },
  ] }) });
  const panel = await app.recommendationsPanel();
  const cards = panel.querySelectorAll('.recommendation-card');
  assert.equal(cards.length, 3);
  const details = cards[0].querySelector('details');
  assert.equal(details.open, false);
  assert.match(details.querySelector('summary').textContent, /20 条/);
  assert.equal(cards[0].querySelector('p').textContent.length, 161);
  assert.equal(details.querySelector('p').textContent, reason);
  assert.deepEqual(details.querySelectorAll('li').map(item => item.textContent), signals);
  assert.equal(details.querySelector('.recommendation-evidence').tabIndex, 0);
  for (const label of ['查看知识', '打开待核验资料', '暂不采用']) {
    assert.ok(findButton(cards[0], label));
    assert.equal(findButton(details, label), undefined);
  }
  assert.equal(cards[1].querySelector('details'), null);
  const reasonOnly = cards[2].querySelector('details');
  assert.equal(reasonOnly.open, false);
  assert.equal(reasonOnly.querySelector('summary').textContent, '查看完整说明');
  assert.equal(reasonOnly.querySelector('p').textContent, reason);
});

test('source maps switch layouts and selection locally, collapse branches, keep all reading actions and separate library state', async () => {
  let external = 0, practiceId = '';
  const app = browser({ getContext: () => ({ practiceId, version: 0 }), sourceStructure: async () => { external++; } });
  const children = ['a', 'b', 'c'].map(id => ({ id, title: `合成条目${id}`, kind: 'knowledge', body: `正文${id}`, meta: { stage: 'candidate' } }));
  const source = { id: 'synthetic-source', kind: 'source', title: '合成来源', body: '原文', meta: {}, children,
    structure: { state: 'ready', hierarchy: [{ child: 'b', parent: 'a' }, { child: 'c', parent: 'b' }],
      edges: [{ id: 'ab', from: 'a', to: 'b', type: 'support', explanation: '依据说明', sourceExcerpt: '正文a', targetExcerpt: '正文b' }] } };
  app.renderSourceGroupDrawer(source);
  let panel = app.refs.drawerBody;
  const node = id => descendants(panel).find(n => n.dataset.noteId === id);
  await click(node('b'));
  assert.equal(node('b').attributes['aria-pressed'], 'true');
  assert.match(panel.querySelector('.map-detail').textContent, /正文b/);
  assert.match(panel.querySelector('.map-relations').textContent, /支持.*正文a.*正文b/);
  await click(findButton(panel, '思维导图'));
  assert.equal(node('b').attributes['aria-pressed'], 'true');
  await click(descendants(panel).find(n => n.attributes['aria-label'] === '折叠 合成条目a'));
  assert.equal(node('b'), undefined);
  await click(findButton(panel, '逻辑图')); assert.ok(node('b'));
  await click(findButton(panel, '阅读全部条目'));
  assert.equal(panel.querySelectorAll('.child-note').length, 4, 'all three reading cards plus hidden selected detail preserve existing operations');
  assert.equal(external, 0, 'layout and reading interactions never submit model requests');
  await click(findButton(panel, '逻辑图')); await click(node('c'));
  app.renderSourceGroupDrawer(source); assert.equal(node('c').attributes['aria-pressed'], 'true');
  practiceId = 'practice-only'; app.renderSourceGroupDrawer(source);
  assert.equal(node('a').attributes['aria-pressed'], 'true');
});

test('Android capture remains local and never starts processing or research, including after reset', async () => {
  const imports = [];
  const app = browser({ runtime: { kind: 'android-prototype' }, import: async payload => { imports.push(plain(payload)); return { notes: [{}] }; }, bootstrap: async () => ({}) });
  app.renderCapture();
  const form = app.refs.main.querySelector('[data-tour="capture-form"]');
  const localOnly = control(form, 'localOnly');
  const process = control(form, 'process');
  const research = control(form, 'research');
  assert.equal(localOnly.checked, true);
  assert.equal(localOnly.disabled, true);
  assert.equal(process.disabled, true);
  assert.equal(research.disabled, true);

  form.reset();
  await Promise.resolve();
  assert.equal(localOnly.checked, true, 'reset must preserve the local-only choice');
  assert.equal(process.disabled, true);
  assert.equal(research.disabled, true);
  await form.events.submit({ preventDefault() {} });
  assert.equal(imports.length, 1);
  assert.equal(imports[0].items[0].privacy, 'local');
  assert.equal(imports[0].process, false);
  assert.equal(imports[0].research, false);
});

test('Android source editing omits disabled privacy, depth, and research interval fields', async () => {
  const updates = [];
  const app = browser({ runtime: { kind: 'android-prototype' }, updateNote: async (id, payload) => { updates.push({ id, payload: plain(payload) }); return { id, hash: 'new-hash' }; }, bootstrap: async () => ({}) });
  app.renderNoteEditor({ id: 'synthetic-source', kind: 'source', title: '原始资料', body: '原文', hash: 'old-hash', meta: { privacy: 'cloud', depth: 'advanced', researchIntervalDays: 14 } });
  const form = app.refs.drawerBody.querySelector('form');
  for (const name of ['privacy', 'depth', 'researchIntervalDays']) assert.equal(control(form, name).disabled, true, `${name} should be disabled`);
  control(form, 'title').value = '更新标题';
  await form.events.submit({ preventDefault() {} });
  assert.equal(updates.length, 1);
  for (const name of ['privacy', 'depth', 'researchIntervalDays']) assert.equal(Object.hasOwn(updates[0].payload.meta, name), false);
});

test('Android source drawer disables version history entry', () => {
  const app = browser({ runtime: { kind: 'android-prototype' } });
  app.renderSourceGroupDrawer({ id: 'synthetic-source', kind: 'source', title: '原始资料', body: '原文', meta: {}, children: [] });
  const history = findButton(app.refs.drawerBody, '查看版本');
  assert.ok(history);
  assert.equal(history.disabled, true);
});

test('AI decomposition shows pending progress, prevents repeat submission, and releases controls after completion or failure', async () => {
  let release, requests = 0, jobs = [], fail = false;
  const source = { id: 'synthetic-source', kind: 'source', title: '合成资料', meta: {}, children: [] };
  const app = browser({ getContext: () => ({ practiceId: '', version: 0 }),
    processNote: async () => { requests++; if (fail) throw new Error('合成提交失败'); return new Promise(resolve => { release = () => { jobs = [{ id: 'synthetic-job', type: 'process', state: 'queued', payload: { noteId: source.id } }]; resolve(jobs[0]); }; }); },
    bootstrap: async () => ({ jobs, notes: [source] }), note: async () => source,
    library: async () => ({ groups: [], standalone: [] }),
  });
  // Exercise the actual source controls through their renderer, rather than a copy of the update logic.
  const controls = app.processControls(source);
  app.refs.drawerBody.replaceChildren(controls);
  const pending = click(findButton(controls, '提交 AI 拆解'));
  assert.equal(findButton(controls, 'AI 拆解处理中…').disabled, true);
  assert.ok(descendants(controls).some(node => String(node.className).includes('process-spinner')));
  await click(findButton(controls, 'AI 拆解处理中…'));
  assert.equal(requests, 1, 'even a second direct handler invocation cannot queue another job');
  release(); await pending;
  const currentControls = app.refs.drawerBody.querySelector('.process-controls');
  assert.equal(findButton(currentControls, 'AI 拆解处理中…').disabled, true);
  jobs[0].state = 'waiting'; await app.refreshBootstrap();
  assert.equal(findButton(currentControls, '提交 AI 拆解').disabled, false);
  assert.doesNotMatch(currentControls.querySelector('.process-status').textContent, /正在|请等待/);
  assert.equal(currentControls.querySelector('.process-spinner'), null);
  jobs[0].state = 'done'; await app.refreshBootstrap(); await app.refreshBootstrap();
  assert.match(currentControls.querySelector('.process-status').textContent, /已完成/);
  assert.equal(app.toasts.children.filter(node => node.textContent.includes('的 AI 拆解已完成')).length, 1);
  fail = true;
  await click(findButton(currentControls, '提交 AI 拆解'));
  assert.equal(findButton(currentControls, '提交 AI 拆解').disabled, false);
});

test('structure submission retains its lock after read failure and completion refresh preserves the selected item', async () => {
  const children = ['a', 'b'].map(id => ({ id, kind: 'knowledge', title: id, body: `合成正文${id}`, meta: {} }));
  const source = { id: 'source', kind: 'source', title: '合成原文', body: '合成原文', meta: {}, children };
  const job = { id: 'structure', type: 'structure', state: 'queued', payload: { noteId: source.id }, jobRevision: 'r', jobSnapshot: 2 };
  let calls = 0;
  const app = browser({ sourceStructure: async () => { calls++; return job; },
    jobStatuses: async () => { throw new Error('合成状态读取失败'); },
    note: async () => ({ ...source, structure: { state: 'ready', message: '新结构已保存', edges: [], hierarchy: [] } }),
  });
  app.renderSourceGroupDrawer(source); app.refs.drawer.classList.add('is-open');
  await click(descendants(app.refs.drawerBody).find(n => n.dataset.noteId === 'b'));
  const submit = findButton(app.refs.drawerBody, '重新分析结构');
  const submitting = click(submit);
  await click(findButton(app.dialogs, '确认重新分析')); await submitting;
  await app.processFeedback.poll();
  assert.equal(submit.disabled, true);
  await click(submit); assert.equal(calls, 1);
  app.processFeedback.observe({ jobs: [{ ...job, state: 'done' }], jobRevision: 'r', jobSnapshot: 3 });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(app.refs.drawerBody.textContent, /新结构已保存/);
  assert.equal(descendants(app.refs.drawerBody).find(n => n.dataset.noteId === 'b').attributes['aria-pressed'], 'true');
  assert.equal(findButton(app.refs.drawerBody, '重新分析结构').disabled, false);
});

test('source-map expansion preserves zoom, fit uses the visible canvas, and replacement material drops obsolete selection', async () => {
  let requests = 0;
  const app = browser({ sourceStructure: async () => { requests++; } });
  const children = Array.from({ length: 8 }, (_, i) => ({ id: `fresh-${i}`, title: `不同主题 ${i}：很长的合成条目标题，保留适用条件和具体例子`, body: `合成正文 ${i}`, kind: 'knowledge', meta: {} }));
  const source = { id: 'changing-sample', kind: 'source', title: '重新编写的任意示例', body: '合成原文', meta: {}, children };
  app.renderSourceGroupDrawer(source);
  let panel = app.refs.drawerBody;
  const view = app.state.sourceMaps.get(':changing-sample');
  assert.equal(findButton(panel, '补充逻辑关系'), undefined);
  assert.ok(findButton(panel, '重新分析结构'));
  assert.equal(view.zoom, 1, 'opening preserves readable original scale');
  await click(findButton(panel, '+'));
  const zoom = view.zoom, viewport = panel.querySelector('.map-viewport');
  viewport.clientWidth = 630; viewport.clientHeight = 340; viewport.scrollLeft = 55;
  await click(findButton(panel, '展开窗口'));
  assert.equal(view.expanded, true); assert.equal(view.zoom, zoom); assert.equal(viewport.scrollLeft, 55);
  await click(findButton(panel, '恢复窗口'));
  assert.equal(view.expanded, false); assert.equal(view.zoom, zoom);
  await click(findButton(panel, '思维导图')); assert.equal(view.zoom, zoom);
  await click(findButton(panel, '适应窗口')); assert.ok(view.zoom < zoom);
  const frame = viewport.querySelector('.map-frame');
  assert.ok(parseFloat(frame.style.width) <= 630); assert.ok(parseFloat(frame.style.height) <= 340);
  await click(descendants(panel).find(n => n.attributes['aria-label'] === '恢复原始比例'));
  assert.equal(view.zoom, 1);
  await click(descendants(panel).find(n => n.dataset.noteId === 'fresh-7'));
  view.collapsed.add('fresh-0');
  const replacement = { ...source, title: '新的材料标题', children: [{ ...children[0], id: 'another-id', title: '完全不同的内容' }] };
  app.renderSourceGroupDrawer(replacement); panel = app.refs.drawerBody;
  assert.equal(view.selected, 'another-id'); assert.equal(view.collapsed.size, 0);
  assert.match(panel.querySelector('.map-detail').textContent, /完全不同的内容/);
  assert.equal(requests, 0, 'viewing new example content never initiates AI work');
});

test('structure analysis waits for confirmation, ignores cancellation and stale context, and submits once', async () => {
  let requests = 0, practiceId = '', version = 0;
  const source = { id: 'confirm-source', title: '任意示例标题', kind: 'source', meta: {}, children: [{ id: 'child', title: '拆解内容', body: '正文', meta: {} }] };
  const app = browser({ getContext: () => ({ practiceId, version }), sourceStructure: async () => { requests++; return { id: 'job', type: 'structure', state: 'queued', payload: { noteId: source.id } }; } });
  app.renderSourceGroupDrawer(source);
  const submit = findButton(app.refs.drawerBody, '重新分析结构');
  let pending = click(submit);
  assert.equal(requests, 0);
  assert.match(app.dialogs.textContent, /任意示例标题.*AI 服务.*调用费用.*正文保留/);
  await click(submit);
  assert.equal(descendants(app.dialogs).filter(node => node.attributes.role === 'dialog').length, 1);
  await click(findButton(app.dialogs, '取消')); await pending;
  assert.equal(requests, 0); assert.equal(app.processFeedback.status(source.id), null);
  pending = click(submit);
  const dialog = descendants(app.dialogs).find(node => node.attributes.role === 'dialog');
  dialog.events.keydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} }); await pending;
  assert.equal(requests, 0);
  pending = click(submit); practiceId = 'other-library'; version++;
  await click(findButton(app.dialogs, '确认重新分析')); await pending;
  assert.equal(requests, 0); assert.match(app.toasts.textContent, /知识库已切换.*未提交/);
  pending = click(submit);
  await click(findButton(app.dialogs, '确认重新分析')); await pending; await click(submit);
  assert.equal(requests, 1); assert.equal(app.dialogs.children.length, 0);
});

test('both source maps pan with the mouse without selecting nodes after dragging and retain clicks and touch scrolling', async () => {
  const app = browser();
  const source = { id: 'pan-source', title: '合成来源', meta: {}, children: ['a', 'b'].map(id => ({ id, title: id, body: '正文', meta: {} })) };
  app.renderSourceGroupDrawer(source);
  const panel = app.refs.drawerBody, viewport = panel.querySelector('.map-viewport');
  viewport.clientWidth = 400; viewport.clientHeight = 320;
  viewport.getBoundingClientRect = () => ({ left: 0, top: 0 });
  let captured = null;
  viewport.setPointerCapture = id => { captured = id; }; viewport.hasPointerCapture = id => captured === id; viewport.releasePointerCapture = () => { captured = null; };
  const pointer = extra => ({ pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: 180, clientY: 160, target: viewport, preventDefault() {}, ...extra });
  for (const mode of ['逻辑图', '思维导图']) {
    await click(findButton(panel, mode)); viewport.scrollLeft = 100; viewport.scrollTop = 150;
    const selected = app.state.sourceMaps.get(':pan-source').selected;
    viewport.events.pointerdown(pointer({})); viewport.events.pointermove(pointer({ clientX: 120, clientY: 100 }));
    assert.equal(viewport.scrollLeft, 160); assert.equal(viewport.scrollTop, 210); assert.equal(captured, 1);
    assert.equal(app.state.sourceMaps.get(':pan-source').selected, selected);
    viewport.events.pointerup(pointer({ buttons: 0 }));
    let blocked = false;
    viewport.events.click({ detail: 1, preventDefault() {}, stopPropagation() { blocked = true; } });
    assert.equal(blocked, true); assert.equal(captured, null); assert.equal(viewport.classList.contains('is-panning'), false);
    viewport.events.pointerdown(pointer({})); viewport.events.pointermove(pointer({ clientX: 182 })); viewport.events.pointerup(pointer({ buttons: 0 }));
    blocked = false; viewport.events.click({ detail: 1, preventDefault() {}, stopPropagation() { blocked = true; } });
    assert.equal(blocked, false, 'small movements retain normal clicks');
    await click(descendants(panel).find(n => n.dataset.noteId === 'b'));
    assert.match(panel.querySelector('.map-detail').textContent, /b/);
    viewport.scrollLeft = 100;
    viewport.events.pointerdown(pointer({ pointerType: 'touch' })); viewport.events.pointermove(pointer({ pointerType: 'touch', clientX: 50 }));
    assert.equal(viewport.scrollLeft, 100, 'touch remains native scrolling');
    viewport.events.pointerdown(pointer({})); viewport.events.pointermove(pointer({ clientX: 130 })); viewport.events.pointercancel(pointer({}));
    assert.equal(captured, null); assert.equal(viewport.classList.contains('is-panning'), false);
    blocked = false; viewport.events.click({ detail: 0, preventDefault() {}, stopPropagation() { blocked = true; } });
    assert.equal(blocked, false, 'keyboard activation remains available');
    viewport.events.pointerdown(pointer({})); viewport.events.pointerleave();
    viewport.scrollLeft = 90; viewport.events.pointermove(pointer({ clientX: 30 }));
    assert.equal(viewport.scrollLeft, 90, 'leaving before dragging cannot leave a pending gesture');
  }
  await click(findButton(panel, '阅读全部条目')); viewport.scrollLeft = 0;
  viewport.events.pointerdown(pointer({})); viewport.events.pointermove(pointer({ clientX: 90 }));
  assert.equal(viewport.scrollLeft, 0, 'reading cards do not intercept text selection');
});

test('wheel zoom anchors both maps under the pointer, retains selection and leaves reading and browser gestures alone', async () => {
  const app = browser();
  const source = { id: 'wheel-source', title: '可替换的合成示例', meta: {}, children: ['a', 'b', 'c'].map(id => ({ id, title: id, body: '正文', meta: {} })) };
  app.renderSourceGroupDrawer(source);
  const panel = app.refs.drawerBody, viewport = panel.querySelector('.map-viewport'), view = app.state.sourceMaps.get(':wheel-source');
  viewport.clientWidth = 400; viewport.clientHeight = 300;
  viewport.getBoundingClientRect = () => ({ left: 10, top: 20 });
  const prepare = () => {
    const canvas = viewport.querySelector('.map-canvas');
    canvas.getBoundingClientRect = () => ({ left: 10 + Math.max(0, (400 - parseFloat(canvas.style.width) * view.zoom) / 2) - viewport.scrollLeft,
      top: 20 + Math.max(0, (300 - parseFloat(canvas.style.height) * view.zoom) / 2) - viewport.scrollTop });
    return canvas;
  };
  const wheel = (extra = {}) => {
    let prevented = false;
    viewport.events.wheel({ deltaY: -100, deltaMode: 0, clientX: 210, clientY: 170, preventDefault() { prevented = true; }, ...extra });
    return prevented;
  };
  for (const mode of ['逻辑图', '思维导图']) {
    await click(findButton(panel, mode)); await click(findButton(panel, `${Math.round(view.zoom * 100)}%`));
    const canvas = prepare(), selected = view.selected, detail = panel.querySelector('.map-detail').children[0];
    viewport.scrollLeft = 150; viewport.scrollTop = 120;
    const before = canvas.getBoundingClientRect(), x = (210 - before.left) / view.zoom, y = (170 - before.top) / view.zoom;
    assert.equal(wheel(), true); assert.ok(view.zoom > 1);
    const after = canvas.getBoundingClientRect();
    assert.ok(Math.abs((210 - after.left) / view.zoom - x) < 1e-8);
    assert.ok(Math.abs((170 - after.top) / view.zoom - y) < 1e-8);
    assert.equal(view.selected, selected); assert.equal(viewport.querySelector('.map-canvas'), canvas);
    assert.equal(panel.querySelector('.map-detail').children[0], detail, 'zoom does not recreate reading content');
    wheel({ deltaY: 100 }); assert.ok(Math.abs(view.zoom - 1) < 1e-8);
    for (const extra of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { deltaY: 0 }, { deltaY: NaN }, { clientX: 415 }]) {
      const zoom = view.zoom; assert.equal(wheel(extra), false); assert.equal(view.zoom, zoom);
    }
    wheel({ deltaY: -1, deltaMode: 1 }); assert.ok(Math.abs(view.zoom - Math.exp(.032)) < 1e-8);
    wheel({ deltaY: 1, deltaMode: 1 });
    wheel({ deltaY: -1, deltaMode: 2 }); assert.ok(Math.abs(view.zoom - Math.exp(.32)) < 1e-8);
    for (let i = 0; i < 30; i++) wheel();
    assert.equal(view.zoom, 1.8); assert.equal(findButton(panel, '+').disabled, true); assert.equal(wheel(), true);
    for (let i = 0; i < 30; i++) wheel({ deltaY: 100 });
    assert.equal(view.zoom, .15); assert.equal(findButton(panel, '−').disabled, true);
  }
  await click(findButton(panel, '阅读全部条目'));
  const zoom = view.zoom; assert.equal(wheel(), false); assert.equal(view.zoom, zoom);
});

test('task failures explain stored error codes and retain original diagnostics behind a separate disclosure', async () => {
  for (const [code, error, expected] of [
    ['ETIMEDOUT', 'connect ETIMEDOUT 203.0.113.10:443', /连接 AI 服务超时/],
    ['TASK_FAILED', 'connect ETIMEDOUT 203.0.113.10:443', /超时/],
    ['DNS_FAILED', '', /无法找到/], ['ECONNRESET', '', /中断/], ['PRIVACY_LOCAL', '', /外发/],
    ['BUDGET_EXCEEDED', '今日外部调用次数已达到上限。', /今日/], ['BUDGET_UNKNOWN', '', /预算/],
    ['MISSING_CREDENTIALS', '', /尚未准备/], ['SOURCE_CHANGED', '', /变化/], ['MODEL_FORMAT', '', /结果/],
    ['PROVIDER_ERROR', '外部服务返回 401', /拒绝/], ['PROVIDER_ERROR', 'HTTP 429', /限制/], ['UNKNOWN', 'unexpected failure', /暂未完成/],
    ['UNKNOWN', 'value mismatch: 403 records', /暂未完成/],
  ]) {
    const value = describeJobError({ type: 'structure', code, error });
    assert.match(value.title, expected); assert.ok(value.reason); assert.ok(value.next);
  }
  assert.match(describeJobError({ state: 'cancelled', code: 'BUDGET_EXCEEDED' }).title, /已取消/);
  const template = describeJobError({ type: 'process', code: 'RESEARCH_INCOMPLETE', stopCode: 'SEARCH_QUERY_TOO_LONG' });
  assert.match(template.title, /拆解已保存/);
  assert.match(template.reason, /350.*缩短搜索模板/);
  const removed = describeJobError({ type: 'process', code: 'CANDIDATE_REMOVED' });
  assert.match(removed.title, /条目已删除/);
  assert.match(removed.next, /不会恢复已删除候选/);
  const embedding = describeJobError({ type: 'index', code: 'INVALID_RESPONSE', error: '嵌入响应包含无效向量。' });
  assert.match(embedding.title, /索引/); assert.match(embedding.next, /嵌入服务.*测试连接/);
  assert.doesNotMatch(embedding.next, /材料长度|提示词/);
  const citation = describeJobError({ type: 'topics', code: 'INVALID_CITATION', error: '学习包包含不存在的材料。' });
  assert.match(citation.reason, /学习包.*清单以外.*未保存/); assert.doesNotMatch(citation.reason, /无法确定/);
  assert.match(describeJobError({ code: 'PRACTICE_PAUSED' }).title, /练习已暂停/);
  assert.match(describeJobError({ code: 'NOT_FOUND' }).next, /知识库.*冲突/);
  const readable = '当前材料不满足整理条件，请先补充原文。';
  assert.equal(describeJobError({ code: 'INVALID', error: readable }).reason, readable);
  const raw = 'connect ETIMEDOUT 203.0.113.10:443 <script>untrusted()</script>';
  const job = { id: 'failed-structure', type: 'structure', state: 'failed', code: 'ETIMEDOUT', error: raw, payload: { noteId: 'source-a' } };
  let retries = 0;
  const app = browser({ jobs: async () => ({ jobs: [job] }), note: async () => ({ kind: 'source', title: '对应的合成资料' }), jobAction: async () => { retries++; }, bootstrap: async () => ({}) });
  app.state.systemTab = 'jobs';
  const panel = await app.jobsPanel();
  assert.match(panel.querySelector('.job-error-title').textContent, /连接 AI 服务超时/);
  assert.match(panel.querySelector('.call-error').textContent, /网络或代理.*连接恢复后/);
  assert.match(panel.querySelector('.call-error').textContent, /本次失败不会删除原文/);
  assert.doesNotMatch(panel.querySelector('.call-error').textContent, /已有结构建议可继续查看/);
  const technical = panel.querySelector('.job-technical');
  assert.equal(technical.open, false); assert.match(technical.textContent, /ETIMEDOUT.*203\.0\.113/s);
  assert.equal(panel.querySelector('script'), null);
  let pending = click(findButton(panel, '重试')); assert.equal(retries, 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(app.dialogs.textContent, /对应的合成资料/);
  await click(findButton(app.dialogs, '取消')); await pending; assert.equal(retries, 0);
  pending = click(findButton(panel, '重试'));
  await new Promise(resolve => setImmediate(resolve));
  await click(findButton(app.dialogs, '确认重新分析')); await pending; assert.equal(retries, 1);
});

test('structure retries resolve the correct source and discard delayed titles or errors after switching libraries', async () => {
  const jobs = ['first', 'second'].map(id => ({ id, type: 'structure', state: 'failed', code: 'MODEL_FORMAT', payload: { noteId: `source-${id}` } }));
  let reads = 0, retries = 0, resolveNote, rejectNote, practiceId = 'practice-a', version = 0;
  const app = browser({ jobs: async () => ({ jobs }), getContext: () => ({ practiceId, version }),
    note: (id, options) => { reads++; assert.equal(options.background, true); return new Promise((resolve, reject) => { resolveNote = title => resolve({ id, kind: 'source', title }); rejectNote = reject; }); },
    jobAction: async () => { retries++; } });
  const panel = await app.jobsPanel();
  const retryButtons = descendants(panel).filter(node => node.tagName === 'button' && node.textContent === '重试');
  for (let i = 0; i < retryButtons.length; i++) {
    const pending = click(retryButtons[i]); await click(retryButtons[i]);
    assert.equal(reads, i + 1, 'duplicate click does not start a second source read');
    resolveNote(`第 ${i + 1} 份新示例标题`); await new Promise(resolve => setImmediate(resolve));
    assert.match(app.dialogs.textContent, new RegExp(`第 ${i + 1} 份新示例标题`));
    await click(findButton(app.dialogs, '取消')); await pending;
  }
  let pending = click(retryButtons[0]); practiceId = ''; version++; resolveNote('旧练习库标题'); await pending;
  assert.equal(app.dialogs.children.length, 0); assert.equal(retries, 0);
  pending = click(retryButtons[0]); rejectNote(new Error('资料已删除，请在知识库核对。')); await pending;
  assert.equal(app.dialogs.children.length, 0); assert.equal(retries, 0); assert.match(app.toasts.textContent, /资料已删除/);
  const messages = app.toasts.textContent;
  pending = click(retryButtons[1]); practiceId = 'practice-b'; version++; rejectNote(new Error('旧知识库错误')); await pending;
  assert.equal(app.toasts.textContent, messages); assert.equal(app.dialogs.children.length, 0); assert.equal(retries, 0);
});

test('a successful process submit remains locked when the following bootstrap refresh fails', async () => {
  let calls = 0;
  const source = { id: 'synthetic-source', kind: 'source', title: '合成原文', meta: {} };
  const job = { id: 'accepted', type: 'process', state: 'queued', payload: { noteId: source.id }, jobRevision: 'same', jobSnapshot: 2 };
  const app = browser({ processNote: async () => { calls++; return job; }, bootstrap: async () => { throw new Error('合成刷新失败'); } });
  const controls = app.processControls(source); app.refs.drawerBody.replaceChildren(controls);
  await click(findButton(controls, '提交 AI 拆解'));
  assert.equal(findButton(controls, 'AI 拆解处理中…').disabled, true);
  assert.equal(findButton(controls, '联网核验事实与适用条件').disabled, true);
  assert.ok(controls.querySelector('.process-spinner'));
  await click(findButton(controls, '联网核验事实与适用条件'));
  assert.equal(calls, 1, 'even direct invocation cannot submit a second variant after refresh failure');
});

test('process terminal transitions refresh saved source results using a background read', async () => {
  const source = { id: 'synthetic-source', kind: 'source', title: '合成原文', body: '合成原文正文', meta: {}, children: [], jobs: [] };
  const reads = [];
  let result = source;
  const app = browser({ note: async (id, options) => { reads.push({ id, options: plain(options) }); return result; } });
  app.renderSourceGroupDrawer(source); app.refs.drawer.classList.add('is-open');
  const job = { id: 'process', type: 'process', state: 'queued', payload: { noteId: source.id } };
  app.processFeedback.observe({ jobs: [job] });
  for (const state of ['waiting', 'done', 'failed', 'cancelled']) {
    const child = { id: 'child', kind: 'knowledge', title: '已保存结果-' + state, body: '已保存的合成正文', meta: { stage: 'candidate' } };
    result = { ...source, children: [child], jobs: [{ ...job, state }] };
    app.processFeedback.observe({ jobs: [{ ...job, state }] });
    await new Promise(resolve => setImmediate(resolve));
    assert.match(app.refs.drawerBody.textContent, new RegExp(child.title));
    assert.doesNotMatch(app.refs.drawerBody.textContent, /尚未形成拆解/);
    assert.deepEqual(reads.at(-1), { id: source.id, options: { background: true } });
  }
  assert.equal(reads.length, 4);
});

test('completion refresh ignores its old result or error after a library switch', async () => {
  for (const fail of [false, true]) {
    let release, reject, version = 0;
    const source = { id: 'synthetic-source', kind: 'source', title: '合成原文', body: '合成正文', meta: {}, children: [] };
    const app = browser({ getContext: () => ({ practiceId: version ? 'other-library' : '', version }),
      note: () => new Promise((resolve, fail) => { release = resolve; reject = fail; }) });
    app.renderSourceGroupDrawer(source); app.refs.drawer.classList.add('is-open');
    const job = { id: 'process', type: 'process', state: 'queued', payload: { noteId: source.id } };
    app.processFeedback.observe({ jobs: [job] });
    app.processFeedback.observe({ jobs: [{ ...job, state: 'done' }] });
    version++;
    if (fail) reject(new Error('过期返回错误'));
    else release({ ...source, title: '旧知识库返回的标题' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.refs.drawerTitle.textContent, source.title);
    assert.doesNotMatch(app.toasts.textContent, /过期返回错误/);
  }
});

test('learning goals preserve saved depth values and update the concrete requirement when selected', () => {
  const app = browser();
  const goals = [
    ['aware', '了解用途', /有什么用/],
    ['find', '会查资料', /关键词或出处/],
    ['explain', '讲清原理', /不看原文/],
    ['apply', '换场景应用', /不同于原文例子/],
  ];
  for (const [saved, label, requirement] of goals) {
    app.renderNoteEditor({ id: 'synthetic-note', kind: 'knowledge', title: '合成知识', body: '合成正文', meta: { depth: saved } });
    const panel = app.refs.drawerBody;
    const select = control(panel, 'depth');
    const hint = descendants(panel).find(node => node.attributes.id === 'learning-goal-hint');
    assert.match(panel.textContent, /学习目标/);
    assert.match(panel.textContent, /不代表已经掌握/);
    assert.match(hint.textContent, requirement);
    assert.equal(select.attributes['aria-describedby'], hint.attributes.id);
    assert.equal(select.children.find(option => option.selected).value, saved);
    assert.match(select.children.find(option => option.selected).textContent, new RegExp(label));
    assert.deepEqual(select.children.map(option => option.value), goals.map(goal => goal[0]));
    for (const [next, , nextRequirement] of goals) {
      select.value = next;
      select.children.forEach(option => { option.selected = option.value === next; });
      select.events.change();
      assert.match(hint.textContent, nextRequirement);
      assert.equal(app.serializeForm(descendants(panel).find(node => node.tagName === 'form')).depth, next);
    }
  }
});

test('legacy knowledge editors display the effective explain goal while unchanged saves omit defaults', async () => {
  const writes = [], note = { id: 'legacy-goal', kind: 'knowledge', title: '合成缺省目标', body: '合成正文', hash: 'legacy', meta: {} };
  const app = browser({ updateNote: async (id, body) => { writes.push(plain(body)); return note; }, bootstrap: async () => ({}) });
  for (const depth of [undefined, 'unsupported']) {
    app.renderNoteEditor({ ...note, meta: depth ? { depth } : {} });
    const form = app.refs.drawerBody.children[0];
    assert.equal(control(form, 'depth').children.find(option => option.selected).value, 'explain');
    assert.match(descendants(form).find(node => node.attributes.id === 'learning-goal-hint').textContent, /不看原文/);
    await form.events.submit({ preventDefault() {} });
    assert.deepEqual(writes.at(-1).meta, {});
  }
  app.renderNoteEditor(note);
  const changedTitle = app.refs.drawerBody.children[0];
  control(changedTitle, 'title').value = '合成修改后的标题';
  await changedTitle.events.submit({ preventDefault() {} });
  assert.equal(writes.at(-1).title, '合成修改后的标题');
  assert.deepEqual(writes.at(-1).meta, {});
  app.renderNoteEditor(note);
  const changedGoal = app.refs.drawerBody.children[0];
  control(changedGoal, 'depth').children.forEach(option => { option.selected = option.value === 'aware'; });
  await changedGoal.events.submit({ preventDefault() {} });
  assert.deepEqual(writes.at(-1).meta, { depth: 'aware' });
});

test('manual extraction and saved study sessions show the same goal requirements', async () => {
  const app = browser();
  app.manualExtract({ id: 'synthetic-source' });
  const select = control(app.refs.drawerBody, 'depth');
  assert.equal(select.children.find(option => option.selected).value, 'explain');
  assert.match(app.refs.drawerBody.textContent, /学习目标/);
  select.value = 'apply';
  select.events.change();
  assert.match(descendants(app.refs.drawerBody).find(node => node.attributes.id === 'learning-goal-hint').textContent, /不同于原文例子/);
  for (const [depth, oldGoal, label] of [
    ['aware', '知道存在', '了解用途'],
    ['find', '知道去哪找', '会查资料'],
    ['explain', '能够解释', '讲清原理'],
    ['apply', '能够迁移应用', '换场景应用'],
  ]) {
    const session = { id: 'synthetic-session', depth, goal: oldGoal, status: 'reading', material: '合成材料', question: '合成问题', turns: [] };
    const study = browser({ study: async () => session });
    study.state.currentStudy = session;
    assert.match((await study.studySessionPanel()).textContent, new RegExp('本次目标：' + label));
    session.presetCase = 'synthetic-case';
    assert.match((await study.studySessionPanel()).textContent, /预设演示案例/);
  }
});

test('ChatGPT capture and read controls persist independently and disclose the local-material grant', async () => {
  const writes = [];
  let settings = { mcp: { enabled: false, allowProposals: false, chatgptEnabled: false, chatgptAllowRead: false } };
  const app = browser({ settings: async () => settings, prompts: async () => ({ prompts: [] }), updateSettings: async payload => { writes.push(plain(payload)); settings = plain(payload); }, bootstrap: async () => ({ settings }) });
  let panel = await app.settingsPanel();
  assert.equal(control(panel, 'chatgptEnabled').checked, false);
  assert.equal(control(panel, 'chatgptAllowRead').checked, false);
  assert.match(panel.textContent, /包含仅本地资料/); assert.match(panel.textContent, /不会自动建立网页端连接/);
  control(panel, 'chatgptEnabled').checked = true;
  const form = descendants(panel).find(node => node.tagName === 'form');
  await form.events.submit({ preventDefault() {} });
  assert.deepEqual(writes[0].mcp, { enabled: false, allowProposals: false, chatgptEnabled: true, chatgptAllowRead: false });
  panel = await app.settingsPanel(); control(panel, 'chatgptAllowRead').checked = true;
  await descendants(panel).find(node => node.tagName === 'form').events.submit({ preventDefault() {} });
  assert.equal(writes[1].mcp.chatgptAllowRead, true); assert.equal(writes[1].mcp.enabled, false);
  app.state.bootstrap = { settings: { mcp: writes[1].mcp } };
  assert.match(app.noteMeta({ kind: 'source', meta: { privacy: 'local' } }).textContent, /另已授权 ChatGPT 读取/);
  app.state.bootstrap.settings.mcp.chatgptAllowRead = false;
  assert.doesNotMatch(app.noteMeta({ kind: 'source', meta: { privacy: 'local' } }).textContent, /另已授权 ChatGPT 读取/);
});

test('MCP dependent grants clear when their parent is disabled and cannot reappear on re-enabling or saving', async () => {
  const writes = [];
  const app = browser({ settings: async () => ({ mcp: { enabled: false, allowProposals: true, chatgptEnabled: false, chatgptAllowRead: true } }), prompts: async () => ({ prompts: [] }), updateSettings: async payload => writes.push(plain(payload)), bootstrap: async () => ({}) });
  const panel = await app.settingsPanel();
  for (const [parentName, childName] of [['mcpEnabled', 'allowProposals'], ['chatgptEnabled', 'chatgptAllowRead']]) {
    const parent = control(panel, parentName), child = control(panel, childName);
    assert.equal(child.disabled, true); assert.equal(child.checked, false);
    parent.checked = true; parent.events.change();
    assert.equal(child.disabled, false); assert.equal(child.checked, false);
    child.checked = true; parent.checked = false; parent.events.change();
    assert.equal(child.disabled, true); assert.equal(child.checked, false);
    parent.checked = true; parent.events.change();
    assert.equal(child.checked, false);
    parent.checked = false; child.checked = true;
  }
  await descendants(panel).find(node => node.tagName === 'form').events.submit({ preventDefault() {} });
  assert.deepEqual(writes[0].mcp, { enabled: false, allowProposals: false, chatgptEnabled: false, chatgptAllowRead: false });
});

test('core step seven navigates to its saved source and locates the rendered original-text expander', async () => {
  const step = coreSteps[6];
  assert.equal(step.id, 'capture-source');
  const source = { id: 'synthetic-source', kind: 'source', title: '原创虚构测试资料', body: '只用于定位检查的虚构原文。', meta: {}, children: [], jobs: [] };
  const reads = [];
  const app = browser({ note: async id => { reads.push(id); return source; } });
  app.state.view = 'library';
  await app.navigateTutorial(step, { roles: { capturedSource: source.id } });
  assert.deepEqual(reads, [source.id]);
  const targets = descendants(app.refs.drawerBody).filter(node => node.dataset.tour === step.target);
  assert.equal(targets.length, 1, 'the step resolves to one rendered control');
  const target = targets[0];
  assert.equal(target.tagName, 'details', 'locate the expander instead of the entire drawer');
  assert.match(target.querySelector('summary').textContent, /查看原始资料全文/);
  assert.ok(target.textContent.includes(source.body));
});

test('capture research requires AI processing and clears on deselection, clear, and successful save', async () => {
  const writes = [];
  const app = browser({ import: async payload => { writes.push(plain(payload)); return { notes: [{}] }; }, bootstrap: async () => ({}) });
  await app.renderCapture();
  const form = descendants(app.refs.main).find(node => node.tagName === 'form');
  const process = control(form, 'process');
  const research = control(form, 'research');
  assert.equal(research.disabled, true);
  assert.equal(research.checked, false);
  process.checked = true; process.events.change();
  assert.equal(research.disabled, false);
  research.checked = true;
  process.checked = false; process.events.change();
  assert.equal(research.disabled, true);
  assert.equal(research.checked, false);
  process.checked = true; process.events.change();
  assert.equal(research.checked, false);
  research.checked = true;
  click(findButton(form, '清空'));
  await Promise.resolve();
  assert.equal(process.checked, false);
  assert.equal(research.disabled, true);
  assert.equal(research.checked, false);
  process.checked = true; process.events.change(); research.checked = true;
  await form.events.submit({ preventDefault() {} });
  assert.equal(writes[0].process, true);
  assert.equal(writes[0].research, true);
  assert.equal(writes[0].captureMode, 'text');
  assert.equal(process.checked, false);
  assert.equal(research.disabled, true);
  assert.equal(research.checked, false);
  // 即使程序设置了不一致状态，提交也不能携带失效的联网选择。
  research.checked = true;
  await form.events.submit({ preventDefault() {} });
  assert.equal(writes[1].process, false);
  assert.equal(writes[1].research, false);
  const fileInput = descendants(app.refs.main).find(node => node.type === 'file');
  fileInput.files = [{ name: '合成伴读.txt', size: 20, text: async () => '仅测试单文件导入的入口标识。' }];
  fileInput.events.change();
  await click(findButton(app.refs.main, '导入所选文件'));
  assert.equal(writes[2].captureMode, 'files');
  assert.equal(writes[2].items.length, 1);
  assert.equal(writes[2].process, false);
});

test('evidence expands on demand, retains roles and locators, and rejects executable URLs', async () => {
  let reads = 0;
  const app = browser({ evidence: async id => {
    assert.equal(id, 'knowledge-a'); reads++;
    return { researchedAt: '2026-09-20', evidence: [
      { role: 'oppose', title: '反证资料', excerpt: '<script>untrusted()</script>', url: 'https://example.org/evidence', locator: '第 2 段', fetchedAt: '2026-09-19' },
      { role: 'limit', title: '非法地址', excerpt: '保留文本', url: 'javascript:alert(1)' },
    ], limitations: ['样本范围有限'] };
  } });
  const details = app.evidenceDetails('knowledge-a');
  assert.equal(reads, 0);
  details.open = true; details.events.toggle();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 1);
  assert.match(details.textContent, /反对/); assert.match(details.textContent, /第 2 段/);
  assert.match(details.textContent, /样本范围有限/); assert.match(details.textContent, /<script>untrusted/);
  assert.equal(descendants(details).filter(node => node.tagName === 'script').length, 0);
  assert.deepEqual(descendants(details).filter(node => node.tagName === 'a').map(node => node.attributes.href), ['https://example.org/evidence']);
  details.events.toggle(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 1);
});

test('association requests remain local until the user explicitly selects AI analysis', async () => {
  const calls = [];
  const app = browser({ relate: async (id, body) => calls.push({ id, ...body }) });
  const panel = app.relationControls({ id: 'note-a' });
  const checkbox = descendants(panel).find(node => node.tagName === 'input');
  assert.equal(checkbox.checked, false);
  await click(findButton(panel, '查找关联'));
  checkbox.checked = true;
  await click(findButton(panel, '查找关联'));
  assert.deepEqual(plain(calls), [{ id: 'note-a', useAI: false }, { id: 'note-a', useAI: true }]);
});

test('global discovery defaults to local and exploration candidates cannot be accepted as stable relations', async () => {
  const calls = [];
  const app = browser({
    relations: async () => ({ candidates: [{ id: 'candidate-a', state: 'candidate', fromId: 'a', toId: 'b', fromTitle: 'A', toTitle: 'B' }] }),
    discover: async body => { calls.push(body); return { state: 'queued' }; }, bootstrap: async () => ({}),
  });
  const panel = await app.renderRelationsPanel();
  assert.equal(findButton(panel, '接受'), undefined);
  assert.match(panel.textContent, /可探索，尚未确认/);
  await click(findButton(panel, '运行发现检查'));
  descendants(panel).find(node => node.tagName === 'input').checked = true;
  await click(findButton(panel, '运行发现检查'));
  assert.deepEqual(plain(calls), [{ useAI: false }, { useAI: true }]);
});

test('link previews display privacy tightening and block synchronization of manually edited sections', async () => {
  let writes = 0;
  const preview = { before: '原文', body: '新链接', expectedHash: 'v1', changed: true, conflict: true, privacyChanged: true };
  const app = browser({ linksPreview: async () => preview, syncLinks: async () => { writes++; } });
  await app.previewNoteLinks('note-a');
  const panel = app.refs.drawerBody;
  assert.equal(findButton(panel, '确认更新链接').disabled, true);
  assert.match(panel.textContent, /收紧为仅本地/);
  assert.match(panel.textContent, /不会覆盖/);
  assert.equal(writes, 0);
});

test('topic editing submits the visible member order and preserves unchanged prerequisite text', async () => {
  const writes = [];
  const topic = { id: 'topic-a', title: '主题', body: '问题', hash: 'original-hash', meta: { noteIds: ['a', 'b'], prerequisites: '需要先理解边界', minutes: 20 }, members: [], progress: {} };
  const app = browser({
    notes: async () => ({ notes: ['a', 'b', 'c'].map(id => ({ id, title: `知识 ${id}`, kind: 'knowledge', meta: { stage: 'learning' } })) }),
    updateTopic: async (id, body) => { writes.push({ id, body }); return topic; },
    bootstrap: async () => ({}), topics: async () => ({ topics: [topic] }),
  });
  await app.topicEditor(topic, false);
  const form = app.refs.drawerBody.children[0];
  await click(findButton(form, '下移'));
  await click(findButton(form, '加入本包'));
  await form.events.submit({ preventDefault() {} });
  assert.equal(writes.length, 1);
  assert.deepEqual(plain(writes[0].body.meta.noteIds), ['b', 'a', 'c']);
  assert.equal(writes[0].body.meta.prerequisites, '需要先理解边界');
  assert.equal(writes[0].body.expectedHash, 'original-hash');
});

test('splitting a topic creates a new package without updating the original', async () => {
  let created;
  const original = { id: 'original-topic', title: '主题', body: '说明', meta: { noteIds: ['a', 'b'], prerequisites: ['前置知识'] } };
  const copy = { ...original, id: 'new-topic', members: [], progress: {} };
  const app = browser({
    notes: async () => ({ notes: ['a', 'b'].map(id => ({ id, title: id, kind: 'knowledge', meta: {} })) }),
    createTopic: async body => { created = body; return copy; },
    updateTopic: async () => assert.fail('copy must not mutate original package'),
    bootstrap: async () => ({}), topics: async () => ({ topics: [original, copy] }),
  });
  await app.topicEditor(original, true);
  const form = app.refs.drawerBody.children[0];
  await click(findButton(form, '移出本包'));
  await form.events.submit({ preventDefault() {} });
  assert.deepEqual(plain(created.noteIds), ['b']);
  assert.deepEqual(original.meta.noteIds, ['a', 'b']);
});

test('finish is available only after feedback and completed sessions cannot submit another answer', async () => {
  const session = { id: 'study-a', noteId: 'a', depth: 'transfer', goal: '迁移应用', status: 'awaiting_feedback', question: '问题', turns: [{ answer: '我的回答', feedback: { assessment: 'partial', feedback: '条件不足' } }] };
  const app = browser({ study: async () => session });
  app.state.currentStudy = session; app.state.studyMaterialVisible = false;
  let panel = await app.studySessionPanel();
  assert.equal(findButton(panel, '结束本轮练习').disabled, true);
  session.status = 'feedback';
  panel = await app.studySessionPanel();
  assert.equal(findButton(panel, '结束本轮练习').disabled, false);
  assert.match(panel.textContent, /迁移应用/);
  session.pendingJobId = 'pending';
  panel = await app.studySessionPanel();
  assert.equal(findButton(panel, '结束本轮练习').disabled, true);
  delete session.pendingJobId; session.status = 'completed';
  panel = await app.studySessionPanel();
  assert.equal(findButton(panel, '提交回答').disabled, true);
  assert.equal(findButton(panel, '结束本轮练习').disabled, true);
  assert.match(panel.textContent, /本轮练习已结束/);
});

test('answer citations expose their saved underlying sources without another model request', async () => {
  const app = browser(); const container = new Element();
  app.renderAnswer(container, { answer: '观点 [a]', citations: [{ id: 'a', title: '笔记', sources: [{ role: 'support', title: '底层资料', excerpt: '原文证据', url: 'https://example.org/source' }] }] });
  const details = descendants(container).find(node => node.tagName === 'details');
  details.open = true; details.events.toggle();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(details.textContent, /底层资料/); assert.match(details.textContent, /原文证据/);
});

test('enabled AI leaves no literal null notice on study, output or knowledge editing screens', async () => {
  const app = browser({ today: async () => ({ items: [] }), notes: async () => ({ notes: [] }), studySessions: async () => ({ sessions: [] }), drafts: async () => ({ drafts: [] }) });
  app.state.bootstrap = { settings: { ai: { enabled: true } } };
  await app.renderStudy(); assert.doesNotMatch(app.refs.main.textContent, /null/);
  await app.renderOutput(); assert.doesNotMatch(app.refs.main.textContent, /null/);
  app.renderNoteEditor({ id: 'a', kind: 'knowledge', body: '正文', meta: {} });
  assert.doesNotMatch(app.refs.drawerBody.textContent, /null/);
});

test('state shortcut locates the current knowledge actions without changing state or issuing requests', async () => {
  let requests = 0;
  const app = browser({ note: async () => { requests++; }, promoteNote: async () => { requests++; }, updateNote: async () => { requests++; } });
  const note = { id: 'synthetic-child', kind: 'knowledge', title: '当前知识', body: '合成正文', meta: { stage: 'candidate', privacy: 'cloud', depth: 'explain' } };
  app.renderNoteEditor(note, { returnToSourceId: 'synthetic-source' });
  const shortcut = findButton(app.refs.drawerBody, '前往状态操作');
  assert.equal(shortcut.type, 'button');
  await click(shortcut);
  const target = app.refs.drawerBody.querySelector('[data-tour="note-lifecycle"]');
  assert.ok(target);
  assert.equal(target.focused, true);
  assert.equal(target.scrollOptions.block, 'center');
  assert.equal(app.refs.drawerTitle.textContent, note.title);
  assert.ok(findButton(target, '加入学习'));
  assert.equal(app.refs.drawerBody.querySelector('form'), null);
  assert.equal(requests, 0);
  assert.equal(note.meta.stage, 'candidate');
});

test('state shortcut cancellation retains every unsaved field and explicit discard navigates', async () => {
  const app = browser();
  const note = { id: 'synthetic-draft', kind: 'knowledge', title: '标题', body: '正文', meta: {} };
  app.renderNoteEditor(note);
  const form = app.refs.drawerBody.children[0];
  for (const [name, value] of [['title', '未保存标题'], ['body', '未保存正文'], ['privacy', 'cloud'], ['topic', '未保存主题'], ['depth', 'aware']]) {
    const input = control(form, name), original = input.value;
    if (name === 'body') input.textContent = value; else input.value = value;
    const before = JSON.stringify(app.serializeForm(form));
    const pending = click(findButton(form, '前往状态操作'));
    assert.match(app.dialogs.textContent, /当前修改尚未保存/);
    await click(findButton(app.dialogs, '取消')); await pending;
    assert.equal(app.refs.drawerBody.children[0], form);
    assert.equal(JSON.stringify(app.serializeForm(form)), before);
    if (name === 'body') input.textContent = note.body; else input.value = original;
  }
  control(form, 'title').value = '明确放弃的修改';
  const pending = click(findButton(form, '前往状态操作'));
  await click(findButton(app.dialogs, '放弃修改并前往')); await pending;
  assert.ok(app.refs.drawerBody.querySelector('[data-tour="note-lifecycle"]'));
  assert.equal(app.refs.drawerTitle.textContent, note.title);
});

test('state shortcut ignores stale confirmations after switching libraries or opening another editor', async () => {
  let version = 0;
  const app = browser({ getContext: () => ({ practiceId: version ? 'another' : 'first', version }) });
  const note = { id: 'synthetic-old', kind: 'knowledge', title: '旧内容', body: '正文', meta: {} };
  for (const change of ['library', 'editor']) {
    app.renderNoteEditor(note);
    const form = app.refs.drawerBody.children[0];
    control(form, 'title').value = '未保存';
    const pending = click(findButton(form, '前往状态操作'));
    if (change === 'library') version++;
    else app.renderNoteEditor({ ...note, id: 'synthetic-new', title: '另一条内容' });
    const current = app.refs.drawerBody.children[0];
    await click(findButton(app.dialogs, '放弃修改并前往')); await pending;
    assert.equal(app.refs.drawerBody.children[0], current);
    assert.equal(app.refs.drawerBody.dataset.tour, 'note-editor');
  }
  for (const kind of ['source', 'mistake']) {
    app.renderNoteEditor({ ...note, kind });
    assert.equal(findButton(app.refs.drawerBody, '前往状态操作'), undefined);
  }
});

test('source research interval defaults to 30, validates 1–365 whole days and saves a numeric value', async () => {
  const writes = [];
  const source = { id: 'source-a', kind: 'source', title: '资料', body: '原文', hash: 'v1', meta: {} };
  const app = browser({ updateNote: async (id, body) => { writes.push({ id, body }); return source; }, bootstrap: async () => ({}) });
  app.renderNoteEditor(source);
  const form = app.refs.drawerBody.children[0], days = control(form, 'researchIntervalDays');
  assert.equal(days.value, 30); assert.equal(days.attributes.min, '1'); assert.equal(days.attributes.max, '365');
  assert.match(form.textContent, /仅在后续成功核验时生效/);
  for (const invalid of ['0', '366', '1.5', '']) { days.value = invalid; await form.events.submit({ preventDefault() {} }); }
  assert.equal(writes.length, 0);
  days.value = '90'; await form.events.submit({ preventDefault() {} });
  assert.equal(writes.length, 1); assert.equal(writes[0].body.meta.researchIntervalDays, 90);
  assert.equal(writes[0].body.expectedHash, 'v1');
});

test('saving an untouched source editor submits no display defaults; actual changed fields still persist', async () => {
  const source = { id: 'source-noop', kind: 'source', title: '合成来源', body: '合成原文', hash: 'original', meta: { privacy: 'cloud' } };
  const writes = [];
  const app = browser({ updateNote: async (id, body) => { writes.push(plain(body)); return source; }, bootstrap: async () => ({}) });
  app.renderNoteEditor(source);
  await app.refs.drawerBody.children[0].events.submit({ preventDefault() {} });
  assert.deepEqual(writes[0].meta, {});
  assert.equal(writes[0].expectedHash, source.hash);
  assert.match(app.toasts.textContent, /内容未改变/);
  app.renderNoteEditor(source);
  const form = app.refs.drawerBody.children[0];
  control(form, 'author').value = '合成作者';
  await form.events.submit({ preventDefault() {} });
  assert.deepEqual(writes[1].meta, { author: '合成作者' });
  app.renderNoteEditor({ ...source, meta: {} });
  await app.refs.drawerBody.children[0].events.submit({ preventDefault() {} });
  assert.deepEqual(writes[2].meta, {}, 'an implicit local privacy default is not a source edit');
  app.renderNoteEditor({ ...source, meta: {} });
  const localForm = app.refs.drawerBody.children[0];
  control(localForm, 'privacy').children.forEach(option => { option.selected = option.value === 'cloud'; });
  await localForm.events.submit({ preventDefault() {} });
  assert.deepEqual(writes[3].meta, { privacy: 'cloud' }, 'an actual privacy change remains explicit');
});

test('empty daily plans show the actual reasons with working knowledge and budget entry points', async () => {
  const note = { id: 'missing', kind: 'knowledge', title: '合成待学项', body: '合成正文', meta: {} };
  const source = { id: 'source', kind: 'source', title: '合成原文', body: '合成正文', meta: {} };
  const prerequisite = { ...note, id: 'prerequisite', title: '合成前置知识' };
  const app = browser({ generateToday: async () => ({ items: [], unavailable: [{ noteId: note.id, title: note.title, sourceId: source.id, code: 'material', reason: '底层原始资料已修改或删除，需要重新加工。' }, { noteId: 'dependent', title: '合成后续', prerequisiteId: prerequisite.id, prerequisiteTitle: prerequisite.title, code: 'prerequisite', reason: '请先处理前置知识。' }] }), note: async id => id === source.id ? source : id === prerequisite.id ? prerequisite : note });
  app.state.bootstrap = { today: { items: [] } };
  await app.generateToday();
  const panel = app.refs.main;
  assert.match(panel.textContent, /未安排的原因.*原始资料已修改/);
  assert.equal(panel.querySelector('details').open, true);
  assert.match(app.toasts.textContent, /本次没有待学项/);
  assert.ok(findButton(panel, '调整预算'));
  await click(findButton(panel, '查看知识'));
  assert.equal(app.refs.drawerTitle.textContent, note.title);
  assert.ok(findButton(app.refs.drawerBody, '加入学习'));
  await click(findButton(panel, '查看原文并重新加工'));
  assert.equal(app.refs.drawerTitle.textContent, source.title);
  assert.ok(findButton(app.refs.drawerBody, '提交 AI 拆解'));
  await click(findButton(panel, `查看前置知识：${prerequisite.title}`));
  assert.equal(app.refs.drawerTitle.textContent, prerequisite.title);
});

test('alignment API routes preserve explicit options and write requests use the session CSRF token', async () => {
  const savedFetch = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body && JSON.parse(options.body), csrf: options.headers?.get?.('X-CSRF-Token') });
    return new Response(JSON.stringify(url === '/api/session' ? { csrf: 'test-session-only' } : {}), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const { api } = await import('../public/api.mjs?alignment-test');
    await api.evidence('a/b'); await api.relate('a/b', { useAI: false });
    await api.finishStudy('study a'); await api.updateIndex(); await api.discover({ useAI: false });
    await api.recommendationAction('suggestion/a', { action: 'dismiss' });
    await api.linksPreview('a/b'); await api.syncLinks('a/b', { expectedHash: 'old' });
    const writes = calls.filter(call => call.method === 'POST');
    assert.deepEqual(writes.map(call => call.url), ['/api/notes/a%2Fb/relate', '/api/study/study%20a/finish', '/api/index/update', '/api/discover', '/api/recommendations/suggestion%2Fa/action', '/api/notes/a%2Fb/links-sync']);
    assert.ok(writes.every(call => call.csrf === 'test-session-only'));
    assert.deepEqual(writes[0].body, { useAI: false });
  } finally { globalThis.fetch = savedFetch; }
});


test('saving capabilities after moving budgets does not submit or reset budget values', async () => {
  const saves=[];
  const app=browser({ settings:async()=>({ ai:{dailyCallLimit:77,monthlyBudget:88}, embedding:{}, search:{}, fetch:{}, mcp:{}, timezone:'Asia/Shanghai' }), prompts:async()=>({prompts:[]}), updateSettings:async p=>saves.push(p), bootstrap:async()=>({}) });
  const panel=await app.settingsPanel();
  assert.equal(control(panel,'dailyCallLimit'),undefined); assert.equal(control(panel,'monthlyBudget'),undefined);
  const form=descendants(panel).find(node=>node.tagName==='form');
  await form.events.submit({preventDefault(){}});
  assert.equal(saves.length,1); assert.equal(Object.hasOwn(saves[0].ai,'dailyCallLimit'),false); assert.equal(Object.hasOwn(saves[0].ai,'monthlyBudget'),false);
});

for (const step of flatSteps) test('tutorial target is rendered for ' + step.id, async () => {
  const fixture = tutorialFixture(step);
  const app = browser(fixture.api);
  app.state.bootstrap = fixture.bootstrap;
  app.state.view = 'unrendered';
  const result = await app.navigateTutorial(step, { roles: fixture.roles });
  if (step.target.startsWith('nav-') || step.focusTarget?.startsWith('onboarding-')) return; // Static index.html navigation is covered by sidebar tests.
  const targets = [...descendants(app.refs.main), ...(app.refs.drawer.classList.contains('is-open') ? descendants(app.refs.drawerBody) : [])].filter(node => node.dataset.tour === (result?.target || step.focusTarget || step.target));
  assert.ok(targets.length, step.id + ' has no rendered target: ' + (step.focusTarget || step.target) + '\n' + app.refs.main.textContent.slice(0, 180));
});

test('missing practice prerequisites point to a concrete entry without starting work', async () => {
  for (const [stepId, expected] of [['capture-permission', 'capture-save'], ['topic-edit', 'topic-create'], ['review-hint', 'onboarding-case']]) {
    const fixture = tutorialFixture();
    const app = browser(fixture.api);
    const result = await app.navigateTutorial(flatSteps.find(step => step.id === stepId), { roles: {} });
    assert.equal(result.prerequisite || result.target, expected);
    assert.equal(fixture.reads.length, 0);
  }
});

test('study locating respects reading, missing sessions, and the tutorial knowledge identity', async () => {
  const fixture = tutorialFixture({ id: 'study-hide' });
  const app = browser(fixture.api); app.state.bootstrap = fixture.bootstrap;
  const step = flatSteps.find(step => step.id === 'study-answer');
  const result = await app.navigateTutorial(step, { roles: fixture.roles });
  assert.equal(result.target, 'study-hide');
  assert.equal(app.state.studyMaterialVisible, true, 'locating must not record hiding or submitting for the user');
  fixture.sessions.splice(0, fixture.sessions.length, { id: 'other-session', noteId: 'unrelated-note' });
  app.state.currentStudy = null;
  const missing = await app.navigateTutorial(step, { roles: fixture.roles });
  assert.equal(missing.target, 'study-queue');
  assert.equal(app.state.currentStudy, null, 'an unrelated session must not become the tutorial target');
  assert.ok(fixture.reads.every(read => ['studySessions', 'study', 'today', 'notes'].includes(read.name)));
});

test('output locating opens saved drafts and citations, preserves edits, and handles no drafts', async () => {
  const fixture = tutorialFixture();
  const app = browser(fixture.api); app.state.bootstrap = fixture.bootstrap;
  await app.navigateTutorial(flatSteps.find(step => step.id === 'output-citations'), { roles: fixture.roles });
  assert.match(app.refs.main.querySelector('[data-tour="output-result"]').textContent, /虚构草稿/);
  const step = flatSteps.find(step => step.id === 'output-edit');
  await app.navigateTutorial(step, { roles: fixture.roles });
  const editor = app.refs.drawerBody.querySelector('[data-tour="draft-body"]');
  editor.value = '用户尚未保存的输入';
  await app.navigateTutorial(step, { roles: fixture.roles });
  assert.equal(app.refs.drawerBody.querySelector('[data-tour="draft-body"]'), editor);
  assert.equal(editor.value, '用户尚未保存的输入');
  fixture.drafts.unshift({ ...fixture.drafts[0], id: 'new-draft', body: '新一份草稿' });
  await app.navigateTutorial(step, { roles: fixture.roles });
  assert.equal(app.refs.drawerBody.dataset.tourSubject, 'new-draft');
  assert.match(app.refs.drawerBody.querySelector('[data-tour="draft-body"]').textContent, /新一份草稿/);
  fixture.drafts.length = 0;
  assert.equal((await app.navigateTutorial(step, { roles: fixture.roles })).target, 'output-form');
  assert.equal(app.refs.drawer.classList.contains('is-open'), false);
  const empty = browser({ ...fixture.api, drafts: async () => ({ drafts: [] }) }); empty.state.bootstrap = fixture.bootstrap;
  assert.equal((await empty.navigateTutorial(step, { roles: fixture.roles })).target, 'output-form');
  assert.ok(fixture.reads.every(read => read.name === 'drafts'));
});

test('scenario output locating keeps the tracked draft instead of newer unrelated drafts', async () => {
  const fixture = tutorialFixture();
  fixture.roles.draft = fixture.drafts[0].id;
  fixture.drafts.unshift({ ...fixture.drafts[0], id: 'unrelated-draft', body: '不属于本次材料的较新草稿' });
  const app = browser(fixture.api); app.state.bootstrap = fixture.bootstrap;
  const tutorial = { materialId: 'reading', roles: fixture.roles };
  const editStep = flatSteps.find(step => step.id === 'output-edit');
  await app.navigateTutorial(editStep, tutorial);
  assert.equal(app.refs.drawerBody.dataset.tourSubject, fixture.roles.draft);
  const editor = app.refs.drawerBody.querySelector('[data-tour="draft-body"]');
  editor.value = '本次草稿尚未保存的修改';
  await app.navigateTutorial(editStep, tutorial);
  assert.equal(app.refs.drawerBody.querySelector('[data-tour="draft-body"]'), editor);
  assert.equal(editor.value, '本次草稿尚未保存的修改');
  app.state.lastOutput = { draftId: 'unrelated-draft', answer: '其他材料的旧输出' };
  await app.navigateTutorial(flatSteps.find(step => step.id === 'output-citations'), tutorial);
  const result = app.refs.main.querySelector('[data-tour="output-result"]').textContent;
  assert.match(result, /虚构草稿/);
  assert.doesNotMatch(result, /其他材料的旧输出|不属于本次材料/);
  fixture.drafts.splice(fixture.drafts.findIndex(draft => draft.id === fixture.roles.draft), 1);
  assert.equal((await app.navigateTutorial(editStep, tutorial)).target, 'output-form');
  assert.equal(app.refs.drawer.classList.contains('is-open'), false);
  assert.ok(fixture.reads.every(read => read.name === 'drafts'));
});

test('a failed new output request cannot restore a previous successful answer', async () => {
  const fixture = tutorialFixture(); let reject = false;
  const app = browser({ ...fixture.api, ask: async () => { if (reject) throw new Error('受控失败'); return { answer: '上一轮旧答案' }; } });
  app.state.bootstrap = fixture.bootstrap;
  await app.renderOutput();
  const form = app.refs.main.querySelector('[data-tour="output-form"]');
  await form.events.submit({ preventDefault() {} });
  assert.equal(app.state.lastOutput.answer, '上一轮旧答案');
  reject = true;
  await form.events.submit({ preventDefault() {} });
  assert.equal(app.state.lastOutput, null);
  await app.renderOutput();
  assert.doesNotMatch(app.refs.main.querySelector('[data-tour="output-result"]').textContent, /上一轮旧答案/);
});

test('topic locating preserves only the matching subject and create or edit mode', async () => {
  const fixture = tutorialFixture(); const app = browser(fixture.api); app.state.bootstrap = fixture.bootstrap;
  const locate = id => app.navigateTutorial(flatSteps.find(step => step.id === id), { roles: fixture.roles });
  await locate('topic-edit');
  const editForm = app.refs.drawerBody.children[0];
  await locate('topic-edit');
  assert.equal(app.refs.drawerBody.children[0], editForm);
  await locate('topic-create');
  assert.equal(app.refs.drawerBody.dataset.tourMode, 'create');
  assert.equal(app.refs.drawerBody.dataset.tourSubject, '');
  assert.notEqual(app.refs.drawerBody.children[0], editForm);
  const createForm = app.refs.drawerBody.children[0];
  await locate('topic-create');
  assert.equal(app.refs.drawerBody.children[0], createForm);
  await locate('topic-edit');
  assert.equal(app.refs.drawerBody.dataset.tourMode, 'edit');
  assert.equal(app.refs.drawerBody.dataset.tourSubject, fixture.roles.createdTopic);
  await app.topicEditor({ id: 'unrelated-topic', title: '其他主题', meta: {} }, true);
  assert.equal((await locate('topic-copy'))?.target, undefined);
  assert.equal(app.refs.drawerBody.dataset.tour, 'topic-detail');
});

test('deleted seed notes point to explicit reset while captures and cases can be recreated', async () => {
  for (const [noteRole, caseId, expected] of [['explain', null, 'onboarding-reset'], ['find', null, 'onboarding-reset'], ['source', null, 'onboarding-reset'], ['capturedSource', null, 'capture-save'], ['versionNote', 'versions', 'onboarding-case']]) {
    const fixture = tutorialFixture();
    const app = browser({ ...fixture.api, note: async () => { throw Object.assign(new Error('已删除'), { status: 404 }); } });
    app.state.view = 'library';
    const step = { id: 'missing-test', noteRole, caseId, target: 'note-editor', view: 'library' };
    for (const roles of [fixture.roles, {}]) {
      const result = await app.navigateTutorial(step, { roles });
      assert.equal(result.prerequisite || result.target, expected);
    }
  }
});

test('feedback locating refreshes the same session and preserves an unsaved answer', async () => {
  const fixture = tutorialFixture(); const session = fixture.sessions[0];
  session.status = 'awaiting_feedback'; session.turns[0].feedback = null;
  const app = browser(fixture.api); app.state.bootstrap = fixture.bootstrap;
  const step = flatSteps.find(step => step.id === 'study-feedback');
  assert.equal((await app.navigateTutorial(step, { roles: fixture.roles })).target, 'study-session');
  app.refs.main.querySelector('[data-tour="study-answer"]').value = '尚未提交的补充';
  session.status = 'feedback'; session.turns[0].feedback = { assessment: 'partial', feedback: '刚刚返回的反馈' };
  assert.equal(await app.navigateTutorial(step, { roles: fixture.roles }), undefined);
  assert.match(app.refs.main.querySelector('[data-tour="study-feedback"]').textContent, /刚刚返回的反馈/);
  assert.equal(app.refs.main.querySelector('[data-tour="study-answer"]').value, '尚未提交的补充');
});

test('deleted topic list actions return to creation instead of framing an empty list', async () => {
  const fixture = tutorialFixture(); const app = browser({ ...fixture.api, topics: async () => ({ topics: [] }) });
  for (const id of ['topic-pause', 'topic-resume']) {
    const result = await app.navigateTutorial(flatSteps.find(step => step.id === id), { roles: fixture.roles });
    assert.equal(result.prerequisite, 'topic-create');
  }
});

test('failed topic loading keeps the previous editor identity and retry loads the requested form', async () => {
  const fixture = tutorialFixture(); let fail = false;
  const app = browser({ ...fixture.api, notes: async (...args) => { if (fail) throw new Error('受控读取失败'); return fixture.api.notes(...args); } });
  app.state.bootstrap = fixture.bootstrap;
  await app.navigateTutorial(flatSteps.find(step => step.id === 'topic-edit'), { roles: fixture.roles });
  const original = app.refs.drawerBody.children[0];
  fail = true;
  const step = flatSteps.find(step => step.id === 'topic-create');
  await assert.rejects(app.navigateTutorial(step, { roles: fixture.roles }), /受控读取失败/);
  assert.equal(app.refs.drawerBody.dataset.tourMode, 'edit');
  assert.equal(app.refs.drawerBody.dataset.tourSubject, fixture.roles.createdTopic);
  assert.equal(app.refs.drawerBody.children[0], original);
  fail = false;
  await app.navigateTutorial(step, { roles: fixture.roles });
  assert.equal(app.refs.drawerBody.dataset.tourMode, 'create');
  assert.equal(app.refs.drawerBody.dataset.tourSubject, '');
  assert.notEqual(app.refs.drawerBody.children[0], original);
});

test('study confirmation reuses only the matching session form', async () => {
  const fixture = tutorialFixture(); const app = browser(fixture.api); app.state.bootstrap = fixture.bootstrap;
  const step = flatSteps.find(step => step.id === 'study-confirm');
  await app.navigateTutorial(step, { roles: fixture.roles });
  app.confirmUnderstanding(fixture.sessions[0]);
  const form = app.refs.drawerBody.children[0];
  assert.equal((await app.navigateTutorial(step, { roles: fixture.roles })).target, 'note-confirm');
  assert.equal(app.refs.drawerBody.children[0], form);
  app.confirmUnderstanding({ ...fixture.sessions[0], id: 'unrelated-session' });
  await app.navigateTutorial(step, { roles: fixture.roles });
  assert.equal(app.refs.drawer.classList.contains('is-open'), false);
  app.confirmDirect(fixture.notes.find(note => note.id === fixture.roles.explain));
  await app.navigateTutorial(step, { roles: fixture.roles });
  assert.equal(app.refs.drawer.classList.contains('is-open'), false, 'direct confirmation is not session confirmation');
});
