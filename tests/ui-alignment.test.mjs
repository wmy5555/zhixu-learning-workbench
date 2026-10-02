import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const uiSource = await readFile(new URL('../public/ui.mjs', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../public/app.mjs', import.meta.url), 'utf8');

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
  replaceChildren(...children) { this._text = ''; this.children = []; this.append(...children); }
  addEventListener(name, handler) { this.events[name] = handler; }
  setAttribute(name, value) { this.attributes[name] = value; }
  querySelectorAll(selector) { return descendants(this).slice(1).filter(node => matches(node, selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  focus() {}
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
    api, document, Node: Element, URL, Intl, Date, Map, Set, crypto: { randomUUID: () => 'request-ui' },
    FormData: class {
      constructor(form) { this.form = form; }
      entries() { return descendants(this.form).filter(node => node.name && !node.disabled && ['input', 'textarea', 'select'].includes(node.tagName)).map(node => [node.name, String(node.tagName === 'textarea' ? node.textContent : node.tagName === 'select' ? node.children.find(option => option.selected)?.value || '' : node.value)]); }
    },
    ApiError: class extends Error {}, startSession: async () => {},
    window: { history: { replaceState() {} }, location: { hash: '' }, setTimeout() {}, addEventListener() {} },
  });
  const stripped = appSource.replace(/import[\s\S]*?from "\.\/api\.mjs";\s*/, '').replace(/import[\s\S]*?from "\.\/ui\.mjs";\s*/, '').replace(/^init\(\);\s*$/m, '');
  vm.runInContext(uiSource.replaceAll('export ', '') + '\n' + stripped + '\nthis.app = { settingsPanel, noteMeta, evidenceDetails, relationControls, renderRelationsPanel, topicEditor, renderStudy, renderOutput, renderNoteEditor, studySessionPanel, renderAnswer, recommendationsPanel, previewNoteLinks, diagnosticsPanel, todayItem, state, refs };', context);
  return context.app;
}

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
