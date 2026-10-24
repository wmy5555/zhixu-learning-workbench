import fs from 'node:fs';
import path from 'node:path';
const before=process.argv.includes('--before');
const { createApp } = await import(before?'../.tmp/baseline/src/server.mjs':'../src/server.mjs');

// Dedicated, synthetic-only preview. Never reuse the application's data paths.
const root = path.resolve(import.meta.dirname, '../.tmp');
fs.mkdirSync(root, {recursive:true});
const directory = fs.mkdtempSync(path.join(root, 'visual-preview-'));
const source = {
  id:'11111111-1111-4111-8111-111111111111', kind:'source',
  title:'为什么重读很熟悉，合上书却说不清？',
  body:'读完一页书，句句都懂。合上书，却很难把刚才的意思重新讲出来。熟悉一句话，与能够独立解释它，是两件不同的事。\n\n重读时，文字一直在眼前，替我们提供了线索。尝试回忆时，才会发现哪些联系还没有建立。与其马上再读一遍，不妨先写下自己记得的三个要点。\n\n再回到原文，把遗漏和误解标出来。保留第一次回答，才能看见理解到底发生了什么变化。\n\n下一次阅读，试着带上一个问题：如果要用自己的生活举例，我会怎么解释？',
  meta:{topic:'学习方法',platform:'视觉验收合成资料',stage:'reference'}
};
const longSource={...source,id:'22222222-2222-4222-8222-222222222222',title:'把一次阅读，变成可以再次使用的理解',body:'## 留下来源\n\n记录原文和出处，让每个判断都有可以回看的起点。摘录不必立即变成结论。\n\n## 写出解释\n\n用自己的例子重新解释。哪里讲不清，就回到那里。保留最初的回答，不用修订后的结果覆盖它。\n\n## 检验与修正\n\n隔一段时间再尝试回忆，比较两次解释。记住一个答案，不等于已经知道它在什么条件下成立。\n\n'+('把观点放回具体情境，观察它的适用范围。一次修正也是理解的一部分。\n\n').repeat(12)};
const apps=[];
for (const [port,rich] of before?[[4356,false],[4358,true]]:[[4357,false],[4359,true]]) {
  const dataDir=path.join(directory,String(port),'data');
  const app=createApp({dataDir,vaultDir:path.join(directory,String(port),'vault'),scheduler:false});
  app.service.store.create(source);
  if(rich){
    app.service.store.create(longSource);
    app.service.store.create({id:'33333333-3333-4333-8333-333333333333',kind:'knowledge',title:'先尝试回忆，再核对原文',body:'尝试回忆让缺口显现。回到来源时，把缺失的条件和错误的解释分别记录。',meta:{topic:'学习方法',stage:'learning',claimType:'opinion',sources:[{id:longSource.id,role:'input'}]}});
    app.service.store.create({id:'44444444-4444-4444-8444-444444444444',kind:'knowledge',title:'把观点放回它成立的条件里',body:'阅读时记录适用条件，应用时检查情境是否相同。',meta:{topic:'阅读札记',stage:'candidate',claimType:'opinion'}});
  }
  app.server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({port,scenario:rich?'rich':'sparse',directory})));
  app.server.on('error',error=>{console.error(error);process.exitCode=1;});
  apps.push(app);
}
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{for(const app of apps)await app.close();process.exit(0);});
