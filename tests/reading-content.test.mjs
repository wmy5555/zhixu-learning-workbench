import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationContent, readingContent, readingGroups, relatedReadingNotes } from '../public/web/reading-content.mjs';
import { reader } from '../public/web/reader.mjs';
import { markdown } from '../public/web/markdown.mjs';

const literal = value => {
  const length = Math.max(3, ...[...value.matchAll(/`+/g)].map(m => m[0].length + 1));
  const fence = '`'.repeat(length);
  return `${fence}text\n${value}\n${fence}`;
};
const fixture = (text = '## 为什么需要持续学习\n\n**关键判断**\n\n```js\nconst answer = 42;\n```') => ({
  id: 'source', kind: 'source', title: '合成资料', meta: { chatgptSync: { snapshot: { coverage: 'visible_history' } } },
  body: ['## 收集范围', '原文范围说明', '## 整理摘要（ChatGPT 生成，未经独立核验）', literal('讨论了持续学习。'),
    '## 结构化整理（模型建议，未经独立核验）', literal('{"version":1,"items":[]}'),
    '## 会话原文（按收到的顺序保留）', '### 1. 用户', `消息编号：${literal('message-user')}`, literal('解释持续学习。'),
    '### 2. ChatGPT', `消息编号：${literal('message-assistant')}`, literal(text)].join('\n\n'),
});

test('reading projects transcript content without transport fields or changing stored input', () => {
  const note = fixture(), before = JSON.stringify(note), content = readingContent(note);
  assert.equal(content.conversation.messages.length, 2);
  assert.equal(content.conversation.summary, '讨论了持续学习。');
  assert.equal(content.conversation.scope, '当前可见的会话分支 · 2 条消息');
  assert.match(content.html, /<strong>关键判断<\/strong>/);
  assert.match(content.html, /<pre><code>const answer = 42;/);
  assert.equal((content.html.match(/<pre>/g) || []).length, 1);
  for (const field of ['消息编号', 'message-assistant', '结构化整理', '&quot;version&quot;', '收集范围', '讨论了持续学习。']) assert.ok(!content.html.includes(field), field);
  assert.deepEqual(content.headings.map(h => h.title), ['为什么需要持续学习']);
  assert.equal(JSON.stringify(note), before);
});

test('lookalike metadata inside a real message remains content', () => {
  const note = fixture('## 收集范围\n\n消息编号：不要隐藏这一行\n\n{"version":1,"items":[]}');
  const result = readingContent(note);
  assert.match(result.html, /不要隐藏这一行/);
  assert.match(result.html, /&quot;version&quot;/);
  assert.match(result.html, /收集范围/);
});

test('unrecognised edits are not silently discarded and ordinary sources stay ordinary', () => {
  const note = fixture(); note.body += '\n\n我手工补充的内容';
  assert.equal(conversationContent(note), null);
  assert.match(readingContent(note).html, /我手工补充的内容/);
  assert.equal(conversationContent({ ...fixture(), meta: {} }), null);
});

test('summary headings in a quoted envelope cannot replace the real transcript boundary', () => {
  const note = fixture(); note.body = note.body.replace(literal('讨论了持续学习。'), literal('## 会话原文（按收到的顺序保留）\n\n摘要里的引用'));
  assert.equal(conversationContent(note).messages.length, 2);
});

test('outline uses valid current references in source order and creates working anchors', () => {
  const note = fixture();
  const first = note.body.indexOf('解释持续学习。'), second = note.body.indexOf('const answer');
  note.structure = { state: 'ready', units: [
    { shortTitle: '学习机制', sourceRefs: [{ sourceId: note.id, start: second, end: second + 12, quote: note.body.slice(second, second + 12) }] },
    { shortTitle: '问题与语境', sourceRefs: [{ sourceId: note.id, start: first, end: first + 7, quote: note.body.slice(first, first + 7) }] },
  ] };
  const result = readingContent(note);
  assert.equal(result.aiOutline, true);
  assert.deepEqual(result.headings.map(h => h.title), ['问题与语境', '学习机制']);
  for (const heading of result.headings) assert.ok(result.html.includes(`id="${heading.id}"`));
  note.structure.state = 'stale';
  assert.equal(readingContent(note).aiOutline, false);
});

test('invalid or other-source references cannot create misleading outline links', () => {
  const note = fixture(); note.structure = { state: 'partial', units: [
    { shortTitle: '错误位置', sourceRefs: [{ sourceId: note.id, start: 0, end: 1, quote: '不存在' }] },
    { shortTitle: '其他原文', sourceRefs: [{ sourceId: 'other', start: 0, end: 2, quote: '##' }] },
  ] };
  assert.equal(readingContent(note).aiOutline, false);
});

test('reader separates source children and actual relations, with expandable lists', () => {
  const note = fixture(); note.children = Array.from({ length: 8 }, (_, i) => ({ id: `child-${i}`, title: `子知识 ${i}`, kind: 'knowledge' }));
  const external = { id: 'external', title: '其他关联', kind: 'knowledge' };
  assert.equal(readingGroups(note, [...note.children, external, external]).related.length, 1);
  const result = reader(note, [{ id: 'recent', title: '无关的最近记录', kind: 'knowledge' }], 'library', [external]);
  assert.match(result.html, /从这份资料拆解/);
  assert.match(result.html, /其他关联知识/);
  assert.match(result.html, /展开更多（3）/);
  assert.ok(!result.html.includes('无关的最近记录'));
  assert.match(result.html, /desk-abstract/);
  assert.ok(!result.html.split('class="article-prose"')[1].split('</div>')[0].includes('讨论了持续学习。'));
});

test('source right margin retains the full numbered child list apart from related knowledge', () => {
  const note = fixture();
  note.children = Array.from({ length: 19 }, (_, i) => ({ id: `child-${i}`, title: `子知识 ${i}`, kind: 'knowledge', meta: { stage: 'candidate' } }));
  note.children.push(note.children[0], { id: note.id, title: '资料自身', kind: 'source' });
  const html = reader(note, [], 'library', [{ id: 'other', title: '其他关联知识内容', kind: 'knowledge' }]).html;
  const margin = html.split('<aside class="reading-margin">')[1].split('</aside>')[0];
  assert.match(margin, /<h2>这份资料里的想法<\/h2>/);
  assert.match(margin, /19 条知识，逐一读懂/);
  assert.match(margin, /aria-label="这份资料拆解出的知识"/);
  assert.equal((margin.match(/class="related-note"/g) || []).length, 19);
  for (let i = 0; i < 19; i++) assert.match(margin, new RegExp(`data-route="read/child-${i}"`));
  assert.match(margin, /<span>01<\/span>/);
  assert.match(margin, /<span>19<\/span>/);
  assert.equal((margin.match(/待选学/g) || []).length, 19);
  assert.doesNotMatch(margin, /其他关联知识内容|资料自身/);
  assert.match(margin, /data-action="process"/);
  assert.match(html, /展开更多（14）/);
});

test('source without child knowledge keeps its reading and extraction actions without a fake list', () => {
  const margin = reader(fixture(), []).html.split('<aside class="reading-margin">')[1].split('</aside>')[0];
  assert.match(margin, /先读原文，再决定值得留下什么/);
  assert.doesNotMatch(margin, /class="related-note"|逐一读懂/);
  assert.match(margin, /data-action="process"/);
  assert.match(margin, /data-action="extract"/);
});

test('long abstract renders one complete content block rather than preview plus duplicate full text', () => {
  const note = fixture();
  const summary = '同一份摘要应在原位展开。'.repeat(30);
  note.body = note.body.replace(literal('讨论了持续学习。'), literal(summary));
  const html = reader(note, []).html;
  assert.equal(html.split('同一份摘要应在原位展开。').length - 1, 30);
  assert.ok(html.includes(summary));
  assert.match(html, /aria-expanded="false" aria-controls="reader-abstract-copy"/);
  assert.equal((html.match(/id="reader-abstract-copy"/g) || []).length, 1);
});

test('related reading follows accepted edges in both directions and omits retired notes', () => {
  const note = { id: 'source', children: [{ id: 'child' }] };
  const notes = ['source', 'child', 'left', 'right', 'suggestion', 'unrelated', 'retired'].map(id => ({ id, meta: { stage: id === 'retired' ? 'retired' : 'reference' } }));
  const relations = [
    { fromId: 'left', toId: 'child', state: 'accepted' }, { fromId: 'child', toId: 'right', state: 'accepted' },
    { fromId: 'child', toId: 'suggestion', state: 'suggested' }, { fromId: 'child', toId: 'retired', state: 'accepted' },
  ];
  assert.deepEqual(relatedReadingNotes(note, notes, relations).map(n => n.id), ['left', 'right']);
});

test('known exported layout markers flatten safely; actual code remains literal', () => {
  const note = fixture('<box padding={3}>**能力**<caption>长期积累</caption></box>\n\n<cite refs="private_token"/>\n\n<script>alert(1)</script>\n\n```html\n<box>保留代码</box>\n```');
  const html = readingContent(note).html;
  assert.match(html, /<strong>能力<\/strong>/);
  assert.match(html, /长期积累/);
  assert.ok(!html.includes('private_token'));
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;box&gt;保留代码&lt;\/box&gt;/);
  assert.match(markdown('<box>普通原文</box>').html, /&lt;box&gt;/);
  assert.match(markdown('`<box>示例</box>`', { presentation: true }).html, /&lt;box&gt;示例&lt;\/box&gt;/);
});

test('exported charts retain knowledge as tables and citation components hide internal tokens', () => {
  const chart = '<Chart content={{"meta":{"title":"能力变化","footer":"特定实验"},"xKey":"method","series":[{"dataKey":"value","label":"变化","valueSuffix":"%"}],"data":[{"method":"LoRA","value":71}]}}/>';
  const note = fixture(chart + '\n\n<Cite refs={["private_token"]}/> <MemoryCite />\n\n<Link url="https://example.com/paper" title="论文"/>\n\n<grid><grid-item><title>概念</title></grid-item></grid>');
  const html = readingContent(note).html;
  assert.match(html, /<td>LoRA<\/td><td>71%<\/td>/);
  assert.match(html, /特定实验/);
  assert.match(html, /href="https:\/\/example.com\/paper"/);
  for (const hidden of ['private_token', 'chartType', 'dataKey', '&lt;grid', '&lt;title', '&lt;Cite', '&lt;MemoryCite']) assert.ok(!html.includes(hidden), hidden);
  assert.match(html, /概念/);
});

test('imported child knowledge keeps prose and real uncertainty, hides source IDs', () => {
  const note = { id: 'child', meta: { chatgptImport: {} }, body: [
    '## 知识建议（未经独立核验）', literal('**可复用内容**'), '## 来源消息编号', literal('private_message_id'),
    '## 不确定性与限制', literal('ChatGPT 生成的整理尚未独立核验，不代表用户理解或掌握。\n需要在新任务上验证。')
  ].join('\n\n') };
  const result = readingContent(note);
  assert.match(result.html, /<strong>可复用内容<\/strong>/);
  assert.match(result.html, /需要在新任务上验证/);
  assert.ok(!result.html.includes('private_message_id'));
});

test('exported data loops and numeric example state render without executing JavaScript', () => {
  const note = fixture('{#each [{name:"规划",desc:"取得审批"},{name:"投产",desc:"设备交付"}] as step,i}\n<box>{i+1}. {step.name}</box>\n<caption>{step.desc}</caption>\n{#if i<1}\n<icon name="arrow-down"/>\n{/if}\n{/each}\n\n{@body const [cut,setCut]=DIL.useState(40)}\n\n比例：{cut}%\n\n价格：{(15-4*cut/100).toFixed(1)} 元');
  const html = readingContent(note).html;
  assert.match(html, /规划/); assert.match(html, /设备交付/); assert.match(html, /比例：40%/); assert.match(html, /价格：13.4 元/);
  for (const token of ['{#each','DIL.useState','{step','{cut}','toFixed','{/if}']) assert.ok(!html.includes(token), token);
  assert.match(markdown('```js\n{@body const [cut,setCut]=DIL.useState(40)}\n```', { presentation:true }).html, /DIL.useState/);
});

test('nested exported loops cannot multiply output without a shared bound', () => {
  const each = '{#each ["一","二","三","四","五","六","七","八","九","十"] as x}\n';
  const result = markdown(each.repeat(4) + '{x}\n' + '{/each}\n'.repeat(4), { presentation:true });
  assert.ok(result.html.length < 70000);
  assert.match(result.html, /重复展示已收起/);
});


test('reader estimates duration from the displayed count at 400 characters per minute',()=>{
 for(const kind of ['knowledge','source'])for(const [count,minutes] of [[0,1],[292,1],[400,1],[401,2],[800,2],[801,3]]){
  const note={id:'synthetic',kind,title:'阅读时长测试',body:'字'.repeat(count),meta:{stage:'candidate'}};
  const html=reader(note,[]).html;
  assert.ok(html.includes(`${count.toLocaleString()} 字 · <span title="按每分钟 400 字估算">阅读 ${minutes} 分钟</span>`));
 }
 const note=fixture('字'.repeat(800)),count=readingContent(note).conversation.count;
 assert.ok(reader(note,[]).html.includes(`阅读 ${Math.max(1,Math.ceil(count/400))} 分钟`));
});
