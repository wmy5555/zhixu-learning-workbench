import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { Element, descendants } from './android-browser.mjs';

class IOSElement extends Element {
  get isConnected() { let node = this; while (node) { if (node.root) return true; node = node.parentNode; } return false; }
  get elements() { return { namedItem: name => descendants(this).find(node => node.name === name) || null }; }
}
const strip = source => source.replace(/^import[\s\S]*?;\s*/gm, '').replaceAll('export ', '');
export async function createIOSBrowser(client, { confirmations = [] } = {}) {
  const roots = new Map(), documentEvents = {}, windowEvents = {}, prompts = [], toasts = [];
  const body = new IOSElement('body'); body.root = true;
  const document = {
    body, documentElement: new IOSElement('html'), activeElement: null,
    createElement: tag => new IOSElement(tag),
    createTextNode: value => { const node = new IOSElement('text'); node.textContent = value; return node; },
    querySelector(selector) { if (!roots.has(selector)) { const node = new IOSElement('div'); body.append(node); roots.set(selector, node); } return roots.get(selector); },
    querySelectorAll(selector) { return selector === '#nav-list [data-view]' ? roots.get('#nav-list').children : []; },
    addEventListener(name, handler) { documentEvents[name] = handler; },
  };
  for (const id of ['#main', '#drawer', '#drawer-body', '#drawer-backdrop', '#sidebar', '#nav-list', '#menu-button', '#sidebar-collapse', '#quick-capture', '#global-refresh', '#drawer-close', '#drawer-title', '#drawer-eyebrow', '#page-title', '#page-eyebrow']) document.querySelector(id);
  for (const view of ['today', 'capture', 'library', 'study', 'topics', 'discover', 'output', 'system']) {
    const node = new IOSElement('button'); node.dataset.view = view; node.textContent = view; roots.get('#nav-list').append(node);
  }
  const location = { hash: '' };
  const window = { location, history: { replaceState(_state, _unused, hash) { location.hash = hash; } }, addEventListener(name, handler) { windowEvents[name] = handler; }, setTimeout() {} };
  const storage = new Map();
  const context = vm.createContext({ document, window, location, client, browserOptions: { browserPreview: true },
    Node: IOSElement, URL, Intl, Date, Map, Set, Promise, JSON, RegExp, TextEncoder, TextDecoder, queueMicrotask,
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    initSidebar: () => ({ closeMobile() {} }),
    FormData: class { constructor(form) { this.form = form; } entries() { return descendants(this.form).filter(node => node.name && !node.disabled && ['input', 'textarea', 'select'].includes(node.tagName)).map(node => [node.name, String(node.value)]); } },
  });
  const ui = await readFile(new URL('../../public/ui.mjs', import.meta.url), 'utf8');
  const exchange = await readFile(new URL('../../apps/ios/web/source-exchange.mjs', import.meta.url), 'utf8');
  const app = await readFile(new URL('../../apps/ios/web/ios-ui.mjs', import.meta.url), 'utf8');
  vm.runInContext(strip(ui) + '\n' + strip(exchange) + '\n' + strip(app), context);
  context.confirmAction = async options => { prompts.push(options); return confirmations.length ? confirmations.shift() : true; };
  context.toast = (...args) => toasts.push(args);
  await vm.runInContext('mountIOSPreview(client, browserOptions)', context);
  const flush = async () => { for (let round = 0; round < 12; round++) await new Promise(resolve => setImmediate(resolve)); };
  const click = async node => { node.events.click?.({ target: node, currentTarget: node, preventDefault() {} }); await flush(); };
  const navigate = async view => click(roots.get('#nav-list').children.find(node => node.dataset.view === view));
  return { roots, document, prompts, toasts, confirmations, windowEvents, documentEvents, navigate, click, flush, descendants };
}
