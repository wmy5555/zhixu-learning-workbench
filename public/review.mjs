import { reviewManifest, isReviewLocation, initialReviewView, entryForView, applyReviewNavigation } from './review-manifest.mjs';

export async function mountReview({ document, location, history, fetch, DOMParser, MutationObserver, loadApp }) {
  if (!isReviewLocation(location)) throw new Error('此审阅入口仅用于本机 14318；当前端口未启动审阅模式。');
  const response = await fetch('/index.html', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new Error('无法读取当前版本的应用外壳，请稍后刷新。');
  const shell = new DOMParser().parseFromString(await response.text(), 'text/html');
  // Reuse the actual shell, not a maintained copy. Parsed scripts never execute.
  shell.querySelectorAll('script').forEach(script => script.remove());
  for (const id of ['main', 'nav-list', 'drawer', 'drawer-body', 'global-refresh']) {
    if (!shell.getElementById(id)) throw new Error('当前版本缺少审阅所需界面标记：' + id);
  }
  document.body.replaceChildren(...Array.from(shell.body.childNodes, node => document.importNode(node, true)));
  document.documentElement.dataset.reviewMode = 'scoped';
  document.title = '知序 · 本轮改动审阅';
  const nav = document.getElementById('nav-list');
  applyReviewNavigation(nav.querySelectorAll('[data-view]'));
  const banner = document.createElement('section');
  banner.className = 'review-banner'; banner.setAttribute('aria-label', '本轮改动与候选版本');
  const title = document.createElement('h2'); title.textContent = '本轮改动审阅';
  const version = document.createElement('p'); version.textContent = `固定功能候选 ${reviewManifest.candidate}（基线 ${reviewManifest.baseline.slice(0, 7)}，含 PR #83 / #85 / #87 / #88 草稿） · 仅展示相关组件及必要上下文`;
  const detail = document.createElement('p'); detail.setAttribute('aria-live', 'polite');
  const list = document.createElement('ul');
  for (const entry of reviewManifest.entries) {
    const item = document.createElement('li');
    item.append(document.createTextNode(entry.title + (entry.enabled ? '：' : '（待接入）：')));
    for (const [index, change] of entry.changes.entries()) {
      if (index) item.append(document.createTextNode('；'));
      const link = document.createElement(change.pr ? 'a' : 'span');
      if (change.pr) {
        link.href = `https://github.com/wmy5555/zhixu-learning-workbench/pull/${change.pr}`;
        link.target = '_blank'; link.rel = 'noopener noreferrer';
      }
      link.textContent = change.pr ? `PR #${change.pr}` : change.label;
      item.append(link, document.createTextNode(` ${change.head || '未固定'} · ${change.status}`));
    }
    list.append(item);
  }
  banner.append(title, version, detail, list);
  document.querySelector('.workspace').prepend(banner);
  const sync = () => {
    const active = nav.querySelector('[data-view].is-active');
    const entry = entryForView(active?.dataset.view);
    const view = entry?.view || 'unavailable';
    if (document.documentElement.dataset.reviewView !== view) document.documentElement.dataset.reviewView = view;
    const text = entry?.description || '当前页面不在本轮清单，请从左侧选择改动。';
    if (detail.textContent !== text) detail.textContent = text;
  };
  new MutationObserver(sync).observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'] });
  history.replaceState(null, '', '/review.html#' + initialReviewView(location.hash));
  sync();
  await loadApp();
  sync();
}

if (typeof window !== 'undefined') mountReview({
  document, location: window.location, history: window.history,
  fetch: window.fetch.bind(window), DOMParser, MutationObserver,
  loadApp: () => import('./app.mjs'),
}).catch(error => {
  const message = document.createElement('p'); message.setAttribute('role', 'alert');
  message.textContent = error.message;
  // Never fall back to rendering the entire application on a failed review setup.
  document.body.replaceChildren(message);
});
