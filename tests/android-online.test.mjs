import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAndroidOnline, androidUsageReport } from '../apps/android/web/android-online.mjs';
import { createAndroidLearning, createEmptyLearningState, validateLearningState } from '../apps/android/web/android-learning.mjs';
import { createAndroidTransport } from '../apps/android/web/android-transport.mjs';

const clock=()=>new Date('2026-10-12T02:00:00.000Z');
const sourceId='11111111-1111-4111-8111-111111111111';
function fixture(handler){
  const sources=[{id:sourceId,kind:'source',title:'合成学习材料',body:'合成主题：我打算先解释，再做练习。',hash:'source-v1',meta:{privacy:'local',stage:'reference'}}];
  const states={formal:{revision:'empty',state:createEmptyLearningState()},practice:{revision:'empty',state:createEmptyLearningState()}};
  const calls=[],ledger=new Map();
  const local={
    async learningLoad({context}){return structuredClone(states[context]);},
    async learningCommit({context,expectedRevision,state}){if(states[context].revision!==expectedRevision)throw Object.assign(new Error('冲突'),{code:'CONFLICT'});validateLearningState(state);states[context]={revision:randomUUID(),state:structuredClone(state)};return structuredClone(states[context]);},
    async list(){return{notes:structuredClone(sources)};},async read({id}){const note=sources.find(n=>n.id===id);if(!note)throw Object.assign(new Error('删除'),{code:'NOT_FOUND'});return{note:structuredClone(note)};},
    async save(input){const note={id:randomUUID(),kind:'source',title:input.title,body:input.body,hash:randomUUID(),meta:{...input.meta,privacy:'local',stage:'reference'}};sources.push(note);return{note};},
  };
  const native={
    async settingsGet(){return{revision:'settings-v1',ai:{enabled:true,hasKey:true},search:{enabled:true,hasKey:true},fetch:{enabled:true},capabilities:{ai:true,search:true,fetch:true}};},
    async authorize(D){calls.push(['authorize',structuredClone(D)]);return{authorizationId:randomUUID(),inputDigest:'native-sha',expiresAt:'2026-10-12T02:01:00Z'};},
    async request(D){calls.push(['request',structuredClone(D)]);const response=await handler(D,{states,sources,local,calls});const value={requestId:D.requestId,state:'succeeded',result:response,usage:{cost:null,inputTokens:null,outputTokens:null}};ledger.set(D.requestId,value);return structuredClone(value);},
    async requestStatus({requestId,context}){calls.push(['status',context]);if(!ledger.has(requestId))throw Object.assign(new Error('不存在'),{code:'NOT_FOUND'});return structuredClone(ledger.get(requestId));},
    async cancel(){return{state:'unknown'};},async usage(){return{calls:[],budget:{callsToday:0,costMonth:0},totals:{calls:0}};},
  };
  const workflow=createAndroidOnline(local,native,{clock});
  return{local,native,states,sources,calls,ledger,workflow};
}
const extracted=(claims=[])=>({text:JSON.stringify({sourceTitle:'合成学习材料',candidates:[{title:'合成主题',body:'先解释，再做练习。',claims,topic:'合成主题',depth:'explain'}],structure:{hierarchy:[{child:'0',parent:null}],edges:[]}})});
async function run(f,job){await f.workflow.run('formal',job.id);return f.workflow.wait('formal',job.id);}

test('explicit online run saves candidates; snapshot/reopen and backup roundtrip never send requests',async()=>{
  const f=fixture(()=>extracted()),job=await f.workflow.process('formal',sourceId,{research:false});
  assert.equal(f.calls.length,0);await f.workflow.snapshot('formal');assert.equal(f.calls.length,0);
  const done=await run(f,job);assert.equal(done.state,'done',done.error);assert.equal(done.extractionSaved,true);
  assert.equal(f.states.formal.state.notes.length,1);assert.equal(f.states.formal.state.notes[0].meta.privacy,'local');
  validateLearningState(JSON.parse(JSON.stringify(f.states.formal.state)));
  const reopened=createAndroidOnline(f.local,f.native,{clock});await reopened.snapshot('formal');assert.equal(f.calls.filter(c=>c[0]==='request').length,1);
  const D=f.calls.find(c=>c[0]==='authorize')[1];assert.deepEqual(D.materials,[{id:sourceId,hash:'source-v1',kind:'source'}]);assert.equal(D.includeAnswer,false);
});

test('an uncertain paid result stops, survives reopen, and requires explicit new attempt confirmation',async()=>{
  const f=fixture(()=>{throw new Error('合成断线');}),job=await f.workflow.process('formal',sourceId,{});
  const stopped=await run(f,job);assert.equal(stopped.code,'REQUEST_UNKNOWN');assert.equal(stopped.state,'waiting');
  const reopened=createAndroidOnline(f.local,f.native,{clock});await reopened.snapshot('formal');
  await assert.rejects(reopened.run('formal',job.id),{code:'REQUEST_UNKNOWN'});
  await assert.rejects(reopened.action('formal',job.id,{action:'retry'}),{code:'REQUEST_UNKNOWN'});
  assert.equal(f.calls.filter(c=>c[0]==='request').length,1);
  f.native.request=async D=>{f.calls.push(['request',D]);return{requestId:D.requestId,state:'succeeded',result:extracted(),usage:{cost:null}};};
  await reopened.action('formal',job.id,{action:'retry',confirmUnknown:true});const complete=await reopened.wait('formal',job.id);assert.equal(complete.state,'done');
  assert.equal(f.calls.filter(c=>c[0]==='request').length,2);assert.notEqual(f.calls.filter(c=>c[0]==='request')[0][1].requestId,f.calls.filter(c=>c[0]==='request')[1][1].requestId);
});

test('successful native request is recovered once after a workflow interruption without another paid send',async()=>{
  const f=fixture(()=>extracted()),job=await f.workflow.process('formal',sourceId,{}),requestId=randomUUID();
  f.states.formal.state.records.jobs[job.id].requests.extract={requestId,state:'prepared',capability:'model'};
  f.ledger.set(requestId,{requestId,state:'succeeded',result:extracted(),usage:{cost:0}});
  const done=await run(f,job);assert.equal(done.state,'done');assert.equal(f.states.formal.state.notes.length,1);assert.equal(f.calls.some(c=>c[0]==='request'),false);
  assert.equal(f.calls.find(c=>c[0]==='status')[1],'formal');
  const reopened=createAndroidOnline(f.local,f.native,{clock});await reopened.run('formal',job.id);await reopened.wait('formal',job.id);
  assert.equal(f.states.formal.state.notes.length,1);assert.equal(f.calls.some(c=>c[0]==='authorize'||c[0]==='request'),false);
});

test('exported prepared requests without the new device ledger stay unknown through cancel and retry until a new attempt is confirmed',async()=>{
  for(const path of ['run','cancel-retry']){
    let entered,release;const started=new Promise(resolve=>{entered=resolve;});
    const original=fixture(async()=>{entered();return new Promise(resolve=>{release=()=>resolve(extracted());});});
    const job=await original.workflow.process('formal',sourceId,{});await original.workflow.run('formal',job.id);await started;
    // The learning backup has the prepared checkpoint; the native ledger is
    // device-local and is deliberately absent from this serialized backup.
    const backup=JSON.stringify(original.states.formal.state),oldRequest=original.calls.find(c=>c[0]==='request')[1];
    assert.equal(JSON.parse(backup).records.jobs[job.id].requests.extract.state,'prepared');
    const restored=fixture(()=>extracted());restored.states.formal={revision:randomUUID(),state:JSON.parse(backup)};
    if(path==='cancel-retry')restored.native.requestStatus=async({requestId,context})=>{restored.calls.push(['status',context]);assert.equal(requestId,oldRequest.requestId);throw Object.assign(new Error('合成账本未迁移'),{code:'REQUEST_NOT_FOUND'});};
    const reopened=createAndroidOnline(restored.local,restored.native,{clock});await reopened.snapshot('formal');assert.equal(restored.calls.length,0);
    if(path==='run'){
      await reopened.run('formal',job.id);const stopped=await reopened.wait('formal',job.id);
      assert.equal(stopped.state,'waiting');assert.equal(stopped.code,'REQUEST_UNKNOWN');assert.equal(stopped.requests.extract.state,'unknown');
    }
    await reopened.action('formal',job.id,{action:'cancel'});
    await assert.rejects(reopened.action('formal',job.id,{action:'retry'}),{code:'REQUEST_UNKNOWN'});
    const checkpoint=restored.states.formal.state.records.jobs[job.id];assert.equal(checkpoint.code,'REQUEST_UNKNOWN');assert.equal(checkpoint.requests.extract.state,'unknown');
    assert.equal(restored.calls.some(c=>c[0]==='authorize'||c[0]==='request'),false);assert.equal(restored.states.formal.state.notes.length,0);
    await reopened.action('formal',job.id,{action:'retry',confirmUnknown:true});const done=await reopened.wait('formal',job.id);
    assert.equal(done.state,'done',done.error);assert.equal(restored.states.formal.state.notes.length,1);
    const newRequests=restored.calls.filter(c=>c[0]==='request'),newGrants=restored.calls.filter(c=>c[0]==='authorize');
    assert.equal(newRequests.length,1);assert.equal(newGrants.length,1);assert.notEqual(newRequests[0][1].requestId,oldRequest.requestId);
    assert.notEqual(newRequests[0][1].authorizationId,oldRequest.authorizationId);assert.equal(newGrants[0][1].requestId,newRequests[0][1].requestId);
    await original.workflow.action('formal',job.id,{action:'cancel'});release();await original.workflow.wait('formal',job.id);
    assert.equal(original.states.formal.state.notes.length,0);
  }
});

test('confirmation on a restored prepared checkpoint creates a fresh request and grant directly',async()=>{
  const f=fixture(()=>extracted()),job=await f.workflow.process('formal',sourceId,{}),oldRequestId=randomUUID();
  f.states.formal.state.records.jobs[job.id].requests.extract={requestId:oldRequestId,state:'prepared',capability:'model'};
  f.states.formal.state.records.jobs[job.id].state='running';
  const reopened=createAndroidOnline(f.local,f.native,{clock});await reopened.action('formal',job.id,{action:'cancel'});
  await reopened.action('formal',job.id,{action:'retry',confirmUnknown:true});const done=await reopened.wait('formal',job.id);
  assert.equal(done.state,'done',done.error);const requests=f.calls.filter(c=>c[0]==='request');assert.equal(requests.length,1);
  assert.notEqual(requests[0][1].requestId,oldRequestId);assert.equal(f.calls.filter(c=>c[0]==='authorize').length,1);
});

test('source version changes during generation leave input intact and cannot create stale candidates',async()=>{
  const f=fixture((D,{sources})=>{sources[0].hash='source-v2';return extracted();}),job=await f.workflow.process('formal',sourceId,{});
  const failed=await run(f,job);assert.equal(failed.code,'SOURCE_CHANGED');assert.equal(f.states.formal.state.notes.length,0);assert.equal(f.sources[0].hash,'source-v2');
});

test('research uses exact page excerpts and protects user edits with a proposal, not overwrite',async()=>{
  let firstEvaluation=true;
  const f=fixture(async(D,{states,local})=>{
    if(D.purpose==='decompose')return extracted(['合成事实']);
    if(D.purpose==='research-search')return{results:[{title:'合成网页',url:'https://example.com/evidence',snippet:'不作为证据'}]};
    if(D.purpose==='research-read')return{url:'https://example.com/evidence',title:'合成网页',text:'网页正文：合成事实有条件。',fetchedAt:clock().toISOString()};
    if(firstEvaluation){firstEvaluation=false;const loaded=await local.learningLoad({context:'formal'}),service=createAndroidLearning({state:loaded.state,sources:f.sources,clock});const note=service.state.notes[0];service.editNote(note.id,{expectedHash:note.hash,body:'用户编辑的解释必须保留。'});await local.learningCommit({context:'formal',expectedRevision:loaded.revision,state:service.state});}
    return{text:JSON.stringify({assessments:[{index:0,role:'support',rationale:'支持有条件的合成事实。',excerpt:'合成事实有条件。'}],conclusion:'仅在该条件下成立。',evidenceSufficient:true,unresolvedConflict:false,limitations:[]})};
  });
  const job=await f.workflow.process('formal',sourceId,{research:true}),done=await run(f,job);
  assert.equal(done.state,'done');assert.equal(f.states.formal.state.notes[0].body,'用户编辑的解释必须保留。');
  const snapshot=await f.workflow.snapshot('formal');assert.equal(snapshot.proposals.length,1);assert.equal(snapshot.proposals[0].meta.evidence[0].excerpt,'合成事实有条件。');
  await f.workflow.proposalAction('formal',snapshot.proposals[0].id,{action:'accept'});assert.equal(f.states.formal.state.notes[0].meta.stage,'candidate');assert.equal(f.states.formal.state.notes[0].meta.acceptedResearchProposal,snapshot.proposals[0].id);
  const rejected=fixture(D=>D.purpose==='decompose'?extracted(['合成事实']):D.purpose==='research-search'?{results:[{url:'https://example.com/a'}]}:D.purpose==='research-read'?{url:'https://example.com/a',title:'合成页',text:'正文没有摘录',fetchedAt:clock().toISOString()}:{text:JSON.stringify({assessments:[{index:0,role:'support',rationale:'伪造',excerpt:'不存在的摘录'}],conclusion:'伪造',evidenceSufficient:true,unresolvedConflict:false,limitations:[]})});
  const bad=await rejected.workflow.process('formal',sourceId,{research:true});assert.equal((await run(rejected,bad)).code,'INVALID_EVIDENCE');assert.equal(rejected.states.formal.state.notes.length,1);assert.ok(rejected.states.formal.state.notes[0].meta.researchLimitations.length);
});

test('AI feedback keeps original answer, settles once and cannot forge old offline evidence',async()=>{
  const f=fixture(D=>D.purpose==='decompose'?extracted():{text:JSON.stringify({assessment:'correct',feedback:'这是合成反馈。',nextQuestion:'换个合成场景？',suggestion:'合成理解草稿'})});
  const job=await f.workflow.process('formal',sourceId,{});await run(f,job);
  let state=f.states.formal.state,service=createAndroidLearning({state,sources:f.sources,clock});const note=service.state.notes[0];service.promote(note.id,{stage:'learning',reason:'合成练习'});const s=service.learning.startStudy({noteId:note.id});f.states.formal={revision:randomUUID(),state:service.state};
  const saved=await f.workflow.answer('formal',s.id,{answer:'我的原始合成回答',hintUsed:false,requestId:'user-answer-1',evaluate:true});assert.equal(saved.status,'awaiting_feedback');
  await run(f,saved.job);state=f.states.formal.state;assert.equal(state.records.sessions[s.id].turns[0].answer,'我的原始合成回答');assert.equal(state.records.sessions[s.id].turns[0].feedback.assessment,'correct');assert.equal(state.notes[0].meta.confirmedAt,undefined);
  const duplicate=await f.workflow.answer('formal',s.id,{answer:'不能覆盖之前回答',hintUsed:false,requestId:'user-answer-1',evaluate:true});assert.equal(duplicate.jobId,saved.jobId);assert.equal(duplicate.turns.length,1);assert.equal(duplicate.turns[0].answer,'我的原始合成回答');assert.equal(f.calls.filter(c=>c[0]==='request'&&c[1].purpose==='grade').length,1);
  service=createAndroidLearning({state,sources:f.sources,clock});const complete=service.learning.finishStudy(s.id);assert.equal(complete.completion.evidence.assessmentMode,'online');assert.equal(complete.completion.reviewSettled,true);assert.deepEqual(service.learning.finishStudy(s.id),complete);
  const forged=service.state;delete forged.records.sessions[s.id].assessmentMode;assert.throws(()=>validateLearningState(forged),/离线/);
  const D=f.calls.find(c=>c[0]==='authorize'&&c[1].purpose==='grade')[1];assert.equal(D.includeAnswer,true);assert.equal(D.includeHistory,false);assert.ok(D.materials.some(m=>m.id===sourceId&&m.kind==='source'));assert.ok(D.materials.some(m=>m.kind==='answer'&&m.hash==='user-answer-1'));
});

test('output citations are checked and actual adoption remains separate from generation',async()=>{
  const f=fixture(D=>D.purpose==='decompose'?extracted():{text:JSON.stringify({answer:`合成输出 [${f.states.formal.state.notes[0].id}]`,citationIds:[f.states.formal.state.notes[0].id]})});
  await run(f,await f.workflow.process('formal',sourceId,{}));
  const ask=await f.workflow.ask('formal',{question:'合成主题',scope:['knowledge'],mode:'draft',privacy:'cloud'});const done=await run(f,ask);assert.equal(done.result.generated,true);assert.deepEqual(f.states.formal.state.records.uses,undefined);
  const id=done.result.draftId,noteId=f.states.formal.state.notes[0].id;
  await assert.rejects(f.workflow.updateDraft('formal',id,{usedIds:['not-a-citation']}),{code:'INVALID_CITATION'});
  await f.workflow.updateDraft('formal',id,{usedIds:[noteId]});assert.equal(Object.values(f.states.formal.state.records.uses).length,1);
  await f.workflow.updateDraft('formal',id,{usedIds:[]});assert.equal(Object.values(f.states.formal.state.records.uses).length,0);
  const callsBefore=f.calls.length,sourceCount=f.sources.length;const captured=await f.workflow.captureDraft('formal',id,{title:'用户收集的合成草稿',body:'用户编辑后的合成输出',privacy:'local'});assert.equal(captured.jobs.length,0);assert.equal(captured.notes[0].meta.privacy,'local');assert.equal(f.sources.length,sourceCount+1);assert.equal(f.calls.length,callsBefore);assert.equal(Object.values(f.states.formal.state.records.uses).length,0);
  const other=await f.workflow.ask('formal',{question:'合成主题',scope:['knowledge'],mode:'answer',privacy:'cloud'});f.native.request=async D=>({requestId:D.requestId,state:'succeeded',result:{text:JSON.stringify({answer:'错误引用 [absent]',citationIds:['absent']})},usage:{cost:0}});const bad=await run(f,other);assert.equal(bad.code,'INVALID_CITATION');assert.equal(Object.values(f.states.formal.state.records.drafts).length,1);
});

test('transport exposes online jobs without automatically running and preserves practice isolation',async()=>{
  const f=fixture(()=>extracted()),transport=createAndroidTransport(f.local,{online:f.native,clock});
  const job=await transport.request(`/api/notes/${sourceId}/process`,{method:'POST',body:{research:false}});
  const boot=await transport.request('/api/bootstrap');assert.equal(boot.capabilities.ai,true);assert.equal(boot.jobs.length,1);assert.equal(f.calls.length,0);
  await assert.rejects(transport.request('/api/practice/android-local/android/online-run',{method:'POST',body:{jobId:job.id}}),{code:'NOT_FOUND'});
  await assert.rejects(transport.request('/api/practice/android-local/settings',{method:'PUT',body:{credentials:{model:'synthetic-only'}}}),{code:'PRACTICE_ISOLATION'});
  assert.equal(f.calls.length,0);
});

test('claim checkpoints survive an uncertain later evaluation; explicit retry keeps earlier verified work',async()=>{
  let evaluations=0;
  const f=fixture(D=>{
    if(D.purpose==='decompose')return extracted(['合成事实一','合成事实二']);
    if(D.purpose==='research-search')return{results:[{url:'https://example.com/test',title:'合成证据'}]};
    if(D.purpose==='research-read')return{url:'https://example.com/test',title:'合成证据',text:'合成事实条件。',fetchedAt:clock().toISOString()};
    evaluations++;if(evaluations===2)throw new Error('第二主张评估结果不明');
    return{text:JSON.stringify({assessments:[{index:0,role:'support',rationale:'有条件支持',excerpt:'合成事实条件。'}],conclusion:'有限条件成立。',evidenceSufficient:true,unresolvedConflict:false,limitations:[]})};
  });
  const job=await f.workflow.process('formal',sourceId,{research:true}),stopped=await run(f,job);
  assert.equal(stopped.code,'REQUEST_UNKNOWN');assert.equal(stopped.researchProgress.verified,1);
  const candidateId=f.states.formal.state.notes[0].id;
  assert.equal(Object.values(f.states.formal.state.records.research).length,1);
  const beforeCalls=f.calls.filter(c=>c[0]==='request'&&c[1].purpose==='research-search').length;
  await f.workflow.action('formal',job.id,{action:'retry',confirmUnknown:true});const done=await f.workflow.wait('formal',job.id);
  assert.equal(done.state,'done');assert.equal(done.researchProgress.verified,2);assert.equal(evaluations,3);
  assert.equal(f.calls.filter(c=>c[0]==='request'&&c[1].purpose==='research-search').length,beforeCalls);
  assert.equal(f.states.formal.state.notes[0].id,candidateId);
});

test('cancelled model response cannot create candidates or grade; deleted candidate cannot be recreated',async()=>{
  let release,entered;
  const started=new Promise(resolve=>{entered=resolve;});
  const f=fixture(async()=>{entered();return new Promise(resolve=>{release=()=>resolve(extracted());});}),job=await f.workflow.process('formal',sourceId,{});
  await f.workflow.run('formal',job.id);await started;
  await f.workflow.action('formal',job.id,{action:'cancel'});release();const cancelled=await f.workflow.wait('formal',job.id);
  assert.equal(cancelled.state,'cancelled');assert.equal(f.states.formal.state.notes.length,0);
  const g=fixture(()=>extracted(['待核验合成事实'])),saved=await g.workflow.process('formal',sourceId,{});await run(g,saved);
  const research=await g.workflow.process('formal',sourceId,{research:true,reuseExtracted:true});
  g.states.formal.state.notes=[];const failed=await run(g,research);assert.equal(failed.code,'CANDIDATE_REMOVED');assert.equal(g.states.formal.state.notes.length,0);
});

test('usage shows unknown cost and tokens without inventing zero, and keeps the native shared budget',()=>{
  const budget={callsToday:3,costMonth:null,knownCostMonth:0.4,unknownCostCalls:1,dailyCallLimit:20,monthlyBudget:3};
  const report=androidUsageReport({budget,calls:[{id:'a',at:'2026-10-12T02:00:00Z',capability:'model',model:'synthetic',ok:true,cost:0.4,inputTokens:100,outputTokens:50},{id:'b',at:'2026-10-12T02:00:01Z',capability:'search',ok:false,cost:null,inputTokens:null,outputTokens:null},{id:'c',at:'2026-10-01T02:00:00Z',capability:'model',ok:true,cost:0.2,inputTokens:10,outputTokens:10}]},{filters:{period:'today'},timezone:'Asia/Singapore',date:clock()});
  assert.equal(report.totals.calls,2);assert.equal(report.totals.knownCost,0.4);assert.equal(report.totals.unknownCostCalls,1);assert.equal(report.totals.totalTokens,150);assert.equal(report.budget.costMonth,null);assert.equal(report.budget.callsToday,3);assert.equal(report.recentCalls.length,2);assert.equal(report.daily[0].date,'2026-10-12');
});

test('native rejection before sending is a budget wait, rather than an uncertain paid request',async()=>{
  const f=fixture(()=>extracted()),send=f.native.request;f.native.request=async()=>{throw Object.assign(new Error('合成每日上限'),{code:'DAILY_LIMIT'});};
  const job=await f.workflow.process('formal',sourceId,{}),waiting=await run(f,job);assert.equal(waiting.state,'waiting');assert.equal(waiting.code,'DAILY_LIMIT');assert.equal(waiting.requests.extract.state,'failed');assert.equal(f.states.formal.state.notes.length,0);
  f.states.practice.state=structuredClone(f.states.formal.state);const reopened=createAndroidOnline(f.local,f.native,{clock});await assert.rejects(reopened.snapshot('practice'),{code:'PRACTICE_ISOLATION'});
  f.native.request=send;await reopened.action('formal',job.id,{action:'retry'});const done=await reopened.wait('formal',job.id);assert.equal(done.state,'done',done.error);
  assert.notEqual(done.requests.extract.requestId,waiting.requests.extract.requestId);assert.equal(f.calls.filter(c=>c[0]==='authorize').length,2);assert.equal(f.calls.filter(c=>c[0]==='request').length,1);
});

test('authorization refusal persists an unsent failed checkpoint and explicit retry uses a new request and authorization',async()=>{
  for(const refused of ['throw','missing-grant']){
    const f=fixture(()=>extracted()),authorize=f.native.authorize;
    f.native.authorize=async()=>{if(refused==='throw')throw Object.assign(new Error('合成用户拒绝授权'),{code:'AUTHORIZATION_DENIED'});return{};};
    const job=await f.workflow.process('formal',sourceId,{}),failed=await run(f,job);
    assert.equal(failed.code,'AUTHORIZATION_DENIED');assert.equal(failed.requests.extract.state,'failed');assert.equal(f.calls.some(c=>c[0]==='request'),false);
    f.native.authorize=authorize;const reopened=createAndroidOnline(f.local,f.native,{clock});await reopened.action('formal',job.id,{action:'retry'});
    const done=await reopened.wait('formal',job.id);assert.equal(done.state,'done',done.error);assert.notEqual(done.requests.extract.requestId,failed.requests.extract.requestId);
    assert.equal(f.calls.filter(c=>c[0]==='request').length,1);assert.equal(f.calls.filter(c=>c[0]==='authorize').length,1);
  }
});

const structureResult=notes=>({text:JSON.stringify({structure:{hierarchy:notes.map(n=>({child:n.id,parent:null})),edges:[]}})});
test('standalone structure binds current edited knowledge and keeps late changes stale without overwriting or resurrecting',async()=>{
  for(const change of ['edit','delete','source']){
    let f;
    f=fixture(async(D,{states,sources,local})=>{
      if(D.purpose==='decompose')return extracted();
      assert.equal(D.purpose,'structure');assert.ok(D.materials.some(m=>m.kind==='knowledge'));assert.ok(D.materials.some(m=>m.id===sourceId&&m.kind==='source'));
      const result=structureResult(structuredClone(states.formal.state.notes));
      if(change==='source')sources[0].hash='changed-source';
      else if(change==='delete')states.formal.state.notes=[];
      else{const loaded=await local.learningLoad({context:'formal'}),service=createAndroidLearning({state:loaded.state,sources,clock}),n=service.state.notes[0];service.editNote(n.id,{expectedHash:n.hash,body:'分析期间用户新写的正文。'});await local.learningCommit({context:'formal',expectedRevision:loaded.revision,state:service.state});}
      return result;
    });
    await run(f,await f.workflow.process('formal',sourceId,{}));
    const before=f.states.formal.state.notes[0],service=createAndroidLearning({state:f.states.formal.state,sources:f.sources,clock});service.editNote(before.id,{expectedHash:before.hash,body:'分析前已经编辑过的知识。'});f.states.formal={revision:randomUUID(),state:service.state};
    const job=await f.workflow.structure('formal',sourceId,{}),done=await run(f,job);
    assert.equal(done.state,'done');assert.equal(done.result.structure.state,'stale');assert.equal(f.sources[0].meta.privacy,'local');
    if(change==='delete')assert.equal(f.states.formal.state.notes.length,0);
    else assert.equal(f.states.formal.state.notes[0].body,change==='edit'?'分析期间用户新写的正文。':'分析前已经编辑过的知识。');
    const read=createAndroidLearning({state:f.states.formal.state,sources:f.sources,clock}).getNote(sourceId);assert.equal(read.structure.state,'stale');assert.deepEqual(read.structure.edges,[]);
  }
});

test('standalone structure recovers a succeeded native request once and never sends a duplicate model request',async()=>{
  const f=fixture(()=>extracted());await run(f,await f.workflow.process('formal',sourceId,{}));
  const job=await f.workflow.structure('formal',sourceId,{}),requestId=randomUUID(),notes=f.states.formal.state.notes;
  f.states.formal.state.records.jobs[job.id].requests.structure={requestId,state:'prepared',capability:'model'};
  f.ledger.set(requestId,{requestId,state:'succeeded',result:structureResult(notes),usage:{cost:0}});
  const callsBefore=f.calls.filter(c=>c[0]==='request').length,done=await run(f,job);
  assert.equal(done.state,'done');assert.equal(done.result.structure.state,'ready');assert.equal(f.calls.filter(c=>c[0]==='request').length,callsBefore);
  const service=createAndroidLearning({state:f.states.formal.state,sources:f.sources,clock});assert.equal(service.getNote(sourceId).structure.state,'ready');assert.equal(service.state.notes[0].body,notes[0].body);
});
