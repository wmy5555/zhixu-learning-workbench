// Uses the original readiness gate and HTTP study contracts. No local grading or implicit writes.
export function createInlineStudy({api,openStudy,changed=()=>{},saving=()=>{}}){
 const entries=new Map();let active=null;
 const current=entry=>active===entry;
 const notify=entry=>changed(entry,{visible:current(entry)});
 async function read(entry){const session=await api.get(`/api/study/${encodeURIComponent(entry.session.id)}`);entry.session=session;entry.needsRead=false;notify(entry);return session;}
 return {
  get active(){return active;},
  get hasDrafts(){return [...entries.values()].some(entry=>entry.draft.trim());},
  async open(noteId){let entry=entries.get(noteId);
   if(!entry){entry={noteId,draft:'',session:null,error:'',loading:false,busy:false,requestId:null,hintUsed:false,hiddenMaterial:false,needsRead:false};entries.set(noteId,entry);}
   active=entry;entry.error='';entry.blocked=null;if(entry.session){notify(entry);return entry;}
   if(entry.pending){notify(entry);await entry.pending;return entry;}
   entry.loading=true;notify(entry);
   entry.pending=(async()=>{try{const result=await openStudy(noteId);
     if(result?.blocked){entry.blocked=result;}else if(result?.session){entry.session=result.session;}else throw Error('这次没有打开练习，请再试一次。');
   }catch(error){entry.error=error.message;}finally{entry.loading=false;notify(entry);}})();
   await entry.pending;entry.pending=null;return entry;
  },
  close(){active=null;},
  updateDraft(value){if(active)active.draft=value;},
  async refresh(){const entry=active;if(!entry?.session||entry.busy)return;entry.error='';try{return await read(entry);}catch(error){entry.error=error.message;notify(entry);}},
  async submit(){const entry=active;if(!entry?.session||entry.busy||entry.needsRead||entry.session.pendingJobId||['completed','awaiting_feedback'].includes(entry.session.status)||!entry.draft.trim())return;
   entry.busy=true;entry.error='';entry.requestId||=crypto.randomUUID();saving(1);notify(entry);
   try{await api.post(`/api/study/${encodeURIComponent(entry.session.id)}/answer`,{answer:entry.draft,hintUsed:entry.hintUsed,requestId:entry.requestId});
    entry.needsRead=true;entry.draft='';entry.hintUsed=false;entry.requestId=null;
    try{await read(entry);}catch{entry.error='回答已保存，暂时没读到最新状态。点击“查看最新反馈”再看看。';}
   }catch(error){entry.error=error.message;}
   finally{entry.busy=false;saving(-1);notify(entry);}
  },
  async hint(){const entry=active;if(!entry?.session||entry.busy)return;entry.error='';entry.busy=true;saving(1);notify(entry);
   try{const result=await api.post(`/api/study/${encodeURIComponent(entry.session.id)}/hint`);entry.hintUsed=true;entry.hint=result.hint;}
   catch(error){entry.error=error.message;}finally{entry.busy=false;saving(-1);notify(entry);}
  },
  async finish(){const entry=active;if(!entry?.session||entry.busy||entry.draft.trim()||entry.session.pendingJobId||['completed','awaiting_feedback'].includes(entry.session.status)||!entry.session.turns?.length)return;entry.error='';entry.busy=true;saving(1);notify(entry);
   try{await api.post(`/api/study/${encodeURIComponent(entry.session.id)}/finish`);await read(entry);}
   catch(error){entry.error=error.message;}finally{entry.busy=false;saving(-1);notify(entry);}
  }
 };
}
