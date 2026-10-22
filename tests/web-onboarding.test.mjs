import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient,capturePayload} from '../public/web/api.mjs';
import {guideSteps,prerequisite,destination,selectors,sidePosition,intersection,suggestGoals} from '../public/web/onboarding-model.mjs';
const response=value=>({ok:true,json:async()=>value});
test('practice client scopes JSON, uploads and downloads; onboarding stays shared',async()=>{
 const calls=[],client=createClient(async(path,options)=>{calls.push({path,options});return response(path==='/api/session'?{csrf:'synthetic-csrf'}:{ok:true});});
 client.setContext('synthetic-practice');await client.post('/api/import',{items:[]});await client.get('/api/onboarding/state');await client.upload({name:'test.txt',type:'text/plain'},'test');
 assert.equal(calls[1].path,'/api/practice/synthetic-practice/import');assert.equal(calls[1].options.headers['X-CSRF-Token'],'synthetic-csrf');assert.equal(calls[2].path,'/api/onboarding/state');assert.match(calls[3].path,/^\/api\/practice\/synthetic-practice\/uploads/);assert.equal(client.url('/api/backup'),'/api/practice/synthetic-practice/backup');client.setContext('');assert.equal(client.url('/api/backup'),'/api/backup');
});
test('a pending request prevents context switch; rejected requests release the lock',async()=>{
 let finish;const client=createClient(async path=>path==='/api/session'?response({csrf:'synthetic'}):new Promise(resolve=>finish=resolve));await client.session();client.setContext('first');const pending=client.get('/api/bootstrap');await Promise.resolve();assert.throws(()=>client.setContext('second'),/仍在处理/);finish(response({}));await pending;client.setContext('second');assert.equal(client.getContext().pending,0);
 const broken=createClient(async path=>path==='/api/session'?response({csrf:'synthetic'}):Promise.reject(Error('network')));await assert.rejects(broken.get('/api/notes'));assert.equal(broken.getContext().pending,0);broken.setContext('new');
});
test('all 28 core steps map to explicit new UI targets with prerequisite recovery',()=>{
 const steps=guideSteps('course');assert.equal(steps.length,28);for(const s of steps)assert.ok(selectors(s,{}).length,s.id);assert.equal(prerequisite(steps[5],{}).id,'setup-test');assert.equal(prerequisite(steps[6],{modelReady:true}).id,'capture-save');assert.equal(destination(steps[6],{roles:{capturedSource:'source'}},''),'read/source');assert.equal(destination(steps.find(s=>s.id==='study-answer'),{roles:{}},'session'),'study/session');assert.deepEqual(suggestGoals('连接模型'),['setup']);assert.ok(suggestGoals('学习和复习').length>1);
});
test('leaf remains within viewport and avoids target and adjacent control',()=>{
 for(const width of [390,1200]){const target={x:40,y:250,w:width-120,h:45},obstacle={x:width-64,y:250,w:44,h:44};const point=sidePosition(target,{width,height:844},[obstacle]);assert.equal(intersection(point,target),0);assert.equal(intersection(point,obstacle),0);assert.ok(point.x>=12&&point.x+point.w<=width-12);const repeated=sidePosition(target,{width,height:844},[obstacle],point);assert.deepEqual(repeated,point);}
});
import fs from 'node:fs';
import path from 'node:path';
import {createService} from '../src/service.mjs';
import {createApp} from '../src/server.mjs';
test('HTTP practice adapter preserves real-library isolation and rejects unknown practice IDs',async t=>{
 const root=fs.mkdtempSync(path.resolve('.tmp/web-guide-http-')),dataDir=path.join(root,'data');
 const service=createService({dataDir,vaultDir:path.join(root,'vault'),aiOverride:{async test(){return {message:'controlled offline'};}}});
 const app=createApp({service,dataDir,scheduler:false});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await app.close();fs.rmSync(root,{recursive:true,force:true});});
 service.updateSettings({ai:{enabled:true,baseUrl:'https://example.com/v1',model:'controlled'}});app.onboarding.settingsChanged({ai:{}});await app.onboarding.test('model');
 let cookie='';const url=`http://127.0.0.1:${app.server.address().port}`;
 const client=createClient(async(p,options)=>{const r=await fetch(url+p,{...options,headers:{...options.headers,...(cookie?{Cookie:cookie}:{})}});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return r;});
 const proof=await client.post('/api/onboarding/start',{materialId:'course'});client.setContext(proof.practiceId);
 await client.post('/api/onboarding/checkpoint',{practiceId:proof.practiceId,stepId:'capture-save',mode:'check'});
 const created=await client.post('/api/import',capturePayload({title:'Only in synthetic practice',body:'synthetic practice text',process:false}));
 const checked=await client.get('/api/onboarding/state');assert.equal(checked.roles.capturedSource,created.notes[0].id);assert.equal(checked.progress['capture-save'].status,'done');
 assert.ok(created.notes[0].id);assert.equal(service.store.row(created.notes[0].id),undefined);
 assert.ok((await client.get('/api/bootstrap')).notes.some(n=>n.id===created.notes[0].id));
 client.setContext('unknown');await assert.rejects(client.get('/api/bootstrap'),{code:'PRACTICE_NOT_FOUND'});
 client.setContext(proof.practiceId);await client.post('/api/onboarding/pause',{practiceId:proof.practiceId});client.setContext('');assert.equal((await client.get('/api/bootstrap')).notes.length,0);
});
