import { previewMetadata, evidenceDirectory } from './preview-context.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)(process.argv[2]||'playwright');
const meta=await previewMetadata(process.argv[4]);
const out=evidenceDirectory(meta,'parity-detail-visuals');
const browser=await chromium.launch({executablePath:process.argv[3],headless:true});
try{
const context=await browser.newContext({reducedMotion:'reduce'}),page=await context.newPage(),checks=[];
page.setDefaultTimeout(12000);
async function open(base,route){await page.goto(base+'/?visual='+Date.now()+'#'+route);await page.waitForFunction(()=>!document.querySelector('.page-loading'));await page.evaluate(()=>document.fonts.ready);}
async function shot(name){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name);await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});}
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===1440?1000:844});
  for(const [version,base,fixture] of [['baseline',meta.baseline,meta.baselineFixture],['candidate',meta.candidate,meta.fixture]]){
   await open(base,'study/synthetic-history-00');await shot(`${version}-completed-study-${width}`);
   await open(base,'topics');await page.locator(`[data-action="open-topic"][data-id="${fixture.topicId}"]`).click();
   await page.locator('dialog[open]').waitFor();await shot(`${version}-topic-detail-${width}`);
   await page.locator('[data-modal-close]').click();
  }
  await open(meta.candidate,'library');assert.doesNotMatch(await page.locator('#parity-library').innerText(),/zhixu-managed-links/);await shot(`candidate-library-${width}`);
  await open(meta.candidate,'read/'+meta.fixture.sourceId);await page.locator('[data-action="reader-actions"]').click();await page.locator('[data-action="metadata"]').click();
  await page.locator('dialog form').waitFor();await shot(`candidate-metadata-${width}`);
  await page.locator('[data-modal-close]').click();
  checks.push(`completed learning and topic before/after, library and metadata at ${width}px`);
 }
 await page.setViewportSize({width:1440,height:1000});await open(meta.candidate,'library');await page.locator('#theme').click();await shot('candidate-library-dark-1440');
 fs.writeFileSync(path.join(out,'detail-visual-results.json'),JSON.stringify({checks,at:new Date().toISOString(),syntheticRoot:meta.root},null,2));
 console.log(checks.join('\n'));
}finally{await browser.close();}
