// Runs the actual web application against a newly created, offline demonstration space.
// It never reuses environment-provided data/vault paths or the formal 4318 port.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createService } from '../src/service.mjs';
import { createApp } from '../src/server.mjs';
import { discoverySeeds } from '../public/web/discovery-content.mjs';

const scratchParent=path.resolve(import.meta.dirname,'../.tmp');
const bodyHash=body=>createHash('sha256').update(body).digest('hex');
const isolationError=message=>Object.assign(new Error(message),{code:'PREVIEW_OFFLINE',status:403});

function offlineAI(){
  const blocked=()=>{throw isolationError('隔离预览已关闭所有外部服务，不会发送资料或调用模型。');};
  return Object.freeze({
    generate:blocked,model:blocked,embed:blocked,research:blocked,researchBatch:blocked,
    test:blocked,discoverModels:blocked,
    getCallEvidence:()=>[],
    withPurpose:(_purpose,operation)=>operation(),
    withBudget:(_budget,operation)=>operation(),
    withCallContext:(_context,operation)=>operation(),
  });
}

export function seedLearningFeed(service,seeds=discoverySeeds){
  service.updateSettings({timezone:'Asia/Singapore',dailyMinutes:45,
    ai:{enabled:false},embedding:{enabled:false},search:{enabled:false},fetch:{enabled:false},
    mcp:{enabled:false,allowProposals:false,chatgptEnabled:false,chatgptAllowRead:false}});
  const knowledge=[],sources=[],topics=new Map(),timestamp=new Date().toISOString();
  for(const seed of seeds){
    const source=service.importItems({items:[{title:`演示资料 · ${seed.title}`,body:seed.body,
      platform:'隔离预览 · 自编教学材料',author:'知序演示',topic:seed.topic,privacy:'local'}]}).notes[0];
    const note=service.store.create({kind:'knowledge',title:seed.title,body:seed.body,meta:{
      stage:'learning',depth:'explain',claimType:'fact',userStructured:true,privacy:'local',topic:seed.topic,
      researchLimitations:['这是独立编写的预览教学材料，未经过知序联网加工核验。'],
      discoveryPreview:true,discoveryKey:seed.key,referenceLinks:seed.sources,
      sources:[{id:source.id,role:'input',rationale:'由公开参考资料独立编写的隔离预览短文'}],
      discovery:{version:1,sourceHash:bodyHash(seed.body),cards:seed.cards},
    }});
    sources.push(source.id);knowledge.push(note.id);
    if(!topics.has(seed.topic))topics.set(seed.topic,[]);topics.get(seed.topic).push(note.id);
  }
  const topicIds=[];
  for(const [title,noteIds] of topics){
    const topic=service.createTopic({title,body:`隔离预览学习包：${title}。材料与练习均为演示，不代表真实学习结果。`,noteIds,minutes:15});
    topicIds.push(topic.id);
    // A due time is fixture scheduling data, not a fabricated successful study session.
    service.store.put('reviews',noteIds[0],{noteId:noteIds[0],dueAt:new Date(Date.parse(timestamp)-86400000).toISOString(),interval:1,preview:true});
  }
  for(const id of knowledge){
    const note=service.getNote(id),sourceHash=bodyHash(note.body);
    if(note.meta.discovery.sourceHash!==sourceHash)service.store.update(id,{expectedHash:note.hash,meta:{discovery:{...note.meta.discovery,sourceHash}}});
  }
  service.today();
  return {knowledgeIds:knowledge,sourceIds:sources,topicIds};
}

function listen(server,port){
  return new Promise((resolve,reject)=>{
    const error=err=>{server.off('listening',ready);reject(err);};
    const ready=()=>{server.off('error',error);resolve();};
    server.once('error',error);server.once('listening',ready);server.listen(port,'127.0.0.1');
  });
}

export async function createLearningFeedPreview({port=4362,seeds=discoverySeeds}={}){
  if(process.env.NODE_ENV==='production')throw isolationError('学习发现预览不能在 production 模式运行。');
  if(!Number.isSafeInteger(port)||port<0||port>65535||port===4318)throw isolationError('请选择隔离预览端口；正式 4318 禁止使用。');
  fs.mkdirSync(scratchParent,{recursive:true});
  const root=fs.mkdtempSync(path.join(scratchParent,'learning-feed-preview-'));
  const dataDir=path.join(root,'data'),vaultDir=path.join(root,'vault');
  const service=createService({dataDir,vaultDir,aiOverride:offlineAI()});
  const fixture=seedLearningFeed(service,seeds);
  const updateSettings=service.updateSettings,bootstrap=service.bootstrap;
  service.updateSettings=input=>{
    if(Object.keys(input||{}).some(key=>['dataDir','vaultDir','ai','embedding','search','fetch','mcp','apiKey','clearKey'].includes(key)))throw isolationError('隔离预览不能更改资料目录、连接凭据或外部能力。');
    return updateSettings(input);
  };
  service.bootstrap=()=>({...bootstrap(),preview:{isolated:true,synthetic:true,externalCalls:false,
    kind:'learning-feed',label:'隔离预览 · 演示资料',scheduler:false}});
  const app=createApp({service,dataDir,vaultDir,scheduler:false});
  try{await listen(app.server,port);}
  catch(error){if(error.code==='EADDRINUSE'&&port!==0){try{await listen(app.server,0);}catch(retry){await app.close();throw retry;}}else{await app.close();throw error;}}
  const actualPort=app.server.address().port;
  const url=`http://127.0.0.1:${actualPort}`;
  let closed=false;
  return {app,service,root,dataDir,vaultDir,fixture,url,port:actualPort,
    async close(){if(closed)return;closed=true;await app.close();}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const port=process.env.LEARNING_FEED_PREVIEW_PORT===undefined?4362:Number(process.env.LEARNING_FEED_PREVIEW_PORT);
  const preview=await createLearningFeedPreview({port});
  const metadata={pid:process.pid,root:preview.root,url:`${preview.url}/#discover`,
    flow:`${preview.url}/#discover/flow`,synthetic:true,scheduler:false,externalCalls:false,fixture:preview.fixture};
  fs.writeFileSync(path.join(scratchParent,'learning-feed-preview.json'),JSON.stringify(metadata,null,2));
  console.log(`LEARNING_FEED_PREVIEW_READY ${JSON.stringify(metadata)}`);
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await preview.close();process.exit(0);});
}
