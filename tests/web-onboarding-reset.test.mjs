import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {welcomeBody} from '../public/web/onboarding-dialogs.mjs';

const source=await readFile(new URL('../public/web/onboarding.mjs',import.meta.url),'utf8');
const resetSource=source.slice(source.indexOf('async function reset(dialog)'),source.indexOf('function welcome()'));
function harness({accepted=true,leave=true,busy=false,pending=0,failure,materialId='reading'}={}){
 const events=[],proof={practiceId:'old-practice',materialId,customSample:{title:'我的材料',body:'保留这份自选正文。'},busy},fresh={practiceId:'new-practice',materialId,currentStepId:'setup-welcome'};
 const context=vm.createContext({proof,travelling:false,polling:null,pollTimer:1,sequence:4,active:false,index:27,sessionId:'stale-session',pendingGoal:'output',requestedRoute:'output',signature:'old',error:'stale',hinting:true,detail:true,speed:1,state:{note:{id:'old-note'},session:{id:'old-session'}},
  api:{getContext:()=>({pending}),setContext:id=>events.push(['context',id])},
  confirm:async(...args)=>{events.push(['confirm',...args]);return accepted;},beforeLeave:async()=>{events.push('leave');return leave;},
  call:async(action,body={})=>{events.push(['call',action,body]);if(failure)throw failure;return fresh;},adopt:value=>{context.proof=value;},
  motion:{hide:()=>events.push('hide')},refreshBoot:async()=>events.push('bootstrap'),go:async(route,options)=>events.push(['go',route,options]),navigate:async index=>events.push(['navigate',index]),
  clearTimeout:()=>events.push('stop-poll'),render:()=>events.push('render'),schedulePoll:()=>events.push('poll'),notify:(message)=>events.push(['notify',message]),
 });
 vm.runInContext(resetSource+'\nthis.reset=reset;',context);
 return {context,events,dialog:{close:()=>events.push('close')},fresh};
}

test('only users with a saved practice see reset on the welcome page, and busy practice is disabled',()=>{
 const options={mode:'A',materialId:'reading',index:27};
 assert.doesNotMatch(welcomeBody(options),/data-guide="reset"/);
 for(const index of [0,12,27])assert.match(welcomeBody({...options,index,practiceId:'saved'}),/重置进度/);
 assert.match(welcomeBody({...options,practiceId:'saved',busy:true}),/data-guide="reset"[^>]*disabled/);
});

test('cancelling reset or declining to leave unsaved input never writes or changes the practice',async()=>{
 for(const options of [{accepted:false},{leave:false}]){
  const h=harness(options);await h.context.reset(h.dialog);assert.equal(h.context.proof.practiceId,'old-practice');assert.equal(h.context.index,27);
  assert.equal(h.events.some(e=>Array.isArray(e)&&['call','context','go','navigate'].includes(e[0])),false);assert.equal(h.events.includes('close'),false);
 }
});

test('busy, pending and first-time states cannot invoke the destructive endpoint',async()=>{
 for(const options of [{busy:true},{pending:1}]){const h=harness(options);await h.context.reset(h.dialog);assert.equal(h.events.some(e=>e[0]==='confirm'||e[0]==='call'),false);}
 const h=harness();h.context.proof.practiceId=null;await h.context.reset(h.dialog);assert.deepEqual(h.events,[]);
});

test('successful reset switches to the returned practice and rebuilds today before starting step one',async()=>{
 const h=harness();await h.context.reset(h.dialog);
 const call=h.events.find(e=>e[0]==='call');assert.equal(call[1],'reset');assert.deepEqual(Object.keys(call[2]),[],'the server keeps the existing material');
 assert.equal(h.context.proof,h.fresh);assert.equal(h.context.sequence,5);assert.equal(h.context.active,true);assert.equal(h.context.index,0);assert.equal(h.context.sessionId,'');assert.equal(h.context.pendingGoal,null);assert.equal(h.context.requestedRoute,null);assert.equal(h.context.error,'');assert.equal(h.context.state.note,null);assert.equal(h.context.state.session,null);
 const labels=h.events.map(e=>Array.isArray(e)?e[0]:e);assert.ok(labels.indexOf('context')<labels.indexOf('bootstrap'));assert.ok(labels.indexOf('bootstrap')<labels.indexOf('go'));assert.ok(labels.indexOf('go')<labels.indexOf('navigate'));assert.equal(h.events.find(e=>e[0]==='go')[2].force,true);assert.equal(h.events.at(-1)[1],0);
 assert.equal(h.context.travelling,false);
});

test('custom reset lets the server retain its material, and an API error retains the old context and dialog',async()=>{
 const custom=harness({materialId:'custom'});await custom.context.reset(custom.dialog);assert.deepEqual(Object.keys(custom.events.find(e=>e[0]==='call')[2]),[]);
 const failure=Error('controlled failure'),failed=harness({failure});await assert.rejects(failed.context.reset(failed.dialog),error=>error===failure);assert.equal(failed.context.proof.practiceId,'old-practice');assert.equal(failed.context.travelling,false);assert.equal(failed.events.includes('close'),false);assert.equal(failed.events.some(e=>e[0]==='context'),false);assert.equal(failed.events.at(-1),'poll');
});
