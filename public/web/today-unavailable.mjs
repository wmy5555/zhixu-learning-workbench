import {escape as e} from './markdown.mjs';
import {routeButton as link} from './ui.mjs';

const categories = {
  stage:['待加入学习','choose'], not_due:['等待复习','wait'], material:['需先核对','check'],
  prerequisite:['前置未完成','check'], budget:['时间不足','wait'], paused:['已暂停','quiet'],
  today_action:['今日已处理','quiet'], retired:['不再使用','quiet'], superseded:['已被替代','quiet'],
  other:['其他原因','quiet']
};
export function groupUnavailable(items=[]){
  const groups=new Map();
  for(const item of items){
    const code=Object.hasOwn(categories,item.code)?item.code:'other';
    if(!groups.has(code)){const [label,tone]=categories[code];groups.set(code,{code,label,tone,items:[]});}
    groups.get(code).items.push(item);
  }
  return [...groups.values()].sort((a,b)=>b.items.length-a.items.length);
}
export function unavailableHTML(items){
  const groups=groupUnavailable(items);if(!groups.length)return '';
  const total=groups.reduce((sum,g)=>sum+g.items.length,0);
  return `<details class="today-unavailable" data-unavailable><summary><span>为什么有些知识还没有安排？</span><span class="unavailable-total">${total} 条</span></summary><div class="unavailable-body"><div class="unavailable-overview" role="group" aria-label="按未安排原因筛选">${groups.map((g,i)=>`<button type="button" class="unavailable-category" data-unavailable-code="${g.code}" data-tone="${g.tone}" aria-pressed="${i===0}" aria-controls="unavailable-list"><span>${e(g.label)}</span><strong>${g.items.length}<small>条</small></strong><span class="unavailable-meter" aria-hidden="true"><i style="width:${g.items.length/total*100}%"></i></span></button>`).join('')}</div><div id="unavailable-list" class="unavailable-list" aria-live="polite"></div><button type="button" class="text-button unavailable-more" data-unavailable-more hidden></button></div></details>`;
}
export function unavailableRows(group,limit=5){
  const reasons=new Set(group.items.map(item=>String(item.reason||'')));
  const shared=reasons.size===1?[...reasons][0]:'';
  return `${shared?`<p class="unavailable-reason">${e(shared)}</p>`:''}<ul>${group.items.slice(0,limit).map(item=>`<li><div><h3>${e(item.title||'未命名知识')}</h3>${!shared&&item.reason?`<p>${e(item.reason)}</p>`:''}</div>${link('查看 ↗',`read/${item.noteId}`,'text-button')}</li>`).join('')}</ul>`;
}
export function mountUnavailable(root,items){
  if(!root)return;
  const groups=groupUnavailable(items),buttons=[...root.querySelectorAll('[data-unavailable-code]')];
  const host=root.querySelector('#unavailable-list'),more=root.querySelector('[data-unavailable-more]');
  let active=groups[0],limit=5,mounted=false;
  const draw=()=>{
    host.innerHTML=unavailableRows(active,limit);
    const remaining=Math.max(0,active.items.length-limit);more.hidden=!remaining;more.textContent=remaining?`再看 ${Math.min(5,remaining)} 条${remaining>5?`（剩余 ${remaining} 条）`:``}`:'';
    buttons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.unavailableCode===active.code)));
    mounted=true;
  };
  root.addEventListener('toggle',()=>{if(root.open&&!mounted)draw();});
  buttons.forEach(button=>button.addEventListener('click',()=>{active=groups.find(g=>g.code===button.dataset.unavailableCode);limit=5;draw();}));
  more.addEventListener('click',()=>{limit+=5;draw();if(more.hidden)buttons.find(b=>b.dataset.unavailableCode===active.code)?.focus({preventScroll:true});});
  if(root.open)draw();
}
