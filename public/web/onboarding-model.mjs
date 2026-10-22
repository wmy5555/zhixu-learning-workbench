import {getCurriculum} from '../onboarding-curriculum.mjs';
export const speeds=Object.freeze([0.75,1,1.5,2]);
export const complete=value=>['done','demonstrated'].includes(value?.status);
const overrides={
 'setup-welcome':['从一个小小的起点开始','今日页汇集学习安排与处理动态。引导在独立练习库里进行，原始资料和自己的理解各自保留。'],
 'setup-model':['连接你的 AI','在“连接你的 AI”填写服务地址、模型和密钥，勾选启用。已有配置可以直接保留；密钥只填在设置中。'],
 'setup-save':['保存连接设置','点击“保存连接设置”。这是正式库和练习库共用的配置；保存不会调用模型。'],
 'setup-test':['确认连接已经准备好','点击“测试已保存的连接”，核对费用提示后自行确认。失败会保留配置，请检查原因后重试。'],
 'capture-save':['留下第一份练习资料','点击“填入练习材料”，核对原文和出处，保持 AI 拆解未勾选，再点击“保存这个起点”。'],
 'capture-source':['先看一眼完整的原文','在书桌中读完整的原始资料，再查看出处。原文和 AI 整理会分别保留。'],
 'library-explain':['选一条知识继续学习','先在引导卡片里选定当前原文下的真实候选知识，再打开“调整学习安排”，选择“加入学习”和“能用自己的话解释”，填写理由后保存。'],
 'study-hide':['合上材料，试着解释','点击“合上材料，试着解释”。把注意力移到问题与自己的回答上。'],
 'study-finish':['结束这次练习','等实际反馈返回后点击“结束本轮学习”。存在争议时保留记录，不伪造复习结算。'],
 'output-edit':['改写成自己的表达','打开本次草稿，改写正文，再点击“确认保存”。'],
 'output-use':['确认实际采用的知识','打开本次草稿，在“实际采用的知识”勾选真正使用的引用，然后确认保存。'],
};
export function guideSteps(materialId){return getCurriculum(materialId).coreSteps.map(s=>({...s,...(overrides[s.id]?{title:overrides[s.id][0],instruction:overrides[s.id][1]}:{})}));}
export function prerequisite(step,proof){
 if(!step.id.startsWith('setup-')&&!proof?.modelReady)return {id:'setup-test',message:'请先保存 AI 配置并测试成功，再进入实际练习。'};
 const roles=proof?.roles||{};
 if(['capture-source','capture-permission','process-ai','process-group','library-explain'].includes(step.id)&&!roles.capturedSource)return {id:'capture-save',message:'先保存这次练习的原始资料。'};
 if((step.id.startsWith('study-')||step.id.startsWith('review-'))&&!roles.explain)return {id:'library-explain',message:'先选定一条由当前原文整理出的知识。'};
 if(['output-edit','output-use','output-citations'].includes(step.id)&&!roles.draft)return {id:'output-draft',message:'请先实际生成并保存一份草稿。'};
 if(['process-group','library-explain'].includes(step.id)&&!complete(proof?.progress?.['process-ai']))return {id:'process-ai',message:'请先等待当前原文的实际拆解结果。'};
 if(['study-hide','study-answer','study-feedback','study-finish'].includes(step.id)&&!proof?.learningStarted)return {id:'study-start',message:'先开始选中知识的实际学习会话。'};
 if(step.id==='review-finish'&&!complete(proof?.progress?.['review-clock-due']))return {id:'review-clock-due',message:'先把练习时间前进到下一次复习。'};
 return null;
}
export function destination(step,proof,sessionId){
 const id=step.id,roles=proof?.roles||{};
 if(['setup-model','setup-save','setup-test'].includes(id))return 'settings';
 if(id==='setup-budget')return 'manage/usage';
 if(id==='capture-save')return 'capture';
 if(['capture-source','capture-permission','process-ai'].includes(id))return `read/${roles.capturedSource}`;
 if(id==='library-explain')return roles.explain?`read/${roles.explain}`:'library';
 if(id==='study-source-permission')return `read/${roles.capturedSource||roles.source}`;
 if(id==='study-permission'||id==='study-confirm')return `read/${roles.explain}`;
 if(['study-plan','review-clock-due','complete-review','setup-welcome'].includes(id))return 'today';
 if(id.startsWith('study-')&&!['study-start'].includes(id))return sessionId?`study/${sessionId}`:'study';
 if(id==='study-start'||id==='review-finish')return 'study';
 if(id==='search-keyword')return 'search';
 if(id.startsWith('output-'))return 'output';
 return 'library';
}
export function selectors(step,proof){
 const roles=proof?.roles||{},id=step.id,quote=v=>String(v||'').replace(/[^a-zA-Z0-9_-]/g,'');
 const map={
 'setup-welcome':['.hero'], 'setup-model':['#ai-form'], 'setup-save':['#ai-form button[type="submit"]'], 'setup-test':['[data-action="test-ai"]'], 'setup-budget':['#pricing'],
 'capture-save':['#capture-form button[type="submit"]'], 'capture-source':['.reading-scroll .article-prose','.reading-scroll'], 'capture-permission':['.reading-margin','.reading-scroll'],
 'process-ai':['dialog[open] [data-run]','[data-action="process"]','[data-action="reader-actions"]'], 'process-group':['#parity-library'],
 'library-explain':['dialog[open] [name="depth"]','[data-action="promote"]','[data-action="reader-actions"]','#parity-library'],
 'study-source-permission':['.reading-scroll'], 'study-permission':['.reading-scroll'], 'study-plan':['[data-action="generate"]'],
 'study-start':[`[data-action="start-note"][data-id="${quote(roles.explain)}"]`],
 'study-hide':['[data-action="hide-material"]','#answer-form textarea'], 'study-answer':['#answer-form textarea'], 'study-feedback':['.learning-feedback','.waiting-note'],
 'study-finish':['[data-action="finish"]','.completion-note'], 'study-confirm':['dialog[open] textarea','[data-action="understanding"]','[data-action="reader-actions"]'],
 'review-clock-due':['[data-guide="clock"]'], 'review-finish':[`[data-action="start-note"][data-id="${quote(roles.explain)}"]`,'#answer-form textarea','.learning-feedback','.completion-note'],
 'search-keyword':['#parity-search input[name="q"]'], 'output-draft':['#output-form textarea'], 'output-citations':['#output-result .output-document','#all-drafts'],
 'output-edit':['dialog[open] textarea',`[data-action="open-draft"][data-id="${quote(roles.draft)}"]`],
 'output-use':['dialog[open] [name="usedId"]',`[data-action="open-draft"][data-id="${quote(roles.draft)}"]`], 'complete-review':['.hero']};
 return map[id]||[];
}
export function intersection(a,b){return Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));}
export function sidePosition(target,{width,height,top=76,bottom=height-20},obstacles=[],previous){
 const size=44,gap=16,clamp=p=>({x:Math.max(12,Math.min(width-size-12,p.x)),y:Math.max(top,Math.min(bottom-size,p.y)),w:size,h:size});
 const candidates=[{x:target.x+target.w+gap,y:target.y+target.h/2-size/2},{x:target.x-gap-size,y:target.y+target.h/2-size/2},{x:target.x+target.w/2-size/2,y:target.y-gap-size},{x:target.x+target.w/2-size/2,y:target.y+target.h+gap}].map(clamp);
 const score=p=>intersection(p,target)*100+obstacles.reduce((n,r)=>n+intersection(p,r),0)*20;
 candidates.sort((a,b)=>score(a)-score(b));
 if(previous&&score(clamp(previous))===0&&Math.hypot(previous.x-candidates[0].x,previous.y-candidates[0].y)<80)return clamp(previous);
 return candidates[0];
}
export const intents=Object.freeze({setup:{label:'连接 AI',match:/配置|连接|模型|密钥|api/i,start:'setup-model'},capture:{label:'收集与加工',match:/收集|文章|资料|拆解|原文/,start:'capture-save'},study:{label:'开始学习',match:/学习|回答|理解|练习/,start:'library-explain'},review:{label:'到期复习',match:/复习|到期|遗忘/,start:'review-clock-due'},output:{label:'检索与输出',match:/检索|搜索|草稿|输出|引用/,start:'search-keyword'}});
export function suggestGoals(text){return Object.entries(intents).filter(([,v])=>v.match.test(text)).map(([id])=>id);}
