import {freshClock,readClock,transition,elapsed,clampPosition,dailyFocus} from './focus-model.mjs';
import {escape as e} from './markdown.mjs';
import {button as btn,routeButton as link,heading,field,modal,confirm,notify} from './ui.mjs';
import {paginate} from './parity.mjs';

const display=ms=>`${String(Math.floor(Math.max(0,ms)/60000)).padStart(2,'0')}:${String(Math.floor(Math.max(0,ms)/1000)%60).padStart(2,'0')}`;
export function createFocus({state,go}) {
  let key='',clock=freshClock(),node=null,shape='',expanded=false,dragged=false,pointerDragging=false,previousRect=null,errorShown=false,queue=Promise.resolve(),closed=false,recordsRender=null;
  const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  function scope(){
    const path=state.boot?.settings?.vaultDir||'default';
    const next=`zhixu-focus-v1-${encodeURIComponent(path)}`;
    if(key!==next){key=next;shape='';expanded=false;clock=read();}
  }
  function read(recordKey=key){const raw=localStorage.getItem(recordKey);if(!raw)return freshClock();try{return readClock(JSON.parse(raw));}catch{throw Error('计时记录无法读取。请保留浏览器数据，勿用新记录覆盖。');}}
  async function change(action) {
    try{scope();}catch(error){if(!errorShown){notify(`计时未读取：${error.message}`,true);errorShown=true;}throw error;}const taskKey=key;
    const work=async()=>{
      if(!navigator.locks?.request)throw Error('此浏览器不支持跨标签计时锁，请使用支持 Web Locks 的浏览器。');
      await navigator.locks.request(taskKey,async()=>{
        const before=read(taskKey),after=transition(before,action);
        let announce=false;
        if(key===taskKey&&after.active?.pendingNotice&&!document.hidden){announce=true;after.active.pendingNotice=false;}
        if(JSON.stringify(before)!==JSON.stringify(after))localStorage.setItem(taskKey,JSON.stringify(after));
        if(key===taskKey)clock=after;
        if(announce){expanded=true;notify(clock.active.kind==='focus'?'这一轮已到时间，休息一下吧。':'休息结束，可以按自己的节奏继续。');}
      });
      if(key===taskKey)render();
    };
    queue=queue.catch(()=>{}).then(work);
    try{await queue;}catch(error){if(!errorShown||action.type!=='tick'){notify(`计时未保存：${error.message}`,true);errorShown=true;}throw error;}
  }
  function panel() {
    const a=clock.active;
    return `<div class="focus-clock-heading"><span>${a.kind==='focus'?'留一点时间给此刻':'让思绪休息一下'}</span><button type="button" class="text-button focus-drag" aria-label="拖动计时器，或用方向键移动" title="拖动或用方向键移动">⠿</button></div><div class="focus-face"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="focus-track" cx="50" cy="50" r="44"/><circle class="focus-progress" cx="50" cy="50" r="44"/></svg><span class="focus-tomato" aria-hidden="true">🍅</span><strong data-clock-time></strong></div><p data-clock-status class="form-note" role="status"></p><div class="actions focus-controls">${a.status==='finished'?btn(a.kind==='focus'?'休息 5 分钟':'再专注 25 分钟',a.kind==='focus'?'focus-break':'focus-start','primary')+btn('收好计时器','focus-dismiss','text-button'):btn(a.status==='paused'?'继续':'暂停',a.status==='paused'?'focus-resume':'focus-pause','secondary')+btn('结束本轮','focus-end','text-button')}</div>${link('学习时长记录 ↗','focus','text-button')}`;
  }
  function render(animate=true) {
    if(state.route==='focus')recordsRender?.();
    if(pointerDragging)return;
    const slot=document.querySelector('#focus-home'),budget=document.querySelector('#budget-summary'),a=clock.active;
    if(budget)budget.hidden=Boolean(a);
    if(!a){node?.remove();node=null;shape='';if(slot)slot.hidden=true;return;}
    const home=state.route==='today'&&slot,mini=!home&&!expanded&&a.status!=='finished',nextShape=`${mini}:${a.status}:${a.kind}`;
    if(!node){node=document.createElement('section');node.className='focus-clock';node.setAttribute('aria-label','网页番茄钟');}
    const from=previousRect||node.getBoundingClientRect();previousRect=null;
    if(home){slot.hidden=false;if(node.parentElement!==slot)slot.append(node);node.classList.remove('focus-floating');node.style.removeProperty('left');node.style.removeProperty('top');}
    else {if(node.parentElement!==document.body)document.body.append(node);node.classList.add('focus-floating');}
    node.classList.toggle('focus-mini',mini);
    if(shape!==nextShape){shape=nextShape;node.innerHTML=mini?`<button type="button" class="focus-square focus-drag" aria-label="番茄钟：点击展开，拖动或用方向键移动"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="focus-track" cx="50" cy="50" r="44"/><circle class="focus-progress" cx="50" cy="50" r="44"/></svg><span aria-hidden="true">🍅</span></button>`:panel();bindDrag();}
    const spent=elapsed(a,Date.now()),remaining=Math.max(0,a.durationMs-spent);
    node.querySelectorAll('.focus-progress').forEach(c=>{c.style.strokeDasharray='276.46';c.style.strokeDashoffset=String(276.46*(1-spent/a.durationMs));});
    const time=node.querySelector('[data-clock-time]');if(time)time.textContent=display(remaining);
    const status=node.querySelector('[data-clock-status]');if(status)status.textContent=a.status==='finished'?(a.reason==='elapsed'?'本轮已到时间。':'本轮已结束，已记录计时时长。'):a.status==='paused'?'已暂停，暂停时间不计入。':a.kind==='focus'?'专注计时中':'休息中，不计入学习时长';
    const square=node.querySelector('.focus-square');if(square)square.setAttribute('aria-label',`番茄钟 ${a.status==='paused'?'已暂停':''}，剩余 ${display(remaining)}。点击展开或拖动。`);
    if(!home){
      const sidebar=document.querySelector('#sidebar')?.getBoundingClientRect(),dockX=innerWidth>760&&sidebar?.right>0?sidebar.right-78:innerWidth-78;
      const rect=node.getBoundingClientRect(),p=clampPosition(clock.position||{x:dockX,y:innerHeight-230},rect.width,rect.height,innerWidth,innerHeight);
      node.style.left=`${p.x}px`;node.style.top=`${p.y}px`;
      if(animate&&from.width>0&&from.height>0&&(Math.abs(from.x-p.x)+Math.abs(from.y-p.y)>20||Math.abs(from.width-rect.width)>10)&&!reduced()&&!dragged){
        node.animate([{transform:`translate(${from.x-p.x}px,${from.y-p.y}px) scale(${Math.min(2,from.width/rect.width)})`,opacity:.65},{transform:'translate(0,0) scale(1)',opacity:1}],{duration:420,easing:'cubic-bezier(.2,.75,.2,1)'});
      }
    }
  }
  function bindDrag() {
    const handle=node.querySelector('.focus-drag');if(!handle)return;
    let start=null,position=null;
    handle.onpointerdown=ev=>{if(!node.classList.contains('focus-floating')||ev.button!==0)return;const r=node.getBoundingClientRect();start={x:ev.clientX,y:ev.clientY,px:r.x,py:r.y};dragged=false;pointerDragging=true;handle.setPointerCapture(ev.pointerId);};
    handle.onpointermove=ev=>{if(!start)return;const dx=ev.clientX-start.x,dy=ev.clientY-start.y;if(Math.abs(dx)+Math.abs(dy)>4)dragged=true;if(!dragged)return;position=clampPosition({x:start.px+dx,y:start.py+dy},node.offsetWidth,node.offsetHeight,innerWidth,innerHeight);node.style.left=`${position.x}px`;node.style.top=`${position.y}px`;};
    handle.onpointerup=ev=>{if(!start)return;start=null;pointerDragging=false;if(handle.hasPointerCapture(ev.pointerId))handle.releasePointerCapture(ev.pointerId);if(dragged&&position){clock.position=position;change({type:'move',...position}).catch(()=>{});}};
    handle.onpointercancel=()=>{start=null;dragged=false;pointerDragging=false;render();};
    handle.onclick=()=>{if(dragged){dragged=false;return;}if(node.classList.contains('focus-floating')){expanded=!expanded;shape='';render();}};
    handle.onkeydown=ev=>{const delta={ArrowLeft:[-16,0],ArrowRight:[16,0],ArrowUp:[0,-16],ArrowDown:[0,16]}[ev.key];if(!delta||!node.classList.contains('focus-floating'))return;ev.preventDefault();const r=node.getBoundingClientRect(),p=clampPosition({x:r.x+delta[0],y:r.y+delta[1]},r.width,r.height,innerWidth,innerHeight);change({type:'move',...p}).catch(()=>{});};
  }
  async function start(kind='focus',minutes=25){await change({type:'start',kind,minutes,id:crypto.randomUUID()});}
  async function handle(control) {
    const a=control.dataset.action;if(!a.startsWith('focus-'))return false;
    if(a==='focus-start'){
      if(clock.active?.status==='running'||clock.active?.status==='paused'){expanded=true;render();return true;}
      const d=modal('留一段完整的时间',`<form id="focus-start-form">${field('本轮专注（分钟）','minutes',{type:'number',value:25,required:true,extra:'min="1" max="120"'})}<p class="form-note">默认 25 分钟专注、5 分钟休息。网页内轻提醒，不播放声音。</p><button class="primary" type="submit">开始番茄钟</button></form>`);
      d.querySelector('form').onsubmit=async ev=>{ev.preventDefault();const b=ev.target.querySelector('button');if(b.disabled)return;b.disabled=true;try{await start('focus',Number(ev.target.elements.minutes.value));d.close();}catch{}finally{b.disabled=false;}};
    }
    else if(a==='focus-break')await start('break',5);
    else if(a==='focus-end'){if(await confirm('结束这一轮计时？','只记录已运行的时长，暂停与休息不计入学习。','结束并记录'))await change({type:'end'});}
    else if(['focus-pause','focus-resume','focus-dismiss'].includes(a))await change({type:a.slice(6)});
    return true;
  }
  async function page(){
    scope();await change({type:'tick'});const records=[...clock.records].reverse(),zone=state.boot?.settings?.timezone||'UTC',days=dailyFocus(records,zone),minutes=records.filter(r=>r.kind==='focus').reduce((s,r)=>s+r.durationMs,0)/60000;
    return {html:heading('TIME WELL GIVEN','把投入的时间，轻轻记下来。','这里只统计主动开始的计时，不能证明实际专注程度。暂停、页面打开时间与休息不计入学习。',btn('开始番茄钟','focus-start','primary'))+`<div class="focus-record-summary"><strong><span data-focus-total>${minutes.toFixed(1)}</span> <small>分钟学习计时</small></strong><p class="form-note">当前浏览器 · 当前知识空间 · 按结束日归属（${e(zone)}）。记录不在知识库备份中，请单独导出。</p>${btn('导出计时记录','focus-export','text-button')}</div><div class="focus-record-layout"><section><h2>每一次投入</h2><div id="focus-records"></div></section><aside><h2>按日回看</h2><div id="focus-days"></div></aside></div>`,bind(){
      let rendered='';
      recordsRender=()=>{
        const host=document.querySelector('#focus-records');if(!host)return;
        const current=JSON.stringify(clock.records);if(current===rendered)return;rendered=current;
        const rows=[...clock.records].reverse();
        paginate(host,rows,r=>`<article class="parity-card"><h3>${r.kind==='focus'?'专注计时':'休息（不计入学习）'} · ${(r.durationMs/60000).toFixed(1)} 分钟</h3><p>${e(new Intl.DateTimeFormat('zh-CN',{timeZone:zone,dateStyle:'medium',timeStyle:'short'}).format(new Date(r.endedAt)))} · ${r.reason==='elapsed'?'计时到期':'主动结束'}</p></article>`);
        document.querySelector('[data-focus-total]').textContent=(rows.filter(r=>r.kind==='focus').reduce((s,r)=>s+r.durationMs,0)/60000).toFixed(1);
        document.querySelector('#focus-days').innerHTML=dailyFocus(rows,zone).map(([day,ms])=>`<div class="parity-card"><strong>${e(day)}</strong><p>${(ms/60000).toFixed(1)} 分钟</p></div>`).join('')||'<p class="muted">从一段主动选择的时间开始。</p>';
      };recordsRender();
      document.querySelector('[data-action="focus-export"]').onclick=ev=>{ev.stopPropagation();const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,timezone:zone,records:clock.records},null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='知序-学习计时记录.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    }};
  }
  function capture(){previousRect=node?.getBoundingClientRect();expanded=false;}
  function mount(){change({type:'tick'}).catch(()=>{});}
  window.addEventListener('storage',ev=>{if(ev.key===key){try{clock=read();render();}catch(error){notify(error.message,true);}}});
  window.addEventListener('resize',()=>{node?.getAnimations().forEach(animation=>animation.cancel());render(false);});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)mount();});
  const timer=setInterval(()=>{if(key&&!closed)change({type:'tick'}).catch(()=>{});},1000);
  return {handle,page,mount,capture,close(){closed=true;clearInterval(timer);node?.remove();}};
}
