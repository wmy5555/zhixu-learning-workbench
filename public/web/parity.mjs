import { createLibraryPreferences } from './library-preferences.mjs';
import { escape as e, markdown, safeLink } from './markdown.mjs';
import { $, $$, icon, button as btn, routeButton as link, field, area, heading, kind, stage, jobState, modal, confirm, busy, notify } from './ui.mjs';
import { endpoint } from './api.mjs';

export const list = value => Array.isArray(value) ? value : [];
export const select = (label, name, options, value = '') => `<label class="field"><span>${e(label)}</span><select name="${name}">${options.map(([id,text])=>`<option value="${e(id)}" ${String(value)===String(id)?'selected':''}>${e(text)}</option>`).join('')}</select></label>`;
export const types = [['','全部类别'],['source','原始资料'],['knowledge','知识'],['topic','主题学习包'],['report','AI 整理建议'],['mistake','错题']];
export const stages = [['','全部学习状态'],...['reference','candidate','learning','integrated','core','retired'].map(v=>[v,stage(v)])];
export const details = (title, body, open = false) => `<details class="quiet-details" ${open?'open':''}><summary>${e(title)}</summary><div class="disclosure-body">${body}</div></details>`;
export const readable = value => value == null ? '未记录' : typeof value === 'object' ? JSON.stringify(value,null,2) : String(value);
export const facts = pairs => `<dl class="parity-facts">${pairs.filter(([,v])=>v!==undefined&&v!==null&&v!=='').map(([k,v])=>`<div><dt>${e(k)}</dt><dd>${e(readable(v))}</dd></div>`).join('')}</dl>`;
export function evidenceHTML(items, limitations = []) {
  return list(limitations).map(v=>`<p class="notice">${e(v)}</p>`).join('') + (list(items).map(item=>{
    const id=item.sourceId||item.noteId||item.id,url=safeLink(item.url);
    return `<section class="evidence-entry"><h3>${e(item.title||'出处')}</h3><div class="preserve-text">${e(item.excerpt||'尚无摘录')}</div>${facts([['定位',item.locator],['角色',item.role],['理由',item.rationale],['读取时间',item.fetchedAt],['核验时间',item.researchedAt]])}<div class="actions">${id?link('阅读保存的原文 ↗',`read/${id}`,'text-button'):''}${url?`<a class="text-button" href="${e(url)}" target="_blank" rel="noopener noreferrer">外部原文 ↗</a>`:''}</div>${list(item.sources).length?details('底层来源',evidenceHTML(item.sources)):''}</section>`;
  }).join('')||'<p class="notice">没有可追溯引用；这份内容不能视为有据回答。</p>');
}
export function feedbackHTML(feedback) {
  if(!feedback)return '';
  const labels={correct:'回答正确',partial:'仍有遗漏',incorrect:'需要修正',ambiguous:'存在不确定性'};
  return `<div class="learning-feedback"><p class="nav-label">AI 反馈 · 供你判断</p>${facts([['评估',labels[feedback.assessment]||feedback.assessment]])}${[['反馈',feedback.feedback],['遗漏',feedback.omission],['修正与依据',feedback.correction],['下一问',feedback.nextQuestion],['建议',feedback.suggestion]].filter(([,v])=>v).map(([k,v])=>`<section><h3>${k}</h3><div class="article-prose">${markdown(readable(v)).html}</div></section>`).join('')}</div>`;
}
export function completionHTML(completion) {
  if(!completion)return '';
  const d=completion.evidence||{},yes=value=>value===true?'是':value===false?'否':'未记录';
  return details('本次完成的证据',facts([['记录时间',d.completedAt],['独立作答',yes(d.independent)],['使用提示',yes(d.usedHints)],['观察到错误',yes(d.errorObserved)],['存在争议',yes(d.ambiguous)],['复习已结算',yes(completion.reviewSettled)],['复习间隔',completion.interval==null?'未更新':`${completion.interval} 天`],['跨日回忆',yes(d.spacedRecall)],['解释练习',yes(d.explanationPractice)],['应用练习',yes(d.applicationPractice)],['学习深度',d.depth],['依据轮次',list(d.turnIds).join('、')]]));
}
export function paginate(host, rows, render, {size=20,filter=()=>true}={}) {
  let page=0;
  const draw=()=>{
    const visible=rows.filter(filter),pages=Math.max(1,Math.ceil(visible.length/size));page=Math.min(page,pages-1);
    host.innerHTML=`<div>${visible.slice(page*size,(page+1)*size).map(render).join('')||'<p class="empty">没有符合条件的记录。</p>'}</div><div class="parity-pagination"><button type="button" class="text-button" data-page="previous" ${page?'':'disabled'}>上一页</button><span>${page+1} / ${pages} · 共 ${visible.length} 条</span><button type="button" class="text-button" data-page="next" ${page+1<pages?'':'disabled'}>下一页</button></div>`;
    host.querySelector('[data-page="previous"]').onclick=()=>{page--;draw();};host.querySelector('[data-page="next"]').onclick=()=>{page++;draw();};
  };draw();return ()=>{page=0;draw();};
}
export function createParity(ctx) {
  const {api,state,go,refreshBoot,formModal,submit,watchForm}=ctx;
  const topicIntents=new Map();
  const libraryPreferences=createLibraryPreferences();
  const title=id=>list(state.boot?.notes).find(n=>n.id===id)?.title||id;
  const refresh=async()=>{await refreshBoot();if(!state.dirty)await go(state.route,{force:true,replace:true});};
  const cards=notes=>notes.map(n=>`<article class="knowledge-row"><div><h3>${e(n.title)}</h3><p>${e(kind(n.kind))} · ${e(stage(n.meta?.stage))}</p></div>${link('阅读 ↗',`read/${n.id}`,'text-button')}</article>`).join('');
  async function relations() {
    const [data,suggestions]=await Promise.all([api.get('/api/relations'),api.get('/api/recommendations')]);
    return {html:heading('MAKE A CONNECTION','让想法彼此照亮。','联系与整理都是建议，由你决定是否采用。',link('回到检索','search','text-button'))+
      `<div class="actions">${btn('发现本地联系','discover-local','secondary')}${btn('用 AI 发现联系','discover-ai','text-button')}</div><section class="recent"><h2>知识之间的联系</h2><p class="form-note">尚有 ${Number(data.deferredCount)||0} 条建议待逐批审阅。</p>${[...list(data.relations),...list(data.candidates)].map(r=>`<article class="parity-card"><h3>${e(title(r.fromId))} → ${e(title(r.toId))}</h3>${facts([['类型',r.type],['关系',r.label||r.explanation],['用途',r.use||r.useCase||r.purpose],['边界',r.boundary||r.boundaries||r.condition],['理由',r.reason||r.rationale],['状态',r.state]])}${details('完整关系信息',`<pre class="parity-json">${e(JSON.stringify(r,null,2))}</pre>`)}<div class="actions">${r.state==='accepted'?btn('移除关系','relation-action','text-button',`data-id="${e(r.id)}" data-value="remove"`):btn('接受','relation-action','secondary',`data-id="${e(r.id)}" data-value="accept"`)+btn('拒绝','relation-action','text-button',`data-id="${e(r.id)}" data-value="reject"`)}</div></article>`).join('')||'<p class="empty">还没有待审阅的联系。</p>'}</section>${suggestionHTML(suggestions)}${details('AI 整理报告',cards(list(data.reports)))}`};
  }
  function suggestionHTML(data) {
    return `<section class="recent"><h2>知识使用建议</h2><p class="form-note">${e(data.summary||'')}</p>${list(data.suggestions).map(s=>`<article class="parity-card"><h3>${e(s.title)}</h3><p>${e(s.reason)}</p>${details('查看依据',list(s.signals).map(x=>`<p>${e(readable(x))}</p>`).join(''))}<div class="actions">${btn('处理建议','recommendation','text-button',`data-id="${e(s.id)}" data-value="accept"`)}${btn('暂不采用','recommendation','text-button',`data-id="${e(s.id)}" data-value="dismiss"`)}</div></article>`).join('')||'<p class="muted">暂时没有新的使用建议。</p>'}</section>`;
  }
  async function openTopic(id) {
    const topic=list((await api.get('/api/topics')).topics).find(t=>t.id===id);if(!topic)throw Error('学习包已删除，请刷新。');
    const progress=topic.progress||{};
    modal(topic.title,`<div class="article-prose">${markdown(topic.body.replace(/<!-- zhixu-managed-links:start -->[\s\S]*?<!-- zhixu-managed-links:end -->/g,'')).html}</div>${facts([['前置知识',list(topic.prerequisites).map(title).join('、')||'未设置'],['进度',`${progress.completedCount||0} / ${progress.total||0}`],['状态',topic.paused?'暂停':'活动'],['预计投入',`${topic.minutes||20} 分钟`]])}<p class="form-note">进度表示有结束练习或理解确认记录，不代表永久掌握。</p>${progress.blockedNoteId?`<p class="notice">下一项暂不可学习：${e(title(progress.blockedNoteId))}</p>`:''}<div class="actions">${btn('按顺序继续学习','topic-next','primary',`data-id="${e(id)}" data-note="${e(progress.nextNoteId||'')}" ${topic.paused||!progress.nextNoteId?'disabled':''}`)}${btn('编辑成员与顺序','topic-edit','text-button',`data-id="${e(id)}"`)}${btn('复制 / 拆分','topic-copy','text-button',`data-id="${e(id)}"`)}${btn(topic.paused?'恢复学习包':'暂停学习包','topic-toggle','text-button',`data-id="${e(id)}" data-value="${topic.paused?'resume':'pause'}"`)}</div><ol class="parity-members">${list(topic.members).map(m=>`<li>${link(e(m.title),`read/${m.id}`,'text-button')}<small>${m.completed?'已有学习记录':m.available?'可继续':'暂不可学'}</small></li>`).join('')}</ol>`,{wide:true});
  }
  async function editTopic(id='',copy=false) {
    const topic=id?list((await api.get('/api/topics')).topics).find(t=>t.id===id):null;
    if(id&&!topic)throw Error('学习包暂不可读。');
    const notes=list(state.boot.notes).filter(n=>n.kind==='knowledge'), selected=[...list(topic?.meta?.noteIds)];
    const original=list(topic?.meta?.prerequisites),originalText=original.join('，');
    const d=formModal(copy?'复制或拆分学习包':topic?'调整学习路径':'新建学习包',`${copy?'<p class="notice">选择保留的成员建立新包。原包与知识不变。</p>':''}${field('标题','title',{value:topic?.title||'',required:true})}${area('问题与边界','body',{value:topic?.body||'',rows:5})}<div class="form-grid">${field('前置知识（ID 或文本，逗号分隔）','prerequisites',{value:originalText})}${field('预计投入（分钟）','minutes',{type:'number',value:topic?.minutes||20,extra:'min="1" max="1440"'})}</div><h3>成员顺序</h3><div data-members></div>${select('添加知识','addMember',[['','选择知识'],...notes.map(n=>[n.id,n.title])])}${btn('加入本包','topic-add-member','text-button')}`,async(values)=>{
      const meta={noteIds:[...selected],prerequisites:values.prerequisites===originalText?original:values.prerequisites.split(/[,，]/).map(s=>s.trim()).filter(Boolean),minutes:Number(values.minutes)};
      await (topic&&!copy?api.put(endpoint('topics',id),{title:values.title,body:values.body,expectedHash:topic.hash,meta}):api.post('/api/topics',{title:values.title,body:values.body,...meta}));await refresh();notify('学习路径已保存。');
    },{wide:true});
    const host=d.querySelector('[data-members]'),form=d.querySelector('form');
    const draw=()=>{host.innerHTML=selected.map((id,i)=>`<div class="parity-member"><span>${i+1}. ${e(title(id))}</span><div>${btn('上移','member-up','text-button',`data-index="${i}" ${i===0?'disabled':''}`)}${btn('下移','member-down','text-button',`data-index="${i}" ${i===selected.length-1?'disabled':''}`)}${btn('移出','member-remove','text-button',`data-index="${i}"`)}</div></div>`).join('')||'<p class="muted">尚未选择成员。</p>';};draw();
    d.addEventListener('click',ev=>{const b=ev.target.closest('[data-action]');if(!b)return;const a=b.dataset.action,i=Number(b.dataset.index);
      if(a==='topic-add-member'){const id=form.elements.addMember.value;if(id&&!selected.includes(id))selected.push(id);}
      else if(a==='member-remove')selected.splice(i,1);
      else if(a==='member-up'&&i>0)[selected[i-1],selected[i]]=[selected[i],selected[i-1]];
      else if(a==='member-down'&&i<selected.length-1)[selected[i+1],selected[i]]=[selected[i],selected[i+1]];
      else return;form.dispatchEvent(new Event('input',{bubbles:true}));draw();
    });
  }
  async function metadata(id) {
    const note=await api.get(endpoint('notes',id)),m=note.meta||{};
    const origins=[...list(m.origins),{}],originFields=[['platform','来源平台'],['author','作者'],['url','原文链接'],['date','资料日期'],['locator','定位']];
    const originForm=origins.map((o,i)=>`<section class="parity-card"><h3>${i===origins.length-1?'补充一份出处（可选）':`出处 ${i+1}`}</h3><div class="form-grid">${originFields.map(([key,label])=>field(label,`origin.${i}.${key}`,{value:o[key]||'',type:key==='url'?'url':key==='date'&&(!o[key]||/^\d{4}-\d{2}-\d{2}$/.test(o[key]))?'date':'text'})).join('')}</div>${facts([['取得时间',o.acquiredAt]])}</section>`).join('');
    formModal('资料的出处与边界',`<div class="form-grid">${field('主题','topic',{value:m.topic||''})}${field('作者','author',{value:m.author||''})}${field('来源平台','platform',{value:m.platform||''})}${field('原始链接','url',{value:m.url||'',type:'url'})}${field('资料日期','date',{value:m.date||'',type:m.date&&!/^\d{4}-\d{2}-\d{2}$/.test(m.date)?'text':'date'})}${field('原文定位','locator',{value:m.locator||''})}${field('核验有效天数','researchIntervalDays',{value:m.researchIntervalDays||30,type:'number',extra:'min="1" max="365"'})}</div>${facts([['取得时间',m.acquiredAt],['核验时间',m.researchedAt],['下次核验',m.reviewAfter],['历史隐私标记',m.privacy||'未记录']])}<p class="form-note">当前后端按每次主动操作授权外发，历史隐私标记只读。此处不会更改权限或触发核验。</p>${details('逐条编辑与补充出处',originForm)}${details('关联来源记录',`<pre class="parity-json">${e(JSON.stringify(m.sources||[],null,2))}</pre>`)}`,async values=>{
      const meta=Object.fromEntries(Object.entries(values).filter(([key])=>!key.startsWith('origin.')));
      meta.researchIntervalDays=Number(values.researchIntervalDays);
      meta.origins=origins.flatMap((o,i)=>{const updated=Object.fromEntries(originFields.map(([key])=>[key,values[`origin.${i}.${key}`]||'']));return i<origins.length-1||Object.values(updated).some(Boolean)?[{...o,...updated,acquiredAt:o.acquiredAt||new Date().toISOString()}]:[];});
      await api.put(endpoint('notes',id),{expectedHash:note.hash,meta});await refresh();notify('出处信息已保存。');
    },{wide:true});
  }
  async function versions(id) {
    const [note,data]=await Promise.all([api.get(endpoint('notes',id)),api.get(endpoint('history',id))]);
    const d=modal('查看与恢复历史版本',`<p class="form-note">恢复前核对当前版本，恢复会保留被覆盖的内容。</p><div data-versions></div>`,{wide:true});
    paginate(d.querySelector('[data-versions]'),list(data.versions),v=>`<article class="parity-card"><h3>${e(v.createdAt)}</h3><p>${e(v.reason||'')}</p>${details('查看版本正文',`<pre class="preserve-text">${e(v.raw||v.body||'')}</pre>`)}${btn('恢复此版本','version-restore','secondary',`data-id="${e(id)}" data-version="${e(v.versionId)}" data-hash="${e(note.hash)}"`)}</article>`);
  }
  async function merge(id,other='') {
    const notes=list(state.boot.notes).filter(n=>n.kind==='knowledge'&&n.id!==id);
    const d=modal('合并前，保留两份观点',`<form data-merge>${select('合并另一条知识','mergeId',notes.map(n=>[n.id,n.title]),other)}<button class="primary" type="submit" ${notes.length?'':'disabled'}>生成合并预览</button></form><div data-preview></div>`,{wide:true});
    submit(d.querySelector('form'),async values=>{
      const p=await api.post('/api/notes/merge',{keepId:id,mergeId:values.mergeId,preview:true});
      const host=d.querySelector('[data-preview]');host.innerHTML=`<p class="notice">${e(p.warning)}</p>${details('当前正文',`<div class="article-prose">${markdown(p.before).html}</div>`)}<h3>合并后</h3><div class="article-prose">${markdown(p.after).html}</div>${btn('确认合并','confirm-merge','primary')}`;
      host.querySelector('button').onclick=ev=>busy(ev.currentTarget,async()=>{if(!await confirm('确认采用合并结果？','另一条知识将标记为被替代，两个版本及来源保留。','确认合并'))return;await api.post('/api/notes/merge',{...p,preview:false});d.close();await refresh();});
    });
  }
  async function links(id) {
    const p=await api.get(endpoint('notes',id,'links-preview'));
    const d=modal('Obsidian 链接更新预览',`${p.conflict?`<p class="notice">${e(readable(p.conflict))}</p>`:''}<pre class="parity-json">${e(JSON.stringify(p,null,2))}</pre>${btn('确认更新托管链接','confirm-links','primary',p.conflict||!p.changed?'disabled':'')}`,{wide:true});
    d.querySelector('[data-action="confirm-links"]').onclick=ev=>busy(ev.currentTarget,async()=>{await api.post(endpoint('notes',id,'links-sync'),{expectedHash:p.expectedHash});d.close();await refresh();notify('托管链接已更新。');});
  }
  async function library() {
    const preferences=libraryPreferences.read();
    const data=await api.get('/api/library'),recs=await api.get('/api/recommendations');
    const notes=[...new Map([...list(data.groups).flatMap(g=>[g.source,...list(g.children)]),...list(data.standalone)].map(n=>[n.id,n])).values()].sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
    return {html:heading('YOUR GROWING LIBRARY','让每一个想法，有处可寻。',`${notes.filter(n=>n.kind==='source').length} 份原文 · ${notes.filter(n=>n.kind==='knowledge').length} 条知识，慢慢长成自己的理解。`,link(`${icon('plus')} 收集资料`,'capture','primary'))+`<div class="library-toolbar"><div class="segmented" aria-label="内容类型">${[['','全部'],['source','原始资料'],['knowledge','知识'],['mistake','错题']].map(([value,label])=>btn(label,'library-filter','',`data-kind="${value}" aria-pressed="${value===preferences.kind}"`)).join('')}</div><label class="inline-search">${icon('search')}<input name="libraryQuery" value="${e(preferences.q)}" type="search" placeholder="在这些想法里找一找" aria-label="筛选知识库"></label></div>${details('筛选与分组',`<div class="form-grid">${select('类别','libraryKind',types,preferences.kind)}${select('学习状态','libraryStage',stages,preferences.stage)}</div><label class="check"><input type="checkbox" name="sourceGroups" ${preferences.grouped?'checked':''}> 按原文分组，展开子知识</label>`,preferences.optionsOpen).replace('<details ', '<details data-library-options ')}<div id="parity-library"></div>${details('知识使用建议',suggestionHTML(recs),preferences.adviceOpen).replace('<details ', '<details data-library-advice ')}`,
      bind(){const host=$('#parity-library'),groups=list(data.groups),standalone=list(data.standalone);
        const draw=()=>{libraryPreferences.update({q:$('[name="libraryQuery"]').value,kind:$('[name="libraryKind"]').value,stage:$('[name="libraryStage"]').value,grouped:$('[name="sourceGroups"]').checked});const q=$('[name="libraryQuery"]').value.trim().toLowerCase(),k=$('[name="libraryKind"]').value,s=$('[name="libraryStage"]').value;
          const matches=n=>(!k||n.kind===k)&&(!s||n.meta?.stage===s)&&(!q||`${n.title} ${n.body} ${n.meta?.topic}`.toLowerCase().includes(q));
          $$('[data-action="library-filter"]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.kind===k)));
          const grid=items=>`<div class="library-grid">${items.map(ctx.noteCard).join('')}</div>`;
          host.innerHTML=($('[name="sourceGroups"]').checked?groups.filter(g=>matches(g.source)||list(g.children).some(matches)).map(g=>`<section class="parity-source-group">${cards([g.source])}${details(`${list(g.children).length} 条子知识`,grid(list(g.children).filter(n=>!q&&!k&&!s||matches(n))),Boolean(q||k||s))}</section>`).join('')+grid(standalone.filter(matches)):grid(notes.filter(matches)));
          if(!host.querySelector('article'))host.innerHTML='<p class="empty">没有符合条件的资料。</p>';
        };for(const [selector,key] of [['[data-library-options]','optionsOpen'],['[data-library-advice]','adviceOpen']]){const panel=$(selector);panel.addEventListener('toggle',()=>{if(panel.isConnected)libraryPreferences.update({[key]:panel.open});});}['libraryQuery','libraryKind','libraryStage','sourceGroups'].forEach(n=>$(`[name="${n}"]`).addEventListener('input',draw));$$('[data-action="library-filter"]').forEach(b=>b.onclick=()=>{$('[name="libraryKind"]').value=b.dataset.kind;draw();});draw();}};
  }
  async function search() {
    const sources=list(state.boot.notes).filter(n=>n.kind==='source');
    return {html:heading('CONNECT THE DOTS','找回一个想法，发现新的联系。','检索结果会保留来源与实际采用的检索方式。',link('知识联系与建议 ↗','relations','text-button'))+
      `<form id="parity-search" class="search-composer"><div>${icon('search')}<input name="q" type="search" required placeholder="你在找什么？" aria-label="搜索内容"><button class="primary" type="submit">搜索 ${icon('arrow')}</button></div>${details('检索方式与筛选范围',`<div class="form-grid">${select('检索方式','mode',[['keyword','本地文字'],['semantic','纯语义'],['hybrid','语义与文字']])}${select('类别','kind',types)}${select('学习状态','stage',stages)}</div><label class="check"><input type="checkbox" name="cloud"> 允许本次查询发给已配置的语义服务（可能计费）</label><div class="form-grid">${select('来源','source',[['','全部来源'],...sources.map(n=>[n.id,n.title])])}${field('主题','topic')}${field('起始日期','from',{type:'date'})}${field('结束日期','to',{type:'date'})}</div>`)}</form><div id="parity-results"></div>`,
      bind(){const form=$('#parity-search');let revision=0,params,cursor;
        const sync=()=>{[...form.elements.mode.options].forEach(o=>o.disabled=o.value!=='keyword'&&!form.elements.cloud.checked);if(!form.elements.cloud.checked)form.elements.mode.value='keyword';};sync();form.elements.cloud.onchange=sync;
        const render=async(next=false)=>{const own=++revision,route=state.sequence;const data=await api.get('/api/search?'+new URLSearchParams({...params,...(next&&cursor?{cursor}:{})}));if(own!==revision||route!==state.sequence)return;cursor=data.nextCursor;const host=$('#parity-results');
          if(!next)host.innerHTML='';host.querySelector('[data-more]')?.remove();
          host.insertAdjacentHTML('beforeend',list(data.results).map(n=>`<article class="search-result"><h2>${link(e(n.title),`read/${n.id}`,'result-title')}</h2><p class="preserve-text">${e(n.snippet||'')}</p>${facts([['定位',n.location],['检索来源',n.via]])}${details('核验与来源',evidenceHTML(n.meta?.evidence||[],n.limitations))}</article>`).join('')||'<p class="empty">未找到相关资料。</p>');
          host.insertAdjacentHTML('beforeend',details('本次检索诊断',`<pre class="parity-json">${e(JSON.stringify(data.diagnostics,null,2))}</pre>`)+(cursor?'<button class="text-button" data-more>加载下一页</button>':''));
          if(cursor)host.querySelector('[data-more]').onclick=ev=>busy(ev.currentTarget,()=>render(true));
        };submit(form,async values=>{sync();params={...values,mode:form.elements.mode.value,privacy:form.elements.cloud.checked?'cloud':'local',limit:20};delete params.cloud;await render();});}};
  }
  async function jobs() {
    const rows=list((await api.get('/api/jobs')).jobs);
    return {html:heading('THINGS IN PROGRESS','每一步，都有迹可循。','筛选完整任务记录，重试可能产生外部调用。',btn('刷新进度','reload','secondary'))+`<div class="parity-filters">${select('状态','jobFilter',[['','全部状态'],...['queued','running','waiting','failed','done','cancelled'].map(s=>[s,jobState(s)])])}${field('查找任务','jobQuery',{type:'search'})}</div><div id="parity-jobs"></div>`,bind(){const redraw=paginate($('#parity-jobs'),rows,j=>`<article class="job-row"><span class="job-state">${e(jobState(j.state))}</span><div><h2>${e(j.type)}</h2><p>${e(j.error||j.message||'本机已保留处理记录。')}</p><small>${e(j.createdAt||'')}</small></div><div>${['queued','running','waiting'].includes(j.state)?btn('取消任务','cancel-job','text-button',`data-id="${e(j.id)}"`):''}${['failed','waiting','cancelled'].includes(j.state)?btn('重新尝试','retry-job','text-button',`data-id="${e(j.id)}"`):''}</div></article>`,{filter:j=>(!$('[name="jobFilter"]').value||j.state===$('[name="jobFilter"]').value)&&`${j.type} ${j.error||''} ${j.message||''}`.includes($('[name="jobQuery"]').value)});$('[name="jobFilter"]').onchange=redraw;$('[name="jobQuery"]').oninput=redraw;}};
  }
  async function history() {
    return {html:heading('A RECORD OF THINKING','把走过的思考，完整留下。','记录与评估分别保留。',link('回到学习','study','text-button'))+'<div id="full-study-history"><p role="status">正在读取学习记录…</p></div>',bind(){
      let offset=0,revision=0;const host=$('#full-study-history'),route=state.sequence;
      const read=async(next=0)=>{
        const current=++revision;
        try{
          const data=await api.get(`/api/study?offset=${next}&limit=20`);
          if(!host.isConnected||route!==state.sequence||revision!==current)return;
          offset=next;
          host.innerHTML=(list(data.sessions).map(s=>`<article class="knowledge-row"><div><h3>${e(title(s.noteId))}</h3><p>${e(jobState(s.status))} · ${list(s.turns).length} 轮 · ${e(s.createdAt||'')}</p></div>${link('继续阅读',`study/${s.id}`,'text-button')}</article>`).join('')||'<p class="muted">还没有学习记录。</p>')+`<div class="parity-pagination">${btn('上一页','history-prev','text-button',offset?'':'disabled')}<span>共 ${data.total} 条</span>${btn('下一页','history-next','text-button',offset+20<data.total?'':'disabled')}</div>`;
          host.querySelector('[data-action="history-prev"]').onclick=ev=>busy(ev.currentTarget,()=>read(Math.max(0,offset-20)));
          host.querySelector('[data-action="history-next"]').onclick=ev=>busy(ev.currentTarget,()=>read(offset+20));
        }catch(error){if(!host.isConnected||route!==state.sequence||revision!==current)return;if(!host.querySelector('article'))host.innerHTML='<p class="notice">本次未读到记录，已有历史仍保留。</p>'+btn('重新读取','reload','text-button');throw error;}
      };busy(null,()=>read());
    }};
  }
  async function draft(id) {
    const draft=list((await api.get('/api/drafts')).drafts).find(d=>d.id===id);if(!draft)throw Error('草稿暂不可读。');
    const d=formModal('继续打磨这份表达',`${area('正文','body',{value:draft.body||draft.answer||'',rows:12,required:true})}<h3>实际采用的知识</h3>${list(draft.citations).map(c=>`<label class="check"><input type="checkbox" name="usedId" value="${e(c.id||c.noteId)}" ${list(draft.usedIds).includes(c.id||c.noteId)?'checked':''}>${e(c.title||c.id)}</label>`).join('')||'<p class="notice">这份草稿没有可标记的引用。</p>'}${details('查看引用依据',evidenceHTML(draft.citations)).replace('<details ', '<details data-output-citations ')}${btn('送回收集箱','capture-draft','text-button')}`,async(values,form)=>{await api.put(endpoint('drafts',id),{body:values.body,usedIds:[...form.querySelectorAll('[name="usedId"]:checked')].map(n=>n.value)});await refresh();},{wide:true});
    d.dataset.draftId=id;
    d.querySelector('[data-action="capture-draft"]').onclick=ev=>busy(ev.currentTarget,async()=>{const body=d.querySelector('textarea').value;if(!body.trim())throw Error('请先写下内容。');if(!await confirm('作为新资料送回收集箱？','将保留这份草稿，并把当前正文作为原始资料保存。','送回收集箱'))return;await api.post(endpoint('drafts',id,'capture'),{title:draft.title||draft.question,body});d.close();await refresh();notify('已送回收集箱。');});
  }
  async function handle(control) {
    const a=control.dataset.action,id=control.dataset.id,v=control.dataset.value;
    if(a==='deleted-notes'){
      const data=await api.get('/api/deleted-notes');
      const d=modal('恢复已移除知识','<p class="form-note">仅列出仍有历史版本的知识。原始资料请使用回收站；此处没有永久删除操作。</p><div data-deleted></div>',{wide:true});
      paginate(d.querySelector('[data-deleted]'),list(data.items),n=>`<article class="parity-card"><h3>${e(n.title)}</h3><p>${e(n.deletedAt)}</p>${btn('核对历史版本','deleted-history','text-button',`data-id="${e(n.id)}"`)}</article>`);
    }
    else if(a==='deleted-history'){
      control.closest('dialog')?.close();
      const data=await api.get(endpoint('history',id));
      const d=modal('核对已移除知识的版本','<div data-deleted-versions></div>',{wide:true});
      paginate(d.querySelector('[data-deleted-versions]'),list(data.versions),n=>`<article class="parity-card"><p>${e(n.createdAt)}</p>${details('版本正文',`<pre class="preserve-text">${e(n.raw)}</pre>`)}${btn('恢复这个版本','version-restore','secondary',`data-id="${e(id)}" data-version="${e(n.versionId)}"`)}</article>`);
    }
    else if(a==='topic-edit'||a==='topic-copy'){control.closest('dialog')?.close();await editTopic(id,a==='topic-copy');}
    else if(a==='topic-next'){const key=`${id}:${control.dataset.note}`,requestId=topicIntents.get(key)||crypto.randomUUID();topicIntents.set(key,requestId);const s=await api.post('/api/study/start',{noteId:control.dataset.note,topicId:id,requestId});topicIntents.delete(key);control.closest('dialog')?.close();await go(`study/${s.id}`);}
    else if(a==='topic-toggle'){await api.post(endpoint('topics',id,'action'),{action:v});control.closest('dialog')?.close();await refresh();await openTopic(id);}
    else if(a==='metadata')await metadata(id);
    else if(a==='versions')await versions(id);
    else if(a==='merge')await merge(id);
    else if(a==='links')await links(id);
    else if(a==='version-restore'){if(!await confirm('恢复这个版本？','保留当前版本，并核对内容是否发生变化。','恢复版本'))return true;await api.post(endpoint('history',id,'restore'),{versionId:control.dataset.version,expectedHash:control.dataset.hash});control.closest('dialog')?.close();await refresh();}
    else if(a==='delete-knowledge'){const note=await api.get(endpoint('notes',id));if(!await confirm('移除当前知识？','当前文件与检索内容会移除，历史版本仍保留。原始资料不会删除，可从历史版本恢复。','移除知识'))return true;await api.remove(endpoint('notes',id),{expectedHash:note.hash});control.closest('dialog')?.close();await refreshBoot();await go('library');}
    else if(a==='discover-local'||a==='discover-ai'){if(a==='discover-ai'&&!await confirm('用 AI 发现联系？','将发送所需资料给已配置的服务，可能计费。','开始发现'))return true;await api.post('/api/discover',{useAI:a==='discover-ai'});notify('发现任务已排队。');}
    else if(a==='relation-action'){await api.post(endpoint('relations',id,'action'),{action:v});await refresh();}
    else if(a==='recommendation'){const result=await api.post(endpoint('recommendations',id,'action'),{action:v});if(result.keepId)await merge(result.keepId,result.mergeId);else if(result.requiresResearch)await ctx.processSource(result.sourceId);else await refresh();}
    else if(a==='cancel-job'){if(await confirm('取消这项任务？','已保存的资料与结果会保留；已经发出的请求不能保证撤回。','取消任务')){await api.post(endpoint('jobs',id,'action'),{action:'cancel'});await refresh();}}
    else if(a==='plan-more'){modal('调整这一项安排',`<div class="actions">${btn('今日跳过','plan-action','secondary',`data-id="${e(id)}" data-value="skip"`)}${btn('暂停这条知识','plan-action','text-button',`data-id="${e(id)}" data-value="pause"`)}</div>`);}
    else if(a==='plan-action'){await api.post(endpoint('today',id,'action'),{action:v});control.closest('dialog')?.close();await refresh();}
    else if(a==='resume-note'){const paused=list(state.boot.today?.items).find(p=>p.noteId===id&&p.state==='pause');if(paused)await api.post(endpoint('today',paused.id,'action'),{action:'resume'});else{const s=await api.get('/api/settings');await api.put('/api/settings',{pausedIds:list(s.pausedIds).filter(n=>n!==id)});}await refresh();}
    else return false;return true;
  }
  return {relations,openTopic,editTopic,metadata,versions,merge,links,library,search,jobs,history,draft,handle};
}
