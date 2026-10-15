import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { click, control, createAndroidBrowser, descendants, findButton } from './fixtures/android-browser.mjs';

const source = (id = 'source-one', body = '# 原文标题\n\n正文含 **条件**。') => ({
  id, kind: 'source', title: '合成原文', body, hash: `${id}-hash`, meta: { privacy: 'local', stage: 'reference' }, children: [],
});
const knowledge = () => ({ id: 'knowledge-one', kind: 'knowledge', title: '独立知识', body: '独立知识正文', meta: { stage: 'candidate' } });
const library = () => ({ groups: [{ source: source(), children: [] }], standalone: [knowledge()], matchingIds: ['source-one', 'knowledge-one'] });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('Android bundles the exact stable Markdown reader and renders actual source, history and learning views', async () => {
  assert.equal(await readFile(new URL('../apps/android/web/markdown-reader.mjs', import.meta.url), 'utf8'),
    await readFile(new URL('../public/markdown-reader.mjs', import.meta.url), 'utf8'));
  const material = '# 学习材料\n\n- 先读条件\n- 再解释机制\n\n```text\n**原样代码**\n```';
  const fixture = await createAndroidBrowser({ api: {
    history: async () => ({ versions: [{ id: 'original', title: '旧标题', meta: {}, raw: '---\ntitle: 旧标题\n---\n## 旧原文\n\n**旧条件**' }] }),
    study: async () => ({ id: 'study-one', noteId: 'source-one', status: 'reading', material, turns: [] }),
  } });
  fixture.app.renderSourceGroupDrawer(source());
  const original = fixture.app.refs.drawerBody.querySelector('.original-body');
  assert.ok(original.classList.contains('markdown-reader'));
  assert.equal(original.querySelector('h1').textContent, '原文标题');
  assert.equal(original.querySelector('strong').textContent, '条件');

  await fixture.app.renderHistory(source());
  const history = fixture.app.refs.drawerBody.querySelector('.history-reading-body');
  assert.equal(history.querySelector('h2').textContent, '旧原文');
  assert.equal(history.querySelector('strong').textContent, '旧条件');
  assert.equal(history.querySelector('.history-metadata').textContent, '---\ntitle: 旧标题\n---\n');

  fixture.app.state.currentStudy = { id: 'study-one' };
  fixture.app.state.studyTab = 'session';
  fixture.app.state.studyMaterialVisible = true;
  await fixture.app.renderStudy();
  const reading = fixture.app.refs.main.querySelector('.markdown-reader');
  assert.equal(reading.querySelector('h1').textContent, '学习材料');
  assert.equal(reading.querySelectorAll('li').length, 2);
  assert.equal(reading.querySelector('code').textContent, '**原样代码**\n');
});

test('Android reading leaves malicious markup and images inert and only creates safe explicit links', async () => {
  const body = '# 合成安全资料\n\n<script>globalThis.compromised=true</script>\n<img src="https://example.test/pixel" onerror="boom">\n\n'
    + '![图片](https://example.test/image) [危险](javascript:alert(1)) [资料](https://example.test/read)\n\n'
    + '| 条件 | 说明 |\n| --- | --- |\n| **甲** | 乙 |';
  const fixture = await createAndroidBrowser();
  fixture.app.renderSourceGroupDrawer(source('unsafe-source', body));
  const reading = fixture.app.refs.drawerBody.querySelector('.original-body');
  assert.ok(reading.textContent.includes('<script>globalThis.compromised=true</script>'));
  assert.ok(reading.textContent.includes('![图片](https://example.test/image)'));
  assert.ok(reading.textContent.includes('[危险](javascript:alert(1))'));
  for (const tag of ['script', 'img', 'iframe', 'object', 'svg']) assert.equal(reading.querySelector(tag), null, tag);
  const links = reading.querySelectorAll('a');
  assert.equal(links.length, 1);
  assert.equal(links[0].getAttribute('href'), 'https://example.test/read');
  assert.equal(links[0].getAttribute('rel'), 'noopener noreferrer');
  assert.equal(reading.querySelector('table').querySelector('strong').textContent, '甲');
  assert.equal(fixture.context.compromised, undefined);
  assert.ok(descendants(reading).every(node => !Object.keys(node.attributes).some(name => /^on/i.test(name))));
});

test('reading and editing never replace the exact original Markdown with rendered content', async () => {
  const body = '# 精确保留\r\n\r\n**条件**  \r\n\t原始空白\r\n\r\n![仅为文字](https://example.test/image)\r\n';
  const note = source('exact-source', body), updates = [];
  const fixture = await createAndroidBrowser({ api: {
    updateNote: async (id, input) => { updates.push({ id, input }); return note; },
    bootstrap: async () => ({ notes: [] }),
  } });
  fixture.app.renderSourceGroupDrawer(note);
  await click(findButton(fixture.app.refs.drawerBody, '编辑原始资料'));
  const form = fixture.app.refs.drawerBody.querySelector('form');
  assert.equal(control(form, 'body').textContent, body);
  // The lightweight DOM fixture does not emulate textarea's textContent-to-value reflection.
  control(form, 'body').value = control(form, 'body').textContent;
  await form.events.submit({ preventDefault() {} });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].input.body, body);
  assert.equal(note.body, body);
  assert.equal(updates[0].input.expectedHash, 'exact-source-hash');
});

test('Android source and standalone sections fold independently, persist in one library and stay scoped by context', async () => {
  let context = { version: 0, practiceId: '' }, recommendationCalls = 0;
  const fixture = await createAndroidBrowser({ api: {
    getContext: () => context, library: async () => library(),
    recommendations: async () => { recommendationCalls++; throw new Error('Android recommendations must stay disabled'); },
  } });
  fixture.app.state.view = 'library';
  await fixture.app.renderLibrary();
  const firstToggle = findButton(fixture.app.refs.main, '折叠原始资料');
  await click(firstToggle);
  const firstSection = fixture.app.refs.main.querySelector('[data-library-section="sources"]');
  assert.equal(firstSection.querySelector('.library-section-body').hidden, true);
  assert.equal(firstToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(fixture.app.refs.main.querySelector('[data-library-section="standalone"]').querySelector('.library-section-body').hidden, false);
  await fixture.app.renderLibrary();
  assert.ok(findButton(fixture.app.refs.main, '展开原始资料'));
  assert.equal(fixture.app.refs.main.querySelector('.markdown-preview').querySelector('h1').textContent, '原文标题');
  context = { version: 1, practiceId: 'android-local' };
  await fixture.app.renderLibrary();
  assert.ok(findButton(fixture.app.refs.main, '折叠原始资料'));
  await click(firstToggle);
  assert.ok(findButton(fixture.app.refs.main, '折叠原始资料'), 'an old control must not alter the new context');
  assert.equal(recommendationCalls, 0);
  assert.equal(fixture.app.refs.main.querySelector('[data-tour="library-recommendations"]'), null);
});

test('the retained recommendation section folds as a third shared section without enabling the Android route', async () => {
  const fixture = await createAndroidBrowser({ api: {
    runtime: undefined, library: async () => library(),
    recommendations: async () => ({ suggestions: [{ id: 'suggestion-one', noteId: 'knowledge-one', title: '合成建议', reason: '合成依据' }] }),
  } });
  fixture.app.state.view = 'library';
  await fixture.app.renderLibrary();
  assert.equal(fixture.app.refs.main.querySelectorAll('[data-library-section]').length, 3);
  await click(findButton(fixture.app.refs.main, '折叠知识使用建议'));
  assert.equal(fixture.app.refs.main.querySelector('[data-library-section="recommendations"]').querySelector('.library-section-body').hidden, true);
  assert.equal(fixture.app.refs.main.querySelector('[data-library-section="sources"]').querySelector('.library-section-body').hidden, false);
});

test('a pending library response cannot replace a newer typed filter or a different page', async () => {
  const pending = deferred();
  let calls = 0;
  const fixture = await createAndroidBrowser({ api: { library: async () => ++calls === 1 ? library() : pending.promise } });
  fixture.app.state.view = 'library';
  await fixture.app.renderLibrary();
  const form = fixture.app.refs.main.querySelector('[data-tour="library-filter"]');
  fixture.app.state.libraryFilters.q = '先前检索';
  const loading = fixture.app.renderLibrary();
  control(form, 'q').value = '正在输入的新检索';
  form.events.input();
  pending.resolve({ groups: [], standalone: [] });
  await loading;
  assert.equal(fixture.app.refs.main.querySelector('[data-tour="library-filter"]'), form);
  assert.equal(control(form, 'q').value, '正在输入的新检索');
  assert.equal(fixture.app.state.libraryFilters.q, '正在输入的新检索');

  const later = deferred();
  fixture.context.api.library = () => later.promise;
  const oldPage = fixture.app.renderLibrary();
  fixture.app.state.view = 'capture';
  await fixture.app.renderCapture();
  const capture = fixture.app.refs.main.querySelector('.capture-form');
  later.resolve(library());
  await oldPage;
  assert.equal(fixture.app.refs.main.querySelector('.capture-form'), capture);
});

test('a response from another library context and a stale failure leave the new page intact', async () => {
  let context = { practiceId: '', version: 0 };
  const pending = deferred();
  const fixture = await createAndroidBrowser({ api: { getContext: () => context, library: () => pending.promise } });
  fixture.app.state.view = 'library';
  const old = fixture.app.renderLibrary();
  context = { practiceId: 'android-local', version: 1 };
  await fixture.app.renderCapture();
  const capture = fixture.app.refs.main.querySelector('.capture-form');
  pending.reject(new Error('stale library unavailable'));
  await old;
  assert.equal(fixture.app.refs.main.querySelector('.capture-form'), capture);
});

test('filtering hides unrelated advice immediately and excludes retained-source siblings', async () => {
  let suggestions;
  const fixture = await createAndroidBrowser({ api: {
    runtime: undefined,
    library: async () => ({ groups: [{ source: source(), children: [{ ...knowledge(), id: 'matched-child' }, { ...knowledge(), id: 'sibling' }] }], standalone: [], matchingIds: ['matched-child'] }),
    recommendations: async () => ({ suggestions }),
  } });
  suggestions = [{ id: 'sibling-advice', noteId: 'sibling', title: '不相关建议' }];
  fixture.app.state.view = 'library';
  await fixture.app.renderLibrary();
  const oldAdvice = fixture.app.refs.main.querySelector('[data-tour="library-recommendations"]');
  const form = fixture.app.refs.main.querySelector('[data-tour="library-filter"]');
  control(form, 'q').value = '命中子项';
  form.events.input();
  assert.equal(oldAdvice.hidden, true);
  await fixture.app.renderLibrary();
  assert.equal(fixture.app.refs.main.querySelector('[data-tour="library-recommendations"]'), null);
  suggestions = [{ id: 'matched-advice', noteId: 'matched-child', title: '相关建议' }, { id: 'sibling-advice', noteId: 'sibling', title: '不相关建议' }];
  await fixture.app.renderLibrary();
  const advice = fixture.app.refs.main.querySelector('[data-tour="library-recommendations"]');
  assert.ok(advice.textContent.includes('相关建议'));
  assert.equal(advice.textContent.includes('不相关建议'), false);
});
