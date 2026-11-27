import test from 'node:test';
import assert from 'node:assert/strict';
import {installInputModality} from '../public/web/input-modality.mjs';
import {details, paginate} from '../public/web/ui.mjs';
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


test('shared pagination retains filtering, page bounds and reset', () => {
  let filter = () => true;
  const buttons = { previous: {}, next: {} };
  const host = { innerHTML: '', querySelector(selector) { return buttons[selector.includes('previous') ? 'previous' : 'next']; } };
  const reset = paginate(host, ['甲', '乙', '丙'], value => `<p>${value}</p>`, { size: 2, filter: value => filter(value) });
  assert.match(host.innerHTML, /甲.*乙/);
  assert.match(host.innerHTML, /1 \/ 2 · 共 3 条/);
  buttons.next.onclick();
  assert.match(host.innerHTML, /丙/);
  assert.match(host.innerHTML, /2 \/ 2 · 共 3 条/);
  filter = value => value === '甲';
  reset();
  assert.match(host.innerHTML, /1 \/ 1 · 共 1 条/);
  filter = () => false;
  reset();
  assert.match(host.innerHTML, /没有符合条件的记录/);
  assert.match(host.innerHTML, /1 \/ 1 · 共 0 条/);
});
