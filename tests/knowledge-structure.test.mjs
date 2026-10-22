import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createService } from '../src/service.mjs';
import { validateKnowledgeStructure } from '../src/knowledge-structure.mjs';
import { structureRecord, structureView } from '../src/source-structure.mjs';
import { selectKnowledgeView } from '../public/knowledge-view.mjs';
const source = { id:'source', hash:'synthetic', body:'先检查水温。水温合适时加入茶叶。2024年开始记录。证据支持定时记录。' };
const notes = [{id:'a',title:'检查',body:'检查水温'}, {id:'b',title:'加入',body:'加入茶叶'}, {id:'c',title:'记录',body:'开始记录'}];
const ref = quote => [{quote}];
const raw = () => ({version:2, units:[
  {id:'a',shortTitle:'检查水温',dimensions:['factual','procedural'],roles:['step'],sourceRefs:ref('先检查水温。')},
  {id:'b',dimensions:['procedural'],roles:['step'],sourceRefs:ref('水温合适时加入茶叶。')},
  {id:'c',dimensions:['unknown'],roles:['event'],eventTime:'2024年',sourceRefs:ref('2024年开始记录。')}],
  topics:[{id:'t',title:'操作',parent:null,origin:'ai',members:['a','b']},{id:'t2',title:'观察',parent:null,origin:'ai',members:['a','c']}],
  edges:[{from:'a',to:'b',type:'condition',label:'合适时继续',condition:'水温合适',status:'explicit',direction:'from-to',sourceRefs:ref('水温合适时加入茶叶。')}]});

test('mixed classification, shared memberships and source locations survive structure persistence', () => {
  const result=structureRecord(source,notes,raw());
  assert.equal(result.version,2); assert.deepEqual(result.units[0].dimensions,['factual','procedural']);
  assert.equal(result.topics.flatMap(t=>t.members).filter(id=>id==='a').length,2);
  assert.equal(result.units[0].sourceRefs[0].start,0); assert.equal(result.semanticCheck,'pending');
  const view=structureView(source,notes,result); assert.equal(view.edges[0].condition,'水温合适');
  assert.equal(selectKnowledgeView(view),'overview');
  assert.equal(selectKnowledgeView(view,'flow'),'flow');
  assert.equal(selectKnowledgeView({units:[],topics:[],edges:[]}),'list');
});

test('invalid IDs, positions, cycles, missing conditions and unsupported directions become gaps', () => {
  const input=raw(); input.topics[0].parent='t2';input.topics[1].parent='t';
  input.units[0].sourceRefs=[{quote:'编造'}];input.units[1].dimensions=['invented'];
  input.edges.push({...input.edges[0],from:'missing'}, {...input.edges[0],condition:'',type:'condition'}, {...input.edges[0],type:'cause',direction:'to-from'});
  const valid=validateKnowledgeStructure(input,source,notes);
  assert.equal(valid.edges.length,1);assert.equal(valid.units[0].sourceRefs.length,0);
  assert.deepEqual(valid.units[1].dimensions,['unknown']);assert.ok(valid.gaps.length>=5);
  assert.ok(valid.topics.some(t=>t.parent===null));assert.deepEqual(valid.hierarchy,undefined);
  const saved=structureRecord(source,notes,input);assert.ok(structureView(source,notes,saved).gaps.some(g=>g.includes('端点')));
  const ambiguous=validateKnowledgeStructure({units:[{id:'a',sourceRefs:ref('重复')}],edges:[]},{...source,body:'重复重复'},notes);
  assert.equal(ambiguous.units[0].sourceRefs.length,0);
});

test('mathematical is-a and support remain separate from topic navigation', () => {
  const math={id:'s',hash:'m',body:'正方形是一种矩形。若整数n为偶数，则n平方为偶数。'};
  const input={version:2,units:[],topics:[{id:'m',title:'数学',members:['a','b']}],edges:[{from:'a',to:'b',type:'is-a',label:'是一种',status:'inferred',sourceRefs:ref('正方形是一种矩形。')}]};
  const result=structureRecord(math,notes,input);assert.equal(result.hierarchy.length,0);
  assert.equal(result.edges[0].type,'is-a');assert.equal(result.edges[0].status,'inferred');assert.equal(selectKnowledgeView(result),'concept');
  assert.ok(result.gaps.some(g=>g.includes('AI 推断')));
});

test('one extraction persists v2; user revisions survive reanalysis and backup; stale revision rejected', async t => {
  fs.mkdirSync('.tmp',{recursive:true}); const root=fs.mkdtempSync(path.resolve('.tmp/knowledge-v2-'));
  let response, calls=0;
  const s=createService({dataDir:path.join(root,'data'),vaultDir:path.join(root,'vault'),aiOverride:{generate:async()=>{calls++;return{text:JSON.stringify(response)}},withBudget:async(_,fn)=>fn()}});
  t.after(async()=>{await s.close();fs.rmSync(root,{recursive:true,force:true});});
  const generated=raw();const index=new Map(notes.map((n,i)=>[n.id,String(i)]));
  generated.units.forEach(u=>u.id=index.get(u.id));generated.topics.forEach(t=>t.members=t.members.map(id=>index.get(id)));generated.edges.forEach(e=>{e.from=index.get(e.from);e.to=index.get(e.to)});
  response={candidates:notes.map(n=>({title:n.title,body:n.body,claims:[]})),structure:generated};
  const imported=s.importItems({items:[{title:'合成茶叶记录',body:source.body}],process:true});await s.runJobs();
  const id=imported.notes[0].id, first=s.readPublicNote(id);assert.equal(calls,1);assert.equal(first.structure.version,2);
  const draft=structuredClone(first.structure);draft.units[0].shortTitle='用户保留标题';
  s.editSourceStructure(id,{structure:draft,revision:first.structure.revision});
  assert.throws(()=>s.editSourceStructure(id,{structure:draft,revision:first.structure.revision}),/结构已变化/);
  response={structure:{...first.structure,units:first.structure.units.map(u=>({...u,shortTitle:'新模型标题'}))}};
  const job=s.requestSourceStructure(id);for(let i=0;i<8&&s.store.get('jobs',job.id).state==='queued';i++)await s.runJobs();assert.equal(s.store.get('jobs',job.id).state,'done',JSON.stringify(s.store.get('jobs',job.id)));
  const revised=s.readPublicNote(id);assert.equal(revised.structure.units[0].shortTitle,'用户保留标题');assert.equal(revised.structure.hasPendingCandidate,true);
  assert.equal(s.getNote(id).body,source.body);assert.ok(JSON.stringify(s.backup()).includes('用户保留标题'));
  const current=s.getNote(id);s.editNote(id,{expectedHash:current.hash,body:source.body+'补充说明。'});
  assert.equal(s.readPublicNote(id).structure.state,'stale');
  const next=s.requestSourceStructure(id);for(let i=0;i<8&&s.store.get('jobs',next.id).state==='queued';i++)await s.runJobs();
  const stale=s.readPublicNote(id).structure;assert.equal(stale.hasPendingCandidate,true);assert.deepEqual(stale.edges,[]);
  s.editSourceStructure(id,{structure:stale.pendingCandidate,revision:stale.revision});
  assert.notEqual(s.readPublicNote(id).structure.state,'stale');

});


test('model output cannot claim user provenance and time labels require matching original excerpts', () => {
  const input=raw();input.edges[0].status='user';input.topics[0].origin='user';input.units[2].eventTime='2030年';
  const saved=structureRecord(source,notes,input);
  assert.equal(saved.edges[0].status,'pending');assert.equal(saved.topics[0].origin,'ai');assert.equal(saved.units[2].eventTime,'');
  assert.ok(saved.gaps.some(g=>g.includes('时间标签')));
});
