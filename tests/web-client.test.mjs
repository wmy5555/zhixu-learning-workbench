import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient, capturePayload, pendingPlan } from '../public/web/api.mjs';
import { markdown, safeLink } from '../public/web/markdown.mjs';
import { createApp } from '../src/server.mjs';

test('new web entry has no dependency on the previous frontend', async () => {
  const entry=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(entry,/src="\/web\/main.mjs"/);
  assert.doesNotMatch(entry,/(?:src|href)="\/(?:app.mjs|styles.css|theme.js|onboarding)/);
  for(const file of ['main.mjs','reader.mjs','ui.mjs','api.mjs','markdown.mjs']){
    const source=await readFile(new URL(`../public/web/${file}`,import.meta.url),'utf8');
    assert.doesNotMatch(source,/from\s+['"]\.\.\//);
    assert.doesNotMatch(source,/from\s+['"]\/(?:app|ui|api|onboarding)\.mjs/);
  }
});
test('capture never sends a dependent research choice without explicit AI intent',()=>{
  assert.deepEqual(capturePayload({body:'原文',process:false,research:true}),{items:[{title:'',body:'原文',platform:'',url:'',author:'',topic:''}],process:false,research:false});
  assert.equal(capturePayload({body:'原文',process:true,research:true}).research,true);
});
test('today prioritizes pending work and never treats completed tasks as remaining time',()=>{
  const plan=pendingPlan({budget:30,items:[{kind:'learn',state:'done',minutes:20},{kind:'review',state:'pending',minutes:6,title:'下一步'}]});
  assert.equal(plan.minutes,6);assert.equal(plan.first.title,'下一步');assert.equal(plan.items.length,1);
});
test('reader renders untrusted text without creating executable markup or remote assets',()=>{
  const value=markdown('# <script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:evil)\n\n![remote](https://example.com/private.png)\n\n**理解**\n\n```js\n<script>raw</script>\n```\n\n| 内容 | 说明 |\n| --- | --- |\n| <iframe> | 保留 |\n');
  assert.doesNotMatch(value.html,/<script|<img|<iframe|href="javascript:/);
  assert.match(value.html,/&lt;script&gt;/);assert.match(value.html,/<strong>理解<\/strong>/);
  assert.equal(value.headings.length,1);assert.equal(safeLink('javascript:alert(1)'),'');
  assert.match(value.html,/<table>/);assert.match(value.html,/<pre><code>/);
});
test('conversation envelopes are expanded once without rewriting code examples',()=>{
  const value=markdown('```text\n## 一段回答\n\n正文\n\n~~~js\nconst a = 1;\n~~~\n```',{conversation:true});
  assert.equal(value.headings[0].title,'一段回答');assert.match(value.html,/<pre><code>const a = 1;/);
});
test('client does not replay writes on an unknown network outcome or persist CSRF',async()=>{
  let writes=0;
  const client=createClient(async (url,options)=>{
    if(url==='/api/session')return {ok:true,json:async()=>({csrf:'synthetic-session'})};
    writes++;assert.equal(options.headers['X-CSRF-Token'],'synthetic-session');throw new Error('connection lost');
  });
  await assert.rejects(client.post('/api/import',{items:[]}),/connection lost/);assert.equal(writes,1);
  await assert.rejects(client.get('https://example.com/api/notes'),/本机/);
});
test('new client completes capture, retrieval, manual knowledge, learning and conflict-safe editing',async()=>{
  const root=path.resolve('.tmp');await mkdir(root,{recursive:true});const dir=await mkdtemp(path.join(root,'web-client-'));
  const app=createApp({dataDir:dir,vaultDir:path.join(dir,'vault'),scheduler:false});
  try {
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${app.server.address().port}`;let cookie='';
    const client=createClient(async(url,options)=>{const response=await fetch(origin+url,{...options,headers:{...options.headers,...(cookie?{Cookie:cookie}:{})}});const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return response;});
    const saved=await client.post('/api/import',capturePayload({title:'合成前端契约',body:'## 我的经验\n\n用一个自己的例子，说明一次理解。'}));
    const source=saved.notes[0];assert.ok(source.id);assert.equal(saved.jobs.length,0);
    const read=await client.get(`/api/notes/${source.id}`);assert.equal(read.body,source.body);
    const search=await client.get('/api/search?q='+encodeURIComponent('合成前端契约')+'&mode=keyword');assert.ok(search.results.some(item=>item.id===source.id));
    const note=await client.post(`/api/notes/${source.id}/extract`,{title:'我的合成经验',body:'我会先解释，再回到原文核对。',topic:'阅读',reason:'试着解释自己的经验',depth:'explain',claimType:'opinion'});
    await client.post(`/api/notes/${note.id}/promote`,{stage:'learning',depth:'explain',reason:'希望练习自己的表达'});
    const session=await client.post('/api/study/start',{noteId:note.id,requestId:'synthetic-start'});
    const answered=await client.post(`/api/study/${session.id}/answer`,{answer:'先离开材料解释，再核对原文，能发现没有想清楚的部分。',hintUsed:false,requestId:'synthetic-answer'});
    assert.equal(answered.turns.length,1);assert.equal(answered.status,'awaiting_feedback');
    const retry=await client.post(`/api/study/${session.id}/answer`,{answer:'不应重复保存',hintUsed:false,requestId:'synthetic-answer'});assert.equal(retry.turns.length,1);
    await client.put(`/api/notes/${source.id}`,{body:'## 已修订\n\n人工修改仍然保留。',expectedHash:read.hash});
    await assert.rejects(client.put(`/api/notes/${source.id}`,{body:'过期修改',expectedHash:read.hash}),error=>error.code==='CONFLICT');
    const final=await client.get(`/api/notes/${source.id}`);assert.match(final.body,/人工修改仍然保留/);
    const file=new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')],'synthetic.png',{type:'image/png'});
    const uploadId=crypto.randomUUID();
    const upload=await client.upload(file,uploadId);assert.equal(upload.id,uploadId);
    const imported=await client.post('/api/file-import',{uploadId});assert.equal(imported.note.meta.sourceFile.kind,'image');
    const duplicate=await client.post('/api/file-import',{uploadId});assert.equal(duplicate.note.id,imported.note.id);
  } finally {await app.close();assert.ok(dir.startsWith(root+path.sep));await rm(dir,{recursive:true,force:true});}
});
