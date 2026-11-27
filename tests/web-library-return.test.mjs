import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
import {createClient, endpoint, pendingPlan} from '../public/web/api.mjs';
import {createLibraryPage} from '../public/web/library-page.mjs';
import {createStudyWorkspace} from '../public/web/study-workspace.mjs';
import {createReaderData, sameReaderData} from '../public/web/reader-data.mjs';
import {reader, updateReader} from '../public/web/reader.mjs';
import {busy, list} from '../public/web/ui.mjs';
const source=fs.readFileSync(new URL('../public/web/main.mjs',import.meta.url),'utf8');
const root = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
function declaration(name) {
 const declaration = root.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === name);
 return source.slice(declaration.start, declaration.end);
}
const navigation = ['createBootstrapLoader', 'refreshBoot', 'go', 'readPage', 'actions', 'processSource'].map(declaration).join('\n');

function harness(api){
 const counts={library:0,bind:0,loading:0},context={version:0,revision:0};
 const main={dataset:{},childNodes:[],style:{},focus(){},set innerHTML(value){if(value.includes('page-loading'))counts.loading++;this.childNodes=[{html:value}];},replaceChildren(...nodes){this.childNodes=nodes;}};
 const state={boot:{notes:[]},readerReturn:'library',route:'today',sequence:0,dirty:false,saving:0,scroll:new Map()},window={scrollY:0,scrollTo({top}){this.scrollY=top;},dispatchEvent(){}};
 const page=async()=>({html:'reader'});
 const sandbox={state,window,document:{documentElement:{classList:{toggle(){},remove(){}}}},history:{pushState(){},replaceState(){}},matchMedia:()=>({matches:true}),CustomEvent:class{},api:{getContext:()=>context,get:async()=>({})},onboarding:{travelling:false,prepareRoute:async()=>{}},focus:{capture(){},mount(){}},study:{leave(){},page},shell(){},$:()=>main,$$:()=>[],notify(){},confirm:async()=>true,empty:(_title,message)=>{throw Error(message);},btn(){},link(){},springEnter(){},parity:{},management:{},readPage:page};
 Object.assign(sandbox, { reader, updateReader, sameReaderData, list, endpoint, busy });
 if (api) sandbox.api = api;
 else sandbox.api.get = async url => {
   if (url === '/api/bootstrap') return { notes: [] };
   if (url === '/api/relations') return { relations: [] };
   const id = url.split('/').at(-1);
   return { id, kind:'source', title:'合成标题 '+id, body:'阅读回归正文 '+id, meta:{}, hash:id };
 };
 sandbox.readerData=createReaderData(sandbox.api);
 sandbox.library=createLibraryPage(sandbox.api);
 sandbox.library.page=async()=>{counts.library++;return {html:'library',bind(){counts.bind++;}};};
 sandbox.search={page};
 for(const name of ['todayPage','capturePage','editPage','topicsPage','outputPage','settingsPage'])sandbox[name]=page;
 vm.createContext(sandbox);
 vm.runInContext(navigation+';const bootstrap=createBootstrapLoader(api,state);globalThis.goPage=go;globalThis.refresh=refreshBoot;globalThis.act=actions;globalThis.process=processSource;',sandbox);
 return {sandbox,counts,context,main,window};
}
test('returning from a reader restores the same library nodes without requests, loading screen or rebinding',async()=>{
 const h=harness();await h.sandbox.goPage('library');const nodes=h.main.childNodes;nodes[0].filter='saved query';nodes[0].expanded=true;h.window.scrollY=320;
 assert.equal(await h.sandbox.goPage('read/one'),true);
 assert.match(h.main.childNodes[0].html,/阅读回归正文 one/);assert.equal(h.sandbox.state.note.id,'one');
 const loading=h.counts.loading;await h.sandbox.goPage('library');
 assert.equal(h.counts.library,1);assert.equal(h.counts.bind,1);assert.equal(h.counts.loading,loading);assert.equal(h.main.childNodes[0],nodes[0]);assert.equal(h.main.childNodes[0].filter,'saved query');assert.equal(h.main.childNodes[0].expanded,true);assert.equal(h.window.scrollY,320);
});
test('successful writes, space changes and explicit refresh invalidate the library snapshot',async()=>{
 const h=harness();await h.sandbox.goPage('library');await h.sandbox.goPage('read/one');h.context.revision++;await h.sandbox.goPage('library');assert.equal(h.counts.library,2);
 await h.sandbox.goPage('read/one');h.context.version++;await h.sandbox.goPage('library');assert.equal(h.counts.library,3);
 await h.sandbox.refresh();await h.sandbox.goPage('library');assert.equal(h.counts.library,4);
});
test('two independent defer actions keep the latest successful bootstrap regardless of response arrival', async t => {
 for (const secondFails of [false, true]) {
  await t.test(secondFails ? 'only the first bootstrap succeeds' : 'the newer bootstrap arrives first', async () => {
   const priorBody = Promise.withResolvers(), priorReady = Promise.withResolvers();
   const plans = ['a','b'].map(id => ({ id, state: 'pending' }));
   const requests = [];
   let bootReads = 0;
   const response = (data, status = 200) => ({
    ok: status === 200, status, json: typeof data === 'function' ? data : async () => data,
   });
   const api = createClient(async (path, { method = 'GET', body } = {}) => {
    requests.push([method,path]);
    if (path === '/api/session') return response({ csrf: 'synthetic' });
    if (method === 'POST') {
     assert.deepEqual(JSON.parse(body), { action: 'defer', days: 1 });
     const plan = plans.find(item => path === endpoint('today',item.id,'action'));
     assert.ok(plan);
     plan.state = 'defer';
     return response(plan);
    }
    assert.equal(path, '/api/bootstrap');
    const boot = { today: { items: structuredClone(plans) } };
    if (++bootReads === 1) {
     priorReady.resolve();
     return response(async () => { await priorBody.promise; return boot; });
    }
    return secondFails ? response({ error: '合成刷新失败' }, 500) : response(boot);
   });
   const { sandbox, main } = harness(api);
   const views = [];
   sandbox.todayPage = () => {
    const pending = pendingPlan(sandbox.state.boot.today).items.map(item => item.id).join(',');
    views.push(pending);
    return { html: '待学 ' + pending };
   };
   const a = { dataset: { action:'defer', id:'a' }, closest:() => null, setAttribute(){}, removeAttribute(){} };
   const b = { ...a, dataset: { action:'defer', id:'b' } };
   const first = busy(a, () => sandbox.act(a));
   await priorReady.promise;
   if (secondFails) await assert.rejects(sandbox.act(b), /合成刷新失败/);
   else await busy(b, () => sandbox.act(b));
   priorBody.resolve();
   await first;

   assert.deepEqual(plans.map(plan => plan.state), ['defer','defer']);
   assert.deepEqual(views, secondFails ? ['b'] : ['', '']);
   assert.equal(main.childNodes[0].html, secondFails ? '待学 b' : '待学 ');
   assert.deepEqual(requests.slice(1), [
    ['POST','/api/today/a/action'], ['GET','/api/bootstrap'],
    ['POST','/api/today/b/action'], ['GET','/api/bootstrap'],
   ]);
  });
 }
});
test('a response read in the prior knowledge space cannot publish before or after the current read', async () => {
 for (const currentFirst of [false, true]) {
  const { sandbox, context } = harness();
  const oldResult = Promise.withResolvers(), currentResult = Promise.withResolvers();
  sandbox.api.get = () => context.version === 0 ? oldResult.promise : currentResult.promise;
  const initial = sandbox.state.boot;
  const fromPriorSpace = sandbox.refresh();
  context.version++;
  const fromCurrentSpace = sandbox.refresh();
  const current = { notes: ['当前练习'] };
  if (currentFirst) {
   currentResult.resolve(current);
   assert.equal(await fromCurrentSpace, current);
  }
  oldResult.resolve({ notes: ['离开的知识空间'] });
  await fromPriorSpace;
  assert.equal(sandbox.state.boot, currentFirst ? current : initial);
  if (!currentFirst) {
   currentResult.resolve(current);
   assert.equal(await fromCurrentSpace, current);
  }
 }
});
test('processing publishes bootstrap only while the dialog is current and the reply is still valid', async t => {
 for (const condition of ['current dialog','closed dialog','newer refresh','changed space']) {
  await t.test(condition, async () => {
   const { sandbox, context } = harness();
   const older = { notes: ['加工状态快照'] }, latest = { notes: ['显式刷新快照'] };
   const oldRead = Promise.withResolvers(), proposals = Promise.withResolvers();
   const initial = sandbox.state.boot;
   let bootstrapReads = 0, shellUpdates = 0, invalidations = 0;
   const job = { id: 'job', state: 'done' };
   const start = { setAttribute(){}, removeAttribute(){} };
   const readError = {};
   const dialog = { open: true, isConnected: true, setAttribute(){},
    querySelector: selector => ({
     '[data-run]': start, '[data-process-error]': readError, h2: {},
     '.dialog-body': { contains: () => false }, input: { checked: false },
    })[selector],
   };
   Object.assign(sandbox, {
    modal: () => dialog, e: String, clearTimeout, processOutcome: () => ({ title:'合成完成' }),
    createProcessOutcomeRenderer: () => () => false, shell: () => { shellUpdates++; },
   });
   sandbox.library.invalidate = () => { invalidations++; };
   sandbox.api.post = async path => { assert.equal(path, '/api/notes/source/process'); return job; };
   sandbox.api.get = async path => {
    if (path === '/api/notes/source') return { title:'合成原文' };
    if (path === '/api/jobs?view=status') return { jobs:[job] };
    if (path === '/api/proposals') return proposals.promise;
    assert.equal(path, '/api/bootstrap');
    if (++bootstrapReads === 1) { oldRead.resolve(); return older; }
    return latest;
   };
   await sandbox.process('source');
   const work = start.onclick({ currentTarget: start });
   await oldRead.promise;
   if (condition === 'closed dialog') dialog.open = false;
   if (condition === 'newer refresh') await sandbox.refresh();
   if (condition === 'changed space') context.version++;
   proposals.resolve({ proposals: [] });
   await work;

   assert.equal(sandbox.state.boot, condition === 'current dialog' ? older : condition === 'newer refresh' ? latest : initial);
   assert.equal(shellUpdates, Number(condition === 'current dialog'));
   assert.equal(invalidations, Number(condition === 'newer refresh'));
   assert.equal(readError.textContent, undefined);
  });
 }
});
test('an in-flight library visit cannot repopulate the snapshot after a same-context refresh', async () => {
 for (const bootstrapFirst of [false, true]) {
  const { sandbox, context, main } = harness();
  const oldPage = Promise.withResolvers(), started = Promise.withResolvers(), bootstrap = Promise.withResolvers();
  let libraryLoads = 0;
  sandbox.library.page = () => {
   if (++libraryLoads > 1) return { html: '已刷新内容' };
   started.resolve();
   return oldPage.promise;
  };
  sandbox.api.get = path => {
   assert.equal(path, '/api/bootstrap');
   return bootstrap.promise;
  };
  const visiting = sandbox.goPage('library');
  await started.promise;
  const refresh = sandbox.refresh();
  if (bootstrapFirst) {
   bootstrap.resolve({});
   await refresh;
  }
  oldPage.resolve({ html: '刷新前内容' });
  await visiting;
  if (!bootstrapFirst) bootstrap.resolve({});
  await refresh;

  assert.deepEqual(context, { version: 0, revision: 0 });
  assert.equal(await sandbox.goPage('library', { replace: true }), true);
  assert.equal(main.childNodes[0].html, '已刷新内容');
  assert.equal(libraryLoads, 2);
 }
});
test('guide visits render a fresh library and superseded visits cannot cache another page',async()=>{
 const h=harness();await h.sandbox.goPage('library');const initial=h.main.childNodes[0];
 await h.sandbox.goPage('library',{guide:true});
 assert.notEqual(h.main.childNodes[0],initial);
 assert.equal(h.counts.library,2);
 const guideNode=h.main.childNodes[0];
 await h.sandbox.goPage('read/one');
 await h.sandbox.goPage('library');
 assert.equal(h.main.childNodes[0],guideNode);
 assert.equal(h.counts.library,2);

 const response=Promise.withResolvers(),started=Promise.withResolvers();
 await h.sandbox.refresh();
 h.sandbox.library.page=()=>{started.resolve();return response.promise;};
 const pending=h.sandbox.goPage('library');
 await started.promise;
 await h.sandbox.goPage('read/one');
 response.resolve({html:'outdated',bind(){assert.fail('superseded page bound');}});
 assert.equal(await pending,false);
 assert.match(h.main.childNodes[0].html,/reader/);
 assert.equal(h.sandbox.library.visit(true).nodes,null);
});

test('returning from editing the same reader preserves its actual origin, including after saving', async () => {
 for (const origin of ['library','history']) {
  const h=harness();
  if (origin === 'history') h.sandbox.parity.history=async()=>({html:'history'});
  await h.sandbox.goPage(origin); await h.sandbox.goPage('read/one');
  await h.sandbox.goPage('edit/one'); await h.sandbox.goPage('edit/one',{replace:true});
  h.context.revision++;
  assert.equal(await h.sandbox.goPage('read/one',{replace:true,force:true}),true);
  assert.equal(h.sandbox.state.readerReturn,origin);
  assert.match(h.main.childNodes[0].html,new RegExp('data-route="'+origin+'"'));
  assert.equal(await h.sandbox.goPage(h.sandbox.state.readerReturn),true);
  assert.equal(h.sandbox.state.route,origin);
 }
});

test('editor origin is never guessed for a bookmark, another note or a different space', async () => {
 for (const scenario of ['bookmark','different note','different space','unrelated visit']) {
  const h=harness();
  if(scenario !== 'bookmark'){await h.sandbox.goPage('library');await h.sandbox.goPage('read/one');}
  await h.sandbox.goPage('edit/one');
  if(scenario==='different space')h.context.version++;
  if(scenario==='unrelated visit'){await h.sandbox.goPage('capture');await h.sandbox.goPage('edit/one');}
  const id=scenario==='different note'?'two':'one';
  await h.sandbox.goPage('read/'+id);
  assert.equal(h.sandbox.state.readerReturn,'edit/one');
 }
});

test('client content revision changes on successful writes, not reads or rejected writes',async()=>{
 let fail=false;const client=createClient(async p=>({ok:!fail,status:fail?409:200,json:async()=>p==='/api/session'?{csrf:'synthetic'}:fail?{error:'conflict',code:'CONFLICT'}:{ok:true}}));
 await client.get('/api/library');assert.equal(client.getContext().revision,0);await client.put('/api/notes/id',{body:'synthetic'});assert.equal(client.getContext().revision,1);
 fail=true;await assert.rejects(client.put('/api/notes/id',{body:'conflicting'}));assert.equal(client.getContext().revision,1);
});


test('navigation buttons cached off-document release their busy state',async()=>{
 const {busy}=await import('../public/web/ui.mjs');
 const control={disabled:false,isConnected:true,attributes:new Map(),setAttribute(k,v){this.attributes.set(k,v);},removeAttribute(k){this.attributes.delete(k);}};
 await busy(control,async()=>{assert.equal(control.disabled,true);control.isConnected=false;});
 assert.equal(control.disabled,false);assert.equal(control.attributes.has('aria-busy'),false);
 let calls=0;await busy(control,async()=>calls++);assert.equal(calls,1);
});

test('late study responses cannot change the mounted session or undo a departure', async t => {
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => null } });
  t.after(() => {
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument);
    else delete globalThis.document;
  });
  for (const destination of ['study/B', 'capture']) {
    const { sandbox, main } = harness();
    const { state } = sandbox;
    const started = Promise.withResolvers(), response = Promise.withResolvers();
    const session = id => ({ id, noteId: id, status: 'completed', material: '合成材料', question: 'Question ' + id, turns: [] });
    const mounted = [];
    sandbox.study = createStudyWorkspace({
      api: { get: async path => {
        if (path === '/api/study/A') { started.resolve(); return response.promise; }
        assert.equal(path, '/api/study/B');
        return session('B');
      } },
      noteTitle: id => id,
      setSession: value => { mounted.push(value.id); state.session = value; },
    });
    const first = sandbox.goPage('study/A');
    await started.promise;
    assert.equal(await sandbox.goPage(destination), true);
    if (destination === 'study/B') assert.match(main.childNodes[0].html, /Question B/);
    const mountedPage = main.childNodes[0];
    response.resolve(session('A'));
    assert.equal(await first, false);
    assert.equal(main.childNodes[0], mountedPage);
    assert.equal(state.route, destination);
    assert.deepEqual(mounted, destination === 'study/B' ? ['B'] : []);
    assert.equal(state.session?.id, destination === 'study/B' ? 'B' : undefined);
  }
});
