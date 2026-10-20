import test from 'node:test';
import assert from 'node:assert/strict';
import { noteEditSession } from '../public/web/note-editor.mjs';

test('both editor modes save exact drafts with the current hash for every note kind', async () => {
  for (const kind of ['source', 'knowledge', 'proposal', 'mistake']) {
    const draft = { title: '合成标题', body: '# 原文\r\n\r\n- 保留字节  \r\n' }, writes = [];
    const session = noteEditSession({ id: 'synthetic', hash: 'v1', kind }, {
      read: () => ({ ...draft }), write: async (id, payload) => { writes.push({ id, ...payload }); return { hash: 'v2' }; },
    });
    assert.equal((await session.save()).hasNewInput, false);
    assert.deepEqual(writes[0], { id: 'synthetic', ...draft, expectedHash: 'v1' });
    draft.body += '\n可视化修改'; await session.save();
    assert.equal(writes[1].expectedHash, 'v2');
    assert.equal(writes[1].body, draft.body);
  }
});

test('conflicts retain the draft and original hash instead of overwriting newer content', async () => {
  const draft = { title: '本地草稿', body: '**仍在编辑**' }, writes = [];
  const session = noteEditSession({ id: 'synthetic', hash: 'old' }, {
    read: () => ({ ...draft }), write: async (id, payload) => { writes.push(payload); throw new Error('CONFLICT'); },
  });
  await assert.rejects(session.save(), /CONFLICT/);
  await assert.rejects(session.save(), /CONFLICT/);
  assert.equal(writes[1].expectedHash, 'old');
  assert.equal(draft.body, '**仍在编辑**');
});

test('typing during save stays in the editor and the next save uses the returned hash', async () => {
  let finish;
  const draft = { title: '标题', body: '本次快照' }, writes = [];
  const session = noteEditSession({ id: 'synthetic', hash: 'v1' }, {
    read: () => ({ ...draft }), write: async (id, payload) => { writes.push(payload); if (writes.length === 1) return new Promise(resolve => { finish = resolve; }); return { hash: 'v3' }; },
  });
  const saving = session.save(); draft.body += '，保存期间继续输入'; draft.title = '新标题'; finish({ hash: 'v2' });
  assert.equal((await saving).hasNewInput, true);
  assert.equal(writes[0].body, '本次快照');
  assert.equal((await session.save()).hasNewInput, false);
  assert.deepEqual(writes[1], { ...draft, expectedHash: 'v2' });
});

test('empty rich text is rejected even while its required textarea is hidden', async () => {
  let writes = 0;
  const session = noteEditSession({ id: 'synthetic', hash: 'v1' }, {
    read: () => ({ title: '标题', body: ' \n ' }), write: async () => { writes++; },
  });
  await assert.rejects(session.save(), /正文/);
  assert.equal(writes, 0);
});
