import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const themeSource = await readFile(path.resolve(import.meta.dirname, '../public/theme.js'), 'utf8');

function browser({ values = new Map(), dark = false, failWrites = false } = {}) {
  const windowListeners = new Map();
  const documentListeners = new Map();
  const mediaListeners = new Map();
  const properties = new Map();
  const root = {
    dataset: {},
    style: { setProperty(name, value) { properties.set(name, value); } },
  };
  const storage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      if (failWrites) throw new Error('storage unavailable');
      values.set(key, String(value));
    },
    removeItem(key) {
      if (failWrites) throw new Error('storage unavailable');
      values.delete(key);
    },
  };
  const window = {
    addEventListener(type, listener) { windowListeners.set(type, listener); },
  };
  const document = {
    documentElement: root,
    getElementById() { return null; },
    addEventListener(type, listener) { documentListeners.set(type, listener); },
  };
  const media = {
    matches: dark,
    addEventListener(type, listener) { mediaListeners.set(type, listener); },
  };
  const context = vm.createContext({
    document,
    localStorage: storage,
    matchMedia(query) {
      assert.equal(query, '(prefers-color-scheme: dark)');
      return media;
    },
    window,
  });
  vm.runInContext(themeSource, context, { filename: 'public/theme.js' });
  return { api: window.zhixuAppearance, properties, root, values, windowListeners };
}

function rgb(hex) {
  return [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16));
}

function luminance(hex) {
  return rgb(hex)
    .map(value => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrast(first, second) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

test('custom accents persist, reload, reset, and reject malformed values', () => {
  const values = new Map();
  const first = browser({ values });
  assert.equal(first.api.getAccent(), null);
  first.api.saveAccent('#12ABef');
  assert.equal(first.api.getAccent(), '#12abef');
  assert.equal(values.get('zhixu-accent'), '#12abef');

  const reloaded = browser({ values });
  assert.equal(reloaded.api.getAccent(), '#12abef');
  assert.throws(() => reloaded.api.saveAccent('12abef'), /六位颜色代码/);
  assert.equal(reloaded.api.getAccent(), '#12abef');
  assert.equal(values.get('zhixu-accent'), '#12abef');

  reloaded.api.saveAccent(null);
  assert.equal(reloaded.api.getAccent(), null);
  assert.equal(values.has('zhixu-accent'), false);
});

test('malformed persisted accents are ignored', () => {
  const page = browser({ values: new Map([['zhixu-accent', '#abcd']]) });
  assert.equal(page.api.getAccent(), null);
  assert.equal(page.properties.get('--accent'), '#184a52');
});

test('storage failures are reported without claiming the accent was saved', () => {
  const page = browser({ failWrites: true });
  const before = page.properties.get('--accent');
  assert.throws(() => page.api.saveAccent('#336699'), /storage unavailable/);
  assert.equal(page.api.getAccent(), null);
  assert.equal(page.properties.get('--accent'), before);
  assert.throws(() => page.api.saveAccent(null), /storage unavailable/);
  assert.equal(page.api.getAccent(), null);
});

test('storage events re-read theme and accent preferences from storage', () => {
  const values = new Map();
  const page = browser({ values });
  values.set('zhixu-theme', 'dark');
  values.set('zhixu-accent', '#ffcc00');
  page.windowListeners.get('storage')({ key: 'zhixu-accent' });
  assert.equal(page.root.dataset.theme, 'dark');
  assert.equal(page.api.getAccent(), '#ffcc00');
  assert.equal(page.properties.get('--accent'), page.api.palette('#ffcc00', 'dark')['--accent']);

  values.set('zhixu-accent', 'invalid');
  page.windowListeners.get('storage')({ key: null });
  assert.equal(page.api.getAccent(), null);
  assert.equal(page.properties.get('--accent'), '#a8b4ef');
});

test('default and custom palettes retain readable UI contrast', () => {
  const { api } = browser();
  assert.equal(api.palette(null, 'light')['--accent'], '#184a52');
  assert.equal(api.palette(null, 'dark')['--accent'], '#a8b4ef');

  const seeds = [
    null, '#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff',
    '#a8b4ef', '#184a52', '#ffcc00', '#12abef', '#7f00ff', '#808080',
  ];
  for (const theme of ['light', 'dark']) {
    const surface = theme === 'dark' ? '#2a2d32' : '#fbfaf6';
    for (const seed of seeds) {
      const palette = api.palette(seed, theme);
      const description = `${theme} palette for ${seed ?? 'default'}`;
      assert.ok(contrast(palette['--accent'], surface) >= 3, `${description}: main on surface`);
      assert.ok(contrast(palette['--accent-ink'], palette['--accent']) >= 4.5, `${description}: label on main`);
      assert.ok(contrast(palette['--accent-ink'], palette['--accent-hover']) >= 4.5, `${description}: label on hover`);
      assert.ok(contrast(palette['--accent-2'], surface) >= 4.5, `${description}: link on surface`);
      assert.ok(contrast(palette['--accent-2'], palette['--accent-soft']) >= 4.5, `${description}: link on soft`);
    }
  }
});
