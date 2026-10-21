import { installInputModality } from './input-modality.mjs';
import { api, endpoint, pendingPlan, capturePayload } from './api.mjs';
import { escape as e, markdown } from './markdown.mjs';
import { $, $$, icon, button as btn, routeButton as link, field, area, empty, heading, kind, stage, jobState, calendar, notify, modal, confirm, busy } from './ui.mjs';
import { reader } from './reader.mjs';
import { learningReadiness, learningHelp, readerMenu, credibilityNotice } from './reader-actions.mjs';
import { processOutcome } from './process-outcome.mjs';
import { relatedReadingNotes } from './reading-content.mjs';
import { springEnter } from './cds/motion-bridge.mjs';
import { mountNoteEditor, noteEditSession } from './note-editor.mjs';
import { createParity, feedbackHTML, completionHTML, evidenceHTML, paginate, details } from './parity.mjs';
import { createManagement, initializeAccent } from './management.mjs';
import { createFocus } from './focus.mjs';
import { aidUsed, markAid, clearAid } from './study-aid.mjs';
import { batchImport } from './batch-import.mjs';

installInputModality(document.documentElement, document);

const navigation = [['home','今日','today'],['plus','收集与加工','capture'],['book','知识库','library'],['check','学习与错题','study'],['layers','主题学习包','topics'],['network','检索与发现','search'],['chat','问答与输出','output']];
const state = { boot:null, route:'today', sequence:0, dirty:false, saving:0, readerReturn:'library', note:null, session:null, jobs:[], scroll:new Map() };
const context={api,state,go,refreshBoot,formModal,submit,watchForm,savedForm,processSource,noteCard:note=>noteCard(note)};
const parity=createParity(context),management=createManagement(context,initializeAccent()),focus=createFocus(context);
const list = value => Array.isArray(value) ? value : [];
const formData = form => Object.fromEntries(new FormData(form));
const noteTitle = id => list(state.boot?.notes).find(note=>note.id===id)?.title || '继续上次的学习';
const noteCard = note => `<article class="library-note"><div class="note-kind">${icon(note.kind==='source'?'file':'book')}<span>${e(kind(note.kind))}</span><small>${e(stage(note.meta?.stage))}</small></div><h2>${e(note.title)}</h2><p>${e(String(note.body||'').replace(/<!-- zhixu-managed-links:start -->[\s\S]*?<!-- zhixu-managed-links:end -->/g,'').replace(/<!--[\s\S]*?-->/g,'').replace(/[#>*`]/g,'').replace(/\s+/g,' ').slice(0,135))}</p><footer><span>${e(note.meta?.topic || '未归入主题')}</span>${link('打开阅读 ↗',`read/${note.id}`,'text-button')}</footer></article>`;
const noteRows = notes => notes.map((note,index)=>`<article class="knowledge-row"><span class="task-index">${String(index+1).padStart(2,'0')}</span><div><h3>${e(note.title)}</h3><p>${e(kind(note.kind))} · ${e(stage(note.meta?.stage))}</p></div>${link('阅读 ↗',`read/${note.id}`,'text-button')}</article>`).join('');
function shell() {
  const view = state.route.split('/')[0], pending = pendingPlan(state.boot?.today).items.length;
  const topics = [...new Set(list(state.boot?.notes).map(note=>note.meta?.topic).filter(Boolean))].slice(0,5);
  $('#sidebar').innerHTML = `<a class="logo" href="#today">${icon('leaf')}<span class="wordmark">知序<small>ZHIXU</small></span></a>${link(`${icon('search')}<span>搜索你的知识</span><kbd>Ctrl K</kbd>`,'search','search-button')}${link(`${icon('plus')}收集新内容`,'capture','capture-button')}<p class="nav-label">工作台</p><nav class="nav-list" aria-label="工作台">${navigation.map(([symbol,label,route])=>btn(`${icon(symbol)}<span>${label}</span>${route==='today'&&pending?`<span class="count">${pending}</span>`:''}`,'navigate','',`data-route="${route}" ${view===route?'aria-current="page"':''}`)).join('')}</nav>${topics.length?`<section class="topics"><div class="nav-label">我的主题</div>${topics.map(topic=>btn(`<span class="dot clay"></span>${e(topic)}`,'topic-search','',`data-topic="${e(topic)}"`)).join('')}</section>`:''}<div class="sidebar-bottom"><p class="sidebar-note">让思考，有迹可循。</p>${link(`${icon('settings')}系统设置`,'settings')}<div class="profile"><span class="avatar">知</span><div>我的知识空间<small>本地保存 · 自己的节奏</small></div></div></div>`;
  $('#page-name').textContent = navigation.find(item=>item[2]===view)?.[1] || ({focus:'学习时长',relations:'知识联系',history:'完整学习历史',manage:'设置与管理',settings:'系统设置',jobs:'处理动态',edit:'编辑资料',read:'我的书桌'}[view]) || '知序';
  const theme = $('#theme'), dark = document.documentElement.classList.contains('dark');
  if (!theme.firstElementChild) theme.innerHTML = `<span class="theme-icon theme-sun" aria-hidden="true">${icon('sun')}</span><span class="theme-icon theme-moon" aria-hidden="true">${icon('moon')}</span>`;
  theme.setAttribute('aria-pressed', String(dark));
  theme.setAttribute('aria-label', dark ? '切换日间模式' : '切换夜间模式');
  theme.title = dark ? '切换日间模式' : '切换夜间模式';
}
async function refreshBoot() { state.boot = await api.get('/api/bootstrap'); return state.boot; }
async function go(route, { replace = false, force = false } = {}) {
  if(state.saving&&!force){notify('正在保存，请等这次操作返回后再切换。');return false;}
  const dialogs=$$('dialog[open]');
  if(!force)for(const dialog of [...dialogs].reverse())if(dialog.beforeClose&&!await dialog.beforeClose())return false;
  if (state.dirty && !force && !await confirm('放弃还没保存的输入？','当前输入还没有保存。取消可继续编辑，确认后会放弃这次输入。','放弃输入并离开')) return false;
  dialogs.forEach(dialog=>dialog.isConnected&&dialog.close());
  focus.capture();
  state.dirty = false;
  state.scroll.set(state.route, window.scrollY);
  if (route.startsWith('read/') && !state.route.startsWith('read/')) state.readerReturn = state.route;
  state.route = route || 'today';
  const sequence = ++state.sequence;
  document.documentElement.classList.toggle('reading-mode', state.route.startsWith('read/'));
  document.documentElement.classList.remove('nav-open');
  if (replace) history.replaceState(null,'',`#${state.route}`); else history.pushState(null,'',`#${state.route}`);
  shell();
  delete $('#main').dataset.route;
  $('#main').innerHTML = '<div class="page-loading" role="status"><span></span>正在把内容放到书桌上…</div>';
  try {
    const [view,id] = state.route.split('/');
    const page = await ({ today:todayPage, capture:capturePage, library:parity.library, read:()=>readPage(id), edit:()=>editPage(id), study:()=>studyPage(id), topics:topicsPage, search:parity.search, output:outputPage, settings:settingsPage, jobs:parity.jobs, relations:parity.relations, history:parity.history, manage:()=>management.page(id), focus:focus.page }[view] || todayPage)();
    if (sequence !== state.sequence) return false;
    $('#main').innerHTML = page.html;
    page.bind?.();
    $('#main').dataset.route=state.route;
    focus.mount();
    $('#main').focus({preventScroll:true});
    window.scrollTo({top:state.scroll.get(route)||0,behavior:'instant'});
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) springEnter($('#main'), undefined, 6, .998);
    return true;
  } catch(error) {
    if (sequence !== state.sequence) return false;
    $('#main').innerHTML = empty('这次没有顺利打开',error.message,btn('重新读取','reload','primary')+link('回到知识库','library','text-button'));
    $('#main').dataset.route=state.route;
  }
}
function watchForm(form) { const changed=()=>{form.dataset.dirty='true';state.dirty=true;};form.addEventListener('input',changed);form.addEventListener('change',changed); }
function savedForm(form) { form.dataset.dirty='false';state.dirty=$$('#main form').some(item=>item.dataset.dirty==='true'); }
function submit(form, handler) {
  form.addEventListener('submit', event => { event.preventDefault(); busy(form.querySelector('button[type="submit"],button:not([type])'),async()=>{
    const values=formData(form),wasInert=form.inert;state.saving++;form.inert=true;form.setAttribute('aria-busy','true');$('#main').setAttribute('aria-busy','true');
    try{return await handler(values,form);}finally{state.saving--;form.inert=wasInert;form.removeAttribute('aria-busy');if(!state.saving)$('#main').removeAttribute('aria-busy');}
  }); });
}
function todayPage() {
  const {items, first, minutes, budget} = pendingPlan(state.boot.today), date=calendar(state.boot.today?.date);
  const kinds={review:'到期复习',mistake:'错题回顾',learn:'新的理解',study:'主题学习'};
  const rows=items.map((item,index)=>`<article class="task-row"><span class="task-index">${String(index+1).padStart(2,'0')}</span><div class="task-copy"><h3>${e(item.title)}</h3><div class="task-meta"><span class="tag">${e(kinds[item.kind]||'今日学习')}</span><span>${e(item.minutes)} 分钟</span></div></div><div class="task-actions">${btn(`开始 ${icon('arrow')}`,'start-plan','start',`data-id="${e(item.id)}"`)}${btn('稍后','defer','text-button',`data-id="${e(item.id)}"`)}${btn('更多','plan-more','text-button',`data-id="${e(item.id)}"`)}</div></article>`).join('');
  const recent=list(state.boot.notes).filter(n=>['source','knowledge'].includes(n.kind)).slice(0,4);
  const jobs=list(state.boot.jobs).filter(j=>['queued','running','waiting','failed'].includes(j.state));
  return {html:`<section class="page-heading"><div><div class="eyebrow">A LITTLE LEARNING, EVERY DAY</div><h1><span>把今天的理解，</span><span>再往前推一点。</span></h1><p>${items.length?`今天有 ${items.length} 件小事，留一点时间，慢慢想清楚。`:'今天可以从容一点，给新的理解留一点空间。'}</p></div><div class="date"><strong>${date.day}</strong>${e(date.label)}</div></section>
    <div class="dashboard"><section class="learning" aria-label="今日学习"><article class="hero"><div class="hero-label">${icon('spark')} ${first?'今天的第一步 · '+e(kinds[first.kind]||'学习'):'从一个问题开始'}</div><h2>${first?'先想起来，再回到原文。':'留点余地，让理解慢慢生长。'}</h2><p>${first?e(first.title):'留下一段文字、一个摘录，或还没想清的问题。'}</p><div class="actions">${first?btn(`开始 ${e(first.minutes)} 分钟学习 ${icon('arrow')}`,'start-plan','primary',`data-id="${e(first.id)}"`):link(`留下一个新起点 ${icon('plus')}`,'capture','primary')}${first?btn('稍后再学','defer','text-button',`data-id="${e(first.id)}"`):btn('安排今日学习','generate','text-button')}</div><div class="hero-mark" aria-hidden="true"><svg viewBox="0 0 160 160"><path d="M80 136C78 98 92 59 119 27M82 112C46 111 26 88 22 61c35-1 57 17 60 51ZM89 87c3-31 20-50 48-52-2 29-20 47-48 52ZM97 66c-21-11-30-31-26-54 22 11 31 30 26 54Z"/><path d="M82 112 40 78m49 9 34-38M97 66 77 27"/></svg></div></article>
    <div class="section-title"><h2>今日安排 <small>${items.length} 项待学</small></h2>${link('查看学习池 ↗','study','text-button')}</div>${rows||'<div class="empty"><h3>今天的安排暂时是空的</h3><p>已有正在学习的知识，可以重新生成安排。</p></div>'}<div class="plan-footer"><p class="footer-note">先解释，再看答案。完成练习不等于已经掌握。</p>${btn('重新安排','generate','text-button')}</div>
    ${list(state.boot.today?.items).some(p=>p.state==='skip')?details('今日暂时跳过的安排',list(state.boot.today.items).filter(p=>p.state==='skip').map(p=>`<div class="knowledge-row"><span>${e(p.title)}</span>${btn('恢复今日安排','plan-action','text-button',`data-id="${e(p.id)}" data-value="resume"`)}</div>`).join('')):''}${list(state.boot.settings?.pausedIds).length?details('暂停的知识',list(state.boot.settings.pausedIds).map(id=>`<div class="knowledge-row"><span>${e(noteTitle(id))}</span>${btn('恢复安排','resume-note','text-button',`data-id="${e(id)}"`)}</div>`).join('')):''}${list(state.boot.today?.unavailable).length?`<details class="quiet-details"><summary>为什么有些知识还没有安排？</summary>${list(state.boot.today.unavailable).map(item=>`<p>${e(item.title)}：${e(item.reason)} ${link('查看',`read/${item.noteId}`,'text-button')}</p>`).join('')}</details>`:''}</section>
    <aside class="aside-stack"><section class="budget"><h2>给今天留一点空间</h2><div id="budget-summary"><div class="budget-values"><span>已安排</span><strong>${minutes}</strong><span>分钟</span></div><div class="budget-sub"><span>可用 ${budget} 分钟</span><span>${minutes>budget?'超出':'留白'} ${Math.abs(budget-minutes)} 分钟</span></div><div class="budget-meter">${Array.from({length:10},(_,i)=>`<span class="${i<Math.ceil(minutes/Math.max(1,budget)*10)?'filled':''}"></span>`).join('')}</div><p>按自己的节奏，不必填满。</p></div><div id="focus-home" hidden></div><div class="budget-entry">${btn('调整可用时间 ↗','budget','text-button')}${btn('番茄钟','focus-start','text-button')}</div></section><section class="seed"><h2>随手留下下一个起点</h2>${link(`${icon('plus')}<span><strong>收集资料</strong><small>文字、摘录，或还没想清的问题</small></span>`,'capture','seed-button')}${link(`${icon('search')}<span><strong>找回一个想法</strong><small>从已有知识中继续探索</small></span>`,'search','seed-button')}</section><section class="reflection"><small>今日提醒</small><p>说清楚哪里还不懂，<br>也是一次进步。</p></section></aside></div>
    <section class="recent"><div class="section-title"><h2>思考还在继续</h2>${link('查看全部 ↗','library','text-button')}</div><div class="recent-items">${recent.map(note=>link(`${icon(note.kind==='source'?'file':'book')}<span><strong>${e(note.title)}</strong><small>${e(note.meta?.topic||'我的知识空间')} · ${e(kind(note.kind))}</small></span>`,`read/${note.id}`,'recent-item')).join('')||'<p class="muted">第一份资料，会成为下次思考的起点。</p>'}</div></section>${jobs.length?`<div class="activity-strip"><span>${jobs.length} 项处理动态</span><span class="muted">实际进度与等待原因都保留在这里。</span>${link('查看进度 ↗','jobs','text-button')}</div>`:''}`};
}
function capturePage() {
  return {html:heading('COLLECT A THOUGHT','先留下，再慢慢想清楚。','一段文字、一篇文章，或一个还没有答案的问题。')+`<div class="capture-layout"><form id="capture-form" class="capture-paper">
    <input class="title-input" name="title" placeholder="给这个起点一个名字（可选）" aria-label="资料标题">
    <textarea class="capture-body" name="body" required maxlength="500000" placeholder="把想留下的内容放在这里……" aria-label="原始资料正文"></textarea>
    <details class="capture-origin"><summary>添加出处与主题</summary><div class="form-grid">${field('来自哪里','platform',{placeholder:'书籍、网页、对话……'})}${field('主题','topic',{placeholder:'这份材料与你关心的什么有关？'})}${field('原始链接','url',{type:'url',placeholder:'https://…'})}${field('作者','author')}${field('资料日期','date',{type:'date'})}${field('原文定位','locator',{placeholder:'页码、章节或段落'})}</div></details>
    <div class="capture-options"><label class="check"><input type="checkbox" name="process"> 保存后用 AI 拆解</label><label class="check dependent"><input type="checkbox" name="research" disabled> 同时联网核验</label><p class="form-note">AI 拆解会将所需原文发送给你配置的服务，可能计费。仅保存不会调用 AI。</p></div>
    <footer class="paper-footer"><span id="character-count" class="muted small">原文会完整保留</span><button class="primary" type="submit">保存这个起点 ${icon('arrow')}</button></footer><p id="capture-receipt" role="status"></p>
    </form><aside class="capture-aside"><p class="eyebrow">A PLACE TO BEGIN</p><h2>不用整理完整，<br>先把它留下来。</h2><p>资料和理解之间，可以留一点距离。</p><ol class="capture-steps"><li><span>01</span><div><strong>留下原文</strong><p>保留完整内容，以及它从哪里来。</p></div></li><li><span>02</span><div><strong>读出自己的问题</strong><p>在书桌里阅读，再决定哪些值得继续。</p></div></li><li><span>03</span><div><strong>形成自己的解释</strong><p>拆解是建议，理解由你亲自确认。</p></div></li></ol><label class="file-drop">${icon('file')}<strong>从文本或 Markdown 开始</strong><span>选择一份读入编辑区，多份预览后批量保存</span><input id="text-file" type="file" multiple accept=".txt,.md,.markdown"></label></aside></div>`,
    bind() {
      const form=$('#capture-form');watchForm(form);
      const fileArea=document.createElement('section');
      fileArea.className='capture-file-area';
      fileArea.innerHTML=`<details><summary>或者，保存图片、PDF、Word 原件</summary><p class="form-note">每份最多 50 MB。文件只发送到本机，保存不调用 AI。Word 正文转换后请核对。</p><input type="file" id="attachment-file" accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.doc,.docx" aria-label="选择原始文件"><button type="button" class="secondary" id="save-file" disabled>上传并保存原件</button><p id="file-receipt" role="status"></p></details>`;
      form.after(fileArea);
      let uploadId='',selectedFile;
      $('#attachment-file').onchange=event=>{selectedFile=event.target.files[0];uploadId=crypto.randomUUID();$('#save-file').disabled=!selectedFile;};
      $('#save-file').onclick=event=>busy(event.currentTarget,async()=>{if(!selectedFile)return;if(selectedFile.size>50000000)throw new Error('每份原件最多 50 MB。');await api.upload(selectedFile,uploadId);const result=await api.post('/api/file-import',{uploadId});$('#file-receipt').innerHTML=`原件已保存。${link('打开资料 ↗',`read/${result.note.id}`,'text-button')}`;$('#attachment-file').value='';selectedFile=null;await refreshBoot();shell();});
      const process=form.elements.process,research=form.elements.research;
      process.onchange=()=>{research.disabled=!process.checked;if(!process.checked)research.checked=false;};
      form.elements.body.oninput=()=>{$('#character-count').textContent=`${form.elements.body.value.length.toLocaleString()} 字 · 原文会完整保留`;};
      $('#text-file').onchange=async event=>{const files=[...event.target.files];if(files.length>1){try{await batchImport(files,context);}catch(error){notify(error.message,true);}event.target.value='';return;}const file=files[0];if(!file)return;if(file.size>2*1024*1024){notify('文本超过 2 MB，请拆分后收集。',true);return;}if(state.dirty&&!await confirm('替换编辑区的内容？','尚未保存的文字会被所选文本替换。','替换文字'))return;form.elements.body.value=await file.text();form.elements.title.value ||= file.name.replace(/\.[^.]+$/,'');state.dirty=true;form.elements.body.oninput();};
      submit(form,async values=>{
        const snapshot=JSON.stringify(formData(form));
        const result=await api.post('/api/import',capturePayload({...values,process:process.checked,research:research.checked}));
        if(JSON.stringify(formData(form))===snapshot){savedForm(form);form.reset();research.disabled=true;}
        const source=result.notes?.[0];$('#capture-receipt').innerHTML=`已保存：${e(source?.title||'原始资料')} ${source?link('现在打开书桌 ↗',`read/${source.id}`,'text-button'):''}`;
        $('#character-count').textContent='原文会完整保留';notify('原文已完整保存。');await refreshBoot();shell();
      });
    }};
}
async function libraryPage() {
  const notes=list((await api.get('/api/notes')).notes);
  return {html:heading('YOUR GROWING LIBRARY','让每一个想法，有处可寻。',`${notes.filter(n=>n.kind==='source').length} 份原文 · ${notes.filter(n=>n.kind==='knowledge').length} 条知识，慢慢长成自己的理解。`,link(`${icon('plus')} 收集资料`,'capture','primary'))+
    `<div class="library-toolbar"><div class="segmented" aria-label="内容类型">${[['all','全部'],['source','原始资料'],['knowledge','知识'],['mistake','错题']].map(([value,label])=>btn(label,'library-filter','',`data-kind="${value}" aria-pressed="${value==='all'}"`)).join('')}</div><label class="inline-search">${icon('search')}<input id="library-query" type="search" placeholder="在这些想法里找一找" aria-label="筛选知识库"></label></div><div id="library-notes" class="library-grid">${notes.map(noteCard).join('')||empty('书架还空着','从一份真正想理解的材料开始。',link('收集第一份资料','capture','primary'))}</div>`,
    bind(){let selected='all';const update=()=>{const query=$('#library-query').value.trim().toLowerCase();const visible=notes.filter(n=>(selected==='all'||n.kind===selected)&&`${n.title}\n${n.body}\n${n.meta?.topic||''}`.toLowerCase().includes(query));$('#library-notes').innerHTML=visible.map(noteCard).join('')||empty('这里暂时没有找到','换一个词，或者看看其他内容分类。');};$$('[data-action="library-filter"]').forEach(b=>{b.onclick=()=>{selected=b.dataset.kind;$$('[data-action="library-filter"]').forEach(other=>other.setAttribute('aria-pressed',String(other===b)));update();};});$('#library-query').oninput=update;}};
}
async function readPage(id) {
  const sequence = state.sequence;
  const [note, related] = await Promise.all([api.get(endpoint('notes', id)), api.get('/api/relations')]);
  const readiness = note.kind === 'knowledge' ? await readReadiness(note) : null;
  if (sequence === state.sequence) { state.note = note; state.readiness = readiness; }
  return reader(note, list(state.boot.notes), state.readerReturn, relatedReadingNotes(note, list(state.boot.notes), list(related.relations)), readiness);
}
async function editPage(id) {
  const note=await api.get(endpoint('notes',id));
  return {html:heading('KEEP THE ORIGINAL','把想表达的，写得更清楚。','保存时会核对原版本，其他地方的修改不会被覆盖。',link('回到阅读',`read/${id}`,'text-button'))+
    `<form id="edit-form" class="writing-page">${field('标题','title',{value:note.title,required:true})}<div class="field note-body-field"><label for="note-body">正文</label><div id="note-body-editor"><textarea id="note-body" name="body" rows="20" required>${e(note.body||'')}</textarea></div></div><div class="paper-footer"><p class="muted small">原始资料与个人理解各自保留。</p><button class="primary" type="submit">保存修改 ${icon('arrow')}</button></div></form>`,
    bind(){
      const form=$('#edit-form');watchForm(form);
      const editor=mountNoteEditor(form,note,()=>{form.dataset.dirty='true';state.dirty=true;});
      const session=noteEditSession(note,{read:()=>({title:form.elements.title.value,body:editor.getValue()}),write:(noteId,values)=>api.put(endpoint('notes',noteId),values)});
      submit(form,async()=>{
        const {snapshot}=await session.save();
        await refreshBoot();
        if(form.elements.title.value!==snapshot.title||editor.getValue()!==snapshot.body){notify('本次修改已保存；保存期间的新输入仍在草稿中，请继续保存。');return;}
        state.dirty=false;await go(`read/${id}`,{replace:true,force:true});notify('修改已保存。');
      });
    }};
}
async function studyPage(id) {
  if(id)return sessionPage(id);
  const sessions=list((await api.get('/api/study')).sessions), notes=list(state.boot.notes).filter(n=>n.kind==='knowledge'&&['learning','integrated','core'].includes(n.meta?.stage));
  const mistakes=list((await api.get('/api/mistakes')).mistakes);
  return {html:heading('UNDERSTANDING TAKES PRACTICE','慢一点，把理解说清楚。','先尝试回忆，再核对材料。回答、反馈与自己确认的理解分别保留。')+
    `<div class="study-overview"><section><div class="section-title"><h2>正在学习 <small>${notes.length} 条</small></h2></div>${notes.map((note,index)=>`<article class="task-row"><span class="task-index">${String(index+1).padStart(2,'0')}</span><div class="task-copy"><h3>${e(note.title)}</h3><div class="task-meta">${e(note.meta?.topic||'我的学习')}</div></div>${btn(`开始 ${icon('arrow')}`,'start-note','start',`data-id="${e(note.id)}"`)}</article>`).join('')||empty('还没选好要学什么','在知识的书桌中选择“加入学习”，再从这里开始。',link('去知识库看看','library','text-button'))}</section>
    <aside class="study-history"><p class="eyebrow">PICK UP WHERE YOU LEFT OFF</p><h2>接着上一次思考</h2><div class="actions">${link('完整学习历史 ↗','history','text-button')}${link('学习时长 ↗','focus','text-button')}</div>${sessions.slice(0,6).map(s=>link(`<strong>${e(noteTitle(s.noteId))}</strong><small>${e(jobState(s.status))} · ${list(s.turns).length} 次回答</small>`,`study/${s.id}`,'history-item')).join('')||'<p class="muted">开始之后，你的思考会留在这里。</p>'}</aside></div>
    <section class="recent"><div class="section-title"><h2>再想一想 <small>${mistakes.length} 条错题</small></h2></div>${mistakes.length?noteRows(mistakes):'<p class="muted">遇到的误解会保留下来，成为下一次理解的起点。</p>'}</section>`};
}
async function sessionPage(id) {
  const session=await api.get(endpoint('study',id));state.session=session;
  const turns=list(session.turns), waiting=session.status==='awaiting_feedback'||session.pendingJobId, completed=session.status==='completed';
  const title=noteTitle(session.noteId), material=markdown(session.material).html;
  return {html:heading('ONE THOUGHT AT A TIME',title,`${e(session.goal||'用自己的话解释')} · ${jobState(session.status)}`,link('回到学习池','study','text-button'))+
    `${credibilityNotice(session.materialWarnings,session.noteId)}<div class="learning-workspace"><section class="learning-page">${!turns.length?`<div class="learning-material" id="learning-material"><p class="eyebrow">先阅读，然后合上材料</p><div class="article-prose">${material}</div><div class="actions">${btn('合上材料，试着解释','hide-material','primary')}${link('在书桌里读',`read/${session.noteId}`,'text-button')}</div></div>`:''}
    <div id="answer-workspace" ${!turns.length?'hidden':''}><div class="learning-question"><p class="eyebrow">这一次，试着回答</p><h2>${e(session.question)}</h2></div>
    ${turns.map((turn,index)=>`<section class="learning-turn"><p class="nav-label">第 ${index+1} 次 · 我的回答 · ${turn.hintUsed?'使用过提示或原文':'独立作答'}</p><div class="answer-prose">${e(turn.answer).replaceAll('\n','<br>')}</div>${feedbackHTML(turn.feedback)}</section>`).join('')}
    ${waiting?`<div class="waiting-note" role="status"><span class="status-pulse"></span><div><strong>你的回答已保存</strong><p>反馈还在等待处理。可以离开，之后从学习记录继续。</p>${btn('查看最新反馈','reload','text-button')} ${link('处理动态 ↗','jobs','text-button')}</div></div>`:completed?`<div class="completion-note"><h2>这一次思考，已经留下来了。</h2><p>${e(session.completion?.reason||'学习记录已保存。')}</p>${completionHTML(session.completion)}${link('回到今天','today','text-button')}</div>`:`<form id="answer-form">${area('我的解释','answer',{placeholder:'不用完美。先写下此刻的理解，再找一个自己的例子。',required:true,rows:9})}<div class="answer-actions">${btn('需要一点提示','hint','text-button',`data-id="${e(id)}"`)}${btn('再看原文','study-material','text-button',`data-id="${e(id)}"`)}<button type="submit" class="primary">保存回答，获取反馈 ${icon('arrow')}</button></div><p class="form-note">回答会保存到本机；AI 反馈使用已配置的服务，可能计费。未配置时保留回答并等待。</p></form>`}</div></section>
    <aside class="learning-companion"><p class="eyebrow">给思考一点空间</p><h2>不是把答案写对，<br>而是看见自己怎么想。</h2><p>先说出结论，再补充理由。对不确定的部分，也可以明确写下。</p><div id="study-hint">${aidUsed(session)?'<p class="form-note">本轮已使用提示或回看原文，回答会如实记录。</p>':''}</div>${turns.length?`<div class="margin-actions">${btn('确认我的理解','session-understanding','text-button',`data-id="${e(id)}"`)}${!completed?btn('结束本轮练习','finish','text-button',`data-id="${e(id)}" ${waiting?'disabled':''}`):''}</div>`:''}</aside></div>`,
    bind(){const form=$('#answer-form');if(form){watchForm(form);const requestId=crypto.randomUUID();submit(form,async values=>{await api.post(endpoint('study',id,'answer'),{answer:values.answer,hintUsed:aidUsed(session),requestId});clearAid(session);state.dirty=false;await go(`study/${id}`,{replace:true,force:true});});}}};
}
async function topicsPage() {
  const topics=list((await api.get('/api/topics')).topics);
  return {html:heading('FOLLOW YOUR CURIOSITY','沿着一个问题，慢慢深入。','让分散的资料围绕一个问题，形成可以继续探索的路径。',btn(`${icon('plus')} 新建学习包`,'new-topic','primary'))+
    `<div class="topic-grid">${topics.map((topic,index)=>`<article class="topic-cover"><p class="topic-number">${String(index+1).padStart(2,'0')}</p><h2>${e(topic.title)}</h2><p>${e(String(topic.body||'').replace(/[#>*]/g,'').slice(0,90))}</p><footer><span>${list(topic.meta?.noteIds||topic.noteIds).length} 条知识</span>${btn('打开学习路径 ↗','open-topic','text-button',`data-id="${e(topic.id)}"`)}</footer></article>`).join('')||empty('想围绕什么，学得更深入？','选一个你反复想起的问题，把相关的知识放在一起。',btn('建立第一个学习包','new-topic','primary'))}</div>`};
}
async function searchPage() {
  return {html:heading('CONNECT THE DOTS','找回一个想法，发现新的联系。','用一个词、一段描述，重新遇见保存过的内容。')+
    `<form id="search-form" class="search-composer"><div>${icon('search')}<input name="q" type="search" required placeholder="你在找什么？" aria-label="搜索内容"><button class="primary" type="submit">搜索 ${icon('arrow')}</button></div><div class="search-options"><label><input type="radio" name="mode" value="keyword" checked> 本地文字检索</label><label><input type="radio" name="mode" value="hybrid"> 语义与文字（需嵌入服务）</label></div></form><div id="search-results"><p class="search-pause">有时候，新的理解来自两个旧想法的相遇。</p></div>`,
    bind(){let request=0;submit($('#search-form'),async values=>{const revision=++request,route=state.sequence;const result=await api.get(`/api/search?${new URLSearchParams({q:values.q,mode:values.mode})}`);if(revision!==request||route!==state.sequence)return;$('#search-results').innerHTML=`<div class="section-title"><h2>找到 ${list(result.results).length} 个线索</h2></div><div class="search-results">${list(result.results).map(note=>`<article class="search-result"><p class="eyebrow">${e(kind(note.kind))} / ${e(note.meta?.topic||'我的知识空间')}</p><h2>${link(e(note.title),`read/${note.id}`,'result-title')}</h2><p>${e(note.snippet||note.body||'')}</p>${link('沿着原文继续 ↗',`read/${note.id}`,'text-button')}</article>`).join('')||empty('还没有找到这个线索','换一个词，或试着缩短描述。')}</div>`;});}};
}
async function outputPage() {
  const drafts=list((await api.get('/api/drafts')).drafts);
  return {html:heading('MAKE SOMETHING OF IT','让已有的理解，成为新的表达。','从自己的资料出发，整理成答案、提纲或一份草稿。')+
    `<div class="output-layout"><form id="output-form" class="output-composer">${area('这一次，想完成什么？','question',{placeholder:'例如：基于我保存的阅读笔记，整理一份关于主动回忆的分享提纲……',required:true,rows:7})}<div class="segmented"><label><input type="radio" name="mode" value="answer" checked> 回答问题</label><label><input type="radio" name="mode" value="outline"> 组织提纲</label><label><input type="radio" name="mode" value="draft"> 写一份草稿</label></div>${details('取材范围',`<div class="form-grid">${[['knowledge','知识'],['source','原始资料']].map(([v,l])=>`<label class="check"><input type="checkbox" name="scope" value="${v}" ${['knowledge','source'].includes(v)?'checked':''}>${l}</label>`).join('')}</div>`)}<label class="check"><input type="checkbox" name="cloud"> 允许本次将所需资料发送给已配置的 AI 服务</label><p class="form-note">未勾选时只在本地检索与整理。AI 生成可能计费，结果仍需你核对。</p><button class="primary" type="submit">从我的资料开始 ${icon('arrow')}</button></form><aside class="output-aside"><p class="eyebrow">WORDS WITH ROOTS</p><h2>有出处的表达，<br>才接得住追问。</h2><p>每个结论都可以回到原文。生成内容是草稿，采用之后也不会自动成为个人知识。</p></aside></div><section id="output-result"></section>
    <section class="recent"><div class="section-title"><h2>写过的草稿</h2></div><div id="all-drafts"></div></section>`,
    bind(){paginate($('#all-drafts'),drafts,draft=>btn(`<strong>${e(draft.title||draft.question||'输出草稿')}</strong><small>继续编辑 ↗</small>`,'open-draft','draft-row',`data-id="${e(draft.id)}"`));const form=$('#output-form');watchForm(form);let intent='',requestId='';submit(form,async values=>{const payload={question:values.question,mode:values.mode,scope:[...form.querySelectorAll('[name="scope"]:checked')].map(n=>n.value),privacy:form.elements.cloud.checked?'cloud':'local'};if(!payload.scope.length)throw Error('请至少选择一种取材范围。');const key=JSON.stringify(payload);if(intent!==key){intent=key;requestId=crypto.randomUUID();}const route=state.sequence;const result=await api.post('/api/ask',{...payload,requestId});if(route!==state.sequence)return;state.dirty=false;$('#output-result').innerHTML=`<article class="output-document"><p class="eyebrow">${result.generated?'AI 生成 · 请核对':'本地检索与整理'}</p><div class="article-prose">${markdown(result.answer).html}</div>${details('引用、摘录与核验',evidenceHTML(result.citations),!list(result.citations).length)}${result.draftId?btn('编辑草稿与标记采用','open-draft','text-button',`data-id="${e(result.draftId)}"`):''}${list(result.limitations).map(item=>`<p class="form-note">${e(item)}</p>`).join('')}</article>`;});}};
}
async function settingsPage() {
  const settings=await api.get('/api/settings'), ai=settings.ai||{};
  return {html:heading('MAKE ROOM FOR YOURSELF','把工作台，调成自己的节奏。','少一点打扰，让工具服务于你的理解。')+
    `<div class="settings-layout"><nav class="settings-nav" aria-label="设置章节"><a href="#settings-rhythm">学习节奏</a><a href="#settings-appearance">阅读与外观</a><a href="#settings-ai">AI 连接</a>${link('处理动态 ↗','jobs','text-button')}${link('更多设置与管理 ↗','manage','text-button')}${link('学习时长 ↗','focus','text-button')}</nav><div class="settings-sections">
    <section id="settings-rhythm"><p class="eyebrow">YOUR OWN PACE</p><h2>给每天留一点时间</h2><p class="muted">这是安排学习的参考，不是必须完成的目标。</p><form id="rhythm-form"><div class="form-grid">${field('每天可用时间（分钟）','dailyMinutes',{type:'number',value:settings.dailyMinutes||25,required:true,extra:'min="5" max="240"'})}${field('主题关注范围','focusTopics',{value:list(settings.focusTopics).join('，'),placeholder:'多个主题用逗号分开'})}</div><button class="primary" type="submit">保存学习节奏</button></form></section>
    <section id="settings-appearance"><p class="eyebrow">READING & APPEARANCE</p><h2>喜欢什么样的光线？</h2><div class="theme-options">${btn('<span class="theme-swatch light-swatch"></span><strong>日光</strong><small>暖白纸面，陶土色细节</small>','set-light','theme-option')}${btn('<span class="theme-swatch dark-swatch"></span><strong>夜读</strong><small>柔和深灰，让眼睛安静下来</small>','set-dark','theme-option')}</div></section>
    <section id="settings-ai"><p class="eyebrow">AN OPTIONAL THINKING PARTNER</p><h2>连接你的 AI</h2><p class="muted">保留原文、阅读和文字检索可以独立使用。连接之后，拆解、反馈与生成仍由你主动发起。</p><form id="ai-form"><label class="check"><input type="checkbox" name="enabled" ${ai.enabled?'checked':''}> 启用文本 AI</label><div class="form-grid">${field('服务地址','baseUrl',{value:ai.baseUrl||'',type:'url',placeholder:'https://api.example.com/v1'})}${field('模型名称','model',{value:ai.model||'',placeholder:'模型标识'})}${field('API Key（留空保留已保存的密钥）','apiKey',{type:'password',extra:'autocomplete="new-password"'})}${field('每日调用上限','dailyCallLimit',{type:'number',value:ai.dailyCallLimit??100,extra:'min="0"'})}</div><p class="form-note">密钥只交给本机后端保存，不在网页缓存或显示。保存本身不发送模型请求。</p><div class="actions"><button class="primary" type="submit">保存连接设置</button>${btn('测试已保存的连接','test-ai','text-button')}</div><p id="ai-result" role="status"></p></form></section>
    <section><p class="eyebrow">YOUR KNOWLEDGE STAYS YOURS</p><h2>资料与备份</h2><p class="muted">你的原文和学习记录保存在本机。导出备份不包含连接密钥。</p><div class="actions"><a class="secondary" href="/api/backup" download>下载完整备份</a>${btn('查看回收站','recycle','text-button')}${link('预览并恢复完整备份','manage/restore','text-button')}${btn('恢复已移除知识','deleted-notes','text-button')}</div></section>
    </div></div>`,
    bind(){const rhythm=$('#rhythm-form');watchForm(rhythm);submit(rhythm,async values=>{await api.put('/api/settings',{dailyMinutes:Number(values.dailyMinutes),focusTopics:values.focusTopics.split(/[,，]/).map(s=>s.trim()).filter(Boolean)});savedForm(rhythm);await refreshBoot();notify('学习节奏已保存。');});
      const form=$('#ai-form');watchForm(form);submit(form,async values=>{await api.put('/api/settings',{ai:{enabled:form.elements.enabled.checked,baseUrl:values.baseUrl,model:values.model,...(values.apiKey?{apiKey:values.apiKey}:{}),dailyCallLimit:Number(values.dailyCallLimit)}});form.elements.apiKey.value='';savedForm(form);await refreshBoot();$('#ai-result').textContent='设置已保存。尚未测试连接。';notify('连接设置已保存。');});}};
}
async function jobsPage() {
  const jobs=list((await api.get('/api/jobs')).jobs);state.jobs=jobs;
  return {html:heading('THINGS IN PROGRESS','每一步，都有迹可循。','查看实际处理进度。等待、失败与完成会分别记录。',btn('刷新进度','reload','secondary'))+`<div class="jobs-list">${jobs.slice(0,50).map(job=>`<article class="job-row"><span class="job-state state-${e(job.state)}">${e(jobState(job.state))}</span><div><h2>${e(({process:'资料拆解',grade:'学习反馈',structure:'知识结构',relate:'知识关联',discover:'发现联系',index:'更新索引',topics:'主题整理',title:'整理标题'})[job.type]||'后台处理')}</h2><p>${e(job.error||job.message||'本机已保留处理记录。')}</p></div>${['failed','waiting','cancelled'].includes(job.state)?btn('重新尝试','retry-job','text-button',`data-id="${e(job.id)}"`):''}</article>`).join('')||empty('现在，没有后台任务','你可以安心阅读，或者留下一份新资料。')}</div>`};
}

function formModal(title, contents, save, { wide = false } = {}) {
  let dirty = false;
  const dialog=modal(title,`<form>${contents}<div class="actions"><button class="primary" type="submit">确认保存 ${icon('arrow')}</button></div></form>`,{wide});
  const form=dialog.querySelector('form');
  form.addEventListener('input',()=>{dirty=true;});
  form.addEventListener('change',()=>{dirty=true;});
  dialog.beforeClose=()=>{if(form.getAttribute('aria-busy')==='true'){notify('正在保存，请等这次操作返回。');return false;}return !dirty||confirm('放弃窗口里的输入？','这部分内容还没有保存。关闭后会放弃本次输入。','放弃输入');};
  dialog.hasUnsavedInput=()=>dirty;
  submit(form,async(values,node)=>{await save(values,node);dirty=false;dialog.close();});
  return dialog;
}
async function startStudy(noteId, planId) {
  const key=`${noteId}:${planId||''}`;
  const intent=startStudy.intents.get(key)||{requestId:crypto.randomUUID(),pending:null};
  if(intent.pending)return intent.pending;
  startStudy.intents.set(key,intent);
  intent.pending=(async()=>{
    const sequence=state.sequence;
    const note=await api.get(endpoint('notes',noteId)),readiness=await readReadiness(note);
    if(sequence!==state.sequence)return;
    if(!readiness.ready){modal(readiness.heading,learningHelp(note,readiness));return;}
    try {
      const session=await api.post('/api/study/start',{noteId,...(planId?{planId}:{}),requestId:intent.requestId});
      if(sequence===state.sequence)await go(`study/${session.id}`);
      startStudy.intents.delete(key);
    } catch(error) {
      if(sequence!==state.sequence)return;
      if(error.code==='NOTE_UNAVAILABLE'){await prepareLearning(noteId);return;}
      throw error;
    }
  })();
  try{return await intent.pending;}finally{intent.pending=null;}
}
startStudy.intents=new Map();
async function readReadiness(note) {
  const data=await api.get(endpoint('notes',note.id,'evidence'));
  return learningReadiness(note,list(state.boot.notes),list(data.limitations));
}
async function prepareLearning(id) {
  const sequence=state.sequence;
  const note=await api.get(endpoint('notes',id)),readiness=await readReadiness(note);
  if(sequence!==state.sequence)return;
  if(readiness.ready){notify('可以开始学习；可信度提示会随材料保留。');return go(state.route,{replace:true});}
  modal(readiness.heading,learningHelp(note,readiness));
}
async function processSource(id, { research = false } = {}) {
  const sequence=state.sequence,returnTo=state.route.startsWith('read/')?state.route:`read/${id}`;
  const note=await api.get(endpoint('notes',id));
  if(sequence!==state.sequence)return;
  let timer,job,selectedResearch=research,reading=false,sending=false;
  const dialog=modal(research?'补充这份资料的核验':'把这份原文交给 AI 拆解？',`<p><strong>${e(note.title)}</strong></p><p>将必要原文发送给已配置的服务，可能计费。已有拆解会复用；核验不会自动确认个人理解。</p><label class="check"><input type="checkbox" name="research" ${research?'checked':''}> 联网核验事实、条件与反例</label><p class="form-note">不勾选也能整理和学习，待核验之处会继续标明。人工修改或进行中的练习会保留，新证据另存为修订建议。</p><div class="actions"><button class="primary" data-run>确认${research?'核验':'拆解'}</button></div>`,{onClose:()=>clearTimeout(timer)});
  const current=()=>dialog.isConnected&&dialog.open&&sequence===state.sequence;
  const render=(pendingProposals=0)=>{
    if(!current())return;
    const view=processOutcome(job,{research:selectedResearch,sourceId:id,returnTo,pendingProposals});
    dialog.querySelector('h2').textContent=view.title;dialog.setAttribute('aria-label',view.title);
    const body=dialog.querySelector('.dialog-body'),hadFocus=body.contains(document.activeElement)||document.activeElement===document.body;
    body.innerHTML=view.html;
    const retry=body.querySelector('[data-process-retry]');
    if(retry)retry.onclick=event=>busy(event.currentTarget,()=>send(job.id));
    const researchButton=body.querySelector('[data-process-research]');
    if(researchButton)researchButton.onclick=event=>busy(event.currentTarget,()=>send());
    body.querySelector('[data-process-refresh]').onclick=event=>busy(event.currentTarget,read);
    if(hadFocus)(retry||researchButton||body.querySelector('[data-process-refresh]')).focus({preventScroll:true});
    springEnter(body,undefined,3,1);
  };
  const read=async()=>{
    if(!current()||reading||sending)return;
    reading=true;clearTimeout(timer);
    try{
      const snapshot=await api.get('/api/jobs?view=status');
      if(!current())return;
      const latest=list(snapshot.jobs).find(item=>item.id===job.id);
      if(!latest)throw new Error('任务记录已变化，请重新打开原文确认。');
      const changed=JSON.stringify(job)!==JSON.stringify({...job,...latest});job={...job,...latest};
      let pendingProposals=0,boot;
      if(!['queued','running'].includes(job.state)){
        const [proposals,latestBoot]=await Promise.all([api.get('/api/proposals'),api.get('/api/bootstrap')]);
        boot=latestBoot;
        pendingProposals=list(proposals.proposals).filter(p=>p.state==='pending'&&p.meta?.processKey?.startsWith(`${id}:`)).length;
      }
      if(!current())return;
      if(boot){state.boot=boot;shell();}
      if(changed||!['queued','running'].includes(job.state))render(pendingProposals);
      if(['queued','running'].includes(job.state))timer=setTimeout(read,1800);
    }catch(error){if(current())dialog.querySelector('[data-process-error]').textContent=`状态读取未完成：${error.message}。可点击“刷新状态”，不会重新发起核验。`;}
    finally{reading=false;}
  };
  const send=async retryJobId=>{
    if(sending||!current())return;
    sending=true;clearTimeout(timer);
    try{
      const result=await api.post(endpoint('notes',id,'process'),{research:selectedResearch,reuseExtracted:selectedResearch,...(retryJobId?{retryJobId}:{})});
      if(!current())return;
      job=result.job||result;render();
    }finally{sending=false;}
    if(current())await read();
  };
  dialog.querySelector('[data-run]').onclick=event=>busy(event.currentTarget,async()=>{selectedResearch=dialog.querySelector('input').checked;await send();});
}
async function extract(id) {
  const note=await api.get(endpoint('notes',id));
  formModal('从这份原文，整理一个想法',`${field('知识标题','title',{required:true})}${area('用自己的话整理','body',{required:true,placeholder:'这条知识回答什么问题？有哪些条件与边界？'})}${field('归属主题','topic',{value:note.meta?.topic||''})}<label class="field"><span>内容性质</span><select name="claimType"><option value="fact">事实性知识（仍需核验）</option><option value="opinion">个人观点或经验</option></select></label>${field('为什么值得留下','reason',{required:true})}<p class="form-note">原文完整保留；新条目先进入待选学，事实性知识保留待核验提示，也可以先加入学习。</p>`,async values=>{
    const saved=await api.post(endpoint('notes',id,'extract'),{...values,depth:'explain'});await refreshBoot();await go(`read/${saved.id}`,{force:true});notify('新想法已留下，原文保持完整。');
  },{wide:true});
}
async function promote(id) {
  const note=await api.get(endpoint('notes',id));
  formModal('怎样继续这条知识？',`<p>${e(note.title)}</p><label class="field"><span>接下来的用途</span><select name="stage">${[['reference','先留作查阅'],['candidate','放进待选学'],['learning','加入学习'],['integrated','已整理个人理解'],['core','重点知识'],['retired','暂时不再使用']].map(([value,label])=>`<option value="${value}" ${note.meta?.stage===value?'selected':''}>${label}</option>`).join('')}</select></label><label class="field"><span>希望达到什么程度</span><select name="depth">${[['aware','知道它是什么'],['find','需要时能找回'],['explain','能用自己的话解释'],['apply','能在情境中应用']].map(([value,label])=>`<option value="${value}" ${(note.meta?.depth||'explain')===value?'selected':''}>${label}</option>`).join('')}</select></label>${area('写一点理由，留给以后的自己','reason',{required:true,rows:3})}`,async values=>{
    await api.post(endpoint('notes',id,'promote'),values);await refreshBoot();await go(state.route,{force:true,replace:true});notify('学习安排已更新。');
  });
}
async function understanding(id, sessionId = '') {
  const note=await api.get(endpoint('notes',id));
  formModal('这是我现在的理解',`<p>${e(note.title)}</p>${area('亲自写下自己的解释','body',{required:true,placeholder:'用自己的话说明结论、例子与边界。',rows:10})}<p class="form-note">这次确认与原文、AI 建议分别保留。确认理解不等于永久掌握。</p>`,async values=>{
    await api.post(sessionId?endpoint('study',sessionId,'confirm'):endpoint('notes',id,'confirm'),{body:values.body,...(!sessionId?{expectedHash:note.hash}:{})});await refreshBoot();notify('你的理解已单独确认保存。');
  },{wide:true});
}
async function newTopic() {
  const notes=list(state.boot.notes).filter(n=>n.kind==='knowledge');
  formModal('围绕一个问题，开始学习',`${field('想深入的主题','title',{required:true,placeholder:'一个你反复想起的问题'})}${area('想弄清什么','body',{rows:4})}<fieldset class="note-picker"><legend>选择相关知识</legend>${notes.map(n=>`<label class="check"><input type="checkbox" name="member" value="${e(n.id)}">${e(n.title)}</label>`).join('')||'<p class="muted">还没有知识条目。可以先建立主题，之后补充。</p>'}</fieldset>${field('预计投入（分钟）','minutes',{value:20,type:'number',extra:'min="5" max="240"'})}`,async(values,form)=>{
    await api.post('/api/topics',{title:values.title,body:values.body,noteIds:[...form.querySelectorAll('[name="member"]:checked')].map(n=>n.value),prerequisites:[],minutes:Number(values.minutes)});await refreshBoot();await go('topics',{force:true,replace:true});notify('新的学习包已建立。');
  },{wide:true});
}
async function openTopic(id) {
  const topic=list((await api.get('/api/topics')).topics).find(t=>t.id===id);
  if(!topic)throw new Error('这个学习包暂时无法找到。');
  const ids=list(topic.meta?.noteIds||topic.noteIds),notes=ids.map(id=>list(state.boot.notes).find(n=>n.id===id)).filter(Boolean);
  modal(topic.title,`<div class="article-prose">${markdown(topic.body).html}</div><h3 class="dialog-section">沿着这些知识继续</h3>${notes.length?noteRows(notes):'<p class="muted">这个学习包还没有成员。</p>'}`,{wide:true});
}
async function evidence(id) {
  const data=await api.get(endpoint('notes',id,'evidence'));
  modal('回到依据与出处',evidenceHTML(list(data.evidence).map(item=>({...item,researchedAt:item.researchedAt||data.researchedAt})),data.limitations),{wide:true});
}
async function openDraft(id) {
  const draft=list((await api.get('/api/drafts')).drafts).find(item=>item.id===id);
  if(!draft)throw new Error('这份草稿暂时无法找到。');
  formModal(draft.question||'继续写这份草稿',`${area('输出草稿','body',{value:draft.body,required:true,rows:15})}<p class="form-note">保存草稿不会自动确认成个人知识。</p>`,async values=>{
    await api.put(endpoint('drafts',id),{body:values.body,usedIds:list(draft.usedIds)});notify('草稿已保存。');
  },{wide:true});
}
async function recycle() {
  const result=await api.get('/api/recycle-bin');
  const entries=list(result.items||result.entries);
  modal('暂时放下的资料',`${entries.length?entries.map(item=>`<div class="recycle-row"><strong>${e(item.title||item.note?.title||'原始资料')}</strong>${btn('恢复资料','restore-source','text-button',`data-id="${e(item.id)}" data-version="${e(item.versionId||'')}"`)}</div>`).join(''):'<p class="muted">回收站里暂时没有资料。</p>'}<p class="form-note">此入口只提供恢复。永久删除仍受后端独立所有者保护。</p>`);
}
async function actions(control) {
  const action=control.dataset.action,id=control.dataset.id;
  if(control.closest('.reader-menu')&&action!=='navigate')control.closest('dialog').close();
  if(action==='navigate') {
    const dialog=control.closest('dialog');
    if(dialog){if(dialog.beforeClose&&!await dialog.beforeClose())return;dialog.close();}
    return go(control.dataset.route);
  }
  if(action==='theme'||action==='set-light'||action==='set-dark') {
    window.setWebTheme(action==='theme'?!window.getWebTheme():action==='set-dark');return;
  }
  if(action==='menu') {const open=document.documentElement.classList.toggle('nav-open');$('#mobile-menu').setAttribute('aria-expanded',String(open));return;}
  if(action==='reload') {if(state.dirty&&!await confirm('刷新前放弃输入？','当前输入还没有保存。','放弃并刷新'))return;state.dirty=false;await refreshBoot();return go(state.route,{replace:true});}
  if(action==='generate') {state.boot.today=await api.post('/api/today/generate');return go('today',{replace:true});}
  if(action==='start-plan') {const plan=pendingPlan(state.boot.today).items.find(item=>item.id===id);if(plan)return startStudy(plan.noteId,plan.id);return;}
  if(action==='start-note')return startStudy(id);
  if(action==='start-mistake') {const session=await api.post('/api/study/start',{mistakeId:id,noteId:control.dataset.note,requestId:crypto.randomUUID()});return go(`study/${session.id}`);}
  if(action==='mistake-state')return formModal('重新看待这次误解',`<label class="field"><span>你的判断</span><select name="action"><option value="resolve">我已修正</option><option value="dispute">我对反馈有疑问</option><option value="reopen">仍需继续练习</option><option value="revoke">撤销这条错题（保留撤销记录）</option></select></label>${area('理由与依据','reason',{required:true,rows:5})}`,async values=>{await api.post(endpoint('mistakes',id,'action'),values);await refreshBoot();notify('你的判断已记录。');});
  if(action==='defer') {await api.post(endpoint('today',id,'action'),{action:'defer',days:1});await refreshBoot();await go('today',{replace:true});notify('已留到以后，按自己的节奏来。');return;}
  if(action==='budget')return formModal('今天想留多少时间？',field('可用时间（分钟）','dailyMinutes',{value:state.boot.today?.budget||25,type:'number',required:true,extra:'min="1" max="1440"'}),async values=>{await api.put('/api/settings',{dailyMinutes:Number(values.dailyMinutes)});await refreshBoot();await go('today',{force:true,replace:true});notify('可用时间已更新。');});
  if(action==='reader-size') {const active=$('.reading-scroll').classList.toggle('large-type');control.setAttribute('aria-pressed',String(active));return;}
  if(action==='reader-abstract') {const expanded=control.closest('.desk-abstract').classList.toggle('is-expanded');control.setAttribute('aria-expanded',String(expanded));control.textContent=expanded?'收起摘要':'阅读完整摘要';return;}
  if(action==='reader-focus') {const active=$('.reader-shell').classList.toggle('focus-reading');control.setAttribute('aria-pressed',String(active));return;}
  if(action==='reader-section') {const target=document.getElementById(control.dataset.target);target?.scrollIntoView({block:'start',behavior:'instant'});target?.focus({preventScroll:true});$$('.reader-toc button').forEach(node=>node.removeAttribute('aria-current'));control.setAttribute('aria-current','location');return;}
  if(action==='prepare-learning')return prepareLearning(id);
  if(action==='research-source')return processSource(id,{research:true});
  if(action==='reader-actions') {const note=state.note;if(!note||note.id!==id)return;modal('资料操作',readerMenu(note,state.readiness));return;}
  if(action==='trash-source') {const note=await api.get(endpoint('notes',id));if(note.kind!=='source')return;if(!await confirm('把这份原文暂时放下？','原始资料会进入回收站，可以恢复。','移入回收站'))return;await api.remove(endpoint('notes',id),{expectedHash:note.hash});$$('dialog[open]').forEach(dialog=>dialog.close());await refreshBoot();await go('library');notify('原文已移入回收站。');return;}
  if(action==='process')return processSource(id);
  if(action==='extract')return extract(id);
  if(action==='promote')return promote(id);
  if(action==='understanding')return understanding(id);
  if(action==='session-understanding')return understanding(state.session.noteId,id);
  if(action==='evidence')return evidence(id);
  if(action==='hide-material') {$('#learning-material').hidden=true;$('#answer-workspace').hidden=false;$('#answer-form textarea')?.focus();return;}
  if(action==='hint') {const current=state.session;const result=await api.post(endpoint('study',id,'hint'));markAid(current);if(state.route!==`study/${id}`)return;$('#study-hint').innerHTML=`<div class="hint-note"><p class="nav-label">这次使用了提示</p><p>${e(result.hint)}</p></div>`;return;}
  if(action==='study-material'){const current=state.session;await api.post(endpoint('study',id,'hint'));markAid(current);if(state.route!==`study/${id}`)return;modal('回到本轮原文',`<p class="form-note">本轮回看原文已记录，下一轮重新独立判断。</p><div class="article-prose">${markdown(current.material).html}</div>`,{wide:true});return;}
  if(action==='finish') {await api.post(endpoint('study',id,'finish'));await refreshBoot();return go(`study/${id}`,{replace:true});}
  if(action==='new-topic')return parity.editTopic();
  if(action==='open-topic')return parity.openTopic(id);
  if(action==='topic-search') {await go('search');const form=$('#parity-search');if(form){form.elements.q.value=control.dataset.topic;form.requestSubmit();}return;}
  if(action==='open-draft')return parity.draft(id);
  if(action==='retry-job') {if(!await confirm('重新尝试这项处理？','这会继续已有任务，可能向已配置的服务发送资料并产生费用。','重新尝试'))return;await api.post(endpoint('jobs',id,'action'),{action:'retry'});return go('jobs',{replace:true});}
  if(action==='test-ai') {if(state.dirty){notify('请先保存表单，测试会使用已保存的连接设置。',true);return;}if(!await confirm('测试已保存的 AI 连接？','会向已配置的服务发送一次测试请求，可能计费。','发送测试请求'))return;const result=await api.post('/api/settings/test',{capability:'model'});if($('#ai-result'))$('#ai-result').textContent=result.message||'连接测试已返回。';notify(result.message||'连接测试已返回。');return;}
  if(await parity.handle(control)||await management.handle(control)||await focus.handle(control))return;
  if(action==='recycle')return recycle();
  if(action==='restore-source') {await api.post(endpoint('recycle-bin',id,'restore'),{versionId:control.dataset.version});control.closest('dialog')?.close();await refreshBoot();notify('资料已恢复。');return;}
}
document.addEventListener('click',event=>{
  const anchor=event.target.closest('a[href^="#"]');
  if(anchor){event.preventDefault();const target=anchor.getAttribute('href').slice(1);if(target==='main'){$('#main').focus();return;}if(target.startsWith('settings-')){document.getElementById(target)?.scrollIntoView({block:'start'});return;}go(target);return;}
  const control=event.target.closest('[data-action]');if(!control)return;
  if(event.defaultPrevented||['library-filter','member-up','member-down','member-remove','topic-add-member','confirm-merge','confirm-links','capture-draft','history-prev','history-next','accent-default','export-usage','restore-confirm','focus-export'].includes(control.dataset.action))return;
  busy(control,()=>actions(control));
});
document.addEventListener('keydown',event=>{
  if(event.isComposing||event.keyCode===229||event.defaultPrevented)return;
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'&&!document.querySelector('dialog[open]')){event.preventDefault();go('search');}
  if(event.key==='Escape'&&!document.querySelector('dialog[open]')){
    if(document.documentElement.classList.contains('nav-open')){document.documentElement.classList.remove('nav-open');$('#mobile-menu').focus();}
    else if(state.route.startsWith('read/'))go(state.readerReturn);
  }
});
$('#nav-shade').onclick=()=>document.documentElement.classList.remove('nav-open');
window.addEventListener('beforeunload',event=>{if(state.dirty||$$('dialog').some(dialog=>dialog.hasUnsavedInput?.())){event.preventDefault();event.returnValue='unsaved';}});
window.addEventListener('popstate',async()=>{const target=location.hash.slice(1)||'today';if(await go(target,{replace:true})===false)history.replaceState(null,'',`#${state.route}`);});
window.addEventListener('hashchange',async()=>{const target=location.hash.slice(1)||'today';if(target!==state.route){if(await go(target,{replace:true})===false)history.replaceState(null,'',`#${state.route}`);}});
try { await refreshBoot();await go(location.hash.slice(1)||'today',{replace:true}); }
catch(error){$('#main').innerHTML=empty('暂时连接不上知识空间',error.message,btn('重新连接','reload','primary'));}
