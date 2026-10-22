// Isolated component regression; no application server or real browser storage.
// Usage: node scripts/focus-next-browser.mjs <installed-playwright-path> <chrome-path>
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const {chromium}=createRequire(import.meta.url)(process.argv[2]||'playwright');
const root=new URL('../public/',import.meta.url);
const server=createServer(async(req,res)=>{
  try{
    if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<div class="topbar"><div class="top-actions"></div></div><div id="budget-summary"></div><div id="focus-home"></div>');return;}
    const file=new URL('.'+req.url,root);if(!file.href.startsWith(root.href)){res.writeHead(403).end();return;}
    res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(file));
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({executablePath:process.argv[3]||undefined,headless:true});
  for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async()=>{
      const {createFocus}=await import('/web/focus.mjs');
      const {freshClock,transition}=await import('/web/focus-model.mjs');
      const storageName='zhixu-focus-v1-focus-regression',now=Date.now();
      let clock=transition(freshClock(),{type:'start',kind:'break',minutes:5,id:'synthetic-break'},now-300001);
      clock=transition(clock,{type:'tick'},now);clock.active.pendingNotice=false;
      localStorage.setItem(storageName,JSON.stringify(clock));
      window.focusUnderTest=createFocus({state:{route:'today',boot:{settings:{vaultDir:'focus-regression'}}},go(){}});
      document.addEventListener('click',event=>{const control=event.target.closest('[data-action]');if(control)window.focusUnderTest.handle(control).catch(error=>{throw error;});});
      window.focusUnderTest.mount();
    });
    await page.getByRole('button',{name:'再专注 25 分钟',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-clock-status]')?.textContent==='专注计时中');
    assert.equal(await page.locator('#focus-start-form').count(),0,'next focus must not open setup');
    const clock=await page.evaluate(()=>JSON.parse(localStorage.getItem('zhixu-focus-v1-focus-regression')));
    assert.equal(clock.active.kind,'focus');assert.equal(clock.active.status,'running');assert.equal(clock.active.durationMs,25*60000);
    assert.equal(clock.records.length,1);assert.equal(clock.records[0].id,'synthetic-break');
    await page.getByRole('button',{name:'暂停',exact:true}).click();
    await page.getByRole('button',{name:'继续',exact:true}).waitFor();
    await page.getByRole('button',{name:'继续',exact:true}).click();
    await page.getByRole('button',{name:'暂停',exact:true}).waitFor();
    await page.evaluate(async()=>{
      await window.focusUnderTest.handle({dataset:{action:'focus-next'}});
      window.focusUnderTest.close();localStorage.clear();document.querySelector('#focus-home').replaceChildren();
      window.focusUnderTest=(await import('/web/focus.mjs')).createFocus({state:{route:'today',boot:{settings:{vaultDir:'focus-regression'}}},go(){}});
      await window.focusUnderTest.handle({dataset:{action:'focus-start'}});
    });
    await page.locator('#focus-start-form').waitFor();
    await page.locator('#focus-start-form [name="minutes"]').fill('37');
    await page.locator('#focus-start-form [type="submit"]').click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('zhixu-focus-v1-focus-regression'))?.active?.durationMs===37*60000);
    assert.deepEqual(errors,[]);await page.evaluate(()=>window.focusUnderTest.close());await context.close();
    console.log(`PASS ${width}px: break → direct 25-minute focus, pause/resume, stale click, initial custom 37-minute setup`);
  }
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
