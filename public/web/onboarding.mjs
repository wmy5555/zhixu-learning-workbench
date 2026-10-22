import {learningTarget} from './onboarding-targets.mjs';
import {welcomeBody,assistantBody,proposalBody,goalLabels} from './onboarding-dialogs.mjs';
import {guideSteps,complete,prerequisite,destination,selectors,speeds,intents,suggestGoals,intersection} from './onboarding-model.mjs';
import {createGuideMotion} from './onboarding-motion.mjs';
import {materials,materialSample} from '../onboarding-materials.mjs';
import {escape as e} from './markdown.mjs';
import {icon,modal,notify} from './ui.mjs';
const $=s=>document.querySelector(s),all=s=>[...document.querySelectorAll(s)];
const readPreference=(key,fallback)=>{try{return localStorage.getItem(key)||fallback;}catch{return fallback;}};
const savePreference=(key,value)=>{try{localStorage.setItem(key,String(value));}catch{}};
const button=(label,action,extra='')=>`<button type="button" data-guide="${action}" ${extra}>${label}</button>`;
const bulb='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6m-5 3h4M8.5 15.5a6 6 0 1 1 7 0c-.9.7-1 1.2-1 2.5h-5c0-1.3-.1-1.8-1-2.5Z"/></svg>';
const back='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7"/></svg>';
const pauseIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>';
export function createWebOnboarding({api,state,go,refreshBoot,beforeLeave}){
 let handling=false,pendingGoal=null;
 let proof=null,index=0,active=false,travelling=false,sequence=0,detail=false,hinting=false,error='',sessionId='',polling=null,pollTimer,scheduled=0,signature='',requestedRoute=null;
 let mode=readPreference('zhixu.guide.mode','A');if(!['A','C'].includes(mode))mode='A';
 let speed=Number(readPreference('zhixu.guide.speed','1'));if(!speeds.includes(speed))speed=1;
 let steps=guideSteps(null),selectedMaterial='course';
 const card=document.createElement('section');card.className='onboard-card';card.setAttribute('aria-label','新手引导');card.hidden=true;
 const banner=document.createElement('div');banner.className='onboard-banner';banner.hidden=true;
 const resume=document.createElement('button');resume.type='button';resume.className='onboard-resume';resume.hidden=true;resume.innerHTML=icon('leaf')+' 继续引导';resume.onclick=()=>welcome();
 const live=document.createElement('span');live.className='onboard-sr';live.setAttribute('aria-live','polite');
 document.body.append(card,resume,live);$('.workspace').prepend(banner);
 const step=()=>steps[index],done=()=>complete(proof?.progress?.[step()?.id]);
 const motion=createGuideMotion({speed:()=>speed,bottom:()=>$('dialog[open]')?innerHeight-24:!card.hidden&&(mode==='C'||innerWidth<850)?card.getBoundingClientRect().top-24:innerHeight-24,onToggle:()=>{if(!travelling&&!handling&&!motion.moving&&mode==='A'){detail=!detail;render();placeCard();}}});
 function adopt(value){proof=value.onboarding||value;steps=guideSteps(proof.materialId);if(proof.materialId)selectedMaterial=proof.materialId;}
 const call=(action,data={})=>api.post('/api/onboarding/'+action,{practiceId:proof?.practiceId,...data});
 const context=()=>({version:1,active,mode,speed,currentStepId:step()?.id,position:index+1,total:steps.length,completed:steps.filter(s=>complete(proof?.progress?.[s.id])).map(s=>s.id),missing:prerequisite(step(),proof)?.id||null,scope:api.getContext().practiceId?'practice':'shared-settings',targetVisible:Boolean(target()),aiConnected:false});
 function publicEvent(type){window.dispatchEvent(new CustomEvent('zhixu:guide-event',{detail:{type,...context()}}));}
 function visible(n){if(!n||!n.isConnected||!n.getClientRects().length)return false;for(let p=n;p;p=p.parentElement){const style=getComputedStyle(p);if(p.hidden||p.inert||style.visibility==='hidden'||style.display==='none')return false;}return true;}
 function target(){if(step()?.id==='library-explain')return learningTarget({root:document,route:state.route,noteId:proof?.roles?.explain,visible});if(requestedRoute&&state.route!==requestedRoute&&!(requestedRoute==='study'&&state.route.startsWith('study/')&&state.session?.noteId===proof?.roles?.explain))return null;const list=selectors(step(),proof);const dialog=all('dialog[open]').at(-1);for(const selector of list){const n=all(selector).find(n=>visible(n)&&(!dialog||dialog.contains(n)));if(n)return n;}return null;}
 const hintButton=()=>button(bulb,'hint','class="onboard-icon" aria-label="提示操作位置" title="提示操作位置"');
 const speedButton=()=>button(speed+'x','speed',`class="onboard-speed" aria-label="引导速度 ${speed}x，点击切换倍速" title="0.75x · 1x · 1.5x · 2x" ${travelling?'disabled':''}`);
 function render(){
  document.body.dataset.guideMode=mode;document.body.classList.toggle('onboard-active',active);card.dataset.mode=mode;card.dataset.travelling=String(travelling);
  banner.hidden=!active;banner.innerHTML=`<span>${icon('leaf')} ${api.getContext().practiceId?'独立练习空间':'共用 AI 设置'} <small>${api.getContext().practiceId?'练习资料与正式库分开保存':'配置同时供正式库与练习使用'}</small></span>${button('暂停并回正式库','pause')}`;
  resume.hidden=!proof?.practiceId||active;card.hidden=!active||(mode==='A'&&!detail);if(!active){motion.hide();return;}
  const position=index+1,blocked=prerequisite(step(),proof),pending=travelling||Boolean(blocked)||!target()&&!done(),status=error||blocked?.message||(done()?'这一步已完成':step().kind==='read'?'看一眼，再继续':'完成页面操作后检查进度');
  const nextLabel=travelling?'正在引导…':index===steps.length-1?'完成体验':done()||step().kind==='read'?'继续':'检查这一步';
  const extras=step().id==='capture-save'?button('填入练习材料','fill','class="onboard-text"'):step().id==='library-explain'?`<div class="onboard-candidates">${(proof.learningCandidates||[]).map(n=>button(e(n.title),'candidate',`data-id="${e(n.id)}" data-guide-candidate class="onboard-text" ${proof.learningStarted&&proof.roles.explain!==n.id?'disabled':''}`)).join('')||'<p>原文拆解完成后，候选知识会出现在这里。</p>'}</div>`:step().id==='review-clock-due'?button('跳到下次复习','clock','class="onboard-text"'):'';
  const actions=`<div class="onboard-actions">${button(back,'back',`class="onboard-icon" aria-label="上一步" ${index===0||travelling?'disabled':''}`)}${button(nextLabel+(!travelling?icon('arrow'):''),'next',`class="primary" ${pending?'disabled':''}`)}</div>`;
  const progress=`<div class="onboard-progress" role="progressbar" aria-label="整体引导进度" aria-valuemin="0" aria-valuemax="${steps.length}" aria-valuenow="${position}" aria-valuetext="第 ${position} 步，共 ${steps.length} 步"><span style="width:${position/steps.length*100}%"></span></div>`;
  const foot=`<footer>${button(icon('chat')+' 我有疑问','ask','class="onboard-text"')}${button('查看路线','map','class="onboard-text"')}${mode==='A'?button('收起说明','collapse','class="onboard-text"'):speedButton()}</footer>`;
  const copy=`<div class="onboard-meta">${index+1} / ${steps.length} · ${e(({setup:'初识与准备',capture:'收集与加工',process:'整理与核对',library:'选择知识',study:'学习与理解',review:'到期复习',discover:'检索',output:'输出',complete:'回顾'})[step().chapterId]||'核心体验')}</div><h2>${e(step().title)}</h2><p>${e(step().instruction)}</p>`;
  const help=`<p class="onboard-status" role="status">${e(status)}</p>${blocked?button('先完成这一步','prerequisite','class="onboard-text"'):''}${extras}${!target()&&!travelling&&!done()?button('重新定位当前步骤','relocate','class="onboard-text"'):''}`;
  card.innerHTML=mode==='A'?`<header><span>${icon('leaf')} 与你一步一步</span><div>${speedButton()}${hintButton()}${button(pauseIcon,'pause','class="onboard-icon" aria-label="暂停引导"')}</div></header>${progress}<div class="onboard-content">${copy}${help}<details><summary>怎样才算完成？</summary><p>${e(step().expected)}</p></details>${actions}</div>${foot}`:`<div class="onboard-dialogue"><span class="onboard-avatar">${icon('leaf')}</span><div class="onboard-copy">${copy}${help}</div><div class="onboard-dock-actions">${hintButton()}${actions}${button(pauseIcon,'pause','class="onboard-icon" aria-label="暂停引导"')}</div></div>${progress}${foot}`;
  if(travelling){card.querySelectorAll('[data-guide]').forEach(n=>n.disabled=true);banner.querySelector('button').disabled=true;}motion.leaf.setAttribute('aria-expanded',String(detail));
  signature=JSON.stringify([step().id,proof.progress?.[step().id],proof.learningCandidates?.map(n=>n.id),error,Boolean(target())]);
 }
 function placeCard(){if(card.hidden||mode==='C'||motion.panelMoving)return;card.style.removeProperty('max-height');const t=card.contains(target())?null:target()?.getBoundingClientRect(),m=motion.leaf.getBoundingClientRect(),rightRoom=innerWidth-(t?.right||0)-32,width=Math.min(rightRoom>=280?Math.min(340,rightRoom):340,innerWidth-32);card.style.width=width+'px';const height=card.offsetHeight;if(innerWidth<850){card.style.left='16px';card.style.top=Math.max(80,innerHeight-height-18)+'px';return;}
  const candidates=[{x:m.right+14,y:m.top-20},{x:m.left-width-14,y:m.top-20},{x:innerWidth-width-16,y:innerHeight-height-24},{x:16,y:90}].map(p=>({x:Math.max(16,Math.min(innerWidth-width-16,p.x)),y:Math.max(80,Math.min(innerHeight-height-20,p.y)),w:width,h:height}));
  if(t)candidates.sort((a,b)=>(intersection(a,{x:t.x,y:t.y,w:t.width,h:t.height})+intersection(a,{x:m.x,y:m.y,w:m.width,h:m.height})*20)-(intersection(b,{x:t.x,y:t.y,w:t.width,h:t.height})+intersection(b,{x:m.x,y:m.y,w:m.width,h:m.height})*20));const p=candidates[0];card.style.left=p.x+'px';card.style.top=p.y+'px';
 }
 async function settle(){await document.fonts.ready;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);}
 async function showTarget(){const el=target();if(!el){motion.hide();render();return;}if(card.contains(el)){motion.hide();return;}await motion.scroll(el);await settle();if(!active||target()!==el){changed();return;}await motion.move(el);if(step().kind==='read')await motion.frame(el);motion.pulse();}
 async function openCard(){if(mode==='A'&&active){detail=true;render();placeCard();if(innerWidth<850){card.style.visibility='hidden';await motion.scroll(target());await motion.track();card.style.visibility='';}await motion.panel(card,true);}}
 async function refreshProof(){if(!active||travelling||motion.moving||polling)return;const token=sequence;polling=api.get('/api/onboarding/state');try{const value=await polling;if(token!==sequence||!active)return;adopt(value);const next=JSON.stringify([step().id,proof.progress?.[step().id],proof.learningCandidates?.map(n=>n.id),error,Boolean(target())]);if(next!==signature){if(done())error='';render();placeCard();}}catch(err){if(token===sequence){error=err.message;render();}}finally{polling=null;}}
 async function navigate(to){
  if(travelling||!active)return false;travelling=true;const candidate=steps[Math.max(0,Math.min(to,steps.length-1))],nextScope=['setup-model','setup-save','setup-test','setup-budget'].includes(candidate.id)?'':proof.practiceId,wouldLeave=destination(candidate,proof,sessionId||state.session?.id)!==state.route||nextScope!==api.getContext().practiceId;if(wouldLeave&&!await beforeLeave()){travelling=false;return false;}if(polling)await polling;
  const token=++sequence,alive=()=>active&&token===sequence;travelling=true;hinting=false;error='';render();
  try{
   if(mode==='A'&&detail){await motion.panel(card,false);detail=false;render();}await motion.retract();if(!alive())return false;
   index=Math.max(0,Math.min(to,steps.length-1));const blocked=prerequisite(step(),proof);if(blocked){error=blocked.message;return false;}
   const shared=['setup-model','setup-save','setup-test','setup-budget'].includes(step().id),scope=shared?'':proof.practiceId;
   const contextChange=api.getContext().practiceId!==scope;
   if(contextChange){api.setContext(scope);state.note=null;state.session=null;sessionId='';await refreshBoot();}
   if(step().id.startsWith('study-')&&!['study-plan','study-start'].includes(step().id)){
    const sessions=(await api.get('/api/study')).sessions||[];sessionId=sessions.filter(s=>s.noteId===proof.roles.explain).sort((a,b)=>String(b.startedAt||b.createdAt||'').localeCompare(String(a.startedAt||a.createdAt||'')))[0]?.id||'';
   }
   const route=destination(step(),proof,sessionId);requestedRoute=route;adopt(await call('checkpoint',{stepId:step().id,mode:'check'}));
   if(route!==state.route||contextChange){const nav=all('#sidebar [data-route]').find(n=>n.dataset.route===route.split('/')[0]&&visible(n));if(nav){await motion.move(nav);motion.pulse();}if(!alive())return false;
    if(!await go(route,{force:true,guide:true,replace:true,speed}))return false;
   }
   await settle();if(!alive())return false;await showTarget();live.textContent=`第 ${index+1} 步，共 ${steps.length} 步。${step().title}`;publicEvent('step');return true;
  }finally{if(token===sequence){travelling=false;render();await openCard();placeCard();}}
 }
 async function begin(dialog){if(!await beforeLeave())return;dialog.close();if(polling)await polling;adopt(await call(proof?.practiceId?'resume':'start',proof?.practiceId?{}:{materialId:selectedMaterial}));active=true;const saved=steps.findIndex(s=>s.id===proof.currentStepId);index=Math.max(0,saved);if(pendingGoal){const wanted=steps.findIndex(s=>s.id===intents[pendingGoal].start),missing=prerequisite(steps[wanted],proof);index=missing?steps.findIndex(s=>s.id===missing.id):wanted;pendingGoal=null;}await navigate(index);schedulePoll();}
 function welcome(){const dialog=modal('从一个想法，走向自己的理解。',welcomeBody({mode,materialId:selectedMaterial,practiceId:proof?.practiceId,index,customTitle:proof?.customSample?.title}));dialog.classList.add('guide-welcome-dialog');}
 async function next(){if(travelling)return;if(!target()&&!done()){error='当前步骤的位置暂时不可见，请先重新定位。';render();return;}adopt(await call('checkpoint',{stepId:step().id,mode:step().kind==='read'?'read':'check'}));if(!done()){error=proof.progress?.[step().id]?.reason||'还没有这一步的完成记录，请先完成操作，再检查。';render();return;}if(index===steps.length-1){await leave();notify('核心体验已完成，练习记录已保留。');return;}await navigate(index+1);}
 async function leave(){if(!await beforeLeave())return;if(polling)await polling;if(proof?.busy){notify('练习任务仍在处理，请等待完成或先取消任务。',true);return;}adopt(await call('pause'));api.setContext('');active=false;sequence++;travelling=false;motion.hide();detail=false;state.note=null;state.session=null;await refreshBoot();render();await go('today',{force:true,replace:true});clearTimeout(pollTimer);}
 function routeMap(){modal('你的完整路线',`<p>已完成的操作保留记录；尚未满足的前置条件会明确提示。</p><div class="onboard-map">${steps.map((s,i)=>button(`<span>${complete(proof?.progress?.[s.id])?'✓':String(i+1).padStart(2,'0')}</span>${e(s.title)}`,'jump',`data-index="${i}" ${travelling?'disabled':''}`)).join('')}</div>`);}
 function propose(dialog,goal){if(!Object.hasOwn(intents,goal))return;const wanted=steps.findIndex(s=>s.id===intents[goal].start),missing=prerequisite(steps[wanted],proof),start=missing?steps.findIndex(s=>s.id===missing.id):wanted;dialog.querySelector('[data-guide-reply]').textContent='可以，我们先确认路线，再按你当前的进度一步一步继续。';dialog.querySelector('#guide-suggestions').innerHTML=proposalBody({goal,steps,startIndex:start,reason:missing?missing.message:'已经保留本次练习的实际完成记录，按需要继续操作。'});}
 function assistant(){const dialog=modal('你想从哪里继续？',assistantBody());dialog.classList.add('guide-assistant-dialog');const heading=dialog.querySelector('.dialog-heading h2');heading.innerHTML='<span class="eyebrow">GUIDANCE, WHEN YOU NEED IT</span><span>你想从哪里继续？</span>';
  dialog.querySelector('form').onsubmit=ev=>{ev.preventDefault();if(ev.isComposing)return;const text=String(new FormData(ev.currentTarget).get('question')).trim();if(!text)return;const message=dialog.querySelector('.guide-user-message');message.hidden=false;message.textContent=text;const goals=suggestGoals(text);dialog.querySelector('#guide-suggestions').innerHTML='';if(goals.length===1){propose(dialog,goals[0]);return;}dialog.querySelector('[data-guide-reply]').textContent=goals.length>1?'这里有几个可能的方向。先选你现在最想解决的一件事，我再安排步骤。':'我还不能确定你想完成哪件事。可以选一个方向，或说得具体一点。';dialog.querySelector('.guide-goal-chips').innerHTML=(goals.length?goals:Object.keys(goalLabels)).map(id=>button(goalLabels[id],'suggest-goal',`data-goal="${id}"`)).join('');};
 }
 async function hint(){if(travelling)return;const el=target();if(!el){await navigate(index);return;}await motion.scroll(el);await motion.track();if(hinting||motion.framed){motion.pulse();return;}hinting=true;if(await motion.frame(el)&&active&&hinting)motion.pulse();}
 function schedulePoll(){clearTimeout(pollTimer);if(active)pollTimer=setTimeout(async()=>{await refreshProof();schedulePoll();},3500);}
 async function invoke(action,el){
  if(action==='welcome'){welcome();return;}
  if(action==='mode'){mode=el.dataset.mode;savePreference('zhixu.guide.mode',mode);el.closest('.onboard-mode-options').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===el)));return;}
  if(action==='material'){if(proof?.practiceId)return;if(!materials.some(m=>m.id===el.dataset.material))return;selectedMaterial=el.dataset.material;const dialog=el.closest('dialog');dialog.querySelector('.dialog-body').innerHTML=welcomeBody({mode,materialId:selectedMaterial,index});return;}
  if(action==='suggest-goal'){propose(el.closest('dialog'),el.dataset.goal);return;}
  if(action==='begin'){await begin(el.closest('dialog'));return;}
  if(action==='welcome-ask'){el.closest('dialog').close();assistant();return;}
  if(action==='goal'){if(!intents[el.dataset.goal])return;el.closest('dialog').close();if(!active){pendingGoal=el.dataset.goal;welcome();return;}const start=steps.findIndex(s=>s.id===intents[el.dataset.goal].start),missing=prerequisite(steps[start],proof);await navigate(missing?steps.findIndex(s=>s.id===missing.id):start);return;}
  if(action==='speed'){speed=speeds[(speeds.indexOf(speed)+1)%speeds.length];savePreference('zhixu.guide.speed',speed);render();card.querySelector('[data-guide="speed"]')?.focus({preventScroll:true});placeCard();return;}
  if(action==='hint'){await hint();return;}if(action==='pause'){await leave();return;}if(action==='next'){await next();return;}if(action==='back'){await navigate(index-1);return;}
  if(action==='relocate'){await navigate(index);return;}if(action==='prerequisite'){await navigate(steps.findIndex(s=>s.id===prerequisite(step(),proof)?.id));return;}
  if(action==='collapse'){await motion.panel(card,false);detail=false;render();return;}if(action==='map'){routeMap();return;}if(action==='ask'){assistant();return;}
  if(action==='jump'){el.closest('dialog').close();await navigate(Number(el.dataset.index));return;}
  if(action==='fill'){const form=$('#capture-form');if(!form||!api.getContext().practiceId)return;const sample=proof.customSample||materialSample(proof.materialId);for(const [key,value]of Object.entries(sample))if(form.elements[key])form.elements[key].value=value;form.elements.process.checked=false;form.elements.research.checked=false;form.elements.research.disabled=true;form.dispatchEvent(new Event('input',{bubbles:true}));form.dispatchEvent(new Event('change',{bubbles:true}));notify('练习材料已填入，请核对原文后自行保存。');return;}
  if(action==='candidate'){adopt(await call('select-knowledge',{noteId:el.dataset.id,role:'explain'}));await navigate(index);return;}
  if(action==='clock'){try{adopt(await call('advance',{action:'next'}));await refreshBoot();await go('today',{guide:true,speed,replace:true});await refreshProof();}catch(err){error=err.code==='NO_REVIEW'?'还没有可用复习安排。请返回开始学习，完成一次无争议的实际练习后再试。':err.message;render();}return;}
 }
 document.addEventListener('click',ev=>{const control=ev.target.closest('[data-guide]');if(control){ev.preventDefault();ev.stopPropagation();if(control.disabled||travelling||motion.panelMoving||handling&&!['hint','speed'].includes(control.dataset.guide))return;const exclusive=!['hint','speed'].includes(control.dataset.guide);if(exclusive)handling=true;Promise.resolve(invoke(control.dataset.guide,control)).catch(err=>{travelling=false;error=err.message;notify(error,true);render();}).finally(()=>{if(exclusive)handling=false;});return;}
  const t=target();if(active&&hinting&&t&&(t===ev.target||t.contains(ev.target))){hinting=false;motion.retract();}
 },true);
 let following=false,followTimer;
 function changed(){
  if(!active)return;
  // Keep the latest DOM change pending while travel or a panel transition owns geometry.
  if(travelling||motion.moving||following){clearTimeout(followTimer);followTimer=setTimeout(changed,80);return;}
  if(scheduled)return;
  scheduled=requestAnimationFrame(async()=>{
   scheduled=0;if(!active)return;if(travelling||motion.moving||following){changed();return;}
   following=true;
   try{
    const dialog=all('dialog[open]').at(-1),host=dialog||document.body;
    if(dialog)await Promise.allSettled(dialog.getAnimations().map(a=>a.finished));
    if(!active||dialog!==all('dialog[open]').at(-1))return;
    const el=target(),hostChanged=motion.layer.parentElement!==host;
    if(hostChanged){motion.hide();host.append(motion.layer);}
    if(!el){motion.hide();return;}
    // Card actions already stay in view; rebuilding them on scroll loses focus and repeats layout.
    if(card.contains(el)){if(!motion.layer.firstElementChild.hidden)motion.hide();if(!dialog)placeCard();return;}
    if(hostChanged||motion.layer.firstElementChild.hidden||motion.target!==el){
     await showTarget();if(!dialog){render();placeCard();}
    }else{await motion.track();if(!dialog)placeCard();}
   }finally{following=false;}
  });
 }
 document.addEventListener('change',ev=>{if(ev.target.closest('dialog[data-guide-form="learning"]'))changed();});
 window.addEventListener('scroll',changed,{passive:true,capture:true});let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(async()=>{if(active&&!travelling){placeCard();await motion.scroll(target());changed();}},120);});
 window.addEventListener('zhixu:web-page',()=>{if(!travelling)motion.hide();changed();});
 new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes,...r.removedNodes].some(n=>n.nodeName==='DIALOG')))changed();}).observe(document.body,{childList:true});
 new MutationObserver(changed).observe($('#main'),{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','open','inert']});
 document.addEventListener('keydown',ev=>{if(ev.key==='Escape'&&!ev.isComposing&&!$('dialog[open]')&&active){ev.preventDefault();ev.stopImmediatePropagation();detail=false;render();}},true);
 async function initialize(){adopt(await api.get('/api/onboarding/state'));index=Math.max(0,steps.findIndex(s=>s.id===proof.currentStepId));if(proof.practiceId&&proof.status==='active'){active=true;const shared=['setup-model','setup-save','setup-test','setup-budget'].includes(step().id);api.setContext(shared?'':proof.practiceId);}render();}
 async function ready(){if(active){await navigate(index);schedulePoll();}else if(new URL(location).searchParams.get('onboarding')==='start')welcome();}
 window.zhixuGuide=Object.freeze({version:1,getCatalog:()=>steps.map(({id,title,kind})=>({id,title,kind})),getContext:context,presentPlan:plan=>{if(!plan||plan.version!==1||!intents[plan.goal])return {accepted:false};const goal=plan.goal;modal('确认引导路线',`<p>按“${e(intents[goal].label)}”继续。实际保存、AI 请求与采用仍由你操作。</p>${button('按这条路线继续','goal',`data-goal="${goal}" class="primary"`)}`);return {accepted:true,requiresUserStart:true};}});
 async function prepareRoute(route){if(!active)return;const shared=['setup-model','setup-save','setup-test','setup-budget'].includes(step().id)&&['settings','manage/usage'].includes(route);const scope=shared?'':proof.practiceId;if(api.getContext().practiceId!==scope){if(polling)await polling;api.setContext(scope);state.note=null;state.session=null;await refreshBoot();render();}}
 return {initialize,ready,welcome,prepareRoute,get travelling(){return travelling;},get active(){return active;}};
}
