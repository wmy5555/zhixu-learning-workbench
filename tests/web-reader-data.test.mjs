import test from 'node:test';
import assert from 'node:assert/strict';
import { createReaderData, sameReaderData } from '../public/web/reader-data.mjs';

const source = { id: 'A', kind: 'source', title: '原文', body: '公开原文', meta: {} };
const child = (id, meta) => ({ id, kind: 'knowledge', title: id, body: '已公开正文', meta });
const input = { id: source.id, role: 'input' };

test('source previews use only visible bound children and yield to the ordered server detail', async () => {
  const manual = child('manual', { sources: [input, input] }), legacy = child('legacy', { processKey: 'A:hash:2' });
  const hidden = child('hidden', { sources: [input], excerptOnly: true }), sibling = child('batch-sibling', {});
  const missingMeta = child('unbound');
  const boot = { notes: [source, legacy, hidden, manual, missingMeta, sibling] };
  const detail = { ...source, children: [sibling, legacy, manual] };
  const urls = [], context = { version: 1, revision: 0 };
  const reader = createReaderData({ getContext: () => context, get: async url => {
    urls.push(url);
    return url === '/api/relations' ? { relations: [] } : detail;
  } });
  const preview = reader.peek(source.id, boot);
  assert.deepEqual(preview.note.children, [manual, legacy]);
  assert.equal(reader.peek(source.id, boot), preview);
  assert.deepEqual(urls, []);
  const fetched = await reader.load(source.id, boot);
  assert.deepEqual(urls, ['/api/notes/A', '/api/relations']);
  assert.equal(fetched.note, detail);
  assert.equal(sameReaderData(preview, fetched), false);
  assert.equal(reader.peek(source.id, boot), fetched);
  context.revision++;
  assert.deepEqual(reader.peek(source.id, boot).note.children, [manual, legacy]);
});

test('a malformed unrelated source key preserves the preview and old detail cannot refill another space', async () => {
  const response = Promise.withResolvers(), context = { version: 0, revision: 0 };
  const old = { notes: [source, child('damaged', { processKey: 7 })] };
  const next = { notes: [{ ...source, title: '另一资料库' }] };
  const reader = createReaderData({ getContext: () => context,
    get: url => url === '/api/relations' ? Promise.resolve({ relations: [] }) : response.promise });
  assert.deepEqual(reader.peek(source.id, old).note.children, []);
  const loading = reader.load(source.id, old);
  context.version++;
  const current = reader.peek(source.id, next);
  response.resolve({ ...source, children: [] });
  await loading;
  assert.equal(reader.peek(source.id, next), current);
  assert.equal(current.note.title, '另一资料库');
});
