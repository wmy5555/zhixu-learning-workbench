import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

function fixture() {
  let document;
  class Element {
    constructor(tag) { this.tagName=tag; this.children=[];this.events={};this.attributes={};this.style={};this.dataset={};this.scrollLeft=0;this.scrollTop=0;this.clientWidth=360;this.clientHeight=400;this.className='';this.open=false;this.classList={add:(...names)=>{this.className+=' '+names.join(' ')},remove:()=>{}}; }
    append(...items) { items.forEach(n=>{n.parentElement=this;this.children.push(n)}); }
    replaceChildren() { this.children=[]; }
    setAttribute(k,v) {this.attributes[k]=String(v)}
    getAttribute(k) {return this.attributes[k]??null}
    addEventListener(k,fn) {this.events[k]=fn}
    focus() {document.activeElement=this}
    scrollIntoView() {this.scrolled=true}
    get isConnected() {return false}
    remove() {}
    querySelectorAll(selector) {
      const all=this.children.flatMap(n=>[n,...n.querySelectorAll('*')]);
      const matches=(n,s)=>s==='*'||s.startsWith('.')&&n.className.split(' ').includes(s.slice(1))||n.tagName===s;
      if(selector.includes(' ')){const [a,b]=selector.split(' ');return all.filter(n=>matches(n,b)&&n.parentElement&&matches(n.parentElement,a))}
      return all.filter(n=>matches(n,selector));
    }
    querySelector(s) {return this.querySelectorAll(s)[0]}
  }
  document={createElement:t=>new Element(t),createElementNS:(_,t)=>new Element(t),createTextNode:text=>Object.assign(new Element('text'),{textContent:text})};
  const context=vm.createContext({document,Node:Element,queueMicrotask:()=>{}});
  const code=fs.readFileSync(new URL('../public/ui.mjs',import.meta.url),'utf8')+'\n'+fs.readFileSync(new URL('../public/source-map.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
  vm.runInContext(code.replaceAll('export ', '')+'\nthis.createMap=createSourceMap;',context);
  const children=[{id:'a',title:'长中文节点标题'.repeat(14)},{id:'b',title:'统一接口端点'},{id:'c',title:'无关节点'}];
  const edges=[{id:'e1',from:'a',to:'b',type:'explain',label:'解释统一接口与底层包装的长关系',explanation:'完整关系解释'.repeat(100),sourceRefs:[{quote:'合成来源证据',start:0,end:6}]},{id:'e2',from:'b',to:'c',type:'example',label:'第二关系'}];
  const before=JSON.stringify(edges),view={reading:false};
  const root=context.createMap({source:{id:'s',title:'合成',structure:{edges,hierarchy:[]}},children,view,renderDetail:n=>Object.assign(new Element('article'),{textContent:n.title}),analyze:()=>{}});
  return {root,view,document,edges,before,children};
}

test('clicking full relationship selects its exact endpoints, expands evidence, and switches or cancels without mutations',()=>{
  const {root,view,document,edges,before,children}=fixture();
  const labels=()=>root.querySelectorAll('.map-edge-control');
  labels()[0].events.click();
  assert.equal(view.selectedEdge,'e1');
  assert.equal(labels()[0].getAttribute('aria-pressed'),'true');
  assert.ok(labels()[0].getAttribute('aria-label').includes(edges[0].label));
  const selected=root.querySelector('.map-edge-detail');
  assert.equal(selected.open,true);
  assert.equal(document.activeElement,selected.querySelector('summary'));
  assert.ok(selected.querySelector('summary').textContent.includes(children[0].title));
  assert.equal(root.querySelectorAll('.is-endpoint').length,2);
  assert.ok(root.querySelectorAll('.map-node-kicker').some(n=>n.textContent.startsWith('起点')));
  assert.ok(root.querySelectorAll('.map-node-kicker').some(n=>n.textContent.startsWith('终点')));
  labels()[1].events.click();assert.equal(view.selectedEdge,'e2');
  let stopped=false;
  root.events.keydown({key:'Escape',preventDefault(){},stopPropagation(){stopped=true}});
  assert.equal(stopped,true);assert.equal(view.selected,null);assert.equal(view.selectedEdge,null);
  assert.equal(root.querySelectorAll('.is-endpoint').length,0);
  assert.equal(document.activeElement,root.querySelector('.map-viewport'));
  assert.equal(JSON.stringify(edges),before);
  const node=root.querySelectorAll('.map-node').find(n=>n.dataset.noteId==='a');node.events.click();
  assert.equal(view.selected,'a');assert.ok(root.querySelector('.map-selected-title').textContent.includes(children[0].title));
});
