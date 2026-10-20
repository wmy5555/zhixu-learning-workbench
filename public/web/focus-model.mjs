// Wall-clock deadlines survive throttled tabs. Only explicitly running focus counts.
export const freshClock = () => ({version:1,active:null,records:[],position:null});
export function readClock(value) {
  if(!value||value.version!==1||!Array.isArray(value.records))return freshClock();
  const records=value.records.filter(r=>r&&typeof r.id==='string'&&['focus','break'].includes(r.kind)&&Number.isFinite(r.durationMs)&&r.durationMs>=0);
  const a=value.active;
  const active=a&&typeof a.id==='string'&&['focus','break'].includes(a.kind)&&['running','paused','finished'].includes(a.status)&&Number.isFinite(a.durationMs)&&a.durationMs>0&&a.durationMs<=120*60000&&Number.isFinite(a.elapsedMs)&&a.elapsedMs>=0&&a.elapsedMs<=a.durationMs&&Number.isFinite(a.createdAt)&&(a.status!=='running'||Number.isFinite(a.startedAt))?{...a}:null;
  return {version:1,active,records,position:value.position&&Number.isFinite(value.position.x)&&Number.isFinite(value.position.y)?value.position:null};
}
export function elapsed(a,at) {
  return a?Math.min(a.durationMs,a.elapsedMs+(a.status==='running'?Math.max(0,at-a.startedAt):0)):0;
}
function finish(state,at,reason) {
  const a=state.active,spent=elapsed(a,at);
  if(!state.records.some(r=>r.id===a.id)&&spent>0)state.records.push({id:a.id,kind:a.kind,startedAt:a.createdAt,endedAt:reason==='elapsed'?a.startedAt+(a.durationMs-a.elapsedMs):at,durationMs:spent,plannedMs:a.durationMs,reason});
  state.active={...a,status:'finished',elapsedMs:spent,startedAt:null,reason,pendingNotice:reason==='elapsed'};
}
export function transition(value,action,at=Date.now()) {
  const state=readClock(structuredClone(value)),a=state.active;
  if(a?.status==='running'&&elapsed(a,at)>=a.durationMs)finish(state,at,'elapsed');
  switch(action.type){
    case 'tick':break;
    case 'start':
      if(state.active&&state.active.status!=='finished')throw Error('请先暂停并结束当前计时。');
      if(!['focus','break'].includes(action.kind)||!Number.isFinite(action.minutes)||action.minutes<1||action.minutes>120||!action.id)throw Error('计时范围为 1–120 分钟。');
      if(action.kind==='focus')state.position=null;
      state.active={id:action.id,kind:action.kind,status:'running',createdAt:at,startedAt:at,elapsedMs:0,durationMs:Math.round(action.minutes*60000),pendingNotice:false};
      break;
    case 'pause':if(state.active?.status==='running')state.active={...state.active,elapsedMs:elapsed(state.active,at),startedAt:null,status:'paused'};break;
    case 'resume':if(state.active?.status==='paused')state.active={...state.active,startedAt:at,status:'running'};break;
    case 'end':if(state.active&&state.active.status!=='finished'&&(!action.id||state.active.id===action.id))finish(state,at,'ended');break;
    case 'discard':
      if(action.id){state.records=state.records.filter(r=>r.id!==action.id);if(state.active?.id===action.id)state.active=null;}
      break;
    case 'dock':state.position=null;break;
    case 'dismiss':if(state.active?.status==='finished')state.active=null;break;
    case 'claim':if(state.active?.pendingNotice)state.active.pendingNotice=false;break;
    case 'move':state.position={x:action.x,y:action.y};break;
    default:throw Error('未知计时操作。');
  }
  return state;
}
export function clampPosition(p,width,height,viewportWidth,viewportHeight) {
  return {x:Math.max(8,Math.min(p.x,Math.max(8,viewportWidth-width-8))),y:Math.max(8,Math.min(p.y,Math.max(8,viewportHeight-height-8)))};
}
export function dailyFocus(records,timezone='UTC') {
  const days=new Map(),format=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'});
  // Credit each recorded interval to its completion day, explicitly labelled in the UI.
  for(const r of records.filter(r=>r.kind==='focus')){const date=format.format(new Date(r.endedAt));days.set(date,(days.get(date)||0)+r.durationMs);}
  return [...days].sort(([a],[b])=>b.localeCompare(a));
}
