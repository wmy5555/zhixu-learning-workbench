// Explicit, isolated synthetic preview. Never starts the regular user's service.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createService} from '../src/service.mjs';
import {createApp} from '../src/server.mjs';
import {seedParity} from '../tests/fixtures/web-parity.mjs';
const parent=path.resolve(import.meta.dirname,'../.tmp');
fs.mkdirSync(parent,{recursive:true});
const root=fs.mkdtempSync(path.join(parent,'parity-preview-'));
const candidateService=createService({dataDir:path.join(root,'candidate-data'),vaultDir:path.join(root,'candidate-vault')});
const fixture=seedParity(candidateService),candidate=createApp({service:candidateService,scheduler:false});
await new Promise(resolve=>candidate.server.listen(0,'127.0.0.1',resolve));
const metadata={pid:process.pid,root,candidate:`http://127.0.0.1:${candidate.server.address().port}`,fixture,synthetic:true,scheduler:false};
let baseline;
if(process.argv[2]){
  const original=await import(pathToFileURL(path.join(path.resolve(process.argv[2]),'src/server.mjs')));
  const service=createService({dataDir:path.join(root,'baseline-data'),vaultDir:path.join(root,'baseline-vault')});
  const baselineFixture=seedParity(service);
  baseline=original.createApp({service,scheduler:false});
  await new Promise(resolve=>baseline.server.listen(0,'127.0.0.1',resolve));
  metadata.baseline=`http://127.0.0.1:${baseline.server.address().port}`;metadata.baselineFixture=baselineFixture;
}
fs.writeFileSync(path.join(parent,'parity-preview.json'),JSON.stringify(metadata,null,2));
console.log(JSON.stringify(metadata));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await candidate.close();if(baseline)await baseline.close();process.exit(0);});
