import {escape as e,markdown} from './markdown.mjs';
import {createInlineStudy} from './discovery-study.mjs';
import {feedbackPending,watchStudyFeedback} from './study-feedback.mjs';
import {bindDetailBack} from './discovery-motion.mjs';

export function createFlowPanels({host,ctx,icon,reduced,onOpen,onClose}){
 const layer=document.createElement('div');layer.className='lf-overlay';layer.hidden=true;host.append(layer);
 let kind='',card=null,expanded=false,revision=0,animation=null,releaseBack=null,stopFeedback=null,restore=null,extraClose=null,disposed=false;
 const dirtyBefore=ctx.state.dirty;
 const model=createInlineStudy({api:ctx.api,openStudy:ctx.openStudy,saving:delta=>{ctx.state.saving+=delta;},changed:(_,{visible})=>{if(disposed)return;ctx.state.dirty=dirtyBefore||model.hasDrafts;if(visible&&kind==='practice'&&!layer.hidden)renderPractice();}});
 function lock(value){for(const el of host.children)if(el!==layer)el.inert=value;}
 function show(nextKind){revision++;animation?.cancel();releaseBack?.();releaseBack=null;stopFeedback?.();stopFeedback=null;
  if(layer.hidden){restore=document.activeElement;onOpen?.();}kind=nextKind;expanded=false;layer.dataset.kind=kind;layer.hidden=false;lock(true);
 }
 function enter(){const panel=layer.querySelector('.lf-panel');if(!reduced())animation=panel.animate([{opacity:.6,transform:kind==='practice'?'translate3d(0,28px,0)':'translate3d(20px,0,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],{duration:180,easing:'cubic-bezier(.16,1,.3,1)'});panel.querySelector('button')?.focus({preventScroll:true});}
 async function close({immediate=false}={}){if(layer.hidden)return;const request=++revision;stopFeedback?.();stopFeedback=null;releaseBack?.();releaseBack=null;animation?.cancel();
  const panel=layer.querySelector('.lf-panel');if(panel&&!immediate&&!reduced()){animation=panel.animate([{opacity:1,transform:'translate3d(0,0,0)'},{opacity:0,transform:kind==='practice'?'translate3d(0,20px,0)':'translate3d(16px,0,0)'}],{duration:160,easing:'cubic-bezier(.16,1,.3,1)'});try{await animation.finished;}catch{}}
  if(request!==revision)return;const closedKind=kind;layer.hidden=true;layer.replaceChildren();kind='';model.close();lock(false);onClose?.({kind:closedKind});
  const focus=restore?.isConnected?restore:restore?.dataset.feedAction?host.querySelector(`.lf-current [data-feed-action="${restore.dataset.feedAction}"]`):host.querySelector('.lf-viewport');focus?.focus({preventScroll:true});const callback=extraClose;extraClose=null;callback?.();
 }
 function frame(title,body,{detail=false}={}){layer.innerHTML=`<section class="lf-panel ${detail?'lf-detail':''}" role="dialog" aria-modal="true" aria-label="${e(title)}" data-expanded="${expanded}"><header class="lf-panel-header"><button type="button" data-panel-action="close" aria-label="返回信息流">${icon('left')}返回</button><span>${e(title)}</span><button type="button" data-panel-action="expand" aria-label="${expanded?'收窄面板':'放大面板'}">${icon(expanded?'collapse':'expand')}</button></header><div class="lf-panel-body">${body}</div></section>`;}
 function renderDetail(){frame(card.noteTitle||card.title,`<article class="lf-panel-article"><h2>${e(card.noteTitle||card.title)}</h2>${card.stale?'<p class="lf-stale">正文已更新，旧练习暂不参与评分。</p>':''}<div class="lf-full-text">${markdown(card.body).html}</div><button type="button" class="lf-panel-primary" data-panel-action="practice">用自己的话讲讲 ${icon('chat')}</button></article>`,{detail:true});releaseBack?.();releaseBack=bindDetailBack(layer.querySelector('.lf-detail'),()=>close(),reduced);}
 function renderPractice(){stopFeedback?.();stopFeedback=null;const entry=model.active;if(!entry)return;
  const s=entry.session,turns=s?.turns||[],waiting=s&&feedbackPending(s),done=s?.status==='completed';let body='';
  if(entry.loading)body='<p role="status">正在打开本轮练习…</p>';
  else if(entry.blocked)body=`<h2>${e(entry.blocked.heading)}</h2>${entry.blocked.html}`;
  else if(s){const notice=ctx.studyRender?.notice(s.materialWarnings,s.noteId)||'';
   if(!entry.hiddenMaterial&&!turns.length)body=`${notice}<div class="lf-practice-material">${markdown(s.material).html}</div><button type="button" class="lf-panel-primary" data-panel-action="hide-material">合上材料，试着解释 ${icon('arrow')}</button>`;
   else body=`${notice}<h2 class="lf-practice-question">${e(s.question)}</h2>${turns.map(turn=>`<section class="lf-practice-turn"><span>我的回答${turn.hintUsed?' · 使用过提示或原文':''}</span><p>${e(turn.answer)}</p>${ctx.studyRender?.feedback(turn.feedback)||''}</section>`).join('')}${entry.hint?`<aside class="lf-practice-hint">${e(entry.hint)}</aside>`:''}${done?`<div role="status">${ctx.studyRender?.completion(s.completion)||'本轮学习已结束。'}</div>`:waiting||entry.needsRead?`<div role="status" class="lf-practice-wait"><strong>你的回答已保存</strong><p>正在等待真实反馈，可以先收起面板。</p><button type="button" data-panel-action="refresh">查看最新反馈</button></div>`:`<form class="lf-practice-form"><label>我的解释<textarea name="inline-answer" rows="3" maxlength="20000" required placeholder="先说出此刻的理解…">${e(entry.draft)}</textarea></label><div class="lf-practice-actions"><button type="button" data-panel-action="hint" ${entry.busy?'disabled':''}>一点提示</button><button type="button" data-panel-action="material" ${entry.busy?'disabled':''}>再看原文</button><button type="submit" class="lf-panel-primary" ${entry.busy?'disabled':''}>${entry.busy?'正在保存…':'保存回答，获取反馈'} ${icon('arrow')}</button></div><p class="lf-practice-disclosure">回答保存在当前知识库；AI 反馈使用已有配置，可能计费。</p></form>`}${turns.length&&!done&&!waiting?`<button type="button" data-panel-action="finish" ${entry.busy||entry.draft.trim()?'disabled':''}>结束本轮学习</button>`:''}`;
  }
  if(entry.error)body+=`<p class="lf-panel-error" role="alert">${e(entry.error)}</p>`;
  const scroll=layer.querySelector('.lf-panel-body')?.scrollTop||0,focus=layer.contains(document.activeElement)?document.activeElement:null,focusAction=focus?.dataset.panelAction;
  frame('讲一讲',body);layer.querySelector('.lf-panel-body').scrollTop=scroll;
  const nextFocus=focus?.name==='inline-answer'?layer.querySelector('[name=inline-answer]'):focusAction?layer.querySelector(`[data-panel-action="${focusAction}"]`):layer.querySelector('.lf-panel-header button');nextFocus?.focus({preventScroll:true});
  if(waiting&&!document.hidden&&!entry.error){const request=revision;stopFeedback=watchStudyFeedback({interval:2000,read:signal=>ctx.api.get(`/api/study/${encodeURIComponent(s.id)}`,{signal}),isCurrent:()=>!disposed&&!layer.hidden&&kind==='practice'&&request===revision&&!document.hidden,onReady:next=>{entry.session=next;renderPractice();}});}
 }
 async function openPractice(nextCard){card=nextCard;show('practice');frame('讲一讲','<p role="status">正在打开本轮练习…</p>');enter();await model.open(card.noteId);}
 layer.addEventListener('click',async event=>{if(event.target===layer){void close();return;}const button=event.target.closest('[data-panel-action]');if(!button)return;event.preventDefault();event.stopPropagation();const action=button.dataset.panelAction;
  if(action==='close')return close();if(action==='expand'){expanded=!expanded;layer.querySelector('.lf-panel').dataset.expanded=String(expanded);button.setAttribute('aria-label',expanded?'收窄面板':'放大面板');button.innerHTML=icon(expanded?'collapse':'expand');return;}
  if(action==='practice')return openPractice(card);if(action==='hide-material'){const entry=model.active;try{if(ctx.api.getContext().practiceId)await ctx.api.post('/api/onboarding/event',{practiceId:ctx.api.getContext().practiceId,event:'study-hide'});entry.hiddenMaterial=true;}catch(error){entry.error=error.message;}if(model.active===entry)renderPractice();return;}
  if(action==='refresh')return model.refresh();if(action==='hint')return model.hint();if(action==='material'){const entry=model.active;await model.hint();if(model.active===entry&&!entry.error){entry.hiddenMaterial=false;renderPractice();}return;}
  if(action==='finish'){const entry=model.active;await model.finish();if(!entry.error)try{await ctx.refreshBoot();}catch(error){entry.error=error.message;if(model.active===entry)renderPractice();}}
 });
 layer.addEventListener('input',event=>{if(event.target.name==='inline-answer'){model.updateDraft(event.target.value);ctx.state.dirty=dirtyBefore||model.hasDrafts;}});
 layer.addEventListener('submit',event=>{if(!event.target.matches('.lf-practice-form'))return;event.preventDefault();event.stopPropagation();void model.submit();});
 layer.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();void close();return;}if(event.key!=='Tab')return;const items=[...layer.querySelectorAll('button:not(:disabled),textarea,a[href],input')].filter(el=>!el.hidden);if(!items.length)return;const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}});
 const visibility=()=>{stopFeedback?.();stopFeedback=null;if(!document.hidden&&kind==='practice'&&!layer.hidden)renderPractice();};document.addEventListener('visibilitychange',visibility);
 return {get open(){return !layer.hidden;},contains:node=>layer.contains(node),close,
  openDetail(nextCard){card=nextCard;show('detail');renderDetail();enter();},openPractice,
  showContent(title,html,options={}){show('other');extraClose=options.onClose;frame(title,html);enter();const panel=layer.querySelector('.lf-panel');panel.close=()=>close();return panel;},
  dispose(){disposed=true;revision++;animation?.cancel();stopFeedback?.();releaseBack?.();model.close();lock(false);layer.remove();document.removeEventListener('visibilitychange',visibility);}
 };
}
