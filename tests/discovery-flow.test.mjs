import test from 'node:test';
import assert from 'node:assert/strict';
import {planFlowTail,contentTags} from '../public/web/discovery-flow.mjs';
import {bindImmersiveDeck} from '../public/web/discovery-motion.mjs';
import {createRecommender} from '../public/web/discovery-recommendation.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function historyHarness(cards){
 const source=readFileSync(new URL('../public/web/discovery.mjs',import.meta.url),'utf8');
 const between=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
 return vm.runInNewContext(`
  let queue=cards.slice(0,12),cursor=0,visitedThrough=0,prepared=null,pendingElapsed=null,ended=false,exposure=null,root=null,gridCards=[],gridReady=false,detail=null;const storyStates=new Map();
  const seen=new Set([cards[0].id]),key=c=>c.id,current=()=>queue[cursor];let reversed=false;
  const ranked=(onlyReading,extra={})=>{const pool=reversed?[...cards].reverse():cards;return pool.filter(c=>!(extra.excludeIds||[]).includes(c.id)).slice(0,extra.limit||12);};
  const rec={observe(){}},getProgress=()=>({submitted:false,grade:null}),endExposure=()=>1500;
  const mountContent=()=>seen.add(current().id),reconcileCards=()=>{},refresh=()=>{};
  ${between('function future()','function resumeCard()')}
  ${between('function newBatch()','function cleanView()')}
  ${between('function move(delta)','function showFlow(')}
  ({step:move,refresh:newBatch,rerank(){reversed=true;future();},get ids(){return queue.map(c=>c.id);},get cursor(){return cursor;},get id(){return current().id;}});
 `,{cards,planFlowTail});
}

test('visited feed order survives backward navigation, changed recommendations and a long history',()=>{
 const h=historyHarness(Array.from({length:125},(_,i)=>({id:String(i),type:'reading'}))),visited=[h.id];
 for(let i=0;i<110;i++){h.step(1);visited.push(h.id);}
 assert.equal(h.cursor,110);
 for(let i=0;i<110;i++){h.step(-1);assert.equal(h.id,visited[109-i]);}
 h.rerank();assert.deepEqual(Array.from(h.ids).slice(0,visited.length),visited);
 for(let i=1;i<visited.length;i++){h.step(1);assert.equal(h.id,visited[i]);if(i===55)h.rerank();}
 h.step(1);assert.equal(h.id,'124','only the unseen continuation follows the updated ranker');
});

test('an explicit feed refresh starts a fresh recommendation sequence',()=>{
 const h=historyHarness(Array.from({length:30},(_,i)=>({id:String(i),type:'reading'})));
 for(let i=0;i<15;i++)h.step(1);
 h.step(-1);h.rerank();assert.equal(h.id,'14');h.refresh();assert.equal(h.cursor,0);assert.equal(h.id,'29');
 h.step(1);assert.equal(h.id,'28');
});

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
 const original=globalThis.ResizeObserver;let resize,finish,cancelled=0,next='old',shown,moved,frames;
 globalThis.ResizeObserver=class{constructor(fn){resize=fn;}observe(){}disconnect(){}};
 const listeners=new Map(),screen={classList:{remove(){}}},surface={clientHeight:500,clientWidth:600,closest:()=>screen,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 const deck={style:{},animate(value){frames=value;shown=next;return {finished:new Promise(r=>{finish=r;}),cancel(){cancelled++;}};}};
 const indicator={classList:{toggle(){}},querySelector:()=>({textContent:''})};let controller;
 try{
  controller=bindImmersiveDeck({surface,deck,indicator,first:()=>false,canMove:()=>true,prepare:()=>{next='prepared';},move:()=>{moved=next;},refresh(){},like(){},detail(){},reduced:()=>false});
  controller.step(1);assert.equal(shown,'prepared');resize();assert.equal(cancelled,0);finish();await new Promise(setImmediate);
  assert.equal(moved,shown);assert.equal(cancelled,1);controller.reset();controller.step(1);assert.equal(frames[0].transform,'translate3d(0px,0px,0)');finish();await new Promise(setImmediate);assert.equal(cancelled,2);controller.dispose();assert.equal(listeners.size,0);
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

test('fullscreen wheel scope shares one gesture gate across the page and releases its listener',t=>{
 const original=globalThis.ResizeObserver;globalThis.ResizeObserver=class{observe(){}disconnect(){}};
 let now=1000,fullscreen=false,panel=false,moved=0,prevented=0;
 t.mock.method(performance,'now',()=>now);
 const listeners=new Map(),surfaceListeners=new Map(),inside={closest:()=>null},outside={closest:()=>null};
 const wheelTarget={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 const surface={clientHeight:500,clientWidth:600,contains:target=>target===inside,closest:()=>({classList:{remove(){}}}),addEventListener:(name,fn)=>surfaceListeners.set(name,fn),removeEventListener:name=>surfaceListeners.delete(name)};
 const indicator={classList:{toggle(){}},querySelector:()=>({textContent:''})};let controller;
 const wheel=(target,extra={})=>listeners.get('wheel')({target,deltaY:60,deltaX:0,deltaMode:0,preventDefault(){prevented++;},...extra});
 try{
  controller=bindImmersiveDeck({surface,wheelTarget,wheelEnabled:event=>!panel&&(fullscreen||surface.contains(event.target)),deck:{style:{}},indicator,first:()=>false,canMove:()=>true,move:()=>{moved++;controller.reset();},refresh(){},like(){},reduced:()=>true});
  assert.equal(surfaceListeners.has('wheel'),false);
  wheel(outside);assert.equal(moved,0);assert.equal(prevented,0);
  fullscreen=true;wheel(outside);assert.equal(moved,1);
  now+=20;wheel(inside);assert.equal(moved,1,'moving between page regions must not consume the same gesture twice');
  now+=200;wheel(inside);assert.equal(moved,2);
  panel=true;now+=200;const before=prevented;wheel(outside);assert.equal(moved,2);assert.equal(prevented,before,'an open panel retains native scrolling');
  panel=false;fullscreen=false;now+=200;wheel(outside);assert.equal(moved,2);assert.equal(prevented,before);
  wheel(inside,{ctrlKey:true});wheel(inside,{deltaX:90});assert.equal(moved,2);assert.equal(prevented,before);
  wheel(inside);assert.equal(moved,3,'normal mode still scrolls cards within the original viewport');
  controller.dispose();assert.equal(listeners.size,0);assert.equal(surfaceListeners.size,0);
 }finally{controller?.dispose();if(original===undefined)delete globalThis.ResizeObserver;else globalThis.ResizeObserver=original;}
});

test('page-wide wheel handling leaves long card content scrollable before switching cards',t=>{
 const original=globalThis.ResizeObserver;globalThis.ResizeObserver=class{observe(){}disconnect(){}};
 let now=2000,moved=0,prevented=0;t.mock.method(performance,'now',()=>now);
 const scroller={scrollTop:0,clientHeight:200,scrollHeight:700},listeners=new Map();
 const surface={clientHeight:500,clientWidth:600,closest:()=>({classList:{remove(){}}}),addEventListener(){},removeEventListener(){}};
 const wheelTarget={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 const indicator={classList:{toggle(){}},querySelector:()=>({textContent:''})};let controller;
 const wheel=()=>listeners.get('wheel')({target:{closest:()=>scroller},deltaY:60,deltaX:0,deltaMode:0,preventDefault(){prevented++;}});
 try{
  controller=bindImmersiveDeck({surface,wheelTarget,deck:{style:{}},indicator,first:()=>false,canMove:()=>true,move:()=>{moved++;controller.reset();},refresh(){},like(){},reduced:()=>true});
  wheel();assert.equal(prevented,0);assert.equal(moved,0);
  scroller.scrollTop=500;now+=20;wheel();assert.equal(moved,0,'reaching the edge does not spill the current gesture into the feed');
  now+=200;wheel();assert.equal(moved,1);
 }finally{controller?.dispose();if(original===undefined)delete globalThis.ResizeObserver;else globalThis.ResizeObserver=original;}
});

test('the whole feed frame accepts drag and wheel while horizontal motion stays on the story ribbon',t=>{
 const original=globalThis.ResizeObserver;globalThis.ResizeObserver=class{observe(){}disconnect(){}};
 let now=4000,started=0,dragged=0,finished=null,vertical=0,sideways=0,captured=false,stopped=false,pointerAllowed=true;t.mock.method(performance,'now',()=>now);
 const pointer=new Map(),wheel=new Map(),surfaceEvents=new Map(),target={closest:()=>null};
 const frame={addEventListener:(name,fn)=>pointer.set(name,fn),removeEventListener:name=>pointer.delete(name),setPointerCapture(){captured=true;},hasPointerCapture:()=>captured,releasePointerCapture(){captured=false;}};
 const surface={clientHeight:500,clientWidth:500,closest:()=>({classList:{remove(){},toggle(){}}}),addEventListener:(name,fn)=>surfaceEvents.set(name,fn),removeEventListener:name=>surfaceEvents.delete(name)};
 const wheelTarget={addEventListener:(name,fn)=>wheel.set(name,fn),removeEventListener:name=>wheel.delete(name)};
 const event=(x,y)=>({button:0,target,pointerId:1,pointerType:'touch',clientX:x,clientY:y,preventDefault(){}});let controller;
 try{
  controller=bindImmersiveDeck({surface,pointerTarget:frame,pointerEnabled:()=>pointerAllowed,wheelTarget,wheelEnabled:()=>true,horizontal:{start(){started++;},drag:dx=>{dragged=dx;},end:(...args)=>{finished=args;},step:()=>sideways++},deck:{style:{}},indicator:{classList:{toggle(){}},querySelector:()=>({})},first:()=>false,canMove:()=>true,move:()=>{vertical++;controller.reset();},refresh(){},like(){},reduced:()=>true});
  pointer.get('pointerdown')(event(400,200));now+=16;pointer.get('pointermove')(event(150,203));pointer.get('pointerup')(event(150,203));assert.equal(started,1);assert.equal(dragged,-250);assert.equal(finished[0],-250);assert.equal(finished[2],false);assert.equal(vertical,0);assert.equal(captured,false);
  pointer.get('click')({detail:1,preventDefault(){},stopImmediatePropagation(){stopped=true;}});assert.equal(stopped,true);
  pointerAllowed=false;pointer.get('pointerdown')(event(400,200));pointer.get('pointermove')(event(150,200));pointer.get('pointerup')(event(150,200));assert.equal(started,1,'a visible sheet blocks dragging the background ribbon');pointerAllowed=true;
  now+=300;wheel.get('wheel')({...event(10,10),deltaX:70,deltaY:0,deltaMode:0});assert.equal(sideways,1);assert.equal(vertical,0);
  now+=300;wheel.get('wheel')({...event(10,10),deltaX:0,deltaY:70,deltaMode:0});assert.equal(vertical,1);
  controller.dispose();assert.equal(pointer.size,0);assert.equal(wheel.size,0);assert.equal(surfaceEvents.size,0);
 }finally{controller?.dispose();if(original===undefined)delete globalThis.ResizeObserver;else globalThis.ResizeObserver=original;}
});
