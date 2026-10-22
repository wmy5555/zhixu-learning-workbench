import test from 'node:test';
import assert from 'node:assert/strict';
import {installInputModality} from '../public/web/input-modality.mjs';
import {details} from '../public/web/parity.mjs';
test('pointer, keyboard and programmatic focus retain the right focus-ring modality',()=>{
  const root={dataset:{}},handlers=new Map();
  const events={addEventListener:(type,handler,capture)=>{assert.equal(capture,true);handlers.set(type,handler);},removeEventListener:(type,handler,capture)=>{assert.equal(capture,true);assert.equal(handlers.get(type),handler);handlers.delete(type);}};
  const cleanup=installInputModality(root,events);
  assert.equal(root.dataset.inputModality,'pointer');
  handlers.get('keydown')({key:'Tab'});assert.equal(root.dataset.inputModality,'keyboard');
  handlers.get('pointerdown')({pointerType:'mouse'});assert.equal(root.dataset.inputModality,'pointer');
  for(const key of ['Shift','Control','Meta','Alt'])handlers.get('keydown')({key});
  handlers.get('keydown')({key:'k',ctrlKey:true});handlers.get('keydown')({key:'Process',isComposing:true});
  assert.equal(root.dataset.inputModality,'pointer');
  handlers.get('keydown')({key:'ArrowDown'});assert.equal(root.dataset.inputModality,'keyboard');
  handlers.get('pointerdown')({pointerType:'touch'});assert.equal(root.dataset.inputModality,'pointer');
  cleanup();assert.equal(handlers.size,0);assert.equal(root.dataset.inputModality,undefined);
});
test('shared disclosures retain native semantics, escaped labels and a smooth content region',()=>{
  const html=details('筛选 <test>','<input name="q">',true);
  assert.match(html,/<details class="quiet-details" open>/);
  assert.match(html,/<summary>筛选 &lt;test&gt;<\/summary>/);
  assert.match(html,/<div class="disclosure-body"><input name="q"><\/div>/);
  assert.doesNotMatch(details('闭合','正文'),/class="quiet-details" open/);
});
