import { escape as e } from './markdown.mjs';
import { button as btn, routeButton as link, details, list, readable } from './ui.mjs';
import { kind, stage } from './classification.mjs';
import { hasUnknownClassification } from '../note-classification.mjs';

export const knowledgeRow = n => `<article class="knowledge-row"><div><h3>${e(n.title)}</h3><p>${e(kind(n.kind))} · ${hasUnknownClassification(n)?'分类待确认':e(stage(n.meta?.stage))}</p></div>${link('阅读 ↗',`read/${n.id}`,'text-button')}</article>`;

export function recommendationsHTML(data) {
  return `<section class="recent"><h2>知识使用建议</h2><p class="form-note">${e(data.summary||'')}</p>${list(data.suggestions).map(s=>`<article class="parity-card"><h3>${e(s.title)}</h3><p>${e(s.reason)}</p>${details('查看依据',list(s.signals).map(x=>`<p>${e(readable(x))}</p>`).join(''))}<div class="actions">${btn('处理建议','recommendation','text-button',`data-id="${e(s.id)}" data-value="accept"`)}${btn('暂不采用','recommendation','text-button',`data-id="${e(s.id)}" data-value="dismiss"`)}</div></article>`).join('')||'<p class="muted">暂时没有新的使用建议。</p>'}</section>`;
}
