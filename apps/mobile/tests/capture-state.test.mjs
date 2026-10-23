import test from 'node:test';
import assert from 'node:assert/strict';
import { afterTextSave } from '../src/services/capture-state.mjs';

test('successful text capture retains the unsaved original receipt', () => {
  const before = { title: '合成标题', body: '合成原文', metadata: { author: '合成作者' }, pendingFile: { uploadId: 'pending-original' } };
  const { draft, changed } = afterTextSave(before, before);
  assert.equal(changed, false);
  assert.equal(draft.body, '');
  assert.equal(draft.title, '');
  assert.deepEqual(draft.pendingFile, before.pendingFile);
  assert.deepEqual(draft.metadata, before.metadata);
});
test('a queued save cannot erase newer text or source metadata', () => {
  const before = { title: '提交版本', body: '原文', metadata: {}, pendingFile: null };
  for (const next of [{ ...before, body: '继续输入' }, { ...before, title: '更正标题' }, { ...before, metadata: { author: '补充作者' } }]) {
    const result = afterTextSave(before, next);
    assert.equal(result.changed, true);
    assert.deepEqual(result.draft, next);
  }
});
