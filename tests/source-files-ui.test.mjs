import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileAccept, pickerFileType } from '../public/source-files.mjs';

test('file picker accepts supported extensions when the OS reports no specific MIME', () => {
  for (const [extension, expected] of Object.entries(fileAccept)) {
    for (const detected of ['', undefined, 'application/octet-stream', 'APPLICATION/OCTET-STREAM']) {
      assert.equal(pickerFileType({ name: '公开样本.' + extension.toUpperCase() }, detected), expected);
    }
  }
});

test('file picker keeps specific MIME and rejects unsupported generic-binary formats', () => {
  assert.equal(pickerFileType({ name: '文档.docx' }, 'application/pdf'), 'application/pdf');
  for (const name of ['macro.docm', 'page.html', 'vector.svg', 'sheet.xlsx', 'no-extension']) {
    const detected = pickerFileType({ name }, 'application/octet-stream');
    assert.ok(!Object.values(fileAccept).includes(detected));
  }
});

test('picker shows server rejection as plain text and preserves other queue errors on retry', async () => {
  let options, status;
  const uploads = [], failures = [];
  const instance = { element: { isConnected: true, after(node) { status = node; } } };
  const vendor = { default: {}, registerPlugin() {}, create(_input, value) { options = value; return instance; } };
  const context = vm.createContext({ vendor, document: { body: {} }, MutationObserver: class { observe() {} },
    crypto: { randomUUID: () => 'test-upload-id' },
    el(_tag, value) { return { ...value, textContent: '', set innerHTML(_value) { assert.fail('upload errors must be text'); } }; },
    uploadAttachment(file, callbacks) { uploads.push({ file, ...callbacks }); return { abort() {} }; },
  });
  const source = fs.readFileSync(new URL('../public/source-files.mjs', import.meta.url), 'utf8')
    .replace(/^import .*;\s*$/gm, '').replaceAll('export ', '')
    .replace(/import\('\/vendor\/[^']+'\)/g, 'Promise.resolve(vendor)');
  const createPicker = vm.runInContext(source + '\ncreateFilePicker;', context);
  await createPicker({});
  const first = { name: '<img src=x onerror=alert(1)>.png' }, second = { name: '另一份.pdf' };
  const process = file => options.server.process('', file, {}, () => {}, message => failures.push(message), () => {}, () => {});
  process(first); uploads.at(-1).error('附件存储已达到容量上限（256 MiB 或 1000 个文件）。');
  process(second); uploads.at(-1).error('上传记录已达到 5000 条上限。');
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /<img src=x onerror=alert\(1\)>\.png：附件存储/);
  assert.match(status.textContent, /5000 条上限/);
  assert.equal(failures.length, 2);
  process(first);
  assert.doesNotMatch(status.textContent, /256 MiB/);
  assert.match(status.textContent, /5000 条上限/, 'retrying one file must keep the other rejection visible');
  options.onremovefile(null, { file: second });
  assert.equal(status.hidden, true);
  assert.equal(status.textContent, '');
});
