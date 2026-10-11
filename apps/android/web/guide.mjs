export function searchGuide(entries, query) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return entries.filter(entry => words.every(word => `${entry.title} ${entry.text}`.toLocaleLowerCase().includes(word)));
}

if (typeof window !== 'undefined' && window.self === window.top) {
  document.documentElement.classList.add('guide-standalone');
  const input = document.querySelector('#guide-query');
  const results = document.querySelector('#guide-results');
  const list = results.querySelector('ul');
  const status = document.querySelector('#guide-search-status');
  const menu = document.querySelector('.guide-menu');
  const toc = document.querySelector('.guide-toc');
  const entries = [];
  document.querySelectorAll('main section, .guide-hero').forEach(section => {
    const title = section.querySelector('h1, h2').textContent;
    section.querySelectorAll('p, li, tr, summary, h3, .tip').forEach(element => {
      element.id ||= `guide-hit-${entries.length}`;
      entries.push({ title, text: element.textContent.trim(), id: element.id, element });
    });
  });
  const closeMenu = () => { toc.classList.remove('is-open'); menu.setAttribute('aria-expanded', 'false'); };
  menu.addEventListener('click', () => {
    const open = toc.classList.toggle('is-open');
    menu.setAttribute('aria-expanded', String(open));
  });
  toc.addEventListener('click', event => { if (event.target.closest('a')) closeMenu(); });
  const updateCurrent = () => {
    const target = document.getElementById(location.hash.slice(1));
    const section = target?.closest('section');
    toc.querySelectorAll('a').forEach(link => {
      if (section && link.hash === `#${section.id}`) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    const detail = target?.closest('details');
    if (detail) { detail.open = true; target.scrollIntoView(); }
  };
  window.addEventListener('hashchange', updateCurrent);
  updateCurrent();
  input.addEventListener('input', () => {
    list.replaceChildren();
    const matches = searchGuide(entries, input.value);
    results.hidden = !input.value.trim();
    status.textContent = matches.length ? `找到 ${matches.length} 处内容` : '没有找到相关内容，试试更短的关键词。';
    for (const match of matches) {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.href = `#${match.id}`;
      const title = document.createElement('strong');
      title.textContent = match.title;
      const excerpt = document.createElement('small');
      const index = match.text.toLocaleLowerCase().indexOf(input.value.trim().split(/\s+/)[0].toLocaleLowerCase());
      const start = Math.max(0, index - 25);
      excerpt.textContent = `${start ? '…' : ''}${match.text.slice(start, start + 100)}${match.text.length > start + 100 ? '…' : ''}`;
      link.append(title, excerpt);
      link.addEventListener('click', () => {
        results.hidden = true;
        const detail = match.element.closest('details');
        if (detail) detail.open = true;
        match.element.tabIndex = -1;
        match.element.focus({ preventScroll: true });
      });
      li.append(link);
      list.append(li);
    }
  });
  input.addEventListener('focus', () => { if (input.value.trim()) results.hidden = false; });
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' && !results.hidden) { event.preventDefault(); list.querySelector('a')?.focus(); }
    if (event.key === 'Enter' && !results.hidden) { event.preventDefault(); list.querySelector('a')?.click(); }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (!results.hidden) { input.focus(); results.hidden = true; }
      if (toc.classList.contains('is-open')) { closeMenu(); menu.focus(); }
    }
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.guide-search')) results.hidden = true;
    if (!event.target.closest('.guide-toc, .guide-menu')) closeMenu();
  });
}
