import { el, button } from './ui.mjs';

// A drawer shares one source object across its children. Retain compact offsets,
// not RegExp match objects or one copy per unit; invalidated on body replacement.
const paragraphIndexes = new WeakMap();
function paragraphIndex(source, body) {
  const cached = paragraphIndexes.get(source);
  if (cached?.body === body) return cached;
  const separator = /\r?\n[\t ]*\r?\n/g;
  let count = 0;
  while (separator.exec(body)) count++;
  const starts = new Uint32Array(count), ends = new Uint32Array(count), lines = new Uint32Array(count);
  separator.lastIndex = 0;
  let match, index = 0, line = 1, newline = body.indexOf('\n');
  while ((match = separator.exec(body))) {
    const end = match.index + match[0].length;
    while (newline !== -1 && newline < end) { line++; newline = body.indexOf('\n', newline + 1); }
    starts[index] = match.index; ends[index] = end; lines[index++] = line;
  }
  const result = { body, starts, ends, lines };
  paragraphIndexes.set(source, result);
  return result;
}
function boundaryAt(values, value, afterEqual = false) {
  let low = 0, high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] < value || afterEqual && values[middle] === value) low = middle + 1;
    else high = middle;
  }
  return low;
}

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
    const index = paragraphIndex(source, body);
    const before = boundaryAt(index.ends, start, true) - 1;
    const after = boundaryAt(index.starts, end);
    ranges.push({ start: before >= 0 ? index.ends[before] : 0, end: after < index.starts.length ? index.starts[after] : body.length, line: before >= 0 ? index.lines[before] : 1 });
  }
  const merged = [];
  for (const range of ranges.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged.map(range => ({ ...range, text: body.slice(range.start, range.end) }));
}

export function relatedSourceDetails(note, source) {
  const details = el('details', { class: 'original-material related-source', dataset: { tour: 'note-evidence' } }, [el('summary', { text: '查看关联原文段落' })]);
  let locate;
  details.addEventListener('toggle', () => {
    if (!details.open) return;
    // Closed children must not eagerly allocate a full source view each.
    if (!locate) locate = mountRelatedSource(details, note, source);
    locate(0);
  });
  return details;
}

function mountRelatedSource(details, note, source) {
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
  details.append(
    el('div', { class: 'related-source-heading' }, [
      el('strong', { text: source.title || '未命名原始资料' }),
      el('p', { class: 'fine-print', text: passages.length ? `完整原文 · ${passages.length} 处关联段落已高亮` : '暂未定位到关联段落；以下为完整原文。' }),
      passages.length === 1 ? el('p', { class: 'fine-print', text: `原文第 ${passages[0].line} 行 · 位置 ${passages[0].start}–${passages[0].end}` }) : null,
      passages.length > 1 ? el('div', { class: 'form-actions' }, passages.map((passage, index) => button(`关联 ${index + 1} · 第 ${passage.line} 行`, { kind: 'text compact', onClick: () => locate(index), title: `原文位置 ${passage.start}–${passage.end}` }))) : null,
    ]),
    viewport,
  );
  return locate;
}
