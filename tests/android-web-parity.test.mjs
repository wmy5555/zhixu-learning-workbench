import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCalendarDate } from '../apps/android/web/ui.mjs';
import { click, control, createAndroidBrowser, findButton } from './fixtures/android-browser.mjs';

const bootstrap = async () => ({ notes: [], today: { items: [] }, stats: {} });
const submit = form => form.events.submit({ preventDefault() {} });
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; }
const session = { id: 'session', noteId: 'knowledge', status: 'unassessed', question: '合成回忆问题', turns: [{ id: 'turn', answer: '已经保存的原答' }] };
async function studyFixture(api = {}, confirmations = []) {
  const f = await createAndroidBrowser({ api: { bootstrap, study: async () => session, ...api }, confirmations });
  f.app.state.currentStudy = session; f.app.state.studyTab = 'session'; f.app.state.studyMaterialVisible = false;
  await f.app.navigate('study'); return f;
}

test('Android calendar days keep their day in timezones west of UTC and preserve invalid input', () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ['America/Los_Angeles', 'Asia/Shanghai', 'UTC']) {
      process.env.TZ=zone; assert.match(formatCalendarDate('2026-10-15'), /15/); assert.doesNotMatch(formatCalendarDate('2026-10-15'), /14/);
    }
    assert.equal(formatCalendarDate('2026-02-30'), '2026-02-30'); assert.equal(formatCalendarDate(''), '未记录');
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ=previous; }
});

test('Android capture draft survives cancelled navigation and is discarded only on confirmation', async () => {
  const f=await createAndroidBrowser({ api:{ bootstrap, library:async()=>({groups:[],standalone:[]}) }, confirmations:[false,true] });
  await f.app.navigate('capture'); const form=f.app.refs.main.querySelector('form'); control(form,'body').value='尚未保存的合成原文';
  await f.app.navigate('library'); assert.equal(f.app.state.view,'capture'); assert.equal(f.app.refs.main.querySelector('form'),form);
  assert.equal(control(form,'body').value,'尚未保存的合成原文');
  await f.app.navigate('library'); assert.equal(f.app.state.view,'library'); assert.equal(f.context.confirmPrompts.length,2);
});

test('saving capture twice sends once and a newer draft typed during the save remains intact', async () => {
  const pending=deferred(); let calls=0;
  const f=await createAndroidBrowser({ api:{bootstrap,import:async()=>{calls++;return pending.promise;}} });
  await f.app.navigate('capture'); const form=f.app.refs.main.querySelector('form'); control(form,'title').value='合成标题';control(form,'body').value='提交的原文';
  const save=submit(form);await submit(form);assert.equal(calls,1);
  control(form,'body').value='保存期间的新原文';pending.resolve({notes:[{id:'saved'}]});await save;
  assert.equal(control(form,'body').value,'保存期间的新原文');assert.equal(form.hasUnsavedChanges(),true);
});

test('Android start coalesces clicks, reuses uncertain requests, and retires them after success', async () => {
  const pending=deferred(), requests=[];
  const f=await createAndroidBrowser({ api:{bootstrap,study:async()=>session,startStudy:async body=>{requests.push({...body});return requests.length===1?pending.promise:session;}} });
  const first=f.context.beginStudy('knowledge');await Promise.resolve();await Promise.resolve();
  await f.context.beginStudy('knowledge');assert.equal(requests.length,1);pending.reject(new Error('合成回执丢失'));await first;
  await f.context.beginStudy('knowledge');assert.equal(requests.length,2);assert.equal(requests[1].requestId,requests[0].requestId);
  await f.context.beginStudy('knowledge');assert.equal(requests.length,3);assert.notEqual(requests[2].requestId,requests[1].requestId);
});

test('Android study redraw keeps an answer draft and cancelled navigation leaves it editable', async () => {
  const f=await studyFixture({},[false]);const old=f.app.refs.main.querySelector('[data-tour="study-session"]');control(old,'answer').value='还在修改的回答';
  await f.app.renderStudy();const next=f.app.refs.main.querySelector('[data-tour="study-session"]');assert.notEqual(next,old);assert.equal(control(next,'answer').value,'还在修改的回答');
  await f.app.navigate('capture');assert.equal(f.app.state.view,'study');assert.equal(control(f.app.refs.main,'answer').value,'还在修改的回答');
});

test('Android saving an answer preserves newer text and never copies it into another session', async () => {
  const pending=deferred();let saved=session;
  const f=await studyFixture({answer:async()=>pending.promise,study:async()=>saved},[false]);
  const form=f.app.refs.main.querySelector('form');control(form,'answer').value='提交的回答';const saving=submit(form);
  control(form,'answer').value='等待期间的新回答';saved={...session,turns:[...session.turns,{id:'new-turn',answer:'提交的回答'}]};pending.resolve(saved);await saving;
  assert.equal(control(f.app.refs.main,'answer').value,'等待期间的新回答');
  await f.context.continueStudy({...session,id:'different'});assert.equal(f.app.state.currentStudy.id,'session');assert.equal(control(f.app.refs.main,'answer').value,'等待期间的新回答');
});

test('a cancelled Android library switch does not call the native practice or context APIs', async () => {
  const calls=[];const f=await createAndroidBrowser({api:{bootstrap,androidPractice:async()=>{calls.push('practice');},setContext:()=>calls.push('context')},confirmations:[false]});
  await f.app.navigate('capture');control(f.app.refs.main,'body').value='未保存的正式库原文';await f.app.switchAndroidLibrary('android-local');assert.deepEqual(calls,[]);assert.equal(f.app.state.view,'capture');
});

test('Android local output is labelled retrieval and editing a draft preserves the new question', async () => {
  let draft={id:'draft',title:'合成草稿',body:'旧草稿',usedIds:[],citations:[]};
  const f=await createAndroidBrowser({api:{bootstrap,drafts:async()=>({drafts:[draft]}),ask:async()=>({answer:'合成本地检索片段',generated:false,citations:[]}),updateDraft:async(id,data)=>{draft={...draft,...data};}}});
  await f.app.navigate('output');const question=control(f.app.refs.main,'question');question.value='合成问题';await submit(f.app.refs.main.querySelector('[data-tour="output-form"]'));
  assert.match(f.app.refs.main.textContent,/本地检索结果（未进行 AI 生成）/);question.value='下一条尚未提交的问题';
  await click(findButton(f.app.refs.main,'编辑'));const editor=f.app.refs.drawerBody.querySelector('form');editor.querySelector('textarea').value='已编辑的合成草稿';await submit(editor);
  assert.equal(control(f.app.refs.main,'question'),question);assert.equal(question.value,'下一条尚未提交的问题');assert.match(f.app.refs.main.querySelector('[data-tour="output-drafts"]').textContent,/已编辑的合成草稿/);
});
