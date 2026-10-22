import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/web/main.mjs',import.meta.url),'utf8');
const action=source.slice(source.indexOf('async function actions(control) {'),source.indexOf("\ndocument.addEventListener('click'"));
function harness({enabled=false,checked=false,changed=false,otherDirty=false,accept=true,failSave=false,failTest=false}={}){
 const calls=[],result={textContent:''},form={dataset:{},inert:false,elements:{enabled:{checked}},values:{baseUrl:'https://example.invalid/v1',model:'synthetic',apiKey:'',dailyCallLimit:'100'}};
 const connectionValues=f=>JSON.stringify(f.values);form.dataset.connectionValues=connectionValues(form);if(changed)form.values.model='unsaved';
 const other={dataset:{dirty:String(otherDirty)}};
 const state={saving:0,dirty:!checked||changed||otherDirty,boot:{settings:{ai:{enabled}}}};
 const context={state,aiConnectionValues:connectionValues,$:s=>s==='#ai-form'?form:result,$$:()=>[form,other],notify:(...args)=>calls.push(['notice',...args]),savedForm:f=>{f.dataset.dirty='false';state.dirty=otherDirty;},refreshBoot:async()=>{calls.push(['refresh']);state.boot.settings.ai.enabled=true;},confirm:async()=>{calls.push(['confirm',form.elements.enabled.checked]);return accept;},api:{put:async(...args)=>{calls.push(['put',...args]);if(failSave)throw Error('save failed');},post:async(...args)=>{calls.push(['post',...args]);if(failTest)throw Error('test failed');return {message:'synthetic result'};}}};
 vm.createContext(context);vm.runInContext(action+';this.run=()=>actions({dataset:{action:"test-ai"},closest:()=>null});',context);
 return {run:context.run,state,form,calls,result};
}
test('disabled saved AI is checked immediately, enabled only after consent, then tested',async()=>{
 const h=harness();await h.run();assert.equal(h.form.elements.enabled.checked,true);
 assert.deepEqual(h.calls.map(c=>c[0]),['confirm','put','refresh','post','notice']);assert.equal(h.calls[0][1],true);
 assert.equal(JSON.stringify(h.calls[1].slice(1)),JSON.stringify(['/api/settings',{ai:{enabled:true}}]));
 assert.equal(JSON.stringify(h.calls[3].slice(1)),JSON.stringify(['/api/settings/test',{capability:'model'}]));
 assert.equal(h.result.textContent,'synthetic result');assert.equal(h.state.dirty,false);assert.equal(h.state.saving,0);assert.equal(h.form.inert,false);
});
test('cancel keeps checkbox checked and unsaved, sends no request',async()=>{const h=harness({accept:false});await h.run();assert.deepEqual(h.calls.map(c=>c[0]),['confirm']);assert.equal(h.form.elements.enabled.checked,true);assert.equal(h.state.dirty,true);assert.equal(h.form.inert,false);assert.equal(h.state.saving,0);});
for(const checked of [true,false])test(`already enabled saved connection tests without saving; checkbox initially ${checked}`,async()=>{const h=harness({enabled:true,checked});await h.run();assert.equal(h.form.elements.enabled.checked,true);assert.deepEqual(h.calls.map(c=>c[0]),['confirm','post','notice']);assert.equal(h.state.dirty,false);});
for(const options of [{changed:true},{otherDirty:true}])test(`unsaved configuration remains blocked ${JSON.stringify(options)}`,async()=>{const h=harness(options);await h.run();assert.equal(h.form.elements.enabled.checked,true);assert.deepEqual(h.calls.map(c=>c[0]),['notice']);assert.equal(h.state.dirty,true);});
test('failed enabling never submits a test and releases busy state',async()=>{const h=harness({failSave:true});await assert.rejects(h.run(),/save failed/);assert.deepEqual(h.calls.map(c=>c[0]),['confirm','put']);assert.equal(h.state.dirty,true);assert.equal(h.state.saving,0);assert.equal(h.form.inert,false);});
test('failed test preserves successful enabling and allows retry without another settings write',async()=>{const h=harness({failTest:true});await assert.rejects(h.run(),/test failed/);assert.equal(h.state.boot.settings.ai.enabled,true);assert.equal(h.state.dirty,false);assert.equal(h.state.saving,0);assert.equal(h.form.inert,false);h.calls.length=0;await assert.rejects(h.run(),/test failed/);assert.deepEqual(h.calls.map(c=>c[0]),['confirm','post']);});
test('an operation in progress does not open another confirmation or submit requests',async()=>{const h=harness();h.state.saving=1;await h.run();assert.deepEqual(h.calls,[]);});
