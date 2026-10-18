import { api } from './api.mjs';
import { el, button, emptyState, formatDate, confirmAction, toast } from './ui.mjs';

let renderSequence = 0;
export async function renderRecycleBin({ main, refresh, onError, isActive = () => true, snapshot, notice = '' }) {
  const sequence = ++renderSequence;
  const context = api.getContext();
  const current = () => sequence === renderSequence && isActive() && api.getContext().version === context.version && api.getContext().practiceId === context.practiceId;
  const result = snapshot || await api.recycleBin();
  if (!current()) return;
  const items = result.items;
  let busy = false, verified = true;
  const controls = [];
  const status = el('p', { class: 'notice', role: 'status', text: notice, hidden: !notice });
  const retry = button('刷新列表', { onClick: () => { if (!busy) return reconcile(); } });
  retry.hidden = true;
  const updateControls = () => {
    for (const { control, unavailable } of controls) control.disabled = busy || !verified || unavailable;
  };
  async function reconcile(message = '') {
    if (!current()) return;
    verified = false;
    updateControls();
    retry.disabled = true;
    try {
      const snapshot = await api.recycleBin();
      if (!current()) return;
      await renderRecycleBin({ main, refresh, onError, isActive, snapshot, notice: message });
    } catch (error) {
      if (!current()) return;
      status.textContent = '当前列表可能不是最新。请点击“刷新列表”；刷新成功后可继续恢复或清空。刷新只会更新列表，不会再次永久删除资料。';
      status.hidden = false;
      retry.hidden = false;
      onError(new Error(`刷新列表失败：${error.message}`));
    } finally {
      if (current()) retry.disabled = false;
    }
  }
  async function permanentlyDelete(item = null) {
    if (!current() || busy || !verified) return;
    busy = true;
    updateControls();
    let requested = false;
    try {
      const ok = await confirmAction({ title: item ? '永久删除这份原始资料？' : '永久清空当前资料库的回收站？',
        message: item
          ? `将永久删除当前资料库中的「${item.title}」（资料 ID：${item.id}）、其全部版本、恢复副本和未被其他内容引用的附件，无法从回收站恢复。只处理这一份资料，其他回收站资料、已生成的知识、学习记录、共享附件和独立备份会保留。`
          : `将永久删除当前资料库回收站中的 ${items.length} 份原始资料（以及上次未完成清理的文件）、其版本和未被其他内容引用的附件，无法从回收站恢复。已生成的知识、学习记录、共享附件和独立备份会保留。`,
        confirmText: item ? '确认永久删除' : '确认永久清空', danger: true });
      if (!ok || !current()) return;
      requested = true;
      const value = item ? await api.purgeRecycled(item.id, item.versionId, result.revision) : await api.clearRecycleBin(result.revision);
      if (current()) toast(item ? '已永久删除这份原始资料' : value.cleared ? `已永久清空 ${value.cleared} 份原始资料` : '已完成回收站文件清理', 'success');
    } catch (error) {
      if (!current()) return;
      onError(new Error(`${item ? '永久删除资料' : '清空回收站'}失败，正在刷新列表（不会自动再次永久删除资料）：${error.message}`));
      if (requested) notice = '操作未全部完成，或暂时无法确认结果。请核对刷新后的列表；再次永久删除需要重新确认。';
    } finally {
      if (current()) {
        if (requested) await reconcile(notice);
        busy = false;
        updateControls();
      }
    }
  }
  const clear = button('一键清空回收站', { kind: 'danger', onClick: () => {
    if (items.length || result.pendingCleanup) return permanentlyDelete();
  } });
  controls.push({ control: clear, unavailable: !items.length && !result.pendingCleanup });
  const body = el('div', { class: 'page-stack recycle-bin' }, [
    el('div', { class: 'actions' }, [clear, el('a', { href: '/guide.html#recycle-bin', target: '_blank', rel: 'noopener', text: '回收站帮助' })]), status, retry,
  ]);
  if (result.pendingCleanup) body.append(el('p', { class: 'notice', text: '部分文件尚未清理完成。核对回收站帮助后，可重新确认清空以重试。' }));
  if (!items.length) body.append(emptyState('回收站为空', '移入回收站的原始资料会显示在这里。'));
  for (const item of items) {
    const restore = button('恢复', { onClick: async () => {
      if (!current() || busy || !verified) return;
      busy = true;
      updateControls();
      try {
        await api.restoreRecycled(item.id, item.versionId);
        if (!current()) return;
        toast('原始资料已恢复', 'success');
        await refresh();
        if (current()) await reconcile();
      } catch (error) { if (current()) { onError(error); await reconcile(); } }
      finally { if (current()) { busy = false; updateControls(); } }
    } });
    const purge = button('永久删除', { kind: 'danger', onClick: () => permanentlyDelete(item) });
    controls.push({ control: restore, unavailable: false }, { control: purge, unavailable: false });
    body.append(el('section', { class: 'list-item no-icon' }, [
      el('div', { class: 'item-copy' }, [el('h3', { text: item.title }), el('p', { text: `移入时间：${formatDate(item.deletedAt)} · ${item.attachmentCount} 个附件` })]),
      el('div', { class: 'actions' }, [restore, purge]),
    ]));
  }
  updateControls();
  main.replaceChildren(body);
}
