import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { previewMetadata, evidenceDirectory } from '../scripts/preview-context.mjs';

const root=path.resolve(import.meta.dirname,'..'), temp=path.join(root,'.tmp');
fs.mkdirSync(temp,{recursive:true});
function removePreview(meta) {
  const dir=path.resolve(meta.root);
  assert.equal(path.dirname(dir),temp);
  assert.ok(path.basename(dir).startsWith('parity-preview-'));
  assert.equal(meta.metadataFile,path.join(dir,'preview.json'));
  assert.ok(!fs.lstatSync(dir).isSymbolicLink());
  fs.rmSync(dir,{recursive:true,force:true});
}
function start(baseline) {
  const child=spawn(process.execPath,['scripts/parity-preview.mjs',...(baseline?[baseline]:[])],{cwd:root,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';
  const ready=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('预览启动超时: '+stderr)),20000);
    child.stdout.on('data',chunk=>{stdout+=chunk;const line=stdout.split('\n')[0];try{const m=JSON.parse(line);clearTimeout(timer);resolve(m);}catch{}});
    child.stderr.on('data',chunk=>{stderr+=chunk;});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);reject(Error('预览退出 '+code+': '+stderr));});
  });
  return {child,ready};
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited=once(child,'exit');child.kill('SIGTERM');await exited;
}
async function bootstrap(base) {
  const session=await fetch(base+'/api/session'),cookie=session.headers.get('set-cookie').split(';')[0];
  const response=await fetch(base+'/api/bootstrap',{headers:{cookie}});assert.equal(response.status,200);return response.json();
}

test('parallel previews retain separate owners, evidence, and the baseline service', {timeout:45000}, async t=>{
  const dir=fs.mkdtempSync(path.join(temp,'preview-baseline-'));fs.mkdirSync(path.join(dir,'src'));
  const service=pathToFileURL(path.join(root,'src/service.mjs')).href,server=pathToFileURL(path.join(root,'src/server.mjs')).href;
  fs.writeFileSync(path.join(dir,'src/service.mjs'),`import {createService as original} from ${JSON.stringify(service)}; export function createService(options){const service=original(options),before=service.bootstrap;service.bootstrap=()=>({...before(),baselineMarker:'baseline-only'});return service;}`);
  fs.writeFileSync(path.join(dir,'src/server.mjs'),`export {createApp} from ${JSON.stringify(server)};`);
  const first=start(dir),second=start();let a,b;
  t.after(async()=>{await Promise.all([stop(first.child),stop(second.child)]);for(const m of [a,b])if(m)removePreview(m);fs.rmSync(dir,{recursive:true,force:true});});
  [a,b]=await Promise.all([first.ready,second.ready]);
  assert.notEqual(a.root,b.root);assert.notEqual(a.metadataFile,b.metadataFile);assert.notEqual(a.candidate,b.candidate);
  assert.equal((await previewMetadata(a.metadataFile)).candidate,a.candidate);assert.equal((await previewMetadata(b.metadataFile)).candidate,b.candidate);
  await assert.rejects(previewMetadata(),/数量不是一个/);
  await assert.rejects(previewMetadata(path.join(temp,'parity-preview.json')),/数量不是一个/);
  assert.notEqual(evidenceDirectory(a,'same'),evidenceDirectory(b,'same'));
  assert.notEqual(evidenceDirectory(a,'same'),evidenceDirectory(a,'same'));
  const forged={...a,proof:'0'.repeat(48)},file=path.join(a.root,'preview.json');fs.writeFileSync(file,JSON.stringify(forged));
  await assert.rejects(previewMetadata(file));fs.writeFileSync(file,JSON.stringify(a));
  const switched={...a,candidate:a.baseline,baseline:a.candidate};fs.writeFileSync(file,JSON.stringify(switched));
  await assert.rejects(previewMetadata(file));fs.writeFileSync(file,JSON.stringify(a));
  let probes=0,redirects=0;
  const probe=createServer((request,response)=>{probes++;if(request.url==='/redirect-target'){redirects++;response.end('unexpected');return;}response.writeHead(302,{location:'/redirect-target'});response.end();});
  await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
  try {
    const candidate='http://127.0.0.1:'+probe.address().port;
    fs.writeFileSync(b.metadataFile,JSON.stringify({...b,candidate}));
    await assert.rejects(previewMetadata(),/数量不是一个/);
    assert.equal(probes,0,'ambiguity must be determined before probing any candidate');
    assert.equal((await previewMetadata(a.metadataFile)).candidate,a.candidate);
    await assert.rejects(previewMetadata(b.metadataFile));
    assert.equal(probes,1);assert.equal(redirects,0,'identity checks must not follow redirects');
  } finally {fs.writeFileSync(b.metadataFile,JSON.stringify(b));await new Promise(resolve=>probe.close(resolve));}
  assert.equal((await bootstrap(a.candidate)).baselineMarker,undefined);
  assert.equal((await bootstrap(a.baseline)).baselineMarker,'baseline-only');
  await stop(first.child);
  await assert.rejects(fetch(a.candidate+'/api/session'));
  assert.equal((await previewMetadata(b.metadataFile)).candidate,b.candidate);
});

test('failed baseline startup closes the already started candidate', {timeout:30000}, async t=>{
  const dir=fs.mkdtempSync(path.join(temp,'preview-failure-'));fs.mkdirSync(path.join(dir,'src'));
  fs.writeFileSync(path.join(dir,'src/service.mjs'),"export function createService(){throw Error('synthetic baseline failure')}\n");
  fs.writeFileSync(path.join(dir,'src/server.mjs'),"export function createApp(){}\n");
  const run=start(dir);t.after(async()=>{await stop(run.child);fs.rmSync(dir,{recursive:true,force:true});});
  await assert.rejects(run.ready,/synthetic baseline failure/);
  assert.notEqual(run.child.exitCode,0);
});

test('metadata outside the preview directory is rejected before reading', async t=>{
  const dir=fs.mkdtempSync(path.join(temp,'preview-path-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'preview.json');fs.writeFileSync(file,'not JSON');
  await assert.rejects(previewMetadata(file),/预览信息路径无效/);
});

test('browser initialization failures close each launched browser', {timeout:45000}, async t=>{
  const dir=fs.mkdtempSync(path.join(temp,'preview-browser-failure-'));
  const mock=path.join(dir,'playwright.cjs'), marker=path.join(dir,'closed');
  fs.writeFileSync(mock, `const fs=require('node:fs');
const fail=stage=>{if(process.env.PREVIEW_FAIL_STAGE===stage)throw Error('synthetic '+stage);};
exports.chromium={launch:async()=>({close:async()=>fs.writeFileSync(process.env.PREVIEW_CLOSE_MARKER,'closed'),
newContext:async()=>{fail('context');return {newPage:async()=>{fail('page');return {setDefaultTimeout(){},on(){},screenshot:async()=>{},evaluate:async()=>({})};},
addInitScript:async()=>{},route:async()=>{fail('route');}};}})};`);
  const run=start();let meta;
  t.after(async()=>{await stop(run.child);if(meta)removePreview(meta);fs.rmSync(dir,{recursive:true,force:true});});
  meta=await run.ready;
  const scripts=['parity-boundaries','parity-browser','parity-detail-visuals','parity-focus-browser','parity-workflows','focus-refinements-browser'];
  for(const script of scripts) for(const stage of ['context','page',...(['parity-boundaries','parity-browser','parity-workflows'].includes(script)?['route']:[])]) {
    fs.rmSync(marker,{force:true});
    const child=spawn(process.execPath,[`scripts/${script}.mjs`,mock,'unused',meta.metadataFile],{cwd:root,stdio:['ignore','ignore','pipe'],env:{...process.env,PREVIEW_FAIL_STAGE:stage,PREVIEW_CLOSE_MARKER:marker}});
    let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
    const [code]=await once(child,'exit');
    assert.notEqual(code,0,`${script} ${stage} must fail`);
    assert.match(stderr,new RegExp(`synthetic ${stage}`),`${script} must retain the initialization error`);
    assert.equal(fs.readFileSync(marker,'utf8'),'closed',`${script} ${stage} must close the browser`);
  }
});
