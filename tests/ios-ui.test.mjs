import test from 'node:test';
import assert from 'node:assert/strict';
import { createIOSBrowser } from './fixtures/ios-browser.mjs';
import { createIOSClient } from '../apps/ios/web/ios-client.mjs';
import { createPreviewPlugin } from '../scripts/fixtures/ios-preview-native.mjs';

const button = (root, browser, text) => browser.descendants(root).find(node => node.tagName === 'button' && node.textContent === text);
const control = (root, browser, name) => browser.descendants(root).find(node => node.name === name);
test('iOS capture protects unsaved draft on cancelled navigation, failed save and beforeunload', async () => {
  const { plugin, controls } = createPreviewPlugin(), browser = await createIOSBrowser(createIOSClient(plugin), { confirmations: [false] });
  await browser.navigate('capture'); const main = browser.roots.get('#main');
  control(main, browser, 'body').value = '合成未保存原文'; control(main, browser, 'date').value = '2024年春';
  await browser.navigate('library'); assert.equal(control(main, browser, 'body').value, '合成未保存原文');
  assert.equal(browser.prompts.length, 1);
  const event = { preventDefault() { this.prevented = true; } }; browser.windowEvents.beforeunload(event);
  assert.equal(event.prevented, true); assert.equal(event.returnValue, 'unsaved');
  const form = browser.descendants(main).find(node => node.tagName === 'form');
  controls.failNextSave = true; form.events.submit({ preventDefault() {} }); await browser.flush();
  assert.equal(control(main, browser, 'body').value, '合成未保存原文');
  form.events.submit({ preventDefault() {} }); form.events.submit({ preventDefault() {} }); await browser.flush();
  assert.equal(controls.calls.filter(value => Array.isArray(value)).length, 2); // one failed attempt, one successful; duplicate click suppressed
  assert.equal(control(main, browser, 'body').value, '');
  assert.equal((await plugin.list()).notes.find(note => note.body === '合成未保存原文').meta.date, '2024年春');
});
test('iOS restore acknowledgement depends on a preview and resets on success, cancellation and expired token', async () => {
  const { plugin } = createPreviewPlugin(), browser = await createIOSBrowser(createIOSClient(plugin));
  await browser.navigate('system'); const main = browser.roots.get('#main');
  const apply = button(main, browser, '确认恢复，保留冲突'), select = button(main, browser, '模拟预览合成备份');
  const checkbox = browser.descendants(main).find(node => node.type === 'checkbox');
  assert.equal(checkbox.disabled, true); assert.equal(apply.disabled, true);
  await browser.click(select); assert.equal(checkbox.disabled, false); assert.equal(apply.disabled, true);
  checkbox.checked = true; checkbox.events.change(); assert.equal(apply.disabled, false);
  await browser.click(apply); assert.equal(checkbox.checked, false); assert.equal(checkbox.disabled, true); assert.equal(apply.disabled, true);
  await browser.click(select); assert.equal(checkbox.checked, false); assert.equal(apply.disabled, true);
  checkbox.checked = true; checkbox.events.change();
  plugin.restoreBackup = async () => { throw Object.assign(new Error('合成过期预览'), { code: 'PREVIEW_EXPIRED' }); };
  await browser.click(apply); assert.equal(checkbox.checked, false); assert.equal(checkbox.disabled, true); assert.equal(apply.disabled, true);
  plugin.previewBackup = async () => { throw Object.assign(new Error('合成取消'), { code: 'CANCELLED' }); };
  await browser.click(select); assert.equal(checkbox.checked, false); assert.equal(checkbox.disabled, true); assert.equal(apply.disabled, true);
});
