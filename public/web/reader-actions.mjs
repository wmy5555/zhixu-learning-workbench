import { escape as e } from './markdown.mjs';
import { button, routeButton, icon } from './ui.mjs';

// Reasons come from the existing evidence endpoint; eligibility stays on the server.
export function learningReadiness(note, notes = [], limitations = note.meta?.researchLimitations || []) {
  const meta = note.meta || {};
  const reasons = [...new Set(limitations.filter(value => typeof value === 'string' && value.trim()))];
  if (meta.supersededBy) return { ready:false, heading:'这条知识已有替代条目', reasons:['请查看保留的知识，旧条目不能继续学习。'], replacementId:meta.supersededBy };
  if (meta.stage === 'retired') return { ready:false, heading:'这条知识已暂停使用', reasons:['如需继续，请在学习安排中重新选择用途并填写理由。'], arrange:true };
  const inputIds = [...new Set((meta.sources || []).filter(ref => ref.role === 'input').map(ref => ref.id))];
  const sourceId = meta.processKey ? meta.processKey.split(':')[0] : inputIds.length === 1 ? inputIds[0] : null;
  const source = notes.find(item => item.id === sourceId && item.kind === 'source');
  const credibility = { warnings:reasons, sourceId:source?.id, sourceTitle:source?.title };
  if (!['learning','integrated','core'].includes(meta.stage)) return { ...credibility, ready:false, heading:'还未加入学习', reasons:['选择学习目标并填写理由后，就可以开始。联网核验可以稍后补充。'], arrange:true };
  return { ...credibility, ready:true, reasons:[] };
}

export function credibilityNotice(warnings = [], noteId = '', sourceId = '') {
  if (!warnings.length) return '';
  return `<details class="reader-readiness credibility-notice"><summary>材料仍有待核验之处 <span>可以先学习</span></summary><p>学习帮助你理解材料，不代表其中的结论已经证实。引用或应用前，请核对依据与适用条件。</p><div class="credibility-detail"><ul class="learning-reasons">${warnings.map(reason=>`<li>${e(reason)}</li>`).join('')}</ul><div class="actions">${noteId ? button('查看依据与来源','evidence','text-button',`data-id="${e(noteId)}"`) : ''}${sourceId ? button('补充联网核验','research-source','text-button',`data-id="${e(sourceId)}"`) : ''}</div></div></details>`;
}

export function learningNotice(note, readiness) {
  if (note.kind !== 'knowledge') return '';
  return (readiness.ready ? '' : `<section class="reader-readiness" aria-label="学习条件"><h2>${e(readiness.heading)}</h2><p>${e(readiness.reasons[0])}</p>${button(readiness.arrange ? '选择学习安排' : '处理学习条件', 'prepare-learning', 'text-button', `data-id="${e(note.id)}"`)}</section>`)+credibilityNotice(readiness.warnings,note.id,readiness.sourceId);
}

export function learningHelp(note, readiness) {
  const id = `data-id="${e(note.id)}"`;
  return `<div class="reader-menu"><p class="reader-menu-title">${e(note.title)}</p><ul class="learning-reasons">${readiness.reasons.map(reason => `<li>${e(reason)}</li>`).join('')}</ul>
    ${readiness.replacementId ? routeButton('查看保留的知识', `read/${readiness.replacementId}`, 'primary')
      : readiness.arrange ? button('调整学习安排', 'promote', 'primary', id)
      : readiness.ready ? button('开始学习','start-note','primary',id) : ''}
    ${credibilityNotice(readiness.warnings,note.id,readiness.sourceId)}
    <div class="reader-help-links">${button('查看依据与来源', 'evidence', 'text-button', id)}${routeButton('查看处理任务', 'jobs', 'text-button')}</div></div>`;
}

export function readerMenu(note, readiness) {
  const id = `data-id="${e(note.id)}"`;
  const row = (label, action, symbol = 'book', css = '') => button(`${icon(symbol)}<span>${label}</span>`, action, `reader-menu-row ${css}`, id);
  const knowledge = note.kind === 'knowledge', source = note.kind === 'source';
  const primary = knowledge ? button(readiness.ready ? '开始学习' : '处理学习条件', readiness.ready ? 'start-note' : 'prepare-learning', 'primary', id)
    : source ? button('AI 拆解这份资料', 'process', 'primary', id) : '';
  const learning = knowledge ? row('调整学习安排','promote','calendar') + row('确认我的理解','understanding','check') + row('查看依据与来源','evidence','file')
    : source ? row('自己整理一条知识','extract','plus') : note.kind === 'mistake' ? button('针对这次误解练习','start-mistake','reader-menu-row',`${id} data-note="${e(note.meta?.noteId || '')}"`) : '';
  return `<div class="reader-menu"><p class="reader-menu-title">${e(note.title)}</p>
    ${primary ? `<section class="reader-menu-primary">${knowledge && !readiness.ready ? `<p class="form-note">${e(readiness.heading)} · ${e(readiness.reasons[0])}</p>` : ''}${primary}</section>` : ''}
    <section class="reader-menu-group" aria-label="常用操作">${routeButton(`${icon('file')}<span>编辑正文</span>`,`edit/${note.id}`,'reader-menu-row')}${learning}</section>
    <section class="reader-menu-group" aria-label="来源与记录"><h3>来源与记录</h3>${row('出处与元数据','metadata','file')}${row('历史版本','versions','layers')}${row('Obsidian 链接预览','links','network')}</section>
    ${knowledge || source ? `<details class="reader-menu-management"><summary>更多管理</summary>${knowledge ? row('合并知识','merge','layers') + row('移除当前知识','delete-knowledge','close','reader-menu-danger') : row('移入回收站','trash-source','close','reader-menu-danger')}</details>` : ''}</div>`;
}
