// Resolve the active substep without changing the selected knowledge or form values.
export function learningTarget({root,route,noteId,visible}){
 const id=String(noteId||'').replace(/[^a-zA-Z0-9_-]/g,'');
 if(!id)return null;
 const dialog=[...root.querySelectorAll('dialog[open]')].at(-1),scope=dialog||root;
 const pick=selector=>[...scope.querySelectorAll(selector)].find(visible)||null;
 if(dialog){
  if(dialog.dataset.guideForm==='learning'&&dialog.dataset.guideNote===id){
   const stage=pick('[name="stage"]'),depth=pick('[name="depth"]');
   if(stage&&!['learning','integrated','core'].includes(stage.value))return stage;
   if(depth&&depth.value!=='explain')return depth;
   return pick('form button[type="submit"]');
  }
  return pick(`[data-action="promote"][data-id="${id}"]`);
 }
 if(route===`read/${id}`)return pick(`[data-action="promote"][data-id="${id}"]`)||pick(`[data-action="reader-actions"][data-id="${id}"]`);
 if(route===`edit/${id}`)return pick(`#main [data-route="read/${id}"]`);
 if(route==='library')return pick(`#main [data-route="read/${id}"]`);
 return null;
}
