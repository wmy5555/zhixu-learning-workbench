import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { atomicWrite } from '../src/store.mjs';

const tempRoot = path.resolve('.tmp');
fs.mkdirSync(tempRoot, { recursive: true });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(tempRoot, 'atomic-write-'));
  t.after(() => { assert.ok(root.startsWith(tempRoot + path.sep)); fs.rmSync(root, { recursive: true, force: true }); });
  const file = path.join(root, 'state.json');
  fs.writeFileSync(file, 'previous valid data');
  return { root, file };
}

test('atomic writes retry transient locks using one temporary file while retaining the previous data', t => {
  const { root, file } = fixture(t), rename = fs.renameSync;
  const sources = [], codes = ['EPERM', 'EACCES', 'EBUSY'];
  t.mock.method(fs, 'renameSync', (source, destination) => {
    sources.push(source);
    assert.equal(destination, file);
    assert.equal(fs.readFileSync(file, 'utf8'), 'previous valid data');
    assert.equal(fs.readFileSync(source, 'utf8'), 'new valid data');
    if (sources.length <= codes.length) throw Object.assign(new Error('Controlled temporary file lock'), { code: codes[sources.length - 1] });
    return rename(source, destination);
  });
  atomicWrite(file, 'new valid data');
  assert.equal(sources.length, 4);
  assert.equal(new Set(sources).size, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), 'new valid data');
  assert.deepEqual(fs.readdirSync(root), ['state.json']);
});

test('a persistent lock stops after bounded retries without replacing the previous file or leaving a temporary file', t => {
  const { root, file } = fixture(t);
  let attempts = 0;
  const blocked = Object.assign(new Error('Controlled persistent file lock'), { code: 'EPERM' });
  t.mock.method(fs, 'renameSync', () => { attempts++; throw blocked; });
  assert.throws(() => atomicWrite(file, 'must not replace old data'), error => error === blocked);
  assert.equal(attempts, 4);
  assert.equal(fs.readFileSync(file, 'utf8'), 'previous valid data');
  assert.deepEqual(fs.readdirSync(root), ['state.json']);
});

test('non-lock filesystem errors fail immediately and retain the previous file', t => {
  const { root, file } = fixture(t);
  let attempts = 0;
  const failed = Object.assign(new Error('Controlled filesystem error'), { code: 'ENOSPC' });
  t.mock.method(fs, 'renameSync', () => { attempts++; throw failed; });
  assert.throws(() => atomicWrite(file, 'new data'), error => error === failed);
  assert.equal(attempts, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), 'previous valid data');
  assert.deepEqual(fs.readdirSync(root), ['state.json']);
});
