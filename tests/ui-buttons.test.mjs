import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../public/ui.mjs', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

function makeButton(label, options) {
  const context = vm.createContext({ document: {
    createElement: () => ({
      type: '', disabled: false, title: '', events: {},
      addEventListener(name, handler) { this.events[name] = handler; },
      append() {},
    }),
  } });
  vm.runInContext(source.replaceAll('export ', '') + '\nthis.makeButton = button;', context);
  return context.makeButton(label, options);
}

test('compact buttons retain an existing theme variant and compact sizing', () => {
  for (const variant of ['primary', 'quiet', 'text', 'danger']) {
    const node = makeButton('操作', { kind: `${variant} compact` });
    const classes = node.className.split(/\s+/);
    assert.ok(classes.includes(`${variant}-button`));
    assert.ok(classes.includes('compact'));
    for (const token of classes) assert.ok(css.includes(`.${token}`), `No stylesheet rule for ${token}`);
  }
});

test('button styling preserves default, disabled state, and click handler', () => {
  let clicks = 0;
  const node = makeButton('编辑', { onClick: () => clicks++, disabled: true, title: '编辑内容' });
  assert.equal(node.className, 'quiet-button');
  assert.equal(node.textContent, '编辑');
  assert.equal(node.type, 'button');
  assert.equal(node.disabled, true);
  assert.equal(node.title, '编辑内容');
  node.events.click();
  assert.equal(clicks, 1);
});
