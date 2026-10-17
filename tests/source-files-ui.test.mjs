import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileAccept, pickerFileType } from '../public/source-files.mjs';
import { MAX_FILE_BYTES } from '../public/source-file-limits.mjs';

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

test('invalid files keep a short reason and separate help for the actual picker formats', async () => {
  const options = [], help = [], removed = [];
  let observe;
  const vendor = { default: {}, registerPlugin() {}, create(_input, value) { options.push(value); return {
    element: { isConnected: true, after(node) { help.push(node); } }, destroy() { removed.push('picker'); },
  }; } };
  const context = vm.createContext({ vendor, MAX_FILE_BYTES, document: { body: {} },
    MutationObserver: class { constructor(callback) { observe = callback; } observe() {} disconnect() {} },
    crypto: { randomUUID: () => 'test-upload-id' },
    el(_tag, props) { return { ...props, after() {}, remove() { removed.push(props.class); }, set innerHTML(_) { assert.fail('help must be plain text'); } }; },
  });
  const source = fs.readFileSync(new URL('../public/source-files.mjs', import.meta.url), 'utf8')
    .replace(/^import .*;\s*$/gm, '').replaceAll('export ', '')
    .replace(/import\('\/vendor\/[^']+'\)/g, 'Promise.resolve(vendor)');
  const createPicker = vm.runInContext(source + '\ncreateFilePicker;', context);
  await createPicker({});
  const imagePicker = await createPicker({}, { imagesOnly: true });
  assert.equal(options[0].labelFileTypeNotAllowed, '不支持此文件格式');
  assert.equal(options[0].fileValidateTypeLabelExpectedTypes, '请按下方支持格式重新选择');
  assert.equal(options[0].labelButtonRemoveItem, '移除此文件');
  assert.deepEqual(Array.from(options[0].acceptedFileTypes), [...new Set(Object.values(fileAccept))]);
  assert.match(help[0].text, /PNG 图片（\.png）.*JPEG 图片（\.jpg \/ \.jpeg）.*PDF 文档（\.pdf）.*Word 文档（\.doc）.*Word 文档（\.docx）/);
  assert.doesNotMatch(help[0].text, /text\/plain|SVG|TXT|image\//);
  assert.match(help[1].text, /PNG.*JPEG.*GIF.*WebP/);
  assert.doesNotMatch(help[1].text, /PDF|Word|\.doc|\.pdf/);
  assert.ok(Array.from(options[1].acceptedFileTypes).every(type => type.startsWith('image/')));
  imagePicker.element.isConnected = false; observe();
  assert.deepEqual(removed, ['picker', 'file-picker-formats', 'notice']);
});

test('picker shows server rejection as plain text and preserves other queue errors on retry', async () => {
  let options, status;
  const uploads = [], failures = [];
  const instance = { element: { isConnected: true, after() {} } };
  const vendor = { default: {}, registerPlugin() {}, create(_input, value) { options = value; return instance; } };
  const context = vm.createContext({ vendor, MAX_FILE_BYTES, document: { body: {} }, MutationObserver: class { observe() {} },
    crypto: { randomUUID: () => 'test-upload-id' },
    el(_tag, value) { return { ...value, textContent: '', after(node) { status = node; }, set innerHTML(_value) { assert.fail('upload errors must be text'); } }; },
    uploadAttachment(file, callbacks) { uploads.push({ file, ...callbacks }); return { abort() {} }; },
  });
  const source = fs.readFileSync(new URL('../public/source-files.mjs', import.meta.url), 'utf8')
    .replace(/^import .*;\s*$/gm, '').replaceAll('export ', '')
    .replace(/import\('\/vendor\/[^']+'\)/g, 'Promise.resolve(vendor)');
  const createPicker = vm.runInContext(source + '\ncreateFilePicker;', context);
  await createPicker({});
  assert.equal(options.maxFileSize, 50_000_000);
  assert.match(options.labelMaxFileSize, /50 MB/);
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

function imageFixture() {
  let value = '可视化中尚未同步到隐藏框的原文', picker, note = { id: 'real-note', meta: {} };
  const uploads = [], requests = [], ids = [];
  const node = (tag, props = {}, children = []) => ({ tag, ...props, children: [...children],
    append(...nodes) { this.children.push(...nodes); }, remove() { this.removed = true; } });
  const body = { value: '过时的隐藏正文', dispatchEvent() {}, setRangeText() { assert.fail('rich text cannot use a hidden selection'); },
    markdownEditor: { getMode: () => 'rich', getValue: () => value, setValue: next => { value = next; } } };
  const context = vm.createContext({ MAX_FILE_BYTES, Event, crypto: { randomUUID: () => 'synthetic-upload' },
    el: node, field: () => node('field'), button: (text, options) => node('button', { text, click: options.onClick }),
    request: async (...args) => { requests.push(args); return {}; },
    uploadAttachment: (_file, callbacks) => { uploads.push(callbacks); return {}; },
    attachmentUrl: (noteId, assetId) => '/api/notes/' + noteId + '/attachments?asset=' + assetId,
    capturePicker: options => { picker = options; },
  });
  const source = fs.readFileSync(new URL('../public/source-files.mjs', import.meta.url), 'utf8').replace(/^import .*;\s*$/gm, '').replaceAll('export ', '');
  const controls = vm.runInContext(source + '\ncreateFilePicker = async (_input, options) => { capturePicker(options); return {}; };\nimageInsertControls;', context)(body, ids, { getNote: () => note });
  return { controls, ids, uploads, requests, get picker() { return picker; }, get value() { return value; },
    set value(next) { value = next; }, set note(next) { note = next; } };
}
const imageReceipt = (id = 'upload-a', byte = 'a') => ({ id, noteId: 'unbound-preallocated-note', attachment: { id: byte.repeat(64) + '.png', name: '合成.png', kind: 'image' } });

test('image controls read the current rich draft and undo only their still-identical insertion', async () => {
  const f = imageFixture(), receipt = imageReceipt();
  f.value += '\n![' + receipt.attachment.name + '](../.zhixu-attachments/' + receipt.attachment.id + ')\n';
  const initial = f.value;
  await f.controls.children[0].click();
  f.picker.onUploaded(receipt);
  assert.match(f.value, /可视化中尚未同步/);
  assert.ok(f.value.includes('../.zhixu-attachments/' + receipt.attachment.id));
  assert.deepEqual(f.ids, [receipt.id]);
  f.picker.onRemoved(receipt.id);
  assert.equal(f.value, initial);
  f.picker.onUploaded(receipt);
  f.value += '\n用户继续编辑';
  const edited = f.value;
  f.picker.onRemoved(receipt.id);
  assert.equal(f.value, edited, 'later edits and matching existing references cannot be replaced globally');
  assert.equal(f.ids.length, 0);
  assert.match(f.controls.children[2].textContent, /未自动改写/);
});

test('rich upload bridges staging UUIDs to stable Markdown and displays only real bound note assets', async () => {
  const f = imageFixture(), receipt = imageReceipt();
  const promise = f.controls.editorOptions.uploadImage({ name: '合成.png', type: 'image/png' });
  f.uploads[0].load(receipt.id, receipt);
  const asset = await promise;
  assert.equal(asset.attachmentId, receipt.attachment.id);
  assert.equal(asset.markdownUrl, '../.zhixu-attachments/' + receipt.attachment.id);
  assert.deepEqual(f.ids, [receipt.id]);
  assert.equal(f.controls.editorOptions.assetResolver(asset.markdownUrl), '', 'a preallocated note id does not prove binding');
  const before = f.value;
  f.value += '\n![合成](' + asset.markdownUrl + ')\n';
  asset.onInserted({ before, after: f.value });
  await f.controls.children[3].children[0].click();
  assert.equal(f.value, before);
  assert.equal(f.ids.length, 0);
  assert.match(f.requests[0][0], /\/api\/uploads\/upload-a$/);
  f.note = { id: 'real-saved-note', meta: { attachments: [receipt.attachment] } };
  assert.equal(f.controls.editorOptions.assetResolver(asset.markdownUrl), '/api/notes/real-saved-note/attachments?asset=' + receipt.attachment.id);
  assert.equal(f.controls.editorOptions.assetResolver('blob:temporary'), '');
});
