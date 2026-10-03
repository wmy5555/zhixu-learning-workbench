import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createProcessFeedback } from '../public/process-feedback.mjs';
import { initSidebar } from '../public/sidebar.mjs';
import { coreSteps, flatSteps } from '../public/onboarding-curriculum.mjs';

import { tutorialFixture } from './fixtures/tutorial-ui.mjs';
const usageSource = await readFile(new URL('../public/usage.mjs', import.meta.url), 'utf8');

const uiSource = await readFile(new URL('../public/ui.mjs', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../public/app.mjs', import.meta.url), 'utf8');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.events = {}; this.attributes = {};
    this.value = ''; this.type = ''; this.name = ''; this.disabled = false; this.checked = false; this.selected = false;
    this.open = false; this.dataset = {}; this.style = { setProperty() {} }; this._text = '';
    this.classList = { add: name => { this.className = (this.className || '') + ' ' + name; }, remove: name => { this.className = (this.className || '').split(' ').filter(item => item !== name).join(' '); }, contains: name => (this.className || '').split(' ').includes(name), toggle() {} };
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent ?? String(child)).join(''); }
  append(...children) { this.children.push(...children.map(child => { if (child instanceof Element) return child; const text = new Element('text'); text.textContent = String(child); return text; })); }
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
  focus() {}
  remove() {}
  cloneNode() { return this; }
}
function descendants(node) { return [node, ...node.children.flatMap(child => child instanceof Element ? descendants(child) : [])]; }
function matches(node, selector) {
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
  vm.runInContext(uiSource.replaceAll('export ', '') + '\n' + usageSource.replace(/^import.*;$/m, '').replaceAll('export ', '') + '\n' + stripped + '\nthis.app = { confirmDirect, confirmUnderstanding, noteMeta, renderCurrent, openDraft, navigateTutorial, renderCapture, evidenceDetails, relationControls, renderRelationsPanel, topicEditor, renderStudy, renderOutput, renderNoteEditor, studySessionPanel, renderAnswer, recommendationsPanel, previewNoteLinks, diagnosticsPanel, settingsPanel, todayItem, state, refs };', context);
  context.app.manualExtract = vm.runInContext('manualExtract', context);
  context.app.serializeForm = vm.runInContext('serializeForm', context);
  context.app.processControls = vm.runInContext('processControls', context);
  context.app.refreshBootstrap = vm.runInContext('refreshBootstrap', context);
  context.app.toasts = document.querySelector('#toast-region');
  return context.app;
}

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
  assert.equal(process.checked, false);
  assert.equal(research.disabled, true);
  assert.equal(research.checked, false);
  // 即使程序设置了不一致状态，提交也不能携带失效的联网选择。
  research.checked = true;
  await form.events.submit({ preventDefault() {} });
  assert.equal(writes[1].process, false);
  assert.equal(writes[1].research, false);
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
