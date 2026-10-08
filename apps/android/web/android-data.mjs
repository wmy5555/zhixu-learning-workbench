import { el, clear, button, confirmAction, toast } from './ui.mjs';

export function createAndroidDataPanel({ api, onRestored, onError }) {
  let preview = null, busy = false;
  const status = el('p', { class: 'fine-print', role: 'status', ariaLive: 'polite' });
  const detail = el('div', { class: 'page-stack' });
  const acknowledged = el('input', { type: 'checkbox', disabled: true, name: 'restoreReviewed' });
  const restore = button('确认恢复，保留冲突资料', { kind: 'primary', disabled: true, onClick: apply });
  const exportButton = button('导出手机备份', { onClick: exportBackup });
  const select = button('选择备份并预览', { kind: 'primary', onClick: choose });
  acknowledged.addEventListener('change', sync);
  const panel = el('div', { class: 'page-stack' }, [
    el('section', { class: 'panel' }, [
      el('h2', { text: '手机原文备份' }),
      el('p', { text: '包含原文、来源、最初快照和编辑历史。请选择你信任的保存位置，完成后可将文件复制到其他设备保管。' }),
      el('p', { class: 'fine-print', text: '这是手机原文备份，不含学习记录、附件、密钥或电脑知识库。系统自动备份仍关闭。' }),
      exportButton,
    ]),
    el('section', { class: 'panel' }, [
      el('h2', { text: '从手机备份恢复' }),
      el('p', { text: '先预览再恢复。已有资料不会被删除；相同资料不重复添加，同一资料的不同内容会跳过并保留手机当前版本。' }),
      select, detail,
      el('label', { class: 'check-field' }, [acknowledged, el('span', { text: '我已查看预览，确认新增资料并保留冲突项的手机当前版本' })]),
      restore, status,
    ]),
  ]);
  function sync() {
    exportButton.disabled = select.disabled = busy;
    acknowledged.disabled = busy || !preview;
    if (!preview) acknowledged.checked = false;
    restore.disabled = busy || !preview || !acknowledged.checked;
  }
  function forget() { preview = null; acknowledged.checked = false; clear(detail); sync(); }
  function report(error) { if (error?.code !== 'CANCELLED') onError(error); }
  async function exportBackup() {
    if (busy) return;
    busy = true; sync(); status.textContent = '请选择备份的保存位置…';
    try { await api.exportAndroidBackup(); status.textContent = '备份文件已保存。'; toast('手机备份已导出', 'success'); }
    catch (error) { status.textContent = error?.code === 'CANCELLED' ? '已取消导出。' : '导出未完成，请重新导出后再使用备份。'; report(error); }
    finally { busy = false; sync(); }
  }
  async function choose() {
    if (busy) return;
    forget(); busy = true; sync(); status.textContent = '请选择手机备份文件…';
    try {
      const result = await api.previewAndroidBackup();
      preview = result;
      detail.append(el('p', { text: `新增 ${result.newCount} 份，相同 ${result.sameCount} 份，冲突 ${result.conflicts.length} 份；包内历史 ${result.versionCount} 条。` }));
      if (result.conflicts.length) detail.append(el('div', { class: 'notice warning' }, [
        el('strong', { text: '以下冲突资料会跳过，不会覆盖：' }),
        el('ul', {}, result.conflicts.map(item => el('li', { text: item.title }))),
      ]));
      status.textContent = '预览有效期为 5 分钟。期间若资料发生变化，请重新选择并预览。';
    } catch (error) { forget(); status.textContent = error?.code === 'CANCELLED' ? '已取消选择，未更改资料。' : '未能读取有效备份，资料未改变。'; report(error); }
    finally { busy = false; sync(); }
  }
  async function apply() {
    if (busy || !preview || !acknowledged.checked) return;
    const selected = preview;
    busy = true; sync();
    try {
      if (!await confirmAction({ title: '恢复这些手机资料？', message: `将新增 ${selected.newCount} 份资料，并合并兼容的历史。${selected.conflicts.length} 份冲突资料会跳过，保留手机当前版本。`, confirmText: '确认恢复' })) return;
      const result = await api.restoreAndroidBackup(selected.token);
      forget();
      status.textContent = `已新增 ${result.imported} 份，保留相同资料 ${result.unchanged} 份，跳过冲突 ${result.conflictsSkipped} 份，补入历史 ${result.versionsImported} 条。`;
      toast('备份恢复完成', 'success');
      try { await onRestored(); }
      catch {
        status.textContent += ' 备份恢复已完成，但页面刷新未完成。请使用顶部刷新按钮或重新打开应用查看已恢复资料，无需再次恢复备份。';
        toast('备份恢复已完成，请刷新页面或重新打开应用查看', 'info');
      }
    } catch (error) { forget(); status.textContent = '恢复未完成，请重新预览后再确认；已有资料不会被冲突内容覆盖。'; report(error); }
    finally { busy = false; sync(); }
  }
  return panel;
}
