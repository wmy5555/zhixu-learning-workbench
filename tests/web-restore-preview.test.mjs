import test from 'node:test';
import assert from 'node:assert/strict';
import { createRestoreSelection } from '../public/restore-selection.mjs';
import { createManagement } from '../public/web/management.mjs';

test('restore confirmation stays bound to the visible file, space and preview throughout delayed requests', async t => {
  const context = { practiceId: '', version: 0 }, calls = [], gates = [];
  const picker = { files: [], isConnected: true }, form = { elements: { backup: picker }, isConnected: true };
  const host = { html: '', set innerHTML(value) {
    this.html = value;
    this.button = value.includes('restore-confirm') ? { setAttribute() {}, removeAttribute() {} } : null;
  }, querySelector() { return this.button; } };
  let dialogButtons, submit, refreshes = 0;
  const document = { querySelector: key => key === '#restore-form' ? form : host, body: { append() {} },
    createElement() {
      const listeners = {}, buttons = {};
      dialogButtons = buttons;
      return { setAttribute() {}, addEventListener: (type, handler) => { listeners[type] = handler; },
        querySelector: key => buttons[key] ??= { addEventListener() {} }, showModal() {}, remove() {}, close: () => listeners.close() };
    } };
  for (const [name, value] of Object.entries({ document, matchMedia: () => ({ matches: true }) })) {
    const before = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true });
    t.after(() => { if (before) Object.defineProperty(globalThis, name, before); else delete globalThis[name]; });
  }
  const api = { getContext: () => context, url: path => path, post(path, body) {
    assert.equal(path, '/api/restore');
    calls.push(body);
    const gate = Promise.withResolvers(); gates.push(gate); return gate.promise;
  } };
  const page = await createManagement({ api, submit(_form, save) { submit = save; }, refreshBoot: async () => { refreshes++; } }).page('restore');
  page.bind();
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const select = (name, reading = async () => JSON.stringify({ name })) => {
    picker.files = [{ name, size: 10, text: reading }]; picker.onchange();
  };
  const preview = async name => {
    select(name); const request = submit(); await tick();
    gates.at(-1).resolve({ token: 'token-' + name }); await request;
  };
  const apply = () => host.button.onclick({ currentTarget: host.button });
  const accept = () => dialogButtons['[data-confirm]'].onclick();

  const reading = Promise.withResolvers();
  select('A', () => reading.promise); const outdated = submit(); select('B');
  reading.resolve('{"name":"A"}'); await outdated; assert.equal(calls.length, 0);
  const delayed = submit(); await tick(); const oldGate = gates.at(-1);
  await preview('C'); const button = host.button;
  oldGate.resolve({ token: 'token-B' }); await delayed; assert.equal(host.button, button);

  let confirming = apply(); select('D'); accept(); await confirming;
  await preview('D'); confirming = apply(); form.isConnected = picker.isConnected = false; accept(); await confirming;
  form.isConnected = picker.isConnected = true;
  assert.equal(calls.filter(call => !call.preview).length, 0);

  await preview('E'); const restoring = apply(); accept(); await tick();
  const restoreGate = gates.at(-1);
  await preview('F'); const fresh = host.button;
  restoreGate.resolve({ ok: true }); await restoring;
  assert.equal(host.button, fresh); assert.equal(refreshes, 1);
  assert.deepEqual(calls.filter(call => !call.preview), [{ backup: { name: 'E' }, preview: false, token: 'token-E' }]);

  confirming = apply(); context.practiceId = 'another'; context.version++;
  accept(); await confirming;
  assert.equal(calls.filter(call => !call.preview).length, 1);
});

test('an absent file or token cannot authorize restore, and a new preview retires the prior confirmation', () => {
  const scope = { practiceId: '', version: 0 }, picker = { files: [], isConnected: true };
  const selection = createRestoreSelection({ getContext: () => scope }, picker);
  assert.equal(selection.begin(), null);
  const file = { name: 'same.json' }, backup = { name: 'A' };
  picker.files = [file];
  const first = selection.begin();
  assert.equal(first.confirmation(backup, ''), null);
  const confirm = first.confirmation(backup, 'a');
  assert.deepEqual(confirm(), { backup, preview: false, token: 'a' });
  const retry = selection.begin();
  assert.equal(confirm(), null);
  const next = retry.confirmation(backup, 'b');
  selection.clear();
  assert.equal(next(), null);
});
