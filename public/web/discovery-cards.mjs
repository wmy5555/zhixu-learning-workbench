// Pure card content renderer. Navigation, persistence, gestures and learning evidence belong to the host.
export function renderLearningCard(card,progress={},helpers={}){
 const e=helpers.escape||escapeText,icon=helpers.icon||(()=>''),action=helpers.action||defaultAction;
 const text=value=>e(String(value??''));
 const paragraphs=value=>String(value??'').split(/\n\s*\n/).filter(Boolean).map(p=>`<p>${text(p)}</p>`).join('');
 const title=(label,copy=card.title)=>`<div class="lfc-eyebrow">${text(label)}</div><h2 class="lfc-title">${text(copy)}</h2>`;
 const next=()=>action('继续浏览 '+icon('arrow'),'feed-next','lfc-primary');
 const shell=(type,body)=>`<section class="lfc lfc-${type}" data-card-type="${type}">${body}</section>`;

 if(card.type==='lesson'){
  const pages=Array.isArray(card.pages)?card.pages:[],index=Math.min(Math.max(Math.floor(Number(progress.page))||0,0),Math.max(0,pages.length-1)),page=pages[index]||{title:card.title,body:card.intro||''};
  return shell('lesson',`<header class="lfc-lesson-head"><span class="lfc-eyebrow">微课</span><span class="lfc-page-count" aria-label="第 ${index+1} 页，共 ${Math.max(1,pages.length)} 页">${String(index+1).padStart(2,'0')} <i>/ ${String(Math.max(1,pages.length)).padStart(2,'0')}</i></span></header><p class="lfc-series">${text(card.title)}</p><h2 class="lfc-title">${text(page.title)}</h2><div class="lfc-prose">${paragraphs(page.body)}</div>${page.takeaway?`<aside class="lfc-takeaway"><span>带走这一点</span><p>${text(page.takeaway)}</p></aside>`:''}<footer class="lfc-lesson-footer"><div class="lfc-page-dots" aria-hidden="true">${pages.map((_,i)=>`<span class="${i===index?'current':i<index?'read':''}"></span>`).join('')}</div><div class="lfc-actions">${action('上一页','lesson-prev','lfc-text',index===0?'disabled':'')}${progress.completed?next():index<pages.length-1?action('下一页 '+icon('arrow'),'lesson-next','lfc-primary'):action('读完了，试着用一用 '+icon('arrow'),'lesson-complete','lfc-primary')}</div></footer>${progress.completed?'<p class="lfc-footnote">已完成阅读；独立作答会另行记录。</p>':''}`);
 }

 if(card.type==='quiz'){
  const options=Array.isArray(card.options)?card.options:[],selected=options.find(o=>o.id===progress.selected),submitted=Boolean(progress.submitted),correct=options.find(o=>o.id===card.correctOptionId),attempts=Array.isArray(progress.attempts)?progress.attempts:[];
  const first=progress.first||attempts.find(a=>a.firstAttempt)||attempts[0],firstOption=first&&options.find(o=>o.id===first.selected);
  const valid=Boolean(selected&&correct),won=valid&&selected.id===correct.id;
  const firstRecord=firstOption?`<div class="lfc-first-answer"><span>首次选择已保留</span><p>${text(firstOption.text)} <small>${first.correct?'答对':'答错'}</small></p></div>`:'';
  const result=submitted&&correct?`<section class="lfc-quiz-feedback" aria-live="polite" tabindex="-1"><span class="lfc-feedback-label ${won?'correct':'needs-work'}">${won?'这次判断正确':'先看看差在哪里'}</span><p class="lfc-correct-answer">${text(correct.text)}</p><div class="lfc-option-reasons">${options.map((o,i)=>`<p><b>${String.fromCharCode(65+i)} · ${text(o.text)}</b><span>${text(o.explanation)}</span></p>`).join('')}</div>${progress.assisted||attempts.length>1?'<p class="lfc-footnote">查看反馈后的重试，不计作新的独立回忆证据。</p>':''}</section>`:'';
  return shell('quiz',`${title('情境测验',card.question||card.title)}${card.intro?`<p class="lfc-intro">${text(card.intro)}</p>`:''}<div class="lfc-options" role="radiogroup" aria-label="选择一个答案">${options.map((o,i)=>{const chosen=progress.selected===o.id,css=submitted?(o.id===card.correctOptionId?'is-correct':chosen?'is-wrong':''):chosen?'is-selected':'';return action(`<span class="lfc-option-letter">${String.fromCharCode(65+i)}</span><span>${text(o.text)}</span>${submitted&&o.id===card.correctOptionId?icon('check'):''}`,'quiz-select',`lfc-option ${css}`,`data-option="${text(o.id)}" role="radio" aria-checked="${chosen}" ${submitted?'disabled':''}`);}).join('')}</div>${firstRecord}${result}${submitted?`<footer class="lfc-actions lfc-quiz-actions">${action('再试一次','quiz-retry','lfc-text')+next()}</footer>`:''}${!submitted&&first?'<p class="lfc-footnote">这次是看过反馈后的重试，首次选择保持不变。</p>':''}`);
 }

 if(card.type==='flash'){
  const revealed=Boolean(progress.revealed),rated=Boolean(progress.grade),assisted=Boolean(progress.assisted);
  const recall=progress.attempt??progress.originalAnswer??progress.draft??'';
  const answer=revealed?`<div class="lfc-flash-answer" aria-live="polite"><span>参考答案</span><strong>${text(card.answer)}</strong>${card.explanation?`<p>${text(card.explanation)}</p>`:''}</div>${String(recall).trim()?`<div class="lfc-own-answer"><span>揭晓前的回答</span><p>${text(recall)}</p></div>`:''}`:'';
  const controls=!revealed?`<label class="lfc-recall-label"><span>先在心里回答，也可以写下来</span><textarea name="flash-answer" aria-label="我的闪卡答案" maxlength="500" rows="2" placeholder="试着想起来…">${text(progress.draft)}</textarea></label>${action('核对答案 '+icon('arrow'),'flash-reveal','lfc-primary')}${action('还没学过，先看解释','flash-study','lfc-text lfc-study-first')}`:rated?`<div class="lfc-flash-receipt" role="status">${icon('check')}<p>${text(progress.receipt||'已记录本次自评')}</p><small>这是本次浏览的安排，不改变正式掌握等级。</small></div>${next()}`:assisted?`<p class="lfc-rating-instruction">这次先理解，隔开内容后再试着回忆。</p>${action('稍后再试 '+icon('arrow'),'flash-rate','lfc-primary','data-grade="again"')}`:`<p class="lfc-rating-instruction">按揭晓前的表现自评；答错选「没想起」。</p><div class="lfc-ratings">${[['again','没想起','答错或遗漏'],['hard','费力想起','答对但费力'],['good','想起了','正常回忆'],['easy','很轻松','几乎不费力']].map(([grade,label,help])=>action(`<b>${label}</b><small>${help}</small>`,'flash-rate',`lfc-rating ${grade}`,`data-grade="${grade}"`)).join('')}</div>`;
  return shell('flash',`<div class="lfc-flash-top"><span class="lfc-eyebrow">闪回</span><span>${rated?'已记录':assisted?'先学一遍':revealed?'核对与自评':'一个明确的事实'}</span></div><div class="lfc-flash-question"><span class="lfc-q" aria-hidden="true">Q.</span><h2 class="lfc-title">${text(card.question||card.title)}</h2></div>${answer}<div class="lfc-flash-actions">${controls}</div>`);
 }

 if(card.type==='compare'){
  const comparison=card.compare||{},rows=Array.isArray(comparison.rows)?comparison.rows:[];
  return shell('compare',`${title('放在一起看')}${card.intro?`<p class="lfc-intro">${text(card.intro)}</p>`:''}<div class="lfc-comparison" role="table" aria-label="${text(card.title)}"><div class="lfc-comparison-head" role="row"><span role="columnheader">比较维度</span><strong role="columnheader">${text(comparison.leftLabel)}</strong><strong role="columnheader">${text(comparison.rightLabel)}</strong></div>${rows.map(row=>`<div class="lfc-comparison-row" role="row"><span role="rowheader">${text(row.label)}</span><p role="cell">${text(row.left)}</p><p role="cell">${text(row.right)}</p></div>`).join('')}</div><footer class="lfc-actions">${next()}</footer><p class="lfc-footnote">看清区别后，再用一个新情景检验。</p>`);
 }

 return shell('reading',`${title('读一点')}${card.intro?`<p class="lfc-intro">${text(card.intro)}</p>`:''}<div class="lfc-prose">${paragraphs(card.body)}</div>`);
}

function escapeText(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function defaultAction(label,name,css='',attrs=''){return `<button type="button" class="${escapeText(css)}" data-feed-action="${escapeText(name)}" ${attrs}>${label}</button>`;}
