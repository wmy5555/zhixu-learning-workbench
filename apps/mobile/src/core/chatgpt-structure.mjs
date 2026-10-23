// Frozen desktop business rules; platform import adaptation only unless documented.
import { z } from 'zod';
import { createHash } from '../platform/crypto.js';
import { dimensions, roles, relationTypes } from './knowledge-structure.mjs';
import { structureRecord, structureView } from './source-structure.mjs';
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const id = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const text = max => z.string().min(1).max(max);
const item = z.object({ id, title: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(30000),
  type: z.enum(['knowledge','conclusion','unverified_fact']), sourceMessageIds: z.array(id).min(1).max(200),
  uncertainties: z.array(z.string().trim().min(1).max(2000)).max(20) }).strict();
const ref = z.object({ messageId: id, quote: text(700), start: z.number().int().min(0).optional(), end: z.number().int().min(1).optional() }).strict();
const refs = z.array(ref).max(20);
const topicId = z.string().min(1).max(100).regex(/^\S(?:[\s\S]*\S)?$/, '主题编号不能包含外围空白');
export const structuredSchema = z.discriminatedUnion('version', [
  z.object({ version:z.literal(1), items:z.array(item).max(100) }).strict(),
  z.object({ version:z.literal(2), items:z.array(item).min(1).max(100),
    units:z.array(z.object({ id, shortTitle:text(36), dimensions:z.array(z.enum(dimensions)).min(1).max(5),
      roles:z.array(z.enum(roles)).min(1).max(9), sourceRefs:refs, eventTime:z.string().max(80).optional() }).strict()).min(1).max(100),
    topics:z.array(z.object({ id:topicId, title:text(80), parent:topicId.nullable(),
      origin:z.enum(['original','ai']), members:z.array(id).max(100), sourceRefs:refs }).strict()).max(200),
    edges:z.array(z.object({ from:id, to:id, type:z.enum(relationTypes), label:text(24), direction:z.literal('from-to'),
      status:z.enum(['explicit','inferred','pending']), condition:z.string().max(700), exceptions:z.string().max(700),
      explanation:z.string().max(700), sourceRefs:refs.refine(v=>v.length>0) }).strict()).max(2000),
  }).strict(),
]);
function invalid(message) { throw Object.assign(new Error(message), {code:'CHATGPT_STRUCTURE_INVALID',status:400}); }
// Resolve only against original message text, never the summary or embedded structured JSON.
export function validateImportedStructure(input, messages) {
  if (!input) return;
  if (!structuredSchema.safeParse(input).success || input.items.some(i=>!/^[A-Za-z0-9_-]{1,200}$/.test(i.id)||i.sourceMessageIds.some(id=>!/^[A-Za-z0-9_-]{1,200}$/.test(id)))) invalid('结构化导入格式无效。');
  const items = new Map(input.items.map(i=>[i.id,i])), source = new Map(messages.map(m=>[m.id,m.content]));
  if (items.size!==input.items.length) invalid('结构化条目编号不得重复。');
  for (const i of input.items) if (i.sourceMessageIds.some(k=>!source.has(k))) invalid('结构化候选引用了未保存的消息。');
  if (input.version!==2) return;
  const seen = new Set();
  function checkRefs(values, allowed) { for (const r of values) {
    const body=source.get(r.messageId);
    if (typeof body!=='string' || allowed && !allowed.includes(r.messageId)) invalid('原文引用的消息不在授权来源内。');
    const start=r.start ?? body.indexOf(r.quote), end=r.end ?? start+r.quote.length;
    if ((r.start===undefined)!==(r.end===undefined) || r.start===undefined && body.indexOf(r.quote)!==body.lastIndexOf(r.quote) || start<0 || end>body.length || end<=start || body.slice(start,end)!==r.quote) invalid('原文引用不存在、偏移错误或存在歧义。');
  } }
  for (const u of input.units) {
    if (!items.has(u.id)||seen.has(u.id)) invalid('分类单元必须唯一对应真实条目。');
    seen.add(u.id); checkRefs(u.sourceRefs,items.get(u.id).sourceMessageIds);
    if (u.eventTime && !u.sourceRefs.some(r=>r.quote.includes(u.eventTime))) invalid('时间标签缺少原文依据。');
  }
  if (seen.size!==items.size) invalid('每条拆解必须有一个分类单元。');
  const topics=new Map(input.topics.map(t=>[t.id,t]));
  if (topics.size!==input.topics.length) invalid('主题编号不得重复。');
  for (const t of input.topics) {
    if (t.members.some(k=>!items.has(k))) invalid('主题成员不存在。');
    checkRefs(t.sourceRefs);
    if (t.origin==='original'&&!t.sourceRefs.length) invalid('原文主题缺少依据。');
    const chain=new Set([t.id]); let parent=t.parent;
    while(parent!==null) { if (!topics.has(parent)||chain.has(parent)) invalid('主题层级循环或父主题不存在。'); chain.add(parent); parent=topics.get(parent).parent; }
  }
  const edges=new Set();
  for (const e of input.edges) {
    const key=JSON.stringify([e.from,e.to,e.type,e.condition]);
    if (!items.has(e.from)||!items.has(e.to)||e.from===e.to||edges.has(key)) invalid('关系端点无效或关系重复。');
    edges.add(key);checkRefs(e.sourceRefs,[...items.get(e.from).sourceMessageIds,...items.get(e.to).sourceMessageIds]);
    if (e.type==='condition'&&!e.condition.trim()) invalid('条件关系缺少条件。');
  }
}
export function literalText(value) {
  let n=3;for(const m of value.matchAll(/`+/g)) n=Math.max(n,m[0].length+1);
  const fence='`'.repeat(n);return `${fence}text\n${value}\n${fence}`;
}
export function conversationSegments(source, messages) {
  const blocks=messages.map((m,i)=>`### ${i+1}. ${m.role==='user'?'用户':'ChatGPT'}\n\n${m.id?`消息编号：${literalText(m.id)}\n\n`:''}${literalText(m.content)}`);
  const tail=blocks.join('\n\n');if(!source.body.endsWith(tail)) invalid('原文模板无法定位。');
  let position=source.body.length-tail.length;
  return messages.map((m,i)=>{ const block=blocks[i], prefix=block.length-literalText(m.content).length;
    const start=position+prefix+literalText(m.content).indexOf('\n')+1;position+=block.length+2;
    return {messageId:m.id,from:0,to:m.content.length,sourceId:source.id,start,content:m.content}; });
}
export function batchSegments(sources, plan) {
  return plan.parts.flatMap((part,i)=>{
    const source=sources[i];
    const blocks=part.fragments.map(f=>{
      const prefix=`### ${f.messageIndex+1}. ${f.role==='user'?'用户':'ChatGPT'}\n\n原消息编号与字符范围：\n\n${literalText(JSON.stringify({messageId:f.messageId,start:f.charStart,end:f.charEnd,messageCharacters:f.messageCharacters}))}\n\n`;
      return {prefix,body:prefix+literalText(f.content)};
    });
    const heading='## 原始消息片段\n\n',tail=heading+blocks.map(b=>b.body).join('\n\n');
    if(!source.body.endsWith(tail))invalid('分片原文模板无法定位。');
    let position=source.body.length-tail.length+heading.length;
    return part.fragments.map((f,j)=>{
      const start=position+blocks[j].prefix.length+literalText(f.content).indexOf('\n')+1;
      position+=blocks[j].body.length+2;
      return {messageId:f.messageId,from:f.charStart,to:f.charEnd,sourceId:source.id,start,content:f.content};
    });
  });
}

export function importedRecord(input, source, notes, keys, segments, sources, savedAt, owner) {
  const byMessage=new Map();
  for(const segment of segments){if(!byMessage.has(segment.messageId))byMessage.set(segment.messageId,[]);byMessage.get(segment.messageId).push(segment);}
  const originals=new Map([...byMessage].map(([id,parts])=>{parts.sort((a,b)=>a.from-b.from);return[id,parts.map(s=>s.content).join('')];}));
  const mapRefs=values=>values.flatMap(r=>{
    const all=byMessage.get(r.messageId)||[],body=originals.get(r.messageId)||''; const start=r.start??body.indexOf(r.quote),end=r.end??start+r.quote.length;
    const result=all.filter(s=>s.from<end&&s.to>start).map(s=>{const a=Math.max(start,s.from),b=Math.min(end,s.to);return{sourceId:s.sourceId,start:s.start+a-s.from,end:s.start+b-s.from,quote:body.slice(a,b)};});
    if(result.reduce((n,r)=>n+r.quote.length,0)!==r.quote.length || result.length>20)invalid('跨片来源无法完整定位。');return result;
  });
  const mapped=values=>{const result=mapRefs(values);if(result.length>20)invalid('映射后的来源数量超过上限。');return result;};
  const raw={version:2,units:input.units.map(u=>({...u,sourceRefs:mapped(u.sourceRefs)})),topics:input.topics.map(t=>({...t,sourceRefs:mapped(t.sourceRefs)})),edges:input.edges.map(e=>({...e,sourceRefs:mapped(e.sourceRefs)}))};
  const record=structureRecord({...source,structureSources:sources},notes,raw,keys);
  record.generatedAt=savedAt;
  record.chatgptStructure={version:2,owner,inputSha256:hash(input),sourceIds:sources.map(s=>s.id),noteIds:notes.map(n=>n.id)};
  return record;
}
// SQLite writes are atomic; checkpoint the exact before/after images before mutation.
export function saveImportedRecord(store,state,record,persist) {
  const id=record.sourceId;
  if(!state.structureWrite) {
    const previous=store.get('sourceStructures',id), oldHash=previous?hash(previous):null;
    if (!previous && state.previousStructureHash) throw Object.assign(new Error('既有结构记录缺失，不会自动重建。'),{code:'CHATGPT_STRUCTURE_UNAVAILABLE',status:409});
    const managed=previous&&state.previousStructureHash===oldHash&&!previous.userEdited;
    const preserve=!!previous&&!managed;
    const target=preserve?{...previous,pendingCandidate:record}:record;
    state.structureWrite={sourceId:id,beforeHash:oldHash,target,status:preserve?'preserved_edits':'verified',phase:'prepared'};persist();
  }
  const write=state.structureWrite,current=store.get('sourceStructures',id),digest=current?hash(current):null,targetHash=hash(write.target);
  if(digest!==targetHash) {
    if(write.phase!=='prepared'||digest!==write.beforeHash)throw Object.assign(new Error('结构已编辑或写入状态不明，保留现有内容。'),{code:'CHATGPT_STRUCTURE_EDITED',status:409});
    write.phase='started';persist();store.put('sourceStructures',id,write.target);
  }
  if(hash(store.get('sourceStructures',id))!==targetHash)invalid('结构持久化读回不一致。');
  write.phase='written';persist();return verifyImportedRecord(store,state);
}
export function verifyImportedRecord(store,state) {
  const write=state.structureWrite;if(!write)return null;
  const current=store.get('sourceStructures',write.sourceId);
  if(!current)throw Object.assign(new Error('结构记录缺失。'),{code:'CHATGPT_STRUCTURE_UNAVAILABLE',status:409});
  const exact=hash(current)===hash(write.target);
  return {version:2,sourceId:write.sourceId,status:exact?write.status:'preserved_edits',revision:hash(current),inputSha256:(write.target.pendingCandidate||write.target).chatgptStructure.inputSha256};
}
// Reuse the existing graph reader; only bound batch siblings are added to its context.
export function importedContext(store, source, stored=store.get('sourceStructures',source.id)) {
  const marker=stored?.pendingCandidate?.chatgptStructure||stored?.chatgptStructure;
  let notes=store.list().filter(n=>n.kind==='knowledge'&&!n.meta.excerptOnly&&((n.meta.sources||[]).some(r=>r.id===source.id&&r.role==='input')||n.meta.processKey?.split(':')[0]===source.id));
  notes.sort((a,b)=>(Number(a.meta.processKey?.split(':').at(-1))||0)-(Number(b.meta.processKey?.split(':').at(-1))||0));
  if(!marker)return{source,notes,stored};
  notes=notes.filter(n=>marker.noteIds.includes(n.id)||!(n.meta.chatgptImport?.sessionHash===marker.owner||n.meta.chatgptHistoryBatchImport?.batchId===marker.owner));
  const sources=marker.sourceIds.map(id=>store.row(id)?store.read(id):{id,hash:'missing',body:''});
  for(const id of marker.noteIds)if(!notes.some(n=>n.id===id)&&store.row(id))notes.push(store.read(id));
  notes.sort((a,b)=>{const index=id=>{const at=marker.noteIds.indexOf(id);return at<0?Number.MAX_SAFE_INTEGER:at;};return index(a.id)-index(b.id);});
  return{source:{...source,structureSources:sources},notes,stored};
}
export function readImportedView(store,source) {
  const c=importedContext(store,source);return structureView(c.source,c.notes,c.stored);
}
