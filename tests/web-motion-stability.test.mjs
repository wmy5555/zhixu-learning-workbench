import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as model from '../public/web/focus-model.mjs';
import {processOutcome,createProcessOutcomeRenderer} from '../public/web/process-outcome.mjs';

const settle=()=>new Promise(resolve=>setImmediate(resolve));
function events(extra={}){
  const listeners=new Map();
  return Object.assign(extra,{addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener(type,fn){listeners.get(type)?.delete(fn);},emit(type,event={}){for(const fn of listeners.get(type)||[])fn(event);}});
}
function focusHarness(){
  let now=1000,id=0,writes=0,clock=model.freshClock(),section;
  const frames=new Map(),intervals=new Map(),storage=new Map();
  const preference=events({matches:false}),window=events(),budget={};
  const slot={hidden:true,append(node){node.parentElement=this;node.isConnected=true;}};
  const document=events({hidden:false,querySelector(selector){return selector==='#focus-home'?slot:selector==='#budget-summary'?budget:null;},createElement(){
    const classes=new Set(),circle={style:new Proxy({},{set(target,key,value){writes++;target[key]=value;return true;}})},text={};
    section={isConnected:false,parentElement:null,style:{removeProperty(){}},classList:{toggle(key,on){on?classes.add(key):classes.delete(key);},add(key){classes.add(key);},remove(key){classes.delete(key);},contains:key=>classes.has(key)},
      setAttribute(){},remove(){this.isConnected=false;},getAnimations:()=>[],getBoundingClientRect:()=>({x:0,y:0,width:0,height:0}),
      querySelector(selector){if(selector==='.focus-progress')return this.innerHTML.includes('focus-progress')?circle:null;if(['[data-clock-time]','[data-clock-status]'].includes(selector))return text;return null;},
      querySelectorAll(selector){return selector==='.focus-progress'&&this.querySelector(selector)?[circle]:[];},innerHTML:''};
    return section;
  }});
  const source=fs.readFileSync(new URL('../public/web/focus.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export function createFocus','function createFocus');
  const context={...model,transition:(value,action)=>model.transition(value,action,now),Date:{now:()=>now},document,window,matchMedia:()=>preference,
    localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>{storage.set(key,value);clock=JSON.parse(value);}},navigator:{locks:{request:async(_key,fn)=>fn()}},
    requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:key=>frames.delete(key),setInterval:fn=>{intervals.set(++id,fn);return id;},clearInterval:key=>intervals.delete(key),
    e:String,btn:()=>'',link:()=>'',notify:()=>{},setTimeout,clearTimeout};
  const create=vm.runInNewContext(source+'\ncreateFocus;',context);
  const focus=create({state:{route:'today',boot:{settings:{vaultDir:'synthetic-motion'}}},go:()=>{}});
  const readKey=()=>[...storage.keys()][0]||'zhixu-focus-v1-synthetic-motion';
  return {focus,frames,intervals,document,preference,get writes(){return writes;},get clock(){return clock;},
    async mount(){focus.mount();await settle();},
    async load(value){clock=value;storage.set(readKey(),JSON.stringify(value));window.emit('storage',{key:readKey()});await settle();},
    start:()=>model.transition(model.freshClock(),{type:'start',kind:'focus',minutes:1,id:'synthetic-round'},now),
    async tick(ms=0){now+=ms;for(const fn of intervals.values())fn();await settle();},
    frame(){assert.equal(frames.size,1);const [key,fn]=frames.entries().next().value;frames.delete(key);now+=16;fn();},
    async act(action){await focus.handle({dataset:{action}});},
  };
}

test('focus frames run only for an active visible clock and resume as a single loop',async()=>{
  const h=focusHarness();await h.mount();assert.equal(h.frames.size,0);
  await h.load(h.start());assert.equal(h.frames.size,1);h.frame();assert.equal(h.frames.size,1);
  await h.mount();assert.equal(h.frames.size,1,'mount must not duplicate the loop');
  await h.act('focus-pause');assert.equal(h.frames.size,0);const paused=h.clock.active.elapsedMs;
  await h.tick(5000);assert.equal(h.frames.size,0);assert.equal(h.clock.active.elapsedMs,paused);
  await h.act('focus-resume');assert.equal(h.frames.size,1);h.frame();
  assert.ok(model.elapsed(h.clock.active,h.clock.active.startedAt+100)>paused);
  h.focus.close();assert.equal(h.frames.size,0);assert.equal(h.intervals.size,0);
});

test('visibility and reduced motion stop pending frames immediately and restart once',async()=>{
  const h=focusHarness();await h.mount();await h.load(h.start());
  h.document.hidden=true;h.document.emit('visibilitychange');assert.equal(h.frames.size,0);
  await h.tick(2000);assert.equal(h.frames.size,0);
  h.document.hidden=false;h.document.emit('visibilitychange');await settle();assert.equal(h.frames.size,1);
  h.preference.matches=true;h.preference.emit('change');assert.equal(h.frames.size,0);
  await h.tick(1000);assert.equal(h.frames.size,0,'one-second time readback must not restart reduced-motion frames');
  h.preference.matches=false;h.preference.emit('change');h.preference.emit('change');assert.equal(h.frames.size,1);
  h.focus.close();h.preference.emit('change');h.document.emit('visibilitychange');assert.equal(h.frames.size,0);
});

test('expiry, dismissed clocks and a view without a progress ring leave no loop',async()=>{
  const h=focusHarness();await h.mount();await h.load(h.start());
  await h.act('focus-recent');assert.equal(h.frames.size,0);
  await h.act('focus-clock');assert.equal(h.frames.size,1);
  await h.tick(61000);assert.equal(h.frames.size,0);assert.equal(h.clock.active.status,'finished');assert.equal(h.clock.records.length,1);
  await h.tick(1000);assert.equal(h.clock.records.length,1,'stopping animation must not duplicate settlement');
  await h.act('focus-dismiss');assert.equal(h.frames.size,0);assert.equal(h.clock.active,null);h.focus.close();
});

function outcomeHarness(){
  let replacements=0,statusWrites=0,status,button,error;
  const body={set innerHTML(value){replacements++;button={};error={textContent:''};status={set innerHTML(html){statusWrites++;this.html=html;},html:value.match(/data-process-status>([\s\S]*?)<\/div>/)[1]};},querySelector(selector){return selector==='[data-process-status]'?status:selector==='[data-process-error]'?error:button;}};
  const render=createProcessOutcomeRenderer(body);
  return {render,get replacements(){return replacements;},get statusWrites(){return statusWrites;},get button(){return button;},get status(){return status.html;},get error(){return error;}};
}
const outcome=(state,extra={},options={})=>processOutcome({state,...extra},{sourceId:'synthetic',research:true,...options});

test('progress-only and identical updates preserve controls and clear recovered read errors',()=>{
  const h=outcomeHarness();const options={research:true};
  assert.equal(h.render(outcome('running',{research:true,researchProgress:{covered:1,total:4}},options)),true);
  const button=h.button;h.error.textContent='合成读取失败';
  assert.equal(h.render(outcome('running',{research:true,researchProgress:{covered:2,total:4}},options)),false);
  assert.equal(h.button,button);assert.equal(h.replacements,1);assert.equal(h.statusWrites,1);assert.match(h.status,/2 \/ 4/);assert.equal(h.error.textContent,'');
  h.render(outcome('running',{research:true,researchProgress:{covered:2,total:4}},options));assert.equal(h.statusWrites,1);
  h.render(outcome('done',{research:true},options));assert.equal(h.button,button);assert.match(h.status,/核验结果已保存/);assert.doesNotMatch(h.status,/status-pulse/);
});

test('retry and follow-on research controls are replaced when their meaning changes',()=>{
  const h=outcomeHarness();h.render(outcome('running',{research:false}));const button=h.button;
  assert.equal(h.render(outcome('done',{research:false})),true);assert.notEqual(h.button,button);
  const doneButton=h.button;assert.equal(h.render(outcome('failed',{error:'<img onerror=bad()>',extractionSaved:true})),true);
  assert.notEqual(h.button,doneButton);assert.doesNotMatch(h.status,/<img/);
  const retryButton=h.button;h.render(outcome('failed',{error:'新的合成错误',extractionSaved:true}));assert.equal(h.button,retryButton);assert.match(h.status,/新的合成错误/);
  assert.equal(h.render(outcome('running',{research:true})),true);
});
