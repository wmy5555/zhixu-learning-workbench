// Prepare the next window before motion begins. Recommendation eligibility stays in the ranker.
export function planFlowTail({history=[],seenIds=[],rank}){
 const fresh=rank({excludeIds:[...new Set([...seenIds,...history.map(c=>c.id)])],limit:12});
 if(fresh.length)return fresh;
 const recent=history.slice(-3).map(c=>c.id),last=history.at(-1);
 for(const excludeIds of [recent,last?[last.id]:[],[]]){const next=rank({excludeIds,limit:12});if(next.length)return next;}
 return [];
}

const stop=new Set(['这个','这种','一个','一次','可以','可能','表示','自己','需要','没有','时候','什么','如何','已经','就是','不能','以及','之后','当前','如果','不是','进行','通过','我们','它们','还是','使用','内容','知识','这次','变成','说明','不用','知道','开始','得到','只是','一定','那么','成为','哪一','哪种']);
const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter('zh',{granularity:'word'}):null;
export function contentTags(card,provided=[]){
 const scores=new Map(),valid=word=>/^[\p{L}\p{N}_+-]{2,12}$/u.test(word)&&!stop.has(word)&&word!==card.topic;
 const add=(word,score)=>{word=String(word).trim();if(valid(word))scores.set(word,(scores.get(word)||0)+score);};
 for(const tag of Array.isArray(provided)?provided:[])add(tag,100);
 for(const [text,weight] of [[card.title,8],[card.question,6],[card.body,1]]){
  const value=String(text||'').slice(0,5000),words=segmenter?[...segmenter.segment(value)].filter(s=>s.isWordLike).map(s=>s.segment):value.match(/[A-Za-z0-9]{2,12}|[\p{Script=Han}]{2,8}/gu)||[];
  for(const word of words)add(word,weight);
 }
 return [...scores].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'zh')).slice(0,3).map(([tag])=>tag);
}
