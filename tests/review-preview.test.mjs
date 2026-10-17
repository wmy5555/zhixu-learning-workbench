import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reviewManifest, isReviewLocation, initialReviewView, applyReviewNavigation } from '../public/review-manifest.mjs';
import { routeApplication } from '../public/review-entry.mjs';
import { mountReview } from '../public/review.mjs';

const location = overrides => ({ hostname: '127.0.0.1', port: '14318', pathname: '/', hash: '', search: '?private=draft', ...overrides });
for (const hostname of ['127.0.0.1', 'localhost', '[::1]']) test('dedicated root routes without app initialization: ' + hostname, async () => {
  let replacement;
  const result = await routeApplication(location({ hostname, hash: '#today', replace: value => { replacement = value; } }), () => { throw Error('must not start application'); });
  assert.equal(result, 'review'); assert.equal(replacement, '/review.html#capture');
  assert.ok(!replacement.includes('?'));
});
for (const overrides of [{port:'4318'}, {port:'4326'}, {hostname:'127.0.0.1.evil.test'}, {hostname:'example.test'}, {pathname:'/other'}, {pathname:'/review.html'}]) test('ordinary URL does not redirect ' + JSON.stringify(overrides), async () => {
  let loads = 0;
  const result = await routeApplication(location({ ...overrides, replace() { throw Error('unexpected redirect'); } }), async () => { loads++; });
  assert.equal(result, 'application'); assert.equal(loads, 1);
});
test('manifest white-list preserves relevant route and rejects unavailable routes', () => {
  assert.equal(initialReviewView('#library'), 'library');
  for (const hash of ['#today', '#study', '#unknown', '#api-center']) assert.equal(initialReviewView(hash), 'capture');
  assert.equal(isReviewLocation(location({pathname:'/review.html'})), true);
  assert.equal(isReviewLocation(location({pathname:'/review.html',port:'4318'})), false);
  assert.equal(reviewManifest.entries.find(e => e.id === 'api-center').enabled, true);
});
test('navigation keeps original controls and handlers while hiding unrelated entries', () => {
  const handler = () => 'original unsaved-draft confirmation';
  const buttons = ['capture','library','today','system'].map(view => ({ dataset: {view}, onClick: handler }));
  applyReviewNavigation(buttons);
  assert.deepEqual(buttons.map(b => b.hidden), [false,false,true,false]);
  assert.deepEqual(buttons.map(b => b.disabled), [false,false,true,false]);
  assert.ok(buttons.every(b => b.onClick === handler));
});
test('review fails closed on wrong port before reading shell or starting application', async () => {
  await assert.rejects(mountReview({ location: location({port:'4326',pathname:'/review.html'}), fetch() { throw Error('unexpected fetch'); }, loadApp() { throw Error('unexpected start'); } }), /14318/);
});
test('shell fetch failure cannot start application', async () => {
  await assert.rejects(mountReview({location: location({pathname:'/review.html'}), fetch: async () => ({ok:false}), loadApp() {throw Error('unexpected start');}}), /无法读取/);
});
test('entry reuses real app and shell, leaves original component implementations untouched', async () => {
  const [index, entry, html, boot, css] = await Promise.all(['index.html','review-entry.mjs','review.html','review.mjs','review.css'].map(name => readFile(new URL('../public/'+name, import.meta.url), 'utf8')));
  assert.match(index, /type="module" src="\/review-entry.mjs"/);
  assert.match(entry, /import\('\.\/app\.mjs'\)/);
  assert.match(boot, /fetch\('\/index\.html'/);
  assert.match(boot, /import\('\.\/app\.mjs'\)/);
  assert.match(boot, /querySelectorAll\('script'\)/);
  assert.doesNotMatch(html, /id="(?:main|nav-list|drawer)"/);
  assert.doesNotMatch(boot, /\.innerHTML|localStorage|sessionStorage|\.click\(/);
  assert.doesNotMatch(css, /(?:\.toast|\.dialog|\.group-job|\.loading-panel|\.notice\.danger)[^{]*\{[^}]*display:\s*none/);
  assert.match(css, /capture-layout > \.page-stack/);
  assert.match(css, /data-library-section="standalone"/);
});

test('mount reuses shell, tracks committed navigation, and does not reload app on redraw', async () => {
  const make = tag => ({ tag, dataset: {}, children: [], textContent: '',
    append(...children) { this.children.push(...children); }, prepend(child) { this.children.unshift(child); },
    setAttribute(name, value) { this[name] = value; },
  });
  const buttons = ['capture','library','today','system'].map(view => ({ ...make('button'), dataset: {view} }));
  let active = buttons[0], observer, loads = 0, replacements = 0, scriptsRemoved = 0;
  const nav = { querySelectorAll: () => buttons, querySelector: () => active };
  const workspace = make('workspace');
  const root = make('html');
  const body = { replaceChildren(...nodes) { replacements++; assert.equal(nodes[0], 'actual shell child'); } };
  const document = {
    documentElement: root, body,
    importNode: node => node,
    getElementById: id => id === 'nav-list' ? nav : make(id),
    querySelector: () => workspace,
    createElement: make, createTextNode: text => text,
  };
  const shell = { body: {childNodes:['actual shell child']}, getElementById: () => ({}), querySelectorAll: () => [{remove(){scriptsRemoved++;}}] };
  let destination;
  await mountReview({document, location: location({pathname:'/review.html',hash:'#library'}),
    history: {replaceState(a,b,url){destination=url;}},
    fetch: async (url, options) => {assert.equal(url,'/index.html');assert.equal(options.cache,'no-store');return {ok:true,text:async()=>'<actual current shell>'};},
    DOMParser: class {parseFromString(text){assert.equal(text,'<actual current shell>');return shell;}},
    MutationObserver: class {constructor(callback){observer=callback;} observe(target,options){assert.equal(target,nav);assert.deepEqual(options.attributeFilter,['class']);}},
    loadApp: async () => {loads++;active=buttons[1];},
  });
  assert.equal(destination,'/review.html#library');
  assert.equal(root.dataset.reviewView,'library');
  assert.equal(scriptsRemoved,1); assert.equal(replacements,1); assert.equal(loads,1);
  // A rejected navigation leaves the original active control and current view intact.
  observer(); assert.equal(root.dataset.reviewView,'library');
  active=buttons[0]; observer(); assert.equal(root.dataset.reviewView,'capture');
  observer(); assert.equal(replacements,1); assert.equal(loads,1);
  assert.equal(buttons[3].hidden,false);
});

test('incompatible shell stops before replacing DOM or starting app', async () => {
  await assert.rejects(mountReview({
    location: location({pathname:'/review.html'}),
    fetch: async()=>({ok:true,text:async()=>''}),
    DOMParser: class {parseFromString(){return {querySelectorAll:()=>[],getElementById:()=>null};}},
    document: {body:{replaceChildren(){throw Error('must preserve error shell');}}},
    loadApp(){throw Error('must not start');},
  }), /缺少审阅所需界面标记/);
});

test('API center and pricing keep allowed system tabs, stable markers and real feedback', async () => {
  assert.equal(initialReviewView('#system/settings'), 'system/settings');
  assert.equal(initialReviewView('#system/usage'), 'system/usage');
  assert.equal(initialReviewView('#system/diagnostics'), 'system/settings');
  const [app, css, manifest] = await Promise.all(['app.mjs','review.css','review-manifest.mjs'].map(name => readFile(new URL('../public/'+name, import.meta.url), 'utf8')));
  assert.match(app, /review: "api-center"/);
  assert.match(css, /data-review="api-center"/);
  assert.match(css, /data-tour="settings-prompts"/);
  assert.doesNotMatch(css, /(?:api-test-status|api-test-actions|settings-save|model-discovery)[^{]*\{[^}]*display:\s*none/);
  assert.match(manifest, /2717cd0ad4fb69c48b9f23db0d1e2d6531bb6f93/);
  assert.match(manifest, /85628fc/);
  assert.doesNotMatch(manifest, /不含后续围栏修复/);
});


test('dedicated entry preserves price-page deep links and rejects unrelated system tabs', async () => {
  for (const [hash, expected] of [['#system/usage', 'system/usage'], ['#system/settings', 'system/settings'], ['#system/data', 'system/settings']]) {
    let destination;
    await routeApplication(location({ hash, replace(value) { destination = value; } }), () => { throw Error('must not start application'); });
    assert.equal(destination, '/review.html#' + expected);
  }
  const css = await readFile(new URL('../public/review.css', import.meta.url), 'utf8');
  assert.match(css, /:not\(\[data-system-tab="settings"\]\):not\(\[data-system-tab="usage"\]\)/);
  assert.doesNotMatch(css, /(?:usage-dashboard|usage-budget|usage-fields)[^{]*\{[^}]*display:\s*none/);
});

test('manifest pins all four draft sources and does not claim they are merged', () => {
  const changes = reviewManifest.entries.flatMap(entry => entry.changes);
  const expected = { 83: 'e3a3d3596684ca84d0a64ae69437c91f15bdf498', 85: '47b795ab360773b595440f412f9cf87ba1da2b5c',
    87: '793907c48cc6de74e715416a9e4e539b72a83d82', 88: '874aa9a4cd6333d577aaa4eee5b883aea19bd8a6' };
  for (const [pr, head] of Object.entries(expected)) {
    const change = changes.find(change => change.pr === Number(pr));
    assert.equal(change.head, head); assert.match(change.status, /草稿未合并/);
  }
});
