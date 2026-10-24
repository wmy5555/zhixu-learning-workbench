import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeLearningPractice, learningPractice, learningSourceIds } from '../src/learning-guidance.mjs';
import { createService } from '../src/service.mjs';
import { feedbackHTML } from '../public/web/parity.mjs';
const body='读完一段，合上书，用自己的话写出主张和理由，再对照原文核对。';
const plan={depth:'explain',question:'合上书后要写哪两项，随后怎样核对？',criteria:[{point:'用自己的话写主张和理由',quote:'用自己的话写出主张和理由'},{point:'随后对照原文',quote:'再对照原文核对'}]};
test('questions only use valid material quotes and become stale after an edit',()=>{
 const valid=makeLearningPractice(plan,body);assert.ok(valid);assert.ok(learningPractice({body,meta:{learningPractice:valid}},'explain'));
 assert.equal(learningPractice({body:body+'新增内容',meta:{learningPractice:valid}},'explain'),null);assert.equal(learningPractice({body,meta:{learningPractice:valid}},'apply'),null);
 assert.ok(learningPractice({body:body+'\n## 我的理解（用户确认）\n\n我会自己解释。',meta:{learningPractice:valid}},'explain'),'separate personal understanding does not erase the unchanged material question');
 assert.equal(makeLearningPractice({...plan,criteria:[{point:'提升所有人的记忆力',quote:'未提供的证据'}]},body),null);
 assert.deepEqual(learningSourceIds({meta:{sources:[{id:'a',role:'input'},{id:'a',role:'input'},{id:'b',role:'support'}]}}),['a']);
});
test('one extraction creates a grounded question; first grading uses its criteria and follow-up does not',async t=>{
 const dir=fs.mkdtempSync(path.resolve('.tmp/learning-guidance-'));const calls=[];
 const s=createService({dataDir:path.join(dir,'data'),vaultDir:path.join(dir,'vault'),aiOverride:{generate:async input=>{calls.push(input);return {text:JSON.stringify(calls.length===1?{candidates:[{title:'读书核对',body,claims:[],depth:'explain',practice:plan}]}:{assessment:'correct',feedback:'主张、理由和核对都说清楚了。',nextQuestion:'如果只是抄写原文，会漏掉哪个动作？'})};}}});t.after(async()=>{await s.close();fs.rmSync(dir,{recursive:true,force:true});});
 const original=s.importItems({items:[{title:'合成原文',body}],process:true});await s.runJobs();assert.equal(calls.length,1);
 const note=s.readPublicNote(original.notes[0].id).children[0];assert.ok(note.meta.learningPractice);s.promote(note.id,{stage:'learning',depth:'explain'});
 const session=s.startStudy({noteId:note.id});assert.equal(session.question,plan.question);assert.equal(calls.length,1,'opening study must not add a paid request');
 s.answerStudy(session.id,{answer:'写主张和理由，再核对',requestId:'first'});while(s.store.records('jobs').some(j=>j.state==='queued'))await s.runJobs();
 assert.match(calls.at(-1).prompt,/本题评分依据/);assert.match(calls.at(-1).prompt,/用自己的话写主张和理由/);
 s.answerStudy(session.id,{answer:'抄写无法检验自己的解释',requestId:'second'});await s.runJobs();assert.match(calls.at(-1).prompt,/不复用首题评分要点/);
});
test('feedback keeps diagnosis visible and detailed answer folded',()=>{
 const html=feedbackHTML({assessment:'partial',feedback:'主张说清楚了，补一句理由。',omission:'缺理由',correction:'<script>unsafe</script>',nextQuestion:'为什么需要这个条件？',suggestion:'尝试自己改写'});
 assert.match(html,/主张说清楚了/);assert.match(html,/<details[^>]*><summary>查看解析/);assert.doesNotMatch(html,/<details[^>]*\bopen\b|<script>/);assert.ok(html.indexOf('主张说清楚了')<html.indexOf('<details'));assert.ok(html.indexOf('缺理由')>html.indexOf('<details'));
});

test('practice-space recall and review questions take precedence without inheriting another question rubric',async t=>{
 const dir=fs.mkdtempSync(path.resolve('.tmp/practice-question-'));let question='场景首次回忆题';
 const s=createService({dataDir:path.join(dir,'data'),vaultDir:path.join(dir,'vault'),practice:true,getPracticeQuestion:()=>question});
 t.after(async()=>{await s.close();fs.rmSync(dir,{recursive:true,force:true});});
 const note=s.store.create({kind:'knowledge',title:'场景知识',body,meta:{stage:'learning',depth:'explain',learningPractice:makeLearningPractice(plan,body)}});
 for(const expected of ['场景首次回忆题','跨日复习的新题']){
  question=expected;const session=s.startStudy({noteId:note.id});assert.equal(session.question,expected);
  assert.equal(session.practiceQuestion,undefined);assert.equal(session.practiceCriteria,undefined);
 }
 question=null;const generated=s.startStudy({noteId:note.id});assert.equal(generated.question,plan.question);assert.deepEqual(generated.practiceCriteria,plan.criteria);
 const mistake=s.store.create({kind:'mistake',title:'误解',body:'需回查条件',meta:{noteId:note.id,correctionState:'open',nextQuestion:'错题专用问题'}});
 question='不应用于错题';const correction=s.startStudy({mistakeId:mistake.id});assert.equal(correction.question,'错题专用问题');assert.equal(correction.practiceCriteria,undefined);
});
