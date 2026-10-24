import { escape as e } from './markdown.mjs';
import { $, field, heading, routeButton, notify } from './ui.mjs';
import { select, facts } from './parity.mjs';

const rows = value => Array.isArray(value) ? value : [];
const names = { model:'文本模型', embedding:'语义嵌入', search:'联网搜索', fetch:'网页读取' };
const periods = [['today','今天'],['7d','近 7 天'],['30d','近 30 天'],['month','本月']];
const metrics = { totalTokens:'Token', calls:'调用', knownCost:'费用' };
const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits:6 });
const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export const usageNumber = value => valid(value) ? numberFormat.format(value) : '未知';
export const usageAmount = value => valid(value) && value > 0 && value < .000001 ? '< 0.000001' : usageNumber(value);
export function usageCost(row = {}) {
  if (row.unknownCostCalls > 0 || row.cost === null) return row.knownCost > 0 ? `${usageAmount(row.knownCost)} + 未知` : '未知';
  return usageAmount(row.cost ?? row.knownCost);
}
const shortDate = date => /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? `${Number(date.slice(5,7))}/${Number(date.slice(8))}` : date || '未知日期';
const table = (headers, cells, caption) => `<div class="data-table-wrap"><table class="usage-table"><caption class="sr-only">${e(caption)}</caption><thead><tr>${headers.map(h=>`<th scope="col">${e(h)}</th>`).join('')}</tr></thead><tbody>${cells.map(row=>`<tr>${row.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const count = value => e(usageNumber(value));
const empty = text => `<p class="usage-empty">${e(text)}</p>`;
const unknownFor = (row, metric) => metric === 'knownCost' ? row.unknownCostCalls : metric === 'totalTokens' ? row.unknownTokenCalls : 0;
const metricValue = (row, metric) => metric === 'knownCost' ? usageCost(row) : `${usageNumber(row[metric])}${unknownFor(row,metric) > 0 ? ' + 未知' : ''}`;

export function usageSummary(report) {
  const t=report.totals || {};
  const metric=(label,value,detail,accent=false)=>`<article class="usage-metric${accent?' usage-metric-accent':''}"><span>${label}</span><strong>${e(value)}</strong><small>${e(detail)}</small></article>`;
  return `<div class="usage-range"><h2>范围概览</h2><span>${e(report.from)} — ${e(report.to)} · ${e(report.timezone)}</span></div><div class="usage-metrics">${metric('调用次数',usageNumber(t.calls),'全部外部请求')}${metric('已知 Token',usageNumber(t.totalTokens),t.unknownTokenCalls?`${usageNumber(t.unknownTokenCalls)} 次用量不完整`:'输入与输出合计',true)}${metric('费用合计',usageCost(t),t.unknownCostCalls?`${usageNumber(t.unknownCostCalls)} 次费用未知`:'按调用时单价估算')}${metric('传输失败',usageNumber(t.failedCalls),'连接或 HTTP 失败')}</div>`;
}

export function usageTrend(report, metric='totalTokens') {
  if (!Object.hasOwn(metrics,metric)) metric='totalTokens';
  const daily=rows(report.daily);
  if (!daily.length || !report.totals?.calls) return empty('这段时间还没有调用。');
  const max=Math.max(0,...daily.map(r=>valid(r[metric])?r[metric]:0));
  const scale=max || 1;
  const format=metric==='knownCost'?usageAmount:usageNumber;
  const partial=daily.some(row=>unknownFor(row,metric)>0);
  return `<div class="usage-chart" aria-label="每日${metrics[metric]}趋势"><div class="usage-axis" aria-hidden="true"><span>${e(format(max))}</span><span>${e(format(max/2))}</span><span>0</span></div><div class="usage-bars" role="list" style="--usage-days:${daily.length}">${daily.map((row,index)=>{
    const value=valid(row[metric])?row[metric]:0,unknown=unknownFor(row,metric)>0;
    const label=`${row.date} · ${metricValue(row,metric)}${metric==='calls'?' 次':metric==='totalTokens'?' Token':''}`;
    return `<div class="usage-day${unknown?' is-partial':''}" role="listitem" tabindex="0" aria-label="${e(label)}"><div class="usage-bar-track"><span class="usage-bar" style="height:${value/scale*100}%"></span>${unknown?'<span class="usage-unknown-mark" aria-hidden="true">◇</span>':''}</div><span class="usage-day-label" aria-hidden="true">${daily.length<=8||index%5===0||index===daily.length-1?e(shortDate(row.date)):'&nbsp;'}</span><span class="usage-tooltip">${e(label)}</span></div>`;
  }).join('')}</div></div><div class="usage-chart-foot"><span><i></i>${metric==='knownCost'?'已知费用':metric==='totalTokens'?'已知 Token':'调用次数'}</span>${partial?'<span>◇ 含未知记录</span>':''}</div>`;
}

export function usageModels(report, metric='calls', expanded=false) {
  const key=metric==='totalTokens'?'totalTokens':'calls';
  const all=rows(report.models).slice().sort((a,b)=>(b[key]||0)-(a[key]||0));
  if (!all.length) return empty('有调用后，模型与服务分布会显示在这里。');
  const total=all.reduce((sum,row)=>sum+(valid(row[key])?row[key]:0),0);
  const shown=expanded?all:all.slice(0,6);
  return `<div class="usage-model-list">${shown.map(row=>{
    const value=valid(row[key])?row[key]:0,share=total?value/total*100:0;
    return `<div class="usage-model-row"><div><span class="usage-model-name">${e(row.model||names[row.capability]||'其他服务')}</span><span class="usage-model-value">${count(value)}${key==='calls'?' 次':''}${key==='totalTokens'&&row.unknownTokenCalls?' + 未知':''}</span></div><div class="usage-model-track" aria-hidden="true"><span style="width:${share}%"></span></div><div class="usage-model-meta"><span>${row.model?e(names[row.capability]||'其他服务'):e(key==='calls'?'调用占比':'已知 Token 占比')} · ${usageNumber(Math.round(share*10)/10)}%</span><span>费用 ${e(usageCost(row))}</span></div></div>`;
  }).join('')}</div>${all.length>6?`<button type="button" class="text-button" data-usage-model-more>${expanded?'收起':`展开其余 ${all.length-6} 项`}</button>`:''}`;
}

export function usageTokens(report) {
  const t=report.totals||{},input=valid(t.inputTokens)?t.inputTokens:0,output=valid(t.outputTokens)?t.outputTokens:0,total=input+output;
  return `<div class="usage-token-total"><strong>${count(t.totalTokens)}</strong><span>已知 Token</span></div><div class="usage-token-bar" aria-hidden="true"><span style="width:${total?input/total*100:0}%"></span><span style="width:${total?output/total*100:0}%"></span></div><dl class="usage-token-list"><div><dt><i></i>输入</dt><dd>${count(t.inputTokens)}</dd></div><div><dt><i></i>输出</dt><dd>${count(t.outputTokens)}</dd></div><div><dt>缓存命中</dt><dd>${count(t.cachedInputTokens)}${t.unknownCacheCalls?' + 未知':''}</dd></div></dl><p class="form-note">缓存命中已包含在输入中。${t.unknownTokenCalls?`${count(t.unknownTokenCalls)} 次用量不完整。`:''}</p>`;
}

export function usageRecent(report, page=0) {
  const all=rows(report.recentCalls),pages=Math.max(1,Math.ceil(all.length/10));
  const current=Math.max(0,Math.min(pages-1,Math.trunc(page)||0));
  if (!all.length) return empty('当前筛选下没有调用明细。');
  const formatter=new Intl.DateTimeFormat('zh-CN',{timeZone:report.timezone,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  return table(['时间','用途 / 模型','输入 / 输出','费用','传输状态'],all.slice(current*10,current*10+10).map(row=>{
    const date=new Date(row.createdAt),token=['model','embedding'].includes(row.capability);
    return [`<time datetime="${e(row.createdAt)}" title="${e(row.createdAt)}">${Number.isFinite(date.getTime())?e(formatter.format(date)):'未知'}</time>`,`<strong>${e(row.purposeLabel||'历史用途未记录')}</strong><small>${e(row.model||names[row.capability]||'其他服务')}</small>`,token?`${count(row.inputTokens)} / ${count(row.outputTokens)}`:'—',e(usageAmount(row.cost)),`<span class="usage-status${row.ok===false?' is-failed':''}">${row.ok===true?'HTTP 成功':row.ok===false?'传输失败':'未知'}</span>`];
  }),'近期调用明细')+`<div class="usage-pager"><span>${current+1} / ${pages} · 共 ${all.length} 条</span><div><button type="button" class="text-button" data-usage-page="${current-1}" ${current===0?'disabled':''}>上一页</button><button type="button" class="text-button" data-usage-page="${current+1}" ${current===pages-1?'disabled':''}>下一页</button></div></div>`;
}

export function usageCSV(report) {
  const fields=[['createdAt','时间'],['model','模型'],['purposeLabel','用途'],['inputTokens','输入'],['outputTokens','输出'],['cost','费用']];
  const cell=v=>'"'+String(v??'未知').replace(/^[=+\-@]/,"'$&").replaceAll('"','""')+'"';
  return '\uFEFF'+[fields.map(([,label])=>cell(label)).join(','),...rows(report.recentCalls).map(row=>fields.map(([key])=>cell(row[key])).join(','))].join('\r\n');
}

export async function createUsagePage(ctx,nav) {
  const {api,state,submit,watchForm,savedForm}=ctx;
  let [report,s]=await Promise.all([api.get('/api/usage?period=month'),api.get('/api/settings')]);
  let trend='totalTokens',modelMetric='calls',modelExpanded=false,request=0;
  const price=(group,key,label)=>field(label,`${group}.${key}`,{type:'number',value:s[group]?.[key]??'',placeholder:'未知',extra:'min="0" step="any"'});
  const switches=(type,choices,active)=>`<div class="usage-switch" role="group" aria-label="${type==='trend'?'趋势指标':'模型分布指标'}">${choices.map(([key,label])=>`<button type="button" data-usage-${type}="${key}" aria-pressed="${key===active}">${label}</button>`).join('')}</div>`;
  return {html:heading('KNOW THE COST','看清工具用了多少。','缺失的用量与价格保留未知。',routeButton('回到设置','settings','text-button'))+nav()+`<link rel="stylesheet" href="/web/usage-dashboard.css"><div class="usage-dashboard"><form id="usage-filter" class="usage-filter"><div class="usage-filter-top"><fieldset class="usage-period"><legend class="sr-only">时间范围</legend>${periods.map(([value,label])=>`<label><input type="radio" name="period" value="${value}" ${value==='month'?'checked':''}><span>${label}</span></label>`).join('')}</fieldset></div><div class="usage-filter-fields">${select('调用能力','capability',[['','全部能力'],...Object.entries(names)])}${select('模型','model',[['','全部模型'],...rows(report.availableModels).map(x=>[x,x])])}${select('用途','purpose',[['','全部用途'],...rows(report.availablePurposes)])}<button class="secondary" type="submit">更新统计</button></div><p id="usage-filter-status" class="form-note" role="status" hidden></p></form><section id="usage-summary">${usageSummary(report)}</section><section class="usage-panel"><div class="usage-panel-heading"><h2>使用趋势</h2>${switches('trend',Object.entries(metrics),trend)}</div><div id="usage-trend">${usageTrend(report,trend)}</div><details class="usage-detail"><summary>每日明细</summary><div id="usage-daily"></div></details></section><div class="usage-breakdown"><section class="usage-panel"><div class="usage-panel-heading"><h2>模型与服务</h2>${switches('model',[['calls','调用'],['totalTokens','Token']],modelMetric)}</div><div id="usage-models">${usageModels(report)}</div></section><section class="usage-panel"><div class="usage-panel-heading"><h2>Token 构成</h2></div><div id="usage-tokens">${usageTokens(report)}</div><details class="usage-detail"><summary>完整统计</summary><div id="usage-facts"></div></details></section></div><section class="usage-panel"><div class="usage-panel-heading"><h2>近期调用明细</h2><button type="button" class="text-button" data-action="export-usage">导出 CSV ↗</button></div><p class="form-note" id="usage-detail-scope"></p><div id="usage-calls">${usageRecent(report)}</div></section><details class="usage-panel usage-pricing"><summary>价格与预算</summary><form id="pricing"><div class="form-grid">${field('每日调用上限','dailyCallLimit',{type:'number',value:s.ai.dailyCallLimit,extra:'min="0" required'})}${field('每月预算（0 表示不限）','monthlyBudget',{type:'number',value:s.ai.monthlyBudget,extra:'min="0" step="any" required'})}${price('ai','inputPrice','文本输入 / 百万 Token')}${price('ai','outputPrice','文本输出 / 百万 Token')}${price('ai','cachedInputPrice','缓存输入 / 百万 Token')}${price('embedding','inputPrice','嵌入 / 百万 Token')}${price('search','requestPrice','每次搜索')}</div><p class="form-note">单价使用同一货币单位；留空表示未知。新单价仅影响后续调用。</p><button class="primary" type="submit">保存价格与预算</button></form></details></div>`,bind(){
    const root=$('.usage-dashboard'),filter=$('#usage-filter'),status=$('#usage-filter-status');
    const renderDetails=()=>{
      if(root.querySelector('.usage-detail').open)$('#usage-daily').innerHTML=table(['日期','调用','已知 Token','费用'],rows(report.daily).map(row=>[e(row.date),count(row.calls),e(metricValue(row,'totalTokens')),e(usageCost(row))]),'每日用量明细');
      if($('#usage-facts').parentElement.open)$('#usage-facts').innerHTML=facts([['已知费用',usageAmount(report.totals?.knownCost)],['费用未知调用',usageNumber(report.totals?.unknownCostCalls)],['Token 未知调用',usageNumber(report.totals?.unknownTokenCalls)],['未结算调用',usageNumber(report.totals?.pendingCalls)],['结果未明确调用',usageNumber(report.totals?.unknownResultCalls)],['无效日期记录',usageNumber(report.invalidDateCalls)]]);
    };
    const render=()=>{
      $('#usage-summary').innerHTML=usageSummary(report);$('#usage-trend').innerHTML=usageTrend(report,trend);$('#usage-models').innerHTML=usageModels(report,modelMetric,modelExpanded);$('#usage-tokens').innerHTML=usageTokens(report);$('#usage-calls').innerHTML=usageRecent(report);
      $('#usage-detail-scope').textContent=`最近 ${report.recentLimit||100} 条，每页 10 条；汇总覆盖完整范围。时间按 ${report.timezone} 显示。HTTP 成功不代表内容校验成功。`;
      renderDetails();
    };
    root.querySelectorAll('.usage-detail').forEach(d=>d.addEventListener('toggle',renderDetails));
    root.addEventListener('click',event=>{
      const control=event.target.closest('button');if(!control)return;
      if(control.dataset.usageTrend){trend=control.dataset.usageTrend;$('#usage-trend').innerHTML=usageTrend(report,trend);root.querySelectorAll('[data-usage-trend]').forEach(b=>b.setAttribute('aria-pressed',String(b===control)));}
      if(control.dataset.usageModel){modelMetric=control.dataset.usageModel;$('#usage-models').innerHTML=usageModels(report,modelMetric,modelExpanded);root.querySelectorAll('[data-usage-model]').forEach(b=>b.setAttribute('aria-pressed',String(b===control)));}
      if(control.hasAttribute('data-usage-model-more')){modelExpanded=!modelExpanded;$('#usage-models').innerHTML=usageModels(report,modelMetric,modelExpanded);$('#usage-models [data-usage-model-more]')?.focus({preventScroll:true});}
      if(control.hasAttribute('data-usage-page')){const direction=Number(control.dataset.usagePage);$('#usage-calls').innerHTML=usageRecent(report,direction);$('#usage-calls').querySelector(`[data-usage-page="${direction+1}"]:not(:disabled),[data-usage-page="${direction-1}"]:not(:disabled)`)?.focus({preventScroll:true});}
    });
    filter.addEventListener('change',event=>{if(event.target.name==='period')filter.requestSubmit();});
    submit(filter,async values=>{
      const revision=++request,route=state.sequence;status.hidden=false;status.textContent='正在更新统计…';
      try{const result=await api.get('/api/usage?'+new URLSearchParams(values));if(revision!==request||route!==state.sequence)return;report=result;modelExpanded=false;render();status.hidden=true;
        const model=filter.elements.model,selected=model.value;model.innerHTML=[['','全部模型'],...rows(report.availableModels).map(x=>[x,x]),...(selected&&!rows(report.availableModels).includes(selected)?[[selected,selected]]:[])].map(([value,label])=>`<option value="${e(value)}">${e(label)}</option>`).join('');model.value=selected;
      }catch(error){if(revision===request&&route===state.sequence){status.textContent=`统计未更新，仍显示上次结果。${error.message === 'Failed to fetch' ? '连接未完成。' : error.message} 请点击“更新统计”重试。`;}}
    });
    $('[data-action="export-usage"]').onclick=()=>{const url=URL.createObjectURL(new Blob([usageCSV(report)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='知序-当前调用明细.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    const form=$('#pricing');watchForm(form);submit(form,async values=>{
      const payload={pricingFor:Object.fromEntries(['ai','embedding','search'].map(k=>[k,{baseUrl:s[k].baseUrl,model:s[k].model||''}])),ai:{dailyCallLimit:Number(values.dailyCallLimit),monthlyBudget:Number(values.monthlyBudget)},embedding:{},search:{}};
      for(const [key,value] of Object.entries(values))if(key.includes('.')){const [g,k]=key.split('.');payload[g][k]=value===''?null:Number(value);}
      await api.put('/api/usage/settings',payload);savedForm(form);notify('预算与当前模型价格已保存。');
    });render();
  }};
}
