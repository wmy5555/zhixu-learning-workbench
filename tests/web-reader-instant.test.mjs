import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createReaderData, sameReaderData } from '../public/web/reader-data.mjs';
const note=(id='one',kind='source')=>({id,kind,title:id,hash:'hash-'+id,body:'完整中文正文\n\n## 原文\n\n第二段',meta:{stage:'learning',researchLimitations:['尚待核验']}});
function harness(){
 const context={version:0,revision:0},calls=[],gates=[];
 const api={getContext:()=>context,get:path=>{calls.push(path);return new Promise((resolve,reject)=>gates.push({path,resolve,reject}));}};
 const boot={notes:[note(),note('child','knowledge')]};boot.notes[1].meta.sources=[{id:'one',role:'input'}];
 const data=createReaderData(api,{limit:1});
 const finish=(id='one')=>{for(const gate of gates.splice(0)){gate.resolve(gate.path==='/api/relations'?{relations:[]}:gate.path.endsWith('/evidence')?{limitations:['完整证据限制']}:{...note(id,id==='child'?'knowledge':'source'),structure:{state:'ready',units:[]}});}};
 return {context,calls,gates,api,boot,data,finish};
}
test('known source immediately projects full text and children without starting any request',()=>{
 const h=harness(),initial=h.data.peek('one',h.boot);
 assert.equal(initial.note.body,h.boot.notes[0].body);assert.equal(initial.note.children[0].id,'child');assert.deepEqual(h.calls,[]);
 assert.equal(h.data.peek('missing',h.boot),null);
});
test('unchanged detail avoids parsing the full reader again while structure and warnings still refresh',()=>{
 const data={note:note(),related:[],readiness:null},copy=structuredClone(data);
 assert.equal(sameReaderData(data,copy),true);
 copy.note.structure={state:'ready',units:[]};assert.equal(sameReaderData(data,copy),false);
 copy.note.structure=undefined;copy.readiness={warnings:['新提醒']};assert.equal(sameReaderData(data,copy),false);
});
test('detail, relations and evidence run together; concurrent opening deduplicates in-flight reads',async()=>{
 const h=harness(),a=h.data.load('child',h.boot),b=h.data.load('child',h.boot);
 assert.equal(a,b);assert.equal(h.calls.length,3);assert.ok(h.calls.includes('/api/notes/child/evidence'));
 h.finish('child');const result=await a;assert.deepEqual(result.readiness.warnings,['完整证据限制']);assert.equal(h.data.peek('child',h.boot),result);
});
test('writes, knowledge-space switches and bootstrap refresh discard enriched details; late responses cannot repopulate them',async()=>{
 for(const change of [h=>h.context.revision++,h=>h.context.version++,h=>h.boot={notes:[...h.boot.notes]}]){
   const h=harness(),request=h.data.load('one',h.boot);change(h);h.data.peek('one',h.boot);h.finish();await request;
   assert.equal(h.data.peek('one',h.boot).note.structure,undefined);
   const next=h.data.load('one',h.boot);h.finish();await next;assert.equal(h.calls.length,4);
 }
});
test('failed requests can be retried and enriched details are bounded',async()=>{
 const h=harness(),failed=h.data.load('one',h.boot);h.gates[0].reject(Error('offline'));h.finish();await assert.rejects(failed,/offline/);
 const a=h.data.load('one',h.boot);h.finish();const first=await a;
 const b=h.data.load('child',h.boot);h.finish('child');await b;
 assert.notEqual(h.data.peek('one',h.boot),first);assert.equal(h.calls.length,7);
});
test('background detail completion never changes a reader after navigation, writes or bootstrap changes',async()=>{
 const source=fs.readFileSync(new URL('../public/web/main.mjs',import.meta.url),'utf8');
 for(const change of [h=>h.state.sequence++,h=>h.key++,h=>h.state.boot={notes:[]}]){
   let resolve,updates=0;const initial={note:note(),related:[],readiness:null};
   const h={state:{sequence:1,boot:{notes:[]},readerReturn:'library'},key:0};
   const sandbox={...h,readerData:{peek:()=>initial,load:()=>new Promise(done=>resolve=done)},libraryKey:()=>h.key,list:x=>x,reader:()=>({html:'reader'}),$:()=>({isConnected:true}),updateReader:()=>updates++,notify:()=>{}};
   vm.createContext(sandbox);vm.runInContext(source.slice(source.indexOf('function readPage'),source.indexOf('async function editPage'))+';globalThis.page=readPage;',sandbox);
   const page=sandbox.page('one');assert.equal(page.html,'reader');page.bind();change(h);resolve({...initial,note:{...note(),title:'late'}});
   await new Promise(done=>setImmediate(done));assert.equal(updates,0);assert.equal(h.state.note.title,'one');
 }
});
