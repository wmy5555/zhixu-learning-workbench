import test from 'node:test';
import assert from 'node:assert/strict';
import {destination} from '../public/web/onboarding-model.mjs';
import {isReviewSession,resolveReviewSession,reviewGuide} from '../public/web/onboarding-review.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const proof={roles:{explain:'chosen',currentSession:'saved-review'},clock:{now:'2026-10-07T00:30:00Z',timezone:'Asia/Shanghai'}};
const session=()=>({id:'live-review',noteId:'chosen',createdAt:'2026-10-06T18:00:00Z',status:'reading',turns:[]});

test('review relocation keeps the resolved review session instead of returning to the pool',()=>{
 assert.equal(destination({id:'review-finish'},{roles:{explain:'chosen'}},'current-review'),'study/current-review');
 assert.equal(destination({id:'review-finish'},{roles:{explain:'chosen'}},''),'study');
});

test('review identity uses the practice timezone and excludes the first day and other material',()=>{
 assert.equal(isReviewSession(session(),proof),true,'the same local date can cross UTC midnight');
 for(const patch of [{createdAt:'2026-10-06T10:00:00Z'},{noteId:'other'},{presetCase:'hints'},{completion:{abandoned:true}},{createdAt:'invalid'}])assert.equal(isReviewSession({...session(),...patch},proof),false);
});

test('relocation prefers the visible session and reads its saved identity directly without a history page',async()=>{
 const reads=[],current=session();
 assert.equal(await resolveReviewSession({proof,current,read:async id=>{reads.push(id);}}),current);assert.deepEqual(reads,[]);
 const saved={...session(),id:'saved-review'};
 assert.equal(await resolveReviewSession({proof,read:async id=>{reads.push(id);return saved;}}),saved);assert.deepEqual(reads,['saved-review']);
 assert.equal(await resolveReviewSession({proof,read:async()=>({...saved,noteId:'other'})}),null);
 assert.equal(await resolveReviewSession({proof,read:async()=>{throw Object.assign(Error('deleted'),{code:'NOT_FOUND'});}}),null);
 await assert.rejects(resolveReviewSession({proof,read:async()=>{throw Error('network');}}),/network/);
});

test('review target follows hiding, writing, submitting, waiting, finishing and completion',()=>{
 const nodes=new Map(),root={querySelectorAll:selector=>nodes.get(selector)||[]},visible=n=>!n.hidden;
 const hide={},answer={value:'',hidden:true},submit={},waiting={},finish={},completed={},back={};
 nodes.set('#main [data-action="hide-material"]',[hide]);nodes.set('#answer-form textarea',[answer]);nodes.set('#answer-form button[type="submit"]',[submit]);nodes.set('#main .waiting-note',[waiting]);nodes.set('#main [data-action="finish"]:not([disabled])',[finish]);nodes.set('#main .completion-note',[completed]);nodes.set('#main [data-route="study"]',[back]);
 const input={root,proof,session:session(),route:'study/live-review',visible};
 assert.equal(reviewGuide(input).target,hide);
 hide.hidden=true;answer.hidden=false;assert.equal(reviewGuide(input).target,answer);
 answer.value='我的独立回答';assert.equal(reviewGuide(input).target,submit);
 input.session.status='awaiting_feedback';input.session.pendingJobId='grade-one';assert.equal(reviewGuide(input).target,waiting);
 input.session.status='feedback';input.session.pendingJobId=null;input.session.turns=[{feedback:{assessment:'correct'}}];assert.equal(reviewGuide(input).target,finish);
 input.session.status='completed';input.session.completion={reviewSettled:true};assert.equal(reviewGuide(input).target,completed);
 input.session.completion.reviewSettled=false;assert.equal(reviewGuide(input).target,back);assert.match(reviewGuide(input).instruction,/未计入到期复习/);
});

test('pool targeting stays on the selected knowledge and never highlights another session or a covered page',()=>{
 const start={},nodes=new Map([['#main [data-action="start-note"][data-id="chosen"]',[start]]]);
 const input={root:{querySelectorAll:selector=>nodes.get(selector)||[]},proof,session:session(),route:'study',visible:()=>true};
 assert.equal(reviewGuide(input).target,start);
 const resume={};nodes.set('#main [data-route="study/live-review"]',[resume]);assert.equal(reviewGuide(input).target,resume);
 input.session={...session(),status:'completed',completion:{reviewSettled:false}};assert.equal(reviewGuide(input).target,start,'an unsettled completed review needs a fresh attempt, not a resume loop');input.session=session();
 input.route='study/other';assert.equal(reviewGuide(input).target,null);
 input.route='study/live-review';input.session.noteId='other';assert.equal(reviewGuide(input).target,null);
 input.session=session();nodes.set('dialog[open]',[{}]);assert.equal(reviewGuide(input).target,null);
});

test('feedback replacing a hinted waiting target allows the next hint to frame the finish action',async()=>{
 const source=await readFile(new URL('../public/web/onboarding.mjs',import.meta.url),'utf8'),finish={};let frames=0;
 const motion={target:{},framed:true,scroll:async()=>{},track:async()=>{},move:async target=>{motion.target=target;motion.framed=false;},frame:async()=>{frames++;return true;},pulse(){}};
 const context=vm.createContext({target:()=>finish,motion,active:true,travelling:false,hinting:true,step:()=>({id:'review-finish',kind:'action'}),card:{contains:()=>false},settle:async()=>{},changed(){},render(){}});
 const show=source.slice(source.indexOf('async function showTarget()'),source.indexOf('async function openCard()'));
 const hint=source.slice(source.indexOf('async function hint()'),source.indexOf('function schedulePoll()'));
 vm.runInContext(show+hint+'\nthis.show=showTarget;this.hint=hint;',context);
 await context.show();await context.hint();assert.equal(frames,1);assert.equal(context.hinting,true);
});
