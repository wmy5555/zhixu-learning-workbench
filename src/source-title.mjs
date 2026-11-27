// Mirror the reader's bounded container traversal without rendering or changing source text.
function titleTextLines(lines, depth = 0) {
  if (depth >= 16) return [];
  const visible = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i], marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (marker && !(marker[1][0] === '`' && marker[2].includes('`'))) {
      i++;
      while (i < lines.length) {
        const close = lines[i++].match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
        if (close && close[1][0] === marker[1][0] && close[1].length >= marker[1].length) break;
      }
      visible.push('');
      continue;
    }
    if (/^ {0,3}>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^ {0,3}>/.test(lines[i])) quote.push(lines[i++].replace(/^ {0,3}> ?/, ''));
      visible.push('');
      for (const value of titleTextLines(quote, depth + 1)) visible.push(value);
      visible.push('');
      continue;
    }
    const item = line.match(/^( {0,3})(?:[-+*]|\d{1,9}[.)])[ \t]+(.*)$/);
    if (item) {
      const itemLines = [item[2].replace(/^\[[ xX]\][ \t]+/, '')], width = item[0].length - item[2].length;
      i++;
      while (i < lines.length) {
        if (!lines[i].trim()) { itemLines.push(''); i++; continue; }
        const indent = lines[i].match(/^ */)[0].length;
        if (indent <= item[1].length) break;
        itemLines.push(lines[i++].slice(Math.min(indent, width)));
      }
      visible.push('');
      for (const value of titleTextLines(itemLines, depth + 1)) visible.push(value);
      visible.push('');
      continue;
    }
    visible.push(line); i++;
  }
  return visible;
}

// A local display hint only: preserve the body and keep AI title generation pending.
export function sourceTitlePlaceholder(body) {
  const visible = titleTextLines(body.replace(/\r\n?/g, '\n').split('\n'));
  const plain = value => value
    .replace(/^\s*(?:>\s*)+/, '').replace(/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/, '')
    .replace(/!?\[([^\]\n]*)\]\([^\n]*?\)/g, '$1')
    .replace(/(`+)(.*?)\1/g, '$2').replace(/(\*\*|__|~~)(.*?)\1/g, '$2')
    .replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$|[，。！？、])/g, '$1$2')
    .replace(/\s+/gu, ' ').trim();
  let heading = '', paragraph = [];
  for (let i = 0; i < visible.length; i++) {
    const line = visible[i], atx = line.match(/^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/);
    const setext = line.trim() && /^ {0,3}(?:=+|-+)\s*$/.test(visible[i + 1] || '');
    if (atx || setext) {
      heading = plain(atx ? atx[1] : line);
      if (heading) break;
    }
  }
  for (const line of visible) {
    if (!line.trim() || /^\s*(?:[-*_]\s*){3,}$/.test(line)) {
      if (paragraph.length) break;
      continue;
    }
    const value = plain(line);
    if (value) paragraph.push(value);
  }
  const text = heading || paragraph.join(' ') || '未命名资料';
  const segments = [];
  for (const { segment } of new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(text)) {
    segments.push(segment);
    if (segments.length > 36) break;
  }
  if (segments.length <= 36) return text;
  let excerpt = segments.slice(0, 35).join('');
  const sentence = excerpt.match(/^.*[。！？.!?](?=\s|[^\x00-\x7f]|$)/u);
  if (sentence) excerpt = sentence[0];
  else {
    const boundary = excerpt.replace(/\s+\S*$/, '');
    if ([...boundary].length >= 18) excerpt = boundary;
  }
  return excerpt.trimEnd() + '…';
}

export const needsTitle = source => source.meta.titlePending === true && source.title === source.meta.titlePlaceholder;
export const validSourceTitle = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 80 && !/[\r\n\u0000-\u001f\u007f\u2028\u2029]/u.test(value) && !/^[#>*\x60]|\x60/u.test(value.trim());
