import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createService } from '../src/service.mjs';
import { createStudyStarter } from '../public/study-start.mjs';
import { createStudyWorkspace } from '../public/web/study-workspace.mjs';
import { learningReadiness, learningHelp, readerMenu } from '../public/web/reader-actions.mjs';
import { reader } from '../public/web/reader.mjs';

const source={id:'source-1',kind:'source',title:'合成原始资料'};

test('topic and mistake starts keep uncertain receipts and a later success retires earlier intentions', async () => {
  const writes = [], routes = [];
  let version = 1, fail = true;
  const api = { getContext: () => ({ version, practiceId: version === 1 ? '' : 'practice' }),
    async post(path, body) {
      assert.equal(path, '/api/study/start'); writes.push(body);
      if (fail) throw new Error('回执丢失');
      return { id: 'accepted' };
    } };
  const study = createStudyWorkspace({ api, view: () => ({ sequence: 1 }), go: route => routes.push(route) });
  const topic = () => study.start('note', undefined, { topicId: 'same' });
  const mistake = () => study.start('note', undefined, { mistakeId: 'same' });
  await assert.rejects(topic(), /回执丢失/);
  await assert.rejects(mistake(), /回执丢失/);
  await assert.rejects(topic(), /回执丢失/);
  assert.equal(writes[2].requestId, writes[0].requestId);
  assert.notEqual(writes[1].requestId, writes[0].requestId);
  fail = false; await mistake(); await topic();
  assert.deepEqual(writes[3], writes[1]);
  assert.notEqual(writes[4].requestId, writes[0].requestId);
  fail = true; await assert.rejects(topic(), /回执丢失/);
  version++; await assert.rejects(topic(), /回执丢失/);
  assert.notEqual(writes[5].requestId, writes[6].requestId);
  assert.deepEqual(routes, ['study/accepted', 'study/accepted']);
});

test('another start acknowledged during a pending write cannot discard a subsequently lost receipt', async () => {
  const pending = Promise.withResolvers(), writes = [];
  const api = { getContext: () => ({ version: 1 }), async post(path, input) {
    writes.push(input);
    if (writes.length === 1) return pending.promise;
    return { id: input.noteId };
  } };
  const study = createStudyWorkspace({ api, view: () => ({ sequence: 1 }), go: async () => {} });
  const mistake = () => study.start('first', undefined, { mistakeId: 'm' });
  const first = mistake();
  await study.start('other', undefined, { topicId: 't' });
  pending.reject(new Error('response lost'));
  await assert.rejects(first, /response lost/);
  await mistake();
  assert.deepEqual(writes[2], writes[0]);
});

test('a late acknowledgement cannot retire another overlapping start already saved in SQLite', async t => {
  const parent = path.resolve(import.meta.dirname, '../.tmp');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'study-start-'));
  const service = createService({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault') });
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  const makeNote = title => service.store.create({ kind: 'knowledge', title, body: title, meta: { stage: 'learning' } });
  const a = makeNote('合成甲'), b = makeNote('合成乙'), first = Promise.withResolvers();
  const sessions = [];
  let loseReply = true;
  const start = createStudyStarter(() => ({ version: 0 }), async input => {
    const saved = service.startStudy(input);
    sessions.push(saved.id);
    if (input.noteId === a.id) await first.promise;
    if (input.noteId === b.id && loseReply) { loseReply = false; throw Error('回执丢失'); }
    return saved;
  });
  const older = start({ noteId: a.id });
  await assert.rejects(start({ noteId: b.id }), /回执丢失/);
  first.resolve(); await older;
  await start({ noteId: b.id });
  assert.equal(sessions[2], sessions[1]);
  assert.equal(service.store.records('sessions').length, 2);
  await start({ noteId: b.id });
  assert.notEqual(sessions[3], sessions[2]);
});

test('duplicate contextual starts write once; dismissed dialogs, changed routes and changed spaces cannot navigate', async () => {
  for (const leave of ['stay', 'dismiss', 'navigate', 'switch']) {
    const response = Promise.withResolvers(), routes = [];
    let writes = 0, version = 1, sequence = 1, closes = 0;
    const dialog = { isConnected: true, open: true, close() { this.open = false; closes++; } };
    const api = { getContext: () => ({ version }),
      async post() { writes++; return response.promise; } };
    const study = createStudyWorkspace({ api, view: () => ({ sequence }), go: route => routes.push(route) });
    const context = leave === 'dismiss' || leave === 'stay' ? { topicId: 'topic', dialog } : { mistakeId: 'mistake' };
    const first = study.start('note', undefined, context), second = study.start('note', undefined, context);
    assert.equal(writes, 1);
    if (leave === 'dismiss') dialog.open = false;
    if (leave === 'navigate') sequence++;
    if (leave === 'switch') version++;
    response.resolve({ id: 'session' });
    await Promise.all([first, second]);
    assert.deepEqual(routes, leave === 'stay' ? ['study/session'] : []);
    assert.equal(closes, leave === 'stay' ? 1 : 0);
  }
});
const knowledge=(meta={})=>({id:'knowledge-1',kind:'knowledge',title:'合成知识',body:'完整正文',meta:{stage:'candidate',sources:[{id:source.id,role:'input'}],...meta}});

test('unselected material exposes arrangement and optional research separately',()=>{
  const note=knowledge(), readiness=learningReadiness(note,[source],['整理尚未核验']);
  const html=reader(note,[source],'library',[],readiness).html;
  assert.match(html,/aria-label="学习条件"/);assert.match(html,/data-action="prepare-learning"/);
  assert.doesNotMatch(html,/data-action="start-note"/);
  const help=learningHelp(note,readiness);
  assert.match(help,/data-action="research-source"[^>]*data-id="source-1"/);
  assert.match(help,/学习帮助你理解材料/);assert.match(help,/data-route="jobs"/);
  assert.match(help,/data-action="promote"/);
  const menu=readerMenu(note,readiness);
  assert.match(menu,/aria-label="常用操作"/);assert.match(menu,/aria-label="来源与记录"/);
  assert.match(menu,/<details class="reader-menu-management">/);
});

test('material, source identity, lifecycle and learning arrangement transitions stay separate',()=>{
  const note=knowledge({stage:'learning',processKey:'missing:hash:0',sources:[{id:source.id,role:'input'}]});
  let ready=learningReadiness(note,[source],['底层原文已变化']);
  assert.equal(ready.sourceId,undefined);assert.doesNotMatch(learningHelp(note,ready),/data-action="research-source"/);
  assert.equal(ready.ready,true);assert.deepEqual(ready.warnings,['底层原文已变化']);
  ready=learningReadiness(knowledge({sources:[{id:'a',role:'input'},{id:'b',role:'input'}]}),[source],['待核验']);
  assert.equal(ready.sourceId,undefined);
  ready=learningReadiness(knowledge(),[source],[]);assert.equal(ready.arrange,true);
  assert.match(learningHelp(knowledge(),ready),/data-action="promote"/);
  for(const stage of ['learning','integrated','core'])assert.equal(learningReadiness(knowledge({stage}),[],[]).ready,true);
  ready=learningReadiness(knowledge({stage:'retired'}),[source],['待核验']);assert.equal(ready.arrange,true);assert.equal(ready.sourceId,undefined);
  ready=learningReadiness(knowledge({supersededBy:'kept'}),[],[]);assert.equal(ready.replacementId,'kept');
  assert.match(learningHelp(knowledge(),ready),/data-route="read\/kept"/);
});

test('recovery escapes untrusted reasons and titles and source menus retain only applicable operations',()=>{
  const note=knowledge();note.title='<script>bad()</script>';
  const readiness=learningReadiness(note,[source],['<img src=x onerror=bad()>']);
  assert.doesNotMatch(learningHelp(note,readiness),/<script>|<img/);
  assert.doesNotMatch(readerMenu(note,readiness),/<script>|<img/);
  const menu=readerMenu(source,null);
  assert.match(menu,/data-action="process"/);assert.match(menu,/data-action="extract"/);
  assert.doesNotMatch(menu,/data-action="start-note"|data-action="promote"/);
});

function harness({limitations=[],stage='learning',postError,hold=false}={}) {
  const writes=[],dialogs=[],state={sequence:1,route:'read/knowledge-1',boot:{notes:[source]}};
  let release;
  const gate=hold?new Promise(resolve=>{release=resolve;}):Promise.resolve();
  const api={getContext:()=>({version:0,practiceId:''}),get:async path=>{await gate;return path.endsWith('/evidence')?{limitations}:knowledge({stage});},post:async(path,body)=>{writes.push({path,body});if(postError)throw postError;return {id:'session-1'};}};
  const { start } = createStudyWorkspace({
    api, getNotes: () => state.boot.notes, view: () => state,
    go: async route => { state.route = route; },
    showHelp: (note, readiness) => dialogs.push([readiness.heading, learningHelp(note, readiness)]),
  });
  const context = { api, state, start };
  return {context,writes,dialogs,release};
}

test('start redirects unmet conditions to recovery, coalesces clicks, and preserves successful start intent',async()=>{
  for(const options of [{stage:'candidate'},{stage:'retired'}]){
    const h=harness(options);await h.context.start('knowledge-1');assert.equal(h.writes.length,0);assert.equal(h.dialogs.length,1);
  }
  const h=harness({hold:true,limitations:['待核验']}),one=h.context.start('knowledge-1'),two=h.context.start('knowledge-1');
  h.release();await Promise.all([one,two]);assert.equal(h.writes.length,1);
  assert.match(h.writes[0].body.requestId,/^[0-9a-f-]{36}$/);assert.equal(h.context.state.route,'study/session-1');
});

test('retrying a failed start keeps the request ID and planned item', async () => {
  const h = harness({ postError: new Error('temporary failure') });
  await assert.rejects(h.context.start('knowledge-1', 'plan-1'), /temporary failure/);
  h.context.api.post = async (path, body) => { h.writes.push({ path, body }); return { id: 'session-1' }; };
  await h.context.start('knowledge-1', 'plan-1');
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[0].body.planId, 'plan-1');
  assert.deepEqual(h.writes[1], h.writes[0]);
});

test('late readiness is ignored after navigation; backend eligibility races still open recovery',async()=>{
  const late=harness({hold:true,limitations:['待核验']}),pending=late.context.start('knowledge-1');
  late.context.state.sequence++;late.release();await pending;assert.equal(late.writes.length,0);assert.equal(late.dialogs.length,0);
  const error=Object.assign(new Error('知识已停用'),{code:'NOTE_UNAVAILABLE'});
  const h=harness({postError:error});
  // The second evidence read observes the changed material version.
  let reads=0,original=h.context.api.get;
  h.context.api.get=async path=>!path.endsWith('/evidence')&&++reads>1?knowledge({stage:'retired'}):original(path);
  await h.context.start('knowledge-1');assert.equal(h.writes.length,1);assert.equal(h.dialogs.length,1);
  assert.match(h.dialogs[0][1],/重新选择用途/);
});

test('warned learning keeps the primary action in reader and menu, with escaped optional credibility details',()=>{const note=knowledge({stage:'learning'}),readiness=learningReadiness(note,[source],['<img src=x> 尚待核验']);const html=reader(note,[source],'library',[],readiness).html;assert.match(html,/data-action="start-note"/);assert.match(html,/可以先学习/);assert.match(html,/补充联网核验/);assert.doesNotMatch(html,/<img src=x>/);assert.match(readerMenu(note,readiness),/data-action="start-note"/);});
