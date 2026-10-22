// Cognitive atlas: workflow tiers are navigation, not new permanent knowledge layers.
import {icon} from './ui.mjs';
import {createGuideMotion} from './onboarding-motion.mjs';
import {calcDampedHarmonicOscillator,SPRING_GENTLE} from './cds/ClaudeMotionPresets.mjs';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const modules=[
 {name:'收集资料',kind:'原始资料',icon:'file',x:115,y:630,title:'留下一份原始资料',intro:'从一段文字开始。以后每一次整理，都能回到它。',groups:[['收集与导入','粘贴文本、批量文件导入、ChatGPT 结构导入'],['原文与来源','全文阅读、来源定位、原文编辑与版本'],['处理动态','拆解进度、失败重试、取消、归档与回收站']]},
 {name:'整理知识',kind:'结构化材料',icon:'layers',x:365,y:500,title:'选择值得学习的部分',intro:'整理之后，可以留作参考，也可以主动加入学习。',groups:[['拆解与核验','概念、主张与方法；事实与观点；来源、反证与限制；重新加工'],['知识分流','参考资料、候选池、学习目标、加入学习、知识使用建议'],['结构与关系','逻辑图、思维导图、成员与来源关联、合并与版本']]},
 {name:'学习与复习',kind:'练习过程',icon:'book',x:100,y:370,title:'把看过，变成想得起',intro:'先自己解释，再根据反馈修正。练习记录与掌握程度分开。',groups:[['今日安排','到期复习、时间预算、跳过、延期、暂停与学习时长'],['主题学习','主题学习包、前置知识、学习顺序与主题进度'],['解释与纠错','主动回忆、分级提示、反馈与争议、错题专项、完整学习历史']]},
 {name:'个人理解',kind:'个人知识',icon:'leaf',x:370,y:240,title:'留下自己认可的理解',intro:'原始回答、AI 建议和你的最终确认，是三件不同的事。',groups:[['我的理解','个人表述、明确确认、原始回答与 AI 建议'],['知识联系','关联建议、接受或拒绝关系、综合主题笔记'],['长期沉淀','核心知识建议、重学、停用与替代、修改历史']]},
 {name:'检索与应用',kind:'重新使用',icon:'network',x:125,y:110,title:'让理解，真正用起来',intro:'带着来源去查找、表达和应用。新草稿不会自动变成个人知识。',groups:[['检索与发现','关键词、语义与混合检索；范围筛选、分层取材、周期发现报告'],['问答与输出','带来源问答、引用证据、提纲、草稿与手动编辑'],['使用与反馈','实际采用、撤回采用、草稿重新收集、使用反馈']]}
];
const support=[
 ['模型与权限',[['模型与能力','模型连接、独立搜索、网页读取、语义嵌入与提示词'],['访问边界','资料外发许可、MCP 只读权限与写入提案']]],
 ['节奏与成本',[['学习节奏','每日时间、时区、自动安排与暂停'],['运行与费用','用量、预算、并发、超时、任务日志与诊断']]],
 ['文件与恢复',[['本地文件','Vault、Obsidian 外部编辑、冲突处理与版本'],['可恢复性','备份恢复、回收站、索引重建与写入提案']]],
 ['外部连接',[['MCP 与 ChatGPT','连接、权限、调用诊断与结构化资料接入'],['协作边界','只读检索、受控提案、人工确认与同步状态']]],
 ['外观偏好',[['阅读与界面','深浅模式、强调色与阅读控件']]]
];
const sample='读完一页书后，先合上书，用自己的话回想。\n再打开书，找到遗漏的地方。眼熟，不代表能独立想起来。';
const example='我会先合上资料，用自己的话解释，再回到原文补上遗漏。识别熟悉的文字和独立回想，是不同的过程。';
const fresh=()=>({done:0,selected:0,mode:'explore',tab:'experience',feature:null,support:null,material:'',source:'',depth:'解释原理',answer:'',understanding:'',confirmed:false,output:'',counts:[0,0,0,0,0]});
let state=fresh(),guideSerial=0,expanded=0;
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const motion=createGuideMotion({bottom:()=>innerHeight-60,onToggle:()=>locate(true)});
$$('[data-icon]').forEach(n=>n.innerHTML=icon(n.dataset.icon));
const number=i=>String(i+1).padStart(2,'0');
const points=modules.map(m=>({x:m.x+172,y:m.y+35}));
const roads=points.slice(0,-1).map((p,i)=>{const q=points[i+1];return '<path class="road" id="road-'+i+'" d="M'+p.x+' '+p.y+' C'+p.x+' '+(p.y-75)+' '+q.x+' '+(q.y+75)+' '+q.x+' '+q.y+'"/>';}).join('');
$('#map-world').innerHTML='<svg class="terrain-lines" viewBox="0 0 800 840" aria-hidden="true"><path d="M26 744C-14 645 51 606 69 551s-53-108-37-180 95-87 84-167S54 96 139 49"/><path d="M39 748C2 650 69 610 84 551s-52-108-34-176 96-88 82-171S68 98 152 51"/><path d="M53 750C17 653 83 613 98 555s-51-112-32-177 97-90 80-177S83 100 166 54"/><path d="M731 741c81-62 6-130 13-194s62-100 33-175-64-76-51-150 40-95 4-156"/><path d="M714 737c80-61 4-125 11-189s62-103 33-173-66-80-53-155 40-95 3-155"/><path d="M697 734c79-61 2-121 9-185s62-105 33-174-68-81-55-157 40-94 2-155"/></svg><svg class="route-lines" viewBox="0 0 800 840" aria-hidden="true">'+roads+'<path class="feedback-road" d="M294 141C645 45 713 341 684 491S588 716 293 665"/></svg><div class="north-mark"><svg viewBox="0 0 24 36"><path d="M12 32V3M5 12l7-9 7 9"/></svg>知</div>'+
modules.map((m,i)=>'<section class="layer" data-layer="'+i+'" style="left:'+m.x+'px;top:'+m.y+'px" aria-label="'+m.name+'"><svg class="terrain" viewBox="0 0 369 142" aria-hidden="true"><path d="M30 19C81 6 245 4 311 18L350 40Q365 52 352 70L335 112Q325 127 298 130L70 135Q32 133 18 113L8 70Q2 39 30 19Z"/></svg><button class="layer-head" data-select="'+i+'"><span class="layer-orb">'+number(i)+'</span><span class="layer-title">'+m.name+'</span><span class="layer-kind">'+m.kind+'</span></button><div class="feature-branches">'+m.groups.map(([name],j)=>'<button data-feature="'+i+':'+j+'">'+name+'</button>').join('')+'</div></section>').join('')+
'<div class="map-base"><span>共同支撑</span>'+support.map(([name],i)=>'<button data-support="'+i+'">'+name+'</button>').join('')+'</div>';
$('#navigation').innerHTML=modules.map((m,i)=>'<section class="nav-group"><button class="nav-main" data-nav="'+i+'" aria-expanded="false"><span class="num">'+number(i)+'</span><span>'+m.name+'</span><span class="chevron">›</span></button><div class="nav-children" id="nav-children-'+i+'" hidden>'+m.groups.map(([name],j)=>'<button data-feature="'+i+':'+j+'">'+name+'</button>').join('')+'</div></section>').join('');
function fit(){const arena=$('.map-arena'),s=Math.min(arena.clientWidth/800,arena.clientHeight/840,1);Object.assign($('#map-world').style,{transform:'scale('+s+')',left:(arena.clientWidth-800*s)/2+'px',top:(arena.clientHeight-840*s)/2+'px'});motion.track();}
new ResizeObserver(fit).observe($('.map-arena'));
const unlocked=i=>i<=Math.min(state.done,4);
function report(){$('#state').textContent=JSON.stringify({模式:state.mode==='explore'?'逐层探索':'全图只读浏览',已探索:modules.slice(0,state.done).map(m=>m.name),当前:state.support===null?modules[state.selected].name:support[state.support][0],可操作:modules.filter((_,i)=>unlocked(i)).map(m=>m.name),功能分组:modules.reduce((n,m)=>n+m.groups.length,0)+support.reduce((n,s)=>n+s[1].length,0),演示保存次数:state.counts,地图:'五个固定坐标的功能模块；三类内容并未变为五层知识',正式环境:'未连接，未部署',数据:'仅本页内存；刷新清空'},null,2);}
function refreshMap(){
 $('#map-world').dataset.mode=state.mode;$('#completed').textContent=state.done;$('#map-key').textContent=state.mode==='overview'?'完整功能架构':state.done===5?'全部已探索':'当前探索';
 $$('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===state.mode)));
 modules.forEach((_,i)=>{const node=$('[data-layer="'+i+'"]'),canBrowse=state.mode==='overview'||unlocked(i);node.classList.toggle('locked',!unlocked(i));node.classList.toggle('unlocked',unlocked(i));node.classList.toggle('visited',i<state.done);node.classList.toggle('selected',state.support===null&&state.selected===i);node.querySelector('.layer-orb').textContent=i<state.done?'✓':number(i);node.querySelectorAll('button').forEach(b=>b.disabled=!canBrowse);const nav=$('[data-nav="'+i+'"]');nav.disabled=!canBrowse;nav.classList.toggle('visited',i<state.done);nav.setAttribute('aria-expanded',String(expanded===i));$('#nav-children-'+i).hidden=expanded!==i;$('#nav-children-'+i).querySelectorAll('button').forEach(b=>b.disabled=!canBrowse);});
 $$('[data-feature]').forEach(b=>b.classList.toggle('selected',b.dataset.feature===state.selected+':'+state.feature&&state.support===null));
 for(let i=0;i<4;i++)$('#road-'+i).classList.toggle('discovered',i<state.done);
 report();
}
function notify(message){$('#toast').textContent=message;$('#toast').hidden=false;$('#announcement').textContent=message;clearTimeout(notify.timer);notify.timer=setTimeout(()=>$('#toast').hidden=true,2400);}
function bodyFor(i){
 if(i===0)return '<div class="form-line"><label for="material">原文</label><button data-action="sample">放入示例</button></div><textarea class="input" id="material" placeholder="粘贴一段值得留下的文字…">'+esc(state.material)+'</textarea><div class="pane-action"><button class="primary" data-action="capture" '+(!state.material.trim()?'disabled':'')+'>保存原文 '+icon('arrow')+'</button></div><p class="micro-note">只保存本页示例，不连接正式知识库。</p>';
 if(i===1)return '<div class="source-sample"><strong>主动回忆，从合上书开始</strong><p>刚才的原文仍被保留。下面是预设整理示例。</p></div><div class="sample-row"><small>方法</small>合上资料，主动回想</div><div class="sample-row"><small>边界</small>眼熟不等于独立提取</div><div class="form-line"><label for="depth">这次想学到什么程度</label></div><select class="input" id="depth">'+['了解用途','会查资料','解释原理','迁移应用'].map(v=>'<option '+(v===state.depth?'selected':'')+'>'+v+'</option>').join('')+'</select><div class="pane-action"><button class="primary" data-action="organize">将示例加入学习 '+icon('arrow')+'</button></div><p class="micro-note">这里演示学习分流。参考资料不必进入学习队列。</p>';
 if(i===2)return '<p class="question">怎样判断自己只是眼熟，<br>还是真的能够想起来？</p><div class="form-line"><label for="answer">你的解释</label><button data-action="sample-answer">填入示例</button></div><textarea class="input" id="answer" placeholder="用自己的话说一遍…">'+esc(state.answer)+'</textarea><div class="pane-action"><button class="primary" data-action="practice" '+(!state.answer.trim()?'disabled':'')+'>保存这次练习 '+icon('arrow')+'</button></div><p class="micro-note">保存回答，不进行 AI 批改，也不判定掌握。</p>';
 if(i===3)return '<div class="form-line"><label for="understanding">我的理解</label></div><textarea class="input" id="understanding" placeholder="把刚才的解释，整理成自己认可的表达…">'+esc(state.understanding)+'</textarea><label class="check-row"><input id="confirmed" type="checkbox" '+(state.confirmed?'checked':'')+'>这是我核对并认可的表述</label><div class="pane-action"><button class="primary" data-action="confirm" '+(!state.understanding.trim()||!state.confirmed?'disabled':'')+'>确认这份理解 '+icon('arrow')+'</button></div><p class="micro-note">只有你的明确确认，才会留下个人理解。</p>';
 return '<div class="form-line"><label for="output">一张带来源的知识卡片</label><button data-action="quote">引用我的理解</button></div><textarea class="input" id="output" placeholder="把自己的理解，用到下一次阅读里…">'+esc(state.output)+'</textarea><div class="pane-action"><button class="primary" data-action="output" '+(!state.output.trim()?'disabled':'')+'>存为示例草稿 '+icon('check')+'</button></div><p class="micro-note">引用可追溯。草稿不会自动写回个人知识。</p>';
}
function catalog(groups){return groups.map(([name,copy],j)=>'<section class="catalog-group '+(state.feature===j?'focused':'')+'"><h3>'+esc(name)+'</h3><p>'+esc(copy)+'</p></section>').join('');}
function renderPane(){
 const pane=$('#detail');
 if(state.support!==null){const [name,groups]=support[state.support];pane.innerHTML='<div class="detail-meta"><span>'+icon('settings')+'共同支撑</span><button class="text-button" data-action="return">回到探索</button></div><h2>'+name+'</h2><p class="detail-intro">这些能力支撑整个知识旅程，不是知识晋级的一层。</p>'+catalog(groups)+'<div class="pane-footer">此处是功能架构预览。没有读取或修改实际设置。</div>';report();return;}
 const i=state.selected,m=modules[i],view=state.tab==='catalog'||state.mode==='overview'||!unlocked(i);
 pane.innerHTML='<div class="detail-meta"><span>'+icon('leaf')+(view?'功能地图':'小叶子 · '+number(i))+'</span><button class="text-button" data-action="locate">'+(view?'回到探索':'定位')+'</button></div><h2>'+esc(view?m.name:m.title)+'</h2><p class="detail-intro">'+esc(m.intro)+'</p><div class="pane-tabs" role="tablist"><button role="tab" data-tab="experience" aria-selected="'+(!view)+'" '+(!unlocked(i)?'disabled':'')+'>体验</button><button role="tab" data-tab="catalog" aria-selected="'+view+'">完整功能</button></div>'+
(view?catalog(m.groups)+(unlocked(i)?'<div class="pane-action"><button class="secondary" data-action="experience">体验这个区域 '+icon('arrow')+'</button></div>':'<div class="pane-footer">完成下面的探索后，这一层会自然解锁。</div>'):bodyFor(i))+
(state.counts[i]>0&&!view?'<div class="counter-row"><span>本页已保存 <b>'+state.counts[i]+'</b> 次</span><span>可继续使用</span></div>':'')+
(state.done===5?'<div class="step-success">地图已经展开。所有区域都留在原处，可以随时回来。</div>':'');
 report();
}
function select(i,feature=null){if(state.mode!=='overview'&&!unlocked(i))return;guideSerial++;motion.hide();state.selected=i;state.support=null;state.feature=feature;state.tab=feature===null?'experience':'catalog';expanded=i;refreshMap();renderPane();if(feature===null&&state.mode==='explore')locate();}
async function reveal(i){
 if(reduced())return;
 const orb=$('[data-layer="'+i+'"] .layer-orb'),frames=Array.from({length:45},(_,n)=>{const t=n/44,p=n===44?1:calcDampedHarmonicOscillator(SPRING_GENTLE.stiffness,SPRING_GENTLE.damping,1,t*.75);return {offset:t,transform:'scale('+(1-.24*(1-p))+')'};});
 await orb.animate(frames,{duration:750,easing:'linear'}).finished.catch(()=>{});
}
async function complete(i){
 state.counts[i]++;
 if(state.done===i){state.done++;notify(modules[i].name+'已探索'+(state.done<5?' · '+modules[state.done].name+'已解锁':''));if(state.done<5){select(state.done);await reveal(state.done);}else{refreshMap();renderPane();motion.hide();}}
 else{notify('已保存在本页体验中。');renderPane();}
 report();
}
function target(){const i=state.selected;return i===0?$(state.material.trim()?'[data-action="capture"]':'[data-action="sample"]'):i===1?$('[data-action="organize"]'):i===2?$(state.answer.trim()?'[data-action="practice"]':'[data-action="sample-answer"]'):i===3?$(state.confirmed?'[data-action="confirm"]':'#confirmed'):$(state.output.trim()?'[data-action="output"]':'[data-action="quote"]');}
async function locate(frame=false){if(state.mode!=='explore'||state.support!==null||state.tab!=='experience')return;const token=++guideSerial,el=target();if(!el||el.disabled)return;await motion.retract();if(token!==guideSerial)return;await motion.scroll(el);if(token!==guideSerial)return;await motion.move(el);if(token!==guideSerial)return;if(frame)await motion.frame(el);if(token===guideSerial)motion.pulse();}
function setMode(mode){state.mode=mode;state.support=null;state.feature=null;state.tab=mode==='overview'?'catalog':'experience';if(mode==='explore')state.selected=Math.min(state.done,4);expanded=state.selected;guideSerial++;motion.hide();refreshMap();renderPane();if(mode==='explore')locate();}
function supportView(i){guideSerial++;motion.hide();state.support=i;state.feature=null;refreshMap();renderPane();}
document.addEventListener('click',event=>{
 const feature=event.target.closest('[data-feature]');if(feature&&!feature.disabled){const [i,j]=feature.dataset.feature.split(':').map(Number);select(i,j);return;}
 const node=event.target.closest('[data-select]');if(node&&!node.disabled){select(Number(node.dataset.select));return;}
 const nav=event.target.closest('[data-nav]');if(nav&&!nav.disabled){const i=Number(nav.dataset.nav);if(expanded===i){expanded=-1;refreshMap();}else select(i);return;}
 const sup=event.target.closest('[data-support]');if(sup){supportView(Number(sup.dataset.support));return;}
 const mode=event.target.closest('[data-mode]');if(mode){setMode(mode.dataset.mode);return;}
 const tab=event.target.closest('[data-tab]');if(tab&&!tab.disabled){if(tab.dataset.tab==='experience'){state.mode='explore';refreshMap();}state.tab=tab.dataset.tab;state.feature=null;renderPane();locate();return;}
 const action=event.target.closest('[data-action]');if(!action||action.disabled)return;
 const a=action.dataset.action,i=state.selected;
 if(a==='return'){setMode('explore');return;}
 if(a==='experience'){state.mode='explore';state.tab='experience';state.feature=null;refreshMap();renderPane();locate();return;}
 if(a==='locate'){if(state.tab==='catalog'||state.mode==='overview')setMode('explore');else locate(true);return;}
 if(state.support!==null||state.mode!=='explore'||!unlocked(i))return;
 if(a==='sample'){state.material=sample;renderPane();locate();}
 if(a==='capture'&&i===0&&state.material.trim()){state.source=state.material;state.material='';complete(0);}
 if(a==='organize'&&i===1){complete(1);}
 if(a==='sample-answer'){state.answer=example;renderPane();locate();}
 if(a==='practice'&&i===2&&state.answer.trim()){if(!state.understanding)state.understanding=state.answer;complete(2);}
 if(a==='confirm'&&i===3&&state.understanding.trim()&&state.confirmed){complete(3);}
 if(a==='quote'){state.output='下一次阅读，我会这样做\n\n'+state.understanding+'\n\n来源：主动回忆，从合上书开始';renderPane();locate();}
 if(a==='output'&&i===4&&state.output.trim()){complete(4);}
});
$('#detail').addEventListener('input',event=>{
 const id=event.target.id;if(['material','answer','understanding','output'].includes(id)){state[id]=event.target.value;if(id==='understanding'){state.confirmed=false;$('#confirmed').checked=false;}}
 const selector={material:'capture',answer:'practice',understanding:'confirm',output:'output'}[id];if(selector){const b=$('[data-action="'+selector+'"]');b.disabled=!state[id].trim()||(id==='understanding'&&!state.confirmed);}report();
});
$('#detail').addEventListener('change',event=>{if(event.target.id==='depth')state.depth=event.target.value;if(event.target.id==='confirmed'){state.confirmed=event.target.checked;$('[data-action="confirm"]').disabled=!state.confirmed||!state.understanding.trim();locate();}report();});
$('#restart').onclick=()=>{guideSerial++;motion.hide();document.getAnimations().forEach(a=>a.cancel());state=fresh();expanded=0;$('#toast').hidden=true;refreshMap();renderPane();locate();};
$('#map-home').onclick=()=>setMode('explore');
$('#theme').onclick=()=>{const dark=document.documentElement.classList.toggle('dark');$('#theme').innerHTML=icon(dark?'sun':'moon');};
$('#state-toggle').onclick=()=>{$('#state').hidden=!$('#state').hidden;$('#state-toggle').setAttribute('aria-expanded',String(!$('#state').hidden));report();};
document.addEventListener('keydown',event=>{if(event.key==='Escape'){$('#state').hidden=true;$('#state-toggle').setAttribute('aria-expanded','false');motion.retract();}});
window.addEventListener('scroll',()=>motion.track(),{passive:true});window.addEventListener('resize',()=>motion.track());
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',()=>{if(reduced())document.getAnimations().forEach(a=>a.cancel());motion.cancel();locate();});
refreshMap();renderPane();fit();locate();
