import test from 'node:test';import assert from 'node:assert/strict';
import {syncDeckWindow} from '../public/web/discovery-window.mjs';
function harness(){const list={children:[],insertBefore(node,before){node.remove();const index=before?this.children.indexOf(before):this.children.length;this.children.splice(index,0,node);node.parentElement=this;}};
 const create=card=>({dataset:{},style:{setProperty(){}},classList:{toggle(){}},card,removeAttribute(){},setAttribute(){},remove(){if(this.parentElement){const items=this.parentElement.children;items.splice(items.indexOf(this),1);this.parentElement=null;}}});
 const window=(start)=>[-1,0,1].map(slot=>({card:{id:String(start+slot)},key:String(start+slot),slot}));return {list,create,window};}
test('swiping reuses adjacent card nodes and only creates the entering card',()=>{
 const h=harness();syncDeckWindow(h.list,h.window(1),h.create);const [a,b,c]=h.list.children;
 const result=syncDeckWindow(h.list,h.window(2),h.create);assert.equal(result.created,1);assert.equal(result.reused,2);assert.equal(h.list.children[0],b);assert.equal(h.list.children[1],c);assert.equal(a.parentElement,null);
 const current=h.list.children[1];assert.equal(syncDeckWindow(h.list,h.window(2),h.create).created,0);assert.equal(h.list.children[1],current);
});
test('answer updates replace only the current card and long navigation stays at three nodes',()=>{
 const h=harness();syncDeckWindow(h.list,h.window(1),h.create);const [a,b,c]=h.list.children;
 assert.equal(syncDeckWindow(h.list,h.window(1),h.create,{forceKey:'1'}).created,1);assert.equal(h.list.children[0],a);assert.notEqual(h.list.children[1],b);assert.equal(h.list.children[2],c);
 for(let i=2;i<100;i++){syncDeckWindow(h.list,h.window(i),h.create);assert.equal(h.list.children.length,3);}
});
