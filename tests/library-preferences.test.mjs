import test from 'node:test';
import assert from 'node:assert/strict';
import { createLibraryPreferences } from '../public/web/library-preferences.mjs';
import { labels } from '../public/ui.mjs';
import { noteKinds, learningStages, learningDepths, isStudyStage } from '../public/note-classification.mjs';
import { kind, stage, kindOptions, stageOptions, quickKindOptions, purposeOptions, depthOptions } from '../public/web/classification.mjs';
import { createLibraryPage } from '../public/web/library-page.mjs';
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
  const source={id:'source',kind:'source',title:'合成原文',body:'原文内容',updatedAt:'2026-01-02'};
  const child={id:'child',kind:'knowledge',title:'合成知识',body:'独有关键词',updatedAt:'2026-01-03',meta:{stage:'candidate'}};
  const report={id:'report',kind:'report',title:'合成整理报告',body:'报告内容',updatedAt:'2026-01-01'};
  const createPage=()=>createLibraryPage({get:async path=>path==='/api/library'
    ? {groups:[{source,children:[child]}],standalone:[report]} : {suggestions:[{id:'suggestion',title:'合成知识建议'}]}});
  function node(value='') { return {value,checked:false,open:false,isConnected:true,events:{},addEventListener(n,fn){this.events[n]=fn;},setAttribute(n,v){this[n]=v;},querySelector(){return this.innerHTML?.includes('<article ') ? {} : null;}}; }
  const query=node(),kind=node(),stage=node(),group=node(),options=node(),advice=node(),host=node(),button=node(); button.dataset={kind:'knowledge'};
  const controls={'[name="libraryQuery"]':query,'[name="libraryKind"]':kind,'[name="libraryStage"]':stage,'[name="sourceGroups"]':group,'[data-library-options]':options,'[data-library-advice]':advice,'#parity-library':host};
  globalThis.document={querySelector:s=>controls[s],querySelectorAll:()=>[button]};
  try {
    const client=createPage();
    const page=await client.page();
    assert.match(page.html,/1 份原文 · 1 条知识/);
    assert.match(page.html,/data-id="suggestion"/);
    page.bind();
    assert.ok(host.innerHTML.indexOf('合成知识') < host.innerHTML.indexOf('合成原文'));
    assert.match(host.innerHTML,/合成整理报告/);
    group.checked=true;group.events.input();assert.match(host.innerHTML,/parity-source-group/);
    query.value='独有关键词';query.events.input();
    assert.match(host.innerHTML,/合成原文/);
    assert.match(host.innerHTML,/合成知识/);
    assert.doesNotMatch(host.innerHTML,/合成整理报告/);
    button.onclick();assert.equal(button['aria-pressed'],'true');
    query.value='"<MCP>';query.events.input();stage.value='candidate';stage.events.input();group.checked=true;group.events.input();options.open=true;options.events.toggle();advice.open=true;advice.events.toggle();
    assert.match(host.innerHTML,/没有符合条件的资料/);
    for(const clientAfterNavigation of [client,createPage()]){
      const html=(await clientAfterNavigation.page()).html;
      assert.match(html,/data-kind="knowledge" aria-pressed="true"/);
      assert.match(html,/value="&quot;&lt;MCP&gt;"/);
      assert.match(html,/<option value="candidate" selected>/);
      assert.match(html,/name="sourceGroups" checked/);
      assert.match(html,/<details data-library-options class="quiet-details" open/);
      assert.match(html,/<details data-library-advice class="quiet-details" open/);
    }
    options.open=false;options.events.toggle();group.checked=false;group.events.input();
    assert.doesNotMatch((await createPage().page()).html,/name="sourceGroups" checked/);
    assert.doesNotMatch((await createPage().page()).html,/<details data-library-options class="quiet-details" open/);
  } finally {globalThis.document=previousDocument;globalThis.localStorage=previousStorage;}
});


test('classification choices preserve labels, order, subsets and old preferences', () => {
  assert.deepEqual(kindOptions, [['','全部类别'],['source','原始资料'],['knowledge','知识'],['topic','主题学习包'],['report','AI 整理建议'],['mistake','错题']]);
  assert.deepEqual(quickKindOptions, [['','全部'],['source','原始资料'],['knowledge','知识'],['mistake','错题']]);
  assert.deepEqual(stageOptions, [['','全部学习状态'],['reference','仅供查阅'],['candidate','待选学'],['learning','正在学习'],['integrated','个人理解'],['core','重点知识'],['retired','不再使用']]);
  assert.deepEqual(purposeOptions, [['reference','先留作查阅'],['candidate','放进待选学'],['learning','加入学习'],['integrated','已整理个人理解'],['core','重点知识'],['retired','暂时不再使用']]);
  assert.equal(kind('missing'), '资料'); assert.equal(stage('missing'), '尚未分类');
  for (const [value] of kindOptions) assert.equal(createLibraryPreferences(()=>memory(JSON.stringify({kind:value}))).read().kind,value);
  for (const [value] of stageOptions) assert.equal(createLibraryPreferences(()=>memory(JSON.stringify({stage:value}))).read().stage,value);
});

test('both web generations retain their display language while preferences use persisted identifiers', () => {
  assert.deepEqual(kindOptions.slice(1).map(([id]) => id), ['source', 'knowledge', 'topic', 'report', 'mistake']);
  assert.deepEqual(stageOptions.slice(1).map(([id]) => id), learningStages);
  assert.deepEqual(depthOptions.map(([id]) => id), learningDepths);
  assert.deepEqual(learningStages.filter(isStudyStage), ['learning', 'integrated', 'core']);
  for (const id of noteKinds) assert.equal(kind(id), labels.kind(id));
  assert.equal(stage('integrated'), '个人理解');
  assert.equal(labels.stage('integrated'), '已整理个人理解');
  assert.equal(labels.stage('future-stage'), 'future-stage');
  assert.equal(stage('future-stage'), '尚未分类');
  assert.equal(kind(['source']), '资料');
  assert.equal(createLibraryPreferences(() => memory(JSON.stringify({ kind: 'constructor', stage: 'future-stage' }))).read().kind, '');
});
