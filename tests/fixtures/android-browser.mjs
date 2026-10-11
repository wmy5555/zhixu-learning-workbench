import { readFile } from "node:fs/promises";
import vm from "node:vm";

const root = new URL("../../apps/android/web/", import.meta.url);
const read = name => readFile(new URL(name, root), "utf8");

export class Element {
  constructor(tag = "div") {
    this.tagName = tag; this.children = []; this.events = {}; this.attributes = {}; this.dataset = {};
    this.type = ""; this.name = ""; this.value = ""; this.disabled = false; this.checked = false;
    this.defaultChecked = false; this.selected = false; this.open = false; this.hidden = false; this.scrollTop = 0;
    this.style = { setProperty() {} }; this._text = ""; this.className = "";
    this.classList = {
      add: name => { if (!this.classList.contains(name)) this.className = `${this.className} ${name}`.trim(); },
      remove: name => { this.className = this.className.split(/\s+/).filter(item => item !== name).join(" "); },
      contains: name => this.className.split(/\s+/).includes(name),
      toggle: (name, force) => { const next = force ?? !this.classList.contains(name); next ? this.classList.add(name) : this.classList.remove(name); return next; },
    };
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent ?? String(child)).join(""); }
  append(...children) {
    this.children.push(...children.map(child => {
      const node = child instanceof Element ? child : new Element("text");
      if (!(child instanceof Element)) node.textContent = String(child);
      node.parentNode = this;
      return node;
    }));
  }
  prepend(...children) { this.children.unshift(...children); }
  replaceChildren(...children) { this._text = ""; this.children = []; this.append(...children); }
  addEventListener(name, handler) { this.events[name] = handler; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  querySelectorAll(selector) { return descendants(this).slice(1).filter(node => matches(node, selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  insertBefore(node, reference) { const index = this.children.indexOf(reference); this.children.splice(index < 0 ? this.children.length : index, 0, node); node.parentNode = this; }
  get lastChild() { return this.children.at(-1); }
  focus() { this.focused = true; }
  scrollIntoView() { this.scrolledIntoView = true; }
  click() { this.clicked = true; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); }
  reset() {
    this.events.reset?.({ target: this, preventDefault() {} });
    for (const node of descendants(this)) {
      if (["input", "textarea"].includes(node.tagName)) { node.checked = node.defaultChecked; node.value = node.defaultValue || ""; }
    }
  }
}

export function descendants(node) {
  return [node, ...node.children.flatMap(child => child instanceof Element ? descendants(child) : [])];
}

function matches(node, selector) {
  const named = selector.match(/^\[name=["']([^"']+)["']\]$/);
  if (named) return node.name === named[1];
  const data = selector.match(/^\[data-([\w-]+)(?:=["']([^"']+)["'])?\]$/);
  if (data) return Object.hasOwn(node.dataset, data[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()))
    && (data[2] === undefined || node.dataset[data[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] === data[2]);
  if (selector.startsWith(".")) return node.classList.contains(selector.slice(1));
  const tag = selector.match(/^(\w+)(?:\[([^=]+)=['"]([^'"]+)['"]\])?$/);
  return Boolean(tag && node.tagName === tag[1] && (!tag[2] || node[tag[2]] === tag[3]));
}

function stripImports(source) {
  return source.replace(/^import[\s\S]*?;\s*/gm, "").replaceAll("export ", "");
}

export async function createAndroidBrowser({ api = {}, confirmations = [] } = {}) {
  const [ui, app, sourceExchange, androidData] = await Promise.all([
    read("ui.mjs"), read("app.mjs"), read("source-exchange.mjs"), read("android-data.mjs"),
  ]);
  const roots = new Map();
  const document = {
    documentElement: new Element("html"), body: new Element("body"), activeElement: null,
    createElement: tag => new Element(tag), createTextNode: text => { const node = new Element("text"); node.textContent = text; return node; },
    querySelector(selector) { if (!roots.has(selector)) roots.set(selector, new Element()); return roots.get(selector); },
    addEventListener() {},
  };
  const local = new Map();
  const window = {
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    history: { replaceState() {} }, location: { hash: "" }, setTimeout() {}, addEventListener() {},
  };
  const context = vm.createContext({
    api: { runtime: { kind: "android-prototype" }, getContext: () => ({ practiceId: "", version: 0 }), ...api },
    document, window, localStorage: { getItem: key => local.get(key) || null, setItem: (key, value) => local.set(key, value) },
    Node: Element, ApiError: class extends Error {}, URL, Intl, Date, Map, Set, Promise, JSON, RegExp, TextEncoder, TextDecoder, queueMicrotask,
    crypto: { randomUUID: () => "synthetic-request-id" },
    FormData: class {
      constructor(form) { this.form = form; }
      entries() { return descendants(this.form).filter(node => node.name && !node.disabled && ["input", "textarea", "select"].includes(node.tagName))
        .map(node => [node.name, String(node.value)]); }
    },
    initSidebar: () => ({ closeMobile() {}, revealTarget() {} }),
    createProcessFeedback: () => ({ status: () => null, observe() {}, start() {}, dispose() {} }),
    createSourceMap: () => new Element("div"),
    toast: (...args) => { context.toasts.push(args); },
  });
  context.toasts = [];
  context.confirmAction = async () => confirmations.length ? confirmations.shift() : true;
  vm.runInContext(stripImports(ui) + "\n" + stripImports(sourceExchange) + "\n" + stripImports(androidData), context);
  context.confirmAction = async options => {
    context.confirmPrompts.push(options);
    return confirmations.length ? confirmations.shift() : true;
  };
  context.confirmPrompts = [];
  const appCode = stripImports(app).replace(/^init\(\);\s*$/m, "")
    + "\nthis.androidApp = { navigate, renderCapture, renderSourceGroupDrawer, renderHistory, renderSystem, state, refs };";
  vm.runInContext(appCode, context);
  return { app: context.androidApp, document, context, Element, descendants };
}

export const findButton = (root, text) => descendants(root).find(node => node.tagName === "button" && node.textContent === text);
export const control = (root, name) => descendants(root).find(node => node.name === name);
export const click = node => node.events.click({ target: node, preventDefault() {} });
