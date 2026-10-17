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
  const run = async action => {
    try { await action(); if (current()) { await refresh(); await renderRecycleBin({ main, refresh, onError, isActive }); } }
    catch (error) { onError(error); }
  };
  let clearing = false, verified = true;
  const restoreControls = [];
  const status = el('p', { class: 'notice', role: 'status', text: notice, hidden: !notice });
  const retry = button('重新核对回收站', { onClick: () => reconcile() });
  retry.hidden = true;
  async function reconcile(message = '') {
    if (!current()) return;
    verified = false;
    for (const control of restoreControls) control.disabled = true;
    clear.disabled = true;
    retry.disabled = true;
    try {
      const snapshot = await api.recycleBin();
      if (!current()) return;
      await renderRecycleBin({ main, refresh, onError, isActive, snapshot, notice: message });
    } catch (error) {
      if (!current()) return;
      status.textContent = '回收站状态暂未核对，当前列表可能已过时。请重新核对后再操作；不会自动重发清空请求。';
      status.hidden = false;
      retry.hidden = false;
      onError(new Error(`重新核对回收站失败：${error.message}`));
    } finally {
      if (current()) retry.disabled = false;
    }
  }
  const clear = button('一键清空回收站', { kind: 'danger', disabled: !items.length && !result.pendingCleanup, onClick: async () => {
    if (!current() || clearing || !verified) return;
    const ok = await confirmAction({ title: '永久清空当前资料库的回收站？',
      message: `将永久删除当前资料库回收站中的 ${items.length} 份原始资料（以及上次未完成清理的文件）、其版本和未被其他内容引用的附件，无法从回收站恢复。已生成的知识、学习记录、共享附件和独立备份会保留。`,
      confirmText: '确认永久清空', danger: true });
    if (!ok || !current() || clearing) return;
    clearing = true;
    clear.disabled = true;
    let message = '';
    try {
      const value = await api.clearRecycleBin(result.revision);
      if (current()) toast(value.cleared ? `已永久清空 ${value.cleared} 份原始资料` : '已完成回收站文件清理', 'success');
    } catch (error) {
      if (!current()) return;
      message = '清空未完整完成或结果暂未确认，已重新核对当前列表。若需继续清理，请再次点击清空并确认。';
      onError(new Error(`清空回收站失败，正在重新核对结果（不会自动重试清空）：${error.message}`));
    } finally {
      if (current()) await reconcile(message);
      clearing = false;
    }
  } });
  const body = el('div', { class: 'page-stack' }, [
    el('div', { class: 'notice', text: '这里只显示当前资料库中已移除的原始资料。恢复保留原文、附件和原有资料身份；其他内容的版本历史不属于回收站。' }), clear, status, retry,
  ]);
  if (result.pendingCleanup) body.append(el('p', { class: 'notice', text: '上次永久清空已移除资料，但部分文件尚未清理完成。可再次点击清空以重试；已变化的文件会保留并报告冲突。' }));
  if (!items.length) body.append(emptyState('回收站为空', '移入回收站的原始资料会显示在这里。'));
  for (const item of items) {
    const restore = button('恢复', { onClick: () => run(async () => {
      if (!current() || !verified) return;
      restore.disabled = true;
      try { await api.restoreRecycled(item.id, item.versionId); toast('原始资料已恢复', 'success'); }
      finally { restore.disabled = false; }
    }) });
    restoreControls.push(restore);
    body.append(el('section', { class: 'list-item no-icon' }, [
      el('div', { class: 'item-copy' }, [el('h3', { text: item.title }), el('p', { text: `移入时间：${formatDate(item.deletedAt)} · ${item.attachmentCount} 个附件` })]), restore,
    ]));
  }
  main.replaceChildren(body);
}
