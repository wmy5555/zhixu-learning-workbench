import {escape as e} from './markdown.mjs';
import {icon, routeButton as link} from './ui.mjs';
import {springEnter} from './cds/motion-bridge.mjs';
import {MAX_FILE_BYTES} from '../source-file-limits.mjs';

const originals = {png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
export const captureAccept = '.txt,.md,.markdown,'+Object.keys(originals).map(ext=>'.'+ext).join(',');
export function classifyCaptureFiles(files) {
  if(!files.length)return {texts:[],originals:[]};
  if(files.length>100)throw Error('一次最多选择 100 份文本，或 20 份原件。');
  const result={texts:[],originals:[]};
  for(const file of files){
    if(file.webkitRelativePath?.includes('/'))throw Error('请直接选择文件，暂不接收整个文件夹。');
    const ext=file.name.split('.').at(-1).toLowerCase(),text=/^(txt|md|markdown)$/.test(ext);
    if(!text&&!originals[ext])throw Error(`“${file.name}”暂不支持。请选择 TXT、Markdown、PNG、JPEG、GIF、WebP、PDF 或 Word。`);
    if(!file.size)throw Error(`“${file.name}”是空文件，请重新选择。`);
    if(file.size>(text?2*1024*1024:MAX_FILE_BYTES))throw Error(`“${file.name}”超过${text?' 2 MB，请拆分文字后重试':' 50 MB，请缩小文件后重试'}。`);
    if(!text&&file.type&&file.type!=='application/octet-stream'&&file.type.toLowerCase()!==originals[ext])throw Error(`“${file.name}”的格式与扩展名不一致，请检查原文件。`);
    result[text?'texts':'originals'].push(file);
  }
  if(result.texts.length&&result.originals.length)throw Error('文字和原件的保存方式不同，请分两次放入；这次文件尚未导入。');
  if(result.originals.length>20)throw Error('一次最多选择 20 份原件，请分批放入。');
  return result;
}
export function captureFilesHTML(){return `<section id="capture-files" class="capture-files" aria-labelledby="capture-files-title">
  <div class="capture-drop" data-drop><span class="capture-file-icon">${icon('file')}</span><strong id="capture-files-title">从一份文件开始</strong><p>拖到这里，或选择文件</p><button type="button" class="secondary" data-pick>选择文件</button><input type="file" data-input multiple accept="${captureAccept}" aria-label="选择文本、图片、PDF 或 Word" hidden></div>
  <details class="capture-file-formats"><summary>格式与保存方式</summary><p>单份文本读入编辑区，多份先预览；图片、PDF、Word 保留原件。文字与原件请分次选择。</p><p>TXT、MD、Markdown：每份最多 2 MB、50 万字。<br>PNG、JPEG、GIF、WebP、PDF、DOC、DOCX：每份最多 50 MB。<br>原件只发送到本机；保存不调用 AI。Word 正文转换后请核对。</p></details>
  <div class="capture-file-feedback" data-feedback role="status" aria-live="polite" hidden></div><div data-files></div><button type="button" class="primary capture-save-files" data-save hidden>保存原件</button><p class="capture-file-status" data-status role="status"></p></section>`;}

// A successful upload is reused after an import failure; completed rows are never replayed.
export async function saveCaptureOriginal(row,api){
  if(row.note)return row.note;
  if(!row.uploaded){await api.upload(row.file,row.uploadId);row.uploaded=true;}
  const result=await api.post('/api/file-import',{uploadId:row.uploadId});
  if(!result.note?.id)throw Error('未收到完整保存回执，请核对资料库后重试。');
  row.note=result.note;return row.note;
}
export function mountCaptureFiles(root,{api,state,onTexts,onPending,afterSave}){
  const find=s=>root.querySelector(s),input=find('[data-input]'),drop=find('[data-drop]'),pick=find('[data-pick]'),save=find('[data-save]'),feedback=find('[data-feedback]'),host=find('[data-files]'),status=find('[data-status]');
  let rows=[],working=false,animation,depth=0;
  const clearError=()=>{animation?.cancel();feedback.hidden=true;feedback.replaceChildren();drop.classList.remove('has-error');};
  const showError=message=>{clearError();feedback.hidden=false;feedback.innerHTML=`<div><strong>这次没能放入</strong><p>${e(message)}</p></div><button type="button" class="text-button" aria-label="关闭文件提示">${icon('close')}</button>`;feedback.querySelector('button').onclick=clearError;drop.classList.add('has-error');animation=springEnter(feedback,undefined,6,.99);};
  const draw=()=>{
    host.innerHTML=rows.map((row,index)=>`<article class="capture-file-row" ${!row.note?'data-pending':''}><div><strong>${e(row.file.name)}</strong><small>${row.note?'已保存':row.error?'未保存，可重试':'等待保存'} · ${Math.max(1,Math.ceil(row.file.size/1024))} KB</small>${row.error?`<p>${e(row.error)}</p>`:''}${row.note?link('打开资料 ↗',`read/${row.note.id}`,'text-button'):''}</div><button type="button" class="text-button" data-remove="${index}" aria-label="${row.note?'收起':'移除'} ${e(row.file.name)}" ${working?'disabled':''}>${icon('close')}</button></article>`).join('');
    host.querySelectorAll('[data-remove]').forEach(button=>button.onclick=()=>{rows.splice(Number(button.dataset.remove),1);draw();});
    const pending=rows.filter(row=>!row.note).length;save.hidden=!pending;save.disabled=working;save.textContent=working?'正在保存…':`保存 ${pending} 份原件`;pick.disabled=working;input.disabled=working;onPending(Boolean(pending));
  };
  const choose=async files=>{
    if(working||state.saving)return;
    clearError();status.textContent='';working=true;state.saving++;draw();
    try{
      const classified=classifyCaptureFiles(files);
      if(classified.texts.length)await onTexts(classified.texts);
      else if(classified.originals.length){
        if(rows.filter(r=>!r.note).length+classified.originals.length>20)throw Error('待保存原件最多 20 份，请先保存或移除一些文件。');
        rows=rows.filter(r=>!r.note).concat(classified.originals.map(file=>({file,uploadId:crypto.randomUUID(),uploaded:false})));
      }
    }catch(error){if(root.isConnected)showError(error.message);}
    finally{working=false;state.saving--;input.value='';if(root.isConnected)draw();}
  };
  pick.onclick=()=>input.click();input.onchange=()=>choose([...input.files]);
  drop.ondragenter=event=>{event.preventDefault();if(!working){depth++;drop.classList.add('is-dragging');}};
  drop.ondragover=event=>{event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect=working?'none':'copy';};
  drop.ondragleave=event=>{event.preventDefault();if(--depth<=0){depth=0;drop.classList.remove('is-dragging');}};
  drop.ondrop=event=>{
    event.preventDefault();depth=0;drop.classList.remove('is-dragging');if(working||state.saving)return;
    if([...event.dataTransfer.items||[]].some(item=>item.webkitGetAsEntry?.()?.isDirectory)){showError('请直接拖入文件，暂不接收整个文件夹。');return;}
    void choose([...event.dataTransfer.files]);
  };
  save.onclick=async()=>{
    if(working||state.saving)return;working=true;state.saving++;clearError();draw();
    try{
      for(const row of rows.filter(r=>!r.note)){
        row.error='';status.textContent=`正在保存 ${row.file.name}…`;
        try{await saveCaptureOriginal(row,api);}catch(error){row.error=error.message;showError(error.message);break;}
        draw();
      }
      status.textContent=`已保存 ${rows.filter(r=>r.note).length} / ${rows.length} 份原件。`;
      await afterSave();
    }catch(error){showError(error.message);}
    finally{working=false;state.saving--;if(root.isConnected)draw();}
  };
  draw();return {choose};
}
