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
  constructor(tag) { this.tagName = tag; this.children = []; this.events = {}; this.dataset = {}; this.textContent = ''; this.scrollTop = 0; this.top = 0; }
  append(...children) { this.children.push(...children); }
  setAttribute(key, value) { this[key] = value; }
  addEventListener(name, handler) { this.events[name] = handler; }
  getBoundingClientRect() { return { top: this.top }; }
}
test('inline full source highlights references, locates within its own scroll window, and has no duplicate entry', async () => {
  globalThis.Node = Element;
  globalThis.document = { createElement: tag => new Element(tag), createTextNode: text => Object.assign(new Element('text'), { textContent: text }) };
  const descendants = node => [node, ...node.children.flatMap(descendants)];
  const fullText = node => node.textContent + node.children.map(fullText).join('');
  for (const refs of [[ref('合成引用')], [ref('合成引用'), ref('前后语境'), ref('合成引用')], []]) {
    const input = source(refs), saved = JSON.stringify(input);
    const details = relatedSourceDetails(note, input);
    const nodes = descendants(details);
    assert.equal(nodes[1].textContent, '查看关联原文段落');
    const marks = nodes.filter(n => n.tagName === 'mark');
    assert.equal(marks.length, refs.length > 1 ? 2 : refs.length);
    const viewport = nodes.find(n => n.className === 'original-body related-source-scroll');
    assert.equal(fullText(viewport), body, 'all source text and whitespace retained exactly once');
    if (!refs.length) assert.ok(nodes.some(n => n.textContent.includes('暂未定位到关联段落')));
    assert.ok(nodes.every(n => !n.textContent.includes(note.body)));
    assert.ok(nodes.every(n => n.textContent !== '查看原始资料全文'));
    viewport.top = 100;
    if (marks.length) marks[0].top = 3000;
    details.open = true; details.events.toggle();
    assert.equal(viewport.scrollTop, marks.length ? 2876 : 0);
    const buttons = nodes.filter(n => n.tagName === 'button');
    assert.equal(buttons.length, marks.length > 1 ? 2 : 0);
    if (buttons.length) {
      marks[1].top = 500;
      buttons[1].events.click();
      assert.equal(viewport.scrollTop, 3252);
    }
    const beforeClose = viewport.scrollTop;
    details.open = false; details.events.toggle();
    assert.equal(viewport.scrollTop, beforeClose, 'closing does not reset scroll or move an ancestor');
    assert.equal(JSON.stringify(input), saved);
  }
  const app = await readFile(new URL('../public/app.mjs', import.meta.url), 'utf8');
  const child = app.slice(app.indexOf('function childSection('), app.indexOf('async function refreshSourceGroup('));
  assert.match(child, /relatedSourceDetails\(note, source\)/);
  assert.doesNotMatch(child, /evidenceDetails\(note.id\)/);
  assert.match(child, /查看条目详情与其他核验依据.*openNote\(note.id\)/);
  assert.match(app, /note.kind === "knowledge"\) content.append\(evidenceDetails\(note.id\)/);
  const view = await readFile(new URL('../public/knowledge-view.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(view, /原文定位与分类依据/);
  delete globalThis.Node; delete globalThis.document;
});
