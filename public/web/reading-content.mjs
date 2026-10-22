import { markdown } from './markdown.mjs';

// A display projection only. Stored transcripts, IDs and integrity inputs stay intact.
function envelope(text, start = 0) {
  const open = text.slice(start).match(/^(`{3,})text\n/);
  if (!open) return null;
  const contentStart = start + open[0].length;
  const close = new RegExp(`^${open[1]}[ \\t]*(?:\\n|$)`, 'gm');
  close.lastIndex = contentStart;
  const end = close.exec(text);
  if (!end) return null;
  return { text: text.slice(contentStart, end.index).replace(/\n$/, ''), start: contentStart, end: close.lastIndex };
}

function sections(text) {
  const result = [];
  let fence = null, offset = 0;
  for (const line of text.split('\n')) {
    if (fence) { if (new RegExp(`^${fence}[ \\t]*$`).test(line)) fence = null; }
    else {
      const open = line.match(/^(`{3,}|~{3,})/);
      if (open) fence = open[1];
      else if (/^## /.test(line)) result.push({ title: line.slice(3), start: offset, end: offset + line.length + 1 });
    }
    offset += line.length + 1;
  }
  return result;
}

export function conversationContent(note) {
  if (!note.meta?.chatgptCapture && !note.meta?.chatgptSync) return null;
  const body = String(note.body || '').replaceAll('\r\n', '\n');
  const top = sections(body);
  const source = top.find(s => s.title === '会话原文（按收到的顺序保留）' || s.title === '原始消息片段');
  if (!source) return null;
  const messages = [];
  let cursor = source.end;
  while (cursor < body.length) {
    cursor += body.slice(cursor).match(/^\s*/)[0].length;
    if (cursor === body.length || /^<!-- zhixu-managed-links:start -->/.test(body.slice(cursor))) break;
    const heading = body.slice(cursor).match(/^### (\d+)\. (用户|ChatGPT)\n\n/);
    if (!heading) return null; // Never hide a user's unrecognised edit.
    const messageStart = cursor;
    cursor += heading[0].length;
    if (body.startsWith('消息编号：', cursor)) {
      const id = envelope(body, cursor + '消息编号：'.length);
      if (!id) return null;
      cursor = id.end;
    } else if (body.startsWith('原消息编号与字符范围：\n\n', cursor)) {
      const id = envelope(body, cursor + '原消息编号与字符范围：\n\n'.length);
      if (!id) return null;
      cursor = id.end;
    }
    cursor += body.slice(cursor).match(/^\s*/)[0].length;
    const content = envelope(body, cursor);
    if (!content) return null;
    messages.push({ role: heading[2], text: content.text, start: content.start, messageStart });
    cursor = content.end;
  }
  if (!messages.length) return null;
  const summarySection = top.find(s => /^整理摘要（/.test(s.title));
  const summaryEnd = summarySection && top.find(s => s.start > summarySection.start)?.start;
  const summaryRaw = summarySection ? body.slice(summarySection.end, summaryEnd).trim() : '';
  const summaryEnvelope = envelope(summaryRaw);
  const summary = summaryEnvelope?.end === summaryRaw.length ? summaryEnvelope.text : summaryRaw;
  const coverage = note.meta.chatgptSync?.snapshot?.coverage || note.meta.chatgptCapture?.coverage;
  const scope = coverage === 'selected_excerpt' ? '选定的会话片段' : coverage === 'visible_history' ? '当前可见的会话分支' : '保存时可见的会话内容';
  return { messages, summary, scope: `${scope} · ${messages.length} 条消息`, count: messages.reduce((n, m) => n + m.text.length, 0) };
}

export function readingContent(note) {
  const conversation = conversationContent(note);
  let body = String(note.body || '');
  if (note.meta?.chatgptImport) {
    const top = sections(body);
    const first = top[0], sources = top[1], limits = top[2];
    if (first?.start === 0 && /^(知识建议|模型结论|待验证事实)（未经独立核验）$/.test(first.title) && sources?.title === '来源消息编号' && limits?.title === '不确定性与限制' && top.length === 3) {
      const raw = body.slice(first.end, sources.start).trim(), prose = envelope(raw);
      const rawLimits = body.slice(limits.end).trim(), uncertainty = envelope(rawLimits);
      if (prose?.end === raw.length && uncertainty?.end === rawLimits.length) {
        const remaining = uncertainty.text.split('\n').filter(line => line !== 'ChatGPT 生成的整理尚未独立核验，不代表用户理解或掌握。').join('\n');
        body = prose.text + (remaining ? `\n\n## 适用范围与待核验处\n\n${remaining}` : '');
      }
    }
  }
  const messages = conversation?.messages || [{ text: body, start: 0 }];
  const units = ['ready', 'partial'].includes(note.structure?.state) ? note.structure?.units || [] : [];
  const anchors = units.flatMap((unit, index) => {
    const ref = unit.sourceRefs?.find(ref => ref.sourceId === note.id && note.body.slice(ref.start, ref.end) === ref.quote);
    if (!ref) return [];
    const message = messages.findIndex(m => ref.start >= m.start && ref.start < m.start + m.text.length);
    return message < 0 ? [] : [{ message, offset: ref.start - messages[message].start, title: unit.shortTitle, id: `reading-unit-${index}`, position: ref.start }];
  }).sort((a, b) => a.position - b.position);
  const headings = [];
  const html = messages.map((message, index) => {
    const rendered = markdown(message.text, { prefix: `reading-${index}`, presentation: Boolean(conversation), anchors: anchors.filter(a => a.message === index) });
    headings.push(...rendered.headings);
    return conversation ? `<section class="reading-message" aria-label="${message.role}"><p class="message-role">${message.role}</p>${rendered.html}</section>` : rendered.html;
  }).join('\n');
  return { html, headings: anchors.length ? anchors.map(a => ({ ...a, depth: 2 })) : headings, conversation, aiOutline: anchors.length > 0 };
}

export function readingGroups(note, related = []) {
  const children = [...new Map((note.children || []).filter(n => n.id !== note.id).map(n => [n.id, n])).values()];
  const childIds = new Set(children.map(n => n.id));
  const others = [...new Map(related.filter(n => n.kind === 'knowledge' && n.id !== note.id && !childIds.has(n.id)).map(n => [n.id, n])).values()];
  return { children, related: others };
}

export function relatedReadingNotes(note, notes, relations) {
  const own = new Set([note.id, ...(note.children || []).map(n => n.id)]);
  const ids = new Set(relations.filter(r => r.state === 'accepted' && (own.has(r.fromId) || own.has(r.toId))).flatMap(r => [r.fromId, r.toId]));
  return notes.filter(n => ids.has(n.id) && !own.has(n.id) && n.meta?.stage !== 'retired' && !n.meta?.supersededBy);
}
