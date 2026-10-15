import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {parseDocument} from 'yaml';
import {createService} from '../src/service.mjs';
import {receiveHistorySnapshot} from '../src/chatgpt-history-snapshot.mjs';

const tempRoot=path.resolve(import.meta.dirname,'../.tmp');fs.mkdirSync(tempRoot,{recursive:true});
const reference='zhixu-history-v1:'+'f'.repeat(64);
function fixture(t){
  const root=fs.mkdtempSync(path.join(tempRoot,'history-security-'));
  const config={dataDir:path.join(root,'data'),vaultDir:path.join(root,'vault')};
  const units=[{index:0,role:'user',message_id:'message_a',content:'合成问题。',content_type:'text',rich_content:null,created_at:null},
    {index:1,role:'assistant',message_id:'message_b',content:'合成回答。',content_type:'text',rich_content:null,created_at:null}];
  const snapshot={version:1,conversation_id:'11111111-1111-4111-8111-111111111111',title:'合成安全回归',branch:'active',snapshot_id:'a'.repeat(32),
    transcript_sha256:createHash('sha256').update(JSON.stringify(units)).digest('hex'),units,
    pages:[{range:{start:{message:0,offset:0},end:{message:2,offset:0}},hasMore:false}],coverage:{text:'complete_visible_active_branch'},
    warnings:[],issued_at:Date.now(),expires_at:Date.now()+60000};
  let expired=false,calls=0;
  const options={...config,receiveHistorySnapshot:async()=>{calls++;if(expired)throw new Error('synthetic expired pipe');return snapshot;}};
  let service=createService(options);service.updateSettings({mcp:{chatgptEnabled:true}});
  t.after(()=>{service.store.db.close();assert.ok(root.startsWith(tempRoot+path.sep));fs.rmSync(root,{recursive:true,force:true});});
  return {config,get service(){return service;},get calls(){return calls;},expire(){expired=true;},restart(){service.store.db.close();service=createService(options);}};
}
const request=()=>({requestId:randomUUID(),historySnapshotRef:reference,summary:'合成独立摘要。',structured:{version:1,items:['one','two'].map(id=>({id,title:'合成候选 '+id,body:'合成建议 '+id,type:'knowledge',sourceMessageIds:['message_b'],uncertainties:['待核验。']}))}});
function changeMeta(file,key,value){const raw=fs.readFileSync(file,'utf8'),header=raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);const document=parseDocument(header[1]);document.set(key,value);fs.writeFileSync(file,`---\n${document.toString().trimEnd()}\n---\n${raw.slice(header[0].length)}`);}

test('security: alternate request ID for identical history input retries after pipe expiry and restart',async t=>{
  const f=fixture(t),a=request(),first=await f.service.chatgpt.captureHistorySnapshot(a),b={...a,requestId:randomUUID()};
  const alternate=await f.service.chatgpt.captureHistorySnapshot(b);assert.equal(alternate.duplicate,true);
  f.expire();f.restart();
  const retry=await f.service.chatgpt.captureHistorySnapshot(b);assert.equal(retry.duplicate,true);assert.equal(retry.noteId,first.noteId);
  assert.deepEqual(retry.importedNoteIds,first.importedNoteIds);assert.equal(f.service.store.list().length,3);assert.equal(f.calls,2);
  await assert.rejects(f.service.chatgpt.captureHistorySnapshot({...b,summary:'不同摘要。'}),{code:'CHATGPT_REQUEST_CONFLICT'});
});

test('security: completed revision one receipt remains valid after revision two without rewriting edited or current source',async t=>{
  const f=fixture(t),a=request(),first=await f.service.chatgpt.captureHistorySnapshot(a);
  const second=await f.service.chatgpt.captureHistorySnapshot({...a,requestId:randomUUID(),summary:'第二版合成摘要。',baseRevision:1});
  assert.equal(second.syncRevision,2);f.expire();f.restart();
  const store=f.service.store,before=store.read(first.noteId),beforeReceipts=store.records('chatgptCaptures'),beforeSessions=store.records('chatgptSyncSessions');
  store.create=()=>{throw new Error('completed retry must not create notes');};store.update=()=>{throw new Error('completed retry must not update notes');};
  const retry=await f.service.chatgpt.captureHistorySnapshot(a);
  assert.equal(retry.duplicate,true);assert.equal(retry.syncRevision,1);assert.equal(retry.noteId,first.noteId);
  assert.deepEqual(retry.importedNoteIds,first.importedNoteIds);assert.equal(store.read(first.noteId).hash,before.hash);
  assert.deepEqual(store.records('chatgptCaptures'),beforeReceipts);assert.deepEqual(store.records('chatgptSyncSessions'),beforeSessions);assert.equal(f.calls,2);
  await assert.rejects(f.service.chatgpt.captureHistorySnapshot({...a,summary:'变更旧请求内容。'}),{code:'CHATGPT_REQUEST_CONFLICT'});
  const file=path.join(f.config.vaultDir,before.path);fs.appendFileSync(file,'\n外部编辑，必须保留。');const edited=fs.readFileSync(file,'utf8');
  await assert.rejects(f.service.chatgpt.captureHistorySnapshot(a),{code:'CHATGPT_SOURCE_EDITED'});assert.equal(fs.readFileSync(file,'utf8'),edited);
});

for(const point of ['before-source-write','before-new-receipt'])test(`security: completed receipt retry leaves a newer pending request intact (${point})`,async t=>{
  const f=fixture(t),a=request(),first=await f.service.chatgpt.captureHistorySnapshot(a);
  const b={...a,requestId:randomUUID(),summary:'待完成的第二版合成摘要。',baseRevision:1},store=f.service.store,put=store.put.bind(store);
  store.put=(namespace,key,record)=>{
    if(point==='before-source-write'&&namespace==='chatgptSyncSessions'&&record.revision===2&&record.sourceWritePhase==='started')throw new Error('synthetic newer pending interruption');
    if(point==='before-new-receipt'&&namespace==='chatgptCaptures'&&record.receipt?.syncRevision===2)throw new Error('synthetic newer pending interruption');
    return put(namespace,key,record);
  };
  await assert.rejects(f.service.chatgpt.captureHistorySnapshot(b),/newer pending interruption/);store.put=put;f.expire();f.restart();
  const pending=f.service.store.records('chatgptSyncSessions')[0],before=f.service.store.read(first.noteId);assert.equal(pending.pending,true);
  const retry=await f.service.chatgpt.captureHistorySnapshot(a);assert.equal(retry.syncRevision,1);assert.equal(retry.duplicate,true);
  assert.deepEqual(f.service.store.records('chatgptSyncSessions')[0],pending);assert.equal(f.service.store.read(first.noteId).hash,before.hash);
  const file=path.join(f.config.vaultDir,before.path);fs.appendFileSync(file,'\n人工修改。');const edited=fs.readFileSync(file,'utf8');
  await assert.rejects(f.service.chatgpt.captureHistorySnapshot(a),{code:'CHATGPT_SOURCE_EDITED'});assert.equal(fs.readFileSync(file,'utf8'),edited);
});

for(const [key,value] of [['author','人工作者'],['platform','人工来源'],['origins',[{author:'人工来源'}]]])test(`security: interrupted source hash checkpoint rejects external ${key} edits`,async t=>{
  const f=fixture(t),a=request(),store=f.service.store,put=store.put.bind(store);
  store.put=(namespace,key,record)=>{if(namespace==='chatgptSyncSessions'&&record.noteHash)throw new Error('synthetic source hash checkpoint failure');return put(namespace,key,record);};
  await assert.rejects(f.service.chatgpt.captureHistorySnapshot(a),/source hash checkpoint failure/);store.put=put;
  const note=store.list().find(n=>n.kind==='source'),file=path.join(f.config.vaultDir,note.path);changeMeta(file,key,value);
  const edited=fs.readFileSync(file,'utf8');f.restart();f.expire();
  await assert.rejects(f.service.chatgpt.captureHistorySnapshot(a),{code:'CHATGPT_SOURCE_EDITED'});
  assert.equal(fs.readFileSync(file,'utf8'),edited);assert.equal(f.service.store.records('chatgptCaptures').length,0);
});

test('security: source checkpoint recovery and next update preserve unknown custom metadata',async t=>{
  const f=fixture(t),a=request(),store=f.service.store,put=store.put.bind(store);
  store.put=(namespace,key,record)=>{if(namespace==='chatgptSyncSessions'&&record.noteHash)throw new Error('synthetic source hash checkpoint failure');return put(namespace,key,record);};
  await assert.rejects(f.service.chatgpt.captureHistorySnapshot(a),/source hash checkpoint failure/);store.put=put;
  const note=store.list().find(n=>n.kind==='source'),file=path.join(f.config.vaultDir,note.path);changeMeta(file,'customUserField',{value:'保留此字段'});
  f.restart();const first=await f.service.chatgpt.captureHistorySnapshot(a);
  const updated=await f.service.chatgpt.captureHistorySnapshot({...a,requestId:randomUUID(),summary:'合成新版摘要。',baseRevision:1});
  assert.equal(updated.syncRevision,2);assert.equal(updated.noteId,first.noteId);
  assert.deepEqual(f.service.store.read(updated.noteId).meta.customUserField,{value:'保留此字段'});
});

test('security: externally deleted candidate cannot be recreated during pending history recovery',async t=>{
  const f=fixture(t),a=request(),store=f.service.store,create=store.create.bind(store);
  store.create=value=>{if(value.kind==='knowledge'&&store.list().some(n=>n.kind==='knowledge'))throw new Error('synthetic second candidate failure');return create(value);};
  await assert.rejects(f.service.chatgpt.captureHistorySnapshot(a),/second candidate failure/);store.create=create;
  const candidate=store.list().find(n=>n.kind==='knowledge'),file=path.join(f.config.vaultDir,candidate.path);
  assert.equal(store.get('deleted',candidate.id),null);fs.unlinkSync(file);f.restart();f.expire();
  await assert.rejects(f.service.chatgpt.captureHistorySnapshot(a),{code:'CHATGPT_STRUCTURE_CONFLICT'});
  assert.equal(fs.existsSync(file),false);assert.equal(f.service.store.list().length,1);
});

for(const remove of [true,false])test(`security: candidate file written before first index/history checkpoint ${remove?'cannot be recreated after external deletion':'can resume when its exact file remains'}`,async t=>{
  const f=fixture(t),a=request(),store=f.service.store,upsert=store.upsert.bind(store);let written;
  store.upsert=(file,raw,id,...rest)=>{if(id.startsWith('chatgpt_item_')){written={file,id};throw new Error('synthetic interruption after atomicWrite before first index');}return upsert(file,raw,id,...rest);};
  await assert.rejects(f.service.chatgpt.captureHistorySnapshot(a),/after atomicWrite/);store.upsert=upsert;
  assert.ok(fs.existsSync(written.file));assert.equal(store.row(written.id),undefined);assert.equal(store.history(written.id).length,0);
  assert.equal(store.get('deleted',written.id),null);
  if(remove)fs.unlinkSync(written.file);
  f.restart();f.expire();
  if(remove){await assert.rejects(f.service.chatgpt.captureHistorySnapshot(a),{code:'CHATGPT_STRUCTURE_CONFLICT'});assert.equal(fs.existsSync(written.file),false);}
  else {const receipt=await f.service.chatgpt.captureHistorySnapshot(a);assert.equal(receipt.importedItems,2);assert.equal(f.service.store.list().length,3);}
});

test('security: candidate intent checkpoint fails before write and safely resumes the unstarted candidate',async t=>{
  const f=fixture(t),a=request(),store=f.service.store,put=store.put.bind(store);
  store.put=(namespace,key,record)=>{if(namespace==='chatgptSyncSessions'&&Object.values(record.candidateWrites||{}).some(entry=>entry.phase==='started'))throw new Error('synthetic candidate intent checkpoint failure');return put(namespace,key,record);};
  await assert.rejects(f.service.chatgpt.captureHistorySnapshot(a),/candidate intent checkpoint failure/);store.put=put;
  assert.equal(store.list().length,1);f.restart();f.expire();
  assert.equal((await f.service.chatgpt.captureHistorySnapshot(a)).importedItems,2);assert.equal(f.service.store.list().length,3);
});

test('security: slow authentication is inside the total deadline and late key bytes are cleared',async()=>{
  const key=Buffer.alloc(32,9);const started=Date.now();let done;
  const delivered=new Promise(resolve=>done=resolve);
  await assert.rejects(receiveHistorySnapshot(reference,{timeout:40,requestId:'synthetic_timeout',inputDigest:'e'.repeat(64),readAuthKey:()=>new Promise(resolve=>setTimeout(()=>{resolve(key);done();},250))}));
  assert.ok(Date.now()-started<200,'authentication must not consume its own separate budget');
  await delivered;await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(key,Buffer.alloc(32));
});
