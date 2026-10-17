import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const uiSource = await readFile(new URL('../public/ui.mjs', import.meta.url), 'utf8');
const readerSource = await readFile(new URL('../public/markdown-reader.mjs', import.meta.url), 'utf8');

class Element {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.attributes = {}; this.events = {}; this.dataset = {};
    this._text = ''; this.tabIndex = -1; this.start = 1;
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { throw new Error('HTML execution must never be used'); }
  insertAdjacentHTML() { throw new Error('HTML execution must never be used'); }
  append(...children) { this.children.push(...children); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, handler) { this.events[name] = handler; }
}

function browser() {
  const created = [];
  const document = {
    createElement(tag) { const node = new Element(tag); created.push(node); return node; },
    createTextNode(value) { const node = new Element('text'); node.textContent = value; return node; },
    write() { throw new Error('HTML execution must never be used'); },
  };
  const context = vm.createContext({ document, Node: Element, URL, Intl, Date,
    fetch() { throw new Error('Rendering must not request a network resource'); },
  });
  vm.runInContext(uiSource.replaceAll('export ', '') + '\n'
    + readerSource.replace(/^import .*;$/m, '').replaceAll('export ', '')
    + '\nthis.render = renderMarkdown;', context);
  return { render: context.render, created };
}

function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }
function tags(node, tag) { return descendants(node).filter(item => item.tagName === tag); }
function attribute(node, name) { return node.attributes[name] ?? node[name]; }

test('captured messages unwrap once for reading without changing original text or nested code', () => {
  const { render } = browser();
  const body = '## 会话原文（按收到的顺序保留）\r\n\r\n### 1. 用户\r\n\r\n```text\r\n[$app](app://plugin_example) 请解释\r\n```\r\n\r\n### 2. ChatGPT\r\n\r\n消息编号：```text\r\nm_2\r\n```\r\n\r\n````text\r\n## 合成标题\r\n\r\n**解释**\r\n\r\n- 条目\r\n\r\n```js\r\nconst x = "**字面量**";\r\n```\r\n````';
  const root = render(body, { conversation: true });
  assert.equal(tags(root, 'section').length, 2);
  assert.equal(tags(root, 'strong')[0].textContent, '解释');
  assert.equal(tags(root, 'li')[0].textContent, '条目');
  assert.equal(tags(root, 'pre').length, 1);
  assert.equal(tags(root, 'pre')[0].textContent, 'const x = "**字面量**";\n');
  assert.ok(root.textContent.includes('应用 请解释'));
  assert.ok(root.textContent.includes('消息编号：m_2'));
  assert.equal(root.textContent.includes('app://'), false);
  assert.ok(body.includes('````text\r\n## 合成标题'));
  assert.equal(tags(render(body), 'section').length, 0);
});

test('captured top-level text envelopes render as prose while nested code remains code', () => {
  const { render } = browser();
  const body = '## 收集范围\n\n```text\n普通说明 **重点**\n```\n\n## 会话原文（按收到的顺序保留）\n\n### 1. ChatGPT\n\n````text\n## 正文标题\n\n```js\nconst answer = 42;\n```\n````';
  const root = render(body, { conversation: true });
  assert.equal(tags(root, 'section').length, 2);
  assert.equal(tags(root, 'strong')[0].textContent, '重点');
  assert.equal(tags(root, 'h2').at(-1).textContent, '正文标题');
  assert.equal(tags(root, 'pre').length, 1);
  assert.equal(tags(root, 'pre')[0].textContent, 'const answer = 42;\n');
});

test('conversation rendering keeps malformed envelopes literal and untrusted content inert', () => {
  const { render } = browser();
  const prefix = '## 会话原文（按收到的顺序保留）\n\n### 1. ChatGPT\n\n';
  const content = '# 内容\n\n<script>boom</script>\n\n![图片](https://example.com/x) [危险](javascript:boom)';
  const rendered = render(prefix + '```text\n' + content + '\n```', { conversation: true });
  for (const tag of ['script', 'img', 'iframe', 'a']) assert.equal(tags(rendered, tag).length, 0, tag);
  assert.equal(tags(rendered, 'h1')[0].textContent, '内容');
  const unclosed = render(prefix + '```text\n' + content, { conversation: true });
  assert.equal(tags(unclosed, 'section').length, 0);
  assert.equal(tags(unclosed, 'pre')[0].textContent, content);
  const unrelated = render('### 1. ChatGPT\n\n```text\n# 字面\n```', { conversation: true });
  assert.equal(tags(unrelated, 'section').length, 0);
});

test('exported conversation layout becomes inert readable text while code samples stay literal', () => {
  const { render, created } = browser();
  const layout = '<box background="https://example.com/x" onclick="boom"><text>**步骤**</text><icon name="arrow-down"/><row><badge>资料</badge></row></box>';
  const body = '## 会话原文（按收到的顺序保留）\n\n### 1. ChatGPT\n\n````text\n' + layout + '\n\n`<box>`\n\n<text-other>未知标记</text-other>\n\n```html\n' + layout + '\n```\n````';
  const root = render(body, { conversation: true });
  assert.equal(tags(root, 'strong')[0].textContent, '步骤');
  assert.ok(root.textContent.includes(' ↓ '));
  assert.ok(root.textContent.includes('<box>'));
  assert.ok(root.textContent.includes('<text-other>未知标记</text-other>'));
  assert.equal(tags(root, 'pre')[0].textContent, layout + '\n');
  for (const tag of ['box', 'text', 'icon', 'badge', 'row', 'script', 'img']) {
    if (tag !== 'text') assert.equal(created.some(node => node.tagName === tag), false, tag);
  }
  const mention = render('[$app](app://asdk_app_example)');
  assert.equal(mention.textContent, '应用');
  assert.equal(tags(mention, 'a').length, 0);
});

test('inline images render only an explicitly resolved bound same-origin attachment', () => {
  const { render } = browser(), id = 'a'.repeat(64) + '.png';
  const markdown = `![合成](../.zhixu-attachments/${id}) ![remote](https://example.com/a.png) ![active](data:image/svg+xml;base64,AAAA)`;
  assert.equal(tags(render(markdown), 'img').length, 0);
  const url = '/api/notes/source/attachments?asset=' + id;
  const rendered = render(markdown, { imageResolver: value => value === '../.zhixu-attachments/' + id ? url : null });
  assert.equal(tags(rendered, 'img').length, 1);
  assert.equal(attribute(tags(rendered, 'img')[0], 'src'), url);
  assert.match(rendered.textContent, /https:\/\/example.com/);
  assert.equal(tags(render(markdown, { imageResolver: () => 'javascript:alert(1)' }), 'img').length, 0);
});

test('the shared reader renders the supported body structures with semantic DOM', () => {
  const { render } = browser();
  const body = '# 标题\n\n正文含 **重点** 和 __另一重点__。\n换行保留\n\n- 一项\n- 二项\n\n3. 第三步\n4. 第四步\n\n> 引用 **条件**\n\n| 项目 | 说明 |\n| --- | ---: |\n| 甲 | [资料](https://example.com/read) |';
  const root = render(body, { className: 'original-body' });
  assert.equal(root.className, 'markdown-reader original-body');
  assert.equal(tags(root, 'h1')[0].textContent, '标题');
  assert.deepEqual(tags(root, 'strong').map(node => node.textContent), ['重点', '另一重点', '条件']);
  assert.equal(tags(root, 'ul').length, 1);
  assert.equal(tags(root, 'ol')[0].start, 3);
  assert.deepEqual(tags(root, 'li').map(node => node.textContent), ['一项', '二项', '第三步', '第四步']);
  assert.equal(tags(root, 'blockquote')[0].textContent, '引用 条件');
  assert.equal(tags(root, 'table').length, 1);
  assert.equal(tags(root, 'th')[0].attributes.scope, 'col');
  assert.equal(tags(root, 'th')[1].className, 'markdown-align-right');
  assert.equal(tags(root, 'br').length, 1);
  const link = tags(root, 'a')[0];
  assert.equal(attribute(link, 'href'), 'https://example.com/read');
  assert.equal(attribute(link, 'target'), '_blank');
  assert.equal(attribute(link, 'rel'), 'noopener noreferrer');
});

test('fenced content stays exact literal code even when it contains Markdown and HTML', () => {
  const { render } = browser();
  const literal = '# 不是标题\n**不是加粗**\n- 不是列表\n> 不是引用\n| A | B |\n| --- | --- |\n[不是链接](https://example.com)\n<img src=https://example.com/image onerror=boom>\n```\n  空白  ';
  const root = render('````markdown\n' + literal + '\n````\n\n正文');
  const pre = tags(root, 'pre')[0];
  assert.equal(tags(pre, 'code')[0].textContent, literal + '\n');
  assert.equal(tags(pre, 'code')[0].dataset.language, 'markdown');
  assert.equal(pre.tabIndex, 0);
  for (const tag of ['h1', 'strong', 'ul', 'blockquote', 'table', 'a', 'img']) assert.equal(tags(root, tag).length, 0, tag);
  assert.equal(tags(root, 'p')[0].textContent, '正文');
});

test('unclosed or mismatched fences retain all remaining text without secondary parsing', () => {
  const { render } = browser();
  const body = '# literal\n**literal**\n~~~\n  trailing  \n';
  const root = render('```text\n' + body);
  assert.equal(tags(root, 'code')[0].textContent, body);
  assert.equal(tags(root, 'pre').length, 1);
  assert.equal(tags(root, 'h1').length, 0);
  assert.equal(tags(root, 'strong').length, 0);
  const tilde = render('~~~plain\n```\nraw\n~~~');
  assert.equal(tags(tilde, 'code')[0].textContent, '```\nraw\n');
});

test('untrusted HTML, image syntax and dangerous destinations remain text and create no executable nodes', () => {
  const { render, created } = browser();
  const html = '<script>alert(1)</script><img src="https://example.com/x" onerror="boom"><iframe srcdoc="boom"></iframe>';
  const dangerous = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,boom', 'file:///private', 'vbscript:boom', '//example.com/x', '/private', 'javascript&#58;boom', 'https://example.com/\u0000x'];
  const body = html + '\n\n' + dangerous.map((url, i) => `[危险${i}](${url})`).join(' ') + '\n\n![图片](https://example.com/image) [安全](http://example.com/read)';
  const root = render(body);
  assert.ok(root.textContent.includes(html));
  dangerous.forEach((url, i) => assert.ok(root.textContent.includes(`[危险${i}](${url})`), url));
  assert.ok(root.textContent.includes('![图片](https://example.com/image)'));
  assert.equal(tags(root, 'a').length, 1);
  assert.equal(attribute(tags(root, 'a')[0], 'href'), 'http://example.com/read');
  for (const tag of ['script', 'img', 'iframe', 'style', 'object', 'embed', 'svg']) assert.equal(tags(root, tag).length, 0, tag);
  assert.ok(created.every(node => Object.keys(node.events).length === 0));
  assert.ok(created.every(node => Object.keys(node.attributes).every(name => !/^on/i.test(name))));
});

test('escaped link labels, URL parentheses and textual titles are safe without HTML decoding', () => {
  const { render } = browser();
  const root = render('[\\[资料\\] **标题**](https://example.com/a\\(b\\)?x=1&y=2 "读取\\*")\n[<img src=x onerror=boom>](https://example.com/ "标签")\n\\[不是链接](https://example.com/x)');
  const links = tags(root, 'a');
  assert.equal(links.length, 2);
  assert.equal(links[0].textContent, '[资料] 标题');
  assert.equal(attribute(links[0], 'href'), 'https://example.com/a(b)?x=1&y=2');
  assert.equal(attribute(links[0], 'title'), '读取*');
  assert.equal(links[1].textContent, '<img src=x onerror=boom>');
  assert.equal(tags(root, 'img').length, 0);
  assert.ok(root.textContent.includes('[不是链接](https://example.com/x)'));
});

test('inline code protects Markdown delimiters within bold and links', () => {
  const { render } = browser();
  const root = render('**重点 `** [假](https://example.com) <img>` 仍是重点**\n`# 文本 **文字**`\n[读取 `]` 代码](https://example.com/read)');
  assert.equal(tags(root, 'strong').length, 1);
  assert.equal(tags(root, 'strong')[0].textContent, '重点 ** [假](https://example.com) <img> 仍是重点');
  assert.deepEqual(tags(root, 'code').map(node => node.textContent), ['** [假](https://example.com) <img>', '# 文本 **文字**', ']']);
  assert.equal(tags(root, 'a').length, 1);
  assert.equal(tags(root, 'h1').length, 0);
});

test('table cells keep escaped pipes and code pipes, and unmatched rows fall back without losing text', () => {
  const { render } = browser();
  const root = render('| 文本 | 代码 | 宽内容 |\n| :--- | :---: | ---: |\n| a\\|b | `x|y` | ' + '很长'.repeat(80) + ' |\n| extra | row | has | more |');
  assert.equal(tags(root, 'table').length, 1);
  assert.equal(tags(root, 'td').length, 3);
  assert.equal(tags(root, 'td')[0].textContent, 'a|b');
  assert.equal(tags(root, 'code')[0].textContent, 'x|y');
  assert.equal(tags(root, 'td')[2].textContent, '很长'.repeat(80));
  const scroll = descendants(root).find(node => node.className === 'markdown-table-scroll');
  assert.equal(scroll.tabIndex, 0);
  assert.equal(scroll.attributes.role, 'region');
  assert.equal(tags(root, 'p')[0].textContent, '| extra | row | has | more |');
});

test('nested lists and quotes use a bounded depth and preserve deeper literal content', () => {
  const { render } = browser();
  const root = render('- 父项\n  - 子项\n    1. 子步骤\n- 第二项\n\n> 第一层\n> > 第二层');
  assert.equal(tags(root, 'ul').length, 2);
  assert.equal(tags(root, 'ol').length, 1);
  assert.equal(tags(root, 'blockquote').length, 2);
  assert.ok(root.textContent.includes('父项子项子步骤第二项'));
  const deep = render('> '.repeat(100) + '# 最深处保留');
  assert.ok(tags(deep, 'blockquote').length <= 16);
  assert.ok(deep.textContent.endsWith('# 最深处保留'));
});

test('empty values use the caller placeholder without fabricating content', () => {
  const { render } = browser();
  for (const value of ['', null, undefined, ' \n\t\r\n']) assert.equal(render(value).textContent, '暂无正文');
  assert.equal(render('', { emptyText: '暂无原文' }).textContent, '暂无原文');
  assert.equal(render('', { emptyText: '' }).textContent, '');
});

test('long documents and malformed inline runs keep their complete content within bounded parsing', { timeout: 5000 }, () => {
  const { render } = browser();
  const paragraph = '这是一段完整合成原文。';
  const root = render(Array(12000).fill(paragraph).join('\n\n'));
  assert.equal(tags(root, 'p').length, 12000);
  assert.equal(root.textContent, paragraph.repeat(12000));
  const malformed = '[x]('.repeat(40000) + '结尾必须保留';
  const raw = render(malformed);
  assert.equal(raw.textContent, malformed);
  assert.equal(tags(raw, 'a').length, 0);
});

test('rendering preserves original body and caller metadata while normalizing only display line endings', () => {
  const { render } = browser();
  const note = Object.freeze({ title: '**纯文本标题**', body: '# 原文\r\n\r\n```text\r\n  内容  \r\n```\r\n', hash: 'synthetic-original' });
  const before = JSON.stringify(note);
  const root = render(note.body);
  assert.equal(JSON.stringify(note), before);
  assert.equal(note.title, '**纯文本标题**');
  assert.equal(tags(root, 'code')[0].textContent, '  内容  \n');
});

test('unsupported or incomplete syntax stays visible instead of dropping characters', () => {
  const { render } = browser();
  const body = '**未结束\n[a](https://example.com\n![未闭合图片\n<div title="x">原始 HTML</div>\n| 错误表头 |\n| -- |';
  const root = render(body);
  assert.equal(tags(root, 'a').length, 0);
  assert.equal(tags(root, 'table').length, 0);
  assert.equal(root.textContent.replace(/\n/g, ''), body.replace(/\n/g, ''));
  const title = render('次级标题\n---\n\n###### 六级标题');
  assert.equal(tags(title, 'h2')[0].textContent, '次级标题');
  assert.equal(tags(title, 'h6')[0].textContent, '六级标题');
});

test('generated summary and limitations read as prose while structured data and nested code stay literal', () => {
  const { render } = browser();
  const body = [
    '## 收集范围', '合成测试范围', '补充限制：', '```text', '**仅供预览**', '```',
    '## 整理摘要（ChatGPT 生成，未经独立核验）', '````text', '# 摘要标题', '- 摘要条目',
    '```text', '必须保持代码格式的文本示例', '```', '````',
    '## 结构化整理（模型建议，未经独立核验）', '```text', '{"sample":true}', '```',
    '## 会话原文（按收到的顺序保留）', '### 1. ChatGPT', '````text', '**正文解释**',
    '```js', 'const value = 1;', '```', '````',
  ].join('\n\n');
  const root = render(body, { conversation: true });
  assert.equal(tags(root, 'pre').length, 3);
  assert.ok(tags(root, 'pre')[0].textContent.includes('必须保持代码格式'));
  assert.ok(tags(root, 'pre')[1].textContent.includes('{"sample":true}'));
  assert.ok(tags(root, 'pre')[2].textContent.includes('const value = 1;'));
  assert.deepEqual(tags(root, 'strong').map(n => n.textContent), ['仅供预览', '正文解释']);
  assert.equal(tags(root, 'h1')[0].textContent, '摘要标题');
  assert.equal(tags(root, 'li')[0].textContent, '摘要条目');
  assert.equal(tags(render(body), 'pre').length, 4, 'ordinary notes retain their literal fences');
});

test('unclosed summary envelopes and unrelated fenced text remain literal', () => {
  const { render } = browser();
  const unclosed = render('## 整理摘要（ChatGPT 生成，未经独立核验）\n\n```text\n**不完整**', { conversation: true });
  assert.equal(tags(unclosed, 'pre').length, 1);
  assert.equal(tags(unclosed, 'strong').length, 0);
  const unrelated = render('## 其他资料\n\n```text\n# 字面文本\n```', { conversation: true });
  assert.equal(tags(unrelated, 'h1').length, 0);
  assert.equal(tags(unrelated, 'pre').length, 1);
});
