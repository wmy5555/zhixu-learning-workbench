import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createService } from '../src/service.mjs';

const projectDir = path.resolve(import.meta.dirname, '..');
const tempRoot = path.join(projectDir, '.tmp');
fs.mkdirSync(tempRoot, { recursive: true });

function privacyError(message = 'offline test guard blocked local data') {
  return Object.assign(new Error(message), { code: 'PRIVACY_LOCAL' });
}

function offlineAI(events = []) {
  const reject = capability => async input => {
    events.push({ capability, input });
    throw privacyError();
  };
  return {
    generate: reject('generate'),
    embed: reject('embed'),
    search: reject('search'),
    readPage: reject('readPage'),
    research: reject('research'),
    test: reject('test'),
  };
}

async function makeHarness(t, { aiOverride = offlineAI() } = {}) {
  const root = await mkdtemp(path.join(tempRoot, 'core-'));
  const dataDir = path.join(root, 'data');
  const vaultDir = path.join(root, 'vault');
  let service = createService({ dataDir, vaultDir, aiOverride });
  t.after(async () => {
    if (service) service.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    dataDir,
    vaultDir,
    get service() {
      return service;
    },
    close() {
      service?.close();
      service = null;
    },
    reopen() {
      service?.close();
      service = createService({ dataDir, vaultDir, aiOverride });
      return service;
    },
  };
}

function createKnowledge(service, {
  title = '测试知识',
  body = '测试正文',
  stage = 'learning',
  privacy = 'local',
  depth = 'explain',
  meta = {},
} = {}) {
  return service.store.create({
    kind: 'knowledge',
    title,
    body,
    meta: { stage, privacy, depth, ...meta },
  });
}

test('external Markdown edits are detected and reindexed before reads and search', async t => {
  const h = await makeHarness(t);
  const note = createKnowledge(h.service, { title: '外部同步', body: '旧内容不会继续命中' });
  const file = path.join(h.vaultDir, note.path);
  const raw = await readFile(file, 'utf8');
  await writeFile(file, raw.replace('旧内容不会继续命中', '外部编辑后的独有词星槎'), 'utf8');

  const current = h.service.getNote(note.id);
  assert.match(current.body, /独有词星槎/);
  assert.notEqual(current.hash, note.hash);
  assert.equal((await h.service.search('星槎')).results[0]?.id, note.id);
  assert.equal((await h.service.search('旧内容不会继续命中')).results.length, 0);
});

test('external rename keeps the frontmatter id and updates the indexed path', async t => {
  const h = await makeHarness(t);
  const note = createKnowledge(h.service, { title: '稳定身份', body: '改名不应改变身份' });
  const from = path.join(h.vaultDir, note.path);
  const to = path.join(path.dirname(from), '由 Obsidian 改名.md');
  await rename(from, to);

  const current = h.service.getNote(note.id);
  assert.equal(current.id, note.id);
  assert.equal(current.path, '02 知识/由 Obsidian 改名.md');
  assert.equal(h.service.store.list().filter(item => item.id === note.id).length, 1);
});

test('unknown YAML fields survive a Web body edit', async t => {
  const h = await makeHarness(t);
  const folder = path.join(h.vaultDir, '02 知识');
  const file = path.join(folder, 'unknown-fields.md');
  await mkdir(folder, { recursive: true });
  await writeFile(file, `---\nid: yaml-unknown-1\nkind: knowledge\ntitle: 未知字段\nstage: learning\nprivacy: local\ncustom_flag: keep-me\nnested:\n  owner: user\n  rank: 7\n---\n原正文`, 'utf8');

  const note = h.service.getNote('yaml-unknown-1');
  const updated = h.service.editNote(note.id, { body: 'Web 修改正文', expectedHash: note.hash });
  assert.equal(updated.meta.custom_flag, 'keep-me');
  assert.deepEqual(updated.meta.nested, { owner: 'user', rank: 7 });
  const saved = await readFile(file, 'utf8');
  assert.match(saved, /custom_flag: keep-me/);
  assert.match(saved, /owner: user/);
});

test('a stale Web edit is rejected after an external change and never overwrites it', async t => {
  const h = await makeHarness(t);
  const note = createKnowledge(h.service, { title: '冲突保护', body: '初始正文' });
  const file = path.join(h.vaultDir, note.path);
  const raw = await readFile(file, 'utf8');
  await writeFile(file, raw.replace('初始正文', '用户在外部刚写的正文'), 'utf8');

  assert.throws(
    () => h.service.editNote(note.id, { body: '过期 Web 副本', expectedHash: note.hash }),
    error => error.code === 'CONFLICT' && error.status === 409,
  );
  assert.match(await readFile(file, 'utf8'), /用户在外部刚写的正文/);
  assert.doesNotMatch(await readFile(file, 'utf8'), /过期 Web 副本/);
});

test('duplicate stable ids isolate every conflicting file until the duplicate is removed', async t => {
  const h = await makeHarness(t);
  const note = createKnowledge(h.service, { title: '重复身份', body: '重复身份隔离词' });
  const original = path.join(h.vaultDir, note.path);
  const duplicate = path.join(path.dirname(original), 'duplicate-copy.md');
  await writeFile(duplicate, await readFile(original, 'utf8'), 'utf8');

  const scan = h.service.store.scan();
  assert.equal(scan.conflicts.some(item => item.id === note.id), true);
  assert.equal(h.service.store.list().some(item => item.id === note.id), false);
  assert.equal((await h.service.search('重复身份隔离词')).results.length, 0);

  await rm(duplicate);
  h.service.store.scan();
  assert.equal(h.service.getNote(note.id).id, note.id);
});

test('invalid frontmatter is isolated without preventing valid notes from loading', async t => {
  const h = await makeHarness(t);
  const valid = createKnowledge(h.service, { title: '正常文件', body: '仍然可读的内容' });
  const broken = path.join(h.vaultDir, '02 知识', 'broken.md');
  await writeFile(broken, '---\nid: [unterminated\n---\n损坏内容', 'utf8');

  const scan = h.service.store.scan();
  assert.equal(scan.conflicts.some(item => item.path.endsWith('broken.md')), true);
  assert.equal(h.service.getNote(valid.id).body, '仍然可读的内容');
});

test('deletion removes both current search results and derived index chunks', async t => {
  const h = await makeHarness(t);
  const note = createKnowledge(h.service, { title: '待删除', body: '删除后不可检索的独有词玄圃' });
  assert.equal((await h.service.search('玄圃')).results[0]?.id, note.id);

  h.service.store.delete(note.id, note.hash);
  assert.equal((await h.service.search('玄圃')).results.length, 0);
  const chunks = h.service.store.db.prepare('SELECT COUNT(*) AS count FROM index_chunks WHERE noteId=?').get(note.id);
  assert.equal(chunks.count, 0);
  assert.equal(h.service.store.get('deleted', note.id).id, note.id);
});

test('source import preserves exact body and an immutable original snapshot', async t => {
  const h = await makeHarness(t);
  const body = '第一行原文\n\n第二行包含 --- 与原始标点。';
  const { notes } = h.service.importItems({
    items: [{ title: '原始快照', body, platform: '离线测试', locator: '第 2 段' }],
    process: false,
  });
  const source = notes[0];
  assert.equal(source.body, body);
  const history = h.service.store.history(source.id);
  assert.equal(history.some(version => version.reason === '原始输入快照'), true);
  assert.equal(history.some(version => version.raw.endsWith(body)), true);
});

test('repeat import deduplicates content while retaining both source origins', async t => {
  const h = await makeHarness(t);
  const first = h.service.importItems({ items: [{ body: '完全相同的原始资料', platform: '平台甲' }] }).notes[0];
  const second = h.service.importItems({ items: [{ body: '完全相同的原始资料', platform: '平台乙' }] }).notes[0];
  assert.equal(second.id, first.id);
  assert.deepEqual(second.meta.origins.map(origin => origin.platform), ['平台甲', '平台乙']);
  assert.equal(h.service.listNotes({ kind: 'source' }).length, 1);
});

test('backup and restore retain sessions and history while excluding API secrets', async t => {
  const source = await makeHarness(t);
  const secretValue = 'core-test-secret-must-not-appear';
  source.service.updateSettings({ ai: { apiKey: secretValue } });
  let note = createKnowledge(source.service, { title: '备份知识', body: '版本一' });
  note = source.service.editNote(note.id, { body: '版本二', expectedHash: note.hash });
  const session = source.service.startStudy({ noteId: note.id });
  source.service.answerStudy(session.id, { answer: '我的离线回答', requestId: 'backup-answer-1' });
  const backup = source.service.backup();
  const serialized = JSON.stringify(backup);
  assert.equal(serialized.includes(secretValue), false);
  assert.equal(serialized.includes('apiKey'), false);

  const target = await makeHarness(t);
  const preview = target.service.restore({ backup, preview: true });
  target.service.restore({ backup, preview: false, token: preview.token });
  assert.equal(target.service.session(session.id).turns[0].answer, '我的离线回答');
  assert.ok(target.service.store.history(note.id).length >= 2);
  assert.equal(target.service.settings().ai.hasKey, false);
});

test('daily planning respects the minute budget and is idempotent', async t => {
  const h = await makeHarness(t);
  h.service.updateSettings({ dailyMinutes: 10 });
  for (let index = 0; index < 5; index += 1) {
    createKnowledge(h.service, { title: `预算知识 ${index}`, body: `正文 ${index}`, depth: 'explain' });
  }

  const first = h.service.today();
  const second = h.service.today();
  assert.equal(first.minutes, 10);
  assert.equal(first.items.length, 2);
  assert.deepEqual(second.items.map(item => item.id).sort(), first.items.map(item => item.id).sort());
  assert.equal(h.service.store.records('plans').length, 2);
  assert.equal(first.backlog, 3);
});

test('offline answers persist across restart and request ids prevent duplicate turns', async t => {
  const events = [];
  const h = await makeHarness(t, { aiOverride: offlineAI(events) });
  const note = createKnowledge(h.service, { title: '离线学习', body: '离线也要保存回答' });
  const session = h.service.startStudy({ noteId: note.id });
  const answered = h.service.answerStudy(session.id, { answer: '这是我的原始回答', requestId: 'same-request' });
  const repeated = h.service.answerStudy(session.id, { answer: '不应重复保存', requestId: 'same-request' });
  assert.equal(repeated.turns.length, 1);
  assert.equal(answered.turns[0].answer, '这是我的原始回答');
  assert.equal(events.length, 0);

  const reopened = h.reopen();
  assert.equal(reopened.session(session.id).turns[0].answer, '这是我的原始回答');
  assert.equal(reopened.session(session.id).status, 'awaiting_feedback');
  assert.equal(reopened.store.records('jobs').filter(job => job.type === 'grade').length, 1);
});

test('a running job becomes waiting after restart instead of being silently rerun', async t => {
  const h = await makeHarness(t);
  const job = h.service.queue('discover', {}, 'restart-recovery');
  h.service.store.put('jobs', job.id, { ...job, state: 'running' });
  const reopened = h.reopen();
  const recovered = reopened.store.get('jobs', job.id);
  assert.equal(recovered.state, 'waiting');
  assert.match(recovered.error, /停止|重试/);
});

test('mistake records never enter default RAG search results', async t => {
  const h = await makeHarness(t);
  h.service.store.create({
    kind: 'mistake',
    title: '错误答案隔离',
    body: '错误内容独有词青鸾不能当正确知识',
    meta: { privacy: 'local', correctionState: 'open' },
  });
  assert.equal((await h.service.search('青鸾')).results.length, 0);
});

test('retired and superseded knowledge never enter default RAG results', async t => {
  const h = await makeHarness(t);
  createKnowledge(h.service, { title: '旧结论', body: '旧结论独有词沧溟', stage: 'retired' });
  createKnowledge(h.service, { title: '被替代结论', body: '被替代独有词鹤汀', meta: { supersededBy: 'new-note' } });
  assert.equal((await h.service.search('沧溟')).results.length, 0);
  assert.equal((await h.service.search('鹤汀')).results.length, 0);
});

test('browse search includes all active kinds and permits an explicit retired filter', async t => {
  const h = await makeHarness(t);
  const report = h.service.store.create({
    kind: 'report',
    title: '浏览报告',
    body: '报告独有词扶桑',
    meta: { privacy: 'local' },
  });
  const mistake = h.service.store.create({
    kind: 'mistake',
    title: '浏览错题',
    body: '错题独有词若木',
    meta: { privacy: 'local', correctionState: 'open' },
  });
  const retired = createKnowledge(h.service, { title: '浏览归档', body: '归档独有词蓬莱', stage: 'retired' });

  assert.equal((await h.service.search('扶桑', { browse: true })).results[0]?.id, report.id);
  assert.equal((await h.service.search('若木', { browse: true, kind: 'mistake' })).results[0]?.id, mistake.id);
  assert.equal((await h.service.search('蓬莱', { browse: true })).results.length, 0);
  assert.equal((await h.service.search('蓬莱', { browse: true, stage: 'retired' })).results[0]?.id, retired.id);
  assert.equal((await h.service.search('扶桑', { kind: 'report' })).results.length, 0);
});

test('draft records are not indexed or returned as knowledge', async t => {
  const h = await makeHarness(t);
  h.service.store.put('drafts', 'draft-only', {
    id: 'draft-only',
    body: '草稿独有词云梦泽不应进入 RAG',
    citations: [],
    createdAt: new Date().toISOString(),
  });
  assert.equal((await h.service.search('云梦泽')).results.length, 0);
  assert.equal(h.service.store.db.prepare("SELECT COUNT(*) AS count FROM index_chunks WHERE noteId='draft-only'").get().count, 0);
});

test('local-only source processing reaches the offline privacy guard without external research', async t => {
  const events = [];
  const h = await makeHarness(t, { aiOverride: offlineAI(events) });
  h.service.updateSettings({ ai: { enabled: true } });
  const imported = h.service.importItems({
    items: [{ title: '私有资料', body: '不允许外发的私人原文', privacy: 'local' }],
    process: true, research: true,
  });
  await h.service.runJobs();

  assert.equal(events.length, 1);
  assert.equal(events[0].capability, 'generate');
  assert.equal(events[0].input.privacy, 'local');
  assert.equal(events.some(event => event.capability === 'research'), false);
  const job = h.service.store.get('jobs', imported.jobs[0].id);
  assert.equal(job.state, 'waiting');
  assert.equal(job.code, 'PRIVACY_LOCAL');
  assert.equal(h.service.getNote(imported.notes[0].id).body, '不允许外发的私人原文');
});

test('local-only search and ask stay offline even when model settings are enabled', async t => {
  const events = [];
  const h = await makeHarness(t, { aiOverride: offlineAI(events) });
  h.service.updateSettings({ ai: { enabled: true } });
  const note = createKnowledge(h.service, { title: '仅本地问答', body: '本地问答独有词若木', privacy: 'local' });

  const result = await h.service.ask({ question: '若木', scope: ['knowledge'] });
  assert.equal(events.length, 0);
  assert.equal(result.citations[0]?.id, note.id);
  assert.match(result.answer, /模型未启用或材料仅限本地/);
  assert.equal(result.limitations.includes('未进行 AI 生成。'), true);
});

test('deletion keeps explicit history but cannot silently restore into current search', async t => {
  const h = await makeHarness(t);
  const note = createKnowledge(h.service, { title: '删除留史', body: '历史保留词昆仑墟' });
  h.service.store.delete(note.id, note.hash);
  assert.ok(h.service.store.history(note.id).some(version => version.reason === '用户删除'));
  assert.equal((await h.service.search('昆仑墟')).results.length, 0);
  assert.throws(() => h.service.getNote(note.id), error => error.code === 'NOT_FOUND');
});
