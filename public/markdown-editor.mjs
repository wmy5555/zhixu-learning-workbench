import { el, button } from './ui.mjs';

const VENDOR = '/vendor/vditor';
let assets;

export function loadMarkdownEditor() {
  if (!assets) {
    const css = el('link', { rel: 'stylesheet', href: `${VENDOR}/dist/index.css` });
    // Vditor's automatic icon loader uses sync XHR + inline script, which our
    // CSP correctly refuses. Load the unchanged local sprite as an external
    // script and disable only that automatic loader via its public icon option.
    const scripts = ['dist/index.min.js', 'dist/js/icons/ant.js'].map(path => el('script', { src: `${VENDOR}/${path}` }));
    assets = Promise.all(scripts.map(script => new Promise((resolve, reject) => {
      script.addEventListener('load', resolve);
      script.addEventListener('error', () => reject(new Error('可视化编辑器加载失败，可继续编辑源码。')));
    }))).then(() => window.Vditor).catch(error => {
      assets = null; css.remove(); scripts.forEach(script => script.remove()); throw error;
    });
    document.head.append(css, ...scripts);
  }
  return assets;
}

// Keep the exact source until the rich DOM actually differs from its own baseline.
// Initializing Vditor or visiting a mode must never normalize a user's Markdown.
export function createMarkdownDraft(value) {
  let source = String(value ?? ''), baseline = '', sourceView = source.replace(/\r\n?/g, '\n');
  return {
    get source() { return source; },
    readSource(value) { return String(value) === sourceView ? source : String(value); },
    setSource(value) { source = String(value); sourceView = source.replace(/\r\n?/g, '\n'); },
    beginRich(value) { baseline = String(value); },
    readRich(value) { return String(value) === baseline ? source : String(value); },
  };
}

export function richFallbackReason(markdown, lute) {
  // Use the same pinned parser as the editor: regexes can mistake invalid
  // fences or escaped/mismatched backticks for code and hide live HTML.
  const unsupported = '正文含 HTML、双链或扩展标记，已保留源码编辑，避免格式或内容丢失。';
  const text = [];
  try {
    const tree = JSON.parse(lute.RenderJSON(markdown));
    if (tree?.Type !== 'NodeDocument') throw new Error('Missing Markdown document');
    const nodes = [tree];
    while (nodes.length) {
      const node = nodes.pop();
      if (typeof node?.Type !== 'string' || (node.Children !== undefined && !Array.isArray(node.Children))) throw new Error('Invalid Markdown node');
      if (node.Type === 'NodeCodeBlock' || node.Type === 'NodeCodeSpan') continue;
      if (['NodeHTMLBlock', 'NodeInlineHTML', 'NodeYamlFrontMatter'].includes(node.Type)) return unsupported;
      if (typeof node.Data === 'string') text.push(node.Data);
      nodes.push(...(node.Children || []));
    }
  } catch {
    return '无法确认正文的 Markdown 结构，已保留源码编辑，避免不可信内容进入可视化页面。';
  }
  // Preserve unsupported syntax outside parser-recognized literal code.
  const outsideCode = text.join('\n');
  if (/!?\[\[[\s\S]*?\]\]|^\s*:::/m.test(outsideCode)) return unsupported;
  if (/(?<![\\$])\$(?!\$)[^\n$]+(?<!\\)\$(?!\$)/.test(outsideCode)) return '正文含行内公式，已保留源码编辑。本轮不加载额外公式渲染器，公式原文完整保留。';
  const roundTrip = lute.VditorDOM2Md(lute.Md2VditorDOM(markdown));
  if (lute.Md2HTML(markdown) !== lute.Md2HTML(roundTrip)) return '这段 Markdown 无法完整转换为可视化内容，已保留源码编辑。';
  return '';
}

export function controlledAssetUrl(value, origin) {
  if (typeof value !== 'string' || !value || /[\x00-\x20\x7f]/.test(value)) return '';
  try {
    const url = new URL(value, origin);
    return url.origin === origin && /^\/api(?:\/practice\/[^/]+)?\/notes\/[^/]+\/attachments$/.test(url.pathname)
      && url.searchParams.has('asset') && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

// Lute emits quoted/escaped image attributes. Rewrite only image destinations,
// before its HTML ever enters the live DOM; never rewrite URLs in ordinary text.
export function rewriteEditorImages(html, resolve) {
  const decode = value => value.replace(/&(?:amp|quot|lt|gt|#39|#x[0-9a-f]+|#\d+);/gi, entity => {
    const named = { '&amp;': '&', '&quot;': '"', '&lt;': '<', '&gt;': '>', '&#39;': "'" };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const code = entity[2].toLowerCase() === 'x' ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd';
  });
  return html.replace(/<img\b[^>]*>/gi, tag => tag.replace(/\ssrc="([^"]*)"/i, (_match, source) => {
    const value = resolve(decode(source));
    return ' src="' + String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '"';
  }));
}

export function guardEditorImages(lute, { assetResolver, origin }) {
  const displayed = new Map(), sources = new Map(), nonce = crypto.randomUUID(); let index = 0;
  const display = source => {
    if (displayed.has(source)) return source;
    if (sources.has(source)) return sources.get(source);
    const known = controlledAssetUrl(assetResolver?.(source), origin);
    const url = known || `data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7#zhixu-image-${nonce}-${++index}`;
    displayed.set(url, source); sources.set(source, url); return url;
  };
  for (const method of ['Md2VditorDOM', 'HTML2VditorDOM', 'SpinVditorDOM']) {
    const original = lute[method].bind(lute);
    lute[method] = value => rewriteEditorImages(original(value), display);
  }
  const toMarkdown = lute.VditorDOM2Md.bind(lute);
  lute.VditorDOM2Md = value => toMarkdown(rewriteEditorImages(value, url => displayed.get(url) || url));
  return html => rewriteEditorImages(html, display);
}

/**
 * The caller owns uploads and their commit/revert lifecycle.
 * assetResolver(markdownUrl) -> controlled same-origin displayUrl, or null.
 * uploadImage(File) -> { attachmentId, markdownUrl, onInserted? } after local staging.
 * onInserted({ before, after }) lets the caller undo only its unchanged insertion.
 * Only markdownUrl (stable ../.zhixu-attachments/<id>) enters the saved Markdown.
 */
export function createMarkdownEditor(textarea, { value = textarea.value, loadEditor = loadMarkdownEditor, assetResolver, uploadImage, onChange = () => {} } = {}) {
  const draft = createMarkdownDraft(value);
  textarea.value = draft.source;
  const host = el('div', { class: 'source-rich-editor', hidden: true });
  const status = el('p', { class: 'field-hint', role: 'status', ariaLive: 'polite', text: '源码和可视化编辑同一份 Markdown。切换模式不会保存或改写原文。' });
  let editor, mode = 'source', generation = 0, disposed = false, observer, themeObserver, initializing = false, editorDestroyed = false;
  const darkTheme = () => document.documentElement?.classList?.contains('dark') || document.documentElement?.dataset.theme === 'dark';
  let appliedTheme;
  const updateTheme = () => {
    const theme = darkTheme() ? 'dark' : 'classic';
    if (!editor || theme === appliedTheme) return;
    editor.setTheme?.(theme, theme === 'dark' ? 'dark' : 'light');
    appliedTheme = theme;
  };
  let guardPreviewImages = html => html;
  const destroyEditor = () => { if (editor?.vditor?.lute && !editorDestroyed) { editorDestroyed = true; editor.destroy(); } };
  const richValue = () => editor.getValue();
  const getValue = () => mode === 'rich' && editor && !initializing ? draft.readRich(richValue()) : draft.readSource(textarea.value);
  const sync = () => { const value = getValue(); textarea.value = value; return value; };
  const changed = () => { if (!disposed) { sync(); onChange(); } };
  const sourceButton = button('Markdown 源码', { onClick: () => switchMode('source') });
  const richButton = button('可视化编辑', { onClick: () => switchMode('rich') });
  const controls = el('div', { class: 'form-actions markdown-mode-switch', role: 'group', ariaLabel: '正文编辑模式' }, [sourceButton, richButton]);
  const root = el('div', { class: 'markdown-editor' }, [controls, textarea, host, status]);
  textarea.setAttribute('aria-label', 'Markdown 源码正文');
  const updateMode = () => {
    sourceButton.setAttribute('aria-pressed', String(mode === 'source'));
    richButton.setAttribute('aria-pressed', String(mode === 'rich'));
    textarea.hidden = mode === 'rich'; host.hidden = mode !== 'rich';
    textarea.required = mode !== 'rich';
  };
  textarea.addEventListener('input', changed);

  async function switchMode(next) {
    const request = ++generation;
    sync();
    if (next === 'source') {
      draft.setSource(getValue()); textarea.value = draft.source; mode = 'source'; updateMode();
      status.textContent = '正在编辑 Markdown 源码；切换模式不会保存，已有输入会保留在当前草稿。'; return;
    }
    if (mode === 'rich') return;
    richButton.disabled = true;
    status.textContent = '正在准备本地可视化编辑器…';
    try {
      const Vditor = await loadEditor();
      if (disposed || request !== generation) return;
      initializing = true;
      if (!editor) await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('可视化编辑器准备超时，可继续编辑源码。')), 15000);
        try {
          editor = new Vditor(host, {
            cdn: VENDOR, mode: 'wysiwyg', lang: 'zh_CN', value: '', height: 440,
            theme: darkTheme() ? 'dark' : 'classic',
            cache: { enable: false }, icon: '',
            hint: { emoji: {}, emojiPath: `${VENDOR}/dist/images/emoji`, parse: false },
            link: { isOpen: false }, image: { isPreview: false },
            toolbar: ['headings', 'bold', 'italic', 'strike', '|', 'list', 'ordered-list', 'check', '|', 'quote', 'code', 'inline-code', 'link', 'table', '|', 'undo', 'redo'],
            preview: { mode: 'editor', actions: [], hljs: { enable: false }, transform: html => guardPreviewImages(html),
              theme: { current: darkTheme() ? 'dark' : 'light', path: `${VENDOR}/dist/css/content-theme` },
              markdown: { sanitize: true, codeBlockPreview: false, mathBlockPreview: false, autoSpace: false, fixTermTypo: false } },
            // Always intercept file paste/drop below; never use Vditor's data-URL fallback.
            upload: { handler: () => '请使用本地附件入口。', linkToImgUrl: '' },
            // Upstream's image popover assigns src directly, outside Lute. Replace
            // it before users can reach those handlers; URLs remain source edits.
            customWysiwygToolbar: (type, popover) => {
              if (type !== 'image') return;
              popover.replaceChildren(
                el('p', { class: 'field-hint', text: '图片以本地占位或已绑定附件显示。请在 Markdown 源码中修改图片说明或引用；这里不会直接访问图片地址。' }),
                button('切换源码编辑图片引用', { onClick: async () => { await switchMode('source'); textarea.focus(); } }),
              );
            },
            input: () => { if (!initializing && mode === 'rich') changed(); },
            after: () => { clearTimeout(timer); queueMicrotask(resolve); },
          });
        } catch (error) { clearTimeout(timer); reject(error); }
      });
      if (disposed || request !== generation) return;
      updateTheme();
      // Exposed by the bundled Lute 1.7.6 API. Keep colon emoji and newly typed
      // inline formula text literal; do not start optional renderers/resources.
      editor.vditor.lute.SetEmoji(false);
      editor.vditor.lute.SetInlineMath(false);
      if (!editor.imagesGuarded) {
        guardPreviewImages = guardEditorImages(editor.vditor.lute, { assetResolver, origin: window.location?.origin || '' });
        editor.imagesGuarded = true;
      }
      const source = draft.readSource(textarea.value);
      const reason = richFallbackReason(source, editor.vditor.lute);
      if (reason) { status.textContent = reason; return; }
      draft.setSource(source);
      editor.setValue(source, true);
      editor.vditor.wysiwyg?.element.setAttribute('role', 'textbox');
      editor.vditor.wysiwyg?.element.setAttribute('aria-label', '可视化正文');
      editor.vditor.wysiwyg?.element.setAttribute('aria-multiline', 'true');
      draft.beginRich(richValue());
      mode = 'rich'; updateMode();
      status.textContent = '可直接编辑标题、段落、列表和表格；块公式与代码块以可编辑源码保留。远程图片和未绑定附件显示占位，引用完整保留。';
      editor.focus();
    } catch (error) { status.textContent = error.message || '可视化编辑器不可用，原文已保留，可继续编辑源码。'; }
    finally { initializing = false; richButton.disabled = false; if (disposed) destroyEditor(); }
  }

  // Vditor's sanitizer protects its Markdown and HTML conversion paths. The
  // capture handler also ensures paste never inserts raw clipboard HTML directly.
  const insertMarkdown = markdown => {
    const reason = richFallbackReason(markdown, editor.vditor.lute);
    if (reason) {
      const before = getValue();
      generation++; mode = 'source'; draft.setSource(before + '\n' + markdown);
      textarea.value = draft.source; updateMode();
      status.textContent = reason + ' 粘贴内容已追加到源码末尾，可继续调整位置。';
      onChange(); return;
    }
    editor.insertValue(markdown, true); changed();
  };
  host.addEventListener('paste', event => {
    if (mode !== 'rich' || !editor) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const files = [...(event.clipboardData?.files || [])];
    if (files.length) { void insertImages(files); return; }
    const html = event.clipboardData?.getData('text/html') || '';
    const text = event.clipboardData?.getData('text/plain') || '';
    const markdown = html ? editor.vditor.lute.HTML2Md(window.Lute.Sanitize(html)) : text;
    insertMarkdown(markdown);
  }, true);
  host.addEventListener('drop', event => {
    event.preventDefault(); event.stopImmediatePropagation();
    const files = [...(event.dataTransfer?.files || [])];
    if (files.length) void insertImages(files);
    else if (mode === 'rich' && editor) insertMarkdown(event.dataTransfer?.getData('text/plain') || '');
  }, true);
  host.addEventListener('input', () => queueMicrotask(changed));
  host.addEventListener('click', event => { if (event.target.closest?.('a')) event.preventDefault(); });

  async function insertImages(files) {
    if (!uploadImage) { status.textContent = '本地图片上传尚未接入，请使用资料附件入口；没有将图片存成临时地址。'; return; }
    const request = generation;
    try {
      for (const file of files) {
        if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error('正文仅支持 PNG、JPEG、GIF、WebP 图片。');
        const asset = await uploadImage(file);
        if (disposed || request !== generation) return;
        if (!asset?.attachmentId || asset.markdownUrl !== `../.zhixu-attachments/${asset.attachmentId}` || !/^[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(asset.attachmentId)) throw new Error('附件未返回稳定图片引用，未插入正文。');
        const name = file.name.replace(/[\[\]\\\r\n]/g, '');
        const before = getValue();
        editor.insertValue(`![${name}](${asset.markdownUrl})\n`, true); changed();
        asset.onInserted?.({ before, after: getValue() });
      }
    } catch (error) { status.textContent = error.message; }
  }

  root.sync = sync;
  root.getValue = getValue;
  // Programmatic replacements (form reset, tutorial samples, import previews)
  // must invalidate pending loads and replace the same draft as keyboard edits.
  root.setValue = value => {
    generation++;
    draft.setSource(String(value ?? '')); textarea.value = draft.source;
    mode = 'source'; updateMode();
    status.textContent = '正在编辑 Markdown 源码；切换模式不会保存，已有输入会保留在当前草稿。';
  };
  textarea.markdownEditor = root;
  root.switchMode = switchMode;
  root.getMode = () => mode;
  root.mount = container => {
    if (typeof MutationObserver === 'undefined' || !(container || root.parentNode)) return;
    observer = new MutationObserver(() => { if (!root.isConnected) root.destroy(); });
    observer.observe(container || root.parentNode, { childList: true });
    themeObserver = new MutationObserver(updateTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
  };
  root.destroy = () => { disposed = true; generation++; observer?.disconnect(); themeObserver?.disconnect(); destroyEditor(); };
  updateMode();
  return root;
}
