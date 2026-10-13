import { el, clear, button, field, emptyState, confirmAction, toast, truncate, formatDate } from './ui.mjs';
import { initSidebar } from './sidebar.mjs';
import { parseSourceFile } from './source-exchange.mjs';

export async function mountIOSPreview(client, { browserPreview = false } = {}) {
  const main = document.querySelector('#main');
  const drawer = document.querySelector('#drawer');
  const drawerBody = document.querySelector('#drawer-body');
  const backdrop = document.querySelector('#drawer-backdrop');
  const sidebar = initSidebar({ document, media: matchMedia('(max-width: 780px)'), storage: localStorage });
  let notes = [], currentPage = 'library', busy = false, form = null, original = '', selectedNote = null, indexPending = false;
  const supported = ['capture', 'library', 'system'];
  const values = target => Object.fromEntries(new FormData(target).entries());
  const dirty = () => form && JSON.stringify(values(form)) !== original;
  const report = error => { if (error?.code !== 'CANCELLED') toast(error.message || '操作未完成，请保留输入。', 'error'); };
  function closeDrawer() { drawer.classList.remove('is-open'); drawer.setAttribute('aria-hidden', 'true'); backdrop.hidden = true; selectedNote = null; }
  async function leave() {
    if (busy) { toast('请等当前操作完成后再切换。', 'info'); return false; }
    if (dirty() && !await confirmAction({ title: '放弃未保存的修改？', message: '取消可继续填写，确认后本次输入不会保存。', confirmText: '放弃修改', danger: true })) return false;
    form = null; original = ''; closeDrawer(); return true;
  }
  async function run(control, operation, released = null) {
    if (busy) return;
    busy = true; if (control) control.disabled = true;
    try { await operation(); } catch (error) { report(error); }
    finally { busy = false; if (released) released(); else if (control?.isConnected) control.disabled = false; }
  }
  function notice() {
    return el('div', { class: 'notice info ios-limitations' }, [
      el('strong', { text: browserPreview ? 'Windows 浏览器阶段预览 · 合成数据与模拟平台接口' : '知序 iOS 开发预览 · 本地原文阶段' }),
      el('p', { text: '可收集、查看、搜索、编辑原文，查看与恢复历史，导出和预览原文备份。完整学习、新手流程、AI、结构分析与自动同步仍待迁移，相关入口已禁用。' }),
      browserPreview ? el('p', { text: '这不是 iOS 或 WKWebView。文件选择、导出与恢复接口使用明确标识的内存模拟；刷新会清除合成编辑。键盘、字体、权限、系统分享、文件提供方和进程恢复尚未在 iOS 验证。' }) : null,
    ]);
  }
  async function refresh() { const result = await client.list(); notes = result.notes; indexPending = result.indexPending === true; }
  function header(page) {
    currentPage = page; window.history.replaceState(null, '', `#${page}`);
    document.querySelector('#page-eyebrow').textContent = { capture: '收集与加工', library: '知识库', system: '系统' }[page];
    document.querySelector('#page-title').textContent = { capture: '保留原文与出处', library: '查看本机原始资料', system: '原文备份与功能进度' }[page];
    for (const control of document.querySelectorAll('#nav-list [data-view]')) control.classList.toggle('is-active', control.dataset.view === page);
    sidebar.closeMobile(); clear(main).append(notice());
  }
  async function navigate(page) { if (!supported.includes(page) || !await leave()) return; render(page); }
  function render(page) { header(page); if (page === 'capture') capture(); else if (page === 'system') system(); else library(); }
  function sourceForm(note = null) {
    const target = el('form', { class: 'panel page-stack' });
    const input = (name, value = '', multiline = false) => el(multiline ? 'textarea' : 'input', { name, value, rows: multiline ? 12 : undefined, required: name === 'body', placeholder: name === 'title' ? '可留空，用原文片段暂时命名' : '' });
    target.append(field('标题（可选）', input('title', note?.title || '')), field('原文', input('body', note?.body || '', true)));
    const source = el('div', { class: 'form-grid' });
    for (const [key, label] of [['platform', '平台'], ['author', '作者'], ['url', '原始地址'], ['date', '资料日期（可输入 2024年春）'], ['locator', '原文定位'], ['topic', '主题']]) source.append(field(label, input(key, note?.meta?.[key] || '')));
    target.append(source, el('p', { class: 'fine-print', text: '仅本地保存；原文 128 KiB、标题 200 个 UTF-16 单元。本阶段不生成 AI 标题、不发送资料。' }));
    const process = el('input', { type: 'checkbox', disabled: true, checked: false });
    const research = el('input', { type: 'checkbox', disabled: true, checked: false });
    target.append(el('label', { class: 'check-field' }, [process, 'AI 拆解（尚未迁移）']), el('label', { class: 'check-field' }, [research, '拆解时联网检验（尚未迁移）']));
    const save = button(note ? '保存修改' : '保存原始资料', { kind: 'primary', type: 'submit' });
    const reset = button(note ? '继续查看' : '清空', { onClick: async () => { if (!await leave()) return; if (note) await openNote(note.id); else render('capture'); } });
    target.append(el('div', { class: 'form-actions' }, [save, reset]));
    target.addEventListener('submit', event => {
      event.preventDefault();
      run(save, async () => {
        const data = values(target), meta = Object.fromEntries(['platform', 'author', 'url', 'date', 'locator', 'topic'].map(key => [key, data[key] || '']));
        const result = await client.save({ title: data.title, body: data.body, meta, ...(note ? { id: note.id, expectedHash: note.hash } : {}) });
        form = null; original = ''; await refresh();
        toast(browserPreview ? '合成内存资料已保存；未执行 iOS 文件写入' : '原文已保存，版本已确认', 'success');
        if (note) { clear(drawerBody); showNote(result.note); if (currentPage === 'library') render('library'); }
        else render('capture');
      });
    });
    form = target; original = JSON.stringify(values(target)); return target;
  }
  function capture() {
    const target = sourceForm();
    const select = button(browserPreview ? '模拟选择合成 txt 文件' : '从 txt/md 文件填入草稿', { onClick: async () => {
      if (busy) return;
      if (dirty() && !await confirmAction({ title: '替换当前草稿？', message: '取消保留当前输入；文件只填入表单，还需核对并保存。', confirmText: '选择文件' })) return;
      await run(select, async () => {
        const item = parseSourceFile(await client.pickSource());
        for (const [key, value] of Object.entries(item)) if (target.elements.namedItem(key)) target.elements.namedItem(key).value = value;
        toast('已填入草稿，请核对原文与出处后保存。', 'info');
      });
    } });
    target.prepend(select); main.append(target);
  }
  function library() {
    const search = el('input', { type: 'search', placeholder: '搜索标题、正文或来源', ariaLabel: '搜索本机原文' });
    const list = el('div', { class: 'list' });
    const result = el('p', { role: 'status', class: 'fine-print' });
    function draw() {
      const q = search.value.toLocaleLowerCase();
      const filtered = notes.filter(note => [note.title, note.body, ...Object.values(note.meta || {})].join('\n').toLocaleLowerCase().includes(q));
      result.textContent = `当前 ${notes.length} 份原文；找到 ${filtered.length} 份。这里只进行原文文字过滤，完整检索模块待迁移。`;
      clear(list);
      if (!filtered.length) { list.append(emptyState('没有匹配的原文', '保存一份原始资料后再搜索。')); return; }
      for (const note of filtered) list.append(el('article', { class: 'list-item' }, [el('div', { class: 'item-copy' }, [el('h3', { text: note.title }), el('p', { text: truncate(note.body, 150) }), el('p', { class: 'fine-print', text: `${note.meta?.platform || '未记录平台'} · ${formatDate(note.updatedAt, true)}` })]), button('查看', { onClick: () => openNote(note.id).catch(report) })]));
    }
    search.addEventListener('input', draw); draw(); main.append(el('section', { class: 'panel page-stack' }, [search, result, list]));
  }
  async function openNote(id) {
    if (busy || !await leave()) return;
    await run(null, async () => { const { note } = await client.read(id); showNote(note); });
  }
  function showNote(note) {
    selectedNote = note; document.querySelector('#drawer-title').textContent = note.title; document.querySelector('#drawer-eyebrow').textContent = '原始资料 · 仅本地';
    drawer.classList.add('is-open'); drawer.setAttribute('aria-hidden', 'false'); backdrop.hidden = false;
    const edit = button('编辑', { kind: 'primary', onClick: () => { if (!busy) clear(drawerBody).append(sourceForm(note)); } });
    const exportButton = button(browserPreview ? '模拟导出原文' : '导出原文', { onClick: () => run(exportButton, async () => { await client.exportSource(note.id); toast(browserPreview ? '已模拟导出；未执行系统文件保存' : '系统文件窗口已完成导出', 'success'); }) });
    const versions = button('查看版本', { onClick: () => run(versions, async () => {
      const { versions: history } = await client.history(note.id);
      clear(drawerBody).append(button('返回当前原文', { onClick: () => showNote(note) }));
      if (!history.length) drawerBody.append(emptyState('尚无编辑历史', '首次保存的原文不会被摘要替换。'));
      for (const version of history) {
        const restore = button('恢复此版本', { onClick: () => run(restore, async () => {
          if (!await confirmAction({ title: '恢复这份历史？', message: '恢复前的当前原文仍会留作历史。若期间已修改，则停止恢复。', confirmText: '确认恢复' })) return;
          const { note: restored } = await client.restoreVersion({ id: note.id, versionId: version.hash, expectedHash: note.hash });
          await refresh(); showNote(restored); if (currentPage === 'library') render('library');
        }) });
        drawerBody.append(el('section', { class: 'panel page-stack' }, [el('h3', { text: version.title }), el('p', { text: Object.entries(version.meta || {}).filter(([key]) => ['platform', 'author', 'url', 'date', 'locator', 'topic'].includes(key)).map(([key, value]) => `${key}: ${value || '空值'}`).join(' · ') }), el('div', { class: 'prose ios-source-body', text: version.body }), restore]));
      }
    }) });
    clear(drawerBody).append(el('div', { class: 'page-stack' }, [el('div', { class: 'form-actions' }, [edit, versions, exportButton]), el('div', { class: 'prose ios-source-body', text: note.body }), el('dl', { class: 'key-values' }, ['platform', 'author', 'url', 'date', 'locator', 'topic'].map(key => el('div', { class: 'key-value' }, [el('dt', { text: key }), el('dd', { text: note.meta?.[key] || '未记录' })]))), el('p', { class: 'fine-print', text: `稳定 ID：${note.id}；版本：${note.hash}` })]));
  }
  function system() {
    let preview = null;
    const details = el('div', { class: 'page-stack' });
    const acknowledgement = el('input', { type: 'checkbox', disabled: true });
    const apply = button('确认恢复，保留冲突', { kind: 'primary', disabled: true, onClick: () => run(apply, async () => {
      if (!preview || !acknowledgement.checked) return;
      if (!await confirmAction({ title: '恢复预览中的原文？', message: '保留冲突原文，不清空当前库；这份备份不包含学习或凭据。', confirmText: '确认恢复' })) return;
      let result;
      try { result = await client.restoreBackup(preview.token); }
      catch (error) {
        if (error?.code === 'PREVIEW_EXPIRED') { preview = null; acknowledgement.checked = false; acknowledgement.disabled = true; }
        throw error;
      }
      preview = null; acknowledgement.checked = false; acknowledgement.disabled = true; apply.disabled = true;
      await refresh(); details.replaceChildren(el('p', { text: `新增 ${result.imported}，相同 ${result.same}，保留冲突 ${result.conflicts}。${browserPreview ? '这是内存模拟结果。' : ''}` }));
    }, () => { apply.disabled = !preview || !acknowledgement.checked; }) });
    acknowledgement.addEventListener('change', () => { apply.disabled = !preview || !acknowledgement.checked; });
    const select = button(browserPreview ? '模拟预览合成备份' : '选择 iOS 原文备份并预览', { onClick: () => run(select, async () => {
      preview = null; acknowledgement.checked = false; acknowledgement.disabled = true; apply.disabled = true; clear(details);
      preview = await client.previewBackup(); acknowledgement.disabled = false;
      details.append(el('p', { text: `新增 ${preview.newCount}，相同 ${preview.sameCount}，冲突 ${preview.conflicts.length}；预览 5 分钟有效，资料变化需重做。` }));
      if (preview.conflicts.length) details.append(el('ul', {}, preview.conflicts.map(value => el('li', { text: value.title }))));
    }) });
    const exportButton = button(browserPreview ? '模拟导出合成备份' : '导出 iOS 原文备份', { onClick: () => run(exportButton, async () => { await client.exportBackup(); toast(browserPreview ? '已模拟导出；未执行 iOS 或云端文件写入' : '系统文件窗口已完成导出', 'success'); }) });
    main.append(el('section', { class: 'panel page-stack' }, [el('h2', { text: '原文备份与恢复' }), el('p', { text: '仅包含本阶段原文、出处、最初快照与编辑历史。不包含学习、AI 设置、密钥或电脑资料；与桌面/Android 完整备份不是同一格式。' }), exportButton, select, details, el('label', { class: 'check-field' }, [acknowledgement, '我已审阅预览，确认新增并保留冲突']), apply]));
    const rebuild = button(browserPreview ? '模拟重建原文索引' : '重建原文索引', { onClick: () => run(rebuild, async () => { const result = await client.rebuildIndex(); await refresh(); toast(browserPreview ? `模拟索引覆盖 ${result.rebuilt} 份；未执行 SQLite` : `已从原文重建 ${result.rebuilt} 份派生索引`, 'success'); }) });
    main.append(el('section', { class: 'panel page-stack' }, [el('h2', { text: '原文与派生索引' }), el('p', { text: indexPending ? '派生索引需要修复。原文仍从已核对的 Markdown 读取，请重建索引。' : 'Markdown 保存原文，SQLite 只保存可重建索引；重建不会清空正文或历史。' }), rebuild]));
    main.append(el('section', { class: 'panel page-stack' }, [el('h2', { text: '待迁移功能' }), el('p', { text: '完整清单见项目 docs/IOS.md。原文和 AI 提取、用户回答、建议和最终确认继续分开；本阶段不会返回虚构学习记录、费用或供应商成功。' })]));
  }
  for (const control of document.querySelectorAll('#nav-list [data-view]')) {
    control.disabled = !supported.includes(control.dataset.view);
    if (control.disabled) control.title = '此 iOS 阶段尚未迁移，详见系统功能进度';
    control.addEventListener('click', () => navigate(control.dataset.view).catch(report));
  }
  for (const id of ['onboarding-launcher', 'onboarding-reset']) { const control = document.querySelector(`#${id}`); if (control) { control.disabled = true; control.title = '完整新手流程尚未迁移'; } }
  document.querySelector('#quick-capture').addEventListener('click', () => navigate('capture').catch(report));
  document.querySelector('#global-refresh').addEventListener('click', async event => { if (!await leave()) return; await run(event.currentTarget, async () => { await refresh(); render(currentPage); }); });
  for (const control of [document.querySelector('#drawer-close'), backdrop]) control.addEventListener('click', () => leave().catch(report));
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && drawer.classList.contains('is-open')) leave().catch(report); });
  window.addEventListener('beforeunload', event => { if (dirty()) { event.preventDefault(); event.returnValue = 'unsaved'; } });
  await refresh(); render(supported.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'library');
}
