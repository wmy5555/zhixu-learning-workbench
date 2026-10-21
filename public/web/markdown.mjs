export const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
export function safeLink(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}
function inline(text) {
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
/** Text-only Markdown renderer. Raw HTML is always escaped; no remote assets load. */
export function markdown(value, { prefix = 'section', conversation = false } = {}) {
  const lines = String(value ?? '').replaceAll('\r\n', '\n').split('\n');
  const blocks = [], headings = [];
  let index = 0, paragraph = [], list = null, headingIndex = 0;
  const flush = () => { if (paragraph.length) blocks.push(`<p>${inline(paragraph.join('\n')).replaceAll('\n', '<br>')}</p>`); paragraph = []; };
  const endList = () => { if (list) blocks.push(`</${list}>`); list = null; };
  while (index < lines.length) {
    const line = lines[index++];
    const fence = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      flush(); endList();
      const code = [];
      while (index < lines.length && !new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`).test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index++;
      if (conversation && fence[2].trim() === 'text') {
        // One level only: the original string is never treated as executable HTML.
        const fragment = markdown(code.join('\n'), { prefix: `${prefix}-message-${headingIndex++}` });
        blocks.push(fragment.html); headings.push(...fragment.headings);
      } else blocks.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (/^\s*<!--.*-->\s*$/.test(line)) { flush(); endList(); continue; }
    if (!line.trim()) { flush(); endList(); continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flush(); endList();
      const id = `${prefix}-${headingIndex++}`, depth = heading[1].length, title = heading[2].replace(/\s+#+$/, '');
      headings.push({ id, title, depth });
      blocks.push(`<h${depth} id="${escape(id)}" tabindex="-1">${inline(title)}</h${depth}>`);
      continue;
    }
    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) { flush(); endList(); blocks.push('<hr>'); continue; }
    if (/^\s*>/.test(line)) { flush(); endList(); blocks.push(`<blockquote>${inline(line.replace(/^\s*>\s?/, ''))}</blockquote>`); continue; }
    if (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[index] || '')) {
      flush(); endList();
      const cells = text => text.trim().replace(/^\||\|$/g, '').split('|').map(s => s.trim());
      const header = cells(line); index++;
      const rows = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) rows.push(cells(lines[index++]));
      blocks.push(`<div class="table-scroll" tabindex="0" role="region" aria-label="表格"><table><thead><tr>${header.map(cell=>`<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const item = line.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/);
    if (item) {
      flush();
      const type = item[1] ? 'ul' : 'ol';
      if (list !== type) { endList(); blocks.push(`<${type}>`); list = type; }
      blocks.push(`<li>${inline(item[3])}</li>`); continue;
    }
    endList(); paragraph.push(line);
  }
  flush(); endList();
  return { html: blocks.join('\n') || '<p class="muted">这份资料还没有正文。</p>', headings };
}
