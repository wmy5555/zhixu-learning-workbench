(() => {
  const key = 'zhixu-theme', accentKey = 'zhixu-accent';
  const root = document.documentElement;
  const valid = color => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color);
  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
  let choice = read(key), accent = read(accentKey);
  if (!valid(accent)) accent = null;
  const system = matchMedia('(prefers-color-scheme: dark)');
  const rgb = hex => [1,3,5].map(i => parseInt(hex.slice(i,i+2),16));
  const mix = (a,b,t) => '#' + rgb(a).map((v,i) => Math.round(v+(rgb(b)[i]-v)*t).toString(16).padStart(2,'0')).join('');
  const luminance = hex => rgb(hex).map(v => { const n=v/255; return n<=.04045 ? n/12.92 : ((n+.055)/1.055)**2.4; }).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
  const contrast = (a,b) => (Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
  function readable(color, backgrounds, minimum, dark) {
    for (let step=0; step<=100; step++) {
      const next = mix(color,dark?'#ffffff':'#000000',step/100);
      if (backgrounds.every(bg=>contrast(next,bg)>=minimum)) return next;
    }
    return dark?'#ffffff':'#000000';
  }
  function palette(seed, theme) {
    const dark = theme === 'dark';
    const base = valid(seed) ? seed.toLowerCase() : dark ? '#a8b4ef' : '#184a52';
    const surface = dark ? '#2a2d32' : '#fbfaf6';
    const main = readable(base,[surface],3,dark);
    const soft = mix(main,dark?'#222428':'#ffffff',dark?.85:.91);
    const link = readable(main,[surface,soft],4.5,dark);
    const ink = contrast(main,'#000000') >= contrast(main,'#ffffff') ? '#000000' : '#ffffff';
    // Keep button text readable in its hover state, including very light custom colors.
    const hover = mix(main,ink==='#000000'?'#ffffff':'#000000',.12);
    return {'--accent':main,'--accent-2':link,'--accent-soft':soft,'--accent-ink':ink,'--accent-hover':hover,'--accent-focus':link};
  }
  function apply(theme) {
    root.dataset.theme = theme;
    for (const [name,value] of Object.entries(palette(accent,theme))) root.style.setProperty(name,value);
    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(theme === 'dark'));
      toggle.title = theme === 'dark' ? '切换日间模式' : '切换夜间模式';
    }
  }
  const initial = () => choice === 'dark' || choice === 'light' ? choice : system.matches ? 'dark' : 'light';
  window.zhixuAppearance = {
    getAccent: () => accent,
    palette,
    saveAccent(value) {
      if (value !== null && !valid(value)) throw new Error('请输入 # 开头的六位颜色代码，例如 #A8B4EF。');
      // Report storage failures instead of claiming the preference was saved.
      if (value === null) localStorage.removeItem(accentKey);
      else localStorage.setItem(accentKey,value.toLowerCase());
      accent = value === null ? null : value.toLowerCase();
      apply(root.dataset.theme);
    },
  };
  apply(initial());
  document.addEventListener('DOMContentLoaded', () => {
    apply(initial());
    document.getElementById('theme-toggle')?.addEventListener('click', () => {
      choice = root.dataset.theme === 'dark' ? 'light' : 'dark';
      apply(choice);
      try { localStorage.setItem(key, choice); } catch {}
    });
  });
  system.addEventListener('change', () => { if (!['light','dark'].includes(choice)) apply(initial()); });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === accentKey || event.key === null) {
      choice = read(key); accent = read(accentKey); if (!valid(accent)) accent = null;
      apply(initial());
    }
  });
})();
