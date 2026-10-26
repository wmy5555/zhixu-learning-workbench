// Content-bound, read-only card adapter. Never infer a scored answer from unstructured prose.
const text=(value,max=6000)=>typeof value==='string'?value.trim().slice(0,max):'';
const types=new Set(['lesson','quiz','flash','compare']);
export async function bodyDigest(body){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(body||'')));return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');}
function normalize(raw){
 if(!raw||!types.has(raw.type)||!/^[-a-z0-9_]{1,64}$/i.test(raw.id||'')||!text(raw.title))return null;
 const c={id:raw.id,type:raw.type,title:text(raw.title,180),intro:text(raw.intro,400),prerequisites:Array.isArray(raw.prerequisites)?raw.prerequisites.filter(v=>typeof v==='string').slice(0,12):[]};
 if(c.type==='lesson'){
  if(!Array.isArray(raw.pages)||!raw.pages.length||raw.pages.length>7||raw.pages.some(p=>!text(p?.title)||!text(p?.body)))return null;
  c.pages=raw.pages.map(p=>({title:text(p.title,180),body:text(p.body),takeaway:text(p.takeaway,600)}));
 }
 if(c.type==='quiz'){
  if(!text(raw.question)||!Array.isArray(raw.options)||raw.options.length<2||raw.options.length>6)return null;
  if(raw.options.some(o=>!/^[-a-z0-9_]{1,40}$/i.test(o?.id||'')||!text(o.text)||!text(o.explanation)))return null;
  c.options=raw.options.map(o=>({id:o.id,text:text(o.text,1000),explanation:text(o.explanation,2000)}));
  if(new Set(c.options.map(o=>o.id)).size!==c.options.length||!c.options.some(o=>o.id===raw.correctOptionId))return null;
  c.question=text(raw.question,1200);c.correctOptionId=raw.correctOptionId;
 }
 if(c.type==='flash'){
  if(!text(raw.question)||!text(raw.answer)||!text(raw.explanation))return null;
  c.question=text(raw.question,1200);c.answer=text(raw.answer,600);c.explanation=text(raw.explanation,2500);
 }
 if(c.type==='compare'){
  const v=raw.compare;if(!text(v?.leftLabel)||!text(v?.rightLabel)||!Array.isArray(v.rows)||!v.rows.length||v.rows.length>6||v.rows.some(r=>!text(r?.label)||!text(r.left)||!text(r.right)))return null;
  c.compare={leftLabel:text(v.leftLabel,100),rightLabel:text(v.rightLabel,100),rows:v.rows.map(r=>({label:text(r.label,100),left:text(r.left,900),right:text(r.right,900)}))};
 }
 return c;
}
export async function buildDiscoveryCatalog(notes,{digest=bodyDigest}={}){
 const usable=(Array.isArray(notes)?notes:[]).filter(n=>n&&['knowledge','source'].includes(n.kind)&&n.meta?.stage!=='retired'&&!n.meta?.deleted&&!n.meta?.trashed);
 const knowledge=usable.filter(n=>n.kind==='knowledge'),pool=knowledge.length?knowledge:usable;const cards=[];
 for(const note of pool){
  const basisHash=await digest(note.body),meta=note.meta?.discovery;
  const base={noteId:note.id,topic:text(note.meta?.topic,100)||'未归类',body:String(note.body||''),noteTitle:String(note.title||'未命名知识'),preview:note.meta?.discoveryPreview===true,basisHash};
  cards.push({...base,id:`${note.id}:reading`,type:'reading',title:base.noteTitle,sourceHash:basisHash,prerequisites:[],stale:Boolean(meta&&meta.sourceHash!==basisHash)});
  if(meta?.version!==1||meta.sourceHash!==basisHash||!Array.isArray(meta.cards))continue;
  const candidates=meta.cards.slice(0,32).map(normalize).filter(Boolean),counts=new Map();candidates.forEach(c=>counts.set(c.id,(counts.get(c.id)||0)+1));
  const valid=new Map(candidates.filter(c=>counts.get(c.id)===1).map(c=>[c.id,c]));
  const ready=(id,path=new Set())=>{if(path.has(id)||!valid.has(id))return false;const next=new Set(path).add(id);return valid.get(id).prerequisites.every(p=>ready(p,next));};
  for(const c of candidates){if(!ready(c.id))continue;cards.push({...base,...c,id:`${note.id}:${c.id}`,sourceHash:await digest(basisHash+'\n'+JSON.stringify(c)),prerequisites:c.prerequisites.map(id=>`${note.id}:${id}`)});}
 }
 return cards;
}
