// Independent native implementation of common feed interaction patterns.
// Research pointers and deliberate differences: README.md, A revision 2.
let wheelLastEvent = 0, wheelConsumed = false;
export function bindImmersiveDeck({ surface, deck, indicator, first, canMove, move, refresh, like, reduced }) {
  let gesture = null, animation = null, disposed = false, busy = false, offset = 0;
  let wheelDistance = 0, frame = 0, pendingOffset = 0, token = 0;
  const height = () => surface.clientHeight;
  const paint = value => { offset = value; deck.style.transform = `translate3d(0,${value}px,0)`; };
  const queuePaint = value => { pendingOffset = value; if (!frame) frame = requestAnimationFrame(() => { frame=0; paint(pendingOffset); }); };
  function flush() { if(frame){cancelAnimationFrame(frame);frame=0;paint(pendingOffset);} }
  function announce(text, visible = true) { indicator.classList.toggle('visible',visible); indicator.querySelector('span').textContent=text; }
  function interrupt() {
    token++; animation?.cancel(); animation=null; busy=false;
    if(frame){cancelAnimationFrame(frame);frame=0;}
    paint(0);announce('下拉，换一批',false);
  }
  async function settle(target, commit, duration = 260) {
    flush(); const revision=++token; busy=true;
    if(!reduced()&&Math.abs(target-offset)>.5) {
      animation=deck.animate([{transform:`translate3d(0,${offset}px,0)`},{transform:`translate3d(0,${target}px,0)`}],{duration,easing:'cubic-bezier(.16,1,.3,1)',fill:'forwards'});
      try {await animation.finished;} catch {return;}
    }
    if(disposed||revision!==token)return;
    paint(target);animation?.cancel();animation=null;busy=false;
    if(commit)commit();else{paint(0);announce('下拉，换一批',false);}
  }
  function step(direction, animate=true) {
    if(disposed||busy)return;
    if(!canMove(direction)){settle(0);return;}
    if(!animate){move(direction);return;}
    settle(-direction*height(),()=>move(direction));
  }
  function doRefresh(){
    if(disposed||busy)return;
    announce('正在换一批');
    settle(0,refresh,220);
  }
  function down(event){
    if(event.button!==0||event.target.closest('button,a,input,textarea')||busy)return;
    event.preventDefault(); // This surface is a draggable graphic; source text remains selectable in its dialog.
    if(gesture){gesture=null;interrupt();return;}
    const time=performance.now();
    gesture={id:event.pointerId,x:event.clientX,y:event.clientY,lastY:event.clientY,lastTime:time,velocity:0,dy:0,axis:null};
    surface.setPointerCapture(event.pointerId);
  }
  function drag(event){
    if(!gesture||gesture.id!==event.pointerId)return;
    const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y,time=performance.now();
    if(!gesture.axis){
      if(Math.max(Math.abs(dx),Math.abs(dy))<10)return;
      gesture.axis=Math.abs(dy)>Math.abs(dx)*1.2?'vertical':'horizontal';
    }
    if(gesture.axis==='horizontal')return;
    const dt=time-gesture.lastTime;
    if(dt>0){gesture.velocity=(event.clientY-gesture.lastY)/dt;gesture.lastTime=time;gesture.lastY=event.clientY;}
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
    if(event.type==='pointercancel'||g.axis!=='vertical'){settle(0);return;}
    if(first()&&g.dy>0){if(g.dy>=112)doRefresh();else settle(0);return;}
    const recent=performance.now()-g.lastTime<100;
    const flick=recent&&Math.abs(g.velocity)>.65&&Math.abs(g.dy)>28&&Math.sign(g.velocity)===Math.sign(g.dy);
    const enough=Math.abs(g.dy)>=Math.min(170,height()*.22);
    if(enough||flick)step(g.dy<0?1:-1);else settle(0);
  }
  function wheel(event){
    if(event.ctrlKey||Math.abs(event.deltaX)>Math.abs(event.deltaY))return;
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
