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

export function relatedSourceDetails(note, source, openFullText) {
  const passages = relatedSourceParagraphs(note, source);
  return el('details', { class: 'original-material', dataset: { tour: 'note-evidence' } }, [
    el('summary', { text: '查看关联原文段落' }),
    el('div', { class: 'page-stack original-body' }, [
      el('strong', { text: source.title || '未命名原始资料' }),
      ...(passages.length ? passages.map(passage => el('section', { class: 'citation' }, [
        el('p', { class: 'fine-print', text: `原文第 ${passage.line} 行 · 位置 ${passage.start}–${passage.end}` }),
        el('blockquote', { text: passage.text, style: 'white-space: pre-wrap' }),
      ])) : [el('p', { text: '暂未定位到关联段落' })]),
      button('查看原始资料全文', { kind: 'text', onClick: () => openFullText(source) }),
    ]),
  ]);
}
