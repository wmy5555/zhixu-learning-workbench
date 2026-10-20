(() => {
  let value;
  try { value = localStorage.getItem('zhixu-web-theme'); } catch {}
  const media = matchMedia('(prefers-color-scheme: dark)');
  const apply = dark => {
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  };
  apply(value ? value === 'dark' : media.matches);
  window.setWebTheme = dark => {
    apply(dark); value = dark ? 'dark' : 'light';
    try { localStorage.setItem('zhixu-web-theme', value); } catch {}
  };
  media.addEventListener('change', () => { if (!value) apply(media.matches); });
})();
