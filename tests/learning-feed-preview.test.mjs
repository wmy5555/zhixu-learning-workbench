import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createLearningFeedPreview } from '../scripts/learning-feed-preview.mjs';

const scratchParent=path.resolve(import.meta.dirname,'../.tmp');
async function previewFor(t,options={}){
  const preview=await createLearningFeedPreview({port:0,...options});
  t.after(async()=>{
    await preview.close();
    const relative=path.relative(scratchParent,preview.root);
    assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'cleanup remains inside this checkout scratch directory');
    await fs.rm(preview.root,{recursive:true,force:true});
  });
  return preview;
}

test('integrated preview uses the real app with synthetic isolated sources and body-bound cards',async t=>{
  const preview=await previewFor(t),{service}=preview;
  assert.equal(path.dirname(preview.dataDir),preview.root);assert.equal(path.dirname(preview.vaultDir),preview.root);
  assert.equal(service.store.dataDir,preview.dataDir);assert.equal(service.store.vaultDir,preview.vaultDir);
  const config=service.settings();for(const key of ['ai','embedding','search','fetch','mcp'])assert.equal(config[key].enabled,false);
  const boot=service.bootstrap(),knowledge=boot.notes.filter(n=>n.kind==='knowledge');
  assert.equal(knowledge.length,6);assert.equal(boot.notes.filter(n=>n.kind==='topic').length,2);
  assert.ok(boot.preview.isolated);assert.equal(boot.preview.externalCalls,false);
  for(const note of knowledge){
    assert.equal(note.meta.discoveryPreview,true);
    assert.equal(note.meta.claimType,'fact');assert.equal(note.meta.userStructured,true);
    assert.deepEqual(note.meta.researchLimitations,['这是独立编写的预览教学材料，未经过知序联网加工核验。']);
    assert.notEqual(note.meta.researchStatus,'verified');
    assert.equal(note.meta.discovery.sourceHash,createHash('sha256').update(note.body).digest('hex'));
    assert.ok(boot.notes.some(n=>n.kind==='source'&&n.id===note.meta.sources[0].id));
  }
  assert.ok(boot.today.items.some(item=>item.kind==='review'));
  assert.equal(service.store.records('sessions').length,0);assert.equal(service.store.records('studyEvidence').length,0);assert.equal(service.store.records('calls').length,0);
  const entry=await fetch(preview.url);assert.equal(entry.status,200);assert.match(await entry.text(),/\/web\/main\.mjs/);
  const session=await fetch(`${preview.url}/api/session`),cookie=session.headers.get('set-cookie').split(';')[0];
  const response=await fetch(`${preview.url}/api/bootstrap`,{headers:{Cookie:cookie}});assert.equal(response.status,200);assert.equal((await response.json()).preview.isolated,true);
  const missingCsrf=await fetch(`${preview.url}/api/settings`,{method:'PUT',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{"dailyMinutes":20}'});
  assert.equal(missingCsrf.status,403);
});

test('unverified preview facts retain material warnings and use the existing guarded study endpoint without AI',async t=>{
  const preview=await previewFor(t),note=preview.service.getNote(preview.fixture.knowledgeIds[0]);
  const session=await fetch(`${preview.url}/api/session`),cookie=session.headers.get('set-cookie').split(';')[0],{csrf}=await session.json();
  const headers={Cookie:cookie,Origin:preview.url,'X-CSRF-Token':csrf,'Content-Type':'application/json'};
  const evidence=await fetch(`${preview.url}/api/notes/${note.id}/evidence`,{headers:{Cookie:cookie}});
  assert.equal(evidence.status,200);assert.ok((await evidence.json()).limitations.includes(note.meta.researchLimitations[0]));
  const started=await fetch(`${preview.url}/api/study/start`,{method:'POST',headers,body:JSON.stringify({noteId:note.id,requestId:'preview-warning-study'})});
  assert.equal(started.status,200);const study=await started.json();
  assert.equal(study.status,'reading');assert.equal(study.sourceHash,note.hash);
  assert.equal(preview.service.settings().ai.enabled,false);
  assert.deepEqual(study.materialWarnings,note.meta.researchLimitations);assert.deepEqual(study.turns,[]);
  const invalid=await fetch(`${preview.url}/api/study/start`,{method:'POST',headers,body:JSON.stringify({noteId:preview.fixture.sourceIds[0],requestId:'preview-source-guard'})});
  assert.equal((await invalid.json()).code,'NOTE_UNAVAILABLE');
  assert.equal(preview.service.store.records('calls').length,0);assert.equal(preview.service.store.records('jobs').length,0);assert.equal(preview.service.store.records('studyEvidence').length,0);
});

test('preview cannot enable external providers or change its storage paths',async t=>{
  const {service}=await previewFor(t);
  for(const input of [{ai:{enabled:true}},{search:{enabled:true}},{fetch:{enabled:true}},{vaultDir:path.resolve('vault')},{dataDir:path.resolve('.data')},{mcp:{enabled:true}}]){
    assert.throws(()=>service.updateSettings(input),{code:'PREVIEW_OFFLINE'});
  }
  assert.throws(()=>service.ai.generate({}),{code:'PREVIEW_OFFLINE'});
  assert.throws(()=>service.ai.test('model',{}),{code:'PREVIEW_OFFLINE'});
  assert.throws(()=>service.ai.discoverModels('model',{}),{code:'PREVIEW_OFFLINE'});
  service.updateSettings({dailyMinutes:20});assert.equal(service.settings().dailyMinutes,20);
  assert.equal(service.store.records('calls').length,0);
});

test('occupied preferred ports fall back to another loopback port',async t=>{
  const first=await previewFor(t),second=await previewFor(t,{port:first.port});
  assert.notEqual(second.port,first.port);assert.notEqual(second.port,4318);assert.notEqual(second.root,first.root);
  assert.equal(second.app.server.address().address,'127.0.0.1');
});

test('formal port and production mode are rejected before a preview is created',async()=>{
  await assert.rejects(()=>createLearningFeedPreview({port:4318}),{code:'PREVIEW_OFFLINE'});
  const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';
  try{await assert.rejects(()=>createLearningFeedPreview({port:0}),{code:'PREVIEW_OFFLINE'});}
  finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});
