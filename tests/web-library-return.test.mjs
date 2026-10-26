import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createClient} from '../public/web/api.mjs';
import {createReaderData} from '../public/web/reader-data.mjs';
const source=fs.readFileSync(new URL('../public/web/main.mjs',import.meta.url),'utf8');
function harness(){
 const counts={library:0,bind:0,loading:0},context={version:0,revision:0};
 const main={dataset:{},childNodes:[],style:{},focus(){},set innerHTML(value){if(value.includes('page-loading'))counts.loading++;this.childNodes=[{html:value}];},replaceChildren(...nodes){this.childNodes=nodes;}};
 const state={route:'today',sequence:0,dirty:false,saving:0,scroll:new Map()},window={scrollY:0,scrollTo({top}){this.scrollY=top;},dispatchEvent(){}};
 const page=async()=>({html:'reader'});
 const sandbox={state,window,document:{documentElement:{classList:{toggle(){},remove(){}}}},history:{pushState(){},replaceState(){}},matchMedia:()=>({matches:true}),CustomEvent:class{},api:{getContext:()=>context,get:async()=>({})},onboarding:{travelling:false,prepareRoute:async()=>{}},focus:{capture(){},mount(){}},shell(){},$:()=>main,$$:()=>[],notify(){},confirm:async()=>true,empty:(_title,message)=>{throw Error(message);},btn(){},link(){},springEnter(){},parity:{library:async()=>{counts.library++;return {html:'library',bind(){counts.bind++;}};}},management:{},readPage:page};
 sandbox.readerData=createReaderData(sandbox.api);
 for(const name of ['todayPage','capturePage','editPage','studyPage','topicsPage','outputPage','settingsPage'])sandbox[name]=page;
 vm.createContext(sandbox);vm.runInContext(source.slice(source.indexOf('let stopStudyFeedback'),source.indexOf('function watchForm'))+';globalThis.goPage=go;globalThis.refresh=refreshBoot;',sandbox);
 return {sandbox,counts,context,main,window};
}
test('returning from a reader restores the same library nodes without requests, loading screen or rebinding',async()=>{
 const h=harness();await h.sandbox.goPage('library');const nodes=h.main.childNodes;nodes[0].filter='saved query';nodes[0].expanded=true;h.window.scrollY=320;
 await h.sandbox.goPage('read/one');const loading=h.counts.loading;await h.sandbox.goPage('library');
 assert.equal(h.counts.library,1);assert.equal(h.counts.bind,1);assert.equal(h.counts.loading,loading);assert.equal(h.main.childNodes[0],nodes[0]);assert.equal(h.main.childNodes[0].filter,'saved query');assert.equal(h.main.childNodes[0].expanded,true);assert.equal(h.window.scrollY,320);
});
test('successful writes, space changes and explicit refresh invalidate the library snapshot',async()=>{
 const h=harness();await h.sandbox.goPage('library');await h.sandbox.goPage('read/one');h.context.revision++;await h.sandbox.goPage('library');assert.equal(h.counts.library,2);
 await h.sandbox.goPage('read/one');h.context.version++;await h.sandbox.goPage('library');assert.equal(h.counts.library,3);
 await h.sandbox.refresh();await h.sandbox.goPage('library');assert.equal(h.counts.library,4);
});
test('client content revision changes on successful writes, not reads or rejected writes',async()=>{
 let fail=false;const client=createClient(async p=>({ok:!fail,status:fail?409:200,json:async()=>p==='/api/session'?{csrf:'synthetic'}:fail?{error:'conflict',code:'CONFLICT'}:{ok:true}}));
 await client.get('/api/library');assert.equal(client.getContext().revision,0);await client.put('/api/notes/id',{body:'synthetic'});assert.equal(client.getContext().revision,1);
 fail=true;await assert.rejects(client.put('/api/notes/id',{body:'conflicting'}));assert.equal(client.getContext().revision,1);
});


test('navigation buttons cached off-document release their busy state',async()=>{
 const {busy}=await import('../public/web/ui.mjs');
 const control={disabled:false,isConnected:true,attributes:new Map(),setAttribute(k,v){this.attributes.set(k,v);},removeAttribute(k){this.attributes.delete(k);}};
 await busy(control,async()=>{assert.equal(control.disabled,true);control.isConnected=false;});
 assert.equal(control.disabled,false);assert.equal(control.attributes.has('aria-busy'),false);
 let calls=0;await busy(control,async()=>calls++);assert.equal(calls,1);
});
