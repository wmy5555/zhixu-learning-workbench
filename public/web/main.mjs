import { softwareUpdateHTML, mountSoftwareUpdate } from './software-update.mjs';
import { unavailableHTML, mountUnavailable } from './today-unavailable.mjs';
import {createWebOnboarding} from './onboarding.mjs';
import { installInputModality } from './input-modality.mjs';
import { api, endpoint, pendingPlan, capturePayload } from './api.mjs';
import { escape as e, markdown } from './markdown.mjs';
import { $, $$, icon, button as btn, routeButton as link, field, area, empty, heading, calendar, notify, modal, confirm, busy, list, paginate, details } from './ui.mjs';
import { kind, purposeOptions, depthOptions } from './classification.mjs';
import { reader, updateReader } from './reader.mjs';
import { createReaderData, sameReaderData } from './reader-data.mjs';
import { readerMenu } from './reader-actions.mjs';
import { processOutcome, createProcessOutcomeRenderer } from './process-outcome.mjs';
import { springEnter } from './cds/motion-bridge.mjs';
import { mountNoteEditor, noteEditSession } from './note-editor.mjs';
import { createLibraryPage } from './library-page.mjs';
import { createSearchPage } from './search-page.mjs';
import { createParity } from './parity.mjs';
import { evidenceHTML } from './learning-display.mjs';
import { createManagement, initializeAccent } from './management.mjs';
import { createFocus } from './focus.mjs';
import { createStudyWorkspace } from './study-workspace.mjs';
import { batchImport, prepareTexts } from './batch-import.mjs';
import { captureFilesHTML, mountCaptureFiles } from './capture-files.mjs';

installInputModality(document.documentElement, document);

const navigation = [['home','今日','today'],['plus','收集与加工','capture'],['book','知识库','library'],['check','学习与错题','study'],['layers','主题学习包','topics'],['network','检索与发现','search'],['chat','问答与输出','output']];
const state = { boot:null, route:'today', sequence:0, dirty:false, saving:0, readerReturn:'library', note:null, session:null, scroll:new Map() };
const context={api,state,go,refreshBoot,formModal,submit,watchForm,savedForm,processSource};
const library = createLibraryPage(api);
const search = createSearchPage({ api, getNotes: () => state.boot.notes, getSequence: () => state.sequence, go, submit });
const parity=createParity(context),management=createManagement(context,initializeAccent()),focus=createFocus(context);
const onboarding=createWebOnboarding({api,state,go,refreshBoot,beforeLeave});
const readerData=createReaderData(api);
async function beforeLeave(){
 if(state.saving){notify('正在保存，请等操作返回后继续。');return false;}
 for(const d of [...$$('dialog[open]')].reverse())if(d.beforeClose&&!await d.beforeClose())return false;
 return !state.dirty||await confirm('离开未保存的输入？','先保存页面输入，或确认放弃后继续引导。','放弃输入并继续');
}
const formData = form => Object.fromEntries(new FormData(form));
const aiConnectionValues = form => { const {enabled,...values}=formData(form); return JSON.stringify(values); };
const noteTitle = id => list(state.boot?.notes).find(note=>note.id===id)?.title || '继续上次的学习';
const study = createStudyWorkspace({
  api, getNotes: () => state.boot.notes, noteTitle, go,
  view: () => ({ sequence: state.sequence, route: state.route }),
  setSession: session => { state.session = session; },
  bindAnswer(form, id, save) {
    watchForm(form);
    submit(form, async values => {
      await save(values.answer);
      state.dirty = false;
      await go(`study/${id}`, { replace: true, force: true });
    });
  },
});
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
async function refreshBoot() { library.invalidate();state.boot = await api.get('/api/bootstrap'); return state.boot; }
async function go(route, { replace = false, force = false, guide = false, speed = 1 } = {}) {
  if(onboarding.travelling&&!guide)return false;
  if(state.saving&&!force){notify('正在保存，请等这次操作返回后再切换。');return false;}
  const dialogs=$$('dialog[open]');
  if(!force)for(const dialog of [...dialogs].reverse())if(dialog.beforeClose&&!await dialog.beforeClose())return false;
  if (state.dirty && !force && !await confirm('放弃还没保存的输入？','当前输入还没有保存。取消可继续编辑，确认后会放弃这次输入。','放弃输入并离开')) return false;
  const fromVersion = api.getContext().version;
  await onboarding.prepareRoute(route);
  const libraryVisit = route?.split('/')[0] === 'library' ? library.visit(!guide && route === 'library') : null;
  const cachedLibrary = libraryVisit?.nodes;
  const main=$('#main'),reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let ghost;
  if(guide&&!reduce){ghost=main.cloneNode(true);ghost.removeAttribute('id');ghost.classList.add('onboard-page-ghost');ghost.inert=true;ghost.setAttribute('aria-hidden','true');ghost.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id'));const r=main.getBoundingClientRect();Object.assign(ghost.style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'});document.body.append(ghost);main.style.opacity='0';}
  study.leave();
  dialogs.forEach(dialog=>dialog.isConnected&&dialog.close());
  focus.capture();
  state.dirty = false;
  state.scroll.set(state.route, window.scrollY);
  if (route !== state.route) {
    const version = api.getContext().version;
    const resumesReader = state.readerEdit?.route === route && state.readerEdit.version === version;
    if (route.startsWith('read/') && !state.route.startsWith('read/') && !resumesReader) state.readerReturn = state.route;
    const editsReader = state.route.startsWith('read/') && route === 'edit/' + state.route.slice(5);
    state.readerEdit = editsReader && fromVersion === version ? { route: state.route, version } : null;
  }
  state.route = route || 'today';
  const sequence = ++state.sequence;
  document.documentElement.classList.toggle('reading-mode', state.route.startsWith('read/'));
  document.documentElement.classList.remove('nav-open');
  if (replace) history.replaceState(null,'',`#${state.route}`); else history.pushState(null,'',`#${state.route}`);
  shell();
  delete $('#main').dataset.route;
  const immediateReader=state.route.startsWith('read/')&&readerData.peek(state.route.split('/')[1],state.boot);
  if(!cachedLibrary&&!immediateReader)$('#main').innerHTML = '<div class="page-loading" role="status"><span></span>正在把内容放到书桌上…</div>';
  try {
    const [view,id] = state.route.split('/');
    const page = cachedLibrary?null:await ({ today:todayPage, capture:capturePage, library:library.page, read:()=>readPage(id), edit:()=>editPage(id), study:()=>study.page(id), topics:topicsPage, search:search.page, output:outputPage, settings:settingsPage, jobs:parity.jobs, relations:parity.relations, history:parity.history, manage:()=>management.page(id), focus:focus.page }[view] || todayPage)();
    if (sequence !== state.sequence) {ghost?.remove();main.style.opacity='';return false;}
    if(cachedLibrary)main.replaceChildren(...cachedLibrary);
    else{main.innerHTML=page.html;page.bind?.();}
    libraryVisit?.remember(main);
    $('#main').dataset.route=state.route;
    focus.mount();
    $('#main').focus({preventScroll:true});
    window.scrollTo({top:state.scroll.get(route)||0,behavior:'instant'});
    if(ghost){main.style.opacity='';const out=ghost.animate([{opacity:1},{opacity:0}],{duration:460/speed,fill:'forwards',easing:'ease-in-out'}),incoming=main.animate([{opacity:0,transform:'translateY(8px)'},{opacity:1,transform:'none'}],{duration:600/speed,easing:'cubic-bezier(.22,1,.36,1)'});await Promise.allSettled([out.finished,incoming.finished]);ghost.remove();}
    else if(!reduce&&!cachedLibrary&&view!=='read')springEnter(main,undefined,6,.998);
    window.dispatchEvent(new CustomEvent('zhixu:web-page'));
    return true;
  } catch(error) {
    ghost?.remove();main.style.opacity='';
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
    ${list(state.boot.today?.items).some(p=>p.state==='skip')?details('今日暂时跳过的安排',list(state.boot.today.items).filter(p=>p.state==='skip').map(p=>`<div class="knowledge-row"><span>${e(p.title)}</span>${btn('恢复今日安排','plan-action','text-button',`data-id="${e(p.id)}" data-value="resume"`)}</div>`).join('')):''}${list(state.boot.settings?.pausedIds).length?details('暂停的知识',list(state.boot.settings.pausedIds).map(id=>`<div class="knowledge-row"><span>${e(noteTitle(id))}</span>${btn('恢复安排','resume-note','text-button',`data-id="${e(id)}"`)}</div>`).join('')):''}${unavailableHTML(list(state.boot.today?.unavailable))}</section>
    <aside class="aside-stack"><section class="budget"><h2>给今天留一点空间</h2><div id="budget-summary"><div class="budget-values"><span>已安排</span><strong>${minutes}</strong><span>分钟</span></div><div class="budget-sub"><span>可用 ${budget} 分钟</span><span>${minutes>budget?'超出':'留白'} ${Math.abs(budget-minutes)} 分钟</span></div><div class="budget-meter">${Array.from({length:10},(_,i)=>`<span class="${i<Math.ceil(minutes/Math.max(1,budget)*10)?'filled':''}"></span>`).join('')}</div><p>按自己的节奏，不必填满。</p></div><div id="focus-home" hidden></div><div class="budget-entry">${btn('调整可用时间 ↗','budget','text-button')}${btn('番茄钟','focus-start','text-button')}</div></section><section class="seed"><h2>随手留下下一个起点</h2>${link(`${icon('plus')}<span><strong>收集资料</strong><small>文字、摘录，或还没想清的问题</small></span>`,'capture','seed-button')}${link(`${icon('search')}<span><strong>找回一个想法</strong><small>从已有知识中继续探索</small></span>`,'search','seed-button')}</section><section class="reflection"><small>今日提醒</small><p>说清楚哪里还不懂，<br>也是一次进步。</p></section></aside></div>
    <section class="recent"><div class="section-title"><h2>思考还在继续</h2>${link('查看全部 ↗','library','text-button')}</div><div class="recent-items">${recent.map(note=>link(`${icon(note.kind==='source'?'file':'book')}<span><strong>${e(note.title)}</strong><small>${e(note.meta?.topic||'我的知识空间')} · ${e(kind(note.kind))}</small></span>`,`read/${note.id}`,'recent-item')).join('')||'<p class="muted">第一份资料，会成为下次思考的起点。</p>'}</div></section>${jobs.length?`<div class="activity-strip"><span>${jobs.length} 项处理动态</span><span class="muted">实际进度与等待原因都保留在这里。</span>${link('查看进度 ↗','jobs','text-button')}</div>`:''}`,bind(){mountUnavailable(document.querySelector('[data-unavailable]'),list(state.boot.today?.unavailable));}};
}
function capturePage() {
  return {html:heading('COLLECT A THOUGHT','先留下，再慢慢想清楚。','一段文字、一篇文章，或一个还没有答案的问题。')+`<div class="capture-layout"><form id="capture-form" class="capture-paper">
    <input class="title-input" name="title" placeholder="给这个起点一个名字（可选）" aria-label="资料标题">
    <textarea class="capture-body" name="body" required maxlength="500000" placeholder="把想留下的内容放在这里……" aria-label="原始资料正文"></textarea>
    <details class="capture-origin"><summary>添加出处与主题</summary><div class="form-grid">${field('来自哪里','platform',{placeholder:'书籍、网页、对话……'})}${field('主题','topic',{placeholder:'这份材料与你关心的什么有关？'})}${field('原始链接','url',{type:'url',placeholder:'https://…'})}${field('作者','author')}${field('资料日期','date',{type:'date'})}${field('原文定位','locator',{placeholder:'页码、章节或段落'})}</div></details>
    <div class="capture-options"><label class="check"><input type="checkbox" name="process"> 保存后用 AI 拆解</label><label class="check dependent"><input type="checkbox" name="research" disabled> 同时联网核验</label><p class="form-note">AI 拆解会将所需原文发送给你配置的服务，可能计费。仅保存不会调用 AI。</p></div>
    <footer class="paper-footer"><span id="character-count" class="muted small">原文会完整保留</span><button class="primary" type="submit">保存这个起点 ${icon('arrow')}</button></footer><p id="capture-receipt" role="status"></p>
    </form><aside class="capture-aside"><p class="eyebrow">A PLACE TO BEGIN</p><h2>不用整理完整，<br>先把它留下来。</h2><p>资料和理解之间，可以留一点距离。</p><ol class="capture-steps"><li><span>01</span><div><strong>留下原文</strong><p>保留完整内容，以及它从哪里来。</p></div></li><li><span>02</span><div><strong>读出自己的问题</strong><p>在书桌里阅读，再决定哪些值得继续。</p></div></li><li><span>03</span><div><strong>形成自己的解释</strong><p>拆解是建议，理解由你亲自确认。</p></div></li></ol>${captureFilesHTML()}</aside></div>`,
    bind() {
      const form=$('#capture-form');watchForm(form);
      mountCaptureFiles(document.querySelector('#capture-files'), {
        api, state, afterSave:async()=>{await refreshBoot();shell();},
        onPending:pending=>{state.dirty=pending||form.dataset.dirty==='true';},
        onTexts:async files=>{
          if(files.length>1){await batchImport(files,context);return;}
          const [row]=await prepareTexts(files);
          if(!form.isConnected)return;
          if(form.dataset.dirty==='true'&&!await confirm('替换编辑区的内容？','尚未保存的文字会被所选文本替换。','替换文字'))return;
          if(!form.isConnected)return;
          form.elements.body.value=row.body;form.elements.title.value ||= row.title;
          form.dataset.dirty='true';state.dirty=true;form.elements.body.oninput();
        }
      });
      const process=form.elements.process,research=form.elements.research;
      process.onchange=()=>{research.disabled=!process.checked;if(!process.checked)research.checked=false;};
      form.elements.body.oninput=()=>{$('#character-count').textContent=`${form.elements.body.value.length.toLocaleString()} 字 · 原文会完整保留`;};
      submit(form,async values=>{
        const snapshot=JSON.stringify(formData(form));
        const result=await api.post('/api/import',capturePayload({...values,process:process.checked,research:research.checked}));
        if(JSON.stringify(formData(form))===snapshot){savedForm(form);state.dirty ||= Boolean(document.querySelector('#capture-files [data-pending]'));form.reset();research.disabled=true;}
        const source=result.notes?.[0];$('#capture-receipt').innerHTML=`已保存：${e(source?.title||'原始资料')} ${source?link('现在打开书桌 ↗',`read/${source.id}`,'text-button'):''}`;
        $('#character-count').textContent='原文会完整保留';notify('原文已完整保存。');await refreshBoot();shell();
      });
    }};
}
function readPage(id) {
  const sequence = state.sequence, boot = state.boot;
  const { version, revision } = api.getContext();
  const current = () => {
    const latest = api.getContext();
    return sequence === state.sequence && boot === state.boot && version === latest.version && revision === latest.revision;
  };
  const display=data=>{
    if(current()){state.note=data.note;state.readiness=data.readiness;}
    return reader(data.note,list(boot.notes),state.readerReturn,data.related,data.readiness);
  };
  const initial=readerData.peek(id,boot);
  if(!initial)return readerData.load(id,boot).then(display);
  return {...display(initial),bind(){
    const root=$('.reader-shell');
    readerData.load(id,boot).then(data=>{
      if(!current()||!root.isConnected)return;
      if(sameReaderData(initial,data)){state.note=data.note;state.readiness=data.readiness;return;}
      updateReader(root,display(data).html);
    }).catch(error=>{if(current()&&root.isConnected)notify(error.message);});
  }};
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
async function topicsPage() {
  const topics=list((await api.get('/api/topics')).topics);
  return {html:heading('FOLLOW YOUR CURIOSITY','沿着一个问题，慢慢深入。','让分散的资料围绕一个问题，形成可以继续探索的路径。',btn(`${icon('plus')} 新建学习包`,'new-topic','primary'))+
    `<div class="topic-grid">${topics.map((topic,index)=>`<article class="topic-cover"><p class="topic-number">${String(index+1).padStart(2,'0')}</p><h2>${e(topic.title)}</h2><p>${e(String(topic.body||'').replace(/[#>*]/g,'').slice(0,90))}</p><footer><span>${list(topic.meta?.noteIds||topic.noteIds).length} 条知识</span>${btn('打开学习路径 ↗','open-topic','text-button',`data-id="${e(topic.id)}"`)}</footer></article>`).join('')||empty('想围绕什么，学得更深入？','选一个你反复想起的问题，把相关的知识放在一起。',btn('建立第一个学习包','new-topic','primary'))}</div>`};
}
async function outputPage() {
  const drafts=list((await api.get('/api/drafts')).drafts);
  return {html:heading('MAKE SOMETHING OF IT','让已有的理解，成为新的表达。','从自己的资料出发，整理成答案、提纲或一份草稿。')+
    `<div class="output-layout"><form id="output-form" class="output-composer">${area('这一次，想完成什么？','question',{placeholder:'例如：基于我保存的阅读笔记，整理一份关于主动回忆的分享提纲……',required:true,rows:7})}<div class="segmented"><label><input type="radio" name="mode" value="answer" checked> 回答问题</label><label><input type="radio" name="mode" value="outline"> 组织提纲</label><label><input type="radio" name="mode" value="draft"> 写一份草稿</label></div>${details('取材范围',`<div class="form-grid">${[['knowledge','知识'],['source','原始资料']].map(([v,l])=>`<label class="check"><input type="checkbox" name="scope" value="${v}" ${['knowledge','source'].includes(v)?'checked':''}>${l}</label>`).join('')}</div>`)}<label class="check"><input type="checkbox" name="cloud"> 允许本次将所需资料发送给已配置的 AI 服务</label><p class="form-note">未勾选时只在本地检索与整理。AI 生成可能计费，结果仍需你核对。</p><button class="primary" type="submit">从我的资料开始 ${icon('arrow')}</button></form><aside class="output-aside"><p class="eyebrow">WORDS WITH ROOTS</p><h2>有出处的表达，<br>才接得住追问。</h2><p>每个结论都可以回到原文。生成内容是草稿，采用之后也不会自动成为个人知识。</p></aside></div><section id="output-result"></section>
    <section class="recent"><div class="section-title"><h2>写过的草稿</h2></div><div id="all-drafts"></div></section>`,
    bind(){paginate($('#all-drafts'),drafts,draft=>btn(`<strong>${e(draft.title||draft.question||'输出草稿')}</strong><small>继续编辑 ↗</small>`,'open-draft','draft-row',`data-id="${e(draft.id)}"`));const form=$('#output-form');watchForm(form);let intent='',requestId='';submit(form,async values=>{const payload={question:values.question,mode:values.mode,scope:[...form.querySelectorAll('[name="scope"]:checked')].map(n=>n.value),privacy:form.elements.cloud.checked?'cloud':'local'};if(!payload.scope.length)throw Error('请至少选择一种取材范围。');const key=JSON.stringify(payload);if(intent!==key){intent=key;requestId=crypto.randomUUID();}const route=state.sequence;const result=await api.post('/api/ask',{...payload,requestId});if(route!==state.sequence)return;state.dirty=false;$('#output-result').innerHTML=`<article class="output-document" data-output-draft="${e(result.draftId||'')}"><p class="eyebrow">${result.generated?'AI 生成 · 请核对':'本地检索与整理'}</p><div class="article-prose">${markdown(result.answer).html}</div>${details('引用、摘录与核验',evidenceHTML(result.citations),!list(result.citations).length).replace('<details ', '<details data-output-citations ')}${result.draftId?btn('编辑草稿与标记采用','open-draft','text-button',`data-id="${e(result.draftId)}"`):''}${list(result.limitations).map(item=>`<p class="form-note">${e(item)}</p>`).join('')}</article>`;});}};
}
async function settingsPage() {
  const settings=await api.get('/api/settings'), ai=settings.ai||{};
  return {html:heading('MAKE ROOM FOR YOURSELF','把工作台，调成自己的节奏。','少一点打扰，让工具服务于你的理解。')+
    `<div class="settings-layout"><nav class="settings-nav" aria-label="设置章节"><a href="#settings-rhythm">学习节奏</a><a href="#settings-appearance">阅读与外观</a><a href="#settings-ai">AI 连接</a><a href="#settings-guide">新手引导</a><a href="#settings-update">软件更新</a>${link('处理动态 ↗','jobs','text-button')}${link('更多设置与管理 ↗','manage','text-button')}${link('学习时长 ↗','focus','text-button')}</nav><div class="settings-sections">
    <section id="settings-rhythm"><p class="eyebrow">YOUR OWN PACE</p><h2>给每天留一点时间</h2><p class="muted">这是安排学习的参考，不是必须完成的目标。</p><form id="rhythm-form"><div class="form-grid">${field('每天可用时间（分钟）','dailyMinutes',{type:'number',value:settings.dailyMinutes||25,required:true,extra:'min="5" max="240"'})}${field('主题关注范围','focusTopics',{value:list(settings.focusTopics).join('，'),placeholder:'多个主题用逗号分开'})}</div><button class="primary" type="submit">保存学习节奏</button></form></section>
    <section id="settings-appearance"><p class="eyebrow">READING & APPEARANCE</p><h2>喜欢什么样的光线？</h2><div class="theme-options">${btn('<span class="theme-swatch light-swatch"></span><strong>日光</strong><small>暖白纸面，陶土色细节</small>','set-light','theme-option')}${btn('<span class="theme-swatch dark-swatch"></span><strong>夜读</strong><small>柔和深灰，让眼睛安静下来</small>','set-dark','theme-option')}</div></section>
    <section id="settings-ai"><p class="eyebrow">AN OPTIONAL THINKING PARTNER</p><h2>连接你的 AI</h2><p class="muted">保留原文、阅读和文字检索可以独立使用。连接之后，拆解、反馈与生成仍由你主动发起。</p><form id="ai-form"><label class="check"><input type="checkbox" name="enabled" ${ai.enabled?'checked':''}> 启用文本 AI</label><div class="form-grid">${field('服务地址','baseUrl',{value:ai.baseUrl||'',type:'url',placeholder:'https://api.example.com/v1'})}${field('模型名称','model',{value:ai.model||'',placeholder:'模型标识'})}${field('API Key（留空保留已保存的密钥）','apiKey',{type:'password',extra:'autocomplete="new-password"'})}${field('每日调用上限','dailyCallLimit',{type:'number',value:ai.dailyCallLimit??100,extra:'min="0"'})}</div><p class="form-note">密钥只交给本机后端保存，不在网页缓存或显示。保存本身不发送模型请求。</p><div class="actions"><button class="primary" type="submit">保存连接设置</button>${btn('测试已保存的连接','test-ai','text-button')}</div><p id="ai-result" role="status"></p></form></section>
    <section><p class="eyebrow">YOUR KNOWLEDGE STAYS YOURS</p><h2>资料与备份</h2><p class="muted">你的原文和学习记录保存在本机。导出备份不包含连接密钥。</p><div class="actions"><a class="secondary" href="${api.url('/api/backup')}" download>下载完整备份</a>${btn('查看回收站','recycle','text-button')}${link('预览并恢复完整备份','manage/restore','text-button')}${btn('恢复已移除知识','deleted-notes','text-button')}</div></section>
    <section id="settings-guide"><h2>新手引导</h2><button type="button" class="secondary" data-guide="welcome">打开新手引导</button></section>
    ${softwareUpdateHTML()}
    </div></div>`,
    bind(){mountSoftwareUpdate();const rhythm=$('#rhythm-form');watchForm(rhythm);submit(rhythm,async values=>{await api.put('/api/settings',{dailyMinutes:Number(values.dailyMinutes),focusTopics:values.focusTopics.split(/[,，]/).map(s=>s.trim()).filter(Boolean)});savedForm(rhythm);await refreshBoot();notify('学习节奏已保存。');});
      const form=$('#ai-form');watchForm(form);form.dataset.connectionValues=aiConnectionValues(form);submit(form,async values=>{await api.put('/api/settings',{ai:{enabled:form.elements.enabled.checked,baseUrl:values.baseUrl,model:values.model,...(values.apiKey?{apiKey:values.apiKey}:{}),dailyCallLimit:Number(values.dailyCallLimit)}});form.elements.apiKey.value='';form.dataset.connectionValues=aiConnectionValues(form);savedForm(form);await refreshBoot();$('#ai-result').textContent='设置已保存。尚未测试连接。';notify('连接设置已保存。');});}};
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
async function processSource(id, { research = false } = {}) {
  const sequence=state.sequence,returnTo=state.route.startsWith('read/')?state.route:`read/${id}`;
  const note=await api.get(endpoint('notes',id));
  if(sequence!==state.sequence)return;
  let timer,job,selectedResearch=research,reading=false,sending=false;
  const dialog=modal(research?'补充这份资料的核验':'把这份原文交给 AI 拆解？',`<p><strong>${e(note.title)}</strong></p><p>将必要原文发送给已配置的服务，可能计费。已有拆解会复用；核验不会自动确认个人理解。</p><label class="check"><input type="checkbox" name="research" ${research?'checked':''}> 联网核验事实、条件与反例</label><p class="form-note">不勾选也能整理和学习，待核验之处会继续标明。人工修改或进行中的练习会保留，新证据另存为修订建议。</p><div class="actions"><button class="primary" data-run>确认${research?'核验':'拆解'}</button></div>`,{onClose:()=>clearTimeout(timer)});
  const current=()=>dialog.isConnected&&dialog.open&&sequence===state.sequence;
  const updateOutcome=createProcessOutcomeRenderer(dialog.querySelector('.dialog-body'));
  const render=(pendingProposals=0)=>{
    if(!current())return;
    const view=processOutcome(job,{research:selectedResearch,sourceId:id,returnTo,pendingProposals});
    dialog.querySelector('h2').textContent=view.title;dialog.setAttribute('aria-label',view.title);
    const body=dialog.querySelector('.dialog-body'),hadFocus=body.contains(document.activeElement)||document.activeElement===document.body;
    if(!updateOutcome(view))return;
    const retry=body.querySelector('[data-process-retry]');
    if(retry)retry.onclick=event=>busy(event.currentTarget,()=>send(job.id));
    const researchButton=body.querySelector('[data-process-research]');
    if(researchButton)researchButton.onclick=event=>busy(event.currentTarget,()=>send());
    body.querySelector('[data-process-refresh]').onclick=event=>busy(event.currentTarget,read);
    if(hadFocus)(retry||researchButton||body.querySelector('[data-process-refresh]')).focus({preventScroll:true});
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
  const dialog=formModal('怎样继续这条知识？',`<p>${e(note.title)}</p><label class="field"><span>接下来的用途</span><select name="stage">${purposeOptions.map(([value,label])=>`<option value="${value}" ${note.meta?.stage===value?'selected':''}>${label}</option>`).join('')}</select></label><label class="field"><span>希望达到什么程度</span><select name="depth">${depthOptions.map(([value,label])=>`<option value="${value}" ${(note.meta?.depth||'explain')===value?'selected':''}>${label}</option>`).join('')}</select></label>${area('写一点理由，留给以后的自己','reason',{placeholder:'（可选）',rows:3})}`,async values=>{
    await api.post(endpoint('notes',id,'promote'),values);await refreshBoot();await go(state.route,{force:true,replace:true});notify('学习安排已更新。');
  });
  dialog.dataset.guideForm='learning';dialog.dataset.guideNote=id;
}
async function understanding(id, sessionId = '') {
  const note=await api.get(endpoint('notes',id));
  formModal('这是我现在的理解',`<p>${e(note.title)}</p>${area('亲自写下自己的解释','body',{required:true,placeholder:'用自己的话说明结论、例子与边界。',rows:10})}<p class="form-note">这次确认与原文、AI 建议分别保留。确认理解不等于永久掌握。</p>`,async values=>{
    await api.post(sessionId?endpoint('study',sessionId,'confirm'):endpoint('notes',id,'confirm'),{body:values.body,...(!sessionId?{expectedHash:note.hash}:{})});await refreshBoot();notify('你的理解已单独确认保存。');
  },{wide:true});
}
async function evidence(id) {
  const data=await api.get(endpoint('notes',id,'evidence'));
  modal('回到依据与出处',evidenceHTML(list(data.evidence).map(item=>({...item,researchedAt:item.researchedAt||data.researchedAt})),data.limitations),{wide:true});
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
  if(action==='start-plan') {const plan=pendingPlan(state.boot.today).items.find(item=>item.id===id);if(plan)return study.start(plan.noteId,plan.id);return;}
  if(action==='start-note')return study.start(id);
  if(action==='start-mistake')return study.start(control.dataset.note, undefined, { mistakeId: id });
  if(action==='topic-next')return study.start(control.dataset.note, undefined, { topicId: id, dialog: control.closest('dialog') });
  if(action==='mistake-state')return formModal('重新看待这次误解',`<label class="field"><span>你的判断</span><select name="action"><option value="resolve">我已修正</option><option value="dispute">我对反馈有疑问</option><option value="reopen">仍需继续练习</option><option value="revoke">撤销这条错题（保留撤销记录）</option></select></label>${area('理由与依据','reason',{required:true,rows:5})}`,async values=>{await api.post(endpoint('mistakes',id,'action'),values);await refreshBoot();notify('你的判断已记录。');});
  if(action==='defer') {await api.post(endpoint('today',id,'action'),{action:'defer',days:1});await refreshBoot();await go('today',{replace:true});notify('已留到以后，按自己的节奏来。');return;}
  if(action==='budget')return formModal('今天想留多少时间？',field('可用时间（分钟）','dailyMinutes',{value:state.boot.today?.budget||25,type:'number',required:true,extra:'min="1" max="1440"'}),async values=>{await api.put('/api/settings',{dailyMinutes:Number(values.dailyMinutes)});await refreshBoot();await go('today',{force:true,replace:true});notify('可用时间已更新。');});
  if(action==='reader-size') {const active=$('.reading-scroll').classList.toggle('large-type');control.setAttribute('aria-pressed',String(active));return;}
  if(action==='reader-abstract') {const expanded=control.closest('.desk-abstract').classList.toggle('is-expanded');control.setAttribute('aria-expanded',String(expanded));control.textContent=expanded?'收起摘要':'阅读完整摘要';return;}
  if(action==='reader-focus') {const active=$('.reader-shell').classList.toggle('focus-reading');control.setAttribute('aria-pressed',String(active));return;}
  if(action==='reader-section') {const target=document.getElementById(control.dataset.target);target?.scrollIntoView({block:'start',behavior:'instant'});target?.focus({preventScroll:true});$$('.reader-toc button').forEach(node=>node.removeAttribute('aria-current'));control.setAttribute('aria-current','location');return;}
  if(action==='prepare-learning')return study.prepare(id);
  if(action==='research-source')return processSource(id,{research:true});
  if(action==='reader-actions') {const note=state.note;if(!note||note.id!==id)return;modal('资料操作',readerMenu(note,state.readiness));return;}
  if(action==='trash-source') {const note=await api.get(endpoint('notes',id));if(note.kind!=='source')return;if(!await confirm('把这份原文暂时放下？','原始资料会进入回收站，可以恢复。','移入回收站'))return;await api.remove(endpoint('notes',id),{expectedHash:note.hash});$$('dialog[open]').forEach(dialog=>dialog.close());await refreshBoot();await go('library');notify('原文已移入回收站。');return;}
  if(action==='process')return processSource(id);
  if(action==='extract')return extract(id);
  if(action==='promote')return promote(id);
  if(action==='understanding')return understanding(id);
  if(action==='session-understanding')return understanding(state.session.noteId,id);
  if(action==='evidence')return evidence(id);
  if(action==='hide-material')return study.hideMaterial();
  if(action==='hint'||action==='study-material')return study.useAid(state.session,id,action==='study-material');
  if(action==='finish') {
    if(state.dirty && !await confirm('结束本轮学习？','输入框中尚未保存的回答不会计入本轮。取消可继续编辑。','结束本轮学习'))return;
    const sequence=state.sequence, form=control.closest('form'), wasInert=form?.inert;
    state.saving++;if(form)form.inert=true;
    try {
      await api.post(endpoint('study',id,'finish'));await refreshBoot();
      if(sequence!==state.sequence)return;
      state.dirty=false;return await go(`study/${id}`,{replace:true,force:true});
    } finally { state.saving--;if(form)form.inert=wasInert; }
  }
  if(action==='new-topic')return parity.editTopic();
  if(action==='open-topic')return parity.openTopic(id);
  if(action==='topic-search')return search.openQuery(control.dataset.topic);
  if(action==='open-draft')return parity.draft(id);
  if(action==='retry-job') {if(!await confirm('重新尝试这项处理？','这会继续已有任务，可能向已配置的服务发送资料并产生费用。','重新尝试'))return;await api.post(endpoint('jobs',id,'action'),{action:'retry'});return go('jobs',{replace:true});}
  if(action==='test-ai') {
    if(state.saving)return;
    const form=$('#ai-form');
    if(!form)return;
    form.elements.enabled.checked=true;
    if(aiConnectionValues(form)!==form.dataset.connectionValues||$$('#main form').some(item=>item!==form&&item.dataset.dirty==='true')){
      form.dataset.dirty='true';state.dirty=true;
      notify('请先保存表单，测试会使用已保存的连接设置。',true);return;
    }
    if(state.boot.settings.ai.enabled)savedForm(form);
    else {form.dataset.dirty='true';state.dirty=true;}
    const wasInert=form.inert;state.saving++;form.inert=true;
    try {
      if(!await confirm('测试已保存的 AI 连接？','会启用文本 AI，并向已配置的服务发送一次测试请求，可能计费。','发送测试请求'))return;
      if(!state.boot.settings.ai.enabled){
        await api.put('/api/settings',{ai:{enabled:true}});
        savedForm(form);await refreshBoot();
      }
      const result=await api.post('/api/settings/test',{capability:'model'});
      if($('#ai-result'))$('#ai-result').textContent=result.message||'连接测试已返回。';
      notify(result.message||'连接测试已返回。');
    } finally {state.saving--;form.inert=wasInert;}
    return;
  }
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
// Back/forward also emits hashchange; a second popstate handler would ask twice before go resolves.
window.addEventListener('hashchange',async()=>{const target=location.hash.slice(1)||'today';if(target!==state.route){if(await go(target,{replace:true})===false)history.replaceState(null,'',`#${state.route}`);}});
try { await onboarding.initialize();await refreshBoot();await go(location.hash.slice(1)||'today',{replace:true});await onboarding.ready(); }
catch(error){$('#main').innerHTML=empty('暂时连接不上知识空间',error.message,btn('重新连接','reload','primary'));}
