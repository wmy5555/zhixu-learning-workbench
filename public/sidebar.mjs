// Navigation visibility is a browser preference, independent of library data.
export function initSidebar({ document, media, storage }) {
  const root = document.documentElement;
  const sidebar = document.querySelector('#sidebar');
  const menu = document.querySelector('#menu-button');
  const collapse = document.querySelector('#sidebar-collapse');
  const key = 'zhixu.sidebar.collapsed';
  let collapsed = false;
  let mobileOpen = false;
  try { collapsed = storage.getItem(key) === 'true'; } catch { /* Storage may be disabled. */ }

  function render() {
    const open = media.matches ? mobileOpen : !collapsed;
    root.classList.toggle('sidebar-collapsed', collapsed);
    sidebar.classList.toggle('is-open', media.matches && mobileOpen);
    sidebar.inert = !open;
    sidebar.setAttribute('aria-hidden', String(!open));
    for (const control of [menu, collapse]) control.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? '收起导航' : '展开导航');
    menu.title = open ? '收起导航' : '展开导航';
    return open;
  }
  function toggle() {
    if (media.matches) mobileOpen = !mobileOpen;
    else {
      collapsed = !collapsed;
      try { storage.setItem(key, String(collapsed)); } catch { /* Keep working without persistence. */ }
    }
    const open = render();
    (open ? collapse : menu).focus();
  }
  function closeMobile() {
    if (!media.matches || !mobileOpen) return;
    const restoreFocus = sidebar.contains(document.activeElement);
    mobileOpen = false;
    render();
    if (restoreFocus) menu.focus();
  }
  menu.addEventListener('click', toggle);
  collapse.addEventListener('click', toggle);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && media.matches && mobileOpen) {
      event.preventDefault();
      closeMobile();
    }
  });
  media.addEventListener('change', () => {
    mobileOpen = false;
    const focusedInside = sidebar.contains(document.activeElement);
    if (!render() && focusedInside) menu.focus();
    else if (!media.matches && !collapsed && document.activeElement === menu) collapse.focus();
  });
  render();
  return { closeMobile };
}
