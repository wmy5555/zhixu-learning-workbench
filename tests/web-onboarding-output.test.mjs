import test from 'node:test';
import assert from 'node:assert/strict';
import {outputGuide} from '../public/web/onboarding-output.mjs';
import {createGuideMotion} from '../public/web/onboarding-motion.mjs';

const node=(values={})=>Object.assign({dataset:{},nodes:new Map(),querySelectorAll(s){return this.nodes.get(s)||[];},querySelector(s){return this.querySelectorAll(s)[0]||null;},getAttribute(s){return this[s];},closest(){return this.label;}},values);
function fixture(id='output-draft'){
 const root=node(),form=node(),question=node({value:''}),mode=node({checked:false,label:node()}),cloud=node({checked:false,label:node()}),scope=node({label:node()}),submit=node();
 root.nodes.set('#output-form',[form]);form.nodes=new Map([['[name="question"]',[question]],['[name="mode"][value="draft"]',[mode]],['[name="scope"]',[scope]],['[name="scope"]:checked',[scope]],['[name="cloud"]',[cloud]],['button[type="submit"]',[submit]]]);
 const input={root,route:'output',proof:{roles:{draft:'current'},progress:{}},step:{id,instruction:'继续本次草稿',sample:{question:'写一段说明成立条件的分享。'}},visible:n=>!n.hidden};
 return {root,form,question,mode,cloud,scope,submit,input,guide:()=>outputGuide(input)};
}

test('draft guide follows manual question, mode, scope, permission and submit states without mutating them',()=>{
 const f=fixture();assert.equal(f.guide().target,f.question);assert.match(f.guide().instruction,/写一段说明成立条件/);
 f.question.value='我的输出目标';assert.equal(f.guide().target,f.mode.label);
 f.mode.checked=true;f.form.nodes.set('[name="scope"]:checked',[]);assert.equal(f.guide().target,f.scope.label);
 f.form.nodes.set('[name="scope"]:checked',[f.scope]);assert.equal(f.guide().target,f.cloud.label);assert.match(f.guide().instruction,/可能计费/);assert.equal(f.cloud.checked,false);
 f.cloud.checked=true;assert.equal(f.guide().target,f.submit);
 f.form['aria-busy']='true';assert.equal(f.guide().phase,'waiting');assert.equal(f.guide().target,f.submit);
 delete f.form['aria-busy'];f.input.proof.progress['output-draft']={status:'done'};assert.equal(f.guide().phase,'completed');assert.match(f.guide().instruction,/草稿已保存/);
});

test('citation guide targets the disclosure and actual reading button of the current draft',()=>{
 const f=fixture('output-citations'),wrong=node({dataset:{outputDraft:'other'}}),output=node({dataset:{outputDraft:'current'}}),details=node({open:false}),summary=node(),read=node();
 f.root.nodes.set('#output-result [data-output-draft]',[wrong,output]);output.nodes.set('details[data-output-citations]',[details]);details.nodes.set('summary',[summary]);details.nodes.set('.evidence-entry .actions [data-route^="read/"]',[read]);
 assert.equal(f.guide().target,summary);assert.equal(details.open,false,'guidance must not click or expand the disclosure');details.open=true;assert.equal(f.guide().target,read);
 const other=node({dataset:{id:'other'}}),current=node({dataset:{id:'current'}});f.root.nodes.set('#output-result [data-output-draft]',[wrong]);f.root.nodes.set('[data-action="open-draft"]',[other,current]);assert.equal(f.guide().target,current);
});

test('deep reading and unrelated modal windows hide the leaf rather than targeting covered content',()=>{
 const f=fixture('output-use'),dialog=node({dataset:{draftId:'other'}});f.root.nodes.set('dialog[open]',[dialog]);assert.equal(f.guide().target,null);
 dialog.dataset.draftId='current';const label=node(),use=node({label});dialog.nodes.set('[name="usedId"]',[use]);assert.equal(f.guide().target,label);
 f.input.route='read/cited-knowledge';assert.equal(f.guide().target,null);assert.equal(f.guide().phase,'reading');assert.match(f.guide().instruction,/叶子暂时收起/);
});

test('adoption targets the entire label, then the save control while retaining the same draft',()=>{
 const f=fixture('output-use'),dialog=node({dataset:{draftId:'current'}}),label=node(),use=node({label}),save=node();f.root.nodes.set('dialog[open]',[dialog]);dialog.nodes.set('[name="usedId"]',[use]);dialog.nodes.set('button[type="submit"]',[save]);
 assert.equal(f.guide().target,label);dialog.nodes.set('[name="usedId"]:checked',[use]);assert.equal(f.guide().target,save);assert.match(f.guide().instruction,/未保存不会完成/);
});

test('a modal reserves one header dock through framing, scrolling and collapse, then releases it',async t=>{
 const saved=Object.fromEntries(['document','innerWidth','innerHeight','matchMedia','getComputedStyle'].map(k=>[k,globalThis[k]]));t.after(()=>{for(const [k,v]of Object.entries(saved)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}});
 class Element{
  constructor(type){this.type=type;this.style={};this.dataset={};this.hidden=false;this.isConnected=true;this.children=[];}
  set innerHTML(_){this.firstElementChild=new Element('marker');this.firstElementChild.skin=new Element('skin');this.firstElementChild.leaf=new Element('leaf');this.firstElementChild.leaf.parentElement=this.firstElementChild;}
  querySelector(s){return s==='button'?this.leaf:s==='.dialog-heading'?header:s==='[data-modal-close]'?close:this.skin;}
  querySelectorAll(){return [];}
  closest(s){return this===target&&s==='dialog[open]'?dialog:null;}
  setAttribute(){}
  append(n){n.parentElement=this;this.children.push(n);}
  insertBefore(n){this.append(n);Object.assign(n.style,{left:'264px',top:'44px',width:'44px',height:'44px'});}
  remove(){this.parentElement?.children.splice(this.parentElement.children.indexOf(this),1);this.parentElement=null;this.isConnected=false;}
  getAnimations(){return [];}
  getBoundingClientRect(){const p=this.type==='leaf'?this.parentElement.getBoundingClientRect():{x:0,y:0},x=p.x+parseFloat(this.style.left||0),y=p.y+parseFloat(this.style.top||0),width=parseFloat(this.style.width||44),height=parseFloat(this.style.height||44);return {x,y,left:x,top:y,width,height,right:x+width,bottom:y+height};}
 }
 const body=new Element('body'),dialog=new Element('dialog'),header=new Element('header'),close=new Element('close'),target=new Element('target');Object.assign(target.style,{left:'40px',top:'500px',width:'308px',height:'44px'});
 globalThis.document={body,createElement:()=>new Element('layer'),querySelectorAll:()=>[]};globalThis.innerWidth=390;globalThis.innerHeight=844;globalThis.matchMedia=()=>({matches:true});globalThis.getComputedStyle=()=>({overflowY:'visible'});
 const motion=createGuideMotion();await motion.move(target);const dock=header.children[0],at=()=>{const a=motion.leaf.getBoundingClientRect(),b=dock.getBoundingClientRect();assert.equal(a.x,b.x);assert.equal(a.y,b.y);};at();assert.equal(dock.className,'onboard-dialog-dock');
 await motion.frame(target);at();Object.assign(dock.style,{top:'-20px'});target.style.top='250px';await motion.track();at();await motion.retract();at();assert.equal(header.children.length,1);motion.hide();assert.equal(header.children.length,0);
});
