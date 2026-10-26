// Reconcile at most three cards. The stage, controls, gestures and observers keep their identity.
export function syncDeckWindow(list,items,create,{forceKey}={}){
 const old=[...list.children],used=new Set();let created=0;
 items.forEach(({card,slot,key},index)=>{
  let node=old.find(el=>!used.has(el)&&el.dataset.progressKey===key&&!(slot===0&&key===forceKey));
  if(!node){node=create(card,slot);created++;}
  used.add(node);node.dataset.progressKey=key;node.dataset.slot=String(slot);node.style.setProperty('--slot',slot);
  node.classList.toggle('lf-current',slot===0);node.inert=slot!==0;
  if(slot===0)node.removeAttribute('aria-hidden');else node.setAttribute('aria-hidden','true');
  if(list.children[index]!==node)list.insertBefore(node,list.children[index]||null);
 });
 for(const node of old)if(!used.has(node))node.remove();
 return {created,reused:items.length-created};
}
