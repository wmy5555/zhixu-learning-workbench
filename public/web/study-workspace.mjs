import { createStudyStarter } from '../study-start.mjs';
import { isStudyStage } from '../note-classification.mjs';
import { endpoint } from './api.mjs';
import { escape as e, markdown } from './markdown.mjs';
import { $, icon, button as btn, routeButton as link, area, empty, heading, jobState, notify, modal, list } from './ui.mjs';
import { kind, stage } from './classification.mjs';
import { learningReadiness, learningHelp, credibilityNotice } from './reader-actions.mjs';
import { feedbackHTML, completionHTML } from './learning-display.mjs';
import { watchStudyFeedback, feedbackPending } from './study-feedback.mjs';
import { aidUsed, markAid, clearAid } from './study-aid.mjs';

const noteRows = notes => notes.map((note,index)=>`<article class="knowledge-row"><span class="task-index">${String(index+1).padStart(2,'0')}</span><div><h3>${e(note.title)}</h3><p>${e(kind(note.kind))} · ${e(stage(note.meta?.stage))}</p></div>${link('阅读 ↗',`read/${note.id}`,'text-button')}</article>`).join('');

export function createStudyWorkspace({ api, getNotes, noteTitle, view, go, setSession, bindAnswer,
  showHelp = (note, readiness) => modal(readiness.heading, learningHelp(note, readiness)) }) {
  const submitStart = createStudyStarter(() => api.getContext(), body => api.post('/api/study/start', body));
  let stopStudyFeedback = () => {};

  async function studyPage(id) {
    if(id)return sessionPage(id);
    const sessions=list((await api.get('/api/study')).sessions), notes=list(getNotes()).filter(n=>n.kind==='knowledge'&&isStudyStage(n.meta?.stage));
    const mistakes=list((await api.get('/api/mistakes')).mistakes);
    return {html:heading('UNDERSTANDING TAKES PRACTICE','慢一点，把理解说清楚。','先尝试回忆，再核对材料。回答、反馈与自己确认的理解分别保留。')+
      `<div class="study-overview"><section><div class="section-title"><h2>正在学习 <small>${notes.length} 条</small></h2></div>${notes.map((note,index)=>`<article class="task-row"><span class="task-index">${String(index+1).padStart(2,'0')}</span><div class="task-copy"><h3>${e(note.title)}</h3><div class="task-meta">${e(note.meta?.topic||'我的学习')}</div></div>${btn(`开始 ${icon('arrow')}`,'start-note','start',`data-id="${e(note.id)}"`)}</article>`).join('')||empty('还没选好要学什么','在知识的书桌中选择“加入学习”，再从这里开始。',link('去知识库看看','library','text-button'))}</section>
    <aside class="study-history"><p class="eyebrow">PICK UP WHERE YOU LEFT OFF</p><h2>接着上一次思考</h2><div class="actions">${link('完整学习历史 ↗','history','text-button')}${link('学习时长 ↗','focus','text-button')}</div>${sessions.slice(0,6).map(s=>link(`<strong>${e(noteTitle(s.noteId))}</strong><small>${e(jobState(s.status))} · ${list(s.turns).length} 次回答</small>`,`study/${s.id}`,'history-item')).join('')||'<p class="muted">开始之后，你的思考会留在这里。</p>'}</aside></div>
    <section class="recent"><div class="section-title"><h2>再想一想 <small>${mistakes.length} 条错题</small></h2></div>${mistakes.length?noteRows(mistakes):'<p class="muted">遇到的误解会保留下来，成为下一次理解的起点。</p>'}</section>`};
  }
  async function sessionPage(id, loaded) {
    const session=loaded || await api.get(endpoint('study',id));
    const turns=list(session.turns), waiting=feedbackPending(session), completed=session.status==='completed';
    const title=noteTitle(session.noteId), material=markdown(session.material).html;
    return {html:heading('ONE THOUGHT AT A TIME',title,`${e(session.goal||'用自己的话解释')} · ${jobState(session.status)}`,link('回到学习池','study','text-button'))+
      `${credibilityNotice(session.materialWarnings,session.noteId)}<div class="learning-workspace"><section class="learning-page">${!turns.length?`<div class="learning-material" id="learning-material"><p class="eyebrow">先阅读，然后合上材料</p><div class="article-prose">${material}</div><div class="actions">${btn('合上材料，试着解释','hide-material','primary')}${link('在书桌里读',`read/${session.noteId}`,'text-button')}</div></div>`:''}
    <div id="answer-workspace" ${!turns.length?'hidden':''}><div class="learning-question"><p class="eyebrow">这一次，试着回答</p><h2>${e(session.question)}</h2></div>
    ${turns.map((turn,index)=>`<section class="learning-turn"><p class="nav-label">第 ${index+1} 次 · 我的回答 · ${turn.hintUsed?'使用过提示或原文':'独立作答'}</p><div class="answer-prose">${e(turn.answer).replaceAll('\n','<br>')}</div>${feedbackHTML(turn.feedback)}</section>`).join('')}
    ${waiting?`<div class="waiting-note" role="status"><span class="status-pulse"></span><div><strong>你的回答已保存</strong><p>正在等待 AI 反馈，返回后会自动显示。可以离开，之后从学习记录继续。</p><div class="actions">${btn('查看最新反馈','reload','text-button')} ${link('处理动态 ↗','jobs','text-button')}${btn('结束本轮学习','finish','text-button',`data-id="${e(id)}" disabled title="收到反馈后即可结束"`)}</div></div></div>`:completed?`<div class="completion-note"><h2>这一次思考，已经留下来了。</h2><p>${e(session.completion?.reason||'学习记录已保存。')}</p>${completionHTML(session.completion)}${link('回到今天','today','text-button')}</div>`:`<form id="answer-form">${area('我的解释','answer',{placeholder:'不用完美。先写下此刻的理解，再找一个自己的例子。',required:true,rows:9})}<div class="answer-actions"><div class="answer-aids">${btn('需要一点提示','hint','text-button',`data-id="${e(id)}"`)}${btn('再看原文','study-material','text-button',`data-id="${e(id)}"`)}</div><div class="answer-submit">${btn('结束本轮学习','finish','text-button',`data-id="${e(id)}" ${!turns.length?'disabled title="先保存一次回答并收到反馈"':''}`)}<button type="submit" class="primary">保存回答，获取反馈 ${icon('arrow')}</button></div></div><p class="form-note">回答会保存到本机；AI 反馈使用已配置的服务，可能计费。未配置时保留回答并等待。</p></form>`}</div></section>
    <aside class="learning-companion"><p class="eyebrow">给思考一点空间</p><h2>不是把答案写对，<br>而是看见自己怎么想。</h2><p>先说出结论，再补充理由。对不确定的部分，也可以明确写下。</p><div id="study-hint">${aidUsed(session)?'<p class="form-note">本轮已使用提示或回看原文，回答会如实记录。</p>':''}</div>${turns.length?`<div class="margin-actions">${btn('确认我的理解','session-understanding','text-button',`data-id="${e(id)}"`)}</div>`:''}</aside></div>`,
      bind(){
        setSession(session);
        if(waiting){
          const sequence=view().sequence, host=$('#main');
          const isCurrent=()=>view().sequence===sequence && view().route===`study/${id}` && host.isConnected;
          stopStudyFeedback=watchStudyFeedback({
            read:signal=>api.get(endpoint('study',id),{signal}),isCurrent,
            async onReady(next){
              if(!isCurrent())return;
              const page=await sessionPage(id,next);
              if(!isCurrent())return;
              const scroll=window.scrollY;
              host.innerHTML=page.html;page.bind?.();
              window.scrollTo({top:scroll,behavior:'instant'});
            }
          });
        }
        const form = $('#answer-form');
        if (form) {
          const requestId = crypto.randomUUID();
          bindAnswer(form, id, async answer => {
            await api.post(endpoint('study', id, 'answer'), { answer, hintUsed: aidUsed(session), requestId });
            clearAid(session);
          });
        }
      }
    };
  }

  function startStudy(noteId, planId, { topicId, mistakeId, dialog } = {}) {
    const sequence = view().sequence, library = api.getContext().version;
    const current = () => sequence === view().sequence && library === api.getContext().version
      && (!dialog || (dialog.isConnected && dialog.open));
    const input = { noteId, ...(planId ? { planId } : {}), ...(topicId ? { topicId } : {}), ...(mistakeId ? { mistakeId } : {}) };
    return submitStart(input, async submit => {
      if (!topicId && !mistakeId) {
        const note = await api.get(endpoint('notes', noteId));
        if (!current()) return;
        const readiness = await readReadiness(note);
        if (!current()) return;
        if (!readiness.ready) { showHelp(note, readiness); return; }
      }
      let session;
      try { session = await submit(); }
      catch (error) {
        if (!current()) return;
        if (!topicId && !mistakeId && error.code === 'NOTE_UNAVAILABLE') return prepareLearning(noteId);
        throw error;
      }
      if (!current()) return;
      dialog?.close();
      return go(`study/${session.id}`);
    });
  }
  async function readReadiness(note) {
    const data=await api.get(endpoint('notes',note.id,'evidence'));
    return learningReadiness(note,list(getNotes()),list(data.limitations));
  }
  async function prepareLearning(id) {
    const sequence=view().sequence;
    const note=await api.get(endpoint('notes',id)),readiness=await readReadiness(note);
    if(sequence!==view().sequence)return;
    if(readiness.ready){notify('可以开始学习；可信度提示会随材料保留。');return go(view().route,{replace:true});}
    showHelp(note,readiness);
  }

  async function hideMaterial() {
    $('#learning-material').hidden = true;
    $('#answer-workspace').hidden = false;
    $('#answer-form textarea')?.focus();
    const { practiceId } = api.getContext();
    if (practiceId) await api.post('/api/onboarding/event', { practiceId, event: 'study-hide' });
  }

  async function useAid(session, id, readMaterial) {
    const result = await api.post(endpoint('study', id, 'hint'));
    markAid(session);
    if (view().route !== `study/${id}`) return;
    if (readMaterial) {
      modal('回到本轮原文', `<p class="form-note">本轮回看原文已记录，下一轮重新独立判断。</p><div class="article-prose">${markdown(session.material).html}</div>`, { wide: true });
    } else {
      $('#study-hint').innerHTML = `<div class="hint-note"><p class="nav-label">这次使用了提示</p><p>${e(result.hint)}</p></div>`;
    }
  }

  return { page: studyPage, leave: () => stopStudyFeedback(), start: startStudy, prepare: prepareLearning, hideMaterial, useAid };
}
