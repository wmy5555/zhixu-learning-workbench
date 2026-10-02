// Navigation visibility is a browser preference, independent of library data.
export function initSidebar({ document, media, storage }) {
  const root = document.documentElement;
  const sidebar = document.querySelector('#sidebar');
  const menu = document.querySelector('#menu-button');
  const collapse = document.querySelector('#sidebar-collapse');
  const key = 'zhixu.sidebar.collapsed';
  let collapsed = false;
  let mobileOpen = false;
  let temporaryOpen = false;
  try { collapsed = storage.getItem(key) === 'true'; } catch { /* Storage may be disabled. */ }

  function render() {
    const open = temporaryOpen || (media.matches ? mobileOpen : !collapsed);
    root.classList.toggle('sidebar-collapsed', collapsed && !temporaryOpen);
    sidebar.classList.toggle('is-open', media.matches && open);
    sidebar.inert = !open;
    sidebar.setAttribute('aria-hidden', String(!open));
    for (const control of [menu, collapse]) control.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? '收起导航' : '展开导航');
    menu.title = open ? '收起导航' : '展开导航';
    return open;
  }
  function toggle() {
    const wasOpen = temporaryOpen || (media.matches ? mobileOpen : !collapsed);
    temporaryOpen = false;
    if (media.matches) mobileOpen = !wasOpen;
    else {
      collapsed = wasOpen;
      try { storage.setItem(key, String(collapsed)); } catch { /* Keep working without persistence. */ }
    }
    const open = render();
    (open ? collapse : menu).focus();
  }
  function closeMobile() {
    if (!media.matches || (!mobileOpen && !temporaryOpen)) return;
    const restoreFocus = sidebar.contains(document.activeElement);
    mobileOpen = false;
    temporaryOpen = false;
    render();
    if (restoreFocus) menu.focus();
  }
  menu.addEventListener('click', toggle);
  collapse.addEventListener('click', toggle);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && media.matches && (mobileOpen || temporaryOpen)) {
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
  function revealTarget(target) {
    if (!sidebar.contains(target)) return;
    temporaryOpen = true;
    render();
    return () => {
      temporaryOpen = false;
      const focusedInside = sidebar.contains(document.activeElement);
      if (!render() && focusedInside) menu.focus();
    };
  }
  return { closeMobile, revealTarget };
}
