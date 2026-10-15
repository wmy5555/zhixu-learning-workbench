import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createMarkdownEditor, loadMarkdownEditor, richFallbackReason, controlledAssetUrl, guardEditorImages } from '../public/markdown-editor.mjs';

const context = { console, setTimeout, clearTimeout, TextEncoder, TextDecoder };
context.global = context; context.globalThis = context; context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../public/vendor/vditor/dist/js/lute/lute.min.js', import.meta.url), 'utf8'), context);
function engine() {
  const lute = context.Lute.New();
  lute.SetSanitize(true); lute.SetEmoji(false); lute.SetInlineMath(false);
  lute.SetVditorCodeBlockPreview(false); lute.SetVditorMathBlockPreview(false);
  return lute;
}
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.events = {}; this.attributes = {}; this.hidden = false; this.disabled = false; this.dataset = {}; }
  set value(value) { this._value = String(value).replace(/\r\n?/g, '\n'); }
  get value() { return this._value || ''; }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  addEventListener(name, handler) { this.events[name] = handler; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  focus() {}
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); }
}
function fixture(value, options = {}) {
  globalThis.Node = Element;
  globalThis.document = { createElement: tag => new Element(tag), createTextNode: text => Object.assign(new Element('text'), { textContent: text }) };
  globalThis.window = { Lute: context.Lute };
  const textarea = new Element('textarea'); textarea.value = value;
  let editor;
  class Vditor {
    constructor(host, config) {
      this.vditor = { lute: engine() }; this.config = config; editor = this;
      this.setValue(''); queueMicrotask(config.after);
    }
    getValue() { return this.markdown; }
    setValue(value) { this.markdown = this.vditor.lute.VditorDOM2Md(this.vditor.lute.Md2VditorDOM(value)); }
    insertValue(value) { this.setValue(this.markdown + value); }
    focus() {}
    destroy() { this.destroyed = true; }
  }
  const root = createMarkdownEditor(textarea, { value, loadEditor: async () => Vditor, ...options });
  return { root, textarea, get editor() { return editor; }, host: root.children[2], status: root.children[3] };
}

test('real parser normalization cannot rewrite untouched Markdown across repeated mode switches', async () => {
  for (const source of ['# 标题\r\n\r\n- 一\r\n- 二  \r\n', '无末尾换行', '\n\n**粗体**\n\n\n', ':doge: 与 :smile:']) {
    const f = fixture(source);
    assert.equal(f.root.getValue(), source);
    for (let i = 0; i < 3; i++) {
      await f.root.switchMode('rich'); assert.equal(f.root.getMode(), 'rich');
      assert.equal(f.root.getValue(), source);
      await f.root.switchMode('source'); assert.equal(f.root.getValue(), source);
    }
    f.root.destroy();
  }
});

test('both modes edit the same draft and immediate read sees rich edits without waiting for debounce', async () => {
  const f = fixture('# 原标题\r\n\r\n原文');
  f.textarea.value += '\n\n源码增加';
  await f.root.switchMode('rich');
  assert.ok(f.editor.getValue().includes('源码增加'));
  f.editor.insertValue('\n\n**可视化增加**');
  assert.ok(f.root.getValue().includes('**可视化增加**'));
  await f.root.switchMode('source');
  assert.ok(f.textarea.value.includes('源码增加'));
  assert.ok(f.textarea.value.includes('**可视化增加**'));
  f.textarea.value += '\n再次编辑';
  await f.root.switchMode('rich');
  assert.ok(f.root.getValue().endsWith('再次编辑'));
  f.root.destroy();
});

test('programmatic initial values, resets and sample replacements share one exact draft and cancel late loads', async () => {
  const initial = fixture('', { value: '# 文件预览\r\n\r\n原文\r\n' });
  assert.equal(initial.root.getValue(), '# 文件预览\r\n\r\n原文\r\n');
  initial.root.destroy();
  const f = fixture('# 首份\r\n\r\n- 原文\r\n');
  await f.root.switchMode('rich'); f.editor.insertValue('\n\n**修改**');
  f.root.setValue('');
  assert.equal(f.root.getMode(), 'source'); assert.equal(f.root.getValue(), '');
  await f.root.switchMode('rich'); assert.equal(f.root.getValue(), '');
  f.root.setValue('# 新样例\r\n\r\n保留末尾\r\n');
  await f.root.switchMode('rich');
  assert.equal(f.root.getValue(), '# 新样例\r\n\r\n保留末尾\r\n');
  assert.doesNotMatch(f.editor.getValue(), /首份|修改/);
  assert.equal(f.textarea.markdownEditor, f.root);
  let resolve;
  const late = fixture('旧草稿', { loadEditor: () => new Promise(done => { resolve = done; }) });
  const loading = late.root.switchMode('rich');
  late.root.setValue('新草稿\r\n'); resolve(class {}); await loading;
  assert.equal(late.root.getMode(), 'source'); assert.equal(late.root.getValue(), '新草稿\r\n');
  f.root.destroy(); late.root.destroy();
});

test('unsupported extensions and inline formulas explicitly stay in source with exact bytes', async () => {
  for (const source of ['[[知识双链]]\r\n', '![[image.png]]', '<details><summary>正文</summary>保留</details>', '<!-- 原文标记 -->\n正文', '$x^2$\n', '---\ntitle: 元数据\n---\n正文', ':::custom\n保留\n:::']) {
    const f = fixture(source); await f.root.switchMode('rich');
    assert.equal(f.root.getMode(), 'source'); assert.equal(f.root.getValue(), source);
    assert.match(f.status.textContent, /保留源码/);
    f.root.destroy();
  }
  const lute = engine();
  for (const source of ['```html\n<img onerror=alert(1)>\n```', '~~~plantuml\nAlice -> Bob\n~~~', '$$\nx^2\n$$', '| a | b |\n|---|---|\n|1|2|']) assert.equal(richFallbackReason(source, lute), '');
});

test('Markdown editing and preview conversion sanitize executable payloads while code stays literal', () => {
  const lute = engine();
  for (const source of ['[危险](javascript:alert(1))', '[危险](JaVaScRiPt:alert(1))', '<img src="x" onerror="alert(1)">', '<svg onload="alert(1)"></svg>', '<script>alert(1)</script>']) {
    const editing = lute.Md2VditorDOM(source);
    const preview = lute.Md2HTML(source);
    for (const html of [editing, preview]) {
      assert.doesNotMatch(html, /<(?:script|iframe)\b/i);
      assert.doesNotMatch(html, /<[^>]+\son\w+\s*=/i);
      assert.doesNotMatch(html, /(?:href|src)="\s*javascript:/i);
    }
  }
  const code = lute.Md2VditorDOM('```html\n<img src=x onerror=alert(1)>\n```');
  assert.ok(code.includes('&lt;img')); assert.doesNotMatch(code, /<img\b/);
  // Upstream permits iframes in its sanitizer; the adapter refuses raw HTML.
  assert.match(richFallbackReason('<iframe src="https://example.invalid"></iframe>', lute), /保留源码/);
});

test('HTML clipboard embeds switch to literal source instead of entering the rich DOM', async () => {
  const f = fixture('正文'); await f.root.switchMode('rich');
  f.host.events.paste({ preventDefault() {}, stopImmediatePropagation() {}, clipboardData: { files: [], getData: type => type === 'text/html' ? '<iframe src="https://example.invalid"></iframe>' : '' } });
  assert.equal(f.root.getMode(), 'source'); assert.ok(f.root.getValue().includes('<iframe'));
  assert.equal(f.editor.getValue().includes('<iframe'), false);
  assert.match(f.status.textContent, /追加到源码末尾/);
  f.root.destroy();
});

test('HTML clipboard is sanitized before Markdown insertion, and unsupported binary paste is not embedded', async () => {
  const f = fixture('正文'); await f.root.switchMode('rich');
  let stopped = 0;
  f.host.events.paste({ preventDefault() {}, stopImmediatePropagation() { stopped++; }, clipboardData: { files: [], getData: type => type === 'text/html' ? '<p><strong>粘贴粗体</strong><img src=x onerror=alert(1)><a href="javascript:alert(2)">危险</a><script>alert(3)</script></p>' : '粘贴文字' } });
  assert.equal(stopped, 1); assert.ok(f.root.getValue().includes('**粘贴粗体**'));
  assert.doesNotMatch(f.editor.vditor.lute.Md2VditorDOM(f.root.getValue()), /<[^>]+\son\w+\s*=|javascript:|<script/i);
  const before = f.root.getValue();
  f.host.events.paste({ preventDefault() {}, stopImmediatePropagation() {}, clipboardData: { files: [{ type: 'image/png', name: 'local.png' }] } });
  assert.equal(f.root.getValue(), before); assert.match(f.status.textContent, /尚未接入/);
  assert.equal(f.editor.config.cache.enable, false); assert.equal(f.editor.config.preview.markdown.sanitize, true);
  assert.equal(f.editor.config.icon, '', 'the upstream inline icon loader stays disabled under CSP');
  f.root.destroy();
});

test('editor waits for external local icon sprite and runtime; failed loading is retryable without inline code', async () => {
  const head = new Element('head');
  globalThis.document = { head, createElement: tag => new Element(tag) };
  globalThis.window = { Vditor: class {} };
  const failed = loadMarkdownEditor();
  const rejection = assert.rejects(failed, /加载失败/);
  const failedScripts = head.children.filter(node => node.tagName === 'script');
  assert.equal(failedScripts.length, 2);
  failedScripts[1].events.error(); await rejection;
  assert.equal(head.children.length, 0);
  let ready = false;
  const loaded = loadMarkdownEditor().then(value => { ready = true; return value; });
  const scripts = head.children.filter(node => node.tagName === 'script');
  assert.deepEqual(scripts.map(node => node.attributes.src), ['/vendor/vditor/dist/index.min.js', '/vendor/vditor/dist/js/icons/ant.js']);
  scripts[0].events.load(); await Promise.resolve(); assert.equal(ready, false);
  scripts[1].events.load(); assert.equal(await loaded, window.Vditor);
  assert.ok(scripts.every(node => !node.text && !node.innerHTML));
});

test('late load/cancel and loading failures preserve the current draft', async () => {
  let resolve;
  const f = fixture('原文\r\n', { loadEditor: () => new Promise(done => { resolve = done; }) });
  const pending = f.root.switchMode('rich'); await f.root.switchMode('source'); resolve(class {}); await pending;
  assert.equal(f.root.getMode(), 'source'); assert.equal(f.root.getValue(), '原文\r\n');
  const failed = fixture('保留', { loadEditor: async () => { throw new Error('断网'); } });
  await failed.root.switchMode('rich'); assert.equal(failed.root.getValue(), '保留'); assert.match(failed.status.textContent, /断网/);
});

test('injected image uploads accept only a stable attachment identity and cannot insert after changing modes', async () => {
  const assetId = 'b'.repeat(64) + '.png', asset = { attachmentId: assetId, markdownUrl: '../.zhixu-attachments/' + assetId };
  const pasteFile = f => f.host.events.paste({ preventDefault() {}, stopImmediatePropagation() {}, clipboardData: { files: [{ name: '本地图片.png', type: 'image/png' }] } });
  const valid = fixture('正文', { uploadImage: async () => asset }); await valid.root.switchMode('rich');
  pasteFile(valid); await new Promise(setImmediate);
  assert.ok(valid.root.getValue().includes(asset.markdownUrl)); assert.doesNotMatch(valid.root.getValue(), /blob:|data:image/);
  const invalid = fixture('正文', { uploadImage: async () => ({ attachmentId: assetId, markdownUrl: 'blob:temporary' }) }); await invalid.root.switchMode('rich');
  pasteFile(invalid); await new Promise(setImmediate);
  assert.equal(invalid.root.getValue(), '正文'); assert.match(invalid.status.textContent, /未返回稳定/);
  let resolve;
  const late = fixture('保留', { uploadImage: () => new Promise(done => { resolve = done; }) }); await late.root.switchMode('rich');
  pasteFile(late); await late.root.switchMode('source'); resolve(asset); await new Promise(setImmediate);
  assert.equal(late.root.getValue(), '保留');
  valid.root.destroy(); invalid.root.destroy(); late.root.destroy();
});

test('image property hook removes direct URL mutation controls and returns the exact current draft to source', async () => {
  const original = '![原图片](https://example.invalid/original.png)\r\n\r\n原文';
  const f = fixture(original); await f.root.switchMode('rich');
  const popover = new Element('div'), directUrl = new Element('input'); popover.append(directUrl);
  f.editor.config.customWysiwygToolbar('table', popover);
  assert.equal(popover.children[0], directUrl, 'other property tools remain unchanged');
  f.editor.config.customWysiwygToolbar('image', popover);
  assert.equal(popover.children.includes(directUrl), false);
  assert.equal(popover.children.some(item => item.tagName === 'input'), false);
  assert.equal(f.root.getValue(), original);
  f.editor.insertValue('\n\n**保留富文本草稿**');
  const before = f.root.getValue();
  await popover.children.find(item => item.tagName === 'button').events.click();
  assert.equal(f.root.getMode(), 'source'); assert.equal(f.root.getValue(), before);
  assert.ok(f.root.getValue().includes('https://example.invalid/original.png'));
  assert.doesNotMatch(f.root.getValue(), /blob:|data:image|file:/);
  f.root.destroy();
});

test('attachment display URLs must stay on a controlled same-origin note attachment endpoint', () => {
  const origin = 'http://127.0.0.1:4329';
  assert.equal(controlledAssetUrl('/api/notes/source/attachments?asset=abc.png', origin), `${origin}/api/notes/source/attachments?asset=abc.png`);
  for (const value of ['https://remote.invalid/a.png', 'blob:abc', 'file:///C:/secret', 'data:image/svg+xml,a', '/api/settings?asset=a', '/api/notes/x/attachments', '//remote.invalid/api/notes/a/attachments?asset=x']) assert.equal(controlledAssetUrl(value, origin), '');
});

test('image rendering never places remote URLs in a live src and round-trips only image destinations', () => {
  const lute = engine(), assetId = 'a'.repeat(64) + '.png', reference = '../.zhixu-attachments/' + assetId;
  const displayUrl = 'http://127.0.0.1:4329/api/notes/source/attachments?asset=' + assetId;
  const preview = guardEditorImages(lute, { origin: 'http://127.0.0.1:4329', assetResolver: value => value === reference ? displayUrl : null });
  const source = `![远图](https://example.invalid/a.png?a=1&b=2)\n\n![附件](${reference})\n\n普通文字 ${displayUrl}\n`;
  const dom = lute.Md2VditorDOM(source);
  assert.doesNotMatch(dom, /src="https:\/\/example.invalid/);
  assert.match(dom, /src="data:image\/gif/); assert.ok(dom.includes(displayUrl));
  const plainEngine = engine();
  assert.equal(lute.VditorDOM2Md(dom), plainEngine.VditorDOM2Md(plainEngine.Md2VditorDOM(source)));
  const edited = lute.SpinVditorDOM(dom);
  assert.doesNotMatch(edited, /src="https:\/\/example.invalid/);
  assert.ok(lute.VditorDOM2Md(edited).includes('https://example.invalid/a.png?a=1&b=2'));
  assert.doesNotMatch(preview(lute.Md2HTML(source)), /src="https:\/\/example.invalid/);
});

test('vendored runtime matches pinned package and hashes even with Windows checkout conversion', t => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../public/vendor/vditor/manifest.json', import.meta.url)));
  assert.equal(manifest.version, '4.0.0'); assert.equal(context.Lute.Version, '1.7.6');
  const tempRoot = path.resolve('.tmp'); fs.mkdirSync(tempRoot, { recursive: true });
  const checkout = fs.mkdtempSync(path.join(tempRoot, 'editor-checkout-'));
  t.after(() => { assert.ok(checkout.startsWith(tempRoot + path.sep)); fs.rmSync(checkout, { recursive: true, force: true }); });
  execFileSync('git', ['-c', 'core.autocrlf=true', 'checkout-index', '--prefix=' + checkout.replaceAll('\\', '/') + '/', '--', ...manifest.files.map(file => 'public/vendor/vditor/' + file.path)], { stdio: 'pipe' });
  for (const file of manifest.files) {
    const bytes = fs.readFileSync(new URL('../public/vendor/vditor/' + file.path, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    assert.deepEqual(bytes, fs.readFileSync(new URL('../node_modules/vditor/' + file.path, import.meta.url)));
    assert.deepEqual(bytes, fs.readFileSync(path.join(checkout, 'public/vendor/vditor', file.path)), file.path + ' must retain upstream bytes during Windows checkout');
  }
  assert.equal(fs.existsSync(new URL('../public/vendor/vditor/dist/js/katex', import.meta.url)), false);
});
