import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/web/theme.js', import.meta.url), 'utf8');
function setup({ stored = null, systemDark = false, reduce = false, storageFails = false, viewTransitions = false } = {}) {
  const classes = new Set(), timers = new Map(), attributes = new Map();
  const root = { dataset:{}, classList:{ contains:key=>classes.has(key), add:key=>classes.add(key), remove:key=>classes.delete(key), toggle(key,on){ if(on) classes.add(key); else classes.delete(key); } } };
  const toggle = { setAttribute:(key,value)=>attributes.set(key,value) };
  const media = { matches:systemDark, addEventListener(type,fn){ this.change=fn; } };
  const reduced = { matches:reduce, addEventListener(type,fn){ this.change=fn; } };
  let next = 0, geometryReads = 0;
  const transitions=[], reveals=[];
  const document={ documentElement:root, getElementById:()=>toggle, visibilityState:'visible' };
  if(viewTransitions) {
    const deferred=()=>{ let resolve,reject; const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject}; };
    document.startViewTransition=update=>{
      const ready=deferred(),finished=deferred();
      const transition={ready:ready.promise,finished:finished.promise,skipped:false,
        update(){ update(); ready.resolve(); }, finish:finished.resolve,
        skipTransition(){ this.skipped=true;ready.reject(Error('skipped'));finished.resolve(); }};
      transitions.push(transition);return transition;
    };
    toggle.getBoundingClientRect=()=>{ geometryReads++; return {left:940,top:20,width:40,height:40}; };
    root.animate=(frames,options)=>{
      const animation={frames,options,finished:Promise.resolve(),cancelled:false,cancel(){this.cancelled=true;}};
      reveals.push(animation);return animation;
    };
  }
  const window = {};
  vm.runInNewContext(source, { window, document, innerWidth:1000, innerHeight:800, matchMedia:q=>q.includes('reduced')?reduced:media,
    localStorage:{ getItem:()=>{ if(storageFails) throw Error('blocked'); return stored; }, setItem:(key,value)=>{ if(storageFails) throw Error('blocked'); stored=value; } },
    setTimeout:fn=>{ timers.set(++next,fn); return next; }, clearTimeout:id=>timers.delete(id) });
  return { window, root, classes, timers, attributes, media, reduced, transitions, reveals, document, geometryReads:()=>geometryReads, stored:()=>stored, finish(){ for(const fn of [...timers.values()]) fn(); } };
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

test('night surrounds daylight towards the toggle; daylight expands from the toggle', async () => {
  const app=setup({viewTransitions:true});
  app.window.setWebTheme(true);
  assert.equal(app.window.getWebTheme(),true);
  assert.equal(app.geometryReads(),1,'measure the button before capturing either snapshot');
  app.transitions[0].update(); await Promise.resolve();
  assert.equal(app.geometryReads(),1,'do not force another layout after capture');
  const night=app.reveals[0];
  assert.equal(night.options.pseudoElement,'::view-transition-old(root)');
  assert.equal(night.frames.clipPath[1],'circle(0px at 960px 40px)');
  const radius=Number(night.frames.clipPath[0].match(/circle\(([\d.]+)px/)[1]);
  assert.ok(radius>Math.hypot(960,760),'the initial circle must cover bottom-left and the whole viewport');
  app.window.setWebTheme(false);
  assert.equal(night.cancelled,true);
  app.transitions[1].update(); await Promise.resolve();
  const daylight=app.reveals[1];
  assert.equal(daylight.options.pseudoElement,'::view-transition-new(root)');
  assert.equal(daylight.frames.clipPath[0],'circle(0px at 960px 40px)');
  assert.equal(daylight.frames.clipPath[1],night.frames.clipPath[0]);
  app.transitions[1].finish();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.classes.has('theme-reveal'),false);
  assert.equal(daylight.cancelled,true,'filled snapshot animations must not clip the next transition');
});
test('repeated requests for the active theme reuse its snapshot rather than capturing again', async () => {
  const app=setup({viewTransitions:true});
  app.window.setWebTheme(true);
  app.window.setWebTheme(true);
  assert.equal(app.transitions.length,1);
  assert.equal(app.transitions[0].skipped,false);
  assert.equal(app.geometryReads(),1);
  app.transitions[0].update(); await Promise.resolve();
  app.window.setWebTheme(true);
  assert.equal(app.transitions.length,1);
  assert.equal(app.reveals[0].cancelled,false);
  app.transitions[0].finish();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.reveals[0].cancelled,true);
  assert.equal(app.classes.has('theme-reveal'),false);
});
test('rapid clicks supersede pending snapshots and reduced motion cancels the reveal', async () => {
  const app=setup({viewTransitions:true});
  app.window.setWebTheme(true);
  app.window.setWebTheme(!app.window.getWebTheme());
  assert.equal(app.transitions[0].skipped,true);
  app.transitions[0].update(); await Promise.resolve();
  assert.equal(app.root.dataset.theme,'light');
  assert.equal(app.reveals.length,0);
  app.window.setWebTheme(true);
  app.transitions[1].update(); await Promise.resolve();
  app.reduced.matches=true;app.reduced.change();
  assert.equal(app.root.dataset.theme,'dark');
  assert.equal(app.classes.has('theme-reveal'),false);
  assert.equal(app.reveals[0].cancelled,true);
});
test('snapshot failures and hidden pages still apply the requested theme', async () => {
  const app=setup({viewTransitions:true});
  app.window.setWebTheme(true);app.transitions[0].skipTransition();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.root.dataset.theme,'dark');
  assert.equal(app.classes.has('theme-reveal'),false);
  app.document.visibilityState='hidden';
  app.window.setWebTheme(false);
  assert.equal(app.root.dataset.theme,'light');
  assert.equal(app.transitions.length,1);
});
