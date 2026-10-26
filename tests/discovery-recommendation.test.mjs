import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecommender } from '../public/web/discovery-recommendation.mjs';

const card=(id,type='reading',topic='主题一',noteId=id,extra={})=>({id,type,topic,noteId,sourceHash:'body-v1',prerequisites:[],...extra});
const engine=()=>createRecommender({now:()=>1000,random:()=>.5});
const ids=items=>items.map(item=>item.id);
const expose=(r,c,elapsedMs=1200)=>r.observe(c,{type:'exposure',elapsedMs});

test('today-plan items outrank explicit interest; exclusions and paused/retired records remain excluded',()=>{
 const r=engine(),due=card('due'),favorite=card('favorite','reading','兴趣主题'),paused=card('paused'),retired=card('old','reading','主题三','old',{stage:'retired'});
 r.observe(favorite,{type:'save'});r.observe(favorite,{type:'like'});
 const input=[favorite,due,paused,retired],before=JSON.stringify(input),ranked=r.rank(input,{todayNoteIds:['due'],pausedNoteIds:['paused']});
 assert.equal(ranked[0].id,'due');assert.equal(ranked[0].reasonCode,'today-review');assert.ok(!ids(ranked).includes('paused'));assert.ok(!ids(ranked).includes('old'));assert.equal(JSON.stringify(input),before);
 assert.ok(!ids(r.rank(input,{excludeIds:['due']})).includes('due'));
});

test('a small exploration slot and topic/type spacing survive a strong favorite topic',()=>{
 const r=engine(),a=[card('a1'),card('a2','lesson'),card('a3','compare')],b=card('b','reading','新主题'),c=card('c','reading','另一个主题');
 a.forEach(item=>r.observe(item,{type:'save'}));const ranked=r.rank([...a,b,c]);
 assert.equal(ranked[2].reasonCode,'exploration');assert.notEqual(ranked[2].topic,'主题一');
 for(let i=2;i<ranked.length;i++)assert.ok(new Set(ranked.slice(i-2,i+1).map(item=>item.topic)).size>1);
});

test('uncompleted prerequisites and changed source bodies cannot inherit old learning evidence',()=>{
 const r=engine(),lesson=card('lesson','lesson','主题一','note'),quiz=card('quiz','quiz','主题一','note',{prerequisites:['lesson']});
 assert.ok(!ids(r.rank([lesson,quiz])).includes('quiz'));r.observe(lesson,{type:'lesson-complete'});assert.ok(ids(r.rank([lesson,quiz])).includes('quiz'));
 const updated=[{...lesson,sourceHash:'body-v2'},{...quiz,sourceHash:'body-v2'}];assert.ok(!ids(r.rank(updated)).includes('quiz'));
 assert.equal(r.snapshot().completedLessons.length,0);
 assert.ok(!ids(r.rank([lesson,{...quiz,sourceHash:'body-v2'}])).includes('quiz'));
});

test('watching and skipping never create learning success; a skipped topic is not muted',()=>{
 const r=engine(),a=card('a');expose(r,a,60000);r.observe(a,{type:'skip'});
 const s=r.snapshot();assert.equal(s.counts.exposedCards,1);assert.equal(s.counts.quizIndependentCorrect,0);assert.equal(s.counts.flashSelfReports,0);assert.deepEqual(s.plans,[]);assert.deepEqual(s.mutedTopics,[]);assert.deepEqual(ids(r.rank([a])),['a']);
});

test('microcourse permits immediate application but delays its fact card until two other materials',()=>{
 const r=engine(),shared={basisHash:'http-body'},lesson=card('lesson','lesson','HTTP','http',{...shared,sourceHash:'lesson-v1'}),quiz=card('quiz','quiz','HTTP','http',{...shared,sourceHash:'quiz-v1',prerequisites:['lesson']}),flash=card('flash','flash','HTTP','http',{...shared,sourceHash:'flash-v1',prerequisites:['lesson']}),a=card('other-a'),b=card('other-b');
 const all=[lesson,quiz,flash,a,b];r.observe(lesson,{type:'lesson-complete'});
 assert.ok(ids(r.rank(all)).includes('quiz'));assert.ok(!ids(r.rank(all)).includes('flash'));
 expose(r,quiz);r.observe(quiz,{type:'quiz-result',correct:true,firstAttempt:true,attempt:0});
 assert.ok(!ids(r.rank(all)).includes('flash'));expose(r,a);assert.ok(!ids(r.rank(all)).includes('flash'));
 expose(r,b);const next=r.rank(all).find(c=>c.id==='flash');assert.equal(next.reasonCode,'delayed-recall');assert.equal(next.attempt,0);
});

test('material cooldown ignores repeats, resets on rereading, and isolates changed material versions',()=>{
 const r=engine(),reading=card('reading','reading','HTTP','http',{basisHash:'http-v1',sourceHash:'reading-v1'}),flash=card('flash','flash','HTTP','http',{basisHash:'http-v1',sourceHash:'flash-v1'}),a=card('a','reading','其他','a',{basisHash:'a-body'}),sameA=card('a-compare','compare','其他','a',{basisHash:'a-body',sourceHash:'a-compare'}),b=card('b');
 const all=[reading,flash,a,sameA,b];expose(r,reading);expose(r,a,50);for(let i=0;i<3;i++)r.rank(all);
 assert.equal(r.snapshot().materialCooldowns.find(c=>c.noteId==='http').remainingMaterials,2);
 expose(r,a);expose(r,a);expose(r,sameA);assert.equal(r.snapshot().materialCooldowns.find(c=>c.noteId==='http').remainingMaterials,1);
 expose(r,b);assert.ok(ids(r.rank(all)).includes('flash'));
 r.observe(reading,{type:'open-material'});assert.ok(!ids(r.rank(all)).includes('flash'));expose(r,a);expose(r,b);assert.ok(ids(r.rank(all)).includes('flash'));
 const changed={...flash,basisHash:'http-v2',sourceHash:'flash-v2'};assert.ok(ids(r.rank([reading,changed,a,b])).includes('flash'));
 expose(r,{...reading,basisHash:'http-v2',sourceHash:'reading-v2'});assert.ok(!ids(r.rank([changed,a,b])).includes('flash'));
 r.reset();assert.deepEqual(r.snapshot().materialCooldowns,[]);
});

test('shared material basis connects different card hashes while each card keeps separate evidence',()=>{
 const r=engine(),lesson=card('lesson','lesson','主题一','note',{basisHash:'same-body',sourceHash:'lesson-definition'}),quiz=card('quiz','quiz','主题一','note',{basisHash:'same-body',sourceHash:'quiz-definition',prerequisites:['lesson']}),reading=card('read','reading','主题一','note',{basisHash:'same-body',sourceHash:'reading-definition'}),a=card('a'),b=card('b');
 r.observe(lesson,{type:'lesson-complete'});assert.ok(ids(r.rank([lesson,quiz,reading,a,b])).includes('quiz'));
 expose(r,quiz);r.observe(quiz,{type:'quiz-result',correct:false,firstAttempt:true,attempt:0});
 assert.equal(r.rank([lesson,quiz,reading,a,b])[0].reasonCode,'remediation');
 r.observe(reading,{type:'open-material'});expose(r,a);expose(r,b);assert.ok(ids(r.rank([lesson,quiz,reading,a,b])).includes('quiz'));
 const editedQuiz={...quiz,sourceHash:'edited-quiz-definition'};assert.equal(r.rank([lesson,editedQuiz,reading,a,b]).find(c=>c.id==='quiz').attempt,0);
 const changedLesson={...lesson,basisHash:'changed-body',sourceHash:'changed-lesson'};assert.ok(!ids(r.rank([changedLesson,quiz,reading,a,b])).includes('quiz'));
});

test('an error first recommends explanation and requires two distinct meaningful cards before retry',()=>{
 const r=engine(),quiz=card('q','quiz','主题一','note'),reading=card('read','reading','主题一','note'),a=card('a','reading','主题二'),b=card('b','reading','主题三');
 expose(r,quiz);assert.equal(r.observe(quiz,{type:'quiz-result',correct:false,firstAttempt:true,attempt:0}),true);
 let ranked=r.rank([quiz,reading,a,b]);assert.equal(ranked[0].id,'read');assert.equal(ranked[0].reasonCode,'remediation');assert.ok(!ids(ranked).includes('q'));
 expose(r,a,50);assert.equal(r.snapshot().plans[0].remainingCards,2);
 expose(r,a);expose(r,a);expose(r,quiz);assert.equal(r.snapshot().plans[0].remainingCards,1);
 expose(r,b);assert.ok(!ids(r.rank([quiz,reading,a,b])).includes('q'));
 r.observe(quiz,{type:'open-material'});ranked=r.rank([quiz,reading,a,b]);const retry=ranked.find(item=>item.id==='q');assert.equal(retry.reasonCode,'retry-ready');assert.equal(retry.attempt,1);
 expose(r,quiz);assert.equal(r.observe(quiz,{type:'quiz-result',correct:true,firstAttempt:true,attempt:1}),true);assert.equal(r.snapshot().counts.quizIndependentCorrect,1);
});

test('hard is successful self-recall with a longer gap, not a failure needing explanation',()=>{
 const r=engine(),flash=card('f','flash'),others=[1,2,3,4].map(i=>card('r'+i,'reading','其他主题'));
 expose(r,flash);r.observe(flash,{type:'flash-result',grade:'hard',attempt:0});let plan=r.snapshot().plans[0];assert.equal(plan.remainingCards,4);assert.equal(plan.needsExplanation,false);
 others.slice(0,3).forEach(item=>expose(r,item));assert.ok(!ids(r.rank([flash,...others])).includes('f'));
 expose(r,others[3]);assert.ok(ids(r.rank([flash,...others])).includes('f'));
});

test('good/easy plans are session-only and do not rewrite the caller’s due list',()=>{
 let clock=1000;const r=createRecommender({now:()=>clock,random:()=>0}),f=card('f','flash'),e=card('e','flash'),reading=card('r','reading','主题三');
 r.observe(f,{type:'flash-result',grade:'good',attempt:0});r.observe(e,{type:'flash-result',grade:'easy',attempt:0});
 const today=['f','e'];assert.deepEqual(r.rank([f,e,reading],{mode:'review',todayNoteIds:today}),[]);assert.deepEqual(today,['f','e']);
 const plans=r.snapshot().plans;assert.equal(plans.find(p=>p.cardId==='f').suggestedAt,1000+86400000);assert.equal(plans.find(p=>p.cardId==='e').suggestedAt,1000+4*86400000);
 clock+=86400001;assert.deepEqual(ids(r.rank([f,e,reading],{mode:'review',todayNoteIds:today})),['f']);
 assert.equal(r.rank([{...f,sourceHash:'revised'}])[0].attempt,0);
});

test('assisted and immediate feedback retries never count as first independent quiz success',()=>{
 const r=engine(),q=card('q','quiz'),f=card('f','flash');
 expose(r,q);r.observe(q,{type:'open-material'});r.observe(q,{type:'quiz-result',correct:true,firstAttempt:true,attempt:0});
 assert.equal(r.snapshot().counts.quizIndependentCorrect,0);assert.equal(r.snapshot().plans.find(p=>p.cardId==='q').kind,'retry');
 r.observe(f,{type:'flash-result',grade:'easy',assisted:true,attempt:0});assert.equal(r.snapshot().plans.find(p=>p.cardId==='f').kind,'retry');
 const second=engine();second.observe(q,{type:'quiz-result',correct:true,firstAttempt:false,attempt:0});assert.equal(second.snapshot().counts.quizIndependentCorrect,0);
});

test('saved/liked signals belong to notes; muting hides discovery but preserves the review route',()=>{
 const r=engine(),a=card('a','reading','主题一','shared'),b=card('b','lesson','主题一','shared'),other=card('other','reading','主题二');
 r.observe(a,{type:'save'});r.observe(b,{type:'like'});assert.deepEqual(new Set(ids(r.rank([a,b,other],{mode:'saved'}))),new Set(['a','b']));assert.deepEqual(r.snapshot().savedNoteIds,['shared']);
 r.observe(a,{type:'not-interested'});assert.deepEqual(ids(r.rank([a,b,other])),['other']);assert.ok(ids(r.rank([a,b,other],{mode:'review',todayNoteIds:['shared']})).includes('a'));
 assert.deepEqual(new Set(ids(r.rank([a,b,other],{mode:'saved'}))),new Set(['a','b']));
 r.observe(b,{type:'unsave'});r.observe(a,{type:'unlike'});assert.deepEqual(r.snapshot().savedNoteIds,[]);assert.deepEqual(r.snapshot().likedNoteIds,[]);
});

test('attempt identity rejects repeated or stale grading and snapshots cannot mutate the engine',()=>{
 const r=engine(),q=card('q','quiz');assert.equal(r.observe(q,{type:'quiz-result',correct:true,firstAttempt:true,attempt:0}),true);assert.equal(r.observe(q,{type:'quiz-result',correct:true,firstAttempt:true,attempt:0}),false);
 const snapshot=r.snapshot();snapshot.plans[0].suggestedAt=0;snapshot.recentEvents[0].correct=false;assert.equal(r.snapshot().counts.quizIndependentCorrect,1);assert.equal(r.snapshot().plans[0].suggestedAt,1000+86400000);
});

test('rerendering preserves random tie order and never returns consecutive active tests',()=>{
 let calls=0;const r=createRecommender({now:()=>1000,random:()=>{calls++;return calls/10;}}),input=[card('q','quiz'),card('f','flash'),card('r'),card('l','lesson')];
 const first=r.rank(input),second=r.rank(input);assert.deepEqual(ids(first),ids(second));assert.equal(calls,4);
 for(let i=1;i<first.length;i++)assert.ok(!(['quiz','flash'].includes(first[i-1].type)&&['quiz','flash'].includes(first[i].type)));
 expose(r,input[0]);assert.ok(!['quiz','flash'].includes(r.rank(input)[0].type));
});

test('reset clears only session recommendation state and leaves caller content unchanged',()=>{
 const r=engine(),a=card('a','lesson');r.observe(a,{type:'save'});r.observe(a,{type:'lesson-complete'});r.observe(a,{type:'not-interested'});const before=JSON.stringify(a);r.reset();
 assert.equal(JSON.stringify(a),before);const s=r.snapshot();assert.deepEqual(s.savedNoteIds,[]);assert.deepEqual(s.completedLessons,[]);assert.deepEqual(s.mutedTopics,[]);assert.deepEqual(s.recentEvents,[]);assert.deepEqual(ids(r.rank([a])),['a']);
});
