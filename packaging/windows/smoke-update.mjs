import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const [baseExe,updateExe,output]=process.argv.slice(2).map(p=>path.resolve(p));
const root=path.join(output,'smoke-'+Date.now()),data=path.join(root,'合成资料'),status=path.join(root,'launcher.json'),updateStatus=path.join(root,'update-status.json');
fs.mkdirSync(root,{recursive:true});
const exe=path.join(root,'知序.exe');fs.copyFileSync(baseExe,exe);
const env={...process.env};for(const key of Object.keys(env))if(key.toLowerCase()==='path')delete env[key];
env.Path=process.env.SystemRoot+'\\System32;'+process.env.SystemRoot+'\\System32\\WindowsPowerShell\\v1.0';
env.NODE_OPTIONS='--invalid-option-must-be-cleared';env.LEARNING_DATA_DIR=path.join(root,'must-not-use');env.PORT='4318';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let proc,base,cookie,csrf;
async function start(){
 fs.rmSync(status,{force:true});proc=spawn(exe,['--data-dir',data,'--no-browser','--status-file',status],{cwd:root,env,windowsHide:true,stdio:'ignore'});
 for(let n=0;n<600;n++){
  if(fs.existsSync(status)){const receipt=JSON.parse(fs.readFileSync(status));if(receipt.state==='ready'){base=receipt.url;return receipt;}if(receipt.state==='failed')throw Error(fs.readFileSync(status+'.error.txt','utf8'));}
  if(proc.exitCode!==null)throw Error('Launcher exited '+proc.exitCode);await sleep(100);
 }
 throw Error('Launcher startup timed out');
}
async function session(){const r=await fetch(base+'/api/session');cookie=r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');csrf=(await r.json()).csrf;}
async function api(p,body,method=body?'POST':'GET'){const r=await fetch(base+p,{method,headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();assert.equal(r.status,200,JSON.stringify(v));return v;}
async function update(){
 const started=performance.now();const child=spawn(updateExe,['--data-dir',data,'--yes','--status-file',updateStatus],{env,windowsHide:true,stdio:'ignore'});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 return {code,ms:Math.round(performance.now()-started),...JSON.parse(fs.readFileSync(updateStatus))};
}
async function stop(){if(proc?.exitCode===null){execFileSync(exe,['--data-dir',data,'--stop'],{env,windowsHide:true});for(let i=0;i<200&&proc.exitCode===null;i++)await sleep(100);assert.equal(proc.exitCode,0);}}
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
try{
 const initial=await start();assert.notEqual(new URL(base).port,'4318');await session();
 const vault=path.join(data,'自定义知识库');await api('/api/settings',{vaultDir:vault,ai:{enabled:false,baseUrl:'https://example.invalid/v1',model:'synthetic-update',apiKey:'synthetic-offline-key-no-provider'}},'PUT');
 const body='这是增量升级的合成资料，验证更新后原文、设置和凭据保留。';
 await api('/api/import',{captureMode:'text',process:false,research:false,items:[{title:'更新前的合成资料',body}]});
 const note=(await api('/api/notes')).notes[0];
 const tokens=['mcp-token','chatgpt-mcp-token'].map(n=>[n,hash(path.join(data,n))]);
 const app=path.join(data,'.app','versions',initial.payloadSha256.slice(0,20));
 // Corrupt baseline must be rejected while the running original remains available.
 const file=path.join(app,'public/web/main.mjs'),original=fs.readFileSync(file);fs.appendFileSync(file,'\n// synthetic corruption');
 const refused=await update();assert.equal(refused.code,1);assert.match(refused.message,/程序文件已改变/);assert.equal(proc.exitCode,null);
 fs.writeFileSync(file,original);
 const result=await update();assert.equal(result.code,0,JSON.stringify(result));assert.equal(result.state,'updated');
 for(let i=0;i<100&&proc.exitCode===null;i++)await sleep(50);assert.equal(proc.exitCode,0);
 assert.equal(JSON.parse(fs.readFileSync(path.join(result.rollback,'package-manifest.json'))).sourceSha,'ba8cb1ebbab19f26b30670050be9020e3009efbb');
 const changed=await start();await session();
 const restored=await api('/api/notes/'+note.id);assert.equal(restored.body,body);assert.equal(restored.title,'更新前的合成资料');
 const settings=await api('/api/settings');assert.equal(settings.ai.model,'synthetic-update');assert.equal(settings.ai.hasKey,true);assert.equal(settings.vaultDir.toLowerCase(),vault.toLowerCase());
 for(const [name,digest]of tokens)assert.equal(hash(path.join(data,name)),digest);
 const res=await fetch(base+'/web/software-update.mjs');assert.equal(res.status,200);assert.match(await res.text(),/2026\.10\.23\.1/);
 const second=await update();assert.equal(second.state,'already-current');assert.equal(proc.exitCode,null);
 assert.ok(!fs.existsSync(path.join(root,'must-not-use')));
 const summary={status:'passed',updateMilliseconds:result.ms,checks:['no-system-node','baseline-corruption-refused-before-stop','graceful-running-app-stop','full-target-hashes','old-program-rollback-retained','original-exe-reopens-upgraded-version','note-preserved','custom-vault-preserved','encrypted-key-preserved','mcp-tokens-preserved','idempotent-update'],url:base,root,app,version:result.version};
 fs.writeFileSync(path.join(output,'smoke-test-result.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
 if(process.argv.includes('--keep-running')){console.log('Isolated upgraded instance remains running for browser verification.');await new Promise(resolve=>proc.once('exit',resolve));}else await stop();
}catch(error){try{await stop();}catch{}throw error;}
