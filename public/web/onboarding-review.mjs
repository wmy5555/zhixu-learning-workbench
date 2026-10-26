// Follow one real review session; this module never creates sessions or learning evidence.
export function isReviewSession(session,proof){
 if(!session?.id||session.noteId!==proof?.roles?.explain||session.presetCase||session.completion?.abandoned)return false;
 const created=Date.parse(session.createdAt),now=Date.parse(proof?.clock?.now);
 if(!Number.isFinite(created)||!Number.isFinite(now))return false;
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:proof.clock.timezone,year:'numeric',month:'2-digit',day:'2-digit'});
 return day.format(created)===day.format(now);
}

export async function resolveReviewSession({proof,current,read}){
 if(isReviewSession(current,proof))return current;
 const id=proof?.roles?.currentSession;
 if(!id)return null;
 let saved;
 try{saved=await read(id);}catch(error){if(error.code==='NOT_FOUND')return null;throw error;}
 return isReviewSession(saved,proof)?saved:null;
}

export function reviewGuide({root,route,proof,session,visible}){
 const pick=selector=>[...root.querySelectorAll(selector)].find(visible)||null;
 const result=(phase,target,instruction)=>({phase,target,instruction});
 if(root.querySelectorAll('dialog[open]').length)return result('dialog',null,'请先完成或关闭当前窗口，再继续这条知识的复习。');
 const noteId=String(proof?.roles?.explain||'').replace(/[^a-zA-Z0-9_-]/g,'');
 if(route==='study'&&noteId){
  const sessionId=String(session?.id||'').replace(/[^a-zA-Z0-9_-]/g,'');
  const resumable=isReviewSession(session,proof)&&(session.status!=='completed'||session.completion?.reviewSettled);
  const resume=resumable?pick(`#main [data-route="study/${sessionId}"]`):null;
  if(resume)return result('resume',resume,'点击这条知识的本轮记录，继续原来的复习；已有回答和反馈会保留。');
  return result('start',pick(`#main [data-action="start-note"][data-id="${noteId}"]`),'点击这条知识的“开始”，进入本次到期复习。');
 }
 if(!isReviewSession(session,proof)||route!==`study/${session.id}`)return result('missing',null,'请重新定位本条知识的到期复习，原回答和进度会保留。');
 if(session.status==='completed'){
  if(!session.completion?.reviewSettled)return result('retry',pick('#main [data-route="study"]'),'这轮记录已保留，但未计入到期复习。请回到学习池，重新开始本条知识的练习。');
  return result('completed',pick('#main .completion-note'),'本轮复习已保存。点击“检查这一步／继续”，核对记录后进入下一步。');
 }
 if(session.status==='awaiting_feedback'||session.pendingJobId)return result('waiting',pick('#main .waiting-note'),'你的回答已保存，请等待反馈；无需重复提交。反馈返回后，再结束本轮学习。');
 const hide=pick('#main [data-action="hide-material"]');
 if(hide)return result('hide',hide,'读完本轮材料后，点击“合上材料，试着解释”，再亲自回答当前问题。');
 if(session.turns?.length&&session.turns.every(turn=>turn.feedback))return result('finish',pick('#main [data-action="finish"]:not([disabled])'),'阅读本轮反馈后，点击“结束本轮学习”结算复习；不必为了继续引导再提交一份回答。');
 const answer=pick('#answer-form textarea');
 if(answer?.value.trim())return result('submit',pick('#answer-form button[type="submit"]'),'确认自己的回答后，点击“保存回答，获取反馈”。这次请求可能产生模型费用。');
 return result('answer',answer,'请用自己的话回答本轮问题，写好后点击“保存回答，获取反馈”。');
}
