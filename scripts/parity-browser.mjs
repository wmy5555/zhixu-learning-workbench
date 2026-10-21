// Run against scripts/parity-preview.mjs only, with an already-installed Playwright.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.argv[2]||'playwright');
const meta=JSON.parse(fs.readFileSync(path.resolve('.tmp/parity-preview.json'),'utf8'));
assert.equal(meta.synthetic,true);
const out=path.resolve('.tmp/parity-evidence');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.argv[3]||undefined,headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const page=await context.newPage(),errors=[],network=[];
page.on('pageerror',err=>errors.push(err.message));
await context.route('**/*',route=>{if(!route.request().url().startsWith('http://127.0.0.1:')&&!route.request().url().startsWith('data:')){network.push(route.request().url());return route.abort();}return route.continue();});
async function open(base,route){
  await page.goto(base+'/?parity-check='+Date.now()+'#'+route);await page.locator('#main').waitFor();
  if(base===meta.baseline)await page.waitForFunction(()=>!document.querySelector('.page-loading'));
  else await page.waitForFunction(r=>document.querySelector('#main')?.dataset.route===r,route);
  const failure=await page.getByText('这次没有顺利打开',{exact:true}).count();assert.equal(failure,0,route+': '+await page.locator('#main').innerText());
  await page.evaluate(()=>document.fonts.ready);
}
const checks=[],check=(name)=>{checks.push(name);console.log('PASS '+name);};
try{
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:width===1440?1000:844});
    for(const [version,base,fixture] of [['baseline',meta.baseline,meta.baselineFixture],['candidate',meta.candidate,meta.fixture]]){
      for(const route of ['today','capture','library','study','topics','search','output','settings',`read/${fixture.knowledgeIds[0]}`]){
        await open(base,route);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${version} ${route} overflow at ${width}`);
        await page.screenshot({path:path.join(out,`${version}-${route.split('/')[0]}-${width}.png`),fullPage:true});
      }
    }
    for(const route of ['relations','history','jobs','manage','manage/usage','manage/prompts','manage/maintenance','manage/restore','focus']){
      await open(meta.candidate,route);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${route} overflow at ${width}`);
      await page.screenshot({path:path.join(out,`candidate-${route.replace('/','-')}-${width}.png`),fullPage:true});
    }
  }
  check('18 routes rendered at desktop and narrow widths without overflow');
  await page.setViewportSize({width:1440,height:1000});
  await open(meta.candidate,'today');
  await page.locator('[data-action="focus-start"]').click();
  await page.locator('#focus-start-form [name="minutes"]').fill('1');
  await page.locator('#focus-start-form [type="submit"]').click();
  await page.locator('#focus-home .focus-clock').waitFor();
  await page.screenshot({path:path.join(out,'candidate-focus-home-1440.png')});
  await page.locator('#sidebar [data-route="library"]').click();
  await page.locator('.focus-mini').waitFor();
  await page.screenshot({path:path.join(out,'candidate-focus-docked-1440.png')});
  await page.locator('.focus-square').click();await page.locator('[data-action="focus-pause"]').click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('zhixu-focus-v1')))).active.status==='paused');
  let clock=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('zhixu-focus-v1')))));
  assert.equal(clock.active.status,'paused');const paused=clock.active.elapsedMs;
  await page.reload();await page.waitForFunction(()=>!document.querySelector('.page-loading'));
  await page.locator('.focus-square').click();
  await page.locator('[data-action="focus-resume"]').click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('zhixu-focus-v1')))).active.status==='running');
  await page.evaluate(()=>{
    const key=Object.keys(localStorage).find(k=>k.startsWith('zhixu-focus-v1')),data=JSON.parse(localStorage.getItem(key));
    data.active.startedAt=Date.now()-65000;localStorage.setItem(key,JSON.stringify(data));
  });
  await page.getByText('本轮已到时间。',{exact:true}).waitFor();
  await page.screenshot({path:path.join(out,'candidate-focus-expired-1440.png')});
  clock=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('zhixu-focus-v1')))));
  assert.equal(clock.records.length,1);assert.equal(clock.records[0].durationMs,60000);assert.equal(clock.active.pendingNotice,false);
  await page.reload();await page.waitForFunction(()=>!document.querySelector('.page-loading'));
  clock=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('zhixu-focus-v1')))));
  assert.equal(clock.records.length,1);assert.equal(clock.active.pendingNotice,false);assert.ok(paused<60000);
  check('timer cross-route, pause/resume, reload and background expiry records once');
  await page.locator('[data-action="focus-dismiss"]').click();
  await open(meta.candidate,`study/${meta.fixture.sessionId}`);
  await page.locator('[data-action="hide-material"]').click();
  await page.locator('[data-action="hint"]').click();
  await page.getByText('这次使用了提示',{exact:true}).waitFor();
  await page.reload();await page.waitForFunction(()=>!document.querySelector('.page-loading'));
  await page.locator('[data-action="hide-material"]').click();
  await page.locator('#answer-form textarea').fill('合成回答：观点应保留出处与边界。');
  const answer=page.waitForRequest(r=>r.url().endsWith('/answer')&&r.method()==='POST');
  await page.locator('#answer-form [type="submit"]').click();
  assert.equal((await answer).postDataJSON().hintUsed,true);
  await page.getByText('你的回答已保存',{exact:true}).waitFor();
  check('hint state survives reload and the actual answer POST carries true');
  await open(meta.candidate,'history');
  await page.locator('[data-action="history-next"]').click();
  await page.locator('[data-action="history-prev"]:not([disabled])').waitFor();
  await page.locator('[data-action="history-next"]').click();
  await page.locator('[data-action="history-next"]').click();
  check('full history pages beyond 50 records are reachable');
  await open(meta.candidate,'jobs');await page.locator('[data-page="next"]').click();await page.locator('[data-page="next"]').click();
  assert.match(await page.locator('#parity-jobs').innerText(),/3 \/ 3/);
  await open(meta.candidate,'output');await page.locator('[data-page="next"]').click();assert.match(await page.locator('#all-drafts').innerText(),/2 \/ 2/);
  check('all jobs and drafts reachable through pagination');
  await open(meta.candidate,'manage');
  assert.equal(await page.locator('.accent-preview').count(),0);
  for(const [input,seed] of [['preset','#58746a'],['code','#68758a'],['picker','#846a80']]){
    if(input==='preset')await page.getByRole('button',{name:`预览 ${seed}`,exact:true}).click();
    else await page.locator(`[name="${input}"]`).fill(seed);
    const preview=await page.locator('#accent-form [type="submit"]').evaluate(el=>({color:el.style.getPropertyValue('--accent-preview'),ink:el.style.getPropertyValue('--accent-preview-ink')}));
    assert.match(preview.color,/^#[0-9a-f]{6}$/i);assert.match(preview.ink,/^#(?:000000|ffffff)$/);
    assert.equal(await page.locator('[name="code"]').inputValue(),seed);
    assert.equal(await page.locator('[name="picker"]').inputValue(),seed);
  }
  await page.locator('[name="code"]').fill('#123456');
  await page.locator('#sidebar [data-route="library"]').click();
  await page.getByRole('dialog',{name:'放弃还没保存的输入？'}).waitFor();
  await page.locator('[data-cancel]').click();assert.ok(page.url().endsWith('#manage'));
  await page.locator('#accent-form [type="submit"]').click();
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.customAccent),'true');
  await page.locator('[data-action="accent-default"]').click();
  assert.equal(await page.evaluate(()=>document.documentElement.hasAttribute('data-custom-accent')),false);
  check('unsaved guard and custom accent reset preserve default theme');
  await page.locator('#theme').click();
  for(const route of ['today','library','manage','focus']){
    await open(meta.candidate,route);
    await page.screenshot({path:path.join(out,`candidate-${route}-dark-1440.png`),fullPage:true});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
  fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({checks,errors,externalRequests:network,metadata:meta,at:new Date().toISOString()},null,2));
}finally{await browser.close();}
