import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../public/ui.mjs', import.meta.url), 'utf8');
function browser() {
  let document;
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.events = {}; this.attributes = {}; this.disabled = false; this.value = ''; this.style = {}; }
    showModal() { this.open = true; }
    close() { this.open = false; this.events.close?.(); }
    get tabIndex() { return Number(this.attributes.tabindex ?? -1); }
    set tabIndex(value) { this.attributes.tabindex = String(value); }
    append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
    addEventListener(name, handler) { this.events[name] = handler; }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name] ?? null; }
    get isConnected() { return this === document.body || Boolean(this.parentElement?.isConnected); }
    getClientRects() { return this.isConnected ? [{}] : []; }
    focus() { document.activeElement = this; }
    remove() { this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null; }
    querySelectorAll(selector) { return this.children.flatMap(node => [node, ...node.querySelectorAll(selector)]).filter(node => selector.split(', ').some(part => part === node.tagName || part === '[tabindex]' && node.getAttribute('tabindex') !== null)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  document = { createElement: tag => new Element(tag), createTextNode: text => Object.assign(new Element('text'), { textContent: text }), body: new Element('body'), activeElement: null };
  const launcher = document.createElement('button'); document.body.append(launcher); launcher.focus();
  const context = vm.createContext({ document, Node: Element });
  vm.runInContext(source.replaceAll('export ', '') + '\nthis.actions = { confirmAction, promptAction, showReadingDialog };', context);
  const key = (dialog, value, shiftKey = false) => {
    const event = { key: value, shiftKey, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    dialog.events.keydown(event); return event;
  };
  return { document, launcher, ...context.actions, key, dialog: () => document.body.children.at(-1).children[0] };
}

test('confirmation traps both Tab boundaries and Escape cancels without closing its underlying drawer', async () => {
  const ui = browser();
  const result = ui.confirmAction({ title: '练习操作', message: '只修改练习记录' });
  const dialog = ui.dialog(), controls = dialog.querySelectorAll('button');
  assert.equal(ui.document.activeElement, controls[0], 'cancel receives initial focus');
  assert.equal(ui.key(dialog, 'Tab', true).prevented, true);
  assert.equal(ui.document.activeElement, controls[1]);
  assert.equal(ui.key(dialog, 'Tab').prevented, true);
  assert.equal(ui.document.activeElement, controls[0]);
  const escape = ui.key(dialog, 'Escape');
  assert.equal(escape.prevented, true);
  assert.equal(escape.stopped, true, 'Escape cannot reach the drawer listener');
  assert.equal(await result, false);
  assert.equal(ui.document.activeElement, ui.launcher);
});

test('text prompt keeps keyboard focus inside and Escape preserves cancellation semantics', async () => {
  const ui = browser();
  const result = ui.promptAction({ title: '调整理由', initialValue: '保留这段输入' });
  const dialog = ui.dialog(), input = dialog.querySelector('textarea'), controls = dialog.querySelectorAll('button');
  assert.equal(ui.document.activeElement, input);
  controls[1].disabled = true;
  ui.key(dialog, 'Tab', true);
  assert.equal(ui.document.activeElement, controls[0], 'disabled submit is excluded');
  ui.key(dialog, 'Tab');
  assert.equal(ui.document.activeElement, input);
  assert.equal(ui.key(dialog, 'Escape').stopped, true);
  assert.equal(await result, null);
  assert.equal(ui.document.activeElement, ui.launcher);
});

test('fullscreen reading restores focus and scrolling on Escape and repeated open/close', () => {
  const ui = browser();
  ui.document.body.style.overflow = 'auto';
  const content = ui.document.createElement('div');
  content.textContent = '完整原始资料';
  const dialog = ui.showReadingDialog({ title: '合成资料', content });
  assert.equal(dialog.open, true);
  assert.equal(ui.document.body.style.overflow, 'hidden');
  assert.equal(content.parentElement.parentElement, dialog);
  const exit = dialog.querySelector('button');
  assert.equal(ui.document.activeElement, exit);
  const region = dialog.querySelector('[tabindex]');
  assert.equal(ui.key(dialog, 'Tab', true).prevented, true);
  assert.equal(ui.document.activeElement, region);
  assert.equal(ui.key(dialog, 'Tab').prevented, true);
  assert.equal(ui.document.activeElement, exit);
  const escape = ui.key(dialog, 'Escape');
  assert.equal(escape.stopped, true, 'the underlying drawer must remain open');
  assert.equal(dialog.isConnected, false);
  assert.equal(ui.document.body.style.overflow, 'auto');
  assert.equal(ui.document.activeElement, ui.launcher);
  const next = ui.showReadingDialog({ title: '再次阅读', content });
  next.querySelector('button').events.click();
  assert.equal(next.isConnected, false);
  assert.equal(ui.document.activeElement, ui.launcher);
  assert.equal(ui.document.body.style.overflow, 'auto');
});
