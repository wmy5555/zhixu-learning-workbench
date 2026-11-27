import { escape as e, markdown, safeLink } from './markdown.mjs';
import { list, details, readable, facts, routeButton as link } from './ui.mjs';

export function evidenceHTML(items, limitations = []) {
  return list(limitations).map(v=>`<p class="notice">${e(v)}</p>`).join('') + (list(items).map(item=>{
    const id=item.sourceId||item.noteId||item.id,url=safeLink(item.url);
    return `<section class="evidence-entry"><h3>${e(item.title||'出处')}</h3><div class="preserve-text">${e(item.excerpt||'尚无摘录')}</div>${facts([['定位',item.locator],['角色',item.role],['理由',item.rationale],['读取时间',item.fetchedAt],['核验时间',item.researchedAt]])}<div class="actions">${id?link('阅读保存的原文 ↗',`read/${id}`,'text-button'):''}${url?`<a class="text-button" href="${e(url)}" target="_blank" rel="noopener noreferrer">外部原文 ↗</a>`:''}</div>${list(item.sources).length?details('底层来源',evidenceHTML(item.sources)):''}</section>`;
  }).join('')||'<p class="notice">没有可追溯引用；这份内容不能视为有据回答。</p>');
}
export function feedbackHTML(feedback) {
  if(!feedback)return '';
  const labels={correct:'回答正确',partial:'仍有遗漏',incorrect:'需要修正',ambiguous:'存在不确定性'};
  const section=(title,value)=>value?`<section>${title?`<h3>${title}</h3>`:''}<div class="article-prose">${markdown(readable(value)).html}</div></section>`:'';
  return `<div class="learning-feedback"><p class="nav-label">AI 反馈 · ${e(labels[feedback.assessment]||feedback.assessment)}</p>${section('',feedback.feedback)}${details('查看解析',section('关键缺口',feedback.omission)+section('修正与依据',feedback.correction)+section('可修改的建议',feedback.suggestion)+section('后续练习',feedback.nextQuestion))}</div>`;
}
export function completionHTML(completion) {
  if(!completion)return '';
  const d=completion.evidence||{},yes=value=>value===true?'是':value===false?'否':'未记录';
  return details('本次完成的证据',facts([['记录时间',d.completedAt],['独立作答',yes(d.independent)],['使用提示',yes(d.usedHints)],['观察到错误',yes(d.errorObserved)],['存在争议',yes(d.ambiguous)],['复习已结算',yes(completion.reviewSettled)],['复习间隔',completion.interval==null?'未更新':`${completion.interval} 天`],['跨日回忆',yes(d.spacedRecall)],['解释练习',yes(d.explanationPractice)],['应用练习',yes(d.applicationPractice)],['学习深度',d.depth],['依据轮次',list(d.turnIds).join('、')]]));
}
