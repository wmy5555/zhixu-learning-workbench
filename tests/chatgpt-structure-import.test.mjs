import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createService} from '../src/service.mjs';
import {createChatgptBridge,conversationSchema,historyCaptureSchema,historyBatchCaptureSchema} from '../src/chatgpt.mjs';
import {createHistoryBatchStore} from '../src/chatgpt-history-batch-store.mjs';
import {readImportedView} from '../src/chatgpt-structure.mjs';
import {createApp} from '../src/server.mjs';
const digest=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const copy=x=>structuredClone(x);
function fixture(t) {
  const root=fs.mkdtempSync(path.resolve('.tmp/v2-import-'));
  const service=createService({dataDir:path.join(root,'data'),vaultDir:path.join(root,'vault')});
  service.updateSettings({mcp:{chatgptEnabled:true}});
  t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});return service;
}
const messages=()=>[{id:'m_a',role:'user',content:'先检查水温。\r\n代码：`C:\\new\\test`；字面量\\n；中文🙂é；\\u4e2d。'}, {id:'m_b',role:'assistant',content:'水温合适时加入茶叶。否则等待，不适用于冰泡。'}];
const ref=(messageId,quote)=>({messageId,quote});
const structure=()=>({version:2,items:[{id:'check',title:'检查',body:'检查水温，保留语境与代码。',type:'knowledge',sourceMessageIds:['m_a'],uncertainties:['水温阈值未知。']},{id:'add',title:'加入',body:'水温合适才加入；否则等待。',type:'conclusion',sourceMessageIds:['m_b'],uncertainties:[]}],
  units:[{id:'check',shortTitle:'检查水温',dimensions:['factual','procedural'],roles:['step'],sourceRefs:[ref('m_a','先检查水温。')]},{id:'add',shortTitle:'加入茶叶',dimensions:['procedural'],roles:['step'],sourceRefs:[ref('m_b','水温合适时加入茶叶。')]}],
  topics:[{id:'tea',title:'泡茶',parent:null,origin:'ai',members:['check','add'],sourceRefs:[]},{id:'conditions',title:'条件',parent:'tea',origin:'ai',members:['add'],sourceRefs:[]}],
  edges:[{from:'check',to:'add',type:'condition',label:'合适时继续',direction:'from-to',condition:'水温合适',exceptions:'不适用于冰泡',explanation:'否则等待',status:'explicit',sourceRefs:[ref('m_b','水温合适时加入茶叶。')]}]});
const request=extra=>({requestId:randomUUID(),title:'合成 v2',summary:'独立摘要',coverage:'current_context',messages:messages(),structured:structure(),sync:{conversationId:'synthetic',branchId:'active',snapshotId:'s_one',mode:'snapshot',complete:false},...extra});
function snapshot(units) {
  const now=Date.now(),items=units.map((m,index)=>({index,message_id:m.id,role:m.role,content:m.content,created_at:null,content_type:'text',rich_content:null}));
  return {version:1,conversation_id:'11111111-1111-4111-8111-111111111111',title:'合成历史',branch:'active',snapshot_id:'e'.repeat(32),transcript_sha256:digest(items),units:items,pages:[{range:{start:{message:0,offset:0},end:{message:items.length,offset:0}},hasMore:false}],coverage:{text:'complete_visible_active_branch'},warnings:[],issued_at:now,expires_at:now+60000};
}
const history=()=>({requestId:randomUUID(),historySnapshotRef:'zhixu-history-v1:'+'c'.repeat(64),summary:'独立摘要',structured:structure()});
function assertView(s,saved) {
  const view=s.readPublicNote(saved.noteId).structure;
  assert.equal(view.version,2);assert.notEqual(view.state,'stale');assert.equal(view.units.length,2);assert.equal(view.edges.length,1);
  assert.deepEqual(view.units[0].dimensions,['factual','procedural']);assert.equal(view.topics[1].parent,'tea');
  assert.equal(view.edges[0].condition,'水温合适');assert.equal(view.edges[0].exceptions,'不适用于冰泡');assert.equal(view.edges[0].direction,'from-to');
  assert.ok(saved.importedNoteIds.includes(view.edges[0].from));assert.ok(saved.importedNoteIds.includes(view.edges[0].to));
  for(const r of view.units.flatMap(u=>u.sourceRefs).concat(view.edges.flatMap(e=>e.sourceRefs)))assert.equal(s.getNote(r.sourceId).body.slice(r.start,r.end),r.quote);
  return view;
}
test('v2 ordinary capture maps graph IDs and exact original UTF-16 references; retry and v1 remain compatible',t=>{
  const s=fixture(t),input=request();for(const schema of [conversationSchema])assert.ok(schema.safeParse(input).success);
  assert.ok(historyCaptureSchema.safeParse(history()).success);assert.ok(historyBatchCaptureSchema.safeParse(history()).success);
  const saved=s.chatgpt.capture(input);assert.equal(saved.structure.status,'verified');assert.equal(saved.undo.supported,false);assert.throws(()=>s.chatgpt.previewUndo({requestId:input.requestId,noteId:saved.noteId,syncRevision:saved.syncRevision}),{code:'CHATGPT_UNDO_UNAVAILABLE'});const view=assertView(s,saved);
  const count=s.listNotes().length,structureHash=digest(s.store.get('sourceStructures',saved.noteId));
  assert.equal(s.chatgpt.capture(input).status,'already_saved');assert.equal(s.chatgpt.capture({...input,requestId:randomUUID()}).noteId,saved.noteId);
  assert.equal(s.listNotes().length,count);assert.equal(digest(s.store.get('sourceStructures',saved.noteId)),structureHash);
  assert.equal(s.store.records('calls').length,0);assert.equal(s.store.records('jobs').length,0);
  assert.throws(()=>s.chatgpt.readStructure(saved.noteId),{code:'CHATGPT_READ_DISABLED'});
  s.updateSettings({mcp:{chatgptAllowRead:true}});let result='',offset=0,revision;
  do{const page=s.chatgpt.readStructure(saved.noteId,{offset,limit:100});revision??=page.revision;assert.equal(page.revision,revision);result+=page.body;offset=page.nextOffset;}while(offset!==null);
  assert.deepEqual(JSON.parse(result).edges,view.edges);
  const v1=request({structured:{version:1,items:structure().items},sync:{...input.sync,conversationId:'v_one'}});
  v1.structured.items[0].id=' check ';v1.structured.items[0].sourceMessageIds=[' m_a '];
  const old=s.chatgpt.capture(v1);assert.equal(old.importedItems,2);assert.equal(old.structure,undefined);
});
test('invalid source refs, missing units, topic cycles and unsupported relation directions reject before writes',t=>{
  const s=fixture(t);for(const change of [v=>v.units[0].sourceRefs[0].quote='不存在',v=>v.units.pop(),v=>v.topics[0].parent='conditions',v=>v.edges[0].direction='to-from',v=>v.edges[0].to='missing',v=>v.units[0].sourceRefs[0].messageId='m_b',v=>v.edges[0].condition='']) {
    const input=request();change(input.structured);assert.throws(()=>s.chatgpt.capture(input));assert.equal(s.listNotes().length,0);
  }
  const ambiguous=request();ambiguous.messages[0].content='重复重复';ambiguous.structured.units[0].sourceRefs=[ref('m_a','重复')];assert.throws(()=>s.chatgpt.capture(ambiguous));
  ambiguous.structured.units[0].sourceRefs=[{...ref('m_a','重复'),start:2,end:4}];assert.equal(s.chatgpt.capture(ambiguous).structure.status,'verified');
});
test('human graph edits survive retry and later revision as a pending candidate',t=>{
  const s=fixture(t),input=request(),saved=s.chatgpt.capture(input),view=assertView(s,saved),edited=copy(view);edited.units[0].shortTitle='用户标题';
  s.editSourceStructure(saved.noteId,{structure:edited,revision:view.revision});
  assert.equal(s.chatgpt.capture(input).verification.status,'preserved_edits');assert.equal(s.chatgpt.capture(input).structure.status,'preserved_edits');
  const next=copy(input);next.requestId=randomUUID();next.sync.snapshotId='s_two';next.sync.baseRevision=1;next.structured.units[0].shortTitle='新建议';
  const reply=s.chatgpt.capture(next);assert.equal(reply.structure.status,'preserved_edits');
  const current=s.readPublicNote(saved.noteId).structure;assert.equal(current.units[0].shortTitle,'用户标题');assert.equal(current.pendingCandidate.units[0].shortTitle,'新建议');
});
test('authenticated snapshot path uses the same v2 structure contract without AI',async t=>{
  const s=fixture(t),source=snapshot(messages()),bridge=createChatgptBridge({getStore:()=>s.store,settings:()=>s.settings(),getNote:id=>s.getNote(id),receiveSnapshot:async()=>source});
  const input=history(),reply=await bridge.captureHistorySnapshot(input);assertView(s,reply);assert.equal((await bridge.captureHistorySnapshot(input)).structure.status,'verified');
  assert.equal(s.store.records('calls').length,0);
});
test('batch graph spans actual source parts without inventing provenance; edits remain protected',async t=>{
  const s=fixture(t),units=messages();units.splice(1,0,...Array.from({length:199},(_,i)=>({id:'padding_'+i,role:'user',content:'合成消息 '+i})));
  const batch=createHistoryBatchStore({getStore:()=>s.store,enabled:()=>true}),input=history(),reply=await batch.capture(snapshot(units),input,{referenceHash:digest(input.historySnapshotRef),inputDigest:digest([input.summary,input.structured,null])});
  assert.equal(reply.status,'saved',JSON.stringify({code:reply.code,problems:reply.verification?.problems}));assert.equal(reply.partCount,2);assert.equal(reply.structure.status,'verified');
  const view=readImportedView(s.store,s.getNote(reply.structure.sourceId));assert.equal(view.edges.length,1);assert.equal(view.units.length,2);assert.equal(view.topics[1].parent,'tea');
  assert.notEqual(view.units[0].sourceRefs[0].sourceId,view.units[1].sourceRefs[0].sourceId);
  assert.equal(s.readPublicNote(reply.structure.sourceId).children.length,2);
  assert.equal((await batch.findRetry(input)).status,'already_saved');
  const changed=copy(view);changed.units[0].shortTitle='人工批次标题';s.editSourceStructure(reply.structure.sourceId,{structure:changed,revision:view.revision});
  const retry=await batch.findRetry(input);assert.equal(retry.complete,false);assert.equal(retry.structure.status,'preserved_edits');assert.equal(readImportedView(s.store,s.getNote(reply.structure.sourceId)).units[0].shortTitle,'人工批次标题');
});
test('Unicode, literal escapes, code and CRLF are preserved through JSON, SQLite and markdown readback',t=>{
  const s=fixture(t),value=request(),transport=JSON.parse(JSON.stringify(value)),reply=s.chatgpt.capture(transport),note=s.getNote(reply.noteId);
  assert.deepEqual(note.meta.chatgptSync.snapshot.messages,value.messages);
  assert.ok(note.body.includes(value.messages[0].content));
  assert.equal(note.body.includes('\uFFFD'),false);
  assert.deepEqual(s.store.readPersisted(reply.noteId).meta.chatgptSync.snapshot.messages,value.messages);
});

test('new item content maps to new IDs without stale historic candidates and preserves a human old revision',t=>{
  const s=fixture(t),value=request(),first=s.chatgpt.capture(value);const next=copy(value);next.requestId=randomUUID();next.sync.baseRevision=1;next.sync.snapshotId='next';next.structured.items[0].body+='新上下文';
  const second=s.chatgpt.capture(next);assert.equal(second.structure.status,'verified');const view=s.readPublicNote(first.noteId).structure;assert.notEqual(view.state,'stale');assert.equal(view.nodes.length,2);assert.ok(second.importedNoteIds.includes(view.edges[0].from));
  const edited=copy(view);edited.units[0].shortTitle='人工保留';s.editSourceStructure(first.noteId,{structure:edited,revision:view.revision});
  const third=copy(next);third.requestId=randomUUID();third.sync.baseRevision=2;third.sync.snapshotId='third';third.structured.items[0].body+='再次变化';s.chatgpt.capture(third);
  const stale=s.readPublicNote(first.noteId).structure;assert.equal(stale.state,'stale');assert.equal(stale.hasPendingCandidate,true);
  s.editSourceStructure(first.noteId,{structure:stale.pendingCandidate,revision:stale.revision});assert.notEqual(s.readPublicNote(first.noteId).structure.state,'stale');
});
test('a quote across fragment boundaries maps to exact ranges in both sources',async t=>{
  const s=fixture(t),input=history(),units=messages();input.summary='## 原始消息片段\n\n伪造模板只属于摘要。';units[0].content='x'.repeat(119998)+'先检查水温。';
  const batch=createHistoryBatchStore({getStore:()=>s.store,enabled:()=>true});
  const saved=await batch.capture(snapshot(units),input,{referenceHash:digest(input.historySnapshotRef),inputDigest:digest([input.summary,input.structured,null])});assert.equal(saved.status,'saved');
  const view=readImportedView(s.store,s.getNote(saved.structure.sourceId)),refs=view.units[0].sourceRefs;assert.equal(refs.length,2);assert.equal(refs.map(r=>r.quote).join(''),'先检查水温。');
  for(const r of refs){const source=s.getNote(r.sourceId);assert.equal(source.body.slice(r.start,r.end),r.quote);assert.ok(r.start>source.body.lastIndexOf('## 原始消息片段'));}
});
test('an interrupted structure checkpoint recovers exact writes without duplicate notes; missing written record fails closed',t=>{
  const s=fixture(t),value=request(),put=s.store.put.bind(s.store);let injected=false;
  s.store.put=(namespace,key,data)=>{const result=put(namespace,key,data);if(namespace==='sourceStructures'&&!injected){injected=true;throw new Error('synthetic interruption');}return result;};
  assert.throws(()=>s.chatgpt.capture(value),/synthetic/);const count=s.listNotes().length;s.store.put=put;
  const recovered=s.chatgpt.capture(value);assert.equal(recovered.structure.status,'verified');assert.equal(s.listNotes().length,count);
  s.store.remove('sourceStructures',recovered.noteId);assert.throws(()=>s.chatgpt.capture(value),{code:'CHATGPT_STRUCTURE_UNAVAILABLE'});assert.equal(s.store.get('sourceStructures',recovered.noteId),null);
});

test('source quote end must remain within the original message even when slice would clamp it',t=>{
  const s=fixture(t),value=request(),body=value.messages[1].content,quote='不适用于冰泡。';
  value.structured.edges[0].sourceRefs=[{messageId:'m_b',quote,start:body.indexOf(quote),end:body.length+1}];
  assert.throws(()=>s.chatgpt.capture(value),{code:'CHATGPT_STRUCTURE_INVALID'});assert.equal(s.listNotes().length,0);
  value.structured.edges[0].sourceRefs[0].end=body.length;assert.equal(s.chatgpt.capture(value).structure.status,'verified');
});
test('topic identifiers cannot collide after downstream trimming',t=>{
  const s=fixture(t),value=request();value.structured.topics.push({...value.structured.topics[0],id:' tea '});
  assert.throws(()=>s.chatgpt.capture(value));assert.equal(s.listNotes().length,0);
  value.structured.topics.pop();value.structured.topics[1].parent=' tea ';assert.throws(()=>s.chatgpt.capture(value));assert.equal(s.listNotes().length,0);
});
test('a v2 to v1 update cannot undo away the retained v2 structure through the generic undo path',t=>{
  const s=fixture(t),value=request(),first=s.chatgpt.capture(value),before=s.store.get('sourceStructures',first.noteId);
  const next=copy(value);next.requestId=randomUUID();next.sync.snapshotId='legacy_after_v2';next.sync.baseRevision=1;next.structured={version:1,items:next.structured.items};
  const saved=s.chatgpt.capture(next);assert.throws(()=>s.chatgpt.previewUndo({requestId:next.requestId,noteId:saved.noteId,syncRevision:saved.syncRevision}),{code:'CHATGPT_UNDO_CONFLICT'});
  assert.deepEqual(s.store.get('sourceStructures',first.noteId),before);assert.equal(s.getNote(first.noteId).meta.chatgptSync.revision,2);
});
