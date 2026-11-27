// Explicit synthetic preview, with one metadata and evidence directory per process.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createService} from '../src/service.mjs';
import {createApp} from '../src/server.mjs';
import {seedParity} from '../tests/fixtures/web-parity.mjs';

const parent=path.resolve(import.meta.dirname,'../.tmp');
fs.mkdirSync(parent,{recursive:true});
const root=fs.mkdtempSync(path.join(parent,'parity-preview-'));
const metadataFile=path.join(root,'preview.json');
const proof=randomBytes(24).toString('hex');
const owned=[];
let closing;
async function close() {
  if (closing) return closing;
  closing=(async()=>{
    const failures=[];
    for (const item of owned.reverse()) try { await (item.app ? item.app.close() : item.service.close()); } catch (error) { failures.push(error); }
    try { fs.rmSync(metadataFile, {force:true}); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, '预览清理未完成');
  })();
  return closing;
}
for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{close().then(()=>process.exit(0),error=>{console.error(error);process.exit(1);});});
async function start(createService, createApp, name) {
  const dataDir=path.join(root,name+'-data'),vaultDir=path.join(root,name+'-vault');
  const service=createService({dataDir,vaultDir});
  const item={service};owned.push(item);
  const fixture=seedParity(service);
  const app=createApp({service,dataDir,scheduler:false});item.app=app;
  const handlers=app.server.listeners('request');
  app.server.removeAllListeners('request');
  app.server.on('request',(request,response)=>{
    if(request.method==='GET' && request.url==='/__zhixu_preview/'+proof+'/'+name){response.writeHead(200,{'content-type':'text/plain','cache-control':'no-store'});response.end(proof+':'+name);return;}
    for(const handler of handlers)handler.call(app.server,request,response);
  });
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',()=>{app.server.off('error',reject);resolve();});});
  return {url:`http://127.0.0.1:${app.server.address().port}`,fixture};
}
try {
  const candidate=await start(createService,createApp,'candidate');
  const metadata={pid:process.pid,root,metadataFile,proof,candidate:candidate.url,fixture:candidate.fixture,synthetic:true,scheduler:false};
  if(process.argv[2]){
    const baselineRoot=path.resolve(process.argv[2]);
    const [service,server]=await Promise.all(['src/service.mjs','src/server.mjs'].map(file=>import(pathToFileURL(path.join(baselineRoot,file)).href)));
    const baseline=await start(service.createService,server.createApp,'baseline');
    metadata.baseline=baseline.url;metadata.baselineFixture=baseline.fixture;
  }
  fs.writeFileSync(metadataFile,JSON.stringify(metadata,null,2),{flag:'wx'});
  console.log(JSON.stringify(metadata));
} catch(error) {
  try { await close(); } catch(cleanup) { console.error(cleanup); }
  throw error;
}
