import test from 'node:test';
import assert from 'node:assert/strict';
import {buildStoryPages,createRelatedIndex,createStoryStrip} from '../public/web/discovery-story.mjs';

test('illustrated pages extract the actual text with a bounded count, and never expose quiz answers',()=>{
 const body='合上材料，先试着回忆。用自己的话说出核心意思。再核对原文，找到遗漏。一次顺利回答也不等于长期掌握。'.repeat(20);
 const pages=buildStoryPages({type:'reading',title:'主动回忆',body});
 assert.equal(pages[0].title,'主动回忆');assert.ok(pages.length>1&&pages.length<=4);
 for(const page of pages.slice(1))assert.ok(body.includes(page.body.replace(/…$/,'')));
 assert.equal(buildStoryPages({type:'reading',title:'空白',body:' '}).length,1);
 assert.deepEqual(buildStoryPages({type:'quiz',title:'先尝试',body:'原文',answer:'秘密答案'}),[{title:'先尝试',body:'',cover:true}]);
 assert.ok(!JSON.stringify(buildStoryPages({type:'reading',title:'图卡',body:'<!-- internal -->\n```js\nalert(1)\n```\n真正的原文。'})).includes('alert'));
 const math=JSON.stringify(buildStoryPages({type:'reading',title:'符号',body:'-10 小于 0。2 * 3 = 6。变量 x_y 不应被改名。'}));assert.ok(math.includes('-10'));assert.ok(math.includes('2 * 3'));assert.ok(math.includes('x_y'));
});

test('related search requires real matching knowledge, not just the same topic',()=>{
 const cards=[{id:'a',noteId:'a',type:'reading',title:'甲',topic:'相同主题',body:'',sourceHash:'v'},{id:'b',noteId:'b',type:'reading',title:'乙',topic:'相同主题',body:'',sourceHash:'v'},{id:'c',noteId:'c',type:'reading',title:'丙',topic:'其他主题',body:'',sourceHash:'v'}];
 const notes=cards.map(c=>({id:c.noteId,meta:{}}));assert.deepEqual(createRelatedIndex(cards,notes)(cards[0]),[]);
 notes[0].meta.tags=['主动回忆'];notes[2].meta.tags=['主动回忆'];const related=createRelatedIndex(cards,notes)(cards[0]);
 assert.equal(related.length,1);assert.equal(related[0].card.id,'c');assert.equal(related[0].query,'主动回忆');
});

test('confirmed links work in both directions while absent targets and unconfirmed suggestions do not',()=>{
 const cards=['a','b','c'].map(id=>({id,noteId:id,type:'reading',title:id,body:''}));
 const notes=[{id:'a',meta:{relations:[{fromId:'a',toId:'b',state:'accepted'},{fromId:'a',toId:'c',state:'suggested'},{fromId:'a',toId:'missing',state:'accepted'}]}},{id:'b',meta:{relations:{bad:true}}},{id:'c',meta:{}}];
 const related=createRelatedIndex(cards,notes);assert.deepEqual(related(cards[0]).map(x=>x.card.id),['b']);assert.deepEqual(related(cards[1]).map(x=>x.card.id),['a']);assert.equal(related(cards[2]).length,0);
});

function harness(t,{reduce=true}={}){
 const original={getComputedStyle:globalThis.getComputedStyle,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
 globalThis.getComputedStyle=el=>({transform:`matrix(1,0,0,1,${Number(el.style.transform.match(/translate3d\((-?[\d.]+)px/)?.[1])||0},0)`});globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
 t.after(()=>{for(const [key,value] of Object.entries(original)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
 const states=new Map();let current='a',changed=[],animated=0;
 const make=id=>{
  const pages=Array.from({length:4},()=>({inert:false,attrs:{},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},querySelector:()=>({focus(){}})}));
  const scroll={scrollTop:0},detail={dataset:{}},track={children:pages,style:{transform:'translate3d(0px,0,0)'},animate(){animated++;return {finished:Promise.resolve(),cancel(){}};}};
  const buttons=Array.from({length:3},(_,i)=>({dataset:{storyGo:String(i)},classList:{toggle(){}},setAttribute(){},removeAttribute(){}}));
  return {dataset:{storyKey:id},clientWidth:500,track,pages,scroll,querySelector:selector=>selector==='.lf-story-track'?track:selector==='[data-story-detail-body]'?scroll:detail,querySelectorAll:()=>buttons};
 };
 const elements={a:make('a'),b:make('b')};
 const controller=createStoryStrip({getElement:()=>elements[current],stateFor:id=>{if(!states.has(id))states.set(id,{index:0,lastPicture:0});return states.get(id);},reduced:()=>reduce,onChange:value=>changed.push(value)});controller.sync();
 return {controller,states,elements,changed,get animated(){return animated;},switch(id){current=id;controller.sync();}};
}

test('the final picture continues into a sibling detail page and returns to the same picture',async t=>{
 const h=harness(t),c=h.controller,pages=h.elements.a.pages;
 await c.step(1);await c.step(1);assert.equal(h.states.get('a').index,2);assert.equal(c.detailOpen,false);
 await c.step(1);assert.equal(c.detailOpen,true);assert.equal(h.elements.a.track.children,pages);assert.equal(pages[3].inert,false);assert.equal(pages[2].inert,true);
 await c.back();assert.equal(h.states.get('a').index,2);assert.equal(c.detailOpen,false);assert.equal(h.animated,0);c.dispose();
});

test('image position, detail reading position and expansion survive card recycling',async t=>{
 const h=harness(t),c=h.controller;await c.go(1);await c.detail();c.expand();h.elements.a.scroll.scrollTop=240;
 h.switch('b');await c.go(2);h.switch('a');assert.equal(c.detailOpen,true);assert.equal(h.elements.a.scroll.scrollTop,240);assert.equal(h.states.get('a').expanded,true);
 await c.back();assert.equal(h.states.get('a').index,1);h.switch('b');assert.equal(h.states.get('b').index,2);c.dispose();
});

test('horizontal dragging tracks the ribbon, commits one page and cancels a short drag',async t=>{
 const h=harness(t,{reduce:false}),c=h.controller;c.start();c.drag(-180);c.end(-180,-.8);await Promise.resolve();assert.equal(h.states.get('a').index,1);assert.equal(h.animated,1);
 c.start();c.drag(-15);c.end(-15,0);await Promise.resolve();assert.equal(h.states.get('a').index,1);
 c.start();c.drag(-180);c.end(-180,-1,true);await Promise.resolve();assert.equal(h.states.get('a').index,1);c.dispose();
});
