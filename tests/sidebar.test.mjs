import assert from 'node:assert/strict';
import test from 'node:test';
import { initSidebar } from '../public/sidebar.mjs';

function setup({ narrow = false, values = new Map(), unavailable = false } = {}) {
  const document = { activeElement: null, listeners: {}, addEventListener(t, fn) { this.listeners[t] = fn; } };
  function node() {
    const classes = new Set();
    return {
      attrs: {}, listeners: {}, inert: false,
      classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) },
      setAttribute(name, value) { this.attrs[name] = value; },
      addEventListener(t, fn) { this.listeners[t] = fn; },
      focus() { document.activeElement = this; },
      contains(other) { return other === this || other === nodes['#sidebar-collapse']; },
    };
  }
  const nodes = Object.fromEntries(['#sidebar', '#menu-button', '#sidebar-collapse'].map(id => [id, node()]));
  document.documentElement = node();
  document.querySelector = id => nodes[id];
  const media = { matches: narrow, addEventListener(t, fn) { this.change = fn; } };
  const storage = {
    getItem(key) { if (unavailable) throw Error('blocked'); return values.get(key); },
    setItem(key, value) { if (unavailable) throw Error('blocked'); values.set(key, value); },
  };
  const api = initSidebar({ document, media, storage });
  return { ...nodes, document, media, values, api, click: id => nodes[id].listeners.click(), resize(n) { media.matches = n; media.change(); } };
}

test('desktop collapse releases navigation focus and persists across reload; expand restores it', () => {
  const b = setup();
  b.click('#sidebar-collapse');
  assert.equal(b['#sidebar'].inert, true);
  assert.equal(b['#menu-button'].attrs['aria-expanded'], 'false');
  assert.equal(b.document.activeElement, b['#menu-button']);
  const reloaded = setup({ values: b.values });
  assert.equal(reloaded['#sidebar'].attrs['aria-hidden'], 'true');
  reloaded.click('#menu-button');
  assert.equal(reloaded['#sidebar'].inert, false);
  assert.equal(reloaded.document.activeElement, reloaded['#sidebar-collapse']);
  assert.equal(setup({ values: b.values })['#sidebar'].inert, false);
});

test('mobile menu, Escape and navigation close without changing desktop preference', () => {
  const b = setup({ narrow: true });
  assert.equal(b['#sidebar'].inert, true);
  b.click('#menu-button');
  assert.equal(b['#sidebar'].classList.contains('is-open'), true);
  b.document.listeners.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(b['#sidebar'].inert, true);
  assert.equal(b.document.activeElement, b['#menu-button']);
  b.click('#menu-button');
  b.api.closeMobile();
  assert.equal(b['#menu-button'].attrs['aria-expanded'], 'false');
  assert.equal(b.values.size, 0);
  b.resize(false);
  assert.equal(b['#sidebar'].inert, false);
});

test('resizing closes mobile overlay and preserves the collapsed desktop choice', () => {
  const b = setup();
  b.click('#sidebar-collapse');
  b.resize(true);
  b.click('#menu-button');
  b.resize(false);
  assert.equal(b['#sidebar'].inert, true);
  assert.equal(b.document.activeElement, b['#menu-button']);
  b.resize(true);
  assert.equal(b['#sidebar'].classList.contains('is-open'), false);
});

test('blocked storage does not stop navigation controls', () => {
  const b = setup({ unavailable: true });
  b.click('#sidebar-collapse');
  assert.equal(b['#sidebar'].inert, true);
  b.click('#menu-button');
  assert.equal(b['#sidebar'].inert, false);
});
