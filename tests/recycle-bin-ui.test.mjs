import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const code=fs.readFileSync(new URL('../public/recycle-bin.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export async function','async function');
function harness({items=[{id:'s',versionId:'v',title:'合成资料',attachmentCount:1}],confirm=true,failClear='',failReads=0,onClear=()=>{},onRead=()=>{}}={}){
 let context={version:1,practiceId:''}, calls=[], confirmation, active=true, reads=0, confirmations=0, pendingCleanup=0; const errors=[];
 const node=(tag,options={},children=[])=>({tag,...options,children:Array.isArray(children)?children:[children],append(...n){this.children.push(...n);}});
 const main={replaceChildren(n){this.body=n;}},api={getContext:()=>context,recycleBin:async()=>{await onRead(++reads);if(reads>1&&failReads-->0)throw new Error('synthetic refresh failure');return {items,revision:'revision',pendingCleanup};},clearRecycleBin:async r=>{calls.push(['clear',r]);await onClear();if(failClear==='partial'){items=[];pendingCleanup=1;}if(failClear)throw new Error('synthetic '+failClear+' failure');items=[];return {cleared:1};},restoreRecycled:async(id,v)=>{calls.push(['restore',id,v]);items=[];}};
 const render=new Function('api','el','button','emptyState','formatDate','confirmAction','toast',code+'; return renderRecycleBin;')(api,node,(text,o)=>node('button',{text,...o}),(...args)=>node('empty',{args}),String,async o=>{confirmation=o;confirmations++;return confirm;},()=>{});
 const find=text=>{const visit=n=>n.text===text?n:(n.children||[]).map(visit).find(Boolean);return visit(main.body);};
 return {main,calls,find,errors,get confirmations(){return confirmations;},get confirmation(){return confirmation;},render:()=>render({main,refresh:async()=>{},onError:e=>errors.push(e.message),isActive:()=>active}),switchContext(){context={version:2,practiceId:'other'};},leave(){active=false;}};
}
test('UI cancel keeps item, confirmation explains irreversible current-library scope',async()=>{const h=harness({confirm:false});await h.render();await h.find('一键清空回收站').onClick();assert.deepEqual(h.calls,[]);assert.ok(h.find('恢复'));assert.match(h.confirmation.message,/当前资料库.*1 份.*无法从回收站恢复/);});
test('UI confirmed clear uses preview revision and renders empty state with disabled clear',async()=>{const h=harness();await h.render();await h.find('一键清空回收站').onClick();assert.deepEqual(h.calls,[['clear','revision']]);assert.equal(h.find('一键清空回收站').disabled,true);assert.equal(h.main.body.children.at(-1).args[0],'回收站为空');});
test('UI restore sends exact version and stale library actions do nothing',async()=>{const h=harness();await h.render();await h.find('恢复').onClick();assert.deepEqual(h.calls,[['restore','s','v']]);const stale=harness();await stale.render();stale.switchContext();await stale.find('恢复').onClick();await stale.find('一键清空回收站').onClick();assert.deepEqual(stale.calls,[]);});

test('clear failure reconciles list and restores button; another attempt requires another confirmation',async()=>{
 const h=harness({failClear:'ordinary'});await h.render();await h.find('一键清空回收站').onClick();
 assert.deepEqual(h.calls,[['clear','revision']]);assert.equal(h.find('一键清空回收站').disabled,false);assert.ok(h.find('恢复'));
 assert.match(h.errors[0],/清空回收站失败.*不会自动重试清空.*synthetic ordinary failure/);
 await h.find('一键清空回收站').onClick();assert.equal(h.confirmations,2);assert.equal(h.calls.length,2);
});

test('partial physical cleanup failure renders actual empty list and pending cleanup for fresh confirmation',async()=>{
 const h=harness({failClear:'partial'});await h.render();await h.find('一键清空回收站').onClick();
 assert.equal(h.find('恢复'),undefined);assert.equal(h.find('一键清空回收站').disabled,false);
 assert.ok(h.main.body.children.some(n=>n.text?.includes('部分文件尚未清理完成')));assert.equal(h.calls.length,1);
 await h.find('一键清空回收站').onClick();assert.equal(h.confirmations,2);assert.match(h.confirmation.message,/0 份原始资料/);
});

test('unknown clear result and failed refresh keep explicit read retry; retry never resends clear',async()=>{
 const h=harness({failClear:'network',failReads:2});await h.render();await h.find('一键清空回收站').onClick();
 assert.equal(h.find('一键清空回收站').disabled,true);assert.equal(h.find('重新核对回收站').hidden,false);assert.equal(h.find('重新核对回收站').disabled,false);
 assert.ok(h.main.body.children.some(n=>n.textContent?.includes('当前列表可能已过时')));
 await h.find('重新核对回收站').onClick();assert.equal(h.find('重新核对回收站').disabled,false);assert.equal(h.find('一键清空回收站').disabled,true);
 await h.find('重新核对回收站').onClick();assert.equal(h.find('一键清空回收站').disabled,false);assert.equal(h.calls.length,1);assert.equal(h.confirmations,1);
});

for(const change of ['switchContext','leave'])test('late failed clear cannot update another context or page: '+change,async()=>{
 let finish;const waiting=new Promise(resolve=>{finish=resolve;});const h=harness({failClear:'network',onClear:()=>waiting});await h.render();
 const action=h.find('一键清空回收站').onClick();await Promise.resolve();const before=h.main.body;h[change]();finish();await action;
 assert.equal(h.main.body,before);assert.equal(h.errors.length,0);assert.equal(h.calls.length,1);
});

test('partial cleanup followed by failed refresh can be read-retried without another deletion',async()=>{
 const h=harness({failClear:'partial',failReads:1});await h.render();await h.find('一键清空回收站').onClick();
 assert.equal(h.find('一键清空回收站').disabled,true);assert.equal(h.find('恢复').disabled,true);
 await h.find('重新核对回收站').onClick();assert.equal(h.find('恢复'),undefined);
 assert.ok(h.main.body.children.some(n=>n.text?.includes('部分文件尚未清理完成')));assert.equal(h.calls.length,1);assert.equal(h.confirmations,1);
});

for(const change of ['switchContext','leave'])test('late reconciliation cannot replace another context or page: '+change,async()=>{
 let finish,started;const waiting=new Promise(resolve=>{finish=resolve;}),reached=new Promise(resolve=>{started=resolve;});
 const h=harness({failClear:'network',onRead:n=>{if(n===2){started();return waiting;}}});await h.render();
 const action=h.find('一键清空回收站').onClick();await reached;h[change]();const nextPage={text:'another page'};h.main.body=nextPage;finish();await action;
 assert.equal(h.main.body,nextPage);assert.equal(h.errors.length,1);assert.equal(h.calls.length,1);
});
