import test from 'node:test';import assert from 'node:assert/strict';
import {createInlineStudy} from '../public/web/discovery-study.mjs';
import fs from 'node:fs';import vm from 'node:vm';
const session={id:'session',status:'reading',material:'原文',question:'问题',turns:[]};
test('opening waits for the original readiness gate and deduplicates reopening a pending session',async()=>{
 let resolve,calls=0;const model=createInlineStudy({api:{},openStudy:()=>{calls++;return new Promise(r=>resolve=r);}});
 const a=model.open('note');model.close();const b=model.open('note');assert.equal(calls,1);resolve({session});await Promise.all([a,b]);assert.equal(model.active.session,session);
});
test('late session creation never replaces a different active card and blocked material stays blocked',async()=>{
 let resolve;const model=createInlineStudy({api:{},openStudy:id=>id==='a'?new Promise(r=>resolve=r):Promise.resolve({blocked:true,heading:'先核对材料',html:'限制'})});
 const first=model.open('a');await model.open('b');resolve({session});await first;assert.equal(model.active.noteId,'b');assert.equal(model.active.session,null);assert.equal(model.active.blocked.blocked,true);
});

test('reopening after a readiness repair clears the old block without bypassing the gate',async()=>{
 let ready=false,calls=0;const model=createInlineStudy({api:{},openStudy:async()=>{calls++;return ready?{session}:{blocked:true,html:'先核对'};}});
 await model.open('n');assert.equal(model.active.blocked.blocked,true);model.close();ready=true;await model.open('n');assert.equal(calls,2);assert.equal(model.active.blocked,null);assert.equal(model.active.session.id,'session');
});
test('answer retries retain the request id; a confirmed save followed by read failure cannot resubmit',async()=>{
 const writes=[];let fail=true;const api={async post(url,body){writes.push({url,body});if(fail)throw Error('offline');},async get(){throw Error('read offline');}};
 const model=createInlineStudy({api,openStudy:async()=>({session})});await model.open('n');model.updateDraft('我的回答');await model.submit();assert.equal(model.active.draft,'我的回答');fail=false;await model.submit();
 assert.equal(writes[0].body.requestId,writes[1].body.requestId);assert.equal(model.active.needsRead,true);assert.equal(model.active.draft,'');await model.submit();assert.equal(writes.length,2);assert.match(model.active.error,/已保存/);
});
test('pending/completed sessions cannot submit and hint use is included with the original answer',async()=>{
 const writes=[];let current={...session};const api={async post(url,body){writes.push({url,body});return {hint:'提示'};},async get(){return current;}};
 const model=createInlineStudy({api,openStudy:async()=>({session:current})});await model.open('n');await model.hint();model.updateDraft('有提示的回答');await model.submit();assert.equal(writes[1].body.hintUsed,true);
 current.status='awaiting_feedback';model.updateDraft('重复');await model.submit();assert.equal(writes.length,2);current.status='completed';await model.submit();assert.equal(writes.length,2);
});

test('inline and native study use the same readiness gate, while only native study navigates',async()=>{
 const source=fs.readFileSync(new URL('../public/web/main.mjs',import.meta.url),'utf8').match(/async function startStudy\([\s\S]*?startStudy\.intents=new Map\(\);/)[0];
 let ready=false,posts=0,navigations=0,modals=0;
 const scope=vm.createContext({crypto,state:{sequence:1},api:{get:async()=>({id:'note'}),post:async()=>{posts++;return session;}},endpoint:(...args)=>args.join('/'),readReadiness:async()=>({ready,heading:'先核对'}),learningHelp:()=>'<p>保留限制</p>',modal:()=>modals++,go:async()=>navigations++,prepareLearning:async()=>{}});
 vm.runInContext(source+'globalThis.begin=startStudy;',scope);
 const blocked=await scope.begin('n',undefined,{inline:true});assert.equal(blocked.blocked,true);assert.equal(posts,0);assert.equal(modals,0);
 await scope.begin('n');assert.equal(modals,1);assert.equal(posts,0);ready=true;
 assert.equal((await scope.begin('n',undefined,{inline:true})).session.id,'session');assert.equal(navigations,0);
 await scope.begin('n');assert.equal(navigations,1);assert.equal(posts,2);
});

test('finishing waits for feedback and never drops an unsaved answer',async()=>{
 let posts=0;const current={...session,turns:[{answer:'a',feedback:{}}],status:'awaiting_feedback'};
 const model=createInlineStudy({api:{post:async()=>posts++,get:async()=>({...current,status:'completed'})},openStudy:async()=>({session:current})});await model.open('n');await model.finish();assert.equal(posts,0);
 current.status='feedback';model.updateDraft('尚未保存');await model.finish();assert.equal(posts,0);assert.equal(model.active.draft,'尚未保存');model.updateDraft('');await model.finish();assert.equal(posts,1);assert.equal(model.active.session.status,'completed');
});
