import { el, button } from './ui.mjs';

// Only stored, verifiable source references identify a passage. Never infer
// provenance from the AI-written note body or from words shared with a source.
export function relatedSourceParagraphs(note, source) {
  const body = typeof source?.body === 'string' ? source.body : '';
  const refs = source?.structure?.units?.find(unit => unit.id === note.id)?.sourceRefs || [];
  const ranges = [];
  for (const ref of refs) {
    if (!ref || ref.sourceId && ref.sourceId !== source.id || typeof ref.quote !== 'string' || !ref.quote) continue;
    let { start, end } = ref;
    if (start == null && body.indexOf(ref.quote) === body.lastIndexOf(ref.quote)) {
      start = body.indexOf(ref.quote); end = start + ref.quote.length;
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > body.length || end <= start || body.slice(start, end) !== ref.quote) continue;
    // Include the complete intersecting paragraphs, preserving every character.
    const breaks = [...body.matchAll(/\r?\n[\t ]*\r?\n/g)];
    const before = breaks.filter(match => match.index + match[0].length <= start).at(-1);
    const after = breaks.find(match => match.index >= end);
    ranges.push({ start: before ? before.index + before[0].length : 0, end: after ? after.index : body.length });
  }
  const merged = [];
  for (const range of ranges.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged.map(range => ({ ...range, text: body.slice(range.start, range.end), line: body.slice(0, range.start).split('\n').length }));
}

export function relatedSourceDetails(note, source) {
  const passages = relatedSourceParagraphs(note, source);
  const body = typeof source.body === 'string' ? source.body : '';
  const text = el('div', { class: 'related-source-text' });
  const highlights = [];
  let cursor = 0;
  for (const passage of passages) {
    text.append(document.createTextNode(body.slice(cursor, passage.start)));
    const highlight = el('mark', { class: 'related-source-highlight', text: passage.text });
    text.append(highlight); highlights.push(highlight); cursor = passage.end;
  }
  text.append(document.createTextNode(body.slice(cursor)));
  const viewport = el('div', { class: 'original-body related-source-scroll', tabIndex: 0, role: 'region', ariaLabel: '完整原文，关联段落已高亮' }, [text]);
  // Scroll only this inline window; leave the source drawer and page untouched.
  const locate = index => {
    const target = highlights[index];
    if (target) viewport.scrollTop += target.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 24;
  };
  const details = el('details', { class: 'original-material related-source', dataset: { tour: 'note-evidence' } }, [
    el('summary', { text: '查看关联原文段落' }),
    el('div', { class: 'related-source-heading' }, [
      el('strong', { text: source.title || '未命名原始资料' }),
      el('p', { class: 'fine-print', text: passages.length ? `完整原文 · ${passages.length} 处关联段落已高亮` : '暂未定位到关联段落；以下为完整原文。' }),
      passages.length === 1 ? el('p', { class: 'fine-print', text: `原文第 ${passages[0].line} 行 · 位置 ${passages[0].start}–${passages[0].end}` }) : null,
      passages.length > 1 ? el('div', { class: 'form-actions' }, passages.map((passage, index) => button(`关联 ${index + 1} · 第 ${passage.line} 行`, { kind: 'text compact', onClick: () => locate(index), title: `原文位置 ${passage.start}–${passage.end}` }))) : null,
    ]),
    viewport,
  ]);
  details.addEventListener('toggle', () => { if (details.open) locate(0); });
  return details;
}
