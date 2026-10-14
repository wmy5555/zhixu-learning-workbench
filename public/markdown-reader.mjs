import { el, safeExternalUrl } from './ui.mjs';

// This is a reading-only Markdown subset. Source text never becomes HTML,
// event handlers, images, or requests, and is never written back to a note.
const MAX_DEPTH = 16;
const INLINE_SCAN_LIMIT = 8192;
const ESCAPABLE = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;

function unescapeMarkdown(value) {
  return value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1');
}

function codeSpan(text, start, budget) {
  if (budget && budget.remaining <= 0) return null;
  let end = start;
  while (text[end] === '`') end++;
  const marker = text.slice(start, end);
  const limit = Math.min(text.length, end + INLINE_SCAN_LIMIT, end + (budget?.remaining ?? INLINE_SCAN_LIMIT));
  const window = text.slice(end, limit);
  let offset = 0, close = window.indexOf(marker);
  while (close >= 0) {
    if (budget) budget.remaining -= close + marker.length - offset;
    if (text[end + close - 1] !== '`' && text[end + close + marker.length] !== '`') {
      return { end: end + close + marker.length, body: window.slice(0, close) };
    }
    offset = close + marker.length;
    close = window.indexOf(marker, offset);
  }
  if (budget) budget.remaining -= window.length - offset;
  return null;
}

function delimiterEnd(text, start, marker, budget) {
  const limit = Math.min(text.length, start + INLINE_SCAN_LIMIT);
  for (let i = start; i < limit; i++) {
    if (budget.remaining-- <= 0) return -1;
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === '`') {
      const code = codeSpan(text, i, budget);
      if (code) { i = code.end - 1; continue; }
    }
    if (text.startsWith(marker, i)) return i;
  }
  return -1;
}

function linkToken(text, start, budget) {
  const limit = Math.min(text.length, start + INLINE_SCAN_LIMIT);
  let level = 1, labelEnd = -1;
  for (let i = start + 1; i < limit; i++) {
    if (budget.remaining-- <= 0) return null;
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === '\n') return null;
    if (text[i] === '`') {
      const code = codeSpan(text, i, budget);
      if (code) { i = code.end - 1; continue; }
    }
    if (text[i] === '[') level++;
    if (text[i] === ']' && --level === 0) { labelEnd = i; break; }
  }
  if (labelEnd < 0 || text[labelEnd + 1] !== '(') return null;
  let end = -1;
  level = 1;
  for (let i = labelEnd + 2; i < limit; i++) {
    if (budget.remaining-- <= 0) return null;
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === '\n') return null;
    if (text[i] === '(') level++;
    if (text[i] === ')' && --level === 0) { end = i; break; }
  }
  if (end < 0) return null;
  const destination = text.slice(labelEnd + 2, end).trim();
  // Optional link titles stay text-only attributes. Reject ambiguous syntax.
  const match = destination.match(/^(?:<([^<>\n]*)>|([^\s<>]+))(?:[ \t]+["']([^"'\n]*)["'])?$/);
  if (!match) return null;
  const value = unescapeMarkdown(match[1] ?? match[2]);
  const url = /[\u0000-\u0020\u007f]/.test(value) ? '' : safeExternalUrl(value);
  return { end: end + 1, label: text.slice(start + 1, labelEnd), url, value, title: match[3] ? unescapeMarkdown(match[3]) : '' };
}

function inline(text, depth = 0, allowLinks = true, budget = { remaining: text.length * 4 + INLINE_SCAN_LIMIT }) {
  if (depth >= MAX_DEPTH) return [text];
  const children = [];
  let plain = '';
  const flush = () => { if (plain) { children.push(plain); plain = ''; } };
  for (let i = 0; i < text.length;) {
    if (text[i] === '\\' && ESCAPABLE.test(text[i + 1] || '')) {
      plain += text[i + 1]; i += 2; continue;
    }
    if (text[i] === '`') {
      const token = codeSpan(text, i, budget);
      if (token) { flush(); children.push(el('code', { text: token.body })); i = token.end; continue; }
      // Consume an unmatched run once rather than rescanning every backtick.
      do { plain += text[i++]; } while (text[i] === '`');
      continue;
    }
    if (text[i] === '!' && text[i + 1] === '[') {
      const token = linkToken(text, i + 1, budget);
      if (token) {
        const imageUrl = budget.imageResolver?.(token.value);
        if (imageUrl && /^\/api\/(?:practice\/[^/]+\/)?notes\/[^/]+\/attachments\?asset=/.test(imageUrl)) {
          flush(); children.push(el('img', { src: imageUrl, alt: unescapeMarkdown(token.label), loading: 'lazy', class: 'source-image' }));
        } else plain += text.slice(i, token.end);
        i = token.end; continue;
      }
    }
    if (allowLinks && text[i] === '[') {
      const token = linkToken(text, i, budget);
      if (token) {
        if (token.url) {
          flush(); children.push(el('a', { href: token.url, target: '_blank', rel: 'noopener noreferrer', title: token.title || null }, inline(token.label, depth + 1, false, budget)));
        } else plain += text.slice(i, token.end);
        i = token.end; continue;
      }
    }
    const marker = text.startsWith('**', i) ? '**' : text.startsWith('__', i) ? '__' : '';
    if (marker) {
      const end = delimiterEnd(text, i + 2, marker, budget);
      if (end > i + 2) {
        flush(); children.push(el('strong', {}, inline(text.slice(i + 2, end), depth + 1, allowLinks, budget)));
        i = end + 2; continue;
      }
    }
    if (text[i] === '\n') { flush(); children.push(el('br')); i++; continue; }
    plain += text[i++];
  }
  flush();
  return children;
}

function fence(line) {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!match || match[1][0] === '`' && match[2].includes('`')) return null;
  return { marker: match[1], language: match[2].trim().split(/\s+/)[0] || '' };
}

function closesFence(line, opening) {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
  return Boolean(match && match[1][0] === opening.marker[0] && match[1].length >= opening.marker.length);
}

function listMarker(line) {
  const match = line.match(/^( {0,3})([-+*]|(\d{1,9})[.)])[ \t]+(.*)$/);
  return match ? { indent: match[1].length, ordered: Boolean(match[3]), start: Number(match[3] || 1), body: match[4], width: match[0].length - match[4].length } : null;
}

function tableCells(line) {
  let value = line.trim();
  if (!value.includes('|')) return null;
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1);
  const cells = [];
  let body = '';
  for (let i = 0; i < value.length;) {
    if (value[i] === '\\' && i + 1 < value.length) { body += value.slice(i, i + 2); i += 2; continue; }
    if (value[i] === '`') {
      const token = codeSpan(value, i);
      if (token) { body += value.slice(i, token.end); i = token.end; continue; }
    }
    if (value[i] === '|') { cells.push(body.trim()); body = ''; i++; continue; }
    body += value[i++];
  }
  cells.push(body.trim());
  return cells;
}

function tableAt(lines, start) {
  const headers = tableCells(lines[start] || ''), divider = tableCells(lines[start + 1] || '');
  if (!headers || !divider || headers.length !== divider.length || !divider.every(cell => /^:?-{3,}:?$/.test(cell))) return null;
  return { headers, alignment: divider.map(cell => cell.startsWith(':') ? cell.endsWith(':') ? 'center' : 'left' : cell.endsWith(':') ? 'right' : '') };
}

function heading(line) {
  const match = line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*)|$)/);
  return match ? { level: match[1].length, text: (match[2] || '').replace(/[ \t]+#+[ \t]*$/, '') } : null;
}

function blockStart(lines, index) {
  const line = lines[index];
  return Boolean(!line.trim() || fence(line) || heading(line) || listMarker(line) || /^ {0,3}>/.test(line) || tableAt(lines, index));
}

function blocks(lines, depth = 0, imageResolver) {
  const textInline = text => inline(text, 0, true, { remaining: text.length * 4 + INLINE_SCAN_LIMIT, imageResolver });
  if (depth >= MAX_DEPTH) return [el('p', { class: 'markdown-fallback' }, inline(lines.join('\n'), MAX_DEPTH))];
  const children = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const opening = fence(line);
    if (opening) {
      const code = [];
      i++;
      while (i < lines.length && !closesFence(lines[i], opening)) code.push(lines[i++]);
      const closed = i < lines.length;
      if (closed) i++;
      children.push(el('pre', { class: 'markdown-code', tabIndex: 0, ariaLabel: '代码，可横向滚动' }, el('code', {
        text: code.join('\n') + (closed && code.length ? '\n' : ''), dataset: opening.language ? { language: opening.language } : {},
      })));
      continue;
    }
    const title = heading(line);
    if (title) { children.push(el(`h${title.level}`, {}, textInline(title.text))); i++; continue; }
    if (/^ {0,3}>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^ {0,3}>/.test(lines[i])) quote.push(lines[i++].replace(/^ {0,3}> ?/, ''));
      children.push(el('blockquote', {}, blocks(quote, depth + 1, imageResolver)));
      continue;
    }
    const marker = listMarker(line);
    if (marker) {
      const list = el(marker.ordered ? 'ol' : 'ul', marker.ordered && marker.start !== 1 ? { start: marker.start } : {});
      while (i < lines.length) {
        const item = listMarker(lines[i]);
        if (!item || item.indent !== marker.indent || item.ordered !== marker.ordered) break;
        const itemLines = [item.body];
        i++;
        while (i < lines.length) {
          if (!lines[i].trim()) { itemLines.push(''); i++; continue; }
          const indentation = lines[i].match(/^ */)[0].length;
          if (indentation <= marker.indent) break;
          itemLines.push(lines[i].slice(Math.min(indentation, item.width)));
          i++;
        }
        list.append(el('li', {}, blocks(itemLines, depth + 1, imageResolver)));
      }
      children.push(list);
      continue;
    }
    const table = tableAt(lines, i);
    if (table) {
      const cell = (tag, value, index) => el(tag, { ...(tag === 'th' ? { scope: 'col' } : {}), class: table.alignment[index] ? `markdown-align-${table.alignment[index]}` : null }, textInline(value));
      const body = el('tbody');
      i += 2;
      while (i < lines.length && lines[i].trim()) {
        const row = tableCells(lines[i]);
        if (!row || row.length !== table.headers.length) break;
        body.append(el('tr', {}, row.map((value, index) => cell('td', value, index))));
        i++;
      }
      children.push(el('div', { class: 'markdown-table-scroll', tabIndex: 0, role: 'region', ariaLabel: '表格，可横向滚动' }, el('table', {}, [
        el('thead', {}, el('tr', {}, table.headers.map((value, index) => cell('th', value, index)))), body,
      ])));
      continue;
    }
    // Setext headings are recognized only for a single preceding text line.
    if (/^ {0,3}(?:={3,}|-{3,})[ \t]*$/.test(lines[i + 1] || '')) {
      children.push(el(/^ *=/.test(lines[i + 1]) ? 'h1' : 'h2', {}, textInline(line)));
      i += 2; continue;
    }
    const paragraph = [line];
    i++;
    while (i < lines.length && !blockStart(lines, i)) paragraph.push(lines[i++]);
    children.push(el('p', {}, textInline(paragraph.join('\n'))));
  }
  return children;
}

/** Render body text only. Keep titles/metadata and editing/storage as plain text. */
export function renderMarkdown(value, { className = '', emptyText = '暂无正文', imageResolver } = {}) {
  const source = String(value ?? '');
  const root = el('div', { class: ['markdown-reader', className].filter(Boolean).join(' ') });
  if (!source.trim()) root.append(el('p', { class: 'markdown-empty', text: emptyText }));
  else for (const block of blocks(source.replace(/\r\n?/g, '\n').split('\n'), 0, imageResolver)) root.append(block);
  return root;
}
