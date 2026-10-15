import assert from 'node:assert/strict';
import test from 'node:test';
import { click, control, createAndroidBrowser, findButton } from './fixtures/android-browser.mjs';
const note={id:'synthetic-note',kind:'source',title:'合成原文',body:'保留的正文',hash:'synthetic-hash',meta:{},children:[]};
async function fixture(confirmations=[]){const f=await createAndroidBrowser({confirmations,api:{note:async()=>note}});await f.context.openNote(note.id);await click(findButton(f.app.refs.drawerBody,'编辑原始资料'));const form=f.app.refs.drawerBody.querySelector('form');return {...f,form};}
for(const [name,close] of [['close button',f=>click(f.app.refs.drawerClose)],['backdrop',f=>click(f.app.refs.drawerBackdrop)],['Escape',async f=>{f.document.events.keydown({key:'Escape'});await new Promise(resolve=>setImmediate(resolve));}]]){
 test(`Android edited drawer ${name} confirms discard, preserves cancellation and does not re-prompt while hidden`,async()=>{
  const f=await fixture([false,true]);control(f.form,'body').value='未保存的新正文';
  await close(f);assert.equal(f.app.refs.drawer.classList.contains('is-open'),true);assert.equal(control(f.form,'body').value,'未保存的新正文');assert.equal(f.context.confirmPrompts.length,1);
  await close(f);assert.equal(f.app.refs.drawer.classList.contains('is-open'),false);assert.equal(f.context.confirmPrompts.length,2);
  await close(f);assert.equal(f.context.confirmPrompts.length,2);
 });
}
test('Android unchanged drawer closes without a discard prompt',async()=>{const f=await fixture();await click(f.app.refs.drawerClose);assert.equal(f.app.refs.drawer.classList.contains('is-open'),false);assert.equal(f.context.confirmPrompts.length,0);});
test('Android stale discard decision cannot close a replacement drawer',async()=>{
 const f=await fixture();control(f.form,'body').value='未保存';let resolve;f.context.confirmAction=()=>new Promise(r=>{resolve=r;});
 const closing=click(f.app.refs.drawerClose);f.app.renderSourceGroupDrawer({...note,id:'replacement',title:'后来打开的内容'});resolve(true);await closing;
 assert.equal(f.app.refs.drawer.classList.contains('is-open'),true);assert.equal(f.app.refs.drawerTitle.textContent,"后来打开的内容");
});
