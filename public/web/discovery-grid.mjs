// Session-local pagination over the current library snapshot, with no repeat padding.
export function createGridPager(load,{pageSize=12}={}){
 let items=[],hasMore=true;
 function next(){
  if(!hasMore)return {items,added:[],hasMore};
  const used=new Set(items.map(c=>c.id));
  const candidates=load({excludeIds:[...used],limit:pageSize+1}).filter(c=>{
   if(used.has(c.id))return false;used.add(c.id);return true;
  });
  const added=candidates.slice(0,pageSize);items=[...items,...added];hasMore=candidates.length>pageSize;
  return {items,added,hasMore};
 }
 return {get items(){return items;},get hasMore(){return hasMore;},next,reset(){items=[];hasMore=true;return next();}};
}

// Keep this gate across view mounts: a refresh must not consume its own wheel momentum.
export function createOverscrollGate(){
 let last=-Infinity,consumed=false,distance=0;
 return {wheel(delta,atTop,time){
  if(time-last>180){consumed=false;distance=0;}last=time;
  if(!atTop||delta>=0){consumed=true;distance=0;return {distance:0,refresh:false};}
  if(consumed)return {distance:0,refresh:false};
  distance+=Math.min(120,Math.abs(delta));const refresh=distance>=110;
  if(refresh)consumed=true;
  return {distance,refresh};
 }};
}

export function bindGridFeed({scroll,indicator,gate,hasMore,loadMore,refresh,reduced}){
 let closed=false,frame=0,timer=0,start=null,busy=false;
 const announce=(distance,text='继续上滑，刷新知识')=>{
  indicator.classList.toggle('visible',distance>0);indicator.textContent=text;
  indicator.style.transform=reduced()?'':`translateY(${Math.min(10,distance*.06)}px)`;
 };
 async function reload(){
  if(closed||busy)return;busy=true;announce(1,'正在看看有没有新内容…');
  try{await refresh();}finally{busy=false;if(!closed)announce(0);}
 }
 function check(){frame=0;if(closed||busy||!hasMore())return;
  if(scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<220){loadMore();schedule();}
 }
 function schedule(){if(!closed&&!frame)frame=requestAnimationFrame(check);}
 function wheel(event){
  if(event.ctrlKey||Math.abs(event.deltaX)>Math.abs(event.deltaY))return;
  const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?scroll.clientHeight:1);
  const atTop=scroll.scrollTop<=1,result=gate.wheel(delta,atTop,performance.now());
  if(atTop&&event.deltaY<0){event.preventDefault();if(busy)return;announce(result.distance);clearTimeout(timer);timer=setTimeout(()=>announce(0),240);if(result.refresh)void reload();}
 }
 function touchStart(event){start=null;if(event.touches.length!==1||scroll.scrollTop>1||busy)return;start={x:event.touches[0].clientX,y:event.touches[0].clientY,distance:0};}
 function touchMove(event){
  if(!start||event.touches.length!==1)return;const touch=event.touches[0],dy=touch.clientY-start.y,dx=touch.clientX-start.x;
  if(dy<0||Math.abs(dx)>Math.abs(dy)){start=null;announce(0);return;}
  if(scroll.scrollTop>1)return;event.preventDefault();start.distance=dy;announce(dy,dy>=112?'松开，刷新知识':'下拉，看看新内容');
 }
 function touchEnd(event){const distance=start?.distance||0;start=null;if(event.type!=='touchcancel'&&distance>=112)void reload();else announce(0);}
 scroll.addEventListener('scroll',schedule,{passive:true});scroll.addEventListener('wheel',wheel,{passive:false});
 scroll.addEventListener('touchstart',touchStart,{passive:true});scroll.addEventListener('touchmove',touchMove,{passive:false});
 scroll.addEventListener('touchend',touchEnd);scroll.addEventListener('touchcancel',touchEnd);
 const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(schedule,{root:scroll,rootMargin:'220px'}):null;const end=scroll.querySelector('.lf-grid-end');if(end)observer?.observe(end);schedule();
 return ()=>{closed=true;cancelAnimationFrame(frame);clearTimeout(timer);observer?.disconnect();
  scroll.removeEventListener('scroll',schedule);scroll.removeEventListener('wheel',wheel);scroll.removeEventListener('touchstart',touchStart);scroll.removeEventListener('touchmove',touchMove);scroll.removeEventListener('touchend',touchEnd);scroll.removeEventListener('touchcancel',touchEnd);
 };
}
