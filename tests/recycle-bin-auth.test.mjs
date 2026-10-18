import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import { createApp } from '../src/server.mjs';
import { createRecycleBin } from '../src/recycle-bin.mjs';
import { decodeFile, writeAttachment, attachmentPath } from '../src/attachments.mjs';

const tempRoot = path.resolve(import.meta.dirname, '../.tmp');
fs.mkdirSync(tempRoot, { recursive: true });
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(tempRoot, 'purge-auth-'));
  const app = createApp({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'), scheduler: false });
  t.after(async () => { await app.close(); fs.rmSync(root, { recursive: true, force: true }); });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const session = await fetch(base + '/api/session'), sessionBody = await session.json();
  const headers = { Cookie: session.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': sessionBody.csrf, 'Content-Type': 'application/json' };
  const req = async (url, method = 'GET', body, token, extra = {}) => {
    const response = await fetch(base + url, { method, headers: { ...headers, ...(token ? { 'X-Zhixu-Purge-Token': token } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  return { app, root, req, sessionBody, base, headers };
}
function recycled(store) {
  const file = decodeFile({ name: 'synthetic.png', mime: 'image/png', bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGZkAAAAASUVORK5CYII=', 'base64') });
  writeAttachment(store.vaultDir, file);
  const note = store.create({ kind: 'source', title: 'synthetic purge fixture', body: 'synthetic original', meta: { attachments: [file.descriptor] } });
  store.delete(note.id, note.hash);
  return { note, filePath: attachmentPath(store.vaultDir, file.descriptor.id) };
}
function snapshot(store) {
  const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : [[path.relative(store.vaultDir, path.join(dir, entry.name)), fs.readFileSync(path.join(dir, entry.name)).toString('base64')]]);
  return { list: createRecycleBin(store).list(), history: store.db.prepare('SELECT * FROM versions ORDER BY rowid').all(),
    claims: ['deleted', 'fileRecovery', 'recyclePurge', 'attachmentUploads'].map(namespace => [namespace, store.records(namespace)]), files: files(store.vaultDir) };
}


test('local webpage purge needs session, CSRF, same origin, confirmation and current scope; no separate credential',async t=>{
 const {app,req,base,headers}=await fixture(t),store=app.service.store;const {note}=recycled(store);
 const preview=(await req('/api/recycle-bin')).body,before=snapshot(store),body={confirmed:true,revision:preview.revision,versionId:preview.items[0].versionId};
 for(const url of ['/api/recycle-bin','/api/recycle-bin/'+note.id]){
  const noSession=await fetch(base+url,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(noSession.status,401);
  for(const extra of [{'X-CSRF-Token':''},{Origin:'https://example.invalid'}]){
   assert.equal((await req(url,'DELETE',body,undefined,extra)).status,403);assert.deepEqual(snapshot(store),before);
  }
  assert.equal((await req(url,'DELETE',{...body,confirmed:false})).status,409);
  assert.equal((await req(url,'DELETE',{...body,revision:'stale'})).status,409);
 }
 const hostDenied=await new Promise((resolve,reject)=>{const request=http.request(base+'/api/recycle-bin',{method:'DELETE',headers:{...headers,Host:'example.invalid'}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});request.on('error',reject);request.end(JSON.stringify(body));});assert.equal(hostDenied,403);
 assert.equal((await req('/api/recycle-bin/'+note.id,'DELETE',{...body,versionId:'wrong'})).status,409);
 assert.equal((await req('/api/recycle-bin/'+note.id+'/unknown/extra','DELETE',body)).status,404);
 assert.deepEqual(snapshot(store),before);
 const removed=await req('/api/recycle-bin/'+note.id,'DELETE',body);assert.equal(removed.status,200);assert.equal(removed.body.cleared,1);
 assert.equal(store.history(note.id).length,0);assert.equal((await req('/api/recycle-bin/'+note.id,'DELETE',body)).status,409);
 const next=recycled(store);const clear=await req('/api/recycle-bin','DELETE',{confirmed:true,revision:(await req('/api/recycle-bin')).body.revision});assert.equal(clear.status,200);assert.equal(store.history(next.note.id).length,0);
});
test('MCP and ChatGPT credentials cannot invoke permanent-delete routes',async t=>{
 const {app,root,base}=await fixture(t),store=app.service.store;recycled(store);const before=snapshot(store);
 app.service.updateSettings({mcp:{enabled:true,chatgptEnabled:true}});
 for(const [prefix,file] of [['mcp','mcp-token'],['chatgpt','chatgpt-mcp-token']]){
  const token=fs.readFileSync(path.join(root,'data',file),'utf8').trim();
  for(const suffix of ['', '/some-id']){
   const res=await fetch(base+'/api/'+prefix+'/recycle-bin'+suffix,{method:'DELETE',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({confirmed:true,revision:before.list.revision})});assert.equal(res.status,404);
  }
  const res=await fetch(base+'/api/recycle-bin',{method:'DELETE',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({confirmed:true,revision:before.list.revision})});assert.equal(res.status,401);
 }
 assert.deepEqual(snapshot(store),before);
});

test('practice single purge uses only its own current revision and leaves main library untouched',async t=>{
 const {app,req}=await fixture(t);recycled(app.service.store);const before=snapshot(app.service.store);
 const practice=(await req('/api/onboarding/start','POST',{})).body;
 app.service.updateSettings({ai:{enabled:true}});app.onboarding.tested('model');
 const prefix='/api/practice/'+practice.practiceId;
 const lease=app.onboarding.acquire(practice.practiceId,{resource:'recycle-bin',method:'GET',query:{}});
 try {
  const {note}=recycled(lease.service.store),preview=(await req(prefix+'/recycle-bin')).body,entry=preview.items.find(x=>x.id===note.id);
  assert.equal((await req(prefix+'/recycle-bin/'+note.id,'DELETE',{confirmed:true,versionId:entry.versionId,revision:before.list.revision})).status,409);
  assert.equal((await req(prefix+'/recycle-bin/'+note.id,'DELETE',{confirmed:true,versionId:entry.versionId,revision:preview.revision})).status,200);
  assert.equal(lease.service.store.history(note.id).length,0);assert.deepEqual(snapshot(app.service.store),before);
 } finally {lease.release();}
});
