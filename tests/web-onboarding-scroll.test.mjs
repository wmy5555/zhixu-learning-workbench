import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {guideSteps,complete,prerequisite,destination,selectors,speeds,intersection} from '../public/web/onboarding-model.mjs';

test('step 21 keeps its action, focus and content stable during repeated scroll updates',async()=>{
 const source=await readFile(new URL('../public/web/onboarding.mjs',import.meta.url),'utf8');
 const events={},frames=[];let card,clock,renders=0,hides=0;
 const marker={hidden:true};
 const body={dataset:{},classList:{toggle(){}},append(){}};
 const node=()=>({hidden:false,style:{},dataset:{},setAttribute(){},prepend(){},append(){},contains(n){return this===card&&n===clock;},querySelector(){return null;},querySelectorAll(){return [];},getBoundingClientRect(){return {top:80};},
  set innerHTML(value){if(this===card){renders++;clock={isConnected:true,getClientRects:()=>[{}],parentElement:this,focus(){document.activeElement=this;}};}},
 });
 const document={body,activeElement:null,createElement(){const n=node();if(!card)card=n;return n;},addEventListener(){},querySelector(s){if(s==='.workspace')return node();return null;},querySelectorAll(s){return s==='[data-guide="clock"]'?[clock]:[];}};
 const proof={practiceId:'synthetic-practice',status:'active',currentStepId:'review-clock-due',modelReady:true,roles:{explain:'synthetic-knowledge'},progress:{}};
 const motion={leaf:node(),layer:{firstElementChild:marker,parentElement:body},hide(){hides++;marker.hidden=true;},moving:false,panelMoving:false};
 const context=vm.createContext({document,window:{addEventListener(name,fn){events[name]=fn;}},MutationObserver:class{observe(){}},localStorage:{getItem:key=>key==='zhixu.guide.mode'?'C':null},innerWidth:1200,innerHeight:900,getComputedStyle:()=>({visibility:'visible',display:'block'}),requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},setTimeout,clearTimeout,guideSteps,complete,prerequisite,destination,selectors,speeds,intersection,createGuideMotion:()=>motion,icon:()=>'',e:value=>String(value??'')});
 vm.runInContext(source.replace(/^import .*;\s*$/gm,'').replace('export function createWebOnboarding','function createWebOnboarding')+'\nthis.make=createWebOnboarding;',context);
 const guide=context.make({api:{get:async()=>proof,getContext:()=>({practiceId:proof.practiceId}),setContext(){}},state:{route:'today'}});
 await guide.initialize();clock.focus();const original=clock,count=renders;
 for(let i=0;i<20;i++){events.scroll();events.scroll();assert.equal(frames.length,1,'scroll events coalesce into one frame');await frames.shift()();}
 assert.equal(renders,count,'scrolling must not recreate the card');
 assert.equal(clock,original,'the action stays connected');
 assert.equal(document.activeElement,original,'keyboard focus stays on the action');
 assert.equal(hides,0,'an already hidden marker needs no repeated cancellation');
});
