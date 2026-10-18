import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { localCheckStatus } from '../public/mcp-status.mjs';

const source = fs.readFileSync(new URL('../public/app.mjs', import.meta.url), 'utf8');
function summaries(practiceId = '') {
  const context = vm.createContext({ localCheckStatus, setInterval: () => 0, button: (text) => ({ text }), api: { getContext: () => ({ practiceId }) }, el: (tag, props = {}, children = []) => ({ tag, ...props, children }) });
  vm.runInContext(source.slice(source.indexOf('function diagnosticCount('), source.indexOf('async function diagnosticsPanel(')) + '\nthis.summary = { storageSummary, mcpSummary, diagnosticDetails };', context);
  return context.summary;
}
const text = node => !node ? '' : (node.text || '') + (node.children || []).map(text).join(' ');
const visible = node => !node || node.tag === 'details' ? '' : (node.text || '') + (node.children || []).map(visible).join(' ');

test('diagnostic summaries separate empty from unknown and count content fragments', () => {
  const { storageSummary, mcpSummary, diagnosticDetails } = summaries();
  const storage = storageSummary({ vaultDir: '/synthetic/private', conflicts: [], pendingLinks: [] }, { count: 12, vectors: 4, pending: 8 });
  assert.match(visible(storage), /正式知识库.*内容片段\s+12.*已建语义索引\s+4.*可补建\s+8.*不是资料篇数.*未发现文件冲突.*没有待更新/);
  assert.doesNotMatch(visible(storage), /vaultDir|synthetic/);
  const details = diagnosticDetails('存储技术详情', { vaultDir: '/synthetic/private' });
  assert.match(text(details), /vaultDir.*synthetic/);
  assert.equal(details.open, undefined);
  assert.match(visible(mcpSummary({ enabled: false, chatgptEnabled: false, events: [], tools: [] })), /本机应用接入\s+已关闭.*ChatGPT 会话收集\s+入口已关闭.*暂无本机调用记录/);
  const unknown = visible(storageSummary({}, {})) + visible(mcpSummary({}));
  assert.match(unknown, /内容片段\s+未知.*冲突状态未知.*链接更新状态未知/);
  assert.doesNotMatch(unknown, /未发现文件冲突|没有待更新|暂无本机调用记录|已关闭/);
});

test('enabled grants never imply configured or connected clients and retain read privacy', () => {
  const { mcpSummary } = summaries();
  const panel = mcpSummary({ enabled: true, connected: true, allowProposals: true, chatgptEnabled: true, chatgptAllowRead: true, tools: ['search_knowledge', 'propose_change', 'future_tool'], events: [{}] });
  const result = visible(panel);
  assert.match(result, /本机应用接入\s+已开启.*修改仍须你确认.*ChatGPT 会话收集\s+入口已开启.*包含仅本地资料.*进入 ChatGPT 上下文/);
  assert.match(result, /实际连接\s+网页尚未检查.*网页是否已配置：尚未检查/);
  assert.match(text(panel), /搜索知识.*提交待确认的修改建议.*其他知识工具/);
  assert.doesNotMatch(result, /已连接|future_tool/);
  assert.match(visible(mcpSummary({ enabled: false, allowProposals: true, chatgptEnabled: false, chatgptAllowRead: true })), /当前不能提交建议.*当前不能读取/);
});

test('practice identity follows active context and does not claim formal-library permissions', () => {
  const { storageSummary, mcpSummary } = summaries('synthetic-practice');
  assert.match(visible(storageSummary({ conflicts: ['x'], pendingLinks: [{}] }, {})), /新手练习库.*文件冲突\s+1 项待处理.*笔记链接\s+1 篇待核对/);
  assert.match(visible(mcpSummary({})), /练习库视图.*不能据此判断正式库.*返回正式库核对/);
});
