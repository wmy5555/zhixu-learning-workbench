import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createAndroidBrowser, control, descendants, findButton, click } from './fixtures/android-browser.mjs';

const capabilities = { ai: false, search: false, fetch: false, onlineResearch: false };
test('Android AI default closed and research dependency clears selection on disable/reset', async () => {
  const f = await createAndroidBrowser(); f.app.state.bootstrap = { capabilities: { ...capabilities } };
  await f.app.renderCapture(); let form = f.app.refs.main.querySelector('form');
  let process = control(form, 'process'), research = control(form, 'research');
  assert.equal(process.disabled, true); assert.equal(research.disabled, true);
  f.app.state.bootstrap.capabilities = { ai: true, search: false, fetch: false, onlineResearch: false };
  await f.app.renderCapture(); form = f.app.refs.main.querySelector('form'); process = control(form, 'process'); research = control(form, 'research');
  assert.equal(process.disabled, false); process.checked = true; process.events.change(); assert.equal(research.disabled, true);
  f.app.state.bootstrap.capabilities.onlineResearch = true; process.events.change(); assert.equal(research.disabled, false);
  research.checked = true; process.checked = false; process.events.change(); assert.equal(research.checked, false); assert.equal(research.disabled, true);
  process.checked = true; process.events.change(); assert.equal(research.checked, false);
  research.checked = true; form.reset(); await Promise.resolve(); assert.equal(research.checked, false); assert.equal(research.disabled, true);
});

test('Android settings write credentials only, clear password inputs even on save failure', async () => {
  let sent;
  const f = await createAndroidBrowser({ api: { mainSettings: async () => ({ revision: 4, ai: { hasKey: true }, search: {}, fetch: {} }), androidGuide: async () => ({ steps: [] }), settings: async () => ({}), updateMainSettings: async payload => { sent = structuredClone(payload); throw new Error('controlled failure'); } } });
  await f.app.renderSystem(); const key = control(f.app.refs.main, 'ai_credential');
  assert.equal(key.value, ''); key.value = 'synthetic-not-a-real-key';
  const form = descendants(f.app.refs.main).find(node => node.tagName === 'form' && control(node, 'ai_credential'));
  await form.events.submit({ preventDefault() {} });
  assert.equal(sent.credentials.model, 'synthetic-not-a-real-key'); assert.equal(sent.expectedRevision, 4); assert.equal(key.value, '');
  assert.equal(sent.ai.apiKey, undefined); assert.equal(f.context.localStorage.getItem('synthetic-not-a-real-key'), null);
  key.value = 'discard'; const remove = control(form, 'ai_clearKey'); remove.checked = true; remove.events.change(); assert.equal(key.value, ''); assert.equal(key.disabled, true);
  await form.events.submit({ preventDefault() {} }); assert.equal(sent.clearCredentials.model, true); assert.equal(sent.credentials.model, undefined);
});

test('unknown job only retries after explicit possible duplicate fee confirmation', async () => {
  const calls = []; const f = await createAndroidBrowser({ confirmations: [false, true], api: { jobs: async () => ({ jobs: [{ id: 'unknown-job', type: 'ask', state: 'waiting', code: 'REQUEST_UNKNOWN', error: '结果未知' }] }), jobAction: async (id, body) => { calls.push({ id, body }); }, bootstrap: async () => ({ capabilities }), androidGuide: async () => ({ steps: [] }), settings: async () => ({}) } });
  f.app.state.systemTab = 'jobs'; await f.app.renderSystem();
  await click(findButton(f.app.refs.main, '重新请求（可能重复计费）')); assert.equal(calls.length, 0);
  await click(findButton(f.app.refs.main, '重新请求（可能重复计费）')); assert.equal(calls.length, 1); assert.equal(calls[0].body.confirmUnknown, true); assert.match(f.context.confirmPrompts[0].message, /第二笔费用/);
});

test('local transport ApiError preserves status code detail and requestId', async () => {
  const source = await readFile(new URL('../apps/android/web/api.mjs', import.meta.url), 'utf8');
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const detail = { state: 'unknown', requestId: 'synthetic-request' };
  module.configureLocalTransport({ runtime: { kind: 'android-prototype' }, startSession: async () => ({}), request: async () => { throw Object.assign(new Error('结果未知'), { status: 409, code: 'REQUEST_UNKNOWN', detail, requestId: detail.requestId }); } });
  await assert.rejects(module.api.ask({}), error => error.status === 409 && error.code === 'REQUEST_UNKNOWN' && error.detail === detail && error.requestId === detail.requestId);
});
test('invalid disabled capture AI and research selections cannot reach submitted payload', async () => {
  let payload; const f = await createAndroidBrowser({ api: { import: async body => { payload = body; return { notes: [] }; }, bootstrap: async () => ({ capabilities }) } });
  f.app.state.bootstrap = { capabilities }; await f.app.renderCapture(); const form = f.app.refs.main.querySelector('form');
  control(form, 'title').value = '合成资料'; control(form, 'body').value = '本地原文'; control(form, 'process').checked = true; control(form, 'research').checked = true;
  await form.events.submit({ preventDefault() {} });
  assert.equal(payload.process, false); assert.equal(payload.research, false); assert.equal(payload.items[0].privacy, 'local');
});

test('Android structure reanalysis is closed without AI and explicitly confirmed then starts one queued job', async () => {
  const calls = []; const source = { id: 'synthetic-source', kind: 'source', title: '合成原文', body: '原文', meta: { privacy: 'local' }, children: [{ id: 'child', kind: 'knowledge', title: '已有知识', body: '保留正文', meta: { claimType: 'opinion' } }], structure: { state: 'stale', edges: [] } };
  const f = await createAndroidBrowser({ confirmations: [false, true], api: { sourceStructure: async id => { calls.push(['structure', id]); return { id: 'synthetic-job', state: 'queued', type: 'structure' }; }, runOnlineJob: async id => { calls.push(['run', id]); } } });
  f.app.state.bootstrap = { capabilities }; f.app.renderSourceGroupDrawer(source);
  assert.equal(findButton(f.app.refs.drawerBody, '重新分析结构').disabled, true);
  f.app.state.bootstrap.capabilities = { ai: true }; f.app.renderSourceGroupDrawer(source);
  assert.equal(findButton(f.app.refs.drawerBody, '重新分析结构').disabled, false);
  assert.match(f.app.refs.drawerBody.textContent, /旧结构仅供阅读/);
  await click(findButton(f.app.refs.drawerBody, '重新分析结构')); assert.equal(calls.length, 0);
  await click(findButton(f.app.refs.drawerBody, '重新分析结构')); assert.deepEqual(calls, [['structure', source.id], ['run', 'synthetic-job']]);
  assert.equal(source.meta.privacy, 'local'); assert.equal(source.children[0].body, '保留正文');
});

test('Android discovery stays local and unimplemented vector and relation controls remain disabled with AI enabled', async () => {
  const calls = [];
  const f = await createAndroidBrowser({ api: { notes: async payload => { if (payload.q) calls.push(payload); return { notes: [] }; } } });
  f.app.state.bootstrap = { capabilities: { ai: true, search: true, fetch: true, onlineResearch: true } };
  await f.app.navigate('discover'); const form = f.app.refs.main.querySelector('form');
  const mode = control(form, 'mode'); assert.equal(mode.value, 'keyword');
  const modes = descendants(mode).filter(node => node.tagName === 'option'); assert.equal(modes.filter(node => node.value !== 'keyword').every(node => node.disabled), true);
  const checkboxes = descendants(f.app.refs.main).filter(node => node.type === 'checkbox'); assert.equal(checkboxes.every(node => node.disabled && !node.checked), true);
  assert.equal(findButton(f.app.refs.main, '运行发现检查').disabled, true);
  control(form, 'q').value = '本地查询'; await form.events.submit({ preventDefault() {} }); assert.equal(calls.length, 1); assert.equal(calls[0].q, '本地查询'); assert.equal(calls[0].privacy, undefined); assert.equal(calls[0].mode, undefined);
});

test('Android research proposals read the current body before enabling accept and block stale hashes', async () => {
  const proposals = [{ id: 'proposal', noteId: 'note', expectedHash: 'expected', body: '研究建议正文', state: 'pending' }]; let hash = 'newer';
  const f = await createAndroidBrowser({ api: { proposals: async () => ({ proposals }), note: async () => ({ id: 'note', title: '知识标题', hash, body: '用户当前正文' }), androidGuide: async () => ({ steps: [] }), settings: async () => ({}) } });
  f.app.state.systemTab = 'proposals'; await f.app.renderSystem();
  await click(findButton(f.app.refs.main, '审阅差异')); assert.equal(findButton(f.app.refs.drawerBody, '接受提案'), undefined);
  hash = 'expected'; await click(findButton(f.app.refs.main, '审阅差异'));
  assert.match(f.app.refs.drawerBody.textContent, /用户当前正文/); assert.match(f.app.refs.drawerBody.textContent, /研究建议正文/); assert.equal(findButton(f.app.refs.drawerBody, '接受提案').disabled, false);
});
