import test from 'node:test';
import assert from 'node:assert/strict';
import { createLibraryPreferences } from '../public/web/library-preferences.mjs';
import { createParity } from '../public/web/parity.mjs';
function memory(initial) { let value=initial; return {getItem:()=>value,setItem:(_,v)=>{value=v;}}; }
test('all library choices survive recreation and explicit clearing',()=>{
  const storage=memory(); const first=createLibraryPreferences(()=>storage);
  const chosen={q:'MCP <test>',kind:'knowledge',stage:'learning',grouped:true,optionsOpen:true,adviceOpen:true};
  first.update(chosen); assert.deepEqual(createLibraryPreferences(()=>storage).read(),chosen);
  first.update({q:'',kind:'',stage:'',grouped:false,optionsOpen:false,adviceOpen:false});
  assert.deepEqual(createLibraryPreferences(()=>storage).read(),{q:'',kind:'',stage:'',grouped:false,optionsOpen:false,adviceOpen:false});
});
test('corrupt or outdated saved preferences recover safely',()=>{
  for(const input of ['{bad','null','[]',JSON.stringify({kind:'unknown',stage:'invalid',q:23,grouped:'false',optionsOpen:1})]) {
    assert.deepEqual(createLibraryPreferences(()=>memory(input)).read(),{q:'',kind:'',stage:'',grouped:false,optionsOpen:false,adviceOpen:false});
  }
});
test('blocked browser storage retains navigation preferences in memory',()=>{
  const preferences=createLibraryPreferences(()=>{throw Error('blocked');});
  preferences.update({q:'query',kind:'source',optionsOpen:true});
  assert.equal(preferences.read().q,'query'); assert.equal(preferences.read().optionsOpen,true);
});
test('real library binding saves user events and restores controls on navigation and reload',async()=>{
  const previousDocument=globalThis.document,previousStorage=globalThis.localStorage;
  const storage=memory(); globalThis.localStorage=storage;
  const parity=()=>createParity({api:{get:async()=>({groups:[],standalone:[]})},state:{},noteCard:()=>''});
  function node(value='') { return {value,checked:false,open:false,isConnected:true,events:{},addEventListener(n,fn){this.events[n]=fn;},setAttribute(n,v){this[n]=v;},querySelector(){return null;}}; }
  const query=node(),kind=node(),stage=node(),group=node(),options=node(),advice=node(),host=node(),button=node(); button.dataset={kind:'knowledge'};
  const controls={'[name="libraryQuery"]':query,'[name="libraryKind"]':kind,'[name="libraryStage"]':stage,'[name="sourceGroups"]':group,'[data-library-options]':options,'[data-library-advice]':advice,'#parity-library':host};
  globalThis.document={querySelector:s=>controls[s],querySelectorAll:()=>[button]};
  try {
    const client=parity();(await client.library()).bind();
    button.onclick();assert.equal(button['aria-pressed'],'true');
    query.value='"<MCP>';query.events.input();stage.value='candidate';stage.events.input();group.checked=true;group.events.input();options.open=true;options.events.toggle();advice.open=true;advice.events.toggle();
    for(const clientAfterNavigation of [client,parity()]){
      const html=(await clientAfterNavigation.library()).html;
      assert.match(html,/data-kind="knowledge" aria-pressed="true"/);
      assert.match(html,/value="&quot;&lt;MCP&gt;"/);
      assert.match(html,/<option value="candidate" selected>/);
      assert.match(html,/name="sourceGroups" checked/);
      assert.match(html,/<details data-library-options class="quiet-details" open/);
      assert.match(html,/<details data-library-advice class="quiet-details" open/);
    }
    options.open=false;options.events.toggle();group.checked=false;group.events.input();
    assert.doesNotMatch((await parity().library()).html,/name="sourceGroups" checked/);
    assert.doesNotMatch((await parity().library()).html,/<details data-library-options class="quiet-details" open/);
  } finally {globalThis.document=previousDocument;globalThis.localStorage=previousStorage;}
});
