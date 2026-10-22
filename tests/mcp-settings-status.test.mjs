import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { localCheckStatus } from '../public/mcp-status.mjs';
test('local check lifecycle never claims webpage verification', () => {
  const now=Date.UTC(2026,9,18);
  for(const [input,state] of [[{},'unchecked'],[{enabled:false,checkedAt:now},'disabled'],[{enabled:true,checkedAt:now},'ready'],[{enabled:true,failed:true,checkedAt:now},'failed'],[{enabled:true,checkedAt:now-300001},'expired']]) {
    const result=localCheckStatus(input,now);assert.equal(result.state,state);
    assert.doesNotMatch(result.text,/网页.*(连接成功|已连通|验证成功)/);
  }
});
test('unified permissions preserve loaded values and save only on explicit submit', () => {
  const app=fs.readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
  const settings=app.slice(app.indexOf('async function settingsPanel'),app.indexOf('function promptSettingsPanel'));
  assert.doesNotMatch(settings,/mcpEnabled|mcpPanel|syncMcpChoices/);
  const mcp=app.slice(app.indexOf('function mcpSettingsPanel'),app.indexOf('function localMcpCheck'));
  assert.match(mcp,/checked: Boolean\(mcp.enabled\)/);
  assert.match(mcp,/checked: Boolean\(mcp.allowProposals\)/);
  assert.match(mcp,/checked: mcp.chatgptEnabled === true/);
  assert.match(mcp,/checked: mcp.chatgptAllowRead === true/);
  assert.doesNotMatch(mcp,/\n  syncMcpChoices\(\);/);
  assert.match(mcp,/addEventListener\("submit"[\s\S]*api.updateSettings\(\{ mcp:/);
  assert.doesNotMatch(app,/diagnosticDetails\("查看( MCP|存储)/);
  assert.match(app,/点击先看更新前后对照；再次确认才会修改/);
  assert.match(app,/api.linksPreview\(noteId\)[\s\S]*disabled: !preview.changed \|\| Boolean\(preview.conflict\)[\s\S]*expectedHash: preview.expectedHash/);
});

test('rendered MCP form is read-only until submit and sends only existing MCP values', async () => {
  const vm = await import('node:vm');
  const source=fs.readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
  const nodes=[], writes=[];
  const el=(tag,props={},children=[])=>{ const node={tag,...props,children,events:{},append(...items){this.children.push(...items);},addEventListener(name,fn){this.events[name]=fn;}};nodes.push(node);return node; };
  const context=vm.createContext({el,button:(text,props)=>el('button',{text,...props}),sectionHeading:()=>el('h2'),api:{updateSettings:async value=>writes.push(value)},toast(){},refreshBootstrap:async()=>{},renderSystem:async()=>{}});
  vm.runInContext(source.slice(source.indexOf('function mcpSettingsPanel'),source.indexOf('function localMcpCheck'))+'\nthis.render=mcpSettingsPanel;',context);
  const values={enabled:true,allowProposals:false,chatgptEnabled:true,chatgptAllowRead:true};
  const form=context.render(values);
  assert.equal(writes.length,0);
  assert.deepEqual(nodes.filter(n=>n.tag==='input').map(n=>n.checked),[true,false,true,true]);
  await form.events.submit({preventDefault(){}});
  assert.deepEqual(JSON.parse(JSON.stringify(writes)),[{mcp:values}]);
});

test('ordinary failure explanations preserve actionable reasons without raw identifiers', async () => {
  const {callFailureReason}=await import('../public/mcp-status.mjs');
  assert.match(callFailureReason({code:'401',message:'secret-stack synthetic-id'}),/授权/);
  assert.match(callFailureReason('429 synthetic-id'),/频繁/);
  assert.match(callFailureReason('timeout synthetic-id'),/超时/);
  assert.match(callFailureReason('budget synthetic-id'),/预算/);
  assert.doesNotMatch(callFailureReason('raw-stack synthetic-id'),/raw-stack|synthetic-id/);
});
