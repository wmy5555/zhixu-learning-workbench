import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../public/web/onboarding.mjs',import.meta.url),'utf8');
const nextSource=source.slice(source.indexOf('async function next()'),source.indexOf('async function leave()'));
function harness({visible=true,status='pending',kind='action',travelling=false,failure}={}){
 const events=[],step={id:'capture-save',kind};
 const context=vm.createContext({
  travelling,index:0,steps:[step,{id:'capture-source'}],error:'',proof:{progress:{}},
  step:()=>step,target:()=>visible?{}:null,
  call:async(action,body)=>{events.push({action,body});if(failure)throw failure;return {progress:{[step.id]:{status,reason:'请先保存资料。'}}};},
  adopt:value=>{context.proof=value;},done:()=>['done','demonstrated'].includes(context.proof.progress[step.id]?.status),
  render:()=>events.push('render'),hint:async()=>events.push('hint'),navigate:async index=>events.push({navigate:index}),
  leave:async()=>events.push('leave'),notify:()=>events.push('notify'),
 });
 vm.runInContext(nextSource+'\nthis.next=next;',context);
 return {context,events};
}

test('an incomplete next check invokes the existing hint once per click and stays on the step',async()=>{
 const {context,events}=harness();
 await context.next();
 assert.equal(events.filter(event=>event==='hint').length,1);
 assert.equal(events.at(-2),'render');assert.equal(events.at(-1),'hint');
 assert.equal(context.error,'请先保存资料。');
 assert.equal(events.some(event=>event?.navigate!==undefined),false);
 await context.next();assert.equal(events.filter(event=>event==='hint').length,2);
});

test('a target lost before next uses the existing hint recovery once without fabricating a check',async()=>{
 const {context,events}=harness({visible:false});await context.next();
 assert.deepEqual(events,['render','hint']);assert.match(context.error,/暂时不可见/);
});

test('a completed check advances normally without an automatic hint',async()=>{
 const {context,events}=harness({status:'done'});await context.next();
 assert.equal(events.filter(event=>event==='hint').length,0);assert.equal(events.at(-1).navigate,1);
});

test('reading acknowledgements continue without an automatic hint',async()=>{
 const {context,events}=harness({kind:'read',status:'demonstrated'});await context.next();
 assert.equal(events[0].body.mode,'read');assert.equal(events.at(-1).navigate,1);assert.equal(events.includes('hint'),false);
});

test('travel and failed checks do not trigger an automatic hint',async()=>{
 const travelling=harness({travelling:true});await travelling.context.next();assert.deepEqual(travelling.events,[]);
 const failure=Error('controlled network failure'),failed=harness({failure});
 await assert.rejects(failed.context.next(),error=>error===failure);assert.equal(failed.events.includes('hint'),false);
});
