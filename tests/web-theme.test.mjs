import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/web/theme.js', import.meta.url), 'utf8');
function setup({ stored = null, systemDark = false, reduce = false, storageFails = false } = {}) {
  const classes = new Set(), timers = new Map(), attributes = new Map();
  const root = { dataset:{}, classList:{ contains:key=>classes.has(key), add:key=>classes.add(key), remove:key=>classes.delete(key), toggle(key,on){ if(on) classes.add(key); else classes.delete(key); } } };
  const toggle = { setAttribute:(key,value)=>attributes.set(key,value) };
  const media = { matches:systemDark, addEventListener(type,fn){ this.change=fn; } };
  const reduced = { matches:reduce, addEventListener(type,fn){ this.change=fn; } };
  let next = 0;
  const window = {};
  vm.runInNewContext(source, { window, document:{ documentElement:root, getElementById:()=>toggle }, matchMedia:q=>q.includes('reduced')?reduced:media,
    localStorage:{ getItem:()=>{ if(storageFails) throw Error('blocked'); return stored; }, setItem:(key,value)=>{ if(storageFails) throw Error('blocked'); stored=value; } },
    setTimeout:fn=>{ timers.set(++next,fn); return next; }, clearTimeout:id=>timers.delete(id) });
  return { window, root, classes, timers, attributes, media, reduced, stored:()=>stored, finish(){ for(const fn of [...timers.values()]) fn(); } };
}

test('initial theme is applied without animation and explicit preference wins', () => {
  const app=setup({stored:'light',systemDark:true});
  assert.equal(app.root.dataset.theme,'light');
  assert.equal(app.classes.has('theme-changing'),false);
  assert.equal(app.timers.size,0);
  app.media.change();
  assert.equal(app.root.dataset.theme,'light');
});
test('switches both ways, persists preference, updates accessible state and cleans up rapid changes', () => {
  const app=setup();
  app.window.setWebTheme(true);
  assert.equal(app.classes.has('theme-changing'),true);
  assert.equal(app.attributes.get('aria-pressed'),'true');
  assert.equal(app.attributes.get('aria-label'),'切换日间模式');
  app.window.setWebTheme(false);
  assert.equal(app.root.dataset.theme,'light');
  assert.equal(app.stored(),'light');
  assert.equal(app.attributes.get('aria-pressed'),'false');
  assert.equal(app.timers.size,1);
  app.finish();
  assert.equal(app.classes.has('theme-changing'),false);
  assert.equal(app.timers.size,0);
  app.window.setWebTheme(false);
  assert.equal(app.timers.size,0);
});
test('reduced motion skips animation and cancels an active transition immediately', () => {
  const app=setup({reduce:true});
  app.window.setWebTheme(true);
  assert.equal(app.root.dataset.theme,'dark');
  assert.equal(app.timers.size,0);
  app.reduced.matches=false;
  app.window.setWebTheme(false);
  assert.equal(app.classes.has('theme-changing'),true);
  app.reduced.matches=true; app.reduced.change();
  assert.equal(app.classes.has('theme-changing'),false);
  assert.equal(app.timers.size,0);
});
test('system changes animate only without a manual preference and blocked storage stays usable', () => {
  const app=setup({storageFails:true});
  app.media.matches=true; app.media.change();
  assert.equal(app.root.dataset.theme,'dark');
  assert.equal(app.classes.has('theme-changing'),true);
  assert.doesNotThrow(()=>app.window.setWebTheme(false));
  app.media.change();
  assert.equal(app.root.dataset.theme,'light');
});
