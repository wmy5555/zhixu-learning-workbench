// Persist assistance per session AND round. A new answer never inherits the last round.
export function aidKey(session){return `zhixu-study-aid:${session.id}:${session.turns?.length||0}`;}
export function aidUsed(session,storage=globalThis.sessionStorage){
  try{return Number(session.hintCount)>0||storage.getItem(aidKey(session))==='true';}catch{return Number(session.hintCount)>0||session.webAidUsed===true;}
}
export function markAid(session,storage=globalThis.sessionStorage){
  session.webAidUsed=true;
  try{storage.setItem(aidKey(session),'true');}catch{}
}
export function clearAid(session,storage=globalThis.sessionStorage){try{storage.removeItem(aidKey(session));}catch{}}
