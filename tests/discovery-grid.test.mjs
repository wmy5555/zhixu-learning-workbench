import test from 'node:test';
import assert from 'node:assert/strict';
import {createGridPager,createOverscrollGate,bindGridFeed} from '../public/web/discovery-grid.mjs';
import {expansionGeometry,createSharedCoverTransition,isDetailBlank} from '../public/web/discovery-motion.mjs';

test('grid continues beyond a single recommendation batch without repeats and stops at the real end',()=>{
 const source=Array.from({length:77},(_,i)=>({id:String(i)}));
 const pager=createGridPager(({excludeIds,limit})=>source.filter(c=>!excludeIds.includes(c.id)).slice(0,limit));
 const first=pager.reset();assert.equal(first.items.length,12);assert.equal(first.hasMore,true);
 while(pager.hasMore)pager.next();
 assert.equal(pager.items.length,77);assert.equal(new Set(pager.items.map(c=>c.id)).size,77);
 assert.deepEqual(pager.next().added,[]);assert.equal(pager.hasMore,false);
 source.push({id:'new'});assert.equal(pager.reset().items.length,12);
 while(pager.hasMore)pager.next();assert.equal(pager.items.at(-1).id,'new');
});

test('empty filters stay exhausted and changing the source resets the batch',()=>{
 let source=[];const pager=createGridPager(()=>source);
 assert.equal(pager.reset().hasMore,false);assert.deepEqual(pager.next().added,[]);
 source=[{id:'a'},{id:'a'},{id:'b'}];assert.deepEqual(pager.reset().items.map(c=>c.id),['a','b']);
});

test('wheel reaching the top must finish before continued upward scrolling refreshes once',()=>{
 const gate=createOverscrollGate();
 assert.equal(gate.wheel(-400,false,1000).refresh,false);
 assert.equal(gate.wheel(-400,true,1020).refresh,false);
 assert.equal(gate.wheel(-60,true,1500).refresh,false);
 assert.equal(gate.wheel(-60,true,1520).refresh,true);
 assert.equal(gate.wheel(-500,true,1550).refresh,false);
 assert.equal(gate.wheel(-120,true,2000).refresh,true);
 assert.equal(gate.wheel(120,true,2400).refresh,false);
});

test('refresh gestures normalize wheel units, ignore multitouch/cancel, latch pending reads and release listeners',async()=>{
 const saved={requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame,IntersectionObserver:globalThis.IntersectionObserver};
 const listeners=new Map();let calls=0,resolve,observedDelta;
 const scroll={scrollTop:0,clientHeight:500,scrollHeight:1000,querySelector:()=>null,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 const indicator={classList:{toggle(){}},style:{},textContent:''};
 globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};globalThis.IntersectionObserver=undefined;
 const send=(name,event)=>listeners.get(name)({...event,type:name,preventDefault(){}});
 const touch=y=>({touches:[{clientX:30,clientY:y}]});let dispose;
 try{
  dispose=bindGridFeed({scroll,indicator,hasMore:()=>false,loadMore(){},reduced:()=>true,gate:{wheel(delta){observedDelta=delta;return {distance:120,refresh:true};}},refresh:()=>{calls++;return new Promise(r=>{resolve=r;});}});
  send('touchstart',touch(20));send('touchmove',touch(150));send('touchcancel',{});assert.equal(calls,0);
  send('touchstart',touch(20));send('touchmove',touch(150));send('touchstart',{touches:[{},{}]});send('touchend',{});assert.equal(calls,0);
  send('wheel',{deltaX:0,deltaY:-8,deltaMode:1});assert.equal(observedDelta,-128);assert.equal(calls,1);
  send('wheel',{deltaX:0,deltaY:-120,deltaMode:0});assert.equal(calls,1);resolve();await Promise.resolve();
  send('touchstart',touch(20));send('touchmove',touch(150));send('touchend',{});assert.equal(calls,2);resolve();await Promise.resolve();
  dispose();assert.equal(listeners.size,0);
 }finally{dispose?.();for(const [name,value] of Object.entries(saved)){if(value===undefined)delete globalThis[name];else globalThis[name]=value;}}
});

test('fullscreen expansion uses uniform scale and clipping to match the actual clicked rectangle',()=>{
 for(const source of [{left:271,top:320,width:250,height:284},{left:17,top:-95,width:180,height:560}]){
  const target={left:0,top:0,width:1440,height:900};
  const g=expansionGeometry(source,target);
  assert.equal(g.scale,Math.max(source.width/target.width,source.height/target.height));
  assert.ok(!g.transform.includes('scale(' + g.scale + ','));
  assert.ok(g.clip.startsWith('inset('));
  assert.equal(g.left,source.left);assert.equal(g.top,source.top);
  assert.ok(Math.abs((target.width-g.right)*g.scale-source.width)<.001);
  assert.ok(Math.abs((target.height-g.bottom)*g.scale-source.height)<.001);
 }
});

test('exit keeps the fullscreen content mounted until shrink completes, and cancellation settles it',async()=>{
 const source={left:400,top:250,width:240,height:310},full={left:0,top:0,width:1440,height:900};
 let resolve,frames,changed=0,focused=0,cancelled=0;
 const panel={style:{transformOrigin:''},getBoundingClientRect:()=>full,animate(value){frames=value;return {finished:new Promise(r=>{resolve=r;}),cancel(){cancelled++;}};}};
 const tile={getBoundingClientRect:()=>source};const motion=createSharedCoverTransition(()=>false);
 const opening=motion.run({from:tile,change:()=>changed++,target:()=>panel});
 assert.equal(changed,1);assert.equal(frames[0].transform,expansionGeometry(source,full).transform);resolve();await opening;
 assert.equal(motion.running,false);assert.equal(cancelled,1);
 const closing=motion.run({from:panel,reverse:true,target:()=>tile,change:()=>changed++,after:()=>focused++});
 assert.equal(changed,1);assert.equal(frames[1].transform,expansionGeometry(source,full).transform);
 motion.cancel();assert.equal(changed,2);assert.equal(focused,1);assert.equal(motion.running,false);resolve();await closing;
 assert.equal(changed,2);assert.equal(panel.style.transformOrigin,'');
});

test('reduced motion switches directly and missing return targets still close accessibly',async()=>{
 const el={getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})};let changed=0,focused=0;
 const motion=createSharedCoverTransition(()=>true);
 await motion.run({from:el,target:()=>el,change:()=>changed++,after:()=>focused++});
 await motion.run({from:el,reverse:true,target:()=>null,change:()=>changed++,after:()=>focused++});
 assert.equal(changed,2);assert.equal(focused,2);assert.equal(motion.running,false);
});

test('blank-space exit protects controls, images, actual text and selected text',()=>{
 const saved={window:globalThis.window,document:globalThis.document,NodeFilter:globalThis.NodeFilter};
 let selected=false,protectedTarget=false;
 const text={textContent:'可选择的正文'};let visited=false;
 globalThis.window={getSelection:()=>({isCollapsed:!selected})};globalThis.NodeFilter={SHOW_TEXT:4};
 globalThis.document={createTreeWalker:()=>{visited=false;return {nextNode:()=>visited?null:(visited=true,text)};},createRange:()=>({selectNodeContents(){},getClientRects:()=>[{left:30,right:190,top:20,bottom:40}]})};
 const target={closest:selector=>selector==='.lf-detail'?{}:protectedTarget?{}:null};
 try{
  assert.equal(isDetailBlank({target,clientX:15,clientY:30}),true);
  assert.equal(isDetailBlank({target,clientX:80,clientY:30}),false);
  selected=true;assert.equal(isDetailBlank({target,clientX:15,clientY:30}),false);
  assert.equal(isDetailBlank({target,clientX:15,clientY:30},{ignoreSelection:true}),true);
  selected=false;protectedTarget=true;assert.equal(isDetailBlank({target,clientX:15,clientY:30}),false);
 }finally{for(const [name,value] of Object.entries(saved)){if(value===undefined)delete globalThis[name];else globalThis[name]=value;}}
});
