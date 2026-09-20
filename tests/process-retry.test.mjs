import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createService} from '../src/service.mjs';
test('explicit retry refreshes changed source snapshot and reuses queued work',async()=>{
  const root=fs.mkdtempSync(path.resolve('.tmp/retry-'));
  const s=createService({dataDir:path.join(root,'data'),vaultDir:path.join(root,'vault')});
  try{
    const source=s.importItems({items:[{title:'测试',body:'旧资料'}]}).notes[0];
    const job=s.queue('process',{noteId:source.id,hash:source.hash,extracted:{candidates:[]}},`process:${source.id}:${source.hash}`);
    s.store.put('jobs',job.id,{...job,state:'failed',code:'SOURCE_CHANGED'});
    const updated=s.editNote(source.id,{body:'更新的资料',expectedHash:source.hash});
    const retried=s.jobAction(job.id,{action:'retry'});
    assert.equal(retried.payload.hash,updated.hash);
    assert.equal(retried.payload.extracted,undefined);
    assert.equal(retried.code,null);
    const other=s.queue('process',{noteId:source.id,hash:source.hash},'old-job');
    s.store.put('jobs',other.id,{...other,state:'failed'});
    assert.equal(s.jobAction(other.id,{action:'retry'}).id,retried.id);
  }finally{await s.close();fs.rmSync(root,{recursive:true,force:true});}
});
