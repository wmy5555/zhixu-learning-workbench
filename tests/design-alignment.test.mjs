import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createService } from '../src/service.mjs';
import { createApp } from '../src/server.mjs';
import { once } from 'node:events';

function harness(t, aiOverride) {
  fs.mkdirSync('.tmp', {recursive:true});
  const root=fs.mkdtempSync(path.resolve('.tmp/design-alignment-'));
  const service=createService({dataDir:path.join(root,'data'),vaultDir:path.join(root,'vault'),aiOverride});
  t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
  return service;
}
const knowledge=(service, title, meta={}, body='这里有足够上下文的知识正文，包含使用条件、案例以及需要比较的范围。')=>service.store.create({kind:'knowledge',title,body,meta:{stage:'candidate',privacy:'local',depth:'explain',...meta}});

test('evidence remains available with exact excerpts while list cards keep internal sources folded',async t=>{
  const s=harness(t), source=s.store.create({kind:'source',title:'网页正文证据',body:'实际读取的原文，不能改写为模型总结。',meta:{excerptOnly:true,url:'https://example.com/evidence',locator:'段落3',fetchedAt:'2026-09-01'}});
  const n=knowledge(s,'被核验的知识',{sources:[{id:source.id,role:'oppose'}],evidence:[{url:source.meta.url,excerpt:source.body,role:'oppose',rationale:'明确反例',fetchedAt:source.meta.fetchedAt}]});
  assert.equal(s.publicNote(n).meta.evidence,undefined);
  assert.deepEqual(s.publicNote(n).meta.sources,[]);
  const detail=s.noteEvidence(n.id);
  assert.equal(detail.evidence[0].excerpt,source.body);
  assert.equal(detail.evidence[0].sourceId,source.id);
  assert.equal(detail.evidence[0].role,'oppose');
});

test('merged knowledge stays reachable from every original source without creating duplicate notes',async t=>{
  const s=harness(t), a=s.importItems({items:[{title:'来源甲',body:'来源甲正文'}]}).notes[0], b=s.importItems({items:[{title:'来源乙',body:'来源乙正文'}]}).notes[0];
  const x=knowledge(s,'观点甲',{sources:[{id:a.id,role:'input'}]}), y=knowledge(s,'观点乙',{sources:[{id:b.id,role:'input'}]});
  s.merge({...s.merge({keepId:x.id,mergeId:y.id}),preview:false});
  assert.ok(s.readPublicNote(a.id).children.some(n=>n.id===x.id));
  assert.ok(s.readPublicNote(b.id).children.some(n=>n.id===x.id));
  assert.equal(s.store.list().filter(n=>n.id===x.id).length,1);
});

test('actual use drives reviewable suggestions; unchecking use removes its evidence and never advances mastery',async t=>{
  const s=harness(t), n=knowledge(s,'用于报告的机制');
  s.store.put('drafts','draft',{id:'draft',citations:[{id:n.id}],usedIds:[],body:'草稿'});
  s.updateDraft('draft',{usedIds:[n.id]});
  const first=s.recommendations().suggestions.find(x=>x.noteId===n.id&&x.targetStage==='learning');
  assert.ok(first); assert.equal(s.getNote(n.id).meta.stage,'candidate');
  s.updateDraft('draft',{usedIds:[]});
  assert.equal(s.store.records('uses').length,0);
  assert.ok(!s.recommendations().suggestions.some(x=>x.noteId===n.id));
  assert.throws(()=>s.recommendationAction(first.id,{action:'accept'}),e=>e.code==='CONFLICT');
  s.updateDraft('draft',{usedIds:[n.id]});
  const suggestion=s.recommendations().suggestions.find(x=>x.noteId===n.id);
  s.recommendationAction(suggestion.id,{action:'accept'});
  assert.equal(s.getNote(n.id).meta.stage,'learning');
  assert.equal(s.getNote(n.id).meta.confirmedAt,undefined);
});

test('core suggestion needs independent completed practice on three days and actual uses on two days',async t=>{
  const s=harness(t), n=knowledge(s,'长期使用的知识',{stage:'integrated',confirmedAt:'2026-08-01'});
  for(let i=0;i<3;i++)s.store.put('studyEvidence',`s${i}`,{noteId:n.id,day:'2026-09-01',completedAt:'2026-09-10T12:00:00Z',assessment:'correct',reviewSettled:true,independent:true,depth:'apply'});
  for(let i=0;i<2;i++)s.store.put('uses',`d${i}`,{noteId:n.id,actualUse:true,at:`2026-09-0${i+1}T12:00:00Z`});
  assert.ok(!s.recommendations().suggestions.some(x=>x.targetStage==='core'));
  for(let i=0;i<3;i++)s.store.put('studyEvidence',`s${i}`,{noteId:n.id,day:`2026-09-0${i+1}`,completedAt:'2026-09-10T12:00:00Z',assessment:'correct',reviewSettled:true,independent:true,depth:'apply'});
  assert.ok(s.recommendations().suggestions.some(x=>x.targetStage==='core'));
  assert.equal(s.getNote(n.id).meta.stage,'integrated');
  s.store.update(n.id,{expectedHash:s.getNote(n.id).hash,meta:{confirmedAt:'2026-09-11T12:00:00Z'}});
  assert.ok(!s.recommendations().suggestions.some(x=>x.targetStage==='core'),'old-version practice cannot qualify a newly confirmed understanding');
});

test('research suggestions open the source without scheduling external work; ignored suggestions stay ignored until evidence changes',async t=>{
  const s=harness(t), source=s.importItems({items:[{title:'待更新的原始资料',body:'正文'}]}).notes[0];
  const n=knowledge(s,'待研究知识',{sources:[{id:source.id,role:'input'}],researchLimitations:['缺少反证']});
  const suggestion=s.recommendations().suggestions.find(x=>x.noteId===n.id);
  assert.equal(s.recommendationAction(suggestion.id,{action:'accept'}).requiresResearch,true);
  assert.equal(s.store.records('jobs').length,0);
  s.recommendationAction(suggestion.id,{action:'dismiss'});
  assert.equal(s.recommendations().suggestions.length,0);
  s.store.update(n.id,{expectedHash:n.hash,meta:{researchLimitations:['发现新的冲突']}});
  assert.equal(s.recommendations().suggestions.length,1);
});

test('incremental index updates only missing authorised chunks and rejects stale response writes',async t=>{
  const sent=[];let mutate;
  const s=harness(t,{embed:async({texts})=>{sent.push(texts);mutate?.();mutate=null;return{vectors:texts.map(()=>[1,0])};}});
  s.updateSettings({embedding:{enabled:true,model:'test-model'}});
  const cloud=knowledge(s,'允许索引',{privacy:'cloud'});knowledge(s,'本地敏感标题');
  s.queue('index',{},'one');await s.runJobs();
  assert.equal(sent.length,1);assert.equal(s.diagnostics().index.pending,0);
  s.store.update(cloud.id,{expectedHash:s.getNote(cloud.id).hash,meta:{stage:'learning'}});
  s.queue('index',{},'two');await s.runJobs();assert.equal(sent.length,1);
  s.store.update(cloud.id,{expectedHash:s.getNote(cloud.id).hash,body:'准备索引的新正文'});
  mutate=()=>s.store.update(cloud.id,{expectedHash:s.getNote(cloud.id).hash,body:'请求期间改过的正文'});
  s.queue('index',{},'three');await s.runJobs();
  assert.equal(s.diagnostics().index.pending,1);
  assert.equal(s.store.db.prepare('SELECT vector FROM index_chunks WHERE noteId=?').get(cloud.id).vector,null);
  assert.ok(sent.every(batch=>batch.every(text=>!text.includes('本地敏感标题'))));
});

test('processed knowledge can receive explicitly requested structured AI relations; local refresh preserves them',async t=>{
  const prompts=[];let target;
  const s=harness(t,{generate:async({prompt})=>{prompts.push(prompt);return {text:JSON.stringify(prompt.includes('检索短语')?{queries:['迁移机制','约束条件']}:{relations:[{toId:target.id,type:'analogy',highValue:true,valueScore:90,sourceExcerpt:'相同机制',targetExcerpt:'约束条件',explanation:'两者共享反馈机制',use:'比较反馈延迟',boundary:'只限明确的条件'}]})};}});
  s.updateSettings({ai:{enabled:true}});
  const source=s.importItems({items:[{title:'授权原文',body:'相同机制的源材料',privacy:'cloud'}]}).notes[0];
  const n=knowledge(s,'机制',{privacy:'cloud',processKey:`${source.id}:${source.hash}:0`},'相同机制可以在不同条件下产生不同结果。');
  target=knowledge(s,'另一个领域',{privacy:'cloud',topic:'不同领域'},'约束条件决定反馈的有效范围。');
  knowledge(s,'私人领域',{privacy:'local'},'本地秘密不允许外发');
  s.requestRelations(n.id);await s.runJobs();assert.equal(prompts.length,0);
  s.requestRelations(n.id,{useAI:true});await s.runJobs();
  assert.equal(prompts.length,2);assert.ok(prompts.every(p=>!p.includes('本地秘密')));
  const relation=s.relationReview().relations.find(r=>r.state==='suggested');assert.ok(relation);
  s.requestRelations(n.id);await s.runJobs();assert.equal(s.store.get('relations',relation.id).state,'suggested');
  s.relationAction(relation.id,{action:'accept'});
  assert.ok(s.getNote(n.id).body.includes('zhixu-managed-links:start'));
  const confirmed=s.confirmNote(n.id,{body:'我自己的解释',expectedHash:s.getNote(n.id).hash});
  const again=s.confirmNote(n.id,{body:'改进后的解释',expectedHash:confirmed.hash});
  assert.ok(again.body.includes('zhixu-managed-links:start'));
  assert.equal(s.linksPreview(n.id).conflict,null);
});

test('source review interval affects subsequent research only and validates the supported range',async t=>{
  const s=harness(t,{generate:async()=>({text:JSON.stringify({candidates:[{title:'可检验观点',body:'观点正文',claims:['明确事实']}]})}),researchBatch:async()=>({results:[{claim:'明确事实',conclusion:'模拟正文支持',evidence:[{url:'https://example.com/page',title:'模拟来源',excerpt:'模拟原文',role:'support',fetchedAt:new Date().toISOString()}],limitations:[]}]})});
  const source=s.importItems({items:[{title:'易变资料',body:'测试用原文',privacy:'cloud'}]}).notes[0];
  assert.throws(()=>s.editNote(source.id,{expectedHash:source.hash,meta:{researchIntervalDays:0}}));
  s.editNote(source.id,{expectedHash:source.hash,meta:{researchIntervalDays:7}});
  const job=s.processNote(source.id,{research:true});await s.runJobs();
  assert.equal(s.store.get('jobs',job.id).state,'done');
  const child=s.listNotes({kind:'knowledge'})[0], days=(Date.parse(child.meta.reviewAfter)-Date.parse(child.meta.researchedAt))/86400000;
  assert.ok(Math.abs(days-7)<0.01);
  s.editNote(source.id,{expectedHash:s.getNote(source.id).hash,meta:{researchIntervalDays:180}});
  assert.equal(s.getNote(child.id).meta.reviewAfter,child.meta.reviewAfter);
});

test('new HTTP routes share the existing session and CSRF boundary and expose actionable topic state',async t=>{
  const s=harness(t), app=createApp({service:s,dataDir:s.store.dataDir,scheduler:false});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const n=knowledge(s,'HTTP学习样本',{stage:'learning'});
  const init=await fetch(`${base}/api/session`), cookie=init.headers.get('set-cookie').split(';')[0], {csrf}=await init.json();
  const request=(route,body,authorized=true)=>fetch(base+route,{method:body?'POST':'GET',headers:{cookie,...(body?{'Content-Type':'application/json',...(authorized?{'X-CSRF-Token':csrf}:{})}:{})},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await request('/api/recommendations')).status,200);
  assert.equal((await request(`/api/notes/${n.id}/evidence`)).status,200);
  assert.equal((await request(`/api/notes/${n.id}/relate`,{},false)).status,403);
  const topic=await (await request('/api/topics',{title:'HTTP顺序包',noteIds:[n.id]})).json();
  assert.equal(topic.progress.nextNoteId,n.id);
  assert.equal((await request(`/api/notes/${n.id}/links-preview`)).status,200);
  const session=await (await request('/api/study/start',{noteId:n.id,topicId:topic.id})).json();
  assert.equal((await request(`/api/study/${session.id}/finish`,{})).status,400);
  assert.equal((await request('/api/index/update',{})).status,200);
});
