import test from 'node:test';
import assert from 'node:assert/strict';
import {createGuideMotion} from '../public/web/onboarding-motion.mjs';
import {welcomeBody,assistantBody,proposalBody} from '../public/web/onboarding-dialogs.mjs';

test('selected welcome and question layouts keep production state and explicit route confirmation',()=>{
 const fresh=welcomeBody({mode:'A',materialId:'course',index:0});
 assert.match(fresh,/轻随行（推荐）/);assert.match(fresh,/先说说我的疑问/);assert.doesNotMatch(fresh,/我有一个具体问题|刷新后清空|原创虚构材料/);
 const resumed=welcomeBody({mode:'C',materialId:'course',index:9,practiceId:'synthetic'});assert.match(resumed,/第 10 步继续/);assert.match(resumed,/data-material="course"[^>]*disabled/);
 assert.match(assistantBody(),/data-guide="suggest-goal"/);assert.doesNotMatch(assistantBody(),/data-guide="goal"/);
 const proposal=proposalBody({goal:'setup',steps:[{title:'<script>bad</script>'}],startIndex:0,reason:'<unsafe>'});assert.match(proposal,/data-guide="goal"/);assert.doesNotMatch(proposal,/<script>|<unsafe>/);
});

test('frame collapse keeps the leaf fixed, stays transparent during morph, and does not snap on tracking',async t=>{
 const original=Object.fromEntries(['document','innerWidth','innerHeight','matchMedia','getComputedStyle'].map(k=>[k,globalThis[k]]));t.after(()=>{for(const [k,v]of Object.entries(original)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}});
 const records=[];
 class Node {
  constructor(type){this.type=type;this.style={};this.dataset={};this.hidden=false;this.isConnected=true;this.parentElement=null;this.children=[];}
  set innerHTML(v){if(this.type==='layer'){this.firstElementChild=new Node('marker');this.firstElementChild.parentElement=this;this.firstElementChild.skin=new Node('skin');this.firstElementChild.leaf=new Node('leaf');this.firstElementChild.leaf.parentElement=this.firstElementChild;}}
  querySelector(s){return s==='button'?this.leaf:this.skin;}
  querySelectorAll(){return [];}
  append(n){this.children.push(n);n.parentElement=this;}
  getBoundingClientRect(){const parent=this.type==='leaf'?this.parentElement.getBoundingClientRect():{x:0,y:0};const x=parent.x+parseFloat(this.style.left||0),y=parent.y+parseFloat(this.style.top||0),width=parseFloat(this.style.width||44),height=parseFloat(this.style.height||44);return {x,y,width,height,left:x,top:y,right:x+width,bottom:y+height};}
  getAnimations(){return [];}
  animate(frames,options){const record={node:this,frames,options,shape:this.dataset.shape};records.push(record);return {finished:Promise.resolve(),cancel:()=>{record.hiddenOnCancel=this.hidden;},commitStyles(){}};}
 }
 globalThis.document={body:new Node('body'),createElement:()=>new Node('layer'),querySelectorAll:()=>[]};globalThis.innerWidth=1200;globalThis.innerHeight=900;globalThis.matchMedia=()=>({matches:false});globalThis.getComputedStyle=()=>({overflowY:'visible'});
 const target=new Node('target');Object.assign(target.style,{left:'100',top:'250',width:'400',height:'160'});
 const motion=createGuideMotion();await motion.move(target);await motion.frame(target);const before=motion.leaf.getBoundingClientRect();await motion.retract();const after=motion.leaf.getBoundingClientRect();assert.equal(after.x,before.x);assert.equal(after.y,before.y);await motion.track();assert.equal(motion.leaf.getBoundingClientRect().x,before.x);assert.equal(motion.leaf.getBoundingClientRect().y,before.y);
 const markerRecords=records.filter(r=>r.node.type==='marker');assert.ok(markerRecords.every(r=>r.shape==='morphing'));
 const card=new Node('card');Object.assign(card.style,{left:'700',top:'180',width:'340',height:'400'});await motion.panel(card,false);const last=records.at(-1);assert.equal(last.options.fill,'forwards');assert.equal(last.hiddenOnCancel,true);assert.equal(card.hidden,true);assert.equal(motion.panelMoving,false);await motion.panel(card,true);assert.equal(card.hidden,false);
});
