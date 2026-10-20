(() => {
  let value;
  try { value = localStorage.getItem('zhixu-web-theme'); } catch {}
  const media = matchMedia('(prefers-color-scheme: dark)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.documentElement;
  let cleanup;
  const stopMotion = () => {
    clearTimeout(cleanup);
    root.classList.remove('theme-changing');
  };
  const apply = (dark, animate = false) => {
    const changed = root.classList.contains('dark') !== dark;
    if (changed) {
      stopMotion();
      if (animate && !reduced.matches) {
        root.classList.add('theme-changing');
        cleanup = setTimeout(stopMotion, 500);
      }
    }
    root.classList.toggle('dark', dark);
    root.dataset.theme = dark ? 'dark' : 'light';
    const toggle = document.getElementById('theme');
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(dark));
      toggle.setAttribute('aria-label', dark ? '切换日间模式' : '切换夜间模式');
      toggle.title = dark ? '切换日间模式' : '切换夜间模式';
    }
  };
  apply(value ? value === 'dark' : media.matches);
  window.setWebTheme = dark => {
    apply(dark, true); value = dark ? 'dark' : 'light';
    try { localStorage.setItem('zhixu-web-theme', value); } catch {}
  };
  media.addEventListener('change', () => { if (!value) apply(media.matches, true); });
  reduced.addEventListener('change', () => { if (reduced.matches) stopMotion(); });
})();
