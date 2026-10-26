import test from 'node:test';
import assert from 'node:assert/strict';
import {planFlowTail,contentTags} from '../public/web/discovery-flow.mjs';
import {bindImmersiveDeck} from '../public/web/discovery-motion.mjs';
import {createRecommender} from '../public/web/discovery-recommendation.mjs';

test('flow reaches unseen cards beyond the first batch, then continues a new round',()=>{
 const cards=Array.from({length:45},(_,i)=>({id:String(i),noteId:String(i),type:'reading'}));
 const rank=({excludeIds=[]}={})=>cards.filter(c=>!excludeIds.includes(c.id)).slice(0,12);
 const history=cards.slice(0,30);
 const next=planFlowTail({history,seenIds:history.map(c=>c.id),rank});assert.equal(next[0].id,'30');
 const again=planFlowTail({history:cards,seenIds:cards.map(c=>c.id),rank});assert.ok(again.length);assert.notEqual(again[0].id,'44');
 assert.deepEqual(planFlowTail({history:[],seenIds:[],rank:()=>[]}),[]);
});

test('continuation never manufactures a card when the ranker blocks all material',()=>{
 const current={id:'flash',noteId:'a',type:'flash'};
 assert.deepEqual(planFlowTail({history:[current],seenIds:['flash'],rank:()=>[]}),[]);
 const only={id:'one',type:'reading'};assert.deepEqual(planFlowTail({history:[only],seenIds:['one'],rank:({excludeIds=[]})=>excludeIds.includes('one')?[]:[only]}),[only]);
});

test('continuous rounds preserve the real recommender material gap before a flashcard',()=>{
 const make=(id,noteId,type='reading')=>({id,noteId,type,sourceHash:'v',basisHash:noteId,topic:'test',prerequisites:[]});
 const reading=make('a','A'),flash=make('flash','A','flash'),b=make('b','B'),c=make('c','C');const cards=[reading,flash,b,c];
 const rec=createRecommender({random:()=>.5});const rank=extra=>rec.rank(cards,extra);
 rec.observe(reading,{type:'exposure',elapsedMs:800});assert.ok(!planFlowTail({history:[reading],seenIds:['a'],rank}).some(card=>card.id==='flash'));
 rec.observe(b,{type:'exposure',elapsedMs:800});rec.observe(c,{type:'exposure',elapsedMs:800});
 assert.ok(planFlowTail({history:[reading,b,c],seenIds:['a','b','c'],rank}).some(card=>card.id==='flash'));
});

test('content tags come from the current text and supplied metadata, with no HTML or repeated topic',()=>{
 const tags=contentTags({title:'304：不用重传正文',body:'HTTP 304 表示 Not Modified。HTTP 缓存可以复用正文。',topic:'网络常识'},['缓存','<img src=x>','缓存']);
 assert.ok(tags.includes('缓存'));assert.ok(tags.some(t=>/304|HTTP/.test(t)));assert.ok(tags.length<=3);assert.equal(new Set(tags).size,tags.length);assert.ok(!tags.some(t=>/[<>]/.test(t)));
 assert.notDeepEqual(contentTags({title:'主动回忆与间隔复习',body:'主动回忆让学习者发现遗漏。',topic:'学习方法'}),tags);
});

test('deck prepares the visible next card before animation and ignores the initial resize notification',async()=>{
 const original=globalThis.ResizeObserver;let resize,finish,cancelled=0,next='old',shown,moved;
 globalThis.ResizeObserver=class{constructor(fn){resize=fn;}observe(){}disconnect(){}};
 const listeners=new Map(),screen={classList:{remove(){}}},surface={clientHeight:500,clientWidth:600,closest:()=>screen,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 const deck={style:{},animate(){shown=next;return {finished:new Promise(r=>{finish=r;}),cancel(){cancelled++;}};}};
 const indicator={classList:{toggle(){}},querySelector:()=>({textContent:''})};let controller;
 try{
  controller=bindImmersiveDeck({surface,deck,indicator,first:()=>false,canMove:()=>true,prepare:()=>{next='prepared';},move:()=>{moved=next;},refresh(){},like(){},detail(){},reduced:()=>false});
  controller.step(1);assert.equal(shown,'prepared');resize();assert.equal(cancelled,0);finish();await new Promise(setImmediate);
  assert.equal(moved,shown);assert.equal(cancelled,1);controller.dispose();assert.equal(listeners.size,0);
 }finally{if(original===undefined)delete globalThis.ResizeObserver;else globalThis.ResizeObserver=original;}
});

test('a real resize cancels an in-flight transition and resumes the current card',async()=>{
 const original=globalThis.ResizeObserver;let resize,reject,moved=0,resumed=0;
 globalThis.ResizeObserver=class{constructor(fn){resize=fn;}observe(){}disconnect(){}};
 const surface={clientHeight:500,clientWidth:600,closest:()=>({classList:{remove(){}}}),addEventListener(){},removeEventListener(){}};
 const deck={style:{},animate(){return {finished:new Promise((_,r)=>{reject=r;}),cancel(){reject(Error('cancel'));}};}};
 const indicator={classList:{toggle(){}},querySelector:()=>({textContent:''})};let controller;
 try{
  controller=bindImmersiveDeck({surface,deck,indicator,first:()=>false,canMove:()=>true,move:()=>moved++,resume:()=>resumed++,refresh(){},like(){},detail(){},reduced:()=>false});
  controller.step(1);surface.clientWidth=700;resize();await new Promise(setImmediate);assert.equal(moved,0);assert.equal(resumed,1);controller.dispose();
 }finally{if(original===undefined)delete globalThis.ResizeObserver;else globalThis.ResizeObserver=original;}
});
