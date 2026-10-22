import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.argv[2]),meta=JSON.parse(fs.readFileSync(process.argv[4],'utf8'));
assert.equal(meta.synthetic,true);
const out=path.resolve('../evidence/focus-dial');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.argv[3],headless:true}),checks=[],errors=[];
try{
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:900}});
  await context.addInitScript(()=>{window.dialAnimations=[];const animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){if(this.matches('.dial-hand,.focus-setup'))window.dialAnimations.push({hand:this.matches('.dial-hand'),frames,options});return animate.call(this,frames,options);};});
  const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(10000);
  await p.goto(meta.candidate+'/#today');await p.locator('[data-action="focus-start"]').click();await p.waitForTimeout(450);
  const input=p.locator('#focus-minutes'),dial=p.locator('.focus-dial'),box=await dial.boundingBox();
  const move=async angle=>{const a=angle*Math.PI/180;await p.mouse.move(box.x+box.width/2+Math.sin(a)*box.width*.33,box.y+box.height/2-Math.cos(a)*box.height*.33);};
  await move(300);await p.mouse.down();
  for(let angle=308;angle<700.8;angle+=8)await move(angle);await move(700.8);
  await p.mouse.up();assert.equal(await input.inputValue(),'58');
  const snap=await p.evaluate(()=>window.dialAnimations.filter(x=>x.hand));assert.equal(snap.length,1);assert.equal(snap[0].frames.length,4);
  await p.waitForTimeout(400);
  const colors=await dial.locator('[data-dial-ring]').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).stroke));assert.notEqual(colors[0],colors[1]);
  assert.equal(await dial.getAttribute('aria-valuenow'),'58');
  await p.screenshot({path:path.join(out,`dial-two-laps-${width}.png`)});
  if(width===1440){await p.evaluate(()=>document.documentElement.classList.add('dark'));await p.waitForTimeout(500);await p.screenshot({path:path.join(out,'dial-dark.png')});await p.evaluate(()=>document.documentElement.classList.remove('dark'));await p.waitForTimeout(500);}
  await move(336);await p.mouse.down();await move(312);await p.mouse.up();assert.equal(await input.inputValue(),'56');
  await dial.press('ArrowRight');assert.equal(await input.inputValue(),'57');
  await input.fill('120');await input.press('Tab');assert.equal(await dial.getAttribute('aria-valuenow'),'120');
  await dial.press('ArrowUp');assert.equal(await input.inputValue(),'120');
  await input.fill('1');await input.press('Tab');await dial.press('ArrowDown');assert.equal(await input.inputValue(),'1');
  await input.fill('58');await input.press('Tab');
  await p.locator('#focus-start-form [type="submit"]').click();
  await p.locator('.focus-setup').waitFor({state:'detached'});
  const stored=await p.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('zhixu-focus-v1')))));
  assert.equal(stored.active.durationMs,58*60000);
  const returns=await p.evaluate(()=>window.dialAnimations.filter(x=>!x.hand&&x.options?.duration===420));assert.equal(returns.length,1);assert.match(returns[0].frames[1].transform,/translate.*scale/);
  checks.push(`${width}px: multi-turn accumulation, distinct ring colors, minute spring snap, reverse drag, keyboard/bounds and animated start persist 58 minutes`);
  await context.close();
 }
 const context=await browser.newContext({reducedMotion:'reduce'}),p=await context.newPage();
 await p.goto(meta.candidate+'/#today');await p.locator('[data-action="focus-start"]').click();
 await p.locator('.focus-dial').press('ArrowRight');await p.locator('#focus-start-form [type="submit"]').click();await p.locator('.focus-setup').waitFor({state:'detached'});
 assert.equal(await p.locator('.focus-clock').evaluate(n=>n.getAnimations().length),0);
 checks.push('reduced-motion start completes without scaling animation');
 await context.close();assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,errors,syntheticRoot:meta.root,at:new Date().toISOString()},null,2));console.log(JSON.stringify({checks,errors}));
}finally{await browser.close();}
