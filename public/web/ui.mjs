import { escape as e } from './markdown.mjs';
import { springEnter } from './cds/motion-bridge.mjs';

// Icons and the wordmark come exclusively from the selected 14328 prototype.
const shapes = {
  leaf:'<path d="M5 19C2 9 8 3 20 3c1 12-5 18-15 16Z"/><path d="m4 20 12-12M8 16v-6m0 6h6"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  plus:'<path d="M12 4v16M4 12h16"/>',
  home:'<path d="m3 10 9-7 9 7v10H15v-7H9v7H3Z"/>',
  book:'<path d="M12 5v16M12 5C8 3 4 3 2 4v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-2-1-6-1-10 1Z"/>',
  check:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  layers:'<path d="m3 7 9-4 9 4-9 4Zm0 5 9 4 9-4M3 17l9 4 9-4"/>',
  network:'<circle cx="5" cy="6" r="2.5"/><circle cx="19" cy="8" r="2.5"/><circle cx="10" cy="19" r="2.5"/><path d="m7 7 9 1M6 9l3 7m3 1 5-7"/>',
  chat:'<path d="M4 4h16v13H9l-5 4ZM8 9h8m-8 4h5"/>',
  settings:'<path d="m9 3-1 3-3 1v4l2 2-1 4 3 2 3-1 3 1 3-2-1-4 2-2V7l-3-1-1-3Z"/><circle cx="12" cy="11" r="3"/>',
  arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
  spark:'<path d="M12 2v20M2 12h20M5 5l14 14M5 19 19 5"/>',
  moon:'<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  file:'<path d="M5 3h9l5 5v13H5Zm9 0v6h5M9 13h6m-6 4h6"/>',
};
export const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${shapes[name] || shapes.book}</svg>`;
export const $ = selector => document.querySelector(selector);
export const $$ = selector => [...document.querySelectorAll(selector)];
export const jobState = value => ({ queued:'等待处理', running:'正在处理', waiting:'等待条件', failed:'未完成', done:'已完成', cancelled:'已取消', reading:'正在阅读', awaiting_feedback:'等待反馈', feedback:'可继续练习', completed:'已结束' }[value] || value || '');
export const button = (label, action, css = '', attributes = '') => `<button type="button" class="${css}" data-action="${action}" ${attributes}>${label}</button>`;
export const routeButton = (label, route, css = '') => button(label, 'navigate', css, `data-route="${e(route)}"`);
export const field = (label, name, { value = '', type = 'text', placeholder = '', required = false, extra = '' } = {}) =>
  `<label class="field"><span>${e(label)}</span><input name="${name}" type="${type}" value="${e(value)}" placeholder="${e(placeholder)}" ${required ? 'required' : ''} ${extra}></label>`;
export const area = (label, name, { value = '', placeholder = '', required = false, rows = 8 } = {}) =>
  `<label class="field"><span>${e(label)}</span><textarea name="${name}" rows="${rows}" placeholder="${e(placeholder)}" ${required ? 'required' : ''}>${e(value)}</textarea></label>`;
export const empty = (title, copy, action = '') => `<section class="empty-page">${icon('leaf')}<h2>${e(title)}</h2><p>${e(copy)}</p>${action}</section>`;
export const heading = (kicker, title, description, action = '') => `<header class="page-heading"><div><p class="eyebrow">${e(kicker)}</p><h1>${e(title)}</h1><p>${e(description)}</p></div>${action}</header>`;
export function calendar(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return { day:'—', label:'今天' };
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return { day:'—', label:'今天' };
  return { day: value.slice(-2), label: new Intl.DateTimeFormat('zh-CN', { timeZone:'UTC', month:'long', weekday:'long' }).format(date) };
}
export function notify(message, error = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { toast.hidden = true; }, error ? 9000 : 4500);
}
export function modal(title, body, { wide = false, onClose } = {}) {
  const previous = document.activeElement, dialog = document.createElement('dialog');
  dialog.className = wide ? 'modal-wide' : '';
  dialog.setAttribute('aria-label', title);
  dialog.innerHTML = `<header class="dialog-heading"><h2>${e(title)}</h2><button type="button" class="icon-button" data-modal-close aria-label="关闭窗口">${icon('close')}</button></header><div class="dialog-body">${body}</div>`;
  const close = async () => { if (!dialog.beforeClose || await dialog.beforeClose()) dialog.close(); };
  dialog.querySelector('[data-modal-close]').addEventListener('click', close);
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); event.stopPropagation(); close(); });
  dialog.addEventListener('close', () => { dialog.remove(); onClose?.(); if (previous?.isConnected) previous.focus({ preventScroll:true }); });
  document.body.append(dialog); dialog.showModal(); springEnter(dialog, undefined, 7, .995);
  return dialog;
}
export function confirm(title, copy, label = '确认继续') {
  return new Promise(resolve => {
    let accepted = false;
    const dialog = modal(title, `<p>${e(copy)}</p><div class="actions"><button class="primary" data-confirm>${e(label)}</button><button class="text-button" data-cancel>取消</button></div>`, { onClose: () => resolve(accepted) });
    dialog.querySelector('[data-confirm]').onclick = () => { accepted = true; dialog.close(); };
    dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
  });
}
export async function busy(control, work) {
  if (control?.disabled) return;
  if (control) { control.disabled = true; control.setAttribute('aria-busy', 'true'); }
  try { return await work(); } catch (error) { notify(error.message || '操作未完成。', true); }
  finally { if (control) { control.disabled = false; control.removeAttribute('aria-busy'); } }
}

export const list = value => Array.isArray(value) ? value : [];
export const select = (label, name, options, value = '') => `<label class="field"><span>${e(label)}</span><select name="${name}">${options.map(([id,text])=>`<option value="${e(id)}" ${String(value)===String(id)?'selected':''}>${e(text)}</option>`).join('')}</select></label>`;
export const details = (title, body, open = false) => `<details class="quiet-details" ${open?'open':''}><summary>${e(title)}</summary><div class="disclosure-body">${body}</div></details>`;
export const readable = value => value == null ? '未记录' : typeof value === 'object' ? JSON.stringify(value,null,2) : String(value);
export const facts = pairs => `<dl class="parity-facts">${pairs.filter(([,v])=>v!==undefined&&v!==null&&v!=='').map(([k,v])=>`<div><dt>${e(k)}</dt><dd>${e(readable(v))}</dd></div>`).join('')}</dl>`;
export function paginate(host, rows, render, {size=20,filter=()=>true}={}) {
  let page=0;
  const draw=()=>{
    const visible=rows.filter(filter),pages=Math.max(1,Math.ceil(visible.length/size));page=Math.min(page,pages-1);
    host.innerHTML=`<div>${visible.slice(page*size,(page+1)*size).map(render).join('')||'<p class="empty">没有符合条件的记录。</p>'}</div><div class="parity-pagination"><button type="button" class="text-button" data-page="previous" ${page?'':'disabled'}>上一页</button><span>${page+1} / ${pages} · 共 ${visible.length} 条</span><button type="button" class="text-button" data-page="next" ${page+1<pages?'':'disabled'}>下一页</button></div>`;
    host.querySelector('[data-page="previous"]').onclick=()=>{page--;draw();};host.querySelector('[data-page="next"]').onclick=()=>{page++;draw();};
  };draw();return ()=>{page=0;draw();};
}
