export const isStudyRelearn=id=>['study-hide','study-answer','study-feedback','study-finish'].includes(id);
export function currentStudyId(state,proof){
 const session=state.session;
 return session?.id&&state.route===`study/${session.id}`&&session.noteId===proof?.roles?.explain&&!session.presetCase?session.id:'';
}
export async function resolveRelearnSession({state,proof,read}){
 if(currentStudyId(state,proof))return state.session;
 if(!proof?.roles?.currentSession)return null;
 let session;try{session=await read(proof.roles.currentSession);}catch(error){if(['NOT_FOUND','SESSION_NOT_FOUND'].includes(error.code))return null;throw error;}
 return session?.id===proof.roles.currentSession&&currentStudyId({session,route:`study/${session.id}`},proof)?session:null;
}
export function relearnProof(proof,stepId,enabled){
 if(!enabled||stepId!=='output-draft')return proof;
 return {...proof,progress:{...proof.progress,[stepId]:{...proof.progress?.[stepId],status:'pending'}}};
}
export function relearnStudyGuide({root,state,proof,step,visible}){
 if(!isStudyRelearn(step.id))return null;
 const pick=selector=>[...root.querySelectorAll(selector)].find(visible)||null,result=(phase,target,instruction)=>({phase,target,instruction});
 if(root.querySelectorAll('dialog[open]').length)return result('covered',null,'先看完当前窗口，关闭后再继续本步。已有回答和完成记录保留。');
 if(state.route==='study'){
  const noteId=String(proof?.roles?.explain||'').replace(/[^a-zA-Z0-9_-]/g,'');
  return result('start',pick(`#main [data-action="start-note"][data-id="${noteId}"]`),'点击这条知识的“开始”再练一轮；原回答与反馈会保留，AI 操作仍需你亲自提交。');
 }
 if(!currentStudyId(state,proof))return null;
 const session=state.session;
 if(session.status==='awaiting_feedback'||session.pendingJobId)return result('waiting',pick('#main .waiting-note'),'当前回答正在等待反馈。先等本轮返回，再复看回答与反馈；不需要重复提交。');
 if(session.status==='completed'){
  const target=pick(step.id==='study-answer'?'#main .learning-turn .answer-prose':step.id==='study-feedback'?'#main .learning-feedback':'#main .completion-note');
  return result('completed',target||pick('#main .completion-note'),'这轮已结束，可以复看自己的回答和反馈。要重新作答，点击页面上的“回到学习池”，再手动开始新一轮。');
 }
 const hide=pick('#main [data-action="hide-material"]');
 if(hide)return result('hide',hide,'先读一遍本轮材料，再点击“合上材料，试着解释”，继续本步练习。');
 if(step.id==='study-hide')return result('hidden',pick('#answer-form textarea'),'材料已经合上，当前回答保留。可以继续解释；需要重读时使用页面上的“再看原文”，这会记录本轮使用过辅助。');
 if(step.id==='study-feedback'&&!session.turns?.length)return result('answer',pick('#answer-form textarea'),'本轮还没有反馈。先写下自己的回答，再亲自提交获取反馈；这次 AI 操作可能计费。');
 if(step.id==='study-finish'&&!session.turns?.length)return result('answer',pick('#answer-form textarea'),'先完成一次回答并收到反馈，再结束本轮学习。已有记录保留，不会自动代答或结算。');
 return null;
}
