const clean=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max ? v.trim() : null;
const quoteText=value=>String(value).replace(/[\r\n]+/g,' ').replace(/([\[\]_*\x60<>])/g,'\\$1');
export function discoveryFindings(value, notes) {
  if(!value||!Array.isArray(value.findings))throw Object.assign(new Error('发现建议格式无效，已保留调用结果；不会自动重发。'),{code:'MODEL_FORMAT'});
  const byId=new Map(notes.map(n=>[n.id,n])),accepted=[],seen=new Set();let rejected=0;
  for(const row of value.findings){
    const title=clean(row?.title,40),insight=clean(row?.insight,100),task=clean(row?.task,100),boundary=clean(row?.boundary,80);
    if(!title||!insight||!task||!boundary||!["comparison","application"].includes(row?.type)||title.length+insight.length+task.length+boundary.length>240||!Array.isArray(row.evidence)||row.evidence.length!==2){rejected++;continue;}
    const evidence=row.evidence.map(e=>({note:byId.get(e?.noteId),quote:clean(e?.quote,160)}));
    if(evidence.some(e=>!e.note||!e.quote||e.quote.length<6||!e.note.summary.includes(e.quote))||evidence[0].note.id===evidence[1].note.id){rejected++;continue;}
    const sourceIds=n=>n.sourceIds?.length?n.sourceIds:['note:'+n.id];
    if(sourceIds(evidence[0].note).some(id=>sourceIds(evidence[1].note).includes(id))){rejected++;continue;}
    const key=evidence.map(e=>e.note.id).sort().join(':');if(seen.has(key)||accepted.length>=2){rejected++;continue;}seen.add(key);
    accepted.push({title,insight,task,boundary,type:row.type,evidence:evidence.map(e=>({noteId:e.note.id,title:e.note.title,quote:e.quote}))});
  }
  return {findings:accepted,rejected};
}
export function discoveryMarkdown(result){
  if(!result.findings.length)return '没有足够依据提出新的跨资料建议。';
  return result.findings.map(f=>`### ${quoteText(f.title)}

${quoteText(f.insight)}

试一试：${quoteText(f.task)}

适用边界：${quoteText(f.boundary)}

${f.evidence.map(e=>`依据：[${quoteText(e.title)}](#read/${encodeURIComponent(e.noteId)})：“${quoteText(e.quote)}”`).join('\n\n')}`).join('\n\n');
}
