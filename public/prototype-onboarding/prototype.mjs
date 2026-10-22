// Prototype 02: fixed geography, persistent controls, memory-only demo data.
import {icon} from './ui.mjs';
import {createGuideMotion} from './onboarding-motion.mjs';
import {calcDampedHarmonicOscillator,SPRING_GENTLE} from './cds/ClaudeMotionPresets.mjs';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sample='读完一页书后，先合上书，试着用自己的话回想。\n再打开书，找到刚才遗漏的部分。眼熟，不代表能独立想起来。';
const example='我会先合上书，用自己的话解释，再对照原文补上遗漏。能认出来，不代表能独立想起来。';
const names=['收集','知识库','学习','输出'],symbols=['plus','layers','book','file'];
const fresh=()=>({started:false,done:0,sources:[],selected:null,read:false,answers:[],drafts:[]});
let state=fresh(),serial=0,guideSerial=0;
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const motion=createGuideMotion({bottom:()=>$('#guide').getBoundingClientRect().top-12,onToggle:()=>locate(true)});
$$('[data-icon]').forEach(n=>n.innerHTML=icon(n.dataset.icon));
const holes=[[0,0,450,300],[450,0,550,300],[0,300,450,300],[450,300,550,300]];
const contours=['M-70 100C70-20 250 5 335 63S390 180 520 155 600-15 780 25s80 160 310 140','M-55 121C80 5 241 32 324 85S400 199 531 177 624 6 779 48s102 159 315 144','M-40 142C78 31 230 52 311 107S400 222 538 197 647 33 784 72s112 162 310 140','M-30 161C70 55 219 75 301 129S406 244 552 219 672 58 788 94s124 168 312 139','M-80 443C150 322 173 462 345 446s100-104 277-82 172 179 437 58','M-80 466C130 349 179 487 346 470s109-105 272-81 177 180 443 58','M-80 490C120 376 179 512 349 494s116-106 268-81 184 181 449 58','M-80 515C120 403 179 537 351 520s122-107 267-81 188 183 452 58'];
$('#main').innerHTML='<header class="page-heading"><div><div class="eyebrow">A WORLD OF YOUR OWN</div><h1>我的知识空间</h1></div><div class="heading-right"><span id="world-status">尚待探索</span><strong id="completion">0</strong><span>/ 4</span></div></header>'+
'<div class="world" id="world"><div class="fixed-map">'+names.map((name,i)=>'<section class="region" data-region="'+i+'" aria-label="'+name+'区域" inert aria-hidden="true"><header class="zone-head">'+icon(symbols[i])+'<h2>'+(i===2?'今日学习':name)+'</h2><span class="zone-mark" id="mark-'+i+'"></span></header><div class="zone-body" id="body-'+i+'"></div><footer class="zone-footer" id="footer-'+i+'"></footer></section>').join('')+'</div>'+
'<svg class="fog-field" viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="fog-tone" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#1c2725"/><stop offset=".55" stop-color="#29332e"/><stop offset="1" stop-color="#343b31"/></linearGradient><radialGradient id="cloud-light"><stop stop-color="#a4a783" stop-opacity=".1"/><stop offset="1" stop-color="#88977e" stop-opacity="0"/></radialGradient>'+holes.map(([x,y,w,h],i)=>'<clipPath id="fog-clip-'+i+'"><rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'"/></clipPath>').join('')+'</defs>'+
holes.map((_,i)=>'<g clip-path="url(#fog-clip-'+i+')"><g id="hole-'+i+'" class="fog-hole"><rect width="1000" height="600" fill="url(#fog-tone)"/><ellipse cx="260" cy="150" rx="380" ry="230" fill="url(#cloud-light)"/><ellipse cx="790" cy="510" rx="500" ry="320" fill="url(#cloud-light)"/><g class="contour">'+contours.map(d=>'<path d="'+d+'"/>').join('')+'</g><path class="trail" d="M225 150C420 40 700 30 725 150S200 240 225 450 580 550 725 450"/><g class="star"><circle cx="725" cy="150" r="2"/><circle cx="225" cy="450" r="2"/><circle cx="725" cy="450" r="2"/><circle cx="621" cy="74" r="1"/><circle cx="851" cy="285" r="1.2"/><circle cx="124" cy="525" r="1.2"/></g></g></g>').join('')+'</svg>'+
'<div class="first-light" id="first-light"><div class="beacon">'+icon('leaf')+'</div><h2>从一束微光开始</h2><p>这里的一切，已在原地等你。<br>走过的地方，会一直亮着。</p><button id="begin">点亮第一片区域 '+icon('arrow')+'</button></div><div class="world-coordinate">ZHIXU<br>A WORLD TO DISCOVER</div></div>'+
'<div class="map-caption"><span id="map-caption">跟随小叶子，探索这张属于你的地图。</span><span>练习原型 · 仅本页内存</span></div>';
$('#body-0').innerHTML='<div class="field-caption"><label for="material">留下一段文字</label><button data-do="sample">放入示例</button></div><textarea class="text-field" id="material" placeholder="一段摘录，一个念头。都从这里留下。"></textarea>';
$('#footer-0').innerHTML='<small id="capture-count">0 份资料</small><button class="primary" data-do="save" disabled>收进知识库 '+icon('arrow')+'</button>';
$('#body-1').innerHTML='<div class="library-columns"><div class="source-list" id="source-list"></div><article class="source-detail" id="source-detail"></article></div>';
$('#footer-1').innerHTML='<small>资料与来源留在这里</small><button class="primary" data-do="learn" disabled>加入今日学习 '+icon('arrow')+'</button>';
$('#body-2').innerHTML='<p class="study-question" id="study-question">用自己的话，解释刚才的发现。</p><div class="field-caption"><label for="answer">我的理解</label><button data-do="example-answer">填入示例</button></div><textarea class="text-field study-answer" id="answer" placeholder="合上资料，试着回想，再写一句自己的理解…"></textarea>';
$('#footer-2').innerHTML='<small id="answer-count">练习原型不进行 AI 批改</small><button class="primary" data-do="answer" disabled>保存理解 '+icon('check')+'</button>';
$('#body-3').innerHTML='<div class="output-caption"><label for="output">我的知识卡片</label><span>可以继续编辑</span></div><textarea class="text-field output-editor" id="output" placeholder="把刚才的理解整理成一张卡片，让知识用起来。"></textarea>';
$('#footer-3').innerHTML='<small id="draft-count">0 份草稿</small><div class="output-footer"><button class="secondary" data-do="generate" disabled>引用刚才的理解</button><button class="primary" data-do="draft" disabled>存为草稿 '+icon('file')+'</button></div>';
$('#navigation').innerHTML='<button class="nav-item" data-nav="home" aria-label="查看探索全景">'+icon('home')+'<span>今日</span></button>'+names.map((n,i)=>'<button class="nav-item locked" data-nav="'+i+'" aria-label="'+n+'" disabled>'+icon(symbols[i])+'<span>'+n+'</span><span class="nav-done" id="nav-mark-'+i+'"></span></button>').join('');
$('#seed-progress').innerHTML=names.map((_,i)=>'<i id="progress-'+i+'"></i>').join('');
const zone=i=>$('[data-region="'+i+'"]'),enabled=i=>state.started&&i<=Math.min(3,state.done);
function report(){$('#state').textContent=JSON.stringify({方案:'固定地图 / 迷雾揭示',阶段:!state.started?'尚未开始':state.done===4?'自由使用':names[state.done],已探索:names.slice(0,state.done),当前可用:names.filter((_,i)=>enabled(i)),资料:state.sources.length,理解:state.answers.length,草稿:state.drafts.length,区域布局:'45% / 55% 两列，50% / 50% 两行；不替换节点或改变位置',保存:'本页内存，刷新重置',网络:'禁用，无真实 AI'},null,2);}
function flash(message){$('#announcement').textContent=message;$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(flash.timer);flash.timer=setTimeout(()=>$('#toast').hidden=true,2000);}
function updateAccess(){
 names.forEach((_,i)=>{const available=enabled(i),el=zone(i),nav=$('[data-nav="'+i+'"]');el.inert=!available;el.setAttribute('aria-hidden',String(!available));nav.disabled=!available;nav.classList.toggle('locked',!available);if(state.started&&state.done===i)nav.setAttribute('aria-current','step');else nav.removeAttribute('aria-current');$('#nav-mark-'+i).textContent=i<state.done?'✓':'';$('#progress-'+i).classList.toggle('done',i<state.done);$('#mark-'+i).textContent=i<state.done?'已点亮':available?'当前探索':'';$('#mark-'+i).classList.toggle('active',available&&i===state.done);});
 $('#completion').textContent=state.done;$('#world-status').textContent=!state.started?'尚待探索':state.done===4?'自由使用':'正在探索';$('#first-light').hidden=state.started;$('#world').classList.toggle('fog-free',state.done>=3);$('#map-caption').textContent=state.done===4?'地图已点亮。所有功能仍在原来的位置，继续使用就好。':'已点亮的区域可以随时使用，下一片区域等待你完成当前探索。';report();
}
function updateData(){
 $('#capture-count').textContent=state.sources.length+' 份资料';
 $('#source-list').innerHTML=state.sources.map(s=>'<button class="source-row" data-source="'+s.id+'" aria-pressed="'+(s.id===state.selected)+'">'+icon('file')+'<span><strong>'+esc(s.title)+'</strong><small>本次体验 · 原文保留</small></span></button>').join('');
 const source=state.sources.find(s=>s.id===state.selected);
 $('#source-detail').innerHTML=source&&state.read?'<small>原始资料 · 本页示例</small><h3>'+esc(source.title)+'</h3><p>'+esc(source.text)+'</p>':'<div class="empty-copy">选择一份资料，<br>接着探索它。</div>';
 $('[data-do="learn"]').disabled=!source||!state.read;$('[data-do="generate"]').disabled=!state.answers.length;
 $('#answer-count').textContent=state.answers.length?'已留下 '+state.answers.length+' 次理解 · 未进行批改':'练习原型不进行 AI 批改';$('#draft-count').textContent=state.drafts.length+' 份草稿';guidance();report();
}
async function unveil(i){
 const hole=$('#hole-'+i),el=zone(i);hole.style.opacity='0';if(reduced())return;
 const fade=hole.animate([{opacity:1},{opacity:0}],{duration:1150,easing:'cubic-bezier(.16,1,.3,1)'});
 const frames=Array.from({length:55},(_,n)=>{const t=n/54,p=n===54?1:calcDampedHarmonicOscillator(SPRING_GENTLE.stiffness,SPRING_GENTLE.damping,1,t*.8);return {offset:t,transform:'scale('+(1-(1-p)*.045)+')'};});
 const spring=el.animate(frames,{duration:800,delay:200,easing:'linear'});await Promise.allSettled([fade.finished,spring.finished]);
}
async function begin(){if(state.started)return;state.started=true;const version=++serial;++guideSerial;motion.hide();updateAccess();const expected=guideSerial;await unveil(0);if(version===serial&&expected===guideSerial)locate();}
async function complete(i){
 if(state.done!==i)return;state.done++;const version=++serial;++guideSerial;motion.cancel();updateAccess();
 if(state.done<4){flash(names[i]+'已点亮 · 继续探索'+names[state.done]);const expected=guideSerial;await unveil(state.done);if(version===serial&&expected===guideSerial)locate();}
 else{motion.hide();flash('地图已点亮，继续使用就好。');}
 guidance();
}
function guidance(){
 let copy,target;
 if(!state.started){copy='地图早已在这里。点亮第一片区域，我们从收下一段文字开始。';target='#begin';}
 else if(state.done===0){copy=$('#material').value.trim()?'把这段文字收进知识库。收集框会一直留在原处，随时可以再用。':'先放入一段示例，再收进知识库。走过的区域会一直亮着。';target=$('#material').value.trim()?'[data-do="save"]':'[data-do="sample"]';}
 else if(state.done===1){copy=state.read?'看过原文了。把它加入今日学习，下一片区域就会亮起。':'右上方是知识库。打开刚才的资料；左边的收集区仍然能继续使用。';target=state.read?'[data-do="learn"]':'[data-source]';}
 else if(state.done===2){copy=$('#answer').value.trim()?'把自己的理解留下来。学习区会保持原样，之后还可以继续写。':'左下方是今日学习。试着写一句理解，或先用示例体验。';target=$('#answer').value.trim()?'[data-do="answer"]':'[data-do="example-answer"]';}
 else if(state.done===3){copy=$('#output').value.trim()?'这张卡片可以直接编辑。存为草稿，就走完了第一次探索。':'最后是右下方的输出。引用刚才的理解，整理成自己的小卡片。';target=$('#output').value.trim()?'[data-do="draft"]':'[data-do="generate"]';}
 else{copy='四个区域都留在原来的位置。继续收集、阅读、练习或编辑草稿，我就在这里。';target='[data-do="sample"]';}
 $('#guide-kicker').textContent=state.done===4?'小叶子 · 随时陪你':'小叶子 · '+(!state.started?'从这里出发':names[state.done]);$('#guide-copy').textContent=copy;return $(target);
}
async function locate(frame=false){const token=++guideSerial,target=guidance();if(!target||target.disabled)return;await motion.retract();if(token!==guideSerial)return;await motion.scroll(target);if(token!==guideSerial)return;await motion.move(target);if(token!==guideSerial)return;if(frame)await motion.frame(target);if(token===guideSerial)motion.pulse();}
function reset(){++serial;++guideSerial;motion.hide();document.getAnimations().forEach(a=>a.cancel());state=fresh();$$('.fog-hole').forEach(n=>n.style.opacity='1');$('#material').value='';$('#answer').value='';$('#output').value='';$('[data-do="save"]').disabled=true;$('[data-do="answer"]').disabled=true;$('[data-do="draft"]').disabled=true;$('#study-question').textContent='用自己的话，解释刚才的发现。';$('#toast').hidden=true;updateAccess();updateData();window.scrollTo({top:0,behavior:'instant'});locate();}
$('#begin').onclick=begin;
$('#main').addEventListener('click',event=>{
 const row=event.target.closest('[data-source]');if(row&&enabled(1)){state.selected=Number(row.dataset.source);state.read=true;updateData();locate();return;}
 const button=event.target.closest('[data-do]');if(!button||button.disabled)return;
 switch(button.dataset.do){
 case 'sample':if(enabled(0)){$('#material').value=sample;$('[data-do="save"]').disabled=false;guidance();locate();}break;
 case 'save':{const text=$('#material').value.trim();if(!enabled(0)||!text)break;const id=state.sources.length+1;state.sources.unshift({id,title:text===sample?'从“眼熟”到“想得起”':text.split('\n')[0].slice(0,24),text});$('#material').value='';button.disabled=true;updateData();if(state.done===0)complete(0);else flash('资料已收好，仍可继续收集。');break;}
 case 'learn':if(enabled(1)&&state.read){const source=state.sources.find(s=>s.id===state.selected);$('#study-question').textContent='关于「'+source.title+'」，你会怎样用自己的话解释？';if(state.done===1)complete(1);else{flash('已选为当前学习资料。');zone(2).querySelector('textarea').focus({preventScroll:true});}}break;
 case 'example-answer':if(enabled(2)){$('#answer').value=example;$('[data-do="answer"]').disabled=false;guidance();locate();}break;
 case 'answer':{const answer=$('#answer').value.trim();if(!enabled(2)||!answer)break;state.answers.push({source:state.selected,text:answer});updateData();if(state.done===2)complete(2);else flash('理解已保存；没有进行 AI 批改。');break;}
 case 'generate':if(enabled(3)&&state.answers.length){$('#output').value='下一次阅读，我会这样做\n\n'+state.answers.at(-1).text;$('[data-do="draft"]').disabled=false;guidance();locate();}break;
 case 'draft':{const text=$('#output').value.trim();if(!enabled(3)||!text)break;state.drafts.push({text,source:state.selected});updateData();if(state.done===3)complete(3);else flash('已存为本页草稿，编辑区保持不变。');break;}
 }report();
});
$('#main').addEventListener('input',event=>{const action={material:'save',answer:'answer',output:'draft'}[event.target.id];if(action)$('[data-do="'+action+'"]').disabled=!event.target.value.trim();guidance();report();});
$('#navigation').addEventListener('click',event=>{const button=event.target.closest('[data-nav]');if(!button||button.disabled)return;if(button.dataset.nav==='home'){window.scrollTo({top:0,behavior:reduced()?'instant':'smooth'});return;}const el=zone(Number(button.dataset.nav));el.scrollIntoView({block:'nearest',behavior:reduced()?'instant':'smooth'});el.querySelector('textarea,button:not(:disabled)')?.focus({preventScroll:true});});
$('#restart').onclick=reset;$('#locate').onclick=()=>locate(true);$('#theme').onclick=()=>{const dark=document.documentElement.classList.toggle('dark');$('#theme').innerHTML=icon(dark?'sun':'moon');};
$('#state-toggle').onclick=()=>{$('#state').hidden=!$('#state').hidden;$('#state-toggle').setAttribute('aria-expanded',String(!$('#state').hidden));report();};
document.addEventListener('keydown',event=>{if(event.key==='Escape'){$('#state').hidden=true;$('#state-toggle').setAttribute('aria-expanded','false');motion.retract();}});
window.addEventListener('scroll',()=>motion.track(),{passive:true});window.addEventListener('resize',()=>motion.track());
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',()=>{if(reduced())document.getAnimations().forEach(a=>a.cancel());motion.cancel();locate();});
updateAccess();updateData();locate();
