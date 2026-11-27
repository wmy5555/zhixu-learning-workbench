import test from 'node:test';
import assert from 'node:assert/strict';
import { classificationInputs } from '../public/classification-review.mjs';
import { learningReadiness, readerMenu } from '../public/web/reader-actions.mjs';
import { reader } from '../public/web/reader.mjs';
import { createStudyWorkspace } from '../public/web/study-workspace.mjs';
import { labels } from '../public/ui.mjs';

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
    assert.equal(labels.kind('constructor'),'分类待确认');
    assert.equal(labels.stage({toString:null}),'分类待确认');
  } finally {globalThis.document=oldDocument;globalThis.Option=oldOption;}
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
