import {calcDampedHarmonicOscillator,SPRING_SNAPPY} from './cds/ClaudeMotionPresets.mjs';
import {sidePosition} from './onboarding-model.mjs';
import {icon} from './ui.mjs';
const box=r=>({x:r.left,y:r.top,w:r.width,h:r.height});
export function createGuideMotion({speed=()=>1,bottom=()=>innerHeight-24,onToggle=()=>{}}={}){
 const layer=document.createElement('div');layer.className='onboard-motion';layer.innerHTML=`<div class="onboard-marker" hidden><div class="onboard-skin"></div><button type="button" class="onboard-leaf" aria-label="展开或收起引导说明">${icon('leaf')}</button></div>`;document.body.append(layer);
 const marker=layer.firstElementChild,leaf=marker.querySelector('button'),skin=marker.querySelector('.onboard-skin');leaf.onclick=onToggle;
 let serial=0,animations=[],geometry=null,iconPoint={x:0,y:0},rest=null,target=null,framed=false,travelling=false,follow=null,dock=null;
 const panelAnimations=new Map();
 const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
 const duration=ms=>reduced()?0:ms/speed();
 function cancel(){serial++;animations.forEach(a=>{try{a.commitStyles();}catch{}a.cancel();});animations=[];if(!marker.hidden){geometry=box(marker.getBoundingClientRect());const r=leaf.getBoundingClientRect();iconPoint={x:r.x-geometry.x,y:r.y-geometry.y};}travelling=false;}
 const apply=(b,p)=>{Object.assign(marker.style,{left:b.x+'px',top:b.y+'px',width:b.w+'px',height:b.h+'px'});Object.assign(leaf.style,{left:p.x+'px',top:p.y+'px'});geometry=b;iconPoint=p;};
 async function morph(to,frame=false,ms=600){
  cancel();const token=serial;marker.hidden=false;travelling=true;
  const from=geometry||{x:Math.max(20,innerWidth-80),y:90,w:44,h:44},old={...iconPoint},end=frame?frameIcon(to):{x:0,y:0};
  marker.dataset.shape='morphing';apply(from,old);
  const frames=[],icons=[];
  for(let i=0;i<=40;i++){const t=i/40,p=i===40?1:(frame||framed?calcDampedHarmonicOscillator(SPRING_SNAPPY.stiffness,SPRING_SNAPPY.damping,1,t*.68):(1-Math.cos(t*Math.PI))/2);
   frames.push({offset:t,left:from.x+(to.x-from.x)*p+'px',top:from.y+(to.y-from.y)*p+'px',width:Math.max(1,from.w+(to.w-from.w)*p)+'px',height:Math.max(1,from.h+(to.h-from.h)*p)+'px'});
   icons.push({offset:t,left:old.x+(end.x-old.x)*p+'px',top:old.y+(end.y-old.y)*p+'px'});
  }
  if(duration(ms)){animations=[marker.animate(frames,{duration:duration(ms),fill:'forwards'}),leaf.animate(icons,{duration:duration(ms),fill:'forwards'})];await Promise.allSettled(animations.map(a=>a.finished));}
  if(token!==serial)return false;apply(to,end);animations.forEach(a=>a.cancel());animations=[];travelling=false;framed=frame;marker.dataset.shape=frame?'frame':'leaf';return true;
 }
 function obstacles(){return [...document.querySelectorAll('#main button,#main input,#main textarea,#main select,.onboard-card')].filter(el=>el.getClientRects().length&&!el.hidden).map(el=>box(el.getBoundingClientRect()));}
 function side(el,stable=false){
  const header=el.closest?.('dialog[open]')?.querySelector('.dialog-heading');
  if(header){if(dock?.parentElement!==header){dock?.remove();dock=document.createElement('span');dock.className='onboard-dialog-dock';dock.setAttribute('aria-hidden','true');header.insertBefore(dock,header.querySelector('[data-modal-close]'));}return box(dock.getBoundingClientRect());}
  return sidePosition(box(el.getBoundingClientRect()),{width:innerWidth,height:innerHeight,bottom:bottom()},obstacles(),stable?rest:null);
 }
 function frameIcon(frame){if(!target.closest?.('dialog[open]'))return {x:Math.max(0,frame.w-44),y:-51};const point=side(target,true);return {x:point.x-frame.x,y:point.y-frame.y};}
 function frameBox(el){const r=el.getBoundingClientRect();let top=Math.max(80,r.top-7),end=Math.min(bottom()-10,r.bottom+7);for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement)if(/auto|scroll|hidden/.test(getComputedStyle(p).overflowY)){const b=p.getBoundingClientRect();top=Math.max(top,b.top+6);end=Math.min(end,b.bottom-6);}return {x:Math.max(10,r.left-7),y:top,w:Math.min(innerWidth-20,r.width+14),h:Math.max(24,end-top)};}
 async function move(el){target=el;rest=side(el);const r=el.getBoundingClientRect();follow={x:rest.x-r.x,y:rest.y-r.y};const from=geometry||rest;return morph(rest,false,Math.min(1500,Math.max(580,Math.hypot(rest.x-from.x,rest.y-from.y)/.65)));}
 async function frame(el=target){if(!el?.isConnected)return false;target=el;if(!rest)rest=side(el);framed=true;return morph(frameBox(el),true,620);}
 async function retract(){if(!framed)return true;const r=leaf.getBoundingClientRect();rest=target?.closest?.('dialog[open]')?side(target,true):{x:Math.max(12,Math.min(innerWidth-56,r.x)),y:Math.max(76,Math.min(innerHeight-68,r.y)),w:44,h:44};if(target?.isConnected){const t=target.getBoundingClientRect();follow={x:rest.x-t.x,y:rest.y-t.y};}return morph(rest,false,500);}
 // Wave nodes have their own geometry and lifetime. A new hint never cancels older rings.
 function pulse(){if(marker.hidden||reduced())return;const r=box(marker.getBoundingClientRect());
  if(!skin.getAnimations().some(a=>a.playState==='running'))skin.animate([{transform:'scale(1)'},{transform:`scale(${framed?.985:.8})`,offset:.3},{transform:`scale(${framed?1.012:1.17})`,offset:.57},{transform:'scale(1)'}],{duration:duration(500),easing:'cubic-bezier(.2,.6,.3,1)'});
  for(let i=0;i<2;i++){const wave=document.createElement('i');wave.className='onboard-wave';Object.assign(wave.style,{left:r.x+'px',top:r.y+'px',width:r.w+'px',height:r.h+'px'});layer.append(wave);const amount=framed?22+i*10:28+i*12;const a=wave.animate([{opacity:0,transform:'scale(.98)'},{opacity:.8,offset:.12},{opacity:0,transform:`scale(${(r.w+amount*2)/r.w},${(r.h+amount*2)/r.h})`}],{duration:duration(900),delay:duration(150+i*110),easing:'cubic-bezier(.2,.6,.3,1)',fill:'both'});a.finished.catch(()=>{}).finally(()=>wave.remove());}
 }
 async function track(){if(!target?.isConnected||travelling||marker.hidden)return;if(framed){const frame=frameBox(target);apply(frame,frameIcon(frame));}else{const r=target.getBoundingClientRect();rest=target.closest?.('dialog[open]')?side(target,true):follow?{x:Math.max(12,Math.min(innerWidth-56,r.x+follow.x)),y:Math.max(76,Math.min(bottom()-44,r.y+follow.y)),w:44,h:44}:side(target,true);apply(rest,{x:0,y:0});}}
 async function scroll(el){if(!el)return;for(let p=el.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS'&&!p.querySelector('summary')?.contains(el))p.open=true;
  const token=serial;
  const scrollOne=async(node,to)=>{const from=node===window?scrollY:node.scrollTop,ms=duration(Math.min(700,Math.max(350,Math.abs(to-from)/1.2)));const put=value=>node===window?window.scrollTo({top:value,behavior:'instant'}):node.scrollTo({top:value,behavior:'instant'});if(!ms){put(to);return;}await new Promise(resolve=>{const start=performance.now();const tick=now=>{if(serial!==token){resolve();return;}const t=Math.min(1,(now-start)/ms),p=(1-Math.cos(t*Math.PI))/2;put(from+(to-from)*p);if(t<1)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);});};
  for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){const style=getComputedStyle(p);if(/auto|scroll/.test(style.overflowY)&&p.scrollHeight>p.clientHeight){const r=el.getBoundingClientRect(),b=p.getBoundingClientRect();if(r.top<b.top+50||r.bottom>b.bottom-50)await scrollOne(p,Math.max(0,Math.min(p.scrollHeight-p.clientHeight,p.scrollTop+r.top-b.top-(r.height>p.clientHeight-100?60:(p.clientHeight-r.height)/2))));}}
  const r=el.getBoundingClientRect(),ceiling=140,floor=bottom()-40,room=floor-ceiling;if(r.top<ceiling||r.bottom>floor){const desired=r.height>room?ceiling:ceiling+(room-r.height)/2;await scrollOne(window,Math.max(0,Math.min(document.documentElement.scrollHeight-innerHeight,scrollY+r.top-desired)));}
 }
 async function panel(node,opening){
  panelAnimations.get(node)?.cancel();if(reduced()){node.hidden=!opening;return;}
  node.hidden=false;const r=node.getBoundingClientRect(),p=leaf.getBoundingClientRect();
  const sx=Math.min(1,44/r.width),sy=Math.min(1,44/r.height),dx=p.x+(p.width-44)/2-r.x,dy=p.y+(p.height-44)/2-r.y;
  const collapsed=`translate(${dx}px,${dy}px) scale(${sx},${sy})`;
  const a=node.animate([{opacity:opening?0:1,transform:opening?collapsed:'none'},{opacity:opening?1:0,transform:opening?'none':collapsed}],{duration:duration(opening?440:320),easing:'cubic-bezier(.22,1,.36,1)',fill:'forwards'});panelAnimations.set(node,a);
  try{await a.finished;}catch{return;}if(panelAnimations.get(node)!==a)return;
  // Hide while the collapsed frame still owns the visual state; then release it.
  if(!opening)node.hidden=true;a.cancel();panelAnimations.delete(node);
 }
 function hide(){cancel();panelAnimations.forEach((a,n)=>{n.hidden=true;a.cancel();});panelAnimations.clear();marker.hidden=true;dock?.remove();dock=null;layer.querySelectorAll('.onboard-wave').forEach(n=>n.remove());}
 return {move,frame,retract,pulse,track,scroll,panel,hide,cancel,layer,leaf,get target(){return target;},get framed(){return framed;},get panelMoving(){return panelAnimations.size>0;},get moving(){return travelling||panelAnimations.size>0;},get rect(){return geometry;}};
}
