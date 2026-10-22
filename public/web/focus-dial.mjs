export const dialMinutes=(value)=>Math.max(1,Math.min(120,Number.isFinite(value)?value:25));
export function dialDelta(previous,current){
  return ((current-previous+540)%360)-180;
}
export function dialMarkup(){
  const ticks=Array.from({length:30},(_,i)=>`<line x1="140" y1="${i%5?42:37}" x2="140" y2="48" transform="rotate(${i*12} 140 140)" class="${i%5?'':'major'}"/>`).join('');
  const labels=Array.from({length:6},(_,i)=>{const a=i*Math.PI/3;return `<text x="${140+76*Math.sin(a)}" y="${140-76*Math.cos(a)}">${i*5}</text>`;}).join('');
  return `<div class="focus-dial" role="slider" tabindex="0" aria-label="拖动设置专注分钟，每圈三十分钟" aria-valuemin="1" aria-valuemax="120" aria-valuenow="25">
  <svg viewBox="0 0 280 280" aria-hidden="true"><g class="dial-rings">${[112,119,126,133].map((r,i)=>`<circle class="dial-ring-track" cx="140" cy="140" r="${r}" style="--lap-color:var(--dial-lap-${i})"/><circle data-dial-ring="${i}" cx="140" cy="140" r="${r}" pathLength="30" transform="rotate(-90 140 140)" style="--lap-color:var(--dial-lap-${i})"/>`).join('')}</g><g class="dial-ticks">${ticks}</g><g class="dial-labels">${labels}</g><g class="dial-hand"><line x1="140" y1="140" x2="140" y2="53"/><circle cx="140" cy="49" r="7"/><circle cx="140" cy="140" r="5"/></g></svg></div>
  <div class="dial-value"><label for="focus-minutes">专注时间</label><div><input id="focus-minutes" name="minutes" type="number" min="1" max="120" step="1" required value="25" aria-label="专注分钟"><span>分钟</span></div></div><p class="dial-caption" data-dial-caption>第 1 圈 · 每圈 30 分钟</p><p class="form-note">顺时针增加，逆时针减少 · 1–120 分钟<br>也可使用方向键，每次调整 1 分钟</p>`;
}
export function bindDial(form){
  const dial=form.querySelector('.focus-dial'),input=form.elements.minutes,hand=dial.querySelector('.dial-hand');
  let value=25,previousAngle=null;
  const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  function paint(){
    const minute=Math.round(value),lap=Math.min(3,Math.max(0,Math.ceil(value/30)-1));
    input.value=String(minute);dial.setAttribute('aria-valuenow',String(minute));dial.setAttribute('aria-valuetext',`${minute} 分钟`);
    hand.style.transform=`rotate(${value*12}deg)`;hand.style.color=`var(--dial-lap-${lap})`;
    dial.querySelectorAll('[data-dial-ring]').forEach((ring,i)=>{const amount=Math.max(0,Math.min(30,value-i*30));ring.style.strokeDasharray=`${amount} 30`;ring.style.opacity=amount>0?'1':'0';});
    form.querySelector('[data-dial-caption]').textContent=`第 ${lap+1} 圈 · 每圈 30 分钟`;
  }
  function snap(){
    const from=value*12;value=Math.round(value);paint();const to=value*12;
    hand.getAnimations().forEach(a=>a.cancel());
    if(!reduced()&&Math.abs(to-from)>.05){
      const a=hand.animate([{transform:`rotate(${from}deg)`},{transform:`rotate(${to+(to-from)*.22}deg)`,offset:.58},{transform:`rotate(${to-(to-from)*.06}deg)`,offset:.82},{transform:`rotate(${to}deg)`}],{duration:360,easing:'ease-out'});
      a.id='focus-dial-snap';
    }
  }
  function angle(ev){const r=dial.getBoundingClientRect();return Math.atan2(ev.clientX-r.x-r.width/2,-(ev.clientY-r.y-r.height/2))*180/Math.PI;}
  dial.onpointerdown=ev=>{
    if(ev.button!==0)return;
    const r=dial.getBoundingClientRect();if(Math.hypot(ev.clientX-r.x-r.width/2,ev.clientY-r.y-r.height/2)<r.width*.15)return;
    hand.getAnimations().forEach(a=>a.cancel());previousAngle=angle(ev);dial.setPointerCapture(ev.pointerId);dial.classList.add('is-dragging');ev.preventDefault();
  };
  dial.onpointermove=ev=>{if(previousAngle===null)return;const next=angle(ev);value=dialMinutes(value+dialDelta(previousAngle,next)/12);previousAngle=next;paint();};
  const release=ev=>{if(previousAngle===null)return;previousAngle=null;if(dial.hasPointerCapture(ev.pointerId))dial.releasePointerCapture(ev.pointerId);dial.classList.remove('is-dragging');snap();};
  dial.onpointerup=release;dial.onpointercancel=release;
  dial.onkeydown=ev=>{const delta={ArrowRight:1,ArrowUp:1,ArrowLeft:-1,ArrowDown:-1,PageUp:30,PageDown:-30}[ev.key];if(delta===undefined)return;ev.preventDefault();value=dialMinutes(Math.round(value)+delta);paint();};
  input.oninput=()=>{if(input.value!==''&&input.validity.valid){value=dialMinutes(Number(input.value));paint();}};
  input.onchange=()=>{value=dialMinutes(Number(input.value));snap();};
  paint();
}
