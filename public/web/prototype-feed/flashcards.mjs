// Synthetic fact cards. Placement is random; review outcomes remain explicit and session-only.
export const factCards=[
 {cardId:'ampere',topic:'物理 · 国际单位制',title:'电流的 SI 基本单位叫什么？',answer:'安培',symbol:'A',body:'电流的 SI 基本单位是安培，单位符号是 A。别把表示电流的量符号 I 与单位符号 A 混淆。',source:'BIPM · ampere',url:'https://www.bipm.org/en/si-base-units/ampere'},
 {cardId:'notfound',topic:'计算机 · HTTP',title:'HTTP 中，Not Found 对应哪个状态码？',answer:'404',symbol:'Not Found',body:'Not Found 对应状态码 404。它表示服务器未找到目标资源的当前表示，或不愿透露它存在；单凭 404 不能断定资源已永久删除。',source:'RFC 9110 · §15.5.5',url:'https://www.rfc-editor.org/rfc/rfc9110.html#name-404-not-found'},
 {cardId:'water',topic:'化学 · 分子式',title:'水的分子式是什么？',answer:'H₂O',symbol:'两个氢原子，一个氧原子',body:'水的分子式是 H₂O：一个水分子由两个氢原子和一个氧原子构成。输入 H2O 也可表达同一答案。',source:'PubChem · Water',url:'https://pubchem.ncbi.nlm.nih.gov/compound/water'},
];
export function createFlashDeck(){return {serial:0,entries:{},pending:[],records:Object.fromEntries(factCards.map(c=>[c.cardId,{due:true,nextAt:null,history:[]}]))};}
function entryFor(deck,card){
 const id=`flash-${card.cardId}-${++deck.serial}`;
 deck.entries[id]={card:{...card,id,kind:'flash',due:true},phase:'question',draft:'',attempt:'',studied:false,grade:null,receipt:'',seen:false,sourceViewed:false,saved:false,turns:[]};return id;
}
export const flashItem=(id,deck)=>deck.entries[id]?.card;
export const flashDue=(id,deck)=>deck.records[deck.entries[id].card.cardId].due;
export function mixFlashcards(noteIds,deck){
 const pending=[...deck.pending],pendingCards=new Set(pending.map(p=>deck.entries[p.id].card.cardId));
 const candidates=factCards.filter(c=>deck.records[c.cardId].due&&!pendingCards.has(c.cardId));
 for(let i=candidates.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}
 const slots=new Map(),place=(id,desired)=>{let slot=Math.min(noteIds.length,Math.max(1,desired));while(slots.has(slot)&&slot<noteIds.length)slot++;const bucket=slots.get(slot)||[];bucket.push(id);slots.set(slot,bucket);};
 pending.forEach(p=>place(p.id,p.remaining));
 candidates.forEach((card,i)=>place(entryFor(deck,card),1+i*2+Math.floor(Math.random()*2)));
 return noteIds.flatMap((id,i)=>[id,...(slots.get(i+1)||[])]);
}
export function revealFlash(entry,study=false){if(entry.phase!=='question')return;entry.attempt=entry.draft.trim();entry.studied=study;entry.phase='answer';}
export function rateFlash(entry,deck,order,index,grade,visible=order){
 if(entry.phase!=='answer'||!['again','hard','good','easy'].includes(grade)||(entry.studied&&grade!=='again'))return false;
 const rec=deck.records[entry.card.cardId];entry.grade=grade;entry.phase='rated';
 rec.history.push({entryId:entry.card.id,answer:entry.attempt,grade,studied:entry.studied,at:new Date().toISOString()});
 if(grade==='again'||grade==='hard'){
   const gap=grade==='again'?2:4,newId=entryFor(deck,factCards.find(c=>c.cardId===entry.card.cardId));let remaining=gap,insert=-1;
   for(let i=visible.indexOf(entry.card.id)+1;i<visible.length;i++){if(!deck.entries[visible[i]]&&--remaining===0){insert=order.indexOf(visible[i])+1;break;}}
   deck.pending.push({id:newId,remaining:gap});if(insert>=0)order.splice(insert,0,newId);
   rec.due=true;rec.nextAt=null;entry.receipt=`隔 ${gap} 条普通知识，再试一次`;
 }else{const days=grade==='good'?1:4;rec.due=false;rec.nextAt=Date.now()+days*86400000;entry.receipt=grade==='good'?'下次复习：明天':'下次复习：4 天后';}
 return true;
}
export function renderFlash(n,r,slot,{e,button,icon}){
 const front=r.phase==='question',rated=r.phase==='rated';
 const answers=front?'':`<div class="fc-answer" aria-live="polite"><span>参考答案</span><strong>${e(n.answer)}</strong><span class="fc-symbol">${e(n.symbol)}</span><p>${e(n.body)}</p>${r.attempt?`<div class="fc-own"><span>你揭晓前的答案</span><p>${e(r.attempt)}</p></div>`:''}</div>`;
 const ratings=[['again','没想起','隔 2 条','答错、没想起，或关键部分不完整'],['hard','费力想起','隔 4 条','答对了，但花了较多力气'],['good','想起了','明天','答对了，需要正常回忆'],['easy','很轻松','4 天后','答对了，几乎不费力']];
 const actions=front?`<form class="fc-recall" data-flash-form><label class="sr-only" for="fc-answer-${slot}">我的闪卡答案</label><textarea id="fc-answer-${slot}" name="flash-answer" rows="2" maxlength="300" placeholder="先在心里回答，也可以写下来…" aria-label="我的闪卡答案">${e(r.draft)}</textarea><button class="fc-reveal" type="submit">想好了，核对答案 ${icon('arrow')}</button></form>${button('还没学过，先看解释','flash-study','','fc-study')}`:rated?`<div class="fc-receipt" role="status">${icon('check')}<strong>${e(r.receipt)}</strong><span>演示安排，仅本次页面有效</span></div>${button('继续信息流 '+icon('down'),'next','','fc-reveal')}`:r.studied?`<p class="fc-rating-help">这次先理解，下一次再独立回忆。</p>${button('隔几条，再试一次 '+icon('arrow'),'flash-rate','data-grade="again"','fc-reveal')}`:`<div class="fc-rating-help">按揭晓前的回忆自评；答错选「没想起」。</div><div class="fc-ratings">${ratings.map(([grade,label,when,title])=>button(`<b>${label}</b><small>${when}</small>`,'flash-rate',`data-grade="${grade}" title="${title}"`,'fc-rate '+grade)).join('')}</div><p class="fc-demo-plan">间隔为演示设置，不代表已经掌握</p>`;
 return `<article class="a-slide fc-slide ${slot===0?'current-card':''}" style="--slot:${slot}" data-note-id="${n.id}" ${slot===0?'':'aria-hidden="true" inert'}><div class="fc-stage"><header class="fc-top"><span>${icon('clock')} 闪回</span><span>${rated?'已自评':r.studied?'先学一遍':'今天复习'}</span>${button('稍后','next','aria-label="跳过这张闪卡"','fc-skip')}</header><div class="fc-stack"><section data-feed-scroll class="fc-paper ${front?'is-question':'is-answer'}"><div class="fc-paper-top"><span>${e(n.topic)}</span><span>${front?'QUESTION':'RECALL'}</span></div><div class="fc-question"><span class="fc-q">Q.</span><h1>${e(n.title)}</h1>${front?'<p>不翻笔记，试着想起来。</p>':''}</div>${answers}<div class="fc-actions">${actions}</div><footer class="fc-paper-foot"><span>一张卡，一个事实</span>${button(icon('book')+' 解释与出处','a-detail','','fc-context')}</footer></section></div><footer class="fc-bottom"><span>上滑继续 · 左滑查看解释</span><span>知序 · 记住一点</span></footer></div></article>`;
}
export function renderFlashDetail(n,r,{e,button,icon}){
 return `<section class="a-reading fc-reading" data-note-id="${n.id}"><header class="ad-topbar">${button(icon('left')+'返回闪卡','a-detail-back','aria-label="返回 A 信息流"','ad-back')}<span>${e(n.topic)}</span></header><div class="ad-scroll" tabindex="0" data-note-id="${n.id}"><article class="ad-article fc-explanation"><header class="ad-hero sage"><div class="ad-hero-meta"><span>先理解，再记住</span><span>事实闪卡</span></div><h1 tabindex="-1">${e(n.title)}</h1></header><div class="ad-article-body"><div class="fc-answer"><span>参考答案</span><strong>${e(n.answer)}</strong><span class="fc-symbol">${e(n.symbol)}</span><p>${e(n.body)}</p></div><a class="fc-source" href="${e(n.url)}" target="_blank" rel="noopener noreferrer">${e(n.source)} ↗</a><p class="fc-context-note">${r.studied?'你先看了这次答案；返回后安排稍后再试，不计为独立回忆成功。':'理解背景后，再对照揭晓前的实际回忆。'}</p>${button('返回闪卡 '+icon('arrow'),'a-detail-back','','primary')}</div></article></div></section>`;
}
