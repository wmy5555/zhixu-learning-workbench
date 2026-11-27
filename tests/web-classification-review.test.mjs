import test from 'node:test';
import assert from 'node:assert/strict';
import { classificationInputs } from '../public/classification-review.mjs';
import { learningReadiness, readerMenu } from '../public/web/reader-actions.mjs';
import { reader } from '../public/web/reader.mjs';
import { createStudyWorkspace } from '../public/web/study-workspace.mjs';

test('shared controls require an explicit choice only for unknown values and show raw values as text',()=>{
  class Element {
    constructor(tag){this.tag=tag;this.children=[];}
    append(...nodes){this.children.push(...nodes);}
    add(node){this.children.push(node);}
  }
  const oldDocument=globalThis.document, oldOption=globalThis.Option;
  globalThis.document={createDocumentFragment:()=>new Element('fragment'),createElement:tag=>new Element(tag)};
  globalThis.Option=class {constructor(text,value){this.text=text;this.value=value;}};
  try {
    const controls=classificationInputs({kind:'constructor',meta:{stage:'learning',depth:{unexpected:'<script>'}}});
    assert.deepEqual(controls.children.map(label=>label.children[1].name),['kind','depth']);
    assert.match(controls.children[0].children[0].textContent,/constructor/);
    assert.match(controls.children[1].children[0].textContent,/<script>/);
    for(const label of controls.children){const select=label.children[1];assert.equal(select.required,true);assert.equal(select.children[0].value,'');}
  } finally {globalThis.document=oldDocument;globalThis.Option=oldOption;}
});

test('mistake entries keep reading and route to the exact classification that needs review',async()=>{
 const good={id:'good',kind:'knowledge',title:'正常知识',body:'正文',meta:{stage:'learning',depth:'explain'}};
 const bad={...good,id:'bad',title:'待核对知识',meta:{stage:'learning',depth:'constructor'}};
 const make=(id,noteId,depth)=>({id,kind:'mistake',title:id,body:'错误正文',meta:{noteId,...(depth?{depth}:{})}});
 const normal=make('normal','good'),own=make('own','good','constructor'),related=make('related','bad');
 const notes=[good,bad,normal,own,related];
 for(const [note,target] of [[own,'own'],[related,'bad']]){
  const html=reader(note,notes).html,menu=readerMenu(note,null,notes);
  assert.match(html,/错误正文/);assert.doesNotMatch(html,/data-action="start-mistake"/);assert.doesNotMatch(menu,/data-action="start-mistake"/);
  assert.match(target==='own'?html:menu,target==='own'?/data-action="classification-review"/:/data-route="read\/bad"/);
 }
 assert.match(reader(normal,notes).html,/data-action="start-mistake"/);
 assert.match(readerMenu(normal,null,notes),/data-action="start-mistake"/);
 const api={getContext:()=>({version:0}),get:async url=>url==='/api/study'?{sessions:[]}:{mistakes:[normal,own,related]}};
 const html=(await createStudyWorkspace({api,getNotes:()=>notes}).page()).html;
 assert.match(html,/分类待确认/);assert.match(html,/data-route="read\/own"/);assert.match(html,/data-route="read\/related"/);
});

test('unknown classification is visible in reader but cannot appear as ordinary learning',async()=>{
  const bad={id:'bad',kind:'knowledge',title:'分类待确认资料',body:'完整正文',meta:{stage:'learning',depth:'constructor'}};
  const good={id:'good',kind:'knowledge',title:'正常学习资料',body:'正常正文',meta:{stage:'learning',depth:'explain'}};
  const readiness=learningReadiness(bad,[],[]), html=reader(bad,[],'library',[],readiness).html, menu=readerMenu(bad,readiness);
  assert.equal(readiness.ready,false);assert.match(html,/分类待确认/);assert.match(html,/完整正文/);assert.match(html,/data-action="classification-review"/);
  assert.doesNotMatch(html,/data-action="start-note"|data-action="promote"/);assert.doesNotMatch(menu,/data-action="start-note"|data-action="promote"/);
  const api={getContext:()=>({version:0}),get:async url=>url==='/api/study'?{sessions:[]}:{mistakes:[]}};
  const workspace=createStudyWorkspace({api,getNotes:()=>[bad,good]});
  const page=await workspace.page();
  assert.match(page.html,/正常学习资料/);assert.doesNotMatch(page.html,/分类待确认资料/);
});
