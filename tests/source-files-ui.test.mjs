import assert from 'node:assert/strict';
import test from 'node:test';
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
