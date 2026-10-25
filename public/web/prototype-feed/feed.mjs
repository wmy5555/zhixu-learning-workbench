// THROWAWAY UI: A immersive feed / B discovery grid + reader / C feed + practice desk.
// One route, ?variant=A|B|C; synthetic notes and in-memory state only.
import { bindImmersiveDeck, bindSheetHandle } from './immersive-deck.mjs';
import { mountMasonry, createSharedCoverTransition, bindPullReturn } from './discovery-layout.mjs';
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shapes = {
  leaf:'<path d="M5 19C2 9 8 3 20 3c1 12-5 18-15 16Z"/><path d="m4 20 12-12M8 16v-6m0 6h6"/>',
  home:'<path d="m3 10 9-7 9 7v10H15v-7H9v7H3Z"/>',
  book:'<path d="M12 5v16M12 5C8 3 4 3 2 4v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-2-1-6-1-10 1Z"/>',
  chat:'<path d="M4 4h16v13H9l-5 4ZM8 9h8m-8 4h5"/>',
  star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z"/>',
  heart:'<path d="M20.8 4.8c-2.2-2.2-5.8-1.8-8.8 1.5-3-3.3-6.6-3.7-8.8-1.5-3.6 4.2 1.6 9.5 8.8 15.2 7.2-5.7 12.4-11 8.8-15.2Z"/>',
  refresh:'<path d="M20 7v5h-5M4 17v-5h5M19 10a7 7 0 0 0-12-5L4 8m1 6a7 7 0 0 0 12 5l3-3"/>',
  up:'<path d="m6 15 6-6 6 6"/>', down:'<path d="m6 9 6 6 6-6"/>',
  left:'<path d="m15 6-6 6 6 6"/>', right:'<path d="m9 6 6 6-6 6"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  check:'<path d="m5 12 4 4L19 6"/>', arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  spark:'<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z"/>',
  eye:'<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
};
const icon = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${shapes[k] || shapes.book}</svg>`;
const button = (label, action, attrs = '', cls = '') => `<button type="button" data-action="${action}" ${attrs} class="${cls}">${label}</button>`;
const notes = [
  {id:'recall',topic:'学习方法',title:'明明看懂了，为什么一合上书就忘？',lines:['明明<mark>看懂了</mark>，','为什么','一合上书','就忘了？'],color:'sky',due:true,source:'演示笔记 · 主动回忆',tag:'主动回忆',copy:'熟悉一句话，和独立把它说出来，是两件事。',body:'重读时，页面提供了线索，内容可能显得熟悉。合上材料后，用自己的话解释并举例，可以暴露还无法独立说清楚的部分。发现缺口后再回看材料，修正自己的解释。熟悉感不等于能够独立解释，也不能只凭刷过一次判断掌握。',question:'如果朋友说“我已经看懂了”，你会怎样帮他检验？',point:'先合上材料，让他用自己的话解释，再针对说不清的地方核对。',follow:'如果他能背出原句，却举不出自己的例子，你会继续问什么？',hint:'试着区分“眼熟”与“能独立解释”。'},
  {id:'correlation',topic:'思维方式',title:'一起发生，就一定有因果吗？',lines:['一起发生，','就一定有','<mark>因果关系</mark>','吗？'],color:'peach',due:false,source:'演示笔记 · 因果与相关',tag:'独立思考',copy:'两个现象同步变化，原因也许藏在第三个变量里。',body:'两个现象一起变化，只说明存在相关线索，不能单凭这一点确认因果。两者可能受第三个因素影响，也可能是反向作用。提出因果解释时，应继续寻找可以区分这些解释的证据。',question:'夏天冰淇淋卖得多，游泳的人也多。你会怎么解释？',point:'同时增长可能受天气影响，不能直接推出购买冰淇淋导致游泳。',follow:'你会收集哪一种信息，区分“直接导致”和“共同受影响”？',hint:'看看有没有同时影响两件事的第三个因素。'},
  {id:'spacing',topic:'学习方法',title:'复习，不必等到“全忘了”',lines:['复习，','不必等到','<mark>全忘了</mark>','才开始。'],color:'lilac',due:true,source:'演示笔记 · 间隔复习',tag:'今天复习',copy:'今天先试着想起，再决定哪里值得重读。',body:'把复习分散到不同时间，每次先尝试回忆，再核对遗漏。复习安排应结合实际回答和使用情况调整，不能只按看过几遍来判定掌握。这里只演示复习入口，不给出适合所有人的固定间隔。',question:'下次复习这条知识时，你准备先做什么，为什么？',point:'先尝试回忆，再核对缺口；阅读次数不能替代独立回答的证据。',follow:'如果这次没能回忆出来，你准备如何调整下一步？',hint:'先回忆还是先打开笔记，哪种方式能暴露缺口？'},
  {id:'smallstep',topic:'行动方法',title:'计划总是落空？把第一步缩小一点',lines:['计划总落空？','也许是','<mark>第一步</mark>','太大了。'],color:'sage',due:false,source:'演示笔记 · 行动拆解',tag:'从小开始',copy:'“学英语”太远，“读完一段并复述”就在眼前。',body:'把笼统目标拆成能立即执行、能看见结果的一步。例如把“学英语”改成“读一段短文，合上后说出大意”。小步骤帮助开始，但仍需要检查它是否服务于真正目标，而不是只追求完成数量。',question:'把“我想学会编程”改写成一个今天能完成的小步骤。',point:'步骤应具体、可以执行并看见结果，同时与学习目标相关。',follow:'完成这一步后，你用什么结果判断自己学到了东西？',hint:'给出动作、范围和一个可观察的结果。'},
  {id:'transfer',topic:'思维方式',title:'换个题就不会，是哪一步没学会？',lines:['原题会做，','换个场景','怎么又','<mark>不会了</mark>？'],color:'butter',due:true,source:'演示笔记 · 迁移应用',tag:'举个例子',copy:'记住了例子，不等于看见例子背后的条件。',body:'迁移应用需要辨认原方法的适用条件，再对照新场景。不要只因为表面相似就照搬步骤。练习时可以先说清楚相同点、不同点和不适用的边界，再判断是否能采用这个方法。',question:'你会怎样判断一个学过的方法，能不能用到新场景？',point:'比较适用条件与边界，不只匹配表面相似之处。',follow:'举一个“看着很像，但其实不能直接套用”的例子。',hint:'先说成立条件，再比较新场景是否满足。'},
  {id:'explain',topic:'表达练习',title:'说得越复杂，就代表理解越深吗？',lines:['说得','越<mark>复杂</mark>，','就理解得','越深吗？'],color:'rose',due:false,source:'演示笔记 · 清楚表达',tag:'费曼练习',copy:'试试不用术语，让第一次听的人也能跟上。',body:'清楚表达可以检验自己是否理清概念之间的关系。尝试用熟悉的语言解释，再用一个例子说明；必要的条件与边界不能为了简短而省略。表达简洁本身也不保证观点正确，仍应保留依据。',question:'你准备怎样把一个熟悉的概念，讲给第一次听的人？',point:'用熟悉语言和例子解释，同时保留必要条件与依据。',follow:'你会怎样确认对方是真的理解，而不只是点头？',hint:'一个核心意思、一个具体例子，再加一个必要边界。'},
];
const variants = {A:'沉浸刷学',B:'图文发现',C:'边刷边练'};
const initialVariant = new URL(location.href).searchParams.get('variant');
const state = {variant:variants[initialVariant]?initialVariant:'A',filter:'all',index:0,order:notes.map(n=>n.id),reviewIds:[],refreshes:0,detail:false,records:{},interest:[]};
for(const n of notes) state.records[n.id]={saved:false,liked:false,seen:false,draft:'',turns:[],status:'idle',hintUsed:false,sourceViewed:false};
const current = () => notes.find(n=>n.id===visibleIds()[state.index]);
const record = n => state.records[n.id];
const visibleIds = () => state.order.filter(id=>state.filter==='review'?state.reviewIds.includes(id):state.filter==='saved'?record({id}).saved:true);
const dueLeft = () => notes.filter(n=>n.due&&record(n).status!=='completed').length;
const completed = () => notes.filter(n=>record(n).status==='completed').length;
const statusText = n => record(n).status==='completed'?'本轮已练':record(n).turns.length?'待结束本轮':n.due?'今天复习':'发现新知';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let toastTimer, motion, wheelTotal=0, wheelTime=0, lockedUntil=0, lastSourceFocus, deckController;
let masonry=null,releasePull=null;
const bMemory={scroll:0,origin:null};
const bTransition=createSharedCoverTransition(reduced);
function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,2600);}
function surfaceState(){console.info('[PROTOTYPE_STATE]',JSON.stringify(state));$('#prototype-state')?.setAttribute('title',`已练 ${completed()} · 待复习 ${dueLeft()} · 刷新 ${state.refreshes} 次`);}
function shell(){
 document.documentElement.dataset.variant=state.variant;
 $('#app').innerHTML=`<aside class="app-sidebar"><a class="brand" href="?variant=${state.variant}">${icon('leaf')}<span>知序</span></a><div class="sidebar-nav">${button(icon('spark')+'<span>发现</span>','filter','data-filter="all"',state.filter==='all'?'selected':'')}${button(icon('clock')+'<span>待复习</span><b>'+dueLeft()+'</b>','filter','data-filter="review"',state.filter==='review'?'selected':'')}${button(icon('star')+'<span>我的收藏</span>','filter','data-filter="saved"',state.filter==='saved'?'selected':'')}</div><div class="sidebar-bottom"><div class="avatar">知</div><span>我的学习空间</span></div></aside>
 <main class="workspace"><header class="topbar"><nav class="feed-tabs" aria-label="信息流分类">${button('推荐','filter','data-filter="all"',state.filter==='all'?'active':'')}${button(`待复习 <span>${dueLeft()}</span>`,'filter','data-filter="review"',state.filter==='review'?'active':'')}${button('收藏','filter','data-filter="saved"',state.filter==='saved'?'active':'')}</nav><div class="top-actions"><span class="session-progress">本次已练 <b>${completed()}</b> 条</span>${button(icon('refresh')+'<span>换一批</span>','refresh','aria-label="换一批知识"','refresh-button')}</div></header><div id="content"></div></main>
 <footer class="prototype-switcher"><span class="prototype-badge">原型 · 演示</span>${button(icon('left'),'variant-prev','aria-label="上一版"')}<span class="variant-name">${state.variant} <strong>${variants[state.variant]}</strong></span>${button(icon('right'),'variant-next','aria-label="下一版"')}<span class="switch-separator"></span>${button('状态','state','id="prototype-state" aria-label="查看原型状态"')}</footer>`;
 renderContent();surfaceState();
}
function poster(n,small=false){return `<div class="poster ${n.color} ${small?'mini-poster':''}"><div class="poster-top"><span>知序 / ${esc(n.topic)}</span><span>${n.due?'REVISIT':'A LITTLE THOUGHT'}</span></div><span class="quote-mark" aria-hidden="true">“</span><div class="poster-title">${n.lines.map(line=>`<div>${line}</div>`).join('')}</div><div class="poster-bottom"><span>${esc(n.tag)}</span><span class="poster-line"></span></div></div>`;}
function metadata(n){return `<div class="item-caption"><div class="item-author"><span class="tiny-avatar">知</span><b>${esc(n.source)}</b><span class="learning-status ${n.due?'due':''}">${statusText(n)}</span></div><p>${esc(n.copy)}</p><span class="hashtags"># ${esc(n.tag)} &nbsp; # ${esc(n.topic)}</span></div>`;}
function rail(n){const r=record(n);return `<div class="action-rail">${button(icon('heart')+'<span>有意思</span>','like',`aria-label="${r.liked?'取消感兴趣':'标记感兴趣'}" aria-pressed="${r.liked}"`,r.liked?'on':'')}${button(icon('chat')+'<span>讲一讲</span>','practice','aria-label="打开费曼练习"')}${button(icon('star')+`<span>${r.saved?'已收藏':'收藏'}</span>`,'save',`aria-label="${r.saved?'取消收藏':'收藏这条知识'}" aria-pressed="${r.saved}"`,r.saved?'on':'')}${button(icon('book')+'<span>原文</span>','source','aria-label="查看演示原文"')}</div>`;}
function stage(n){return `<div class="feed-stage" id="feed-stage"><div class="pull-indicator" role="status">${icon('refresh')}<span>下拉换一批</span></div><div class="gesture-surface" id="gesture-surface" tabindex="0" aria-label="知识信息流，向上下一条，首条向下刷新"><article class="current-card" data-note-id="${n.id}">${poster(n)}${metadata(n)}</article></div>${rail(n)}<div class="feed-pagination"><span>${String(state.index+1).padStart(2,'0')}<i>/ ${String(visibleIds().length).padStart(2,'0')}</i></span>${button(icon('up'),'prev','aria-label="上一条知识"'+(state.index===0?' disabled':''))}${button(icon('down'),'next','aria-label="下一条知识"')}</div><div class="stage-footer"><span class="scroll-hint">${icon('down')} 向上滑，遇见下一个想法</span>${button(n.due?'先试着回忆 '+icon('arrow'):'用自己的话讲一讲 '+icon('arrow'),'practice','','practice-cta')}</div></div>`;}
function nextBatchOrder(){
 const rotate=arr=>arr.length>1?[...arr.slice(1),arr[0]]:arr;
 const due=state.order.filter(id=>notes.find(n=>n.id===id).due&&record({id}).status!=='completed');
 const a=rotate(due),b=rotate(state.order.filter(id=>!due.includes(id))),result=[];
 while(a.length||b.length){if(a.length)result.push(a.shift());if(b.length)result.push(b.shift());}return result;
}
function immersiveItem(n,slot){
 return `<article class="a-slide ${slot===0?'current-card':''}" style="--slot:${slot}" data-note-id="${n.id}" ${slot===0?'':'aria-hidden="true" inert'}>
 <div class="a-cover">${poster(n)}<span class="a-state-chip">${n.due?icon('clock'):icon('spark')}${statusText(n)}</span></div>
 <div class="a-caption">${metadata(n)}<div class="a-card-footer">${button(icon('chat')+`<span>${record(n).draft?'继续刚才的解释…':record(n).turns.length?'回到这次练习…':n.due?'不看原文，还能讲清楚吗？':'用自己的话，讲给朋友听…'}</span>`,'practice',slot===0?'aria-label="开始或继续费曼练习"':'tabindex="-1"','a-compose')}${button(icon('arrow'),'practice',slot===0?'aria-label="打开费曼练习"':'tabindex="-1"','a-send')}</div></div></article>`;
}
function VariantA(n){
 const ids=visibleIds();
 const slots=[-1,0,1].map(slot=>{let id=ids[state.index+slot];if(!id&&slot===1&&state.filter==='all')id=nextBatchOrder()[0];return id?immersiveItem(notes.find(n=>n.id===id),slot):'';}).join('');
 return `<section class="immersive immersive-v2"><div class="feed-stage a-stage" id="feed-stage"><div class="a-screen"><div class="pull-indicator a-pull" role="status" aria-live="polite">${icon('refresh')}<span>下拉，换一批</span></div><div class="gesture-surface a-viewport" id="gesture-surface" tabindex="0" aria-label="知识信息流，上下滑动切换，首条下拉刷新"><div class="a-deck">${slots}</div></div>${rail(n)}<div class="like-flash" aria-hidden="true">${icon('heart')}</div></div><div class="a-page-controls"><span>${String(state.index+1).padStart(2,'0')} <i>/ ${String(ids.length).padStart(2,'0')}</i></span>${button(icon('up'),'prev','aria-label="上一条知识"'+(state.index===0?' disabled':''))}${button(icon('down'),'next','aria-label="下一条知识"')}</div><span class="a-desktop-hint">${icon('down')} 滚动，继续发现</span></div></section>`;
}
const bRatios={recall:.74,correlation:1.02,spacing:.84,smallstep:1.08,transfer:.73,explain:.96};
function bCover(n,detail=false){return `<div class="b-cover ${n.color}" data-cover-id="${n.id}" style="--cover-ratio:${bRatios[n.id]}" ${detail?'id="b-detail-cover"':''}>${poster(n)}<span class="b-cover-stamp">${statusText(n)}</span></div>`;}
function VariantB(n){
 if(state.detail)return `<section class="b-note-page"><header class="b-note-header">${button(icon('left')+'发现','back-grid','id="b-back"','text-button')}<div class="b-return-grip" title="向下拖动返回"><span></span></div><div class="b-note-pager"><span>${state.index+1} / ${visibleIds().length}</span>${button(icon('left'),'b-prev','aria-label="上一篇笔记"'+(state.index===0?' disabled':''))}${button(icon('right'),'b-next','aria-label="下一篇笔记"')}</div></header><div class="b-note-scroll"><div class="b-note-layout"><div class="b-note-visual">${bCover(n,true)}</div><article class="b-note-copy"><div class="b-note-author"><span class="tiny-avatar">知</span><span>${esc(n.source)}</span>${button(icon('star'),'b-save',`data-id="${n.id}" aria-label="${record(n).saved?'取消收藏笔记':'收藏笔记'}" aria-pressed="${record(n).saved}"`,record(n).saved?'is-saved':'')}</div><h1>${esc(n.title)}</h1><p class="b-note-lead">${esc(n.copy)}</p><div class="b-note-body">${n.body.split('。').filter(Boolean).map(p=>`<p>${esc(p)}。</p>`).join('')}</div><div class="b-note-tags"><span># ${esc(n.tag)}</span><span># ${esc(n.topic)}</span></div><section class="b-practice-prompt"><div><span>${n.due?'今天复习':'试着解释'}</span><span>${record(n).status==='completed'?'本轮已练':record(n).turns.length?'已留下回答':''}</span></div><h2>${esc(n.question)}</h2>${button((record(n).draft?'继续我的解释':record(n).turns.length?'回到练习与反馈':'合上原文，讲一讲')+icon('arrow'),'practice','','primary')}</section><p class="b-source-note">合成演示笔记 · 已记录本次查看原文</p></article></div></div></section>`;
 return `<section class="discovery b-discovery"><header class="discovery-heading"><div><span class="eyebrow">A LITTLE CURIOSITY, EVERY DAY</span><h1>今天，想明白一点。</h1></div><span class="b-count">${visibleIds().length} 个想法</span></header><div class="b-masonry" aria-label="知识图文瀑布流">${visibleIds().map(id=>{const item=notes.find(n=>n.id===id),saved=record(item).saved;return `<article class="b-tile" data-note-id="${id}"><button class="b-open" data-action="open-note" data-id="${id}" aria-label="阅读：${esc(item.title)}">${bCover(item)}<div class="b-tile-copy"><h2>${esc(item.title)}</h2><p>${esc(item.copy)}</p></div></button><footer class="b-tile-meta"><span><i class="b-topic-dot ${item.color}"></i>${esc(item.topic)}</span>${button(icon('star'),'b-save',`data-id="${id}" aria-label="${saved?'取消收藏':'收藏'}：${esc(item.title)}" aria-pressed="${saved}"`,saved?'is-saved':'')}</footer></article>`;}).join('')}</div><footer class="b-discovery-end">${button(icon('refresh')+'换一批想法','refresh','','text-button')}</footer></section>`;
}
function openBNote(id,trigger,animate=true){
 if(bTransition.running)return;
 bMemory.scroll=$('.b-discovery').scrollTop;bMemory.origin=id;
 bTransition.run({from:trigger.closest('.b-tile')?.querySelector('.b-cover'),animate,change:()=>{state.index=visibleIds().indexOf(id);state.detail=true;renderContent();},target:()=>$('#b-detail-cover'),after:()=>$('#b-back')?.focus({preventScroll:true})});
}
function closeBNote(animate=true){
 if(bTransition.running||!current())return;const id=current().id;
 bTransition.run({from:$('#b-detail-cover'),animate,change:()=>{state.detail=false;renderContent();},target:()=>{const card=$(`.b-tile[data-note-id="${id}"]`),container=$('.b-discovery');if(!card)return null;const a=card.getBoundingClientRect(),b=container.getBoundingClientRect();if(id!==bMemory.origin&&(a.top<b.top||a.bottom>b.bottom))container.scrollTop+=a.top-b.top-20;return card.querySelector('.b-cover');},after:()=>$(`.b-tile[data-note-id="${id}"] .b-open`)?.focus({preventScroll:true})});
}
function VariantC(n){return `<section class="practice-layout">${stage(n)}<aside class="practice-desk" id="practice-desk">${practiceHTML(n)}</aside></section>`;}
function renderContent(){
 deckController?.dispose();deckController=null;
 masonry?.dispose();masonry=null;releasePull?.();releasePull=null;
 const ids=visibleIds();state.index=Math.min(state.index,Math.max(0,ids.length-1));const n=current();
 $('#content').innerHTML=n?({A:VariantA,B:VariantB,C:VariantC}[state.variant](n)):`<section class="empty-state">${icon(state.filter==='saved'?'star':'check')}<h1>${state.filter==='saved'?'把想再看的知识，留在这里。':'今天的演示复习完成了。'}</h1><p>${state.filter==='saved'?'点击知识旁的星标，即可收藏。':'可以继续探索，也可以到这里结束。'}</p>${button('去发现','filter','data-filter="all"','primary')}</section>`;
 if(n){record(n).seen=true;if(state.variant==='A')deckController=bindImmersiveDeck({surface:$('#gesture-surface'),deck:$('.a-deck'),indicator:$('.a-pull'),first:()=>state.index===0,canMove:direction=>direction>0?(state.index<visibleIds().length-1||state.filter==='all'):state.index>0,move:direction=>next(direction,false,true),refresh:performRefresh,like:()=>{record(n).liked=true;state.interest=notes.filter(item=>record(item).liked).map(item=>item.topic);const heart=$('.like-flash');if(!reduced())heart.animate([{transform:'translate(-50%,-50%) scale(.85)',opacity:0},{transform:'translate(-50%,-50%) scale(1.1)',opacity:1,offset:.35},{transform:'translate(-50%,-70%) scale(1)',opacity:0}],{duration:280,easing:'ease-out'});const b=$('.a-screen [data-action="like"]');b.classList.add('on');b.setAttribute('aria-pressed','true');b.setAttribute('aria-label','取消感兴趣');surfaceState();},reduced});else bindGestures();}
 if(state.variant==='B'&&n){
   if(state.detail){record(n).sourceViewed=true;releasePull=bindPullReturn($('.b-return-grip'),$('.b-note-layout'),()=>closeBNote(),reduced);}
   else{masonry=mountMasonry($('.b-masonry'));const scroller=$('.b-discovery');scroller.scrollTop=bMemory.scroll;scroller.addEventListener('scroll',()=>{bMemory.scroll=scroller.scrollTop;},{passive:true});}
 }
 surfaceState();
}
function practiceHTML(n){const r=record(n),last=r.turns.at(-1),question=r.turns.length?n.follow:n.question;
 if(r.status==='completed')return `<div class="practice-header"><span class="eyebrow">本轮练习</span>${icon('check')}</div><div class="finished"><div class="finish-symbol">${icon('check')}</div><h2>这一次思考，留下来了。</h2><p>已保留你的 ${r.turns.length} 次回答${r.hintUsed||r.sourceViewed?'与查看提示的记录':''}。</p><span class="simulation-label">仅为演示状态，不代表已掌握</span>${button('继续看下一条 '+icon('arrow'),'next-after','','primary')}${button('再练一次','retry','','text-button')}</div>`;
 return `<div class="practice-header"><span class="eyebrow">${n.due?'到期复习':'费曼练习'}</span><span class="simulation-label">演示反馈</span></div><div class="practice-intro"><span class="question-number">${String(r.turns.length+1).padStart(2,'0')}</span><h2>${esc(question)}</h2><p>合上原文，用自己的话说说看。</p></div>
 ${last?`<section class="feedback"><span class="feedback-label">你的回答</span><p class="own-answer">${esc(last.answer)}</p><span class="feedback-label">对照要点 · 预设示例</span><p>${esc(last.round===0?n.point:'检查你的例子是否对应原理，并说明适用条件；这条演示反馈没有判断回答正误。')}</p><div class="feedback-note">这是预设反馈，不是 AI 对你回答的评判。</div></section>`:''}
 <form id="practice-form" data-note="${n.id}"><textarea name="answer" aria-label="我的解释" placeholder="不用复述原句，讲出你的理解……" maxlength="2000" required>${esc(r.draft)}</textarea><div class="answer-tools">${button(icon('spark')+' 一点提示','hint','','text-button')}${button(icon('book')+' 看原文','source','','text-button')}</div>${r.hintUsed?`<p class="hint-content">${esc(n.hint)}</p>`:''}<button class="primary" type="submit">${r.turns.length?'回答追问':'提交解释'} ${icon('arrow')}</button></form>
 <div class="practice-end">${button('结束本轮','finish',r.turns.length?'':'disabled','text-button')}<span>${r.turns.length?'结束后才记为本轮已练':'先留下回答，再看反馈'}</span></div>`;
}
function openPractice(){deckController?.pause();const n=current();if(!n)return;if(state.variant==='C'&&matchMedia('(min-width: 1000px)').matches){$('#practice-desk').scrollTop=0;$('#practice-desk textarea')?.focus();return;}
 const d=$('#learning-dialog');d.dataset.presentation=state.variant==='A'?'feed-sheet':'';d.innerHTML=`${state.variant==='A'?'<div class="sheet-grip" aria-hidden="true"><span></span></div>':''}<header class="dialog-header"><span>${state.variant==='A'?'讲一讲 · '+esc(n.topic):esc(n.source)}</span>${button(icon('close'),'close-practice','aria-label="关闭练习"')}</header><div class="dialog-practice">${practiceHTML(n)}</div>`;d.showModal();
 if(state.variant==='A'){document.documentElement.classList.add('practice-open');bindSheetHandle(d,closePractice,reduced);if(!reduced())d.animate([{transform:'translateY(28px)',opacity:.5},{transform:'translateY(0)',opacity:1}],{duration:240,easing:'cubic-bezier(.16,1,.3,1)'});d.querySelector('[data-action="close-practice"]').focus({preventScroll:true});}else d.querySelector('textarea')?.focus();surfaceState();}
function updatePractice(){const n=current();if(!n)return;const d=$('#learning-dialog');if(d.open)d.querySelector('.dialog-practice').innerHTML=practiceHTML(n);if($('#practice-desk'))$('#practice-desk').innerHTML=practiceHTML(n);surfaceState();}
function closePractice(){if($('#learning-dialog').open)$('#learning-dialog').close();}
function setFilter(filter){bTransition.cancel();bMemory.scroll=0;closePractice();state.filter=filter;state.reviewIds=notes.filter(n=>n.due&&record(n).status!=='completed').map(n=>n.id);state.index=0;state.detail=false;shell();}
function switchVariant(delta){bTransition.cancel();closePractice();state.variant=['A','B','C'][(['A','B','C'].indexOf(state.variant)+delta+3)%3];state.detail=false;const u=new URL(location.href);u.searchParams.set('variant',state.variant);history.replaceState({},'',u);shell();}
function next(delta=1,animate=true,fromDeck=false){if(!current()||(state.variant==='B'&&bTransition.running))return;if(state.variant==='A'&&!fromDeck&&animate){deckController?.step(delta);return;}closePractice();const ids=visibleIds();if(state.index+delta>=ids.length){if(state.filter==='all'){performRefresh();return;}toast('这一组已经看完了');return;}if(state.index+delta<0)return;motion?.cancel();state.index+=delta;renderContent();if(animate&&!reduced()){const el=$('.current-card');if(el)motion=el.animate([{transform:`translateY(${delta>0?60:-60}px)`,opacity:.5},{transform:'translateY(0)',opacity:1}],{duration:220,easing:'cubic-bezier(.16,1,.3,1)'});}surfaceState();}
function refresh(){if(state.variant==='A'&&deckController){deckController.refresh();return;}performRefresh();}
function performRefresh(){bTransition.cancel();bMemory.scroll=0;closePractice();state.reviewIds=notes.filter(n=>n.due&&record(n).status!=='completed').map(n=>n.id);state.refreshes++;state.order=nextBatchOrder();state.index=0;shell();toast('已换一批 · 学习记录和草稿已保留');}
function bindGestures(){const surface=$('#gesture-surface');if(!surface)return;let start=null,pulling=false,drag=0;
 surface.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('button,a,input,textarea'))return;start={x:e.clientX,y:e.clientY,id:e.pointerId};drag=0;surface.setPointerCapture(e.pointerId);});
 surface.addEventListener('pointermove',e=>{if(!start)return;const dy=e.clientY-start.y,dx=e.clientX-start.x;if(Math.abs(dx)>Math.abs(dy)&&Math.abs(dx)>20){start=null;return;}drag=dy;pulling=state.index===0&&dy>0;const card=surface.querySelector('.current-card');card.style.transform=`translateY(${pulling?Math.min(120,dy*.45):Math.max(-110,Math.min(110,dy*.55))}px)`;const indicator=$('.pull-indicator');indicator.classList.toggle('visible',pulling);indicator.querySelector('span').textContent=dy>145?'松开，换一批':'下拉换一批';});
 const end=e=>{if(!start)return;start=null;surface.querySelector('.current-card').style.transform='';$('.pull-indicator').classList.remove('visible');if(e.type==='pointercancel')return;if(pulling){if(drag>145)refresh();}else if(Math.abs(drag)>60)next(drag<0?1:-1);};
 surface.addEventListener('pointerup',end);surface.addEventListener('pointercancel',end);
 surface.addEventListener('wheel',e=>{if(Math.abs(e.deltaY)<Math.abs(e.deltaX))return;e.preventDefault();const now=performance.now();if(now<lockedUntil)return;if(now-wheelTime>200)wheelTotal=0;wheelTime=now;wheelTotal+=e.deltaY;if(Math.abs(wheelTotal)>48){const d=Math.sign(wheelTotal);wheelTotal=0;lockedUntil=now+480;if(state.index===0&&d<0){toast('向下拖动卡片，或点「换一批」刷新');return;}next(d);}}, {passive:false});
}
document.addEventListener('input',e=>{if(e.target.matches('textarea[name="answer"]'))record(current()).draft=e.target.value;});
document.addEventListener('submit',e=>{if(e.target.id!=='practice-form')return;e.preventDefault();const n=current(),r=record(n),answer=new FormData(e.target).get('answer').trim();if(!answer)return;r.turns.push({question:r.turns.length?n.follow:n.question,answer,round:r.turns.length,feedback:'preset-demo',hintUsed:r.hintUsed,sourceViewed:r.sourceViewed});r.draft='';r.status='feedback';updatePractice();const container=$('#learning-dialog').open?$('.dialog-practice'):$('#practice-desk');container?.querySelector('.feedback')?.scrollIntoView({block:'nearest'});});
document.addEventListener('click',e=>{const target=e.target.closest('[data-action]');if(!target)return;const a=target.dataset.action,n=current(),r=n&&record(n);
 if(a==='variant-prev')return switchVariant(-1);if(a==='variant-next')return switchVariant(1);if(a==='filter')return setFilter(target.dataset.filter);if(a==='refresh')return refresh();
 if(a==='state'){deckController?.pause();const d=$('#state-dialog');d.innerHTML=`<header class="dialog-header"><h2>当前演示状态</h2>${button(icon('close'),'close-state','aria-label="关闭状态"')}</header><p>只在本页内存中，重载页面即清空。</p><pre>${esc(JSON.stringify(state,null,2))}</pre>`;d.showModal();return;}
 if(a==='close-state')return $('#state-dialog').close();if(a==='close-source'){return $('#source-dialog').close();}if(a==='close-practice')return closePractice();
 if(a==='open-note')return openBNote(target.dataset.id,target,e.detail!==0);
 if(a==='back-grid')return closeBNote(e.detail!==0);
 if(a==='b-save'){const item=notes.find(item=>item.id===target.dataset.id);record(item).saved=!record(item).saved;renderContent();return;}
 if(a==='b-prev')return next(-1,false);if(a==='b-next')return next(1,false);if(!n)return;
 if(a==='next')return next();if(a==='prev')return next(-1);if(a==='next-after'){closePractice();if(state.filter==='review'&&state.index===visibleIds().length-1)return setFilter('review');return next();}if(a==='practice')return openPractice();
 if(a==='source'){deckController?.pause();r.sourceViewed=true;lastSourceFocus=document.activeElement;const d=$('#source-dialog');d.innerHTML=`<header class="dialog-header"><span>${esc(n.source)}</span>${button(icon('close'),'close-source','aria-label="关闭原文"')}</header><div class="source-content"><span class="eyebrow">合成演示材料</span><h2>${esc(n.title)}</h2><p>${esc(n.body)}</p><small>本次已记录查看原文，不作为独立回忆证据。</small></div>`;d.showModal();surfaceState();return;}
 if(a==='hint'){r.hintUsed=true;updatePractice();return;}if(a==='save'){r.saved=!r.saved;toast(r.saved?'已收藏，稍后再看':'已取消收藏');renderContent();return;}
 if(a==='like'){r.liked=!r.liked;state.interest=notes.filter(item=>record(item).liked).map(item=>item.topic);toast(r.liked?'记下这个兴趣 · 本原型暂不做算法推荐':'已取消兴趣标记');renderContent();return;}
 if(a==='finish'&&r.turns.length){r.status='completed';shell();updatePractice();return;}
 if(a==='retry'){r.status='idle';r.turns=[];r.draft='';updatePractice();}
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.variant==='B'&&state.detail&&!document.querySelector('dialog[open]')){e.preventDefault();closeBNote(false);return;}if(e.target.closest('input,textarea,select,[contenteditable="true"]')||document.querySelector('dialog[open]'))return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();switchVariant(e.key==='ArrowLeft'?-1:1);}if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();if(state.variant==='B'&&!state.detail){state.detail=true;renderContent();}else next(e.key==='ArrowDown'?1:-1,false);}});
$('#source-dialog').addEventListener('close',()=>lastSourceFocus?.isConnected&&lastSourceFocus.focus());
$('#learning-dialog').addEventListener('close',()=>{document.documentElement.classList.remove('practice-open');$('#learning-dialog').style.transform='';const n=current(),label=$('.current-card .a-compose span');if(n&&label)label.textContent=record(n).draft?'继续刚才的解释…':record(n).turns.length?'回到这次练习…':n.due?'不看原文，还能讲清楚吗？':'用自己的话，讲给朋友听…';});
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('click',e=>{if(e.target===dialog){const box=dialog.getBoundingClientRect();if(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom)dialog.close();}});
shell();

window.addEventListener('resize',()=>bTransition.cancel());
document.addEventListener('visibilitychange',()=>{if(document.hidden)bTransition.cancel();});
