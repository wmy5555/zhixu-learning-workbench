import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {reader} from '../public/web/reader.mjs';
import {pendingPlan} from '../public/web/api.mjs';
import {escape as e} from '../public/web/markdown.mjs';
import {icon,button as btn,routeButton as link,kind,calendar} from '../public/web/ui.mjs';
import {details} from '../public/web/parity.mjs';
import {unavailableHTML} from '../public/web/today-unavailable.mjs';

const source={id:'source',kind:'source',title:'合成来源',body:'一段完整的原文。',meta:{stage:'reference'}};
const aside=(html,name)=>html.match(new RegExp(`<aside class="${name}"[^>]*>`))?.[0];
test('short sources reclaim both empty rails while keeping local and AI actions after the body',()=>{
  const html=reader(source,[]).html;
  assert.match(aside(html,'reading-shelf'),/hidden/);
  assert.match(aside(html,'reading-margin'),/hidden/);
  assert.doesNotMatch(html,/还没有相关内容|MY READING DESK|READING NOTE|真正值得保留/);
  assert.ok(html.indexOf('data-action="process"')>html.indexOf('一段完整的原文。'));
  assert.match(html,/class="secondary" data-action="process"/);
  assert.match(html,/data-action="extract"/);
});
test('a real outline and children reveal their rails and each child is rendered once',()=>{
  const children=Array.from({length:7},(_,i)=>({id:`child-${i}`,title:`知识 ${i}`,kind:'knowledge',meta:{stage:'candidate'}}));
  const html=reader({...source,body:'## 第一节\n内容。\n\n## 第二节\n更多内容。',children},[]).html;
  assert.doesNotMatch(aside(html,'reading-shelf'),/hidden/);
  assert.doesNotMatch(aside(html,'reading-margin'),/hidden/);
  assert.match(html,/aria-label="资料目录"/);
  for(const c of children)assert.equal(html.split(`data-route="read/${c.id}"`).length-1,1);
  assert.equal((html.match(/data-action="process"/g)||[]).length,1);
});
test('source title remains escaped and knowledge learning and evidence controls remain available',()=>{
  const html=reader({...source,title:'<img src=x>',kind:'knowledge',meta:{stage:'learning'}},[]).html;
  assert.doesNotMatch(html,/<img src=x>/);
  for(const action of ['start-note','promote','understanding','evidence'])assert.match(html,new RegExp(`data-action="${action}"`));
});

const code=fs.readFileSync(new URL('../public/web/main.mjs',import.meta.url),'utf8');
function home(notes=[],items=[]){
  const context={state:{boot:{notes,today:{date:'2026-10-25',items,budget:25},jobs:[],settings:{}}},e,icon,btn,link,kind,calendar,pendingPlan,details,unavailableHTML,list:v=>Array.isArray(v)?v:[],noteTitle:id=>id};
  return vm.runInNewContext(code.slice(code.indexOf('function todayPage()'),code.indexOf('function capturePage()'))+';todayPage().html',context);
}
test('home selects a useful primary action for empty, reading and planned states without duplicating the first task',()=>{
  const empty=home();assert.equal((empty.match(/class="primary"/g)||[]).length,1);assert.match(empty,/data-route="capture"/);
  const reading=home([source]);assert.match(reading,/data-route="read\/source"/);assert.match(reading,/一段完整的原文/);assert.doesNotMatch(reading,/A LITTLE|hero-mark|今日提醒/);
  const items=[{id:'p1',noteId:'source',title:'学习此文',kind:'learn',state:'pending',minutes:5},{id:'p2',noteId:'source2',title:'复习另一篇',kind:'review',state:'pending',minutes:5}];
  const planned=home([source],items);
  for(const id of ['p1','p2']){
    assert.equal((planned.match(new RegExp(`data-action="start-plan"[^>]*data-id="${id}"`,'g'))||[]).length,1);
    assert.match(planned,new RegExp(`data-action="defer"[^>]*data-id="${id}"`));
    assert.match(planned,new RegExp(`data-action="plan-more"[^>]*data-id="${id}"`));
  }
});
