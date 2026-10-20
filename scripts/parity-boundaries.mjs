// Synthetic-only browser checks. Capability responses are deliberately mocked.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)(process.argv[2]||'playwright');
const meta=JSON.parse(fs.readFileSync('.tmp/parity-preview.json','utf8'));assert.equal(meta.synthetic,true);
const browser=await chromium.launch({executablePath:process.argv[3],headless:true});
const context=await browser.newContext({reducedMotion:'reduce'}),page=await context.newPage(),checks=[],external=[],errors=[];
page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
await context.route('**/*',route=>{if(!route.request().url().startsWith(meta.candidate)){external.push(route.request().url());return route.abort();}return route.continue();});
const api=(url,method='get',body)=>page.evaluate(async({url,method,body})=>{const{api}=await import('/web/api.mjs');return api[method](url,body);},{url,method,body});
async function open(route){await page.waitForFunction(()=>!document.querySelector('[aria-busy="true"]'));await page.goto(meta.candidate+'/#'+route);await page.waitForFunction(r=>document.querySelector('#main')?.dataset.route===r,route);}
const check=name=>{checks.push(name);console.log('PASS '+name);};
try{
  await open('manage');
  const tests=[],saves=[];let mode='success';
  await page.route('**/api/settings/test',async route=>{
    const input=route.request().postDataJSON();tests.push(input);
    if(mode==='stale')await page.locator('[data-capability="embedding"] [name="model"]').evaluate(input=>{input.value='changed-during-test';input.dispatchEvent(new Event('input',{bubbles:true}));});
    await route.fulfill({status:mode==='failure'?503:200,json:mode==='failure'?{error:'合成测试失败'}:{receipt:'synthetic-receipt',message:'模拟测试通过，配置已保存。'}});
  });
  await page.route('**/api/settings/save-tested',route=>{saves.push(route.request().postDataJSON());return route.fulfill({json:{saved:true}});});
  for(const key of ['embedding','search','fetch']){
    const form=page.locator(`[data-capability="${key}"]`);await form.locator('..').locator('summary').click();
    await form.locator('[data-test]').click();await page.locator('[data-confirm]').click();
    await form.locator('[data-status]').getByText('模拟测试通过，配置已保存。',{exact:true}).waitFor();
  }
  assert.deepEqual(tests.map(x=>x.capability),['embedding','search','fetch']);assert.equal(saves.length,3);
  assert.deepEqual(saves.map(x=>x.receipt),Array(3).fill('synthetic-receipt'));
  const embed=page.locator('[data-capability="embedding"]');
  mode='stale';await embed.locator('[data-test]').click();await page.locator('[data-confirm]').click();
  await embed.getByText('测试期间配置已改变，请重新测试。',{exact:true}).waitFor();assert.equal(saves.length,3);
  mode='failure';await embed.locator('[data-test]').click();await page.locator('[data-confirm]').click();
  await page.locator('#toast.error').getByText('合成测试失败',{exact:true}).waitFor();
  assert.equal(await embed.locator('[name="model"]').inputValue(),'changed-during-test');assert.equal(saves.length,3);
  await page.locator('[data-route="manage/usage"]').click();await page.locator('[data-cancel]').click();
  assert.equal(await page.locator('#main').getAttribute('data-route'),'manage');
  check('MOCK: each capability uses its own receipt; stale/failed tests retain input and cannot save');
  await page.locator('[data-route="manage/usage"]').click();await page.locator('[data-confirm]').click();
  await page.locator('#usage-filter').waitFor();await page.locator('#usage-filter [name="period"]').selectOption('7d');
  await page.locator('#usage-filter [type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('[aria-busy="true"]'));
  const download=page.waitForEvent('download');await page.locator('[data-action="export-usage"]').click();
  assert.match((await download).suggestedFilename(),/\.csv$/);
  check('usage filters and explicitly scoped CSV export work without an AI call');
  await open('jobs');await page.locator('[name="jobFilter"]').selectOption('waiting');
  const cancel=page.locator('[data-action="cancel-job"]').first();const jobId=await cancel.getAttribute('data-id');
  await cancel.click();await page.locator('[data-confirm]').click();
  await page.waitForFunction(()=>!document.querySelector('[aria-busy="true"]'));
  assert.equal((await api('/api/jobs')).jobs.find(j=>j.id===jobId).state,'cancelled');
  check('a waiting synthetic job cancels through the real API and remains in history');
  await open('today');
  const more=page.locator('[data-action="plan-more"]').first();const planId=await more.getAttribute('data-id');
  await more.click();await page.locator('[data-action="plan-action"][data-value="skip"]').click();
  await page.getByText('今日暂时跳过的安排',{exact:true}).click();
  await page.locator(`[data-action="plan-action"][data-id="${planId}"][data-value="resume"]`).click();
  await page.locator(`[data-action="plan-more"][data-id="${planId}"]`).click();
  await page.locator('[data-action="plan-action"][data-value="pause"]').click();
  await page.getByText('暂停的知识',{exact:true}).click();
  await page.locator('[data-action="resume-note"]').first().click();
  await page.locator(`[data-action="plan-more"][data-id="${planId}"]`).waitFor();
  assert.equal((await api('/api/today')).items.find(i=>i.id===planId).state,'pending');
  check('today skip, resume, pause and resume return the same plan item to pending');
  await open('manage/restore');const backup=await api('/api/backup');
  const file={name:'synthetic-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))};
  await page.locator('#restore-form input').setInputFiles(file);await page.locator('#restore-form [type="submit"]').click();
  await page.locator('[data-action="restore-confirm"]').waitFor();
  await page.locator('#restore-form input').setInputFiles({...file,name:'changed-backup.json'});
  assert.equal(await page.locator('[data-action="restore-confirm"]').count(),0);
  await page.locator('#restore-form input').setInputFiles({...file,buffer:Buffer.from('{broken')});
  await page.locator('#restore-form [type="submit"]').click();await page.locator('#toast.error').waitFor();
  assert.equal(await page.locator('[data-action="restore-confirm"]').count(),0);
  check('changing backup files invalidates the preview; malformed JSON cannot restore');
  await open('read/synthetic-mistake');await page.locator('[data-action="mistake-state"]').click();
  await page.locator('dialog [name="action"]').selectOption('revoke');
  await page.locator('dialog [name="reason"]').fill('合成验收：撤销仍保留理由和原记录。');
  await page.locator('dialog [type="submit"]').click();await page.locator('dialog[open]').waitFor({state:'hidden'});
  const mistake=await api('/api/notes/synthetic-mistake');assert.equal(mistake.meta.correctionState,'revoked');
  assert.match(mistake.body,/revoke：合成验收/);assert.match(mistake.body,/原回答/);
  check('mistake revocation keeps the original answer and appends the user reason');
  await open('history');await page.route('**/api/study?*',route=>route.fulfill({status:503,json:{error:'合成历史读取失败'}}));
  await page.reload();await page.getByText('本次未读到记录，已有历史仍保留。',{exact:true}).waitFor();
  await page.unroute('**/api/study?*');await page.locator('[data-action="reload"]').click();
  await page.locator('#full-study-history article').first().waitFor();
  check('history load failures provide a retry and recover without deleting stored sessions');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  fs.writeFileSync(path.resolve('.tmp/parity-evidence/boundary-results.json'),JSON.stringify({checks,errors,externalRequests:external,syntheticRoot:meta.root,at:new Date().toISOString()},null,2));
}catch(error){await page.screenshot({path:'.tmp/parity-evidence/boundary-failure.png',fullPage:true});throw error;}
finally{await browser.close();}
