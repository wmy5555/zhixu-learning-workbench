import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {isStudyRelearn,currentStudyId,resolveRelearnSession,relearnProof,relearnStudyGuide} from '../public/web/onboarding-relearn.mjs';
import {guideSteps,complete,prerequisite,destination,selectors,speeds,intersection} from '../public/web/onboarding-model.mjs';
import {reviewGuide} from '../public/web/onboarding-review.mjs';
import {outputGuide} from '../public/web/onboarding-output.mjs';
import {learningTarget} from '../public/web/onboarding-targets.mjs';

const source=await readFile(new URL('../public/web/onboarding.mjs',import.meta.url),'utf8');
const proof=()=>({practiceId:'synthetic-practice',status:'active',modelReady:true,learningStarted:true,materialId:'course',roles:{explain:'selected',draft:'saved-draft',currentSession:'saved-session',capturedSource:'saved-source'},progress:{'output-draft':{status:'done'}}});
const session=()=>({id:'visible-session',noteId:'selected',status:'reading',turns:[]});

test('relearning output presents the form again without clearing server completion or mutating proof',()=>{
 const original=proof(),copy=relearnProof(original,'output-draft',true);assert.equal(copy.progress['output-draft'].status,'pending');assert.equal(original.progress['output-draft'].status,'done');assert.equal(copy.roles,original.roles);
 for(const enabled of [false,true])assert.equal(relearnProof(original,'output-edit',enabled),original);
 assert.equal(relearnProof(original,'output-draft',false),original);
});

test('relearning keeps the actual visible study session and uses a direct saved ID when needed',async()=>{
 const p=proof(),current=session(),state={route:'study/visible-session',session:current},reads=[];assert.equal(currentStudyId(state,p),current.id);
 assert.equal(await resolveRelearnSession({state,proof:p,read:async id=>reads.push(id)}),current);assert.deepEqual(reads,[]);
 state.route='today';const saved={...current,id:'saved-session'};assert.equal(await resolveRelearnSession({state,proof:p,read:async id=>{reads.push(id);return saved;}}),saved);assert.deepEqual(reads,['saved-session']);
 assert.equal(await resolveRelearnSession({state,proof:p,read:async()=>({...saved,noteId:'other'})}),null);
 assert.equal(await resolveRelearnSession({state,proof:p,read:async()=>({...saved,id:'unexpected-session'})}),null);
 assert.equal(await resolveRelearnSession({state,proof:p,read:async()=>{throw Object.assign(Error('gone'),{code:'NOT_FOUND'});}}),null);
 await assert.rejects(resolveRelearnSession({state,proof:p,read:async()=>{throw Error('network');}}),/network/);
 for(const patch of [{noteId:'other'},{presetCase:'hints'}])assert.equal(currentStudyId({route:'study/visible-session',session:{...current,...patch}},p),'');
});

test('all four study steps have safe targets for waiting and completed attempts, with a manual new-attempt route',()=>{
 const nodes=new Map(),root={querySelectorAll:s=>nodes.get(s)||[]},p=proof(),current=session(),state={route:'study/visible-session',session:current},visible=n=>!n.hidden;
 const waiting={},answer={},feedback={},completion={},hide={},input={},start={};
 for(const [s,n]of [['#main .waiting-note',waiting],['#main .learning-turn .answer-prose',answer],['#main .learning-feedback',feedback],['#main .completion-note',completion],['#main [data-action="hide-material"]',hide],['#answer-form textarea',input],['#main [data-action="start-note"][data-id="selected"]',start]])nodes.set(s,[n]);
 for(const id of ['study-hide','study-answer','study-feedback','study-finish']){
  const options={root,state,proof:p,step:{id},visible};current.status='awaiting_feedback';assert.equal(relearnStudyGuide(options).target,waiting);
  current.status='completed';const shown=relearnStudyGuide(options);assert.equal(shown.target,id==='study-answer'?answer:id==='study-feedback'?feedback:completion);assert.match(shown.instruction,/手动开始新一轮/);
  current.status='reading';assert.equal(relearnStudyGuide(options).target,hide);nodes.set('dialog[open]',[{}]);assert.equal(relearnStudyGuide(options).target,null);nodes.delete('dialog[open]');
  state.route='study';assert.equal(relearnStudyGuide(options).target,start);state.route='study/visible-session';
 }
 hide.hidden=true;const closed=relearnStudyGuide({root,state,proof:p,step:{id:'study-hide'},visible});assert.equal(closed.target,input);assert.match(closed.instruction,/记录本轮使用过辅助/);assert.equal(hide.hidden,true,'replay must not reopen material without recording aid use');assert.equal(relearnStudyGuide({root,state,proof:p,step:{id:'study-feedback'},visible}).target,input);assert.equal(relearnStudyGuide({root,state,proof:p,step:{id:'setup-test'},visible}),null);
});

function navigationHarness({route='study/visible-session',noteId='selected',leave=true,busy=false,pending=0}={}){
 const p=proof(),steps=guideSteps('course'),index=steps.findIndex(s=>s.id==='study-answer'),events=[],answer={value:'尚未提交的合成回答'};
 const context=vm.createContext({active:true,travelling:false,proof:p,steps,index,relearnStep:'',mode:'A',detail:true,speed:1,sequence:0,sessionId:'stale-session',requestedRoute:null,polling:null,error:'',hinting:false,state:{route,session:{...session(),noteId},dirty:true,answer},
  isStudyRelearn,currentStudyId,resolveRelearnSession,prerequisite,destination,
  step:()=>steps[context.index],beforeLeave:async()=>{events.push('before-leave');return leave;},api:{getContext:()=>({practiceId:p.practiceId,pending}),get:async path=>{events.push(['read',path]);return session();}},
  call:async(action,body)=>{events.push([action,body]);return p;},adopt:value=>{context.proof=value;},all:()=>[],visible:()=>true,card:{},motion:{panel:async()=>{},retract:async()=>{},move:async()=>{},pulse(){}},render(){},refreshBoot:async()=>events.push('bootstrap'),go:async route=>{events.push(['go',route]);return true;},settle:async()=>{},showTarget:async()=>events.push('target'),openCard:async()=>events.push('card'),placeCard(){},live:{},publicEvent(){},notify:message=>events.push(['notify',message])
 });
 vm.runInContext(source.slice(source.indexOf('async function navigate('),source.indexOf('async function begin('))+'\nthis.navigate=navigate;this.relearn=relearn;',context);
 return {context,events,answer,index};
}

test('relearning the visible study step preserves unsaved input, session, route and completion evidence',async()=>{
 const h=navigationHarness();assert.equal(await h.context.relearn(),true);assert.equal(h.context.index,h.index);assert.equal(h.context.sessionId,'visible-session');assert.equal(h.context.relearnStep,'study-answer');assert.equal(h.context.state.answer,h.answer);assert.equal(h.answer.value,'尚未提交的合成回答');assert.equal(h.context.state.dirty,true);
 assert.deepEqual(h.events.filter(Array.isArray).map(e=>e[0]),['checkpoint']);assert.equal(h.events.find(e=>e[0]==='checkpoint')[1].mode,'check','replay never acknowledges reading or fabricates new learning evidence');assert.equal(h.events.includes('before-leave'),false);assert.equal(h.events.at(-1),'card');
});

test('wrong-session navigation honours cancellation; busy or pending requests never replay actions',async()=>{
 const cancelled=navigationHarness({noteId:'other',leave:false});assert.equal(await cancelled.context.relearn(),false);assert.deepEqual(cancelled.events,['before-leave']);assert.equal(cancelled.context.relearnStep,'');assert.equal(cancelled.context.travelling,false);
 for(const options of [{busy:true},{pending:1}]){const h=navigationHarness(options);h.context.proof.busy=options.busy;assert.equal(await h.context.relearn(),false);assert.equal(h.events.some(e=>e[0]==='checkpoint'||e[0]==='read'),false);}
 const blocked=navigationHarness();blocked.context.proof.modelReady=false;assert.equal(await blocked.context.relearn(),false);assert.equal(blocked.events.some(e=>e[0]==='checkpoint'),false);assert.match(blocked.context.error,/AI/);
 const ordinary=navigationHarness();await ordinary.context.navigate(ordinary.index);assert.equal(ordinary.context.relearnStep,'','ordinary navigation exits replay');
});

test('every core step exposes one replay control in both modes, and busy practice disables it',async()=>{
 for(const mode of ['A','C'])for(const step of guideSteps('course')){
  let card;const element=()=>({hidden:false,style:{},dataset:{},setAttribute(){},prepend(){},append(){},contains(){return false;},querySelector(){return null;},querySelectorAll(){return [];}});
  const body={dataset:{},classList:{toggle(){}},append(){}};
  const document={body,createElement(){const n=element();if(!card)card=n;return n;},querySelector:s=>s==='.workspace'?element():null,querySelectorAll:()=>[],addEventListener(){}};
  const p={...proof(),currentStepId:step.id,busy:step.id==='setup-welcome'},motion={leaf:element(),hide(){},moving:false,panelMoving:false};
  const context=vm.createContext({document,localStorage:{getItem:()=>mode},window:{addEventListener(){}},MutationObserver:class{observe(){}},guideSteps,complete,prerequisite,destination,selectors,speeds,intersection,reviewGuide,outputGuide,learningTarget,isStudyRelearn,currentStudyId,resolveRelearnSession,relearnProof,relearnStudyGuide,createGuideMotion:()=>motion,icon:()=>'',e:v=>String(v??''),innerWidth:1200,innerHeight:900});
  vm.runInContext(source.replace(/^import .*;\s*$/gm,'').replace('export function createWebOnboarding','function createWebOnboarding')+'\nthis.make=createWebOnboarding;',context);
  const guide=context.make({api:{get:async()=>p,getContext:()=>({practiceId:p.practiceId}),setContext(){}},state:{route:'today'}});await guide.initialize();assert.equal((card.innerHTML.match(/data-guide="relearn"/g)||[]).length,1,mode+':'+step.id);if(p.busy)assert.match(card.innerHTML,/data-guide="relearn"[^>]*disabled/);
 }
});
