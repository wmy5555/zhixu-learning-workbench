import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { relatedSourceParagraphs, relatedSourceDetails } from '../public/related-source.mjs';

const note = { id: 'unit', body: 'AI 整理正文，不是原文。' };
const body = '资料标题\r\n\r\n第一段。前后语境保留。\r\n换行仍保留。\r\n\r\n第二段。合成引用。\r\n\r\n第三段。不相关内容。';
const ref = quote => ({ sourceId: 'source', start: body.indexOf(quote), end: body.indexOf(quote) + quote.length, quote });
const source = refs => ({ id: 'source', title: '低敏合成资料', body, structure: { units: [{ id: note.id, sourceRefs: refs }, { id: 'sibling', sourceRefs: [ref('不相关内容')] }] } });

test('one reference returns its verbatim paragraph with context and location only', () => {
  const result = relatedSourceParagraphs(note, source([ref('前后语境')]));
  assert.deepEqual(result, [{ start: body.indexOf('第一段'), end: body.indexOf('\r\n\r\n第二段'), line: 3, text: '第一段。前后语境保留。\r\n换行仍保留。' }]);
});
test('multiple references follow source order and duplicate paragraphs appear once', () => {
  const result = relatedSourceParagraphs(note, source([ref('合成引用'), ref('前后语境'), ref('第一段'), ref('合成引用')]));
  assert.equal(result.length, 2);
  assert.match(result[0].text, /^第一段/);
  assert.match(result[1].text, /^第二段/);
  assert.ok(result.every(p => !p.text.includes('不相关内容')));
});
test('missing, stale, ambiguous or foreign locations never fall back to the source body', () => {
  for (const refs of [[], [{ ...ref('合成引用'), start: 0 }], [{ ...ref('合成引用'), sourceId: 'foreign' }], [{ quote: '。' }], [{ quote: body, start: 0, end: body.length + 1 }]]) {
    assert.deepEqual(relatedSourceParagraphs(note, source(refs)), []);
  }
});
test('legacy sources remain readable; a unique exact stored quote can locate a passage', () => {
  assert.deepEqual(relatedSourceParagraphs(note, { id: 'source', body, meta: { locator: '原始材料' } }), []);
  assert.equal(relatedSourceParagraphs(note, source([{ quote: '合成引用' }]))[0].text, '第二段。合成引用。');
});

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.events = {}; this.dataset = {}; this.textContent = ''; }
  append(...children) { this.children.push(...children); }
  setAttribute(key, value) { this[key] = value; }
  addEventListener(name, handler) { this.events[name] = handler; }
}
test('details show passage or explicit empty state, and full text uses the C reader without writes', async () => {
  globalThis.Node = Element;
  globalThis.document = { createElement: tag => new Element(tag), createTextNode: text => Object.assign(new Element('text'), { textContent: text }) };
  const descendants = node => [node, ...node.children.flatMap(descendants)];
  for (const refs of [[ref('合成引用')], []]) {
    const input = source(refs), saved = JSON.stringify(input), calls = [];
    const details = relatedSourceDetails(note, input, value => calls.push(value));
    const nodes = descendants(details);
    assert.equal(nodes[1].textContent, '查看关联原文段落');
    assert.equal(nodes.filter(n => n.tagName === 'blockquote').length, refs.length);
    if (!refs.length) assert.ok(nodes.some(n => n.textContent === '暂未定位到关联段落'));
    assert.ok(nodes.every(n => !n.textContent.includes(note.body)));
    nodes.find(n => n.tagName === 'button').events.click();
    assert.deepEqual(calls, [input]);
    assert.equal(JSON.stringify(input), saved);
  }
  const app = await readFile(new URL('../public/app.mjs', import.meta.url), 'utf8');
  const child = app.slice(app.indexOf('function childSection('), app.indexOf('async function refreshSourceGroup('));
  assert.match(child, /relatedSourceDetails\(note, source, openSourceReader\)/);
  assert.doesNotMatch(child, /evidenceDetails\(note.id\)/);
  assert.match(child, /查看条目详情与其他核验依据.*openNote\(note.id\)/);
  assert.match(app, /note.kind === "knowledge"\) content.append\(evidenceDetails\(note.id\)/);
  delete globalThis.Node; delete globalThis.document;
});
