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
  const cancel=()=>{revision++;animation?.cancel();animation=null;cleanup?.();cleanup=null;document.documentElement.classList.remove('b-transitioning');};
  return {
    get running(){return Boolean(cleanup);},cancel,
    async run({from,change,target,after,animate=true}){
      cancel();const current=revision;
      const before=from?.getBoundingClientRect();
      const ghost=from?.cloneNode(true);
      change();const to=target(),end=to?.getBoundingClientRect();
      if(!ghost||!before?.width||!end?.width||reduced()||!animate){after?.();return;}
      ghost.classList.add('b-flying-cover');ghost.removeAttribute('id');ghost.setAttribute('aria-hidden','true');ghost.inert=true;
      Object.assign(ghost.style,{position:'fixed',left:`${before.left}px`,top:`${before.top}px`,width:`${before.width}px`,height:`${before.height}px`,margin:'0',zIndex:'100',pointerEvents:'none',transformOrigin:'0 0'});
      const visibility=to.style.visibility;to.style.visibility='hidden';document.body.append(ghost);
      cleanup=()=>{ghost.remove();to.style.visibility=visibility;};document.documentElement.classList.add('b-transitioning');
      const transform=`translate(${end.left-before.left}px,${end.top-before.top}px) scale(${end.width/before.width},${end.height/before.height})`;
      animation=ghost.animate([{transform:'translate(0,0) scale(1)'},{transform}],{duration:280,easing:'cubic-bezier(.16,1,.3,1)',fill:'forwards'});
      try{await animation.finished;}catch{return;}
      if(current!==revision)return;
      animation.cancel();animation=null;cleanup();cleanup=null;document.documentElement.classList.remove('b-transitioning');after?.();
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
