import { eachLiteral, literalState, interpolateLiteral } from './exported-content.mjs';

export const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
export function safeLink(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}
function inline(text, presentation = false) {
  if (presentation) text = String(text).split(/(`[^`\n]+`)/g).map(part => part.startsWith('`') ? part : part
    .replace(/<Link\b[^<>]*\/>/g, tag => { const url = tag.match(/\burl="([^"]*)"/)?.[1], title = tag.match(/\btitle="([^"]*)"/)?.[1]; return url && title ? `[${title}](${url})` : title || ''; })
    .replace(/<Entity\b[^<>]*\/>/g, tag => tag.match(/\bvalue="([^"]*)"/)?.[1] || '')
    .replace(/<icon\b[^<>]*\/>/gi, tag => /name="arrow-down"/.test(tag) ? ' ↓ ' : /name="arrow-right"/.test(tag) ? ' → ' : '')
    .replace(/<\/?(?:box|row|caption|text|badge|icon|divider|grid|grid-item|title|slider)\b[^<>]*>/gi, ' ')
    .replace(/<(?:cite|memorycite)\b[^<>]*\/>/gi, '')
    .replace(/\[\$[^\]]+\]\(app:\/\/[^)]+\)/g, '')
    .replace(/(?:cite|navlist|image_group)[^]*/g, '')).join('');
  const parts = String(text).split(/(`[^`\n]+`|\[[^\]\n]+\]\([^\s)]+\)|!\[[^\]\n]*\]\([^\n)]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__)/g);
  return parts.map(part => {
    if (/^`[^`]+`$/.test(part)) return `<code>${escape(part.slice(1, -1))}</code>`;
    if (/^(\*\*|__)/.test(part)) return `<strong>${escape(part.slice(2, -2))}</strong>`;
    const image = part.match(/^!\[([^\]]*)\]\((.+)\)$/);
    if (image) return `<span class="image-caption">[图片：${escape(image[1] || '原文附件')}]</span>`;
    const link = part.match(/^\[([^\]]+)\]\((.+)\)$/);
    if (link) {
      const url = safeLink(link[2]);
      return url ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(link[1])} ↗</a>` : escape(link[1]);
    }
    return escape(part);
  }).join('');
}

function exportedChart(line) {
  const match = line.trim().match(/^<Chart\s+content=\{(\{.*\})\}\s*\/>$/);
  if (!match) return null;
  try {
    const chart = JSON.parse(match[1]);
    if (!Array.isArray(chart.data) || !Array.isArray(chart.series) || typeof chart.xKey !== 'string') throw new Error('Unsupported chart');
    const series = chart.series.slice(0, 12), meta = chart.meta || {};
    const cell = value => escape(['string', 'number'].includes(typeof value) ? value : '');
    return `<figure class="reading-chart">${meta.title ? `<figcaption>${cell(meta.title)}</figcaption>` : ''}${meta.description ? `<p>${cell(meta.description)}</p>` : ''}<div class="table-scroll" tabindex="0" role="region" aria-label="原文图表数据"><table><thead><tr><th>项目</th>${series.map(s => `<th>${cell(s.label)}</th>`).join('')}</tr></thead><tbody>${chart.data.slice(0, 200).map(row => `<tr><td>${cell(row[chart.xKey])}</td>${series.map(s => `<td>${cell(row[s.dataKey])}${cell(s.valueSuffix)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${meta.footer ? `<p>${cell(meta.footer)}</p>` : ''}</figure>`;
  } catch { return '<p class="muted">原文图表暂未还原。</p>'; }
}
/** Text-only Markdown renderer. Raw HTML is always escaped; no remote assets load. */
export function markdown(value, { prefix = 'section', conversation = false, presentation = false, anchors = [], level = 0, budget = { items: 300, characters: 250000 } } = {}) {
  const lines = String(value ?? '').replaceAll('\r\n', '\n').split('\n');
  const blocks = [], headings = [];
  let index = 0, paragraph = [], list = null, headingIndex = 0, offset = 0;
  const bindings = Object.create(null);
  const format = text => inline(presentation ? interpolateLiteral(text, bindings) : text, presentation);
  const flush = () => { if (paragraph.length) blocks.push(`<p>${format(paragraph.join('\n')).replaceAll('\n', '<br>')}</p>`); paragraph = []; };
  const endList = () => { if (list) blocks.push(`</${list}>`); list = null; };
  while (index < lines.length) {
    const line = lines[index++];
    for (const anchor of anchors.filter(a => a.offset >= offset && a.offset < offset + line.length + 1)) {
      flush(); endList(); blocks.push(`<span class="reading-anchor" id="${escape(anchor.id)}" tabindex="-1"></span>`);
    }
    offset += line.length + 1;
    const fence = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      flush(); endList();
      const code = [];
      const codeStart = offset;
      while (index < lines.length && !new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`).test(lines[index])) { offset += lines[index].length + 1; code.push(lines[index++]); }
      if (index < lines.length) offset += lines[index++].length + 1;
      for (const anchor of anchors.filter(a => a.offset >= codeStart && a.offset < offset)) blocks.push(`<span class="reading-anchor" id="${escape(anchor.id)}" tabindex="-1"></span>`);
      if (conversation && fence[2].trim() === 'text') {
        // One level only: the original string is never treated as executable HTML.
        const fragment = markdown(code.join('\n'), { prefix: `${prefix}-message-${headingIndex++}` });
        blocks.push(fragment.html); headings.push(...fragment.headings);
      } else blocks.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`);
      continue;
    }
    const literal = presentation && eachLiteral(line);
    if (literal && level < 6) {
      let end = index, depth = 1;
      while (end < lines.length) { if (/^\s*\{#each\b/.test(lines[end])) depth++; if (/^\s*\{\/each\}\s*$/.test(lines[end]) && --depth === 0) break; end++; }
      if (end < lines.length) {
        flush(); endList();
        const template = lines.slice(index, end).filter(l => !/^\s*\{(?:#if|\/if|:else)(?:\s|\})/.test(l)).join('\n');
        const items = [];
        for (const [i, value] of literal.values.entries()) {
          const text = interpolateLiteral(template, { [literal.name]: value, ...(literal.index ? { [literal.index]: i } : {}) });
          if (budget.items <= 0 || text.length > budget.characters) { items.push('<li>原文示例较长，重复展示已收起。</li>'); break; }
          budget.items--; budget.characters -= text.length;
          items.push(`<li>${markdown(text, { prefix: `${prefix}-sequence-${headingIndex++}`, presentation: true, level: level + 1, budget }).html}</li>`);
        }
        blocks.push(`<ol class="reading-sequence">${items.join('')}</ol>`);
        const rangeStart = offset;
        while (index <= end) offset += lines[index++].length + 1;
        for (const anchor of anchors.filter(a => a.offset >= rangeStart && a.offset < offset)) blocks.push(`<span class="reading-anchor" id="${escape(anchor.id)}" tabindex="-1"></span>`);
        continue;
      }
    }
    const state = presentation && literalState(line);
    if (state) { flush(); endList(); bindings[state.name] = state.value; blocks.push('<p class="muted small">原文交互示例的初始状态</p>'); continue; }
    const chart = presentation && exportedChart(line);
    if (chart) { flush(); endList(); blocks.push(chart); continue; }
    if (presentation && !format(line).trim()) { flush(); endList(); continue; }
    if (/^\s*<!--.*-->\s*$/.test(line)) { flush(); endList(); continue; }
    if (!line.trim()) { flush(); endList(); continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flush(); endList();
      const id = `${prefix}-${headingIndex++}`, depth = heading[1].length, title = heading[2].replace(/\s+#+$/, '');
      headings.push({ id, title, depth });
      blocks.push(`<h${depth} id="${escape(id)}" tabindex="-1">${format(title)}</h${depth}>`);
      continue;
    }
    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) { flush(); endList(); blocks.push('<hr>'); continue; }
    if (/^\s*>/.test(line)) { flush(); endList(); blocks.push(`<blockquote>${format(line.replace(/^\s*>\s?/, ''))}</blockquote>`); continue; }
    if (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[index] || '')) {
      flush(); endList();
      const cells = text => text.trim().replace(/^\||\|$/g, '').split('|').map(s => s.trim());
      const header = cells(line); offset += lines[index++].length + 1;
      const rows = [];
      const tableStart = offset;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) { offset += lines[index].length + 1; rows.push(cells(lines[index++])); }
      for (const anchor of anchors.filter(a => a.offset >= tableStart && a.offset < offset)) blocks.push(`<span class="reading-anchor" id="${escape(anchor.id)}" tabindex="-1"></span>`);
      blocks.push(`<div class="table-scroll" tabindex="0" role="region" aria-label="表格"><table><thead><tr>${header.map(cell=>`<th>${format(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${format(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const item = line.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/);
    if (item) {
      flush();
      const type = item[1] ? 'ul' : 'ol';
      if (list !== type) { endList(); blocks.push(`<${type}>`); list = type; }
      blocks.push(`<li>${format(item[3])}</li>`); continue;
    }
    endList(); paragraph.push(line);
  }
  flush(); endList();
  return { html: blocks.join('\n') || '<p class="muted">这份资料还没有正文。</p>', headings };
}
