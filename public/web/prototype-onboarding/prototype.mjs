import {steps,chapters,materials,goalSpecs,evidenceOwner} from './catalog.mjs';
import {escape as e,icon,button as btn,renderPage,sidebar,nav} from './host.mjs';
import {springEnter} from './host/cds/motion-bridge.mjs';
import {calcDampedHarmonicOscillator,SPRING_SNAPPY} from './host/cds/ClaudeMotionPresets.mjs';

const $=q=>document.querySelector(q), $$=q=>[...document.querySelectorAll(q)];
const variants={A:['轻随行','贴近操作，轻轻指路'],B:['并肩学','路线常在，按章推进'],C:['对话伴','从疑问出发，一次一步']};
const state={variant:variants[new URL(location).searchParams.get('variant')]?new URL(location).searchParams.get('variant'):'A',material:'reading',view:'today',active:false,paused:false,index:0,route:steps.map(s=>s.id),routeLabel:'完整核心体验',visited:[],facts:{},events:[],blocked:null,repairReturn:null,completed:false,assistantDraft:'',assistantReply:null,proposal:null,busy:false,missingTarget:false};
let toastTimer,positionAnimation,previousRect,focusReturn,guideGeneration=0,lastComposition=0;
const current=()=>steps.find(s=>s.id===state.route[state.index]);
const material=()=>materials[state.material];
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const done=s=>s.evidence?Boolean(state.facts[s.evidence]):state.visited.includes(s.id);
const notify=message=>{clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,3200);};
const announce=message=>$('#announcer').textContent=message;
function log(type,details={}){state.events.push({type,stepId:current()?.id,...details});state.events=state.events.slice(-40);window.dispatchEvent(new CustomEvent('zhixu:guide-event',{detail:{type,stepId:current()?.id,scope:'prototype-memory',...details}}));}
function fact(name,value=true){state.facts[name]=value;log('evidence',{key:name,value,provenance:'prototype-user-action'});}
function snapshot(){const step=current();return {schemaVersion:1,scope:'prototype-memory',variant:state.variant,active:state.active,paused:state.paused,view:state.view,materialId:state.material,routeLabel:state.routeLabel,route:[...state.route],currentStepId:step?.id,position:state.index+1,completedSteps:state.route.filter(id=>done(steps.find(s=>s.id===id))),facts:{...state.facts},missingPrerequisites:step?.requires.filter(k=>!state.facts[k])||[],target:step?.target,targetVisible:!state.missingTarget,blocked:state.blocked,ai:{mode:'local-rule-demo',connected:false},events:[...state.events]};}
function drawHost(){
 $('#sidebar').innerHTML=sidebar(state);
 $('#page-name').textContent=nav.find(n=>n[2]===state.view)?.[1]||({settings:'系统设置',read:'我的书桌',complete:'回顾与继续'}[state.view]);
 $('#main').innerHTML=renderPage(state,material(),current());
 bindForms();springEnter($('#main'),undefined,5,.999)?.finished.then(()=>placeGuide(false)).catch(()=>{});
 requestAnimationFrame(()=>placeGuide(false));
}
function refresh({host=false,focus=false}={}){if(host)drawHost();drawCoach();drawSwitcher();if(focus)requestAnimationFrame(()=>focusTarget());}
function begin(){state.active=true;state.paused=false;state.completed=false;state.blocked=null;closeDialog($('#welcome'));goStep(state.index);log('begin');}
function goStep(index){
 state.index=Math.max(0,Math.min(index,state.route.length-1));state.view=current().view;state.blocked=null;state.paused=false;state.active=true;state.missingTarget=false;guideGeneration++;
 history.replaceState(null,'',`?variant=${state.variant}#${state.view}`);
 drawHost();drawCoach();drawSwitcher();
 requestAnimationFrame(()=>{const el=targetElement();el?.scrollIntoView({block:'center',behavior:reduced()?'instant':'smooth'});placeGuide(true);});
 announce(`第 ${state.index+1} 步，共 ${state.route.length} 步。${current().title}`);log('step-open');
}
function targetElement(){const step=current();if(!step||state.view!==step.view||state.forceMissing)return null;for(const id of [step.target,...(done(step)?step.fallbackTargets:[])]){const el=$(`[data-guide-target="${id}"]`);if(!el)continue;const r=el.getBoundingClientRect();if(r.width&&r.height&&getComputedStyle(el).visibility!=='hidden')return el;}return null;}
function focusTarget(){const el=targetElement();if(!el){notify('操作位置暂时不可见，点“重新定位”回到当前步骤。');return;}el.scrollIntoView({block:'center',behavior:reduced()?'instant':'smooth'});const control=el.matches('button,input,textarea,select')?el:el.querySelector('button:not(:disabled),input:not(:disabled),textarea,select');if(control)control.focus({preventScroll:true});else{el.tabIndex=-1;el.focus({preventScroll:true});}}
function pause(){if(!state.active)return;state.paused=true;guideGeneration++;state.forceMissing=false;drawCoach();drawSwitcher();$('#resume').focus({preventScroll:true});announce('引导已收起，进度保留在本次页面。');log('pause');}
function resume(){state.paused=false;goStep(state.index);}
function next(){
 const step=current();if(state.busy||state.missingTarget)return;
 const missing=step.requires.filter(key=>!state.facts[key]);
 if(missing.length){state.blocked=`还需要先完成：${steps.find(s=>s.id===evidenceOwner[missing[0]])?.title||missing[0]}`;drawCoach();return;}
 if(step.evidence&&!done(step)){notify('先完成页面里的操作，再继续。');return;}
 if(!state.visited.includes(step.id))state.visited.push(step.id);
 if(state.repairReturn&&step.id===state.repairReturn.finalStep){const back=state.repairReturn;state.repairReturn=null;state.route=back.route;state.routeLabel=back.label;goStep(back.index);return;}
 if(state.index===state.route.length-1){state.completed=true;state.active=false;drawCoach();drawSwitcher();showFinish();log('route-complete');return;}
 goStep(state.index+1);
}
function repair(){
 const key=current().requires.find(k=>!state.facts[k]);if(!key)return;
 const owner=evidenceOwner[key];if(!owner)return;
 if(!state.repairReturn)state.repairReturn={route:[...state.route],index:state.index,label:state.routeLabel};
 const chain=[];const add=id=>{const s=steps.find(s=>s.id===id);for(const k of s.requires)if(!state.facts[k])add(evidenceOwner[k]);if(!chain.includes(id))chain.push(id);};add(owner);
 // A repair may need several actions; return to the original route only after all.
 state.repairReturn.finalStep=chain.at(-1);state.route=chain;state.routeLabel='补齐前置操作';goStep(0);
}
function routeProgress(){return state.route.filter(id=>done(steps.find(s=>s.id===id))).length;}
function chapterMap(){return `<div class="chapter-map">${chapters.map((title,i)=>{const items=steps.filter(s=>s.chapter===i),n=items.filter(done).length;return `<div class="chapter-line ${current()?.chapter===i?'current':''}"><span>${n===items.length?icon('check'):String(i+1).padStart(2,'0')}</span><div>${title}<small>${n} / ${items.length}</small></div></div>`;}).join('')}</div>`;}
function coachBody(){
 const step=current(),missing=step.requires.filter(k=>!state.facts[k]),complete=done(step),blocked=missing.length||state.missingTarget;
 const status=state.missingTarget?'当前操作位置暂时不可见':missing.length?'先把前一步准备好':complete?'这一步已经完成':step.evidence?'等你完成页面里的操作':'看一眼，再继续';
 return `<div class="coach-top"><span class="coach-brand">${icon('leaf')} ${state.variant==='C'?'知序向导':'与你一步一步'}</span><div class="coach-tools">${btn(icon('target'),'locate','icon-button','aria-label="定位当前操作"')}${btn(icon('pause'),'pause','icon-button','aria-label="收起引导，保留进度"')}</div></div><div class="step-track"><span style="width:${routeProgress()/state.route.length*100}%"></span></div><div class="coach-content"><div class="step-meta"><span>${chapters[step.chapter]}</span><span>${state.index+1} <b>/ ${state.route.length}</b></span></div><h2 id="coach-title">${step.title}</h2><p class="coach-instruction">${step.instruction}</p>${state.blocked?`<p class="block-reason">${e(state.blocked)}</p>`:''}<div class="checkpoint ${complete?'verified':''} ${blocked?'blocked':''}">${icon(complete?'check':blocked?'target':'eye')}<span>${status}</span></div>${missing.length?`<p class="missing-detail">${e(steps.find(s=>s.id===evidenceOwner[missing[0]])?.expected||missing[0])}</p>${btn('带我补齐，然后回来','repair','repair-link')}`:''}${state.missingTarget?btn('重新定位当前步骤','relocate','repair-link'):''}<details class="why"><summary>怎样才算完成？</summary><p>${step.expected}</p><p>这里只验证模拟页面操作；实际 AI、外发许可与学习结果需在正式接入时独立验证。</p></details><div class="coach-actions">${btn(icon('back'),'back','icon-button',`aria-label="上一步" ${state.index===0?'disabled':''}`)}${btn(complete?'继续下一步 '+icon('arrow'):step.evidence?'完成操作后继续':state.index===state.route.length-1?'完成这次体验':'知道了，继续 '+icon('arrow'),'next','primary',blocked||state.busy||step.evidence&&!complete?'disabled':'')}</div></div><div class="coach-bottom">${btn(`${icon('chat')} 我有一个疑问`,'ask','text-button')}${btn('收起','pause','text-button')}${btn('查看路线','map','text-button')}</div>`;
}
function VariantA(){return coachBody();}
function VariantB(){return `<div class="rail-title"><span class="eyebrow">YOUR LEARNING PATH</span><h2>沿着自己的节奏，<br>慢慢走。</h2></div>${chapterMap()}<div class="rail-step">${coachBody()}</div>`;}
function VariantC(){const step=current();return `<div class="conversation-dock"><span class="guide-avatar">${icon('leaf')}</span><div class="dock-step"><div class="step-meta">${state.index+1} / ${state.route.length} · ${chapters[step.chapter]}</div><h2>${step.title}</h2><p>${done(step)?'已经完成，准备好就继续。':step.instruction}</p></div><div class="dock-actions">${btn('展开这一步','detail','secondary-button')}${btn(done(step)||!step.evidence?'继续 '+icon('arrow'):'定位操作','dock-next','primary')}${btn(icon('pause'),'pause','icon-button','aria-label="收起引导，保留进度"')}</div></div><div class="dock-footer">${btn(`${icon('chat')} 说说你卡在哪里…`,'ask','dock-question')}<span>本机规则演示 · 未接入 AI</span></div>${state.detail?`<div class="dock-expanded">${coachBody()}</div>`:''}`;}
function drawCoach(){
 const show=state.active&&!state.paused;
 document.body.dataset.variant=state.variant;document.body.classList.toggle('guide-running',show);
 $('#coach').hidden=!show;$('#spotlight').hidden=!show;
 $('#resume').hidden=!state.active||!state.paused;
 $('#resume').innerHTML=`${icon('leaf')} 继续引导 <small>${state.index+1}/${state.route.length}</small>`;
 if(show){$('#coach').innerHTML=({A:VariantA,B:VariantB,C:VariantC}[state.variant])();requestAnimationFrame(()=>placeGuide(false));}
}
function animateRect(rect){
 const el=$('#spotlight');if(!previousRect||reduced()){Object.assign(el.style,rect);previousRect=rect;return;}
 positionAnimation?.cancel();
 const from=previousRect,to=rect;Object.assign(el.style,to);
 const frames=Array.from({length:49},(_,i)=>{const p=calcDampedHarmonicOscillator(SPRING_SNAPPY.stiffness,SPRING_SNAPPY.damping,1,i/80);return Object.fromEntries(['left','top','width','height'].map(k=>[k,`${parseFloat(from[k])+(parseFloat(to[k])-parseFloat(from[k]))*p}px`]));});
 frames[48]=to;positionAnimation=el.animate(frames,{duration:600});previousRect=to;
}
function placeGuide(animate=false){
 if(!state.active||state.paused)return;
 const el=targetElement(),coach=$('#coach'),spot=$('#spotlight');
 const missing=!el;
 if(state.missingTarget!==missing){state.missingTarget=missing;drawCoach();return;}
 if(!el){spot.hidden=true;coach.style.left='';coach.style.top='';return;}
 const r=el.getBoundingClientRect(),pad=7;
 spot.hidden=false;const rect={left:`${r.left-pad}px`,top:`${r.top-pad}px`,width:`${r.width+pad*2}px`,height:`${r.height+pad*2}px`};
 if(animate)animateRect(rect);else{positionAnimation?.cancel();Object.assign(spot.style,rect);previousRect=rect;}
 if(state.variant!=='A'||innerWidth<850){coach.style.left='';coach.style.top='';return;}
 const width=340,height=coach.offsetHeight,margin=18,maxY=Math.max(80,innerHeight-height-85);
 let x=r.right+24,y=r.top;
 if(x+width>innerWidth-margin){x=r.left-width-24;if(x<238){x=Math.max(238,Math.min(r.right-width,innerWidth-width-margin));y=r.bottom+24;if(y>maxY)y=r.top-height-22;}}
 x=Math.min(innerWidth-width-margin,Math.max(margin,x));y=Math.min(maxY,Math.max(80,y));
 coach.style.left=`${x}px`;coach.style.top=`${y}px`;
}
function drawSwitcher(){const [title,subtitle]=variants[state.variant];$('#switcher').innerHTML=`<span class="switcher-prefix">原型</span>${btn('‹','variant-prev','variant-arrow','aria-label="上一个方案"')}${['A','B','C'].map(v=>btn(`${v} <span>${variants[v][0]}</span>`,'variant','variant-choice',`data-variant="${v}" aria-pressed="${state.variant===v}"`)).join('')}${btn('›','variant-next','variant-arrow','aria-label="下一个方案"')}<i></i>${btn(icon('layers'),'inspect','variant-arrow','aria-label="查看原型状态与 AI 接口"')}<span class="sr-only">${title}：${subtitle}</span>`;}
function setVariant(v){state.variant=v;state.detail=false;previousRect=null;history.replaceState(null,'',`?variant=${v}#${state.view}`);refresh();springEnter($('.coach-content')||$('.conversation-dock'),undefined,6,.999);log('variant-change',{variant:v});console.info('Zhixu prototype state',snapshot());}
function cycle(delta){const keys=Object.keys(variants);setVariant(keys[(keys.indexOf(state.variant)+delta+3)%3]);}
function openDialog(el){focusReturn=document.activeElement;el.showModal();springEnter(el);}
function closeDialog(el){el.close();if(focusReturn?.isConnected)focusReturn.focus({preventScroll:true});}
function showWelcome(){
 const el=$('#welcome');el.className='welcome-dialog';el.innerHTML=`<div class="welcome-close">${btn(icon('close'),'close-dialog','icon-button','aria-label="关闭介绍"')}</div><div class="welcome-art" aria-hidden="true"><span class="art-orbit one"></span><span class="art-orbit two"></span><span class="art-leaf">${icon('leaf')}</span><span class="art-dot"></span></div><p class="eyebrow">A LITTLE GUIDANCE, AT YOUR PACE</p><h1 id="welcome-title">从一个想法，<br>走向自己的理解。</h1><p class="welcome-intro">一起用一份小材料，走过知序的完整路径。<br>每次只做一件事，随时停下，也随时继续。</p><div class="welcome-path"><span>准备</span><b>·</b><span>收集</span><b>·</b><span>学习</span><b>·</b><span>复习</span><b>·</b><span>表达</span></div><div class="material-picker"><span class="picker-label">选一个贴近你的场景</span><div class="material-options">${Object.entries(materials).map(([key,m])=>btn(`${icon(key==='reading'?'book':key==='work'?'chat':'file')} ${m.label}`,'material','material-option',`data-material="${key}" aria-pressed="${key===state.material}" ${state.facts.source?'disabled':''}`)).join('')}</div><p class="material-preview">${e(material().title)} <span>· 原创虚构材料</span></p></div><div class="welcome-buttons">${btn(state.active?'继续上次的引导 '+icon('arrow'):'开始这段小旅程 '+icon('arrow'),'begin','primary')}${btn('我有一个具体问题','welcome-ask','secondary-button')}</div><p class="welcome-foot">28 个小步骤 · 6 个阶段 · 独立练习<br>交互原型：没有真实 AI 调用，刷新后清空进度</p>`;if(!el.open)openDialog(el);
}
function showFinish(){const el=$('#welcome');el.innerHTML=`<div class="welcome-close">${btn(icon('close'),'close-dialog','icon-button','aria-label="关闭完成页"')}</div><div class="welcome-art small-art">${icon('check')}</div><p class="eyebrow">ONE SMALL JOURNEY, COMPLETED</p><h1 id="welcome-title">这一次，走通了。</h1><p class="welcome-intro">${e(state.routeLabel)}已完成。<br>这些是原型里的操作记录，不是实际学习能力的认证。</p><div class="welcome-path"><span>${routeProgress()} 个步骤</span><b>·</b><span>${e(material().label)}</span></div><div class="welcome-buttons">${btn('看看其他引导','welcome-ask','primary')}${btn('回到练习空间','close-dialog','secondary-button')}</div>`;openDialog(el);}
function buildPlan(goal){
 const spec=goalSpecs[goal];if(!spec)return null;
 const end=steps[spec.end],wanted=[];
 const add=s=>{for(const key of s.requires)if(!state.facts[key]){const pre=steps.find(x=>x.id===evidenceOwner[key]);if(pre)add(pre);}if(!wanted.includes(s.id)&&!done(s))wanted.push(s.id);};
 const start={setup:0,capture:5,study:11,review:20,output:22}[goal];
 for(const s of steps.slice(start,spec.end+1))add(s);
 return {schemaVersion:1,goal,label:spec.label,stepIds:wanted,reason:wanted.some(id=>steps.findIndex(s=>s.id===id)<start)?'先补齐尚未完成的前置操作，再回到你想做的事。':'根据本次练习进度，已经完成的操作会跳过。',scope:'prototype-memory',requiresUserStart:true};
}
function ask(text){
 state.assistantDraft=text;state.proposal=null;state.choices=null;
 const matches=Object.entries(goalSpecs).filter(([,spec])=>spec.match.test(text)).map(([key])=>key);
 if(!matches.length){state.assistantReply='我还不能确定你想完成哪件事。可以选一个方向，或说得具体一点，例如“我想把文章拆成知识”。';}
 else if(matches.length>1){state.assistantReply='这里有两个可能的方向。先选你现在最想解决的一件事，我再安排步骤。';state.choices=matches;}
 else{state.proposal=buildPlan(matches[0]);state.assistantReply=state.proposal.stepIds.length?'可以，我们就从你当前的进度接着走。':'这个方向在本次练习里已经完成。你可以回看核心路线，或选择另一个问题。';state.choices=null;}
 log('intent-proposed',{matched:matches});showAssistant();
}
function showAssistant(){const el=$('#assistant');el.className='assistant-dialog';
 el.innerHTML=`<div class="dialog-heading"><div><span class="eyebrow">GUIDANCE, WHEN YOU NEED IT</span><h2 id="assistant-title">你想从哪里继续？</h2></div>${btn(icon('close'),'close-dialog','icon-button','aria-label="关闭问答向导"')}</div><div class="assistant-label"><span class="status-dot"></span>交互演示 · 本机规则匹配，尚未接入 AI</div><div class="assistant-message"><span class="guide-avatar">${icon('leaf')}</span><p>${e(state.assistantReply||'可以从头认识知序，也可以只处理眼前的疑问。说说你想完成什么，我会先给你一条可确认的路线。')}</p></div>${state.assistantDraft?`<div class="user-message">${e(state.assistantDraft)}</div>`:''}<div class="goal-chips">${(state.choices||Object.keys(goalSpecs)).map(key=>btn(goalSpecs[key].label,'goal','goal-chip',`data-goal="${key}"`)).join('')}</div>${state.proposal?.stepIds.length?`<section class="route-proposal"><p class="eyebrow">建议路线 · ${state.proposal.stepIds.length} 个步骤</p><h3>${state.proposal.label}</h3><p>${state.proposal.reason}</p><ol>${state.proposal.stepIds.slice(0,5).map(id=>`<li>${steps.find(s=>s.id===id).title}</li>`).join('')}${state.proposal.stepIds.length>5?`<li class="muted">以及后续 ${state.proposal.stepIds.length-5} 步</li>`:''}</ol>${btn('按这条路线带我操作 '+icon('arrow'),'accept-plan','primary')}<p class="small muted">只导航与高亮；外发、保存、采用仍由你亲自操作。</p></section>`:''}<form id="question-form" class="question-composer"><label class="sr-only" for="question">描述你的疑问与需求</label><textarea id="question" name="question" rows="2" placeholder="例如：我存了文章，但不知道怎么开始学…" required></textarea><button type="submit" class="icon-button" aria-label="发送疑问">${icon('arrow')}</button></form>`;
 $('#question-form').addEventListener('submit',event=>{event.preventDefault();const text=new FormData(event.currentTarget).get('question').trim();if(text)ask(text);});if(!el.open)openDialog(el);
}
function acceptPlan(plan){if(!plan?.stepIds?.length)return false;if(plan.stepIds.some(id=>!steps.some(s=>s.id===id)))return false;state.route=[...plan.stepIds];state.routeLabel=plan.label;state.index=0;state.repairReturn=null;state.completed=false;state.active=true;state.paused=false;closeDialog($('#assistant'));goStep(0);log('plan-accepted',{goal:plan.goal});return true;}
function showInspector(){const el=$('#inspector');el.className='inspector-dialog';el.innerHTML=`<div class="dialog-heading"><h2 id="inspector-title">原型状态与接入约定</h2>${btn(icon('close'),'close-dialog','icon-button','aria-label="关闭状态面板"')}</div><p>步骤 ID、目标、前置条件和完成证据由同一份目录定义。AI 只建议路线；浏览器执行器校验步骤并验证页面操作。</p><div class="inspector-actions">${btn('模拟下一次连接失败','fail-next','secondary-button')}${btn('模拟当前目标丢失','missing-target','secondary-button')}${btn('回到完整路线','full-route','secondary-button')}${btn('重置本原型','reset','text-button')}</div><pre>${e(JSON.stringify(snapshot(),null,2))}</pre>`;openDialog(el);}
function showMap(){const el=$('#inspector');el.className='map-dialog';el.innerHTML=`<div class="dialog-heading"><h2 id="inspector-title">你的完整路线</h2>${btn(icon('close'),'close-dialog','icon-button','aria-label="关闭路线"')}</div><p class="muted">已完成的步骤可以回看，尚未准备好的步骤会说明缺少什么。</p>${steps.map((s,i)=>`<button class="map-step" data-action="jump" data-step="${s.id}"><span>${done(s)?icon('check'):String(i+1).padStart(2,'0')}</span><span>${s.title}</span><small>${done(s)?'已完成':s.id===current()?.id?'当前步骤':'待体验'}</small></button>`).join('')}`;openDialog(el);}
function bindForms(){
 const bind=(id,handler)=>{const form=$(id);form?.addEventListener('submit',event=>{event.preventDefault();handler(new FormData(form));});};
 bind('#capture-form',data=>{const body=data.get('body').trim();if(!body)return;if(state.source&&state.source!==body){state.facts={model:state.facts.model,config:state.facts.config,connected:state.facts.connected};state.visited=state.visited.filter(id=>steps.find(s=>s.id===id).chapter===0);for(const key of ['answer','answerDraft','understanding','understandingDraft','reviewDraft','draftText'])state[key]='';log('material-replaced',{reason:'downstream-evidence-invalidated'});}state.source=body;state.sourceDraft=body;state.sourceTitle=data.get('title');fact('source');finishAction('原文已保存。你可以继续下一步。',true);});
 bind('#answer-form',data=>{const answer=data.get('answer').trim();if(!answer){notify('先写下一点自己的解释。');return;}state.answer=answer;fact('answered');finishAction('你的回答已保存。下一步看看示例反馈。');});
 bind('#understanding-form',data=>{if(!data.get('understanding').trim()){notify('先写一句自己确认的理解。');return;}state.understanding=data.get('understanding');fact('understood');finishAction('已保存自己的理解。',true);});
 bind('#review-form',data=>{if(!data.get('review').trim()){notify('先试着用自己的话回忆。');return;}fact('reviewed');finishAction('这次模拟复习已完成。',true);});
 bind('#search-form',data=>{state.query=data.get('query').trim();state.searchAttempted=true;const match=state.facts.source&&`${state.source} ${material().title}`.includes(state.query)&&state.query.length>0;fact('searched',match);finishAction(match?'找到这次练习的来源。':'没有匹配结果，可以换一个词。',true);});
 bind('#draft-form',data=>{if(!data.get('draft').trim()){notify('草稿还没有内容。');return;}state.draftText=data.get('draft');fact('edited');finishAction('草稿修改已保存。',true);});
 $('#model-choice')?.addEventListener('change',event=>{fact('model',Boolean(event.target.value));fact('config',false);fact('connected',false);refresh({host:true});});
 $('#source-consent')?.addEventListener('change',event=>{fact('sourceConsent',event.target.checked);refresh({host:true});if(event.target.checked)notify('这份示例的模拟许可已记录。');});
 $('#knowledge-consent')?.addEventListener('change',event=>{fact('knowledgeConsent',event.target.checked);refresh({host:true});});
 $$('textarea,input').forEach(el=>el.addEventListener('input',()=>{const keys={body:'sourceDraft',title:'sourceTitle',answer:'answerDraft',understanding:'understandingDraft',review:'reviewDraft',draft:'draftText'};if(keys[el.name])state[keys[el.name]]=el.value;}));
}
function finishAction(message,host=false){state.blocked=null;refresh({host});notify(message);announce(message);}
async function simulate(which){
 const facts=state.facts;
 if(which==='connect'&&!facts.config||which==='process'&&(!facts.sourceConsent||!facts.connected))return;
 if(state.busy)return;state.busy=true;const generation=guideGeneration;refresh({host:true});
 await new Promise(resolve=>setTimeout(resolve,reduced()?60:650));state.busy=false;
 if(which==='connect'&&state.failNext){state.failNext=false;state.connectionError=true;fact('connected',false);finishAction('模拟连接失败。配置保留，可以重试。',true);return;}
 state.connectionError=false;fact(which==='connect'?'connected':'processed');
 // Late completions update proof, never navigate or advance the guide.
 finishAction(which==='connect'?'演示连接成功，可以继续。':'模拟拆解完成，可以继续。',generation===guideGeneration);
}
document.addEventListener('click',event=>{
 const el=event.target.closest('[data-action]');if(!el||el.disabled)return;const action=el.dataset.action;
 if(action==='theme'){document.documentElement.classList.toggle('dark');placeGuide();return;}
 if(action==='close-dialog'){closeDialog(el.closest('dialog'));return;}
 if(action==='variant'){setVariant(el.dataset.variant);return;}
 if(action==='variant-prev'||action==='variant-next'){cycle(action==='variant-next'?1:-1);return;}
 if(action==='material'){state.material=el.dataset.material;showWelcome();return;}
 if(action==='welcome'){showWelcome();return;}
 if(action==='begin'){if(!state.active)state.index=0;begin();return;}
 if(action==='welcome-ask'){closeDialog($('#welcome'));showAssistant();return;}
 if(action==='pause'){pause();return;}
 if(action==='resume'){resume();return;}
 if(action==='next'){next();return;}
 if(action==='back'){if(state.index>0)goStep(state.index-1);return;}
 if(action==='locate'){focusTarget();return;}
 if(action==='relocate'){state.forceMissing=false;goStep(state.index);return;}
 if(action==='repair'){repair();return;}
 if(action==='ask'){showAssistant();return;}
 if(action==='detail'){state.detail=!state.detail;drawCoach();return;}
 if(action==='dock-next'){if(current().evidence&&!done(current())||state.missingTarget||current().requires.some(k=>!state.facts[k])){state.detail=true;drawCoach();focusTarget();}else next();return;}
 if(action==='goal'){state.proposal=buildPlan(el.dataset.goal);state.assistantReply='按当前进度整理好了。先确认这条路线，再开始操作。';state.choices=null;showAssistant();return;}
 if(action==='accept-plan'){acceptPlan(state.proposal);return;}
 if(action==='map'){showMap();return;}
 if(action==='inspect'){showInspector();return;}
 if(action==='jump'){closeDialog($('#inspector'));state.route=steps.map(s=>s.id);state.routeLabel='完整核心体验';state.repairReturn=null;goStep(state.route.indexOf(el.dataset.step));return;}
 if(action==='full-route'){closeDialog($('#inspector'));state.route=steps.map(s=>s.id);state.routeLabel='完整核心体验';state.repairReturn=null;goStep(steps.findIndex(s=>!done(s))>=0?steps.findIndex(s=>!done(s)):27);return;}
 if(action==='fail-next'){state.failNext=true;closeDialog($('#inspector'));notify('下一次模拟连接会失败一次，之后可正常重试。');return;}
 if(action==='missing-target'){state.forceMissing=true;closeDialog($('#inspector'));placeGuide();return;}
 if(action==='reset'){closeDialog($('#inspector'));location.href=`?variant=${state.variant}`;return;}
 if(action==='nav'){state.view=el.dataset.view;drawHost();drawCoach();if(state.active&&!state.paused)notify('可以自由浏览。点“重新定位”返回正在练习的步骤。');return;}
 if(action==='fill-example'){state.sourceDraft=material().body;state.sourceTitle=material().title;refresh({host:true});return;}
 if(action==='save-config'&&state.facts.model){fact('config');finishAction('演示设置已保存。',true);return;}
 if(action==='test-model'){simulate('connect');return;}
 if(action==='process'){simulate('process');return;}
 if(action==='select-knowledge'&&state.facts.processed){fact('selected');finishAction('已选定这条练习知识。',true);return;}
 if(action==='plan'&&state.facts.selected&&state.facts.knowledgeConsent){fact('planned');finishAction('已加入练习清单。',true);return;}
 if(action==='start-study'&&state.facts.planned){fact('started');finishAction('本轮练习已开始。',true);return;}
 if(action==='hide-material'&&state.facts.started){fact('hidden');finishAction('材料已收起。试着回忆，不必完美。',true);return;}
 if(action==='finish-study'&&state.facts.answered){fact('finished');finishAction('本轮模拟练习已结束。',true);return;}
 if(action==='advance-clock'&&state.facts.understood){fact('due');finishAction('模拟时钟已前进，复习来到眼前。',true);return;}
 if(action==='make-draft'&&state.facts.searched&&state.facts.understood){state.draftText=`我想记住的是：${material().knowledge}\n\n${state.understanding||'先把问题写清楚，再回到材料中寻找线索。'}\n\n来源：[1] ${material().title}，原创虚构练习第 1–2 段。`;fact('draft');finishAction('示例草稿已展开，接下来看看引用。',true);return;}
 if(action==='adopt'&&state.facts.edited){fact('adopted');finishAction('已记录你的采用决定。',true);return;}
 if(action==='extension'){notify(`${el.dataset.topic}属于可选扩展；本次原型先体验 28 步核心流程。`);}
});
document.addEventListener('compositionend',()=>{lastComposition=performance.now();});
document.addEventListener('keydown',event=>{
 if(event.isComposing||event.keyCode===229)return;
 if(event.key==='Enter'&&performance.now()-lastComposition<500){event.preventDefault();return;}
 if(event.key==='Escape'&&!$('dialog[open]')&&state.active&&!state.paused){event.preventDefault();event.stopPropagation();pause();return;}
 if(!event.target.closest('input,textarea,select,[contenteditable],dialog')&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();cycle(event.key==='ArrowRight'?1:-1);}
});
$$('dialog').forEach(el=>el.addEventListener('cancel',event=>{event.preventDefault();event.stopPropagation();closeDialog(el);}));
let scheduled=false;const schedulePlace=()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;placeGuide();});};
window.addEventListener('scroll',schedulePlace,{passive:true,capture:true});window.addEventListener('resize',schedulePlace);
new ResizeObserver(schedulePlace).observe($('#main'));
// Future assistant boundary: structured catalog + read-only progress + validated proposal.
// No arbitrary selectors, script execution, permissions, or evidence setters are exposed.
window.zhixuGuide=Object.freeze({version:1,getCatalog:()=>structuredClone(steps),getContext:snapshot,proposeGoal:goal=>structuredClone(buildPlan(goal)),presentPlan:plan=>{
 if(plan?.schemaVersion!==1||!goalSpecs[plan.goal])return {accepted:false,reason:'unknown-goal'};
 const safe=buildPlan(plan.goal);state.proposal=safe;state.assistantReply='已按当前进度重新核对前置条件。请确认路线。';showAssistant();return {accepted:true,requiresUserStart:true};
},pause,resume});
drawHost();drawSwitcher();showWelcome();
