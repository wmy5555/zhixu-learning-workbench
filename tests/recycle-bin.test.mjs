import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import { Store } from '../src/store.mjs';
import { createApp } from '../src/server.mjs';
import { createRecycleBin } from '../src/recycle-bin.mjs';
import { decodeFile, writeAttachment, attachmentPath, readAttachment } from '../src/attachments.mjs';
const tempRoot=path.resolve(import.meta.dirname,'../.tmp');fs.mkdirSync(tempRoot,{recursive:true});
function setup(t){const root=fs.mkdtempSync(path.join(tempRoot,'recycle-'));const store=new Store({dataDir:path.join(root,'data'),vaultDir:path.join(root,'vault')});t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});return {root,store,bin:createRecycleBin(store)};}
const source=store=>store.create({kind:'source',title:'合成原始资料',body:'完整原文\n第二段',meta:{custom:'保留属性'}});
const png=()=>decodeFile({name:'synthetic.png',mime:'image/png',bytes:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGZkAAAAASUVORK5CYII=','base64')});

test('soft delete and exact restore preserve raw bytes, attachment, child/source and confirmed relation',t=>{
 const {store,bin}=setup(t), file=png();writeAttachment(store.vaultDir,file);
 let note=source(store);const child=store.create({kind:'knowledge',title:'保留知识',body:'解释',meta:{sources:[{id:note.id,role:'input'}]}});
 const relation={id:'synthetic-relation',fromId:note.id,toId:child.id,type:'support'};
 note=store.update(note.id,{expectedHash:note.hash,meta:{attachments:[file.descriptor],relations:[relation]}});
 const raw=store.row(note.id).raw;store.put('research','other',{id:'other',body:'保留'});
 store.delete(note.id,note.hash);assert.equal(store.row(note.id),undefined);assert.equal(bin.list().items.length,1);
 const entry=bin.list().items[0];const restored=bin.restore(entry.id,entry.versionId);
 assert.equal(store.row(note.id).raw,raw);assert.equal(restored.hash,note.hash);assert.equal(store.read(child.id).meta.sources[0].id,note.id);
 assert.equal(store.get('relations',relation.id).state,'accepted');assert.equal(readAttachment(store.vaultDir,file.descriptor).bytes.length,file.bytes.length);
 assert.equal(bin.list().items.length,0);assert.equal(store.get('research','other').body,'保留');
});

test('clear requires confirmation and unchanged scope; empty and unrelated history remain isolated',t=>{
 const {store,bin}=setup(t);assert.equal(bin.list().items.length,0);const empty=bin.list();assert.deepEqual(bin.clear({confirmed:true,revision:empty.revision}),{cleared:0});
 const a=source(store);store.delete(a.id,a.hash);const before=bin.list();
 assert.throws(()=>bin.clear({revision:before.revision}),{code:'RECYCLE_CONFIRM_REQUIRED'});assert.equal(bin.list().items.length,1);
 const b=source(store);store.delete(b.id,b.hash);assert.throws(()=>bin.clear({confirmed:true,revision:before.revision}),{code:'RECYCLE_CONFLICT'});
 const knowledge=store.create({kind:'knowledge',title:'独立历史',body:'知识正文'});store.delete(knowledge.id,knowledge.hash);
 const retained=store.history(knowledge.id);const preview=bin.list();assert.equal(preview.items.length,2);
 assert.deepEqual(bin.clear({confirmed:true,revision:preview.revision}),{cleared:2});assert.equal(bin.list().items.length,0);
 assert.equal(store.history(a.id).length,0);assert.deepEqual(store.history(knowledge.id),retained);
 assert.throws(()=>bin.restore(a.id,preview.items[0].versionId),{code:'RECYCLE_CONFLICT'});
});

test('clear removes only exclusive attachments and retains shared attachments and other library',t=>{
 const {store,bin}=setup(t), other=setup(t),file=png();writeAttachment(store.vaultDir,file);
 let a=source(store);a=store.update(a.id,{expectedHash:a.hash,meta:{attachments:[file.descriptor]}});
 let b=source(store);b=store.update(b.id,{expectedHash:b.hash,meta:{attachments:[file.descriptor]}});
 const separate=source(other.store);other.store.delete(separate.id,separate.hash);
 store.delete(a.id,a.hash);bin.clear({confirmed:true,revision:bin.list().revision});assert.ok(fs.existsSync(attachmentPath(store.vaultDir,file.descriptor.id)));
 store.delete(b.id,b.hash);bin.clear({confirmed:true,revision:bin.list().revision});assert.equal(fs.existsSync(attachmentPath(store.vaultDir,file.descriptor.id)),false);
 assert.equal(other.bin.list().items.length,1);assert.equal(other.store.history(separate.id).length>0,true);
});

test('restore refuses occupied paths or missing attachment without consuming recycled item',t=>{
 const {store,bin}=setup(t),file=png();writeAttachment(store.vaultDir,file);let a=source(store);a=store.update(a.id,{expectedHash:a.hash,meta:{attachments:[file.descriptor]}});
 const filePath=path.join(store.vaultDir,a.path);store.delete(a.id,a.hash);const entry=bin.list().items[0];
 fs.writeFileSync(filePath,'external occupant');assert.throws(()=>bin.restore(a.id,entry.versionId),{code:'EXACT_RESTORE_CONFLICT'});assert.equal(fs.readFileSync(filePath,'utf8'),'external occupant');fs.unlinkSync(filePath);
 fs.unlinkSync(attachmentPath(store.vaultDir,file.descriptor.id));assert.throws(()=>bin.restore(a.id,entry.versionId),{code:'ATTACHMENT_MISSING'});assert.equal(bin.list().items.length,1);
});

test('HTTP recycle routes keep session/CSRF and practice library boundaries',async t=>{
 const root=fs.mkdtempSync(path.join(tempRoot,'recycle-http-')),app=createApp({dataDir:path.join(root,'data'),vaultDir:path.join(root,'vault'),scheduler:false});
 t.after(async()=>{await app.close();fs.rmSync(root,{recursive:true,force:true});});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const base='http://127.0.0.1:'+app.server.address().port;
 const session=await fetch(base+'/api/session'),csrf=(await session.json()).csrf,headers={Cookie:session.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':csrf,'Content-Type':'application/json'};
 const req=async(p,method='GET',body,h=headers)=>{const r=await fetch(base+p,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 assert.equal((await req('/api/recycle-bin','GET',undefined,{})).status,401);assert.equal((await req('/api/recycle-bin','DELETE',{}, {Cookie:headers.Cookie,'Content-Type':'application/json'})).status,403);
 const note=source(app.service.store);app.service.store.put('research','other',{id:'other',body:'preserved'});assert.equal((await req('/api/notes/'+note.id,'DELETE',{expectedHash:note.hash})).status,200);
 assert.equal(app.service.store.get('research','other').body,'preserved');const list=(await req('/api/recycle-bin')).body;assert.equal(list.items[0].id,note.id);
 const practice=(await req('/api/onboarding/start','POST',{})).body;app.service.updateSettings({ai:{enabled:true}});app.onboarding.tested('model');
 const prefix='/api/practice/'+practice.practiceId;assert.deepEqual((await req(prefix+'/recycle-bin')).body.items,[]);
 assert.equal((await req(prefix+'/recycle-bin/'+note.id+'/restore','POST',{versionId:list.items[0].versionId})).status,409);
 assert.equal((await req(prefix+'/recycle-bin','DELETE',{confirmed:true,revision:list.revision})).status,409);assert.equal((await req('/api/recycle-bin')).body.items.length,1);
 assert.equal((await req('/api/recycle-bin/'+note.id+'/restore','POST',{versionId:list.items[0].versionId})).status,200);assert.equal(app.service.store.read(note.id).hash,note.hash);
});

test('interrupted physical cleanup is journaled and retry preserves newly shared attachments',t=>{
 const {store,bin}=setup(t),file=png();writeAttachment(store.vaultDir,file);let a=source(store);a=store.update(a.id,{expectedHash:a.hash,meta:{attachments:[file.descriptor]}});store.delete(a.id,a.hash);
 const unlink=fs.unlinkSync;fs.unlinkSync=file=>{if(file.endsWith('.raw'))throw Object.assign(new Error('synthetic busy'),{code:'EBUSY'});return unlink(file);};
 try{assert.throws(()=>bin.clear({confirmed:true,revision:bin.list().revision}),{code:'EBUSY'});}finally{fs.unlinkSync=unlink;}
 assert.equal(store.history(a.id).length,0);assert.equal(bin.list().pendingCleanup,1);assert.ok(fs.existsSync(attachmentPath(store.vaultDir,file.descriptor.id)));
 store.create({kind:'source',title:'新拥有者',body:'合成原文',meta:{attachments:[file.descriptor]}});
 bin.clear({confirmed:true,revision:bin.list().revision});assert.equal(bin.list().pendingCleanup,0);assert.ok(fs.existsSync(attachmentPath(store.vaultDir,file.descriptor.id)));
});

test('legacy explicit user deletion is recoverable; ChatGPT undo and external disappearance stay separate',t=>{
 const {store,bin}=setup(t);const a=source(store);store.delete(a.id,a.hash);store.put('deleted',a.id,{id:a.id,deletedAt:new Date().toISOString()});assert.equal(bin.list().items[0].id,a.id);bin.restore(a.id,bin.list().items[0].versionId);assert.equal(store.read(a.id).hash,a.hash);
 const b=source(store);store.delete(b.id,b.hash,{undoId:'separate-owner'});assert.equal(bin.list().items.length,0);
 const c=source(store);fs.unlinkSync(path.join(store.vaultDir,c.path));store.scan();assert.equal(bin.list().items.length,0);
});

test('single purge isolates other recycled history, shared attachments, knowledge and prior pending cleanup',t=>{
 const {store,bin}=setup(t),file=png();writeAttachment(store.vaultDir,file);
 let a=source(store);a=store.update(a.id,{expectedHash:a.hash,meta:{attachments:[file.descriptor]}});
 let b=source(store);b=store.update(b.id,{expectedHash:b.hash,meta:{attachments:[file.descriptor]}});
 const knowledge=store.create({kind:'knowledge',title:'retained knowledge',body:'synthetic',meta:{sources:[{id:a.id}]}});
 store.delete(a.id,a.hash);store.delete(b.id,b.hash);const before=bin.list(),entry=before.items.find(x=>x.id===a.id),bHistory=store.history(b.id);
 store.put('recyclePurge','prior',{id:'prior',files:[]});const revision=bin.list().revision;
 assert.throws(()=>bin.purge(a.id,entry.versionId,{confirmed:true,revision:before.revision}),{code:'RECYCLE_CONFLICT'});
 assert.throws(()=>bin.purge(a.id,'wrong',{confirmed:true,revision}),{code:'RECYCLE_CONFLICT'});
 assert.deepEqual(bin.purge(a.id,entry.versionId,{confirmed:true,revision}),{cleared:1});
 assert.equal(store.history(a.id).length,0);assert.deepEqual(store.history(b.id),bHistory);assert.equal(bin.list().items[0].id,b.id);
 assert.ok(store.read(knowledge.id));assert.ok(fs.existsSync(attachmentPath(store.vaultDir,file.descriptor.id)));assert.ok(store.get('recyclePurge','prior'));
 bin.restore(b.id,bin.list().items[0].versionId);assert.ok(store.read(b.id));
});
