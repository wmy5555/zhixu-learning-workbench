import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { createService } from '../src/service.mjs';
import { searchContext, searchTokens } from '../src/search-index.mjs';

const temp = path.resolve(import.meta.dirname, '../.tmp');
fs.mkdirSync(temp, { recursive: true });
function harness(t, aiOverride) {
  const root = fs.mkdtempSync(path.join(temp,'search-test-'));
  const config = { dataDir: path.join(root,'data'), vaultDir: path.join(root,'vault'), aiOverride };
  let service = createService(config);
  t.after(async () => { await service?.close(); fs.rmSync(root,{recursive:true,force:true}); });
  return { root, config, get s(){return service;}, async close(){await service?.close();service=null;}, async reopen(){await service?.close(); service=createService(config); return service;} };
}
function note(s, id, body, meta = {}, kind = 'knowledge', title = id) {
  return s.store.create({id,kind,title,body,meta:{stage:'candidate',...meta}});
}
const ids = result => result.results.map(n => n.id);
const legacy = (notes,q) => {
  const terms = searchTokens(q), query = q.toLowerCase();
  return notes.filter(n => {const text = `${n.title}\n${n.body}`.toLowerCase();return text.includes(query) || terms.filter(t=>text.includes(t)).length/(terms.length||1)>=Math.min(0.65,2/Math.max(1,terms.length));}).map(n=>n.id).sort();
};

test('FTS candidate selection preserves Chinese/substring recall against the previous rule', async t => {
  const {s} = harness(t), notes = [
    note(s,'a','熵与检索可靠性；拉格朗日中值定理；RX7900-XTX，ThinkPadX1，abc_def。'),
    note(s,'b','检验其他索引；中间包含 pRX7900-XTXq；中文𠀀与表情🧭。'),
    note(s,'c','局部子串检验，ALPHA beta；标题之外。',{},'knowledge','仅标题命中词'),
    note(s,'d','分散的拉、格，和朗。中文标点，100%_literal。'),
  ];
  for (const q of ['熵','检索','索引','拉格朗日中值定理','RX7900-XTX','7900','rx','x','x1','abc_def','_de','alpha BETA','𠀀','🧭','仅标题命中词','100%_','" OR *','不存在qzx']) {
    assert.deepEqual(ids(await s.search(q,{limit:50})).sort(),legacy(notes,q),q);
  }
  assert.equal((await s.search('熵')).diagnostics.indexUpdated,0);
});

test('full timing includes sync and long-body context identifies the actual line and section', async t => {
  const {s} = harness(t), body = '# 起始\n'+'普通段落。\n'.repeat(3000)+'## 目标段\n这里的尾部朱雀才是实际命中。\n';
  const n = note(s,'tail',body);
  const scan = s.store.ensureFresh.bind(s.store);
  s.store.ensureFresh = () => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,25); return scan(); };
  const started=performance.now(), result=await s.search('尾部朱雀'), elapsed=performance.now()-started, hit=result.results[0];
  assert.equal(hit.id,n.id); assert.ok(hit.snippet.includes('尾部朱雀'));
  assert.equal(body.slice(hit.location.offset,hit.location.end),'尾部朱雀');
  assert.equal(hit.location.line,3003); assert.equal(hit.location.heading,'目标段');
  assert.equal(hit.location.hash,n.hash); assert.equal(hit.location.path,n.path);
  assert.ok(result.diagnostics.phases.syncMs>=20);
  assert.ok(result.diagnostics.elapsedMs>=result.diagnostics.phases.syncMs);
  assert.ok(result.diagnostics.elapsedMs<=elapsed);
  assert.ok(Object.values(result.diagnostics.phases).every(Number.isFinite));
  assert.equal(searchContext({...n,body:'İ前缀尾部朱雀'},'尾部朱雀').location.offset,3);
});

test('warm queries skip unchanged content, same-size external edits, move, duplicate and invalid YAML reconcile', async t => {
  const h=harness(t), {s}=h, n=note(s,'stable','旧词甲甲'), file=path.join(s.store.vaultDir,n.path);
  await s.search('旧词甲甲');
  assert.equal((await s.search('旧词甲甲')).diagnostics.sync.readFiles,0);
  const original=fs.statSync(file), raw=fs.readFileSync(file,'utf8');
  fs.writeFileSync(file,raw.replace('旧词甲甲','新词乙乙')); fs.utimesSync(file,original.atime,original.mtime);
  const fresh=await s.search('新词乙乙'); assert.deepEqual(ids(fresh),['stable']); assert.equal(fresh.diagnostics.sync.readFiles,1);
  assert.deepEqual(ids(await s.search('旧词甲甲')),[]);
  const moved=path.join(s.store.vaultDir,'renamed.md');fs.renameSync(file,moved);
  assert.equal((await s.search('新词乙乙')).results[0].path,'renamed.md');
  const copy=path.join(s.store.vaultDir,'duplicate.md');fs.copyFileSync(moved,copy);
  assert.deepEqual(ids(await s.search('新词乙乙')),[]); assert.ok(s.store.conflicts.some(c=>c.id==='stable'));
  fs.unlinkSync(copy); assert.deepEqual(ids(await s.search('新词乙乙')),['stable']);
  fs.writeFileSync(moved,'---\nid: [invalid\n---\n新词乙乙');
  const invalid=await s.search('新词乙乙');assert.deepEqual(ids(invalid),[]);assert.equal(invalid.diagnostics.sync.readFiles,1);
  fs.writeFileSync(moved,raw);assert.deepEqual(ids(await s.search('旧词甲甲')),['stable']);
  s.store.lastFullScan=0;
  assert.equal((await s.search('旧词甲甲')).diagnostics.sync.mode,'full');
  assert.equal((await s.search('旧词甲甲')).diagnostics.sync.mode,'incremental');
});

test('internal saves, deletion, historical restoration and rebuild preserve authoritative content and vectors', async t => {
  const {s}=harness(t), n=note(s,'versioned','原版紫微');
  await s.search('原版紫微');
  s.store.db.prepare('UPDATE index_chunks SET vector=?,model=? WHERE noteId=?').run('[1,0]','synthetic','versioned');
  const changed=s.store.update(n.id,{expectedHash:n.hash,meta:{topic:'新主题'}});
  assert.equal((await s.search('原版紫微',{topic:'新主题'})).results[0].id,n.id);
  assert.ok(s.store.db.prepare('SELECT vector FROM index_chunks WHERE noteId=?').get(n.id).vector);
  const edited=s.store.update(n.id,{expectedHash:changed.hash,body:'新版太微'});
  assert.deepEqual(ids(await s.search('紫微')),[]);
  assert.deepEqual(ids(await s.search('新版太微')),['versioned']);
  const version=s.store.db.prepare('SELECT id FROM versions WHERE noteId=? AND hash=? LIMIT 1').get(n.id,n.hash);
  s.store.restoreVersion(n.id,version.id,edited.hash);
  assert.deepEqual(ids(await s.search('原版紫微')),['versioned']);
  const chunks=s.store.db.prepare('SELECT * FROM index_chunks').all();
  s.store.searchIndex.rebuild();
  assert.deepEqual(s.store.db.prepare('SELECT * FROM index_chunks').all(),chunks);
  const current=s.store.read(n.id);s.store.delete(n.id,current.hash);
  assert.deepEqual(ids(await s.search('原版紫微')),[]);
  assert.equal(s.store.db.prepare('SELECT count(*) n FROM search_documents').get().n,0);
});

test('filtering precedes rank and composite cursor pages have no omission or duplicate', async t => {
  const {s}=harness(t);
  for(let i=0;i<37;i++)note(s,`p${String(i).padStart(2,'0')}`,'同分分页核对',{topic:i<25?'目标':'其他',sources:[{id:'source_a',role:'input'}],stage:i%3?'candidate':'core'});
  note(s,'retired','同分分页核对',{stage:'retired',topic:'目标'});
  note(s,'superseded','同分分页核对',{supersededBy:'p00',topic:'目标'});
  note(s,'excerpt','同分分页核对',{excerptOnly:true,topic:'目标'});
  note(s,'mistake','同分分页核对',{topic:'目标'},'mistake');
  const filters={topic:'目标',source:'source_a',limit:4}, seen=[];
  let cursor;
  do {const result=await s.search('同分分页核对',{...filters,cursor}); assert.equal(result.total,25);seen.push(...ids(result));cursor=result.nextCursor;}while(cursor);
  assert.equal(seen.length,25);assert.equal(new Set(seen).size,25);
  assert.deepEqual([...seen].sort(),Array.from({length:25},(_,i)=>`p${String(i).padStart(2,'0')}`));
  const initial=await s.search('同分分页核对',{...filters});
  for(const value of ['null','{}','{"session":"x","id":"x","score":"0"}']) await assert.rejects(s.search('同分分页核对',{...filters,cursor:Buffer.from(value).toString('base64url')}),{code:'SEARCH_CURSOR_INVALID'});
  await assert.rejects(s.search('同分分页核对',{...filters,topic:'其他',cursor:initial.nextCursor}),{code:'SEARCH_CURSOR_STALE'});
  note(s,'new','同分分页核对',{topic:'目标'});
  await assert.rejects(s.search('同分分页核对',{...filters,cursor:initial.nextCursor}),{code:'SEARCH_CURSOR_STALE'});
  assert.deepEqual(ids(await s.search('同分分页核对',{browse:true,stage:'retired'})),['retired']);
  assert.deepEqual(ids(await s.search('同分分页核对',{browse:true,kind:'mistake'})),['mistake']);
  assert.deepEqual(ids(await s.search('同分分页核对',{to:'1900-01-01'})),[]);
});

test('only the current result page hydrates bodies and a restarted process drains durable index dirtiness', async t => {
  const h=harness(t), {s}=h;
  for(let i=0;i<18;i++)note(s,'r'+i,'按页读取合成正文');
  await s.search('按页读取');
  const read=s.store.read.bind(s.store);let reads=0;
  s.store.read=id=>{reads++;return read(id);};
  const list=s.store.list.bind(s.store);s.store.list=()=>{throw new Error('search must not load every body');};
  const result=await s.search('按页读取',{limit:3});
  assert.equal(result.results.length,3);assert.equal(reads,3);assert.equal(result.diagnostics.bodyReads,3);
  s.store.list=list;
  note(s,'durable','中断后索引待处理');
  assert.ok(s.store.db.prepare('SELECT 1 FROM search_dirty WHERE id=?').get('durable'));
  await h.reopen(); assert.deepEqual(ids(await h.s.search('中断后索引待处理')),['durable']);
  await assert.rejects(h.s.search('按页读取',{limit:3,cursor:result.nextCursor}),{code:'SEARCH_CURSOR_STALE'});
});

test('failed index update rolls back projection and retains durable dirty work for retry', async t => {
  const {s}=harness(t),n=note(s,'rollback','原始索引词');await s.search('原始索引词');
  s.store.update(n.id,{expectedHash:n.hash,body:'新的索引词'});
  s.store.db.exec("CREATE TRIGGER fail_search BEFORE UPDATE ON search_documents BEGIN SELECT RAISE(ABORT,'synthetic index failure'); END");
  await assert.rejects(s.search('新的索引词'),/synthetic index failure/);
  assert.equal(s.store.db.prepare('SELECT count(*) n FROM search_fts').get().n,1);
  assert.ok(s.store.db.prepare('SELECT 1 FROM search_dirty').get());
  s.store.db.exec('DROP TRIGGER fail_search');
  assert.deepEqual(ids(await s.search('新的索引词')),['rollback']);
});

test('each Store isolates formal/practice projection and pagination identity', async t => {
  const a=harness(t),b=harness(t);
  for(let i=0;i<3;i++)note(a.s,'same'+i,'正式专属索引词');
  note(b.s,'same0','练习专属索引词');
  const first=await a.s.search('正式专属索引词',{limit:1});
  assert.equal((await b.s.search('正式专属索引词')).results.length,1,'old overlap can match shared Chinese characters');
  assert.ok(!(await b.s.search('正式专属索引词')).results.some(r=>r.body.includes('正式')));
  await assert.rejects(b.s.search('正式专属索引词',{limit:1,cursor:first.nextCursor}),{code:'SEARCH_CURSOR_STALE'});
  assert.equal((await a.s.search('正式专属索引词')).total,3);
});

test('abrupt process exit before projection sync recovers from the committed dirty journal', async t => {
  const h=harness(t);await h.close();
  const child=spawnSync(process.execPath,['--input-type=module','-e',
    "import {createService} from './src/service.mjs'; const s=createService(JSON.parse(process.argv[1])); s.store.create({id:'crash',kind:'knowledge',title:'中断',body:'crashRecoveryZVQX'}); process.exit(77);",
    JSON.stringify(h.config)],{cwd:path.resolve(import.meta.dirname,'..'),encoding:'utf8',windowsHide:true});
  assert.equal(child.status,77,child.stderr);
  await h.reopen();assert.deepEqual(ids(await h.s.search('crashRecoveryZVQX')),['crash']);
  h.s.store.db.exec('DELETE FROM search_fts');await h.reopen();
  assert.deepEqual(ids(await h.s.search('crashRecoveryZVQX')),['crash'],'missing FTS rows rebuild from authoritative notes');
});

test('semantic fusion keeps per-note best chunks and cached pages never re-embed the query', async t => {
  let calls=0;
  const h=harness(t,{embed:async()=>{calls++;return {vectors:[[1,0]]};}}),{s}=h;
  s.updateSettings({embedding:{enabled:true,model:'synthetic'}});
  for(let i=0;i<7;i++)note(s,'hybrid'+i,i===0?'exact ZVQX':'独立语义段落'+i);
  s.store.db.prepare('UPDATE index_chunks SET vector=?,model=?').run('[1,0]','synthetic');
  const first=await s.search('ZVQX',{mode:'hybrid',privacy:'cloud',limit:2});
  assert.equal(first.results[0].id,'hybrid0');assert.deepEqual(new Set(first.results[0].via),new Set(['keyword','semantic']));
  const seen=ids(first);let cursor=first.nextCursor;
  while(cursor){const result=await s.search('ZVQX',{mode:'hybrid',privacy:'cloud',limit:2,cursor});seen.push(...ids(result));cursor=result.nextCursor;}
  assert.equal(new Set(seen).size,7);assert.equal(seen.length,7);assert.equal(calls,1);
  await s.search('ZVQX',{mode:'hybrid',privacy:'local'});assert.equal(calls,1);
});
