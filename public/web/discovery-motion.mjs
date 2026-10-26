// Independent native implementation of common feed interaction patterns.
// Research pointers and deliberate differences: README.md, A revision 2.
let wheelLastEvent = 0, wheelConsumed = false;
export function bindImmersiveDeck({ surface, deck, indicator, first, canMove, move, refresh, like, detail, reduced }) {
  let gesture = null, animation = null, disposed = false, busy = false, committing=false, offset = 0, offsetX=0;
  let wheelDistance = 0, frame = 0, pendingOffset = 0, pendingX=0, token = 0;
  const height = () => surface.clientHeight;
  const paint = (value,x=0) => { offset = value;offsetX=x; deck.style.transform = `translate3d(${x}px,${value}px,0)`; };
  const queuePaint = (value,x=0) => { pendingOffset = value;pendingX=x; if (!frame) frame = requestAnimationFrame(() => { frame=0; paint(pendingOffset,pendingX); }); };
  function flush() { if(frame){cancelAnimationFrame(frame);frame=0;paint(pendingOffset,pendingX);} }
  function announce(text, visible = true) { indicator.classList.toggle('visible',visible); indicator.querySelector('span').textContent=text; }
  function interrupt() {
    token++; animation?.cancel(); animation=null; busy=false;committing=false;
    if(frame){cancelAnimationFrame(frame);frame=0;}
    paint(0);surface.closest('.lf-screen').classList.remove('lf-peeking');announce('下拉，换一批',false);
  }
  async function settle(target, commit, duration = 260) {
    flush(); const revision=++token; busy=true;committing=Boolean(commit);
    if(!reduced()&&(Math.abs(target-offset)>.5||Math.abs(offsetX)>.5)) {
      animation=deck.animate([{transform:`translate3d(${offsetX}px,${offset}px,0)`},{transform:`translate3d(0,${target}px,0)`}],{duration,easing:'cubic-bezier(.16,1,.3,1)',fill:'forwards'});
      try {await animation.finished;} catch {return;}
    }
    if(disposed||revision!==token)return;
    paint(target);animation?.cancel();animation=null;busy=false;committing=false;
    surface.closest('.lf-screen').classList.remove('lf-peeking');
    if(commit)commit();else{paint(0);announce('下拉，换一批',false);}
  }
  function step(direction, animate=true) {
    if(disposed||committing)return;if(busy)interrupt();
    if(!canMove(direction)){settle(0);return;}
    if(!animate){move(direction);return;}
    settle(-direction*height(),()=>move(direction));
  }
  function doRefresh(){
    if(disposed||committing)return;if(busy)interrupt();
    announce('正在换一批');
    settle(0,refresh,220);
  }
  function down(event){
    if(event.button!==0||event.target.closest('button,a,input,textarea')||committing)return;
    if(busy)interrupt();
    event.preventDefault(); // This surface is a draggable graphic; source text remains selectable in its dialog.
    if(gesture){gesture=null;interrupt();return;}
    const time=performance.now();
    const scroller=event.target.closest('[data-feed-scroll]');
    gesture={id:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,lastTime:time,velocity:0,vx:0,dx:0,dy:0,axis:null,scroller,scrollTop:scroller?.scrollTop||0};
    surface.setPointerCapture(event.pointerId);
  }
  function drag(event){
    if(!gesture||gesture.id!==event.pointerId)return;
    const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y,time=performance.now();
    if(!gesture.axis){
      if(Math.max(Math.abs(dx),Math.abs(dy))<10)return;
      if(Math.abs(dx)>Math.abs(dy)*1.25)gesture.axis='horizontal';
      else if(Math.abs(dy)>Math.abs(dx)*1.25){const s=gesture.scroller;gesture.axis=s&&s.scrollHeight>s.clientHeight+1&&(dy<0?s.scrollTop+s.clientHeight<s.scrollHeight-1:s.scrollTop>0)?'scroll':'vertical';}
      else return;
    }
    const dt=time-gesture.lastTime;
    if(dt>0){gesture.velocity=(event.clientY-gesture.lastY)/dt;gesture.vx=(event.clientX-gesture.lastX)/dt;gesture.lastTime=time;gesture.lastY=event.clientY;gesture.lastX=event.clientX;}
    gesture.dx=dx;
    if(gesture.axis==='scroll'){gesture.scroller.scrollTop=gesture.scrollTop-dy;return;}
    if(gesture.axis==='horizontal'){
      surface.closest('.lf-screen').classList.toggle('lf-peeking',dx<0);
      queuePaint(0,dx<0?Math.max(-surface.clientWidth*.65,dx):Math.min(28,dx*.12));return;
    }
    gesture.dy=dy;
    if(first()&&dy>0){
      queuePaint(126*(1-Math.exp(-dy/190)));
      announce(dy>=112?'松开，换一批':'下拉，换一批');
      indicator.querySelector('svg').style.transform=`rotate(${Math.min(dy,180)}deg)`;
    }else if(!canMove(dy<0?1:-1))queuePaint(dy*.18);
    else queuePaint(Math.max(-height(),Math.min(height(),dy)));
  }
  function up(event){
    if(!gesture||gesture.id!==event.pointerId)return;
    const g=gesture;gesture=null;flush();
    if(surface.hasPointerCapture(event.pointerId))surface.releasePointerCapture(event.pointerId);
    if(event.type==='pointercancel'){settle(0);return;}
    if(g.axis==='horizontal'){
      const flick=performance.now()-g.lastTime<100&&g.vx<-.65&&g.dx<-30;
      if(detail&&(g.dx<-Math.min(110,surface.clientWidth*.25)||flick)){detail();return;}
      settle(0);return;
    }
    if(g.axis!=='vertical'){settle(0);return;}
    if(first()&&g.dy>0){if(g.dy>=112)doRefresh();else settle(0);return;}
    const recent=performance.now()-g.lastTime<100;
    const flick=recent&&Math.abs(g.velocity)>.65&&Math.abs(g.dy)>28&&Math.sign(g.velocity)===Math.sign(g.dy);
    const enough=Math.abs(g.dy)>=Math.min(170,height()*.22);
    if(enough||flick)step(g.dy<0?1:-1);else settle(0);
  }
  function wheel(event){
    if(event.ctrlKey||Math.abs(event.deltaX)>Math.abs(event.deltaY))return;
    const scroller=event.target.closest('[data-feed-scroll]');
    if(scroller&&(event.deltaY>0?scroller.scrollTop+scroller.clientHeight<scroller.scrollHeight-1:scroller.scrollTop>0)){wheelLastEvent=performance.now();wheelConsumed=true;return;}
    event.preventDefault();const time=performance.now(),quiet=time-wheelLastEvent>180;wheelLastEvent=time;
    if(quiet){wheelDistance=0;wheelConsumed=false;}
    if(busy||wheelConsumed)return;
    const amount=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?height():1);
    wheelDistance+=amount;
    if(Math.abs(wheelDistance)>=44){wheelConsumed=true;if(first()&&wheelDistance<0)doRefresh();else step(Math.sign(wheelDistance));}
  }
  function double(event){if(!event.target.closest('button,a,input,textarea'))like();}
  surface.addEventListener('pointerdown',down);surface.addEventListener('pointermove',drag);
  surface.addEventListener('pointerup',up);surface.addEventListener('pointercancel',up);
  surface.addEventListener('wheel',wheel,{passive:false});surface.addEventListener('dblclick',double);
  const resize=new ResizeObserver(()=>{if(gesture||busy){gesture=null;interrupt();}});resize.observe(surface);
  return { step, refresh:doRefresh, pause(){gesture=null;interrupt();}, dispose(){disposed=true;gesture=null;interrupt();resize.disconnect();surface.removeEventListener('pointerdown',down);surface.removeEventListener('pointermove',drag);surface.removeEventListener('pointerup',up);surface.removeEventListener('pointercancel',up);surface.removeEventListener('wheel',wheel);surface.removeEventListener('dblclick',double);} };
}

export function bindSheetHandle(dialog,close,reduced){
  const handle=dialog.querySelector('.sheet-grip');let start=null;
  handle.addEventListener('pointerdown',event=>{if(event.button!==0)return;start={id:event.pointerId,y:event.clientY};handle.setPointerCapture(event.pointerId);});
  handle.addEventListener('pointermove',event=>{if(start?.id===event.pointerId)dialog.style.transform=`translateY(${Math.max(0,event.clientY-start.y)*.7}px)`;});
  const end=event=>{if(start?.id!==event.pointerId)return;const dy=event.clientY-start.y;start=null;const from=dialog.style.transform;dialog.style.transform='';if(event.type!=='pointercancel'&&dy>100)close();else if(!reduced())dialog.animate([{transform:from},{transform:'translateY(0)'}],{duration:220,easing:'cubic-bezier(.16,1,.3,1)'});};
  handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);
}

// Original native prototype. Research/version pointers are in README.md.
export function mountMasonry(list) {
  const cards=[...list.children];let frame=0,closed=false,lastWidth=0;
  function layout(){
    frame=0;if(closed||!list.isConnected)return;
    const width=list.clientWidth,columns=width<560?2:width<850?3:4,gap=width<560?14:24;
    const cardWidth=(width-gap*(columns-1))/columns;
    cards.forEach(card=>{card.style.width=`${cardWidth}px`;});
    // Separate width writes, real text/cover measurements, then position writes.
    const sizes=cards.map(card=>card.getBoundingClientRect().height),bottom=Array(columns).fill(0);
    cards.forEach((card,i)=>{const column=bottom.indexOf(Math.min(...bottom));card.style.transform=`translate3d(${column*(cardWidth+gap)}px,${bottom[column]}px,0)`;bottom[column]+=sizes[i]+gap;});
    list.style.height=`${Math.max(0,...bottom)-gap}px`;list.dataset.columns=String(columns);list.dataset.ready='true';
  }
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(layout);};
  const resize=new ResizeObserver(entries=>{if(entries.some(entry=>entry.target!==list)){schedule();return;}const width=list.clientWidth;if(Math.abs(width-lastWidth)>.5){lastWidth=width;schedule();}});
  resize.observe(list);cards.forEach(card=>resize.observe(card));layout();
  return {layout,dispose(){closed=true;resize.disconnect();cancelAnimationFrame(frame);}};
}

export function createSharedCoverTransition(reduced){
  let cleanup=null,animation=null,revision=0;
  const cancel=()=>{revision++;animation?.cancel();animation=null;cleanup?.();cleanup=null;document.documentElement.classList.remove('lf-transitioning');};
  return {
    get running(){return Boolean(cleanup);},cancel,
    async run({from,change,target,after,animate=true}){
      cancel();const current=revision;
      const before=from?.getBoundingClientRect();
      const ghost=from?.cloneNode(true);
      change();const to=target(),end=to?.getBoundingClientRect();
      if(!ghost||!before?.width||!end?.width||reduced()||!animate){after?.();return;}
      ghost.classList.add('lf-flying-cover');ghost.removeAttribute('id');ghost.setAttribute('aria-hidden','true');ghost.inert=true;
      Object.assign(ghost.style,{position:'fixed',left:`${before.left}px`,top:`${before.top}px`,width:`${before.width}px`,height:`${before.height}px`,margin:'0',zIndex:'100',pointerEvents:'none',transformOrigin:'0 0'});
      const visibility=to.style.visibility;to.style.visibility='hidden';document.body.append(ghost);
      cleanup=()=>{ghost.remove();to.style.visibility=visibility;};document.documentElement.classList.add('lf-transitioning');
      const transform=`translate(${end.left-before.left}px,${end.top-before.top}px) scale(${end.width/before.width},${end.height/before.height})`;
      animation=ghost.animate([{transform:'translate(0,0) scale(1)'},{transform}],{duration:280,easing:'cubic-bezier(.16,1,.3,1)',fill:'forwards'});
      try{await animation.finished;}catch{return;}
      if(current!==revision)return;
      animation.cancel();animation=null;cleanup();cleanup=null;document.documentElement.classList.remove('lf-transitioning');after?.();
    }
  };
}

export function bindPullReturn(handle,panel,close,reduced){
  let start=null,frame=0,pending=0,animation=null;
  const paint=()=>{frame=0;panel.style.transform=`translateY(${pending}px) scale(${1-Math.min(pending/1800,.07)})`;};
  function down(e){if(e.button!==0)return;animation?.cancel();start={id:e.pointerId,y:e.clientY};pending=0;handle.setPointerCapture(e.pointerId);}
  function move(e){if(start?.id!==e.pointerId)return;pending=Math.max(0,e.clientY-start.y)*.65;if(!frame)frame=requestAnimationFrame(paint);}
  function end(e){if(start?.id!==e.pointerId)return;const delta=e.clientY-start.y;start=null;cancelAnimationFrame(frame);paint();if(e.type!=='pointercancel'&&delta>120){close();return;}const from=panel.style.transform;panel.style.transform='';if(!reduced())animation=panel.animate([{transform:from},{transform:'translateY(0) scale(1)'}],{duration:220,easing:'cubic-bezier(.16,1,.3,1)'});}
  handle.addEventListener('pointerdown',down);handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);
  return ()=>{cancelAnimationFrame(frame);animation?.cancel();handle.removeEventListener('pointerdown',down);handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end);};
}

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
     start.locked=true;suppressClick=true;page.setPointerCapture(e.pointerId);page.classList.add('lf-dragging');
   }
   e.preventDefault();start.dx=dx;page.style.transform=`translateX(${Math.min(page.clientWidth*.65,Math.max(0,dx)*.8)}px)`;
 };
 const up=e=>{
   if(start?.id!==e.pointerId)return;
   const g=start;start=null;const from=page.style.transform;page.style.transform='';page.classList.remove('lf-dragging');
   if(page.hasPointerCapture(e.pointerId))page.releasePointerCapture(e.pointerId);
   if(e.type!=='pointercancel'&&g.locked&&g.dx>Math.min(90,page.clientWidth*.24)){close(true);return;}
   if(g.locked&&!reduced())animation=page.animate([{transform:from},{transform:'translateX(0)'}],{duration:220,easing:'cubic-bezier(.16,1,.3,1)'});
 };
 const click=e=>{if(suppressClick&&e.detail){suppressClick=false;e.preventDefault();e.stopImmediatePropagation();}};
 const drag=e=>e.preventDefault();
 page.addEventListener('pointerdown',down);page.addEventListener('pointermove',move);
 page.addEventListener('pointerup',up);page.addEventListener('pointercancel',up);
 page.addEventListener('click',click,true);page.addEventListener('dragstart',drag);
 return ()=>{animation?.cancel();page.classList.remove('lf-dragging');page.removeEventListener('pointerdown',down);page.removeEventListener('pointermove',move);page.removeEventListener('pointerup',up);page.removeEventListener('pointercancel',up);page.removeEventListener('click',click,true);page.removeEventListener('dragstart',drag);};
}
