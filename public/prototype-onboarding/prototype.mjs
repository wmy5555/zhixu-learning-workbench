// Three progressive-onboarding layouts, ?variant=A|B|C. In-memory, disposable.
// Question: does earning each new region make the existing workbench easier to explore?
import {icon} from './ui.mjs';
import {createGuideMotion} from './onboarding-motion.mjs';
import {calcDampedHarmonicOscillator,SPRING_GENTLE,SPRING_SNAPPY} from './cds/ClaudeMotionPresets.mjs';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sample=`读完一页书后，先合上书，试着用自己的话回想。
再打开书，找到刚才遗漏的部分。与反复重读相比，这个动作让我们更容易发现：哪些只是眼熟，哪些才真正理解。`;
const sampleAnswer='我会先合上书，用自己的话解释，再对照原文补上遗漏。能认出来，不代表能独立想起来。';
const names=['收集','知识库','学习','输出'],symbols=['plus','layers','book','file'];
const variants={A:'地图生长',B:'章节探索',C:'路径漫游'};
let variant=new URLSearchParams(location.search).get('variant');if(!variants[variant])variant='A';
const fresh=()=>({started:false,done:0,material:'',opened:false,answer:'',answered:false,selected:false,generated:false,view:null});
let state=fresh(),epoch=0,guideEpoch=0;
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
$$('[data-icon]').forEach(n=>n.innerHTML=icon(n.dataset.icon));
const motion=createGuideMotion({bottom:()=>$('#guide').getBoundingClientRect().top-12,onToggle:()=>locate(true)});
function animateIn(node,large=false){
 if(!node||reduced())return Promise.resolve();
 const spring=large?SPRING_GENTLE:SPRING_SNAPPY;
 const frames=Array.from({length:61},(_,i)=>{const t=i/60,p=i===60?1:calcDampedHarmonicOscillator(spring.stiffness,spring.damping,1,t*.85);return {offset:t,opacity:Math.min(1,t*5),transform:`translateY(${(1-p)*(large?35:15)}px) scale(${1-(1-p)*(large?.09:.025)},${1-(1-p)*(large?.14:.025)})`};});
 return node.animate(frames,{duration:850,easing:'linear'}).finished.catch(()=>{});
}
function flash(message){$('#announcement').textContent=message;$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(flash.timer);flash.timer=setTimeout(()=>$('#toast').hidden=true,2400);}
function report(){
 $('#state').textContent=JSON.stringify({方案:`${variant} · ${variants[variant]}`,阶段:!state.started?'尚未开始':state.done===4?'探索完成':names[state.done],已完成:names.slice(0,state.done),已展开:state.started?names.slice(0,Math.min(4,state.done+1)):[],下一步解锁:state.done<3?names[state.done+1]:null,操作:{已放入资料:!!state.material.trim(),已展开知识:state.opened,已有回答:!!state.answer.trim(),已确认回答:state.answered,已选择引用:state.selected,已生成示例:state.generated},保存:'仅本页内存，刷新重置',网络:'禁用；没有 API 调用'},null,2);
}
function nav(){
 $('#navigation').innerHTML=`<button class="nav-item" data-nav="home" aria-label="查看探索全景">${icon('home')}<span class="nav-label">今日</span></button>`+names.slice(0,state.started?Math.min(4,state.done+1):0).map((n,i)=>`<button class="nav-item" data-nav="${i}" aria-label="${n}" ${i===state.done?'aria-current="step"':''}>${icon(symbols[i])}<span class="nav-label">${n}</span>${i<state.done?'<span class="nav-done">✓</span>':''}</button>`).join('');
 $('#seed-progress').innerHTML=names.map((_,i)=>`<i class="${i<state.done?'done':''}"></i>`).join('');
}
function welcome(){return `<section class="welcome"><div class="welcome-art">${icon('leaf')}<i></i></div><div class="eyebrow">A LITTLE AT A TIME</div><h1>一点一点，<br>展开你的知识世界。</h1><p>现在，这里还是一张空白地图。<br>跟着小叶子走一小段，让知序随你的探索慢慢生长。</p><button class="primary" data-do="start">开始探索 ${icon('arrow')}</button><small>4 个小发现 · 约 2 分钟 · 随时重新开始</small></section>`;}
const titles=['先收下一点好奇','让灵感，有处可寻','把看过，变成想得起','让知识，走出知识库'];
const doneTitles=['第一份灵感，已收好','知识有了自己的位置','留下了自己的理解','完成了一次小小输出'];
const doneCopies=['收集区域已点亮 · 1 份示例原文','知识库已点亮 · 1 条示例知识','学习区域已点亮 · 1 次模拟练习','输出区域已点亮 · 1 份示例草稿'];
function currentContent(i){
 if(i===0)return `<h2>${titles[i]}</h2><p class="intro">一段摘录、一个念头，都可以成为起点。<br>先放入一段练习资料，亲手点亮第一块地图。</p><div class="input-label"><label for="material">想留下的内容</label><button data-do="sample">放入一段示例</button></div><textarea class="material-text" id="material" placeholder="从一小段文字开始…">${escape(state.material)}</textarea><div class="region-actions"><small>仅保留在这次原型体验中</small><button class="primary" data-do="save" ${!state.material.trim()?'disabled':''}>收好这份灵感 ${icon('arrow')}</button></div>`;
 if(i===1)return `<h2>${titles[i]}</h2><p class="intro">刚才收下的文字，现在有了一个可以再次找到的位置。<br>打开这条示例知识，看看原文怎样变成学习的起点。</p><div class="source-preview"><small>来自你刚才收集的文字</small><p>${escape(state.material)}</p></div><button class="knowledge-choice" data-do="open" aria-expanded="${state.opened}">${icon('layers')}<span><strong>从“眼熟”到“想得起”</strong><small>示例知识 · 点击展开</small></span>${icon('arrow')}</button>${state.opened?'<div class="read-note"><small>预设内容 · 未调用 AI</small>合上资料，主动回想；再对照原文，发现遗漏。<br>接下来，用自己的话解释一次。</div>':''}<div class="region-actions"><small>${state.opened?'已探索：知识与来源的关系':'打开知识后，才能继续探索'}</small><button class="primary" data-do="learn" ${!state.opened?'disabled':''}>带着它去学习 ${icon('arrow')}</button></div>`;
 if(i===2)return `<h2>${titles[i]}</h2><p class="intro">这里不急着给你更多内容。先停一下，试着回想刚才的发现。</p><p class="question">如果只会“看着很熟”，你会怎样<br>确认自己真的理解了？</p><div class="input-label"><label for="answer">用自己的话说一遍</label><button data-do="sample-answer">填入示例回答</button></div><textarea class="answer-text" id="answer" placeholder="我会试着…">${escape(state.answer)}</textarea>${state.answered?'<div class="feedback">这段回答已留在本次体验里。<br>原型只展示交互，不批改，也不判断是否掌握。</div>':''}<div class="region-actions"><small>${state.answered?'你的回答，是下一步输出的起点':'可以随意写一句，也可以使用示例'}</small><button class="primary" data-do="${state.answered?'finish-learning':'answer'}" ${!state.answer.trim()?'disabled':''}>${state.answered?'解锁输出区域':'留下我的理解'} ${icon('arrow')}</button></div>`;
 return `<h2>${titles[i]}</h2><p class="intro">把自己的理解整理成一张小卡片。<br>一次完整的探索，从收集开始，到真正用起来。</p>${!state.generated?`<label class="output-select"><input type="checkbox" id="source-choice" ${state.selected?'checked':''}><span>引用「从眼熟到想得起」<br><small class="region-note">带上刚才留下的理解</small></span></label>`:`<article class="output-paper"><h3>下一次阅读，我会这样做</h3><p>${escape(state.answer)}</p><small>引用：从“眼熟”到“想得起” · 预设排版，未调用 AI</small></article>`}<div class="region-actions"><small>${state.generated?'一张属于这次探索的知识卡片':'选择来源后，才能生成示例卡片'}</small><button class="primary" data-do="${state.generated?'finish':'generate'}" ${!state.selected?'disabled':''}>${state.generated?'完成这次探索':'生成我的小卡片'} ${icon('arrow')}</button></div>`;
}
function region(i){
 const complete=i<state.done,detail=state.view===i;
 return `<section class="region ${complete?'completed':'active'} ${detail?'has-detail':''}" data-region="${i}" data-number="0${i+1}" aria-label="${names[i]}区域"><header class="region-header"><span class="region-name">${icon(symbols[i])}${names[i]}<span class="region-number">/ 0${i+1}</span></span><span class="region-status">${complete?'✓ 已探索':'正在探索'}</span></header>${complete?`<h2>${doneTitles[i]}</h2><p>${doneCopies[i]}</p><button class="revisit" data-view="${i}" aria-expanded="${detail}">${detail?'收起':'回看'} ↗</button>${detail?`<div class="complete-detail">${escape(i===0?state.material:i===1?'示例知识：合上资料主动回想，再对照原文发现遗漏。':state.answer)}</div>`:''}`:currentContent(i)}</section>`;
}
function map(){
 const finished=state.done===4;
 return `<header class="page-heading"><div><div class="eyebrow">YOUR WORLD, UNFOLDING</div><h1>${finished?'你的知识世界，展开了。':'每一次探索，都有新发现。'}</h1><p>${{A:'让工作台随你的脚步，一块一块生长。',B:'一次只走进一个章节，慢慢认识整个知序。',C:'沿着自己的来路，把一处处发现连成地图。'}[variant]}</p></div><div class="discovery-count"><strong>${state.done}</strong><span>/ 4 已探索</span></div></header><div class="mini-route" aria-label="探索进度">${names.map((_,i)=>`${i?`<span class="route-link ${i<=state.done?'done':''}"></span>`:''}<span class="route-dot ${i<state.done?'done':i===state.done?'current':''}" aria-label="${i<state.done?names[i]+'已完成':i===state.done?names[i]+'当前探索':'尚未解锁'}">${i<state.done?'✓':i===state.done?'0'+(i+1):'·'}</span>`).join('')}</div><div class="map-board">${Array.from({length:Math.min(4,state.done+1)},(_,i)=>region(i)).join('')}${finished?`<div class="completion-banner">${icon('leaf')}<div><h2>从一片空白，到一条自己的路。</h2><p>收集、整理、学习、输出。四块区域，因你的探索而点亮。</p></div><button class="secondary" data-do="reset">再走一遍</button></div>`:`<div class="frontier">${icon('spark')}下一片区域，藏在这一步完成之后。</div>`}</div>`;
}
function guidance(){
 let copy,target;
 if(!state.started){copy='不用先记住所有入口。点「开始探索」，我们从一小块地方开始。';target='[data-do="start"]';}
 else if(state.done===0){copy=state.material.trim()?'灵感已经放好了。亲手收好它，知识库就会展开。':'点「放入一段示例」，再收好它。完成这一步，下一片区域才会出现。';target=state.material.trim()?'[data-do="save"]':'[data-do="sample"]';}
 else if(state.done===1){copy=state.opened?'现在能看见知识和来源的关系了。把它带去学习，解锁下一站。':'知识库已经展开。点开这条知识，发现刚才的文字去了哪里。';target=state.opened?'[data-do="learn"]':'[data-do="open"]';}
 else if(state.done===2){copy=state.answered?'自己的理解已经留下了。接下来，让它变成可以用的小卡片。':state.answer.trim()?'写好了，就留下这段理解。这里只演示，不会评判你的答案。':'试着写一句自己的理解。也可以填入示例，先体验探索的节奏。';target=state.answered?'[data-do="finish-learning"]':state.answer.trim()?'[data-do="answer"]':'[data-do="sample-answer"]';}
 else if(state.done===3){copy=state.generated?'这是你刚才的理解。确认完成，看看已经点亮的整张地图。':state.selected?'来源已经选好。生成一张示例卡片，走完这条小路。':'最后一站，输出。先选中刚才的知识，把自己的理解带出来。';target=state.generated?'[data-do="finish"]':state.selected?'[data-do="generate"]':'#source-choice';}
 else {copy='四个区域都认识了。可以从侧栏回看，也可以换一种展开方式，再体验一次。';target='[data-do="reset"]';}
 $('#guide-copy').textContent=copy;$('#guide-kicker').textContent=state.started&&state.done<4?`小叶子 · 第 ${state.done+1} 片区域 / ${names[state.done]}`:'小叶子 · 探索向导';
 return $(target);
}
async function locate(frame=false){
 const token=++guideEpoch,target=guidance();if(!target)return;
 await motion.retract();if(token!==guideEpoch||!target.isConnected)return;
 await motion.scroll(target);if(token!==guideEpoch||!target.isConnected)return;
 await motion.move(target);if(token!==guideEpoch||!target.isConnected)return;
 if(frame)await motion.frame(target);motion.pulse();
}
async function render({reveal=false,reset=false}={}){
 const token=++epoch,plannedGuide=++guideEpoch;motion.cancel();
 const oldRects=new Map($$('[data-region]').map(n=>[n.dataset.region,n.getBoundingClientRect()]));
 document.body.dataset.variant=variant;$('#variant-label').textContent=`${variant} · ${variants[variant]}`;
 $('#main').innerHTML=state.started?map():welcome();nav();guidance();report();
 if(reset)window.scrollTo({top:0,behavior:'instant'});
 const current=$('.region.active')||$('.welcome')||$('.completion-banner');
 const animations=[];
 if(reveal){
  if(current&&state.started){const r=current.getBoundingClientRect(),floor=$('#guide').getBoundingClientRect().top;if(r.top<110||r.bottom>floor)current.scrollIntoView({block:'start',behavior:'instant'});}
  animations.push(animateIn(current,true));
  const n=$(`[data-nav="${state.done}"]`);if(n)animations.push(animateIn(n));
 }
 if(!reduced()&&variant==='A')$$('[data-region]').forEach(n=>{const old=oldRects.get(n.dataset.region);if(!old||n===current)return;const r=n.getBoundingClientRect(),dy=old.top-r.top;if(Math.abs(dy)>4)animations.push(n.animate([{transform:`translateY(${Math.max(-50,Math.min(50,dy))}px)`},{transform:'none'}],{duration:450,easing:'cubic-bezier(.16,1,.3,1)'}).finished.catch(()=>{}));});
 await Promise.all(animations);if(token!==epoch)return;
 if(reveal)current?.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
 if(guideEpoch===plannedGuide)await locate();
}
function advance(){state.done++;state.view=null;flash(`${names[state.done-1]}已探索${state.done<4?' · '+names[state.done]+'区域已解锁':' · 地图已全部点亮'}`);render({reveal:true});}
function reset(){++epoch;++guideEpoch;motion.hide();state=fresh();$('#toast').hidden=true;render({reveal:true,reset:true});}
$('#main').addEventListener('click',event=>{
 const view=event.target.closest('[data-view]');if(view){state.view=state.view===Number(view.dataset.view)?null:Number(view.dataset.view);render();return;}
 const button=event.target.closest('[data-do]');if(!button||button.disabled)return;
 switch(button.dataset.do){
 case 'start':if(!state.started){state.started=true;render({reveal:true});}break;
 case 'sample':if(state.done===0){state.material=sample;render();}break;
 case 'save':if(state.done===0&&state.material.trim())advance();break;
 case 'open':if(state.done===1){state.opened=!state.opened;render();if(state.opened)animateIn($('.read-note'));}break;
 case 'learn':if(state.done===1&&state.opened)advance();break;
 case 'sample-answer':if(state.done===2){state.answer=sampleAnswer;state.answered=false;render();}break;
 case 'answer':if(state.done===2&&state.answer.trim()){state.answered=true;render();animateIn($('.feedback'));}break;
 case 'finish-learning':if(state.done===2&&state.answered&&state.answer.trim())advance();break;
 case 'generate':if(state.done===3&&state.selected){state.generated=true;render();animateIn($('.output-paper'),true);}break;
 case 'finish':if(state.done===3&&state.generated)advance();break;
 case 'reset':reset();break;
 }
});
$('#main').addEventListener('input',event=>{
 if(event.target.id==='material'){state.material=event.target.value;$('[data-do="save"]').disabled=!state.material.trim();}
 if(event.target.id==='answer'){state.answer=event.target.value;state.answered=false;$('.feedback')?.remove();const button=$('.region.active .primary');button.dataset.do='answer';button.innerHTML=`留下我的理解 ${icon('arrow')}`;button.disabled=!state.answer.trim();}
 guidance();report();
});
$('#main').addEventListener('change',event=>{if(event.target.id==='source-choice'){state.selected=event.target.checked;$('[data-do="generate"]').disabled=!state.selected;guidance();report();locate();}});
$('#navigation').addEventListener('click',async event=>{const button=event.target.closest('[data-nav]');if(!button)return;const id=button.dataset.nav;if(id==='home'){window.scrollTo({top:0,behavior:reduced()?'instant':'smooth'});return;}const n=Number(id);if(n<state.done){state.view=n;await render();}const el=$(`[data-region="${n}"]`);if(el){el.scrollIntoView({block:'center',behavior:reduced()?'instant':'smooth'});animateIn(el);}});
function switchVariant(direction){const keys=Object.keys(variants);variant=keys[(keys.indexOf(variant)+direction+keys.length)%keys.length];const url=new URL(location.href);url.searchParams.set('variant',variant);history.replaceState(null,'',url);state.view=null;motion.hide();render({reveal:true,reset:true});}
$('#previous').onclick=()=>switchVariant(-1);$('#next').onclick=()=>switchVariant(1);$('#variant-label').onclick=()=>switchVariant(1);$('#restart').onclick=reset;$('#locate').onclick=()=>locate(true);
$('#theme').onclick=()=>{const dark=document.documentElement.classList.toggle('dark');$('#theme').innerHTML=icon(dark?'sun':'moon');};
$('#state-toggle').onclick=()=>{$('#state').hidden=!$('#state').hidden;$('#state-toggle').setAttribute('aria-expanded',String(!$('#state').hidden));report();};
document.addEventListener('keydown',event=>{if(event.target.closest('input,textarea,select,[contenteditable]')||event.isComposing||event.ctrlKey||event.altKey||event.metaKey)return;if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();switchVariant(event.key==='ArrowLeft'?-1:1);}if(event.key==='Escape'){$('#state').hidden=true;$('#state-toggle').setAttribute('aria-expanded','false');motion.retract();}});
window.addEventListener('scroll',()=>motion.track(),{passive:true});window.addEventListener('resize',()=>motion.track());
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',()=>{document.getAnimations().forEach(a=>a.cancel());motion.cancel();locate();});
render({reveal:true});
