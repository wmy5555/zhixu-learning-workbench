import {escape as e} from './markdown.mjs';
import {modal,notify,confirm,routeButton as link} from './ui.mjs';
export async function prepareTexts(files){
  if(!files.length||files.length>100)throw Error('每批请选择 1–100 份文本。');
  const rows=[];
  for(const file of files){
    if(!/\.(txt|md|markdown)$/i.test(file.name))throw Error(`${file.name} 不是 TXT 或 Markdown。`);
    if(file.size>2*1024*1024)throw Error(`${file.name} 超过 2 MB，请拆分。`);
    const body=await file.text();
    if(!body.trim()||body.length>500000)throw Error(`${file.name} 须为 1–500000 个字符。`);
    rows.push({title:file.name.replace(/\.[^.]+$/,''),body,platform:'文本文件',locator:file.name,state:'pending'});
  }
  return rows;
}
export async function batchImport(files,{api,refreshBoot,state}){
  const rows=await prepareTexts(files);
  const d=modal('先核对，再收入资料库',`<p class="form-note">共 ${rows.length} 份，只保存原文，不调用 AI。同正文由后端合并出处。失败后重试仅继续未确认的项目。</p><div data-rows></div><div class="actions"><button class="primary" type="button" data-run>确认批量导入</button></div><p data-status role="status"></p>`,{wide:true});
  const host=d.querySelector('[data-rows]'),run=d.querySelector('[data-run]'),status=d.querySelector('[data-status]');
  let running=false;
  d.beforeClose=()=>!running||Promise.resolve(false);
  const draw=()=>{host.innerHTML=rows.map(r=>`<article class="parity-card"><h3>${e(r.title)}</h3><p>${r.body.length.toLocaleString()} 字 · ${e({pending:'待导入',done:'已保存',failed:'未完成'}[r.state])}</p><details><summary>预览原文</summary><pre class="preserve-text">${e(r.body)}</pre></details>${r.error?`<p class="notice">${e(r.error)}</p>`:''}${r.id?link('打开原文 ↗',`read/${r.id}`,'text-button'):''}</article>`).join('');};draw();
  run.onclick=async()=>{
    if(running)return;running=true;run.disabled=true;state.saving++;
    try{
      for(const row of rows.filter(r=>r.state!=='done')){
        status.textContent=`正在保存 ${row.title}…`;
        try{
          const result=await api.post('/api/import',{items:[{title:row.title,body:row.body,platform:row.platform,locator:row.locator}],process:false,research:false});
          row.id=result.notes?.[0]?.id;if(!row.id)throw Error('保存结果不完整，请先核对资料库。');row.state='done';row.error='';
        }catch(error){row.state='failed';row.error=error.message;break;}
        draw();
      }
      draw();const done=rows.filter(r=>r.state==='done').length;
      await refreshBoot();
      status.textContent=`已保存 ${done} / ${rows.length} 份。${done<rows.length?'失败项目可能已在服务端保存；重试按正文去重，但可能增加一条出处。':''}`;
      run.textContent=done===rows.length?'全部已保存':'继续未确认项目';run.disabled=done===rows.length;
    }catch(error){notify(error.message,true);run.disabled=false;}
    finally{running=false;state.saving--;}
  };
}
