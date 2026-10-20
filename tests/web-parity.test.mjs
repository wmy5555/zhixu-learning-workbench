import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createApp} from '../src/server.mjs';
import {createService} from '../src/service.mjs';
import {freshClock,transition,elapsed,readClock,clampPosition,dailyFocus} from '../public/web/focus-model.mjs';
import {aidUsed,markAid,clearAid} from '../public/web/study-aid.mjs';
import {evidenceHTML,feedbackHTML,completionHTML} from '../public/web/parity.mjs';
import {accentPalette,contrast,validAccent} from '../public/web/management.mjs';
import {prepareTexts} from '../public/web/batch-import.mjs';
import {capturePayload} from '../public/web/api.mjs';
const start=(kind='focus',minutes=25,id='round-1')=>transition(freshClock(),{type:'start',kind,minutes,id},1000);
test('focus uses elapsed wall time after background throttling and refresh; expiry caps once',()=>{
  let s=start();assert.equal(elapsed(s.active,301000),300000);
  s=readClock(JSON.parse(JSON.stringify(s)));
  s=transition(s,{type:'tick'},3601000);assert.equal(s.records.length,1);assert.equal(s.records[0].durationMs,1500000);
  assert.equal(s.records[0].endedAt,1501000);assert.equal(s.active.pendingNotice,true);
  s=transition(s,{type:'claim'},3602000);s=transition(s,{type:'tick'},5000000);
  assert.equal(s.records.length,1);assert.equal(s.active.pendingNotice,false);
});
test('pause resume end excludes paused time; repeated end does not double count',()=>{
  let s=start();s=transition(s,{type:'pause'},61000);assert.equal(s.active.elapsedMs,60000);
  s=transition(s,{type:'resume'},661000);s=transition(s,{type:'end'},721000);
  assert.equal(s.records[0].durationMs,120000);assert.equal(s.records[0].reason,'ended');
  s=transition(s,{type:'end'},900000);assert.equal(s.records.length,1);
});
test('breaks and unopened page time are excluded; independent rounds and clamped positions',()=>{
  let s=start('break',5);s=transition(s,{type:'tick'},999999);assert.deepEqual(dailyFocus(s.records),[]);
  s=transition(s,{type:'start',kind:'focus',minutes:1,id:'round-2'},1000000);
  s=transition(s,{type:'tick'},1060000);assert.equal(dailyFocus(s.records)[0][1],60000);
  assert.deepEqual(clampPosition({x:999,y:-50},260,300,320,600),{x:52,y:8});
  assert.throws(()=>transition(start(),{type:'start',kind:'focus',minutes:25,id:'duplicate'},2000));
  assert.equal(elapsed(start().active,0),0);
  assert.deepEqual(readClock({version:1,records:[],active:{bad:true}}),freshClock());
});
test('assistance is scoped to each round and survives a page refresh',()=>{
  const map=new Map(),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
  const first={id:'s1',turns:[],hintCount:0};assert.equal(aidUsed(first,storage),false);
  markAid(first,storage);assert.equal(aidUsed({...first},storage),true);
  const next={id:'s1',turns:[{id:'t1'}],hintCount:0};assert.equal(aidUsed(next,storage),false);
  assert.equal(aidUsed({...next,hintCount:1},storage),true);clearAid(first,storage);assert.equal(map.size,0);
});
test('focus docking resets only on a new focus round; discard is scoped and idempotent',()=>{
  let s=transition(start('focus',1),{type:'move',x:300,y:200},1100);
  s=transition(s,{type:'end'},2000);
  s=transition(s,{type:'start',kind:'break',minutes:5,id:'break'},2100);
  assert.deepEqual(s.position,{x:300,y:200});
  s=transition(s,{type:'discard',id:'round-1'},2200);
  assert.equal(s.records.length,0);assert.equal(s.active.id,'break');
  s=transition(s,{type:'discard',id:'break'},2300);
  assert.equal(s.active,null);assert.equal(s.records.length,0);
  s=transition(s,{type:'start',kind:'focus',minutes:1,id:'next'},2400);
  assert.equal(s.position,null);
  s=transition(s,{type:'move',x:400,y:100},2500);
  s=transition(s,{type:'dock'},2600);assert.equal(s.position,null);
  s=transition(s,{type:'discard',id:'next'},70000);
  assert.equal(s.active,null);assert.equal(s.records.length,0);
  assert.deepEqual(transition(s,{type:'discard',id:'next'},71000),s);
});
test('complete evidence and feedback escape unsafe content without truncating provenance',()=>{
  const excerpt='完整摘录。'.repeat(1000),html=evidenceHTML([{title:'<script>',excerpt,locator:'第3页',role:'support',rationale:'支持条件',fetchedAt:'读取时间',researchedAt:'核验时间',url:'javascript:alert(1)'}]);
  assert.ok(html.includes(excerpt));assert.ok(html.includes('支持条件'));assert.ok(html.includes('核验时间'));assert.ok(!html.includes('href="javascript'));assert.ok(!html.includes('<script>'));
  const feedback=feedbackHTML({assessment:'partial',omission:'遗漏部分',correction:'修正部分',nextQuestion:'下一问内容',suggestion:'建议内容'});
  for(const value of ['遗漏部分','修正部分','下一问内容','建议内容'])assert.ok(feedback.includes(value));
  assert.match(evidenceHTML([]),/没有可追溯引用/);
});
test('custom colors remain legible in light and dark while defaults require no override',()=>{
  for(const seed of ['#ffffff','#000000','#c6613f','#22ff00','#1e3768'])for(const dark of [true,false]){
    const p=accentPalette(seed,dark);assert.ok(contrast(p.accent,dark?'#242422':'#fcfcfb')>=4.5);assert.ok(contrast(p.accent,p.ink)>=4.5);
  }
  assert.equal(validAccent('red'),false);assert.throws(()=>accentPalette('red'));
});
test('bulk text import validates all files before any mutation and preserves metadata',async()=>{
  const row=(name,text)=>new File([text],name);
  const rows=await prepareTexts([row('甲.md','# 原文'),row('乙.txt','完整文本')]);assert.equal(rows.length,2);assert.equal(rows[0].body,'# 原文');
  await assert.rejects(prepareTexts([row('good.txt','好'),row('empty.txt',' ')]));
  await assert.rejects(prepareTexts([row('x.exe','不接受')]));
  const payload=capturePayload({body:'文字',date:'2026-01-01',locator:'第3页',process:false,research:true});
  assert.equal(payload.items[0].date,'2026-01-01');assert.equal(payload.items[0].locator,'第3页');assert.equal(payload.research,false);
});
test('history HTTP pagination reaches every record and deleted knowledge restores with conflict checks',async t=>{
  const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'parity-contract-'));
  const app=createApp({dataDir:path.join(root,'data'),vaultDir:path.join(root,'vault'),scheduler:false});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await app.close();assert.equal(path.dirname(root),parent);fs.rmSync(root,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${app.server.address().port}`,response=await fetch(base+'/api/session'),cookie=response.headers.get('set-cookie').split(';')[0],csrf=(await response.json()).csrf;
  const api=async(url,method='GET',body)=>{const r=await fetch(base+url,{method,headers:{cookie,origin:base,'x-csrf-token':csrf,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
  for(let i=0;i<67;i++)app.service.store.put('sessions',`s${i}`,{id:`s${i}`,status:'completed',turns:[]});
  const ids=new Set();for(let offset=0;offset<67;offset+=20){const r=await api(`/api/study?offset=${offset}&limit=20`);assert.equal(r.status,200);assert.equal(r.data.total,67);r.data.sessions.forEach(s=>ids.add(s.id));}
  assert.equal(ids.size,67);assert.equal((await api('/api/study?offset=-1')).status,400);assert.equal((await api('/api/study?limit=999')).status,400);
  const n=app.service.store.create({kind:'knowledge',title:'合成恢复测试',body:'完整原文',meta:{stage:'reference'}});
  assert.equal((await api('/api/notes/'+n.id,'DELETE',{expectedHash:'bad'})).status,409);
  assert.equal((await api('/api/notes/'+n.id,'DELETE',{expectedHash:n.hash})).status,200);
  const gone=await api('/api/deleted-notes');assert.equal(gone.data.items.length,1);
  const versionId=gone.data.items[0].versionId;
  assert.equal((await api(`/api/history/${n.id}/restore`,'POST',{versionId})).status,200);
  assert.equal((await api(`/api/history/${n.id}/restore`,'POST',{versionId})).status,409);
  assert.equal((await api('/api/deleted-notes')).data.items.length,0);
  const learning=app.service.store.create({kind:'knowledge',title:'合成今日安排',body:'仅用于测试安排恢复。',meta:{stage:'learning',claimType:'opinion',depth:'explain'}});
  const plan=app.service.today().items.find(p=>p.noteId===learning.id);assert.ok(plan);
  assert.equal((await api(`/api/today/${plan.id}/action`,'POST',{action:'pause'})).status,200);
  assert.ok(app.service.settings().pausedIds.includes(learning.id));
  assert.equal((await api(`/api/today/${plan.id}/action`,'POST',{action:'resume'})).status,200);
  assert.ok(!app.service.settings().pausedIds.includes(learning.id));assert.equal(app.service.today().items.find(p=>p.id===plan.id).state,'pending');
  assert.equal((await api(`/api/today/${plan.id}/action`,'POST',{action:'resume'})).status,200);
  await api(`/api/today/${plan.id}/action`,'POST',{action:'skip'});
  assert.equal((await api(`/api/today/${plan.id}/action`,'POST',{action:'resume'})).status,200);
  app.service.store.put('plans','old-plan',{...plan,id:'old-plan',date:'2000-01-01',state:'pause'});
  assert.equal((await api('/api/today/old-plan/action','POST',{action:'resume'})).status,409);
});
test('real learning workflow records hinted and then independent rounds separately with offline grading',async t=>{
  const parent=path.resolve('.tmp'),root=fs.mkdtempSync(path.join(parent,'parity-learning-'));
  const service=createService({dataDir:path.join(root,'data'),vaultDir:path.join(root,'vault'),aiOverride:{generate:async()=>({text:JSON.stringify({assessment:'correct',feedback:'合成反馈',omission:'无遗漏',correction:'依据清楚',nextQuestion:'换一个例子',suggestion:'继续回忆'})})}});
  t.after(async()=>{await service.close();assert.equal(path.dirname(root),parent);fs.rmSync(root,{recursive:true,force:true});});
  const n=service.store.create({kind:'knowledge',title:'合成学习',body:'合成观点与边界。',meta:{stage:'learning',claimType:'opinion',depth:'explain'}});
  const s=service.startStudy({noteId:n.id,requestId:'independent-test'});
  service.hintStudy(s.id);service.answerStudy(s.id,{answer:'借助提示的回答',hintUsed:true,requestId:'turn-1'});
  await service.runJobs();
  assert.equal(service.session(s.id).turns[0].hintUsed,true);
  service.answerStudy(s.id,{answer:'这次独立解释',hintUsed:false,requestId:'turn-2'});
  await service.runJobs();
  const updated=service.session(s.id);
  assert.deepEqual(updated.turns.map(t=>t.hintUsed),[true,false]);
  assert.equal(updated.hintCount,0);
  service.finishStudy(s.id);assert.equal(service.session(s.id).completion.evidence.usedHints,true);
});
