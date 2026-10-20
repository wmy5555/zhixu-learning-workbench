import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.argv[2]);
const meta=JSON.parse(fs.readFileSync(process.argv[4],'utf8'));assert.equal(meta.synthetic,true);
const out=path.resolve('../evidence/focus-expiry');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.argv[3],headless:true}),checks=[];
async function expire(p){await p.evaluate(()=>{const k=Object.keys(localStorage).find(k=>k.startsWith('zhixu-focus-v1'));const s=JSON.parse(localStorage.getItem(k));s.active.startedAt=Date.now()-s.active.durationMs-1000;localStorage.setItem(k,JSON.stringify(s));});}
try{
 for(const reduced of [false,true]){
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:reduced?'reduce':'no-preference'});
  await context.addInitScript(()=>{
    window.expiryAnimations=[];
    const original=Element.prototype.animate;
    Element.prototype.animate=function(frames,options){
      if(this.matches('.focus-face > svg,.focus-expiry-ripple'))window.expiryAnimations.push({ring:this.matches('svg'),frames,options,parentAnimating:this.closest('.focus-clock').getAnimations().some(a=>a.playState==='running')});
      return original.call(this,frames,options);
    };
  });
  const p=await context.newPage();await p.goto(meta.candidate+'/#today');
  await p.locator('[data-action="focus-start"]').click();await p.locator('#focus-start-form [type="submit"]').click();await p.locator('#focus-home .focus-clock').waitFor();
  await p.goto(meta.candidate+'/#library');await p.locator('.focus-mini').waitFor();
  await expire(p);await p.locator('[data-action="focus-break"]').waitFor();
  if(!reduced){
    await p.waitForFunction(()=>window.expiryAnimations.length===2);
    const data=await p.evaluate(()=>window.expiryAnimations);
    assert.ok(data.every(a=>!a.parentAnimating),'ring cue must wait for popup expansion');
    assert.ok(data[0].ring);assert.match(JSON.stringify(data[0].frames),/scale\(\.94\)/);
    assert.equal(data[1].ring,false);assert.equal(data[1].options.delay,190);
    await p.waitForTimeout(430);await p.screenshot({path:path.join(out,'expiry-ripple.png')});
    await p.waitForTimeout(1700);assert.equal(await p.locator('.focus-expiry-ripple').count(),0);
    assert.equal((await p.evaluate(()=>window.expiryAnimations)).length,2);
    await p.reload();await p.locator('[data-action="focus-break"]').waitFor();await p.waitForTimeout(1100);
    assert.deepEqual(await p.evaluate(()=>window.expiryAnimations),[]);
    checks.push('expiry waits for expansion, contracts ring then emits one wave, cleans up, and never replays on refresh');
  }else{
    await p.waitForTimeout(1300);assert.deepEqual(await p.evaluate(()=>window.expiryAnimations),[]);
    assert.equal(await p.locator('.focus-expiry-ripple').count(),0);
    checks.push('reduced motion retains expiry controls and text without contraction or ripple');
  }
  await context.close();
 }
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,at:new Date().toISOString(),syntheticRoot:meta.root},null,2));
 console.log(JSON.stringify({checks}));
}finally{await browser.close();}
