import { escape as e, markdown } from './markdown.mjs';
import { $, button as btn, routeButton as link, field, area, heading, modal, confirm, busy, notify } from './ui.mjs';
import { list, select, details, facts, paginate } from './parity.mjs';
import { endpoint } from './api.mjs';

export const validAccent = value => /^#[\da-f]{6}$/i.test(value||'');
const rgb = hex => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
const mix = (a,b,t) => '#'+rgb(a).map((n,i)=>Math.round(n+(rgb(b)[i]-n)*t).toString(16).padStart(2,'0')).join('');
const light = hex => rgb(hex).map(v=>{const n=v/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0);
export const contrast = (a,b) => (Math.max(light(a),light(b))+.05)/(Math.min(light(a),light(b))+.05);
export function accentPalette(seed,dark=false) {
  if(!validAccent(seed))throw Error('请输入六位十六进制色码，例如 #C6613F。');
  const surface=dark?'#242422':'#fcfcfb';let accent=seed;
  for(let i=0;i<=100;i++){const next=mix(seed,dark?'#ffffff':'#000000',i/100);if(contrast(next,surface)>=4.5){accent=next;break;}}
  const ink=contrast(accent,'#000000')>contrast(accent,'#ffffff')?'#000000':'#ffffff';
  return {accent,ink,hover:mix(accent,ink==='#ffffff'?'#000000':'#ffffff',.12)};
}
const accentKey='zhixu-web-accent-v1';
export function applyAccent(value) {
  const root=document.documentElement;
  const names=['--accent','--accent-ink','--cds-clay-hover','--parity-button-ink'];
  if(!value){names.forEach(n=>root.style.removeProperty(n));root.removeAttribute('data-custom-accent');return;}
  const p=accentPalette(value,root.classList.contains('dark'));
  [p.accent,p.accent,p.hover,p.ink].forEach((v,i)=>root.style.setProperty(names[i],v));root.dataset.customAccent='true';
}
export function initializeAccent() {
  let saved=null;try{const value=localStorage.getItem(accentKey);if(validAccent(value))saved=value;}catch{}
  applyAccent(saved);
  new MutationObserver(()=>applyAccent(saved)).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
  window.addEventListener('storage',ev=>{if(ev.key===accentKey){saved=validAccent(ev.newValue)?ev.newValue:null;applyAccent(saved);}});
  return {get:()=>saved,save:value=>{if(value!==null&&!validAccent(value))throw Error('颜色代码无效。');if(value===null)localStorage.removeItem(accentKey);else localStorage.setItem(accentKey,value);saved=value;applyAccent(value);}};
}
function download(name,text,mime='application/json') {
  const url=URL.createObjectURL(new Blob([text],{type:mime})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function createManagement(ctx,appearance) {
  const {api,state,go,refreshBoot,submit,watchForm,savedForm}=ctx;
  const reload=async()=>{await refreshBoot();if(!state.dirty)await go(state.route,{replace:true,force:true});};
  const check=(name,text,on=false)=>`<label class="check"><input type="checkbox" name="${name}" ${on?'checked':''}>${e(text)}</label>`;
  async function page(section='') {
    if(section==='usage')return usage();
    if(section==='maintenance')return maintenance();
    if(section==='prompts')return prompts();
    if(section==='restore')return restore();
    const s=await api.get('/api/settings');
    return {html:heading('TOOLS THAT STAY QUIET','按自己的方式，照顾知识。','设置只在你明确保存时生效。',link('回到系统设置','settings','text-button'))+nav()+
      `<div class="advanced-settings"><section><h2>时间与存储</h2><form id="advanced-rhythm"><div class="form-grid">${field('时区','timezone',{value:s.timezone,required:true})}${field('自动安排时间','scheduleTime',{value:s.scheduleTime,type:'time',required:true})}${field('资料存储位置','vaultDir',{value:s.vaultDir||'',required:true})}</div><p class="form-note">切换存储位置前请备份；不会自动迁移旧目录资料。</p><button class="primary" type="submit">保存时间与存储</button></form></section>
      <section><h2>独立外部能力</h2><p class="form-note">每项单独配置和测试。测试可能联网或计费，只有你点击并确认后才发送。不会自动请求模型目录。</p>${[['embedding','语义嵌入'],['search','联网搜索'],['fetch','网页读取']].map(([key,label])=>details(label,capabilityForm(key,s[key]||{}))).join('')}</section>
      <section><h2>MCP 与 ChatGPT 接入</h2><form id="mcp-form">${check('enabled','启用本地 MCP',s.mcp?.enabled)}${check('allowProposals','允许提出写入建议（仍需本机确认）',s.mcp?.allowProposals)}${check('chatgptEnabled','启用 ChatGPT 收集入口',s.mcp?.chatgptEnabled)}${check('chatgptAllowRead','允许 ChatGPT 独立读取知识库',s.mcp?.chatgptAllowRead)}<p class="form-note">收集授权与读取授权分别管理。这里不创建或显示凭据。</p><button class="primary" type="submit">保存接入设置</button></form>${details('接入说明','<p>MCP 使用 stdio 接入，本地工具包括检索、原文读取、关系查询和写入提案。ChatGPT 收集服务的安装与凭据仍沿用既有接入流程。</p><a href="/chatgpt-setup.html" target="_blank" rel="noopener noreferrer">打开现有接入说明 ↗</a>')}</section>
      <section><h2>强调色</h2><p class="form-note">仅影响当前浏览器。预览后保存；默认陶土配色保持不变。</p><form id="accent-form"><div class="accent-presets">${['#c6613f','#916749','#58746a','#68758a','#846a80'].map(c=>`<button type="button" data-accent="${c}" aria-label="预览 ${c}" style="background:${c}"></button>`).join('')}</div><div class="form-grid">${field('取色','picker',{type:'color',value:appearance.get()||'#c6613f'})}${field('颜色代码','code',{value:appearance.get()||'#c6613f',extra:'pattern="#[0-9a-fA-F]{6}"'})}</div><div class="accent-preview"><span data-preview-title>一个值得继续思考的问题</span><p>预览只在此处呈现，页面默认布局保持。</p><span data-preview-button class="primary">继续学习</span></div><div class="actions"><button class="primary" type="submit">保存强调色</button>${btn('恢复默认','accent-default','text-button')}</div></form></section></div>`,
      bind(){
        const rhythm=$('#advanced-rhythm');watchForm(rhythm);submit(rhythm,async values=>{if(values.vaultDir!==s.vaultDir&&!await confirm('切换资料目录？','当前输入的目录将成为使用中的知识空间。请先确认已有备份。','切换目录'))return;await api.put('/api/settings',values);savedForm(rhythm);await reload();});
        document.querySelectorAll('[data-capability]').forEach(form=>bindCapability(form));
        const m=$('#mcp-form');watchForm(m);const dep=()=>{for(const [parent,child] of [['enabled','allowProposals'],['chatgptEnabled','chatgptAllowRead']]){m.elements[child].disabled=!m.elements[parent].checked;if(!m.elements[parent].checked)m.elements[child].checked=false;}};dep();m.addEventListener('change',dep);
        submit(m,async()=>{dep();await api.put('/api/settings',{mcp:Object.fromEntries(['enabled','allowProposals','chatgptEnabled','chatgptAllowRead'].map(k=>[k,m.elements[k].checked]))});savedForm(m);notify('接入设置已保存。');});
        const a=$('#accent-form');watchForm(a);const preview=value=>{if(!validAccent(value))return;const p=accentPalette(value,document.documentElement.classList.contains('dark'));a.querySelector('[data-preview-title]').style.color=p.accent;Object.assign(a.querySelector('[data-preview-button]').style,{background:p.accent,color:p.ink});};
        a.elements.picker.oninput=()=>{a.elements.code.value=a.elements.picker.value;preview(a.elements.code.value);};a.elements.code.oninput=()=>{if(validAccent(a.elements.code.value))a.elements.picker.value=a.elements.code.value;preview(a.elements.code.value);};
        a.querySelectorAll('[data-accent]').forEach(b=>b.onclick=()=>{a.elements.code.value=a.elements.picker.value=b.dataset.accent;a.dispatchEvent(new Event('input',{bubbles:true}));preview(b.dataset.accent);});
        submit(a,async values=>{appearance.save(values.code);savedForm(a);notify('强调色已保存。');});a.querySelector('[data-action="accent-default"]').onclick=()=>{try{appearance.save(null);a.elements.code.value=a.elements.picker.value='#c6613f';savedForm(a);preview('#c6613f');notify('已恢复默认配色。');}catch(error){notify(error.message,true);}};preview(a.elements.code.value);
      }};
  }
  function nav(){return `<nav class="advanced-settings-nav" aria-label="管理章节">${[['manage','连接与偏好'],['manage/usage','用量与费用'],['manage/prompts','提示词'],['manage/maintenance','索引与提案'],['manage/restore','备份恢复']].map(([r,l])=>link(l,r,'text-button')).join('')}</nav>`;}
  function capabilityForm(key,s) {
    return `<form data-capability="${key}">${check('enabled','启用此能力',s.enabled)}<div class="form-grid">${key!=='fetch'?field('服务地址','baseUrl',{value:s.baseUrl||'',type:'url'}):'<p class="form-note">使用后端固定的安全测试网页，读取仍受既有网络边界限制。</p>'}${key==='embedding'?field('模型名称','model',{value:s.model||''}):''}${key!=='fetch'?field('API Key（留空保留）','apiKey',{type:'password',extra:'autocomplete="new-password"'}):''}</div><div class="actions"><button class="primary" type="submit">保存配置</button><button class="text-button" type="button" data-test>测试并保存当前配置</button></div><p data-status role="status"></p></form>`;
  }
  function bindCapability(form) {
    watchForm(form);const key=form.dataset.capability,status=form.querySelector('[data-status]');
    const values=()=>{const v=Object.fromEntries(new FormData(form));return {enabled:form.elements.enabled.checked,...Object.fromEntries(Object.entries(v).filter(([k,v])=>k!=='enabled'&&(k!=='apiKey'||v)))};};
    submit(form,async()=>{await api.put('/api/settings',{[key]:values()});if(form.elements.apiKey)form.elements.apiKey.value='';savedForm(form);status.textContent='配置已保存，尚未测试。';});
    form.querySelector('[data-test]').onclick=ev=>busy(ev.currentTarget,async()=>{
      if(!await confirm('发送一次配置测试？','可能联网或产生费用。只发送测试所需内容。','发送测试'))return;
      const snapshot=values(),fingerprint=JSON.stringify(snapshot),wasInert=form.inert;
      state.saving++;form.inert=true;$('#main').setAttribute('aria-busy','true');status.textContent='正在测试…';
      try{
        const result=await api.post('/api/settings/test',{capability:key,config:snapshot});
        if(JSON.stringify(values())!==fingerprint){status.textContent='测试期间配置已改变，请重新测试。';return;}
        if(!result.receipt){status.textContent=result.message||'测试未返回可保存凭据，请检查结果。';return;}
        await api.post('/api/settings/save-tested',{capability:key,config:snapshot,receipt:result.receipt});
        if(form.elements.apiKey)form.elements.apiKey.value='';savedForm(form);status.textContent=result.message||'测试通过，配置已保存。';
      }catch(error){status.textContent='测试未完成，配置尚未确认保存。请核对后再重试。';throw error;}
      finally{state.saving--;form.inert=wasInert;if(!state.saving)$('#main').removeAttribute('aria-busy');}
    });
  }
  async function prompts(){
    const data=await api.get('/api/prompts');
    return {html:heading('A THOUGHTFUL ASSISTANT','让提示词，贴近你的思考。','保留模板中的必需变量；保存不会调用 AI。',link('回到设置','settings','text-button'))+nav()+list(data.prompts).map(p=>details(p.label||p.name||p.key,`<form data-prompt="${e(p.key)}">${area('模板','template',{value:p.template,rows:12})}<p class="form-note">${e(p.description||'')}</p>${facts([['变量',p.variables]])}<div class="actions"><button class="primary" type="submit">保存模板</button><button type="button" class="text-button" data-default>恢复默认内容</button></div></form>`)).join(''),bind(){document.querySelectorAll('[data-prompt]').forEach(form=>{const p=data.prompts.find(p=>p.key===form.dataset.prompt);watchForm(form);form.querySelector('[data-default]').onclick=()=>{form.elements.template.value=p.defaultTemplate;form.dispatchEvent(new Event('input',{bubbles:true}));};submit(form,async values=>{await api.put('/api/prompts',{prompts:{[p.key]:values.template}});savedForm(form);notify('模板已保存。');});});}};
  }
  async function usage() {
    let [report,s]=await Promise.all([api.get('/api/usage?period=month'),api.get('/api/settings')]);
    const labels={calls:'调用次数',failedCalls:'失败调用',totalTokens:'已知 Token',inputTokens:'输入 Token',outputTokens:'输出 Token',cachedInputTokens:'缓存输入',cost:'费用合计',knownCost:'已知费用',unknownCostCalls:'费用未知调用',unknownTokenCalls:'Token 未知调用',pendingCalls:'未结算调用',unknownResultCalls:'结果未明确调用'};
    const table=(rows,fields)=>'<div class="data-table-wrap"><table><thead><tr>'+fields.map(([,l])=>'<th>'+l+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+fields.map(([k])=>'<td>'+e(r[k]??'未知')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
    const price=(group,name,label)=>field(label,group+'.'+name,{type:'number',value:s[group]?.[name]??'',extra:'min="0" step="any"'});
    const fields=[['createdAt','时间'],['model','模型'],['purposeLabel','用途'],['inputTokens','输入'],['outputTokens','输出'],['cost','费用']];
    return {html:heading('KNOW THE COST','看清工具用了多少。','缺失的用量与价格保留未知。历史费用不会按新单价重算。',link('回到设置','settings','text-button'))+nav()+
      '<div class="advanced-settings"><form id="usage-filter"><div class="form-grid">'+select('时间范围','period',[['today','今天'],['7d','近 7 天'],['30d','近 30 天'],['month','本月']],'month')+select('调用能力','capability',[['','全部能力'],['model','文本模型'],['embedding','语义嵌入'],['search','联网搜索'],['fetch','网页读取']])+select('模型','model',[['','全部模型'],...list(report.availableModels).map(x=>[x,x])])+select('用途','purpose',[['','全部用途'],...list(report.availablePurposes)])+'</div><button class="secondary" type="submit">更新统计</button></form><section id="usage-summary"></section><section><h2>每日趋势</h2><div id="usage-daily"></div></section><section><h2>按模型统计</h2><div id="usage-models"></div></section><section><h2>价格与预算</h2><form id="pricing"><div class="form-grid">'+field('每日调用上限','dailyCallLimit',{type:'number',value:s.ai.dailyCallLimit,extra:'min="0"'})+field('每月预算（0 表示不限）','monthlyBudget',{type:'number',value:s.ai.monthlyBudget,extra:'min="0" step="any"'})+price('ai','inputPrice','文本输入单价 / 百万 Token')+price('ai','outputPrice','文本输出单价 / 百万 Token')+price('ai','cachedInputPrice','缓存输入单价 / 百万 Token')+price('embedding','inputPrice','嵌入单价 / 百万 Token')+price('search','requestPrice','每次搜索价格')+'</div><button class="primary" type="submit">保存价格与预算</button></form></section><section><h2>近期调用明细</h2><p class="form-note" id="usage-detail-scope"></p>'+btn('导出当前明细 CSV','export-usage','secondary')+'<div id="usage-calls"></div></section></div>',
      bind(){
        const render=()=>{
          $('#usage-summary').innerHTML='<h2>范围概览</h2>'+facts([['统计区间',report.from+' — '+report.to],['统计时区',report.timezone],...Object.entries(labels).map(([key,label])=>[label,report.totals?.[key]??'未知']),['无效日期记录',report.invalidDateCalls]]);
          $('#usage-daily').innerHTML=table(list(report.daily),[['date','日期'],['calls','调用'],['totalTokens','已知 Token'],['cost','费用'],['unknownTokenCalls','Token 未知调用']]);
          $('#usage-models').innerHTML=table(list(report.models),[['model','模型'],['capability','能力'],['calls','调用'],['totalTokens','已知 Token'],['cost','费用']]);
          $('#usage-detail-scope').textContent='当前范围最近 '+(report.recentLimit||100)+' 条明细；汇总覆盖完整范围。导出仅含这里返回的明细。';
          paginate($('#usage-calls'),list(report.recentCalls),r=>table([r],fields));
        };render();
        submit($('#usage-filter'),async values=>{const route=state.sequence,result=await api.get('/api/usage?'+new URLSearchParams(values));if(route!==state.sequence)return;report=result;render();});
        $('[data-action="export-usage"]').onclick=()=>{
          const cell=v=>'"'+String(v??'未知').replace(/^[=+\-@]/,"'$&").replaceAll('"','""')+'"';
          download('知序-当前调用明细.csv','\uFEFF'+[fields.map(([,l])=>cell(l)).join(','),...list(report.recentCalls).map(r=>fields.map(([k])=>cell(r[k])).join(','))].join('\r\n'),'text/csv;charset=utf-8');
        };
        const form=$('#pricing');watchForm(form);submit(form,async values=>{
          const payload={pricingFor:Object.fromEntries(['ai','embedding','search'].map(k=>[k,{baseUrl:s[k].baseUrl,model:s[k].model||''}])),ai:{dailyCallLimit:Number(values.dailyCallLimit),monthlyBudget:Number(values.monthlyBudget)},embedding:{},search:{}};
          for(const [key,value] of Object.entries(values))if(key.includes('.')){const [g,k]=key.split('.');payload[g][k]=value===''?null:Number(value);}
          await api.put('/api/usage/settings',payload);savedForm(form);notify('预算与当前模型价格已保存。');
        });
      }};
  }
  async function maintenance(){
    const [d,p]=await Promise.all([api.get('/api/diagnostics'),api.get('/api/proposals')]);
    return {html:heading('KEEP THINGS IN ORDER','照顾资料，也保留分歧。','维护操作不会自动接受写入建议。',link('回到设置','settings','text-button'))+nav()+`<div class="advanced-settings"><section><h2>检索索引</h2>${facts(Object.entries(d.index||{}))}<div class="actions">${btn('重建本地文字索引','index-local','secondary')}${btn('增量更新语义索引','index-update','text-button')}${btn('重建语义索引','index-rebuild','text-button')}</div></section><section><h2>写入提案</h2>${list(p.proposals).map(x=>`<article class="parity-card"><h3>${e(x.reason||x.noteId)}</h3><p>${e(x.state)}</p>${link('核对当前资料',`read/${x.noteId}`,'text-button')}${details('对比修改',`<h3>提案基准正文</h3><pre class="preserve-text">${e(x.before||'')}</pre><h3>提议版本</h3><pre class="preserve-text">${e(x.body||'')}</pre>`)}${x.state==='pending'?`<div class="actions">${btn('接受提案','proposal','secondary',`data-id="${e(x.id)}" data-value="accept"`)}${btn('拒绝','proposal','text-button',`data-id="${e(x.id)}" data-value="reject"`)}</div>`:''}</article>`).join('')||'<p class="muted">没有写入提案。</p>'}</section><section><h2>文件冲突与待同步链接</h2><p class="form-note">先核对当前正文和历史版本，再手动合并；不静默覆盖外部编辑。</p>${[...list(d.storage?.conflicts),...list(d.storage?.pendingLinks)].map(x=>`<article class="parity-card"><pre class="parity-json">${e(JSON.stringify(x,null,2))}</pre>${x.id?link('查看当前资料',`read/${x.id}`,'text-button'):''}</article>`).join('')||'<p class="muted">未发现待处理冲突。</p>'}</section></div>`};
  }
  async function restore() {
    return {html:heading('KEEP A WAY BACK','给知识，留一条回来的路。','完整备份先预览，再确认恢复。不会恢复连接密钥。',link('回到设置','settings','text-button'))+nav()+`<div class="writing-page"><a class="secondary" href="/api/backup" download>下载完整备份</a><form id="restore-form"><label class="field"><span>选择完整 JSON 备份（最大 100 MB）</span><input type="file" name="backup" accept=".json,application/json" required></label><button class="primary" type="submit">预览恢复差异</button></form><div id="restore-preview"></div></div>`,
      bind(){const form=$('#restore-form');let revision=0,snapshot=null;form.elements.backup.onchange=()=>{revision++;snapshot=null;$('#restore-preview').innerHTML='';};
        submit(form,async()=>{const file=form.elements.backup.files[0];if(!file||file.size>100000000)throw Error('请选择不超过 100 MB 的完整 JSON 备份。');const current=revision,input=JSON.parse(await file.text()),p=await api.post('/api/restore',{backup:input,preview:true});if(current!==revision)return;snapshot={input,p};const host=$('#restore-preview');host.innerHTML=`<h2>核对恢复差异</h2><pre class="parity-json">${e(JSON.stringify(p,null,2))}</pre><p class="notice">恢复后外部能力关闭，排队任务等待再次确认。当前库与备份的变化请逐项核对。</p>${btn('确认恢复当前预览','restore-confirm','primary')}`;
          host.querySelector('button').onclick=ev=>busy(ev.currentTarget,async()=>{if(!snapshot||current!==revision)throw Error('文件已改变，请重新预览。');if(!await confirm('确认恢复这个备份？','将按预览恢复当前独立知识库。此操作可能替换当前记录，请先保留当前备份。','确认恢复'))return;await api.post('/api/restore',{backup:snapshot.input,preview:false,token:snapshot.p.token});snapshot=null;host.innerHTML='<p role="status">恢复完成。外部能力保持关闭。</p>';await refreshBoot();});
        });}};
  }
  async function handle(control) {
    const a=control.dataset.action;
    if(a==='index-local'||a==='index-update'||a==='index-rebuild'){if(a!=='index-local'&&!await confirm('更新语义索引？','将发送所需资料给嵌入服务，可能计费。','继续'))return true;await api.post(`/api/index/${a.slice(6)}`);notify('索引维护已提交。');await reload();}
    else if(a==='proposal'){if(control.dataset.value==='accept'&&!await confirm('接受这份写入提案？','后端将核对原版本；冲突时拒绝覆盖。','接受提案'))return true;await api.post(endpoint('proposals',control.dataset.id,'action'),{action:control.dataset.value});await reload();}
    else return false;return true;
  }
  return {page,handle};
}
