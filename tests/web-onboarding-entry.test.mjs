import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {guideSteps,complete,prerequisite,destination,selectors,speeds,intersection} from '../public/web/onboarding-model.mjs';
const source=readFileSync(new URL('../public/web/onboarding.mjs',import.meta.url),'utf8');
function fixture(proof={},storage=new Map()){
 const nodes=[],dialogs=[],notices=[],writes=[];
 const node=()=>({hidden:false,style:{},dataset:{},classList:{add(){},toggle(){}},setAttribute(){},prepend(){},append(){},contains(){return false;},querySelector(){return null;},querySelectorAll(){return [];}});
 const body={...node(),append(){}};
 const document={body,createElement(){const n=node();nodes.push(n);return n;},addEventListener(){},querySelector:s=>s==='.workspace'?node():s==='dialog.guide-welcome-dialog[open]'?dialogs.find(d=>d.open)||null:null,querySelectorAll:()=>[]};
 const context=vm.createContext({document,window:{addEventListener(){}},MutationObserver:class{observe(){}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},guideSteps,complete,prerequisite,destination,selectors,speeds,intersection,createGuideMotion:()=>({leaf:node(),hide(){}}),icon:()=>'',e:v=>String(v??''),notify:m=>notices.push(m),welcomeBody:()=>'',modal:(title,body,{onClose}={})=>{const d={...node(),open:true,close(){this.open=false;onClose?.();}};dialogs.push(d);return d;}});
 vm.runInContext(source.replace(/^import .*;\s*$/gm,'').replace('export function createWebOnboarding','function createWebOnboarding')+'\nthis.make=createWebOnboarding;',context);
 const guide=context.make({api:{get:async()=>proof,post:async(p,v)=>{writes.push({p,v});return proof;},getContext:()=>({practiceId:''}),setContext(){}},state:{route:'today'},beforeLeave:async()=>true,refreshBoot:async()=>{},go:async()=>true});
 return {guide,nodes,dialogs,notices,writes,storage};
}
test('first visit opens once; closing points to settings; reload and explicit reopen preserve dismissal',async()=>{
 const f=fixture();await f.guide.initialize();await f.guide.ready();assert.equal(f.dialogs.length,1);assert.equal(f.writes.length,0);
 f.guide.welcome();assert.equal(f.dialogs.length,1,'do not stack welcome dialogs');
 f.dialogs[0].close();assert.deepEqual(f.notices,['可在系统设置中重新打开新手引导。']);
 await f.guide.ready();assert.equal(f.dialogs.length,1);
 const reload=fixture({},f.storage);await reload.guide.initialize();await reload.guide.ready();assert.equal(reload.dialogs.length,0);
 reload.guide.welcome();assert.equal(reload.dialogs.length,1);reload.dialogs[0].guideTransition=true;reload.dialogs[0].close();assert.equal(reload.notices.length,0,'internal transitions do not announce a dismissal');
});
test('existing paused progress survives entry migration and retains resume without a welcome popup',async()=>{
 const proof={practiceId:'synthetic',status:'paused',currentStepId:'capture-save',progress:{'setup-welcome':{status:'done'}}},before=JSON.stringify(proof),f=fixture(proof);
 await f.guide.initialize();await f.guide.ready();assert.equal(f.dialogs.length,0);assert.equal(f.nodes[2].hidden,false);assert.equal(f.writes.length,0);assert.equal(JSON.stringify(proof),before);
});
test('completed guides stay accessible in settings without the unfinished resume button',async()=>{
 const progress=Object.fromEntries(guideSteps().map(s=>[s.id,{status:'done'}]));const f=fixture({practiceId:'synthetic',status:'paused',progress});
 await f.guide.initialize();await f.guide.ready();assert.equal(f.nodes[2].hidden,true);f.guide.welcome();assert.equal(f.dialogs.length,1);
});
test('pausing returns to the formal library before announcing the settings recovery path',async()=>{
 const start=source.indexOf('async function leave('),end=source.indexOf(' function routeMap(',start),calls=[];
 const context=vm.createContext({beforeLeave:async()=>true,polling:null,proof:{busy:false},call:async a=>{calls.push(a);return {};},adopt(){},api:{setContext:v=>calls.push('scope:'+v)},active:true,sequence:1,travelling:false,motion:{hide(){}},detail:true,state:{note:{},session:{}},refreshBoot:async()=>{},render(){},go:async()=>calls.push('today'),clearTimeout(){},pollTimer:1,returnHint:'可在系统设置中重新打开新手引导。',notify:v=>calls.push(v)});
 vm.runInContext(source.slice(start,end)+'\nthis.leave=leave;',context);await context.leave();assert.deepEqual(calls,['pause','scope:','today','可在系统设置中重新打开新手引导。']);assert.equal(context.active,false);
});
