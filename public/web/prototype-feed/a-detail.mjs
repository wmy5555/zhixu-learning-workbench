// Original teaching examples for the synthetic prototype notes; no real library or AI calls.
const examples = {
  recall:{headline:'把“眼熟”，变成能独立说清楚。',scene:'读完一页“主动回忆”，你觉得自己都懂了。现在把书合上。',try:'试着向朋友解释：它是什么、怎么做、什么时候需要回看材料。卡住的那一处，就是这次要补的地方。',boundary:'能复述一句话，还不等于能解释或应用。不要用刷过、收藏过或看了几遍，替代自己的回答。',steps:['合上材料，先说自己的解释。','用一个例子检验解释是否清楚。','只针对卡住的部分回看、修正。'],reflection:'下次读完一页，我先合上书，试着……'},
  correlation:{headline:'一起变化，是线索，还不是原因。',scene:'天气变热时，冰淇淋销量上升，游泳的人也多了。',try:'先提出几种解释：是冰淇淋让人去游泳，还是炎热的天气同时影响了两者？再想想，哪种证据能区分它们。',boundary:'提出一个“第三因素”也不等于已经证实它。保留多种解释，再用证据缩小范围。',steps:['把观察到的共同变化说清楚。','列出共同因素或反向作用的可能。','寻找能区分解释的证据。'],reflection:'以后看到“因为 A，所以 B”，我先问……'},
  spacing:{headline:'先试着想起，再决定重读哪里。',scene:'今天打开一条几天前学过的笔记。第一反应是从头再看一遍。',try:'先停一下：只看标题，用自己的话写出记得的内容。再打开正文，对照具体遗漏，而不是只判断“好像还记得”。',boundary:'没有适合所有材料和所有人的固定复习间隔。安排要结合实际回答，不由阅读次数决定。',steps:['先回忆，不急着展开原文。','对照材料，找到具体遗漏。','留下这次回答，为下次复习提供线索。'],reflection:'我下次复习的第一步是……'},
  smallstep:{headline:'把远处的目标，变成眼前的一步。',scene:'“这周学会编程”很难直接开始，也很难判断做到没有。',try:'把今天的一步改成：写一个能计算两数之和的小程序，然后用自己的话解释输入、处理和输出。',boundary:'小步骤只是帮助开始。完成很多容易的动作，不代表离真正目标更近；还要检查产出是否服务于目标。',steps:['选一个明确的小问题。','写下今天能做的动作和范围。','用一个可观察的结果检查这一步。'],reflection:'我想推进的目标是……今天先做……'},
  transfer:{headline:'先对照条件，再决定能不能照搬。',scene:'你会按一道例题的步骤操作，但题目一换人物、数字或情境就卡住了。',try:'暂时放下步骤，先说出原方法依赖什么条件。把这些条件逐条放进新情境，看哪些还成立，哪些已经改变。',boundary:'表面相似不保证适用。同样的词、相近的结果，都不能替代对必要条件的核对。',steps:['说清原方法依赖的条件。','比较新旧场景的相同与不同。','说明一个不能直接套用的边界。'],reflection:'这个方法能用的前提是……不能直接用在……'},
  explain:{headline:'让第一次听的人，也能跟上你的思路。',scene:'朋友问你一个熟悉的概念，你立刻说出好几个专业术语，但他还是没听懂。',try:'换成一个核心意思、一个熟悉的例子，再补充一个不能省略的条件。最后请他用自己的例子复述。',boundary:'说得简单不保证观点正确。必要的条件和依据不能为了顺口而删掉，也不要把对方点头当作理解证据。',steps:['先用熟悉的语言说明核心意思。','用具体例子连接抽象概念。','请对方解释，核对理解是否一致。'],reflection:'如果不用术语，我会这样解释……'},
};

export function detailStudyHTML(n,r,{e,button,icon}){
  return `<span class="ad-kicker">${n.due?'今天复习':'把想法讲清楚'}</span><h2>${e(n.question)}</h2><p class="ad-study-copy">用自己的话回答。需要时再看原文。</p>${r.turns.length?`<div class="ad-feedback-preview"><span>${r.status==='completed'?'本轮已练':'已有 '+r.turns.length+' 次回答'}</span><p>${e(n.point)}</p><small>预设对照要点 · 非 AI 评分</small></div>`:''}${button((r.status==='completed'?'查看这次练习':r.draft||r.turns.length?'继续我的解释':'开始一轮解释')+icon('arrow'),'practice','','primary')}<div class="ad-study-foot">${r.sourceViewed?'已查看原文':'尚未查看原文'}${r.hintUsed?' · 已使用提示':''}</div>`;
}

export function renderADetail(n,r,helpers){
 const {e,button,icon}=helpers,x=examples[n.id];
 return `<section class="a-reading" data-note-id="${n.id}"><header class="ad-topbar">${button(icon('left')+'返回信息流','a-detail-back','aria-label="返回 A 信息流"','ad-back')}<span>${e(n.topic)}</span>${button(icon('star')+(r.saved?'已收藏':'收藏'),'a-detail-save',`aria-pressed="${r.saved}" aria-label="${r.saved?'取消收藏当前知识':'收藏当前知识'}"`,'ad-save')}</header><div class="ad-scroll" tabindex="0" data-note-id="${n.id}"><div class="ad-layout"><article class="ad-article"><header class="ad-hero ${n.color}"><div class="ad-hero-meta"><span>一个值得想清楚的问题</span><span>${r.status==='completed'?'本轮已练':n.due?'今天复习':'发现新知'}</span></div><h1 tabindex="-1">${e(n.title)}</h1><p>${e(x.headline)}</p></header><div class="ad-article-body"><section class="ad-explanation"><div class="ad-section-heading"><span>01</span><h2>先把这件事说清楚</h2></div>${n.body.split('。').filter(Boolean).map(p=>`<p>${e(p)}。</p>`).join('')}</section><section class="ad-example"><div class="ad-section-heading"><span>02</span><h2>放进一个具体场景</h2></div><p class="ad-scene">${e(x.scene)}</p><p>${e(x.try)}</p></section><section class="ad-boundary"><span>${icon('eye')} 别漏掉这个边界</span><p>${e(x.boundary)}</p></section><section class="ad-reflection"><div class="ad-section-heading"><span>03</span><h2>留一句自己的理解</h2></div><label class="sr-only" for="ad-reflection">我的一句话</label><textarea id="ad-reflection" name="reflection" maxlength="1200" rows="3" placeholder="${e(x.reflection)}">${e(r.reflectionDraft)}</textarea><div class="ad-reflection-actions"><span id="ad-reflection-state">${r.reflectionDraft.trim()!==r.reflection?'草稿已保留，尚未暂存':r.reflection?'已暂存于本次预览':'只保留在本次预览'}</span>${button('暂存这句话','a-reflection-save','','text-button')}</div></section><section class="ad-history" ${r.turns.length?'':'hidden'}><details><summary>这条知识的练习记录 <span data-ad-turn-count>${r.turns.length}</span></summary><div data-ad-history>${detailHistoryHTML(r,e)}</div></details></section><footer class="ad-source">${icon('book')}<div><span>${e(n.source)}</span><small>原始演示材料与练习回答分别保留</small></div>${button('查看原文','source','','text-button')}</footer></div></article><aside class="ad-aside"><section class="ad-study-card" id="ad-study-card">${detailStudyHTML(n,r,helpers)}</section><section class="ad-try-list"><h2>下次就这样试一次</h2><ol>${x.steps.map(step=>`<li>${e(step)}</li>`).join('')}</ol></section></aside></div></div><div class="ad-mobile-action">${button((r.status==='completed'?'查看这次练习':r.draft||r.turns.length?'继续解释':'试着讲一讲')+icon('arrow'),'practice','','primary')}</div></section>`;
}
export function detailHistoryHTML(r,e){return r.turns.map((turn,i)=>`<div class="ad-history-turn"><span>第 ${i+1} 次 · 我的回答</span><p>${e(turn.answer)}</p><small>${turn.sourceViewed?'作答前查看过原文':'未记录查看原文'}${turn.hintUsed?' · 使用过提示':''}</small></div>`).join('');}

// The entire detail page owns right swipes; vertical intent stays with native scrolling.
export function bindDetailBack(page,close,reduced){
 let start=null,animation=null,suppressClick=false;
 const down=e=>{
   if(e.button!==0||!e.isPrimary)return;
   animation?.cancel();page.style.transform='';suppressClick=false;
   start={id:e.pointerId,x:e.clientX,y:e.clientY,locked:false,dx:0};
   // Keep taps, focus and typing intact; a deliberate horizontal drag can start on controls too.
   if(e.pointerType==='mouse'&&!e.target.closest('button,a,input,textarea,select,summary,[contenteditable]'))e.preventDefault();
 };
 const move=e=>{
   if(start?.id!==e.pointerId)return;
   const dx=e.clientX-start.x,dy=e.clientY-start.y;
   if(!start.locked){
     if(Math.abs(dy)>12&&Math.abs(dy)>Math.abs(dx)){start=null;return;}
     if(dx<-12&&Math.abs(dx)>Math.abs(dy)*1.3){start=null;return;}
     if(dx<12||dx<Math.abs(dy)*1.3)return;
     start.locked=true;suppressClick=true;page.setPointerCapture(e.pointerId);page.classList.add('ad-dragging');
   }
   e.preventDefault();start.dx=dx;page.style.transform=`translateX(${Math.min(page.clientWidth*.65,Math.max(0,dx)*.8)}px)`;
 };
 const up=e=>{
   if(start?.id!==e.pointerId)return;
   const g=start;start=null;const from=page.style.transform;page.style.transform='';page.classList.remove('ad-dragging');
   if(page.hasPointerCapture(e.pointerId))page.releasePointerCapture(e.pointerId);
   if(e.type!=='pointercancel'&&g.locked&&g.dx>Math.min(90,page.clientWidth*.24)){close(true);return;}
   if(g.locked&&!reduced())animation=page.animate([{transform:from},{transform:'translateX(0)'}],{duration:220,easing:'cubic-bezier(.16,1,.3,1)'});
 };
 const click=e=>{if(suppressClick&&e.detail){suppressClick=false;e.preventDefault();e.stopImmediatePropagation();}};
 const drag=e=>e.preventDefault();
 page.addEventListener('pointerdown',down);page.addEventListener('pointermove',move);
 page.addEventListener('pointerup',up);page.addEventListener('pointercancel',up);
 page.addEventListener('click',click,true);page.addEventListener('dragstart',drag);
 return ()=>{animation?.cancel();page.classList.remove('ad-dragging');page.removeEventListener('pointerdown',down);page.removeEventListener('pointermove',move);page.removeEventListener('pointerup',up);page.removeEventListener('pointercancel',up);page.removeEventListener('click',click,true);page.removeEventListener('dragstart',drag);};
}
