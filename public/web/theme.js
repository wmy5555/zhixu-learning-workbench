(() => {
  let value;
  try { value = localStorage.getItem('zhixu-web-theme'); } catch {}
  const media = matchMedia('(prefers-color-scheme: dark)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.documentElement;
  let cleanup, activeTransition, activeReveal, activeDark, iconAnimation, hoverBounds, hovering = false, revision = 0;
  const insideButton = event => hoverBounds && event.clientX >= hoverBounds.left && event.clientX <= hoverBounds.left + hoverBounds.width && event.clientY >= hoverBounds.top && event.clientY <= hoverBounds.top + hoverBounds.height;
  const trackRevealPointer = event => { if (!insideButton(event)) hovering = false; };
  const playIcon = dark => {
    if (reduced.matches || document.visibilityState === 'hidden') return;
    const icon = document.getElementById('theme')?.querySelector(dark ? '.theme-moon svg' : '.theme-sun svg');
    if (!icon?.animate) return;
    iconAnimation?.cancel();
    const frames = dark
      ? [{ transform:'rotate(-18deg) scale(.88)' }, { transform:'rotate(7deg) scale(1.03)', offset:.65 }, { transform:'rotate(0) scale(1)' }]
      : [{ transform:'rotate(-65deg) scale(.76)', opacity:.35 }, { transform:'rotate(12deg) scale(1.08)', opacity:1, offset:.7 }, { transform:'rotate(0) scale(1)', opacity:1 }];
    const animation = icon.animate(frames, { duration:dark ? 420 : 560, easing:'cubic-bezier(.16,1,.3,1)', fill:'none' });
    iconAnimation = animation;
    animation.finished.catch(() => {}).finally(() => {
      animation.cancel();
      if (iconAnimation === animation) iconAnimation = undefined;
    });
  };
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
    document.removeEventListener('pointermove', trackRevealPointer);
    activeTransition?.skipTransition();
    activeReveal?.cancel();
    iconAnimation?.cancel();
    iconAnimation = undefined;
    activeTransition = activeReveal = undefined;
    activeDark = undefined;
  };
  const change = (dark, animateIcon = false) => {
    if (activeTransition && activeDark === dark) return;
    const request = ++revision;
    cancelReveal();
    stopMotion();
    root.classList.remove('theme-reveal');
    if (root.classList.contains('dark') === dark || reduced.matches || !document.startViewTransition || document.visibilityState === 'hidden') {
      const changed = root.classList.contains('dark') !== dark;
      apply(dark, !reduced.matches);
      if (changed && animateIcon) playIcon(dark);
      return;
    }
    // Theme colors do not change geometry. Read once before snapshot capture,
    // rather than forcing another layout while the new view is rendering.
    const rect = document.getElementById('theme')?.getBoundingClientRect();
    hoverBounds = rect;
    const x = rect?.width ? rect.left + rect.width / 2 : innerWidth - 32;
    const y = rect?.height ? rect.top + rect.height / 2 : 32;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 2;
    root.classList.add('theme-reveal');
    let transition;
    try {
      transition = document.startViewTransition(() => { if (request === revision) apply(dark); });
    } catch {
      root.classList.remove('theme-reveal');
      apply(dark, true);
      if (animateIcon) playIcon(dark);
      return;
    }
    activeTransition = transition;
    activeDark = dark;
    document.addEventListener('pointermove', trackRevealPointer, { passive:true });
    transition.ready.then(() => {
      if (request !== revision) return;
      const small = `circle(0px at ${x}px ${y}px)`;
      const large = `circle(${radius}px at ${x}px ${y}px)`;
      // Night surrounds the shrinking daylight from the farthest corner
      // (bottom-left); daylight then blooms outwards from the same button.
      activeReveal = root.animate({ clipPath: dark ? [large, small] : [small, large] }, {
        duration: dark ? 820 : 720, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'both',
        pseudoElement: dark ? '::view-transition-old(root)' : '::view-transition-new(root)',
      });
      activeReveal.finished.catch(() => {});
      if (animateIcon) playIcon(dark);
    }).catch(() => {
      if (request === revision) { transition.skipTransition(); apply(dark); }
    });
    transition.finished.catch(() => {}).finally(() => {
      if (request !== revision) return;
      // A filled animation must not survive and clip the next transition's
      // pseudo-element when the browser reuses the same snapshot name.
      activeReveal?.cancel();
      activeTransition = activeReveal = undefined;
      activeDark = undefined;
      root.classList.remove('theme-reveal');
      document.removeEventListener('pointermove', trackRevealPointer);
      // Ending the reveal must not replay the icon, even if removing the
      // transition overlay restores hover beneath a stationary pointer.
    });
  };
  window.getWebTheme = currentChoice;
  window.setWebTheme = dark => {
    value = dark ? 'dark' : 'light';
    change(dark, true);
    try { localStorage.setItem('zhixu-web-theme', value); } catch {}
  };
  document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('theme');
    toggle?.addEventListener('pointerenter', event => {
      if (event.pointerType === 'touch') return;
      const entered = !hovering;
      hovering = true;
      if (entered && !activeTransition) playIcon(root.classList.contains('dark'));
    });
    toggle?.addEventListener('pointerleave', event => {
      if (!activeTransition || !insideButton(event)) hovering = false;
    });
  });
  media.addEventListener('change', () => { if (!value) change(media.matches); });
  reduced.addEventListener('change', () => {
    if (reduced.matches) { ++revision; cancelReveal(); stopMotion(); root.classList.remove('theme-reveal'); apply(currentChoice()); }
  });
})();
