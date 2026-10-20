(() => {
  let value;
  try { value = localStorage.getItem('zhixu-web-theme'); } catch {}
  const media = matchMedia('(prefers-color-scheme: dark)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.documentElement;
  let cleanup, activeTransition, activeReveal, revision = 0;
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
  const currentChoice = () => value ? value === 'dark' : media.matches;
  const cancelReveal = () => {
    activeTransition?.skipTransition();
    activeReveal?.cancel();
    activeTransition = activeReveal = undefined;
  };
  const change = dark => {
    const request = ++revision;
    cancelReveal();
    stopMotion();
    root.classList.remove('theme-reveal');
    if (root.classList.contains('dark') === dark || reduced.matches || !document.startViewTransition || document.visibilityState === 'hidden') {
      apply(dark, !reduced.matches);
      return;
    }
    root.classList.add('theme-reveal');
    let transition;
    try {
      transition = document.startViewTransition(() => { if (request === revision) apply(dark); });
    } catch {
      root.classList.remove('theme-reveal');
      apply(dark, true);
      return;
    }
    activeTransition = transition;
    transition.ready.then(() => {
      if (request !== revision) return;
      const rect = document.getElementById('theme')?.getBoundingClientRect();
      const x = rect?.width ? rect.left + rect.width / 2 : innerWidth - 32;
      const y = rect?.height ? rect.top + rect.height / 2 : 32;
      const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 2;
      const small = `circle(0px at ${x}px ${y}px)`;
      const large = `circle(${radius}px at ${x}px ${y}px)`;
      // Night surrounds the shrinking daylight from the farthest corner
      // (bottom-left); daylight then blooms outwards from the same button.
      activeReveal = root.animate({ clipPath: dark ? [large, small] : [small, large] }, {
        duration: dark ? 820 : 720, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'both',
        pseudoElement: dark ? '::view-transition-old(root)' : '::view-transition-new(root)',
      });
      activeReveal.finished.catch(() => {});
    }).catch(() => {
      if (request === revision) { transition.skipTransition(); apply(dark); }
    });
    transition.finished.catch(() => {}).finally(() => {
      if (request !== revision) return;
      activeTransition = activeReveal = undefined;
      root.classList.remove('theme-reveal');
    });
  };
  window.getWebTheme = currentChoice;
  window.setWebTheme = dark => {
    value = dark ? 'dark' : 'light';
    change(dark);
    try { localStorage.setItem('zhixu-web-theme', value); } catch {}
  };
  media.addEventListener('change', () => { if (!value) change(media.matches); });
  reduced.addEventListener('change', () => {
    if (reduced.matches) { ++revision; cancelReveal(); stopMotion(); root.classList.remove('theme-reveal'); apply(currentChoice()); }
  });
})();
