import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createService } from '../src/service.mjs';
import { processOutcome } from '../public/web/process-outcome.mjs';

function setup(t) {
  fs.mkdirSync(path.resolve('.tmp'), { recursive:true });
  const root=fs.mkdtempSync(path.resolve('.tmp/learning-flow-'));
  const calls={ extraction:0,research:0,prompts:[] };
  const ai={ withBudget:async(_,fn)=>fn(),generate:async input=>{
    calls.prompts.push(input.prompt);
    if(input.prompt.includes('依据材料评价理解'))return {text:JSON.stringify({assessment:'correct',feedback:'合成反馈',nextQuestion:'有什么边界？'})};
    calls.extraction++;return {text:JSON.stringify({candidates:[{title:'合成待核验知识',body:'合成待核验主张，保留适用条件。',claims:['合成主张']}]})};
  },research:async({claim})=>{calls.research++;return {claim,limitations:[],conclusion:'仅用于测试的证据',evidence:[{url:'https://example.invalid/synthetic',title:'合成证据',excerpt:'合成原文证据',role:'support',fetchedAt:new Date().toISOString()}]};}};
  const service=createService({dataDir:path.join(root,'data'),vaultDir:path.join(root,'vault'),aiOverride:ai});
  t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
  return {service,calls,async extract(){const source=service.importItems({items:[{title:'合成原文',body:'合成待核验主张'}]}).notes[0];service.processNote(source.id);await service.runJobs();return {source,note:service.readPublicNote(source.id).children[0]};}};
}

test('optional research permits study with warnings but never certifies RAG, topic order or lifecycle',async t=>{
  const h=setup(t),{service:s,calls}=h,{source,note}=await h.extract();
  assert.equal(calls.research,0);
  assert.throws(()=>s.startStudy({noteId:note.id}),/加入学习/);
  s.promote(note.id,{stage:'learning',depth:'apply',reason:'主动练习'});
  const plan=s.today().items.find(p=>p.noteId===note.id);assert.ok(plan.materialWarnings.length);
  const session=s.startStudy({noteId:note.id,planId:plan.id});assert.ok(session.materialWarnings.length);
  const answer=await s.ask({question:'合成待核验',scope:['knowledge']});assert.equal(answer.citations.length,0);
  const topic=s.createTopic({title:'合成主题',noteIds:[note.id],minutes:10});
  assert.equal(s.topics().find(x=>x.id===topic.id).progress.nextNoteId,note.id);
  s.editNote(source.id,{body:'合成新版本',expectedHash:source.hash});
  assert.match(s.startStudy({noteId:note.id}).materialWarnings.join(' '),/修改或删除/);
  s.promote(note.id,{stage:'retired',reason:'暂停使用'});assert.throws(()=>s.startStudy({noteId:note.id}),{code:'NOTE_UNAVAILABLE'});
  s.store.update(note.id,{expectedHash:s.getNote(note.id).hash,meta:{stage:'learning',supersededBy:'synthetic-kept'}});assert.throws(()=>s.startStudy({noteId:note.id}),{code:'NOTE_UNAVAILABLE'});
});

test('research after joining learning updates evidence in place and preserves the chosen goal',async t=>{
  const h=setup(t),{service:s,calls}=h,{source,note}=await h.extract();
  s.promote(note.id,{stage:'learning',depth:'apply',reason:'保留我的目标'});
  s.processNote(source.id,{research:true,reuseExtracted:true});await drain(s);
  const after=s.getNote(note.id);assert.equal(after.meta.stage,'learning');assert.equal(after.meta.depth,'apply');assert.equal(after.meta.promotionReason,'保留我的目标');
  assert.deepEqual(after.meta.researchLimitations,[]);assert.equal(calls.extraction,1);assert.equal(calls.research,1);
  assert.equal(s.store.records('proposals').length,0);assert.equal(s.startStudy({noteId:note.id}).materialWarnings.length,0);
});

for(const protection of ['edit','active-study','understanding'])test(`research protects ${protection}; accepting a revision keeps learning selected`,async t=>{
  const h=setup(t),{service:s}=h,{source,note}=await h.extract();
  let current=s.promote(note.id,{stage:'learning',depth:'find',reason:'原来的学习目标'});
  if(protection==='edit')current=s.editNote(note.id,{body:current.body+'\n人工内容',expectedHash:current.hash});
  if(protection==='active-study')s.startStudy({noteId:note.id});
  if(protection==='understanding')current=s.confirmNote(note.id,{body:'我的原有理解',expectedHash:current.hash});
  const before=s.getNote(note.id);
  s.processNote(source.id,{research:true,reuseExtracted:true});await drain(s);
  assert.equal(s.getNote(note.id).hash,before.hash);
  const proposal=s.store.records('proposals').find(p=>p.noteId===note.id&&p.state==='pending');assert.ok(proposal);
  s.proposalAction(proposal.id,{action:'accept'});
  const after=s.getNote(note.id);assert.equal(after.meta.stage,'learning');assert.equal(after.meta.depth,'find');assert.equal(after.meta.confirmedAt,null);
  assert.deepEqual(after.meta.researchLimitations,[]);assert.equal(s.startStudy({noteId:note.id}).materialWarnings.length,0);
});

for(const state of ['waiting','failed','cancelled'])test(`inline ${state} retry requires the shown id and deduplicates queued requests`,async t=>{
  const h=setup(t),{service:s,calls}=h,{source}=await h.extract();
  const job=s.processNote(source.id,{research:true,reuseExtracted:true});s.store.put('jobs',job.id,{...s.store.get('jobs',job.id),state});
  assert.equal(s.processNote(source.id,{research:true,reuseExtracted:true}).state,state);
  assert.equal(calls.research,0);
  const retried=s.processNote(source.id,{research:true,retryJobId:job.id});assert.equal(retried.id,job.id);assert.equal(retried.state,'queued');
  assert.equal(s.processNote(source.id,{research:true,retryJobId:job.id}).id,job.id);
  await drain(s);assert.equal(calls.extraction,1);assert.equal(calls.research,1);
  assert.equal(s.processNote(source.id,{research:true,retryJobId:job.id}).state,'done');
  assert.equal(s.store.records('jobs').filter(j=>j.type==='process').length,2);
  s.editNote(source.id,{body:'新合成版本',expectedHash:source.hash});
  assert.throws(()=>s.processNote(source.id,{research:true,retryJobId:job.id}),{code:'PROCESS_RETRY_CHANGED'});
});

test('retry cannot switch to another source and respects the newly selected research option',async t=>{
  const h=setup(t),{service:s,calls}=h,{source}=await h.extract();
  const other=s.importItems({items:[{title:'另一份合成原文',body:'独立材料'}]}).notes[0];
  const job=s.processNote(source.id,{research:true,reuseExtracted:true});s.store.put('jobs',job.id,{...s.store.get('jobs',job.id),state:'failed'});
  assert.throws(()=>s.processNote(other.id,{research:true,retryJobId:job.id}),{code:'PROCESS_RETRY_CHANGED'});
  s.processNote(source.id,{research:false,retryJobId:job.id});await drain(s);assert.equal(calls.research,0);
});

test('task outcomes distinguish paused work, ongoing work and completion and escape error text',()=>{
  for(const state of ['waiting','failed','cancelled']){const outcome=processOutcome({state,error:'<img onerror=bad()>',extractionSaved:true},{research:true,sourceId:'source'});assert.equal(outcome.retry,true);assert.match(outcome.html,/data-process-retry/);assert.doesNotMatch(outcome.html,/<img/);assert.match(outcome.html,/才会重新排队/);}
  for(const state of ['queued','running','done'])assert.doesNotMatch(processOutcome({state}).html,/data-process-retry/);
  assert.match(processOutcome({state:'done'},{pendingProposals:1}).html,/核对修订建议/);
});

async function drain(s){for(let i=0;i<20&&s.store.records('jobs').some(j=>j.state==='queued');i++)await s.runJobs();assert.ok(!s.store.records('jobs').some(j=>j.state==='queued'));}

test('grading receives uncertainty and learning success does not remove the warning',async t=>{const h=setup(t),{service:s,calls}=h,{note}=await h.extract();s.updateSettings({ai:{enabled:true}});s.promote(note.id,{stage:'learning',reason:'合成练习'});const session=s.startStudy({noteId:note.id});s.answerStudy(session.id,{answer:'这是待核验的解释',requestId:'synthetic-answer'});await drain(s);assert.ok(calls.prompts.some(p=>p.includes('材料可信度提示')&&p.includes('不得将待核验主张')));assert.equal(s.session(session.id).turns[0].feedback.assessment,'correct');assert.ok(s.noteEvidence(note.id).limitations.length);});

test('research requested while plain extraction runs is an explicit follow-on, never a false completed check',()=>{const running=processOutcome({state:'running',research:false},{research:true});assert.match(running.html,/尚未包含联网核验/);const done=processOutcome({state:'done',research:false},{research:true});assert.equal(done.needsResearch,true);assert.match(done.html,/data-process-research/);assert.match(done.html,/尚未执行联网核验/);assert.doesNotMatch(processOutcome({state:'done',research:false},{research:false}).html,/data-process-research/);});

test('learning arrangement reason is optional and understanding remains required',async t=>{
 const h=setup(t),{service:s}=h,{note}=await h.extract();
 for(const reason of [undefined,'','   ','下周需要用到']) {
  const saved=s.promote(note.id,{stage:'learning',depth:'explain',...(reason===undefined?{}:{reason})});
  assert.equal(saved.meta.promotionReason,reason??'');
 }
 for(const stage of ['integrated','core'])assert.throws(()=>s.promote(note.id,{stage}),/先以自己的语言确认个人理解/);
});
