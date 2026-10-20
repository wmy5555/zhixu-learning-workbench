import { escape as e, markdown, safeLink } from './markdown.mjs';
import { icon, button, routeButton, kind, stage } from './ui.mjs';

export function reader(note, notes, returnTo = 'library') {
  const content = markdown(note.body, { conversation: Boolean(note.meta?.chatgptCapture || note.meta?.chatgptSync) });
  const recent = notes.filter(item => ['source', 'knowledge'].includes(item.kind) && item.id !== note.id).slice(0, 5);
  const children = note.children || [];
  const files = [note.meta?.sourceFile, ...(note.meta?.attachments || [])].filter(Boolean);
  const sourceUrl = safeLink(note.meta?.url);
  const html = `<div class="reader-shell">
    <header class="reader-top"><div>${routeButton(`${icon('arrow')} 返回`, returnTo, 'text-button reader-back')}<span class="reader-breadcrumb">${e(kind(note.kind))} / ${e(note.meta?.topic || '我的知识空间')}</span></div><div class="actions">${button('Aa', 'reader-size', 'icon-button', 'aria-label="调整阅读字号" aria-pressed="false"')}${button(icon('layers'), 'reader-focus', 'icon-button', 'aria-label="切换专注阅读" aria-pressed="false"')}${button(icon('moon'), 'theme', 'icon-button', 'aria-label="切换明暗模式"')}${button('资料操作', 'reader-actions', 'text-button', `data-id="${e(note.id)}"`)}</div></header>
    <div class="reading-grid">
      <aside class="reading-shelf"><p class="eyebrow">MY READING DESK</p><h1>我的书桌</h1><p class="muted">打开一份资料，沉进去。</p>
        <div class="shelf-current"><small>${e(kind(note.kind))}</small><h2>${e(note.title)}</h2></div>
        <details class="reader-toc" open><summary>这份资料的目录</summary><nav aria-label="资料目录">${content.headings.map(h=>button(e(h.title), 'reader-section', `toc-level-${Math.min(3,h.depth)}`, `data-target="${e(h.id)}"`)).join('') || '<p class="muted small">从正文开始阅读。</p>'}</nav></details>
        <div class="shelf-other"><p class="nav-label">接着读</p>${recent.map(item=>routeButton(`${icon(item.kind === 'source' ? 'file' : 'book')}<span>${e(item.title)}</span>`, `read/${item.id}`, 'shelf-link')).join('')}</div>
      </aside>
      <div class="reading-scroll" tabindex="0" aria-label="资料正文"><article class="reading-article">
        <header class="article-heading"><p class="eyebrow">${e(note.meta?.topic || kind(note.kind))} / READING NOTE</p><h1>${e(note.title || '未命名资料')}</h1><p>${e(kind(note.kind))} · ${e(stage(note.meta?.stage))} · ${Number(String(note.body || '').length).toLocaleString()} 字</p></header>
        <div class="article-prose">${content.html}</div>
        ${files.length ? `<section class="article-attachments"><h2>原始附件</h2>${files.map(file=>{
          const url = `/api/notes/${encodeURIComponent(note.id)}/attachments?asset=${encodeURIComponent(file.id)}`;
          return `<div>${file.kind === 'image' ? `<img src="${url}" alt="${e(file.name)}" loading="lazy">` : ''}<a href="${url}&download=1">${icon('file')} ${e(file.name)} · 下载原件</a></div>`;
        }).join('')}</section>` : ''}
        ${sourceUrl ? `<p class="article-source"><a href="${e(sourceUrl)}" target="_blank" rel="noopener noreferrer">访问原始出处 ↗</a></p>` : ''}
        <footer class="article-end"><span></span><p>读到这里，试着用自己的话说一遍。</p>${note.kind === 'knowledge' ? button('写下我的理解', 'understanding', 'text-button', `data-id="${e(note.id)}"`) : note.kind === 'source' ? button('从原文整理一条知识', 'extract', 'text-button', `data-id="${e(note.id)}"`) : ''}</footer>
      </article></div>
      <aside class="reading-margin"><p class="nav-label">${note.kind === 'source' ? '从原文走向理解' : '我的学习'}</p>
        ${note.kind === 'source' ? `<h2>这份资料里的想法</h2><p class="muted small">${children.length ? `${children.length} 条知识，逐一读懂。` : '先读原文，再决定值得留下什么。'}</p>
          <div class="related-notes">${children.map((child,index)=>routeButton(`<span>${String(index+1).padStart(2,'0')}</span><strong>${e(child.title)}</strong><small>${e(stage(child.meta?.stage))}</small>`, `read/${child.id}`, 'related-note')).join('')}</div>
          <div class="margin-actions">${button('AI 拆解这份资料', 'process', 'primary', `data-id="${e(note.id)}"`)}${button('自己整理一条', 'extract', 'text-button', `data-id="${e(note.id)}"`)}</div>`
          : note.kind === 'knowledge' ? `<h2>用自己的例子，检验这段理解。</h2><p class="muted small">${e(stage(note.meta?.stage))}</p><div class="margin-actions">${button('开始学习', 'start-note', 'primary', `data-id="${e(note.id)}"`)}${button('调整学习安排', 'promote', 'text-button', `data-id="${e(note.id)}"`)}${button('写下我的理解', 'understanding', 'text-button', `data-id="${e(note.id)}"`)}${button('查看依据与来源', 'evidence', 'text-button', `data-id="${e(note.id)}"`)}</div>` : note.kind === 'mistake' ? `<h2>从上次没想清楚的地方继续。</h2><div class="margin-actions">${button('针对这次误解练习', 'start-mistake', 'primary', `data-id="${e(note.id)}" data-note="${e(note.meta?.noteId||'')}"`)}${button('记录修正或提出质疑', 'mistake-state', 'text-button', `data-id="${e(note.id)}"`)}</div>` : '<h2>先把这个想法读完整。</h2>'}
        <blockquote>真正值得保留的，还有你重新组织它时，发生的思考。</blockquote>
      </aside>
    </div></div>`;
  return { html };
}
