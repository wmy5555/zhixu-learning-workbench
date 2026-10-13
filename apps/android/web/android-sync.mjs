import { el, clear, button, confirmAction, toast } from './ui.mjs';

export async function createAndroidSyncPanel({ api, onChanged, onError, isCurrent = () => true }) {
  const context = api.getContext();
  let preview = null, busy = false, listActionCount = 0;
  const actions = [];
  const status = el('p', { class: 'fine-print', role: 'status', ariaLive: 'polite' });
  const list = el('div', { class: 'page-stack' }), detail = el('div', { class: 'page-stack' });
  const reviewed = el('input', { type: 'checkbox', name: 'syncReviewed', disabled: true });
  const apply = button('应用到这一份手机原文', { kind: 'primary', disabled: true, onClick: applySource });
  const refresh = button('刷新同步预览列表', { onClick: reload });
  const panel = el('section', { class: 'panel page-stack' }, [
    el('h2', { text: '原文同步预览' }),
    el('p', { text: '电脑连接尚未接入。未来通过同一 Wi-Fi 配对；目前只核对这台手机的原文和同步记录。' }),
    button('同一 Wi-Fi 配对（尚未开放）', { disabled: true }), refresh, list, detail,
    el('label', { class: 'check-field' }, [reviewed, '我已核对手机原文、同步正文和来源，确认应用这一版']), apply, status,
  ]);
  const active = () => !context.practiceId && !api.getContext().practiceId && api.getContext().version === context.version && isCurrent();
  const usable = () => preview?.context === 'formal' && preview.canApply === true && typeof preview.token === 'string' && preview.token.length > 0;
  function sync() {
    if (!active()) forget();
    const disabled = busy || !active();
    refresh.disabled = disabled;
    for (const action of actions) action.disabled = disabled || action.syncUnavailable;
    reviewed.disabled = disabled || !usable();
    if (!usable()) reviewed.checked = false;
    apply.disabled = disabled || !usable() || !reviewed.checked;
  }
  function forget() { preview = null; reviewed.checked = false; reviewed.disabled = true; apply.disabled = true; }
  function report(error) { if (active()) onError(error); }
  reviewed.addEventListener('change', sync);
  function action(label, handler, unavailable = false) {
    const node = button(label, { disabled: unavailable, onClick: handler }); node.syncUnavailable = unavailable; actions.push(node); return node;
  }
  function textVersion(title, value) {
    const source = value.source || value.meta || {};
    return el('article', { class: 'panel soft page-stack' }, [el('h3', { text: title }), el('strong', { text: value.title || '未命名原文' }),
      el('pre', { class: 'mono-block', style: 'max-height: 20rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere;', text: value.body || '' }),
      el('dl', { class: 'key-values' }, [['platform', '平台'], ['author', '作者'], ['url', '来源网址'], ['date', '资料日期'], ['locator', '原文定位'], ['topic', '主题']].map(([key, label]) =>
        el('div', { class: 'key-value' }, [el('dt', { text: label }), el('dd', { text: source[key] || '未记录' })]))),
    ]);
  }
  function showPreview(result) {
    preview = result; reviewed.checked = false; clear(detail); actions.splice(listActionCount);
    detail.append(result.original ? textVersion('手机当前原文', result.original) : el('p', { text: '手机还没有这一份原文。' }));
    if (result.original) detail.append(action('把这版手机原文记入同步记录', () => recordLocal(result)));
    for (const [index, event] of (result.versions || []).entries()) {
      if (event.operation === 'delete') {
        detail.append(el('article', { class: 'panel soft' }, [el('h3', { text: `保留的删除记录 ${index + 1}` }),
          el('p', { text: '本批不会通过同步删除手机原文。' }), action('选择删除版本（未开放）', () => {}, true)]));
      } else {
        const version = textVersion(`同步版本 ${index + 1}`, event.value);
        if ((result.heads || []).length > 1) version.append(action('选择这版作为同步版本', () => resolveVersion(result, event)));
        detail.append(version);
      }
    }
    if (!result.versions?.length) detail.append(el('p', { text: '尚无同步版本，可先记录手机当前原文。' }));
    status.textContent = result.reason || '预览有效期为 5 分钟；原文或同步记录变化后须重新核对。'; sync();
  }
  async function selectSource(sourceId) {
    if (busy || !active()) { sync(); return; }
    forget(); clear(detail); busy = true; sync();
    try {
      const result = await api.previewAndroidSyncSource(sourceId); if (!active()) return;
      if (result.context !== 'formal' || result.sourceId !== sourceId) throw new Error('预览不属于当前原文。');
      showPreview(result);
    }
    catch (error) { forget(); status.textContent = '预览未完成，请重新预览后核对；手机原文未改变。'; report(error); }
    finally { busy = false; sync(); }
  }
  async function loadList() {
    const data = await api.androidSync(); if (!active()) return;
    if (data.context !== 'formal') throw new Error('同步列表不属于正式库。');
    clear(list); actions.length = 0;
    for (const item of data.sources || []) {
      list.append(el('article', { class: 'panel soft' }, [el('h3', { text: item.title || '原文' }),
        el('p', { text: item.status === 'conflict' ? '有多个同步版本，需核对' : item.local ? '手机原文可核对' : '同步记录可核对' }),
        action('预览原文与同步版本', () => selectSource(item.sourceId))]));
    }
    if (!data.sources?.length) list.append(el('p', { text: '还没有可预览的原文或同步记录。' }));
    listActionCount = actions.length;
  }
  async function reload() {
    if (busy || !active()) { sync(); return; }
    forget(); clear(detail); busy = true; sync();
    try { await loadList(); }
    catch (error) { status.textContent = '列表未刷新，请稍后刷新查看。'; report(error); }
    finally { busy = false; sync(); }
  }
  async function updateJournal(selected, options) {
    if (busy || !active() || preview !== selected) { sync(); return; }
    busy = true; sync();
    try {
      if (!await confirmAction(options.confirm)) return;
      if (!active() || preview !== selected) return;
      forget(); await options.run();
      if (!active()) return;
      status.textContent = '同步记录已保存，手机原文未改变。请重新预览后核对是否应用。';
      try { await onChanged(); if (active()) await loadList(); }
      catch { if (active()) status.textContent += ' 页面未刷新，请稍后查看，无需重复保存。'; }
      clear(detail);
    } catch (error) { forget(); status.textContent = '同步记录保存结果未确认，请刷新并重新核对；不要重复提交旧预览。'; report(error); }
    finally { busy = false; sync(); }
  }
  function recordLocal(selected) {
    return updateJournal(selected, { confirm: { title: '记录手机当前原文？', message: '只把这版手机原文记入本机同步记录，保留旧版本和冲突历史；不会改写原文，也不会连接电脑。', confirmText: '记录这版原文' },
      run: () => api.stageAndroidSyncSource({ sourceId: selected.sourceId, expectedHash: selected.original.hash, expectedHeads: selected.heads }) });
  }
  function resolveVersion(selected, event) {
    return updateJournal(selected, { confirm: { title: '选择这一版同步记录？', message: '只在本机同步记录中保存你的选择，保留所有旧版本。手机原文不会改变，之后仍须重新核对并应用。', confirmText: '选择这版同步记录' },
      run: () => api.resolveAndroidSyncSource({ sourceId: selected.sourceId, eventId: event.id, expectedHeads: selected.heads }) });
  }
  async function applySource() {
    if (busy || !active() || !usable() || !reviewed.checked) { sync(); return; }
    const selected = preview; busy = true; sync();
    try {
      if (!await confirmAction({ title: '应用到这份手机原文？', message: '将这一版正文和六项来源写入这一份手机原文，已有原文的旧版本会保留。不会删除其他资料，不会发送资料或修改同步游标。', confirmText: '确认应用这一版' })) return;
      if (!active() || preview !== selected) return;
      forget(); // Consume UI permission before the native call, including a failed or lost response.
      await api.applyAndroidSyncSource(selected.token);
      if (!active()) return;
      clear(detail); status.textContent = '这一份手机原文已应用。'; toast('手机原文已应用', 'success');
      try { await onChanged(); if (active()) await loadList(); }
      catch { if (active()) status.textContent += ' 页面未刷新，请稍后刷新查看，无需再次应用。'; }
    } catch (error) { forget(); status.textContent = '应用结果未确认，请重新预览核对已保存的原文；不要重复应用旧令牌。'; report(error); }
    finally { busy = false; sync(); }
  }
  if (!active()) { sync(); return panel; }
  busy = true; sync();
  try { await loadList(); } catch (error) { status.textContent = '同步列表暂不可读，请稍后刷新。'; report(error); }
  finally { busy = false; sync(); }
  return panel;
}
