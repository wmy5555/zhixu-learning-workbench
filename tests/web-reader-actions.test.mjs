import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { learningReadiness, learningHelp, readerMenu } from '../public/web/reader-actions.mjs';
import { reader } from '../public/web/reader.mjs';

const source={id:'source-1',kind:'source',title:'合成原始资料'};
const knowledge=(meta={})=>({id:'knowledge-1',kind:'knowledge',title:'合成知识',body:'完整正文',meta:{stage:'candidate',sources:[{id:source.id,role:'input'}],...meta}});

test('blocked reading and menu expose the correct source recovery without starting or promoting',()=>{
  const note=knowledge(), readiness=learningReadiness(note,[source],['整理尚未核验']);
  const html=reader(note,[source],'library',[],readiness).html;
  assert.match(html,/aria-label="学习条件"/);assert.match(html,/data-action="prepare-learning"/);
  assert.doesNotMatch(html,/data-action="start-note"/);
  const help=learningHelp(note,readiness);
  assert.match(help,/data-action="research-source"[^>]*data-id="source-1"/);
  assert.match(help,/修订建议/);assert.match(help,/data-route="jobs"/);
  assert.doesNotMatch(help,/data-action="promote"/);
  const menu=readerMenu(note,readiness);
  assert.match(menu,/aria-label="常用操作"/);assert.match(menu,/aria-label="来源与记录"/);
  assert.match(menu,/<details class="reader-menu-management">/);
});

test('material, source identity, lifecycle and learning arrangement transitions stay separate',()=>{
  const note=knowledge({stage:'learning',processKey:'missing:hash:0',sources:[{id:source.id,role:'input'}]});
  let ready=learningReadiness(note,[source],['底层原文已变化']);
  assert.equal(ready.sourceId,undefined);assert.doesNotMatch(learningHelp(note,ready),/data-action="research-source"/);
  assert.match(learningHelp(note,ready),/不会改用其他来源/);
  ready=learningReadiness(knowledge({sources:[{id:'a',role:'input'},{id:'b',role:'input'}]}),[source],['待核验']);
  assert.equal(ready.sourceId,undefined);
  ready=learningReadiness(knowledge(),[source],[]);assert.equal(ready.arrange,true);
  assert.match(learningHelp(knowledge(),ready),/data-action="promote"/);
  for(const stage of ['learning','integrated','core'])assert.equal(learningReadiness(knowledge({stage}),[],[]).ready,true);
  ready=learningReadiness(knowledge({stage:'retired'}),[source],['待核验']);assert.equal(ready.arrange,true);assert.equal(ready.sourceId,undefined);
  ready=learningReadiness(knowledge({supersededBy:'kept'}),[],[]);assert.equal(ready.replacementId,'kept');
  assert.match(learningHelp(knowledge(),ready),/data-route="read\/kept"/);
});

test('recovery escapes untrusted reasons and titles and source menus retain only applicable operations',()=>{
  const note=knowledge();note.title='<script>bad()</script>';
  const readiness=learningReadiness(note,[source],['<img src=x onerror=bad()>']);
  assert.doesNotMatch(learningHelp(note,readiness),/<script>|<img/);
  assert.doesNotMatch(readerMenu(note,readiness),/<script>|<img/);
  const menu=readerMenu(source,null);
  assert.match(menu,/data-action="process"/);assert.match(menu,/data-action="extract"/);
  assert.doesNotMatch(menu,/data-action="start-note"|data-action="promote"/);
});

function harness({limitations=[],stage='learning',postError,hold=false}={}) {
  const writes=[],dialogs=[],state={sequence:1,route:'read/knowledge-1',boot:{notes:[source]}};
  let release;
  const gate=hold?new Promise(resolve=>{release=resolve;}):Promise.resolve();
  const api={get:async path=>{await gate;return path.endsWith('/evidence')?{limitations}:knowledge({stage});},post:async(path,body)=>{writes.push({path,body});if(postError)throw postError;return {id:'session-1'};}};
  const context={api,state,crypto:{randomUUID:()=> 'one-intent'},endpoint:(resource,id,action='')=>`/api/${resource}/${id}${action?'/'+action:''}`,list:value=>Array.isArray(value)?value:[],learningReadiness,learningHelp,modal:(...args)=>dialogs.push(args),notify:()=>{},go:async route=>{state.route=route;}};
  const sourceText=fs.readFileSync(new URL('../public/web/main.mjs',import.meta.url),'utf8');
  const snippet=sourceText.slice(sourceText.indexOf('async function startStudy('),sourceText.indexOf('async function processSource('));
  vm.runInNewContext(snippet+'\nglobalThis.start=startStudy;',context);
  return {context,writes,dialogs,release};
}

test('start redirects unmet conditions to recovery, coalesces clicks, and preserves successful start intent',async()=>{
  for(const options of [{limitations:['待核验']},{stage:'candidate'}]){
    const h=harness(options);await h.context.start('knowledge-1');assert.equal(h.writes.length,0);assert.equal(h.dialogs.length,1);
  }
  const h=harness({hold:true}),one=h.context.start('knowledge-1'),two=h.context.start('knowledge-1');
  h.release();await Promise.all([one,two]);assert.equal(h.writes.length,1);
  assert.equal(h.writes[0].body.requestId,'one-intent');assert.equal(h.context.state.route,'study/session-1');
});

test('late readiness is ignored after navigation; backend eligibility races still open recovery',async()=>{
  const late=harness({hold:true,limitations:['待核验']}),pending=late.context.start('knowledge-1');
  late.context.state.sequence++;late.release();await pending;assert.equal(late.writes.length,0);assert.equal(late.dialogs.length,0);
  const error=Object.assign(new Error('材料发生变化'),{code:'RESEARCH_REQUIRED'});
  const h=harness({postError:error});
  // The second evidence read observes the changed material version.
  let reads=0,original=h.context.api.get;
  h.context.api.get=async path=>path.endsWith('/evidence')&&++reads>1?{limitations:['底层原文已变化']}:original(path);
  await h.context.start('knowledge-1');assert.equal(h.writes.length,1);assert.equal(h.dialogs.length,1);
  assert.match(h.dialogs[0][1],/底层原文已变化/);
});
