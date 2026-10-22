import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '../public/web/api.mjs';
const reply=(status,data)=>({ok:status>=200&&status<300,status,json:async()=>data});
const expired=()=>reply(401,{code:'SESSION_REQUIRED',error:'会话已过期，请刷新页面。'});

test('expired reads renew once and retain their original practice scope',async()=>{
 const calls=[];let sessions=0,reads=0;
 const client=createClient(async(path,options)=>{calls.push({path,options});return path==='/api/session'?reply(200,{csrf:`token-${++sessions}`}):++reads===1?expired():reply(200,{notes:['synthetic']});});
 client.setContext('practice');assert.deepEqual(await client.get('/api/notes'),{notes:['synthetic']});
 assert.equal(sessions,2);assert.deepEqual(calls.filter(c=>c.path!=='/api/session').map(c=>c.path),['/api/practice/practice/notes','/api/practice/practice/notes']);assert.equal(client.getContext().pending,0);
});
test('concurrent expiry shares renewal and late old failures cannot clear the new token',async()=>{
 let sessions=0,releaseLate,releaseRenewal;const counts=new Map();
 const client=createClient(async(path)=>{
  if(path==='/api/session'){sessions++;if(sessions===2)await new Promise(r=>releaseRenewal=r);return reply(200,{csrf:`token-${sessions}`});}
  const count=(counts.get(path)||0)+1;counts.set(path,count);
  if(count===1&&path==='/api/late')return new Promise(r=>releaseLate=()=>r(expired()));
  return count===1?expired():reply(200,{ok:true});
 });
 await client.session();const late=client.get('/api/late'),first=client.get('/api/notes'),second=client.get('/api/topics');
 while(!releaseRenewal)await new Promise(r=>setImmediate(r));
 assert.throws(()=>client.setContext('other'),/仍在处理/);
 releaseRenewal();await first;releaseLate();await Promise.all([late,second]);assert.equal(sessions,2);assert.equal(client.getContext().pending,0);
});
test('persistent session failure stops after one retry and releases context lock',async()=>{
 let reads=0;const client=createClient(async p=>p==='/api/session'?reply(200,{csrf:'token'}):(reads++,expired()));
 await assert.rejects(client.get('/api/notes'),{code:'SESSION_REQUIRED'});assert.equal(reads,2);assert.equal(client.getContext().pending,0);client.setContext('other');
});
test('writes, CSRF rejection, other authorization and network failures are never replayed',async()=>{
 for(const [method,status,code]of [['POST',401,'SESSION_REQUIRED'],['PUT',403,'CSRF_DENIED'],['DELETE',401,'SESSION_REQUIRED'],['GET',403,'HOST_DENIED'],['GET',401,'OTHER_AUTH']]){
  let calls=0;const client=createClient(async p=>p==='/api/session'?reply(200,{csrf:'token'}):(calls++,reply(status,{code,error:'rejected'})));
  await assert.rejects(client.request('/api/notes',{method,body:method==='GET'?undefined:{body:'draft'}}),{code});assert.equal(calls,1);assert.equal(client.getContext().pending,0);
 }
 let calls=0;const client=createClient(async p=>p==='/api/session'?reply(200,{csrf:'token'}):(calls++,Promise.reject(Error('network'))));await assert.rejects(client.get('/api/notes'),/network/);assert.equal(calls,1);
});
test('aborted requests and failed renewal stop without repeating the read',async()=>{
 const controller=new AbortController();let sessions=0,reads=0;
 const client=createClient(async p=>p==='/api/session'?(++sessions===1?reply(200,{csrf:'token'}):reply(503,{error:'session unavailable'})):(reads++,expired()));
 await assert.rejects(client.get('/api/notes'),/session unavailable/);assert.equal(reads,1);assert.equal(client.getContext().pending,0);
 controller.abort();await assert.rejects(client.get('/api/notes',{signal:controller.signal}));assert.equal(reads,1);
});
