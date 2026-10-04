import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { createApp } from '../src/server.mjs';
import { createService } from '../src/service.mjs';
import { fail } from '../src/store.mjs';
import { materials, getMaterial, materialSample, customSample } from '../public/onboarding-materials.mjs';
import { getCurriculum } from '../public/onboarding-curriculum.mjs';

const marker = '【离线受控场景测试，非供应商返回、非真实作答】';
const tempRoot = path.resolve(import.meta.dirname, '..', '.tmp');
const custom = { title: '合成自选资料'.repeat(33) + '合成', body: '只用于测试的原文：记录检查条件，再将方法用于另一个例子。\n第二段保留原来的换行。', note: '这是一段合成心得，不是用户的私人资料。', author: '测试作者', url: 'https://example.invalid/custom', locator: '第 1—2 段' };
const excerptHashes = {
  course: ['23891dbbe1ff03d83793d541c3f3f23dc5e852343eeb9dc4219482915f7bd86b', '8772414400dde95f7d1241110bb094a171d263f8a5bfb6ade8deb6deb746510c'],
  reading: ['53acc702c12cdbca9202f6d4736ec23521a435e227d6d0d5d1871bd3d33299c7', 'a288f805cdc314d5f8335a4c761fc5d0c928cb64e89c5d0d9c0031687f44cf6a'],
  work: ['ce2b5c5ec0e981b3f34dda14b1d36ad8f631499a70f66eaa1c1ed674a08fb9d1', '63b526ee69479c6aa3a2014df43dfe4737eaf41d6046f4541c0ea46703ce809e'],
  tech: ['c39673e07d04adb4df75e46b87ab4543c159ddb4a8beaf02b248ac21bfd18e47', 'cb28353af29d12aefab7502a65e8ac23c63ca1209705316b6540e2282cd8f31c'],
  life: ['f52c52ab4baf670f3a8658629f485ef904b6804faca251343cf326588f000554', '5b870d986662b6c4cc44ddf3d428fadb8ff89d127a8dab20a0de34485592667f'],
};

test('five approved source-dominant materials retain excerpts, licences and scenario tasks', () => {
  assert.deepEqual(materials.map(item => item.id), ['course', 'reading', 'work', 'tech', 'life']);
  for (const material of materials) {
    assert.deepEqual([material.body, material.companion.body].map(body => createHash('sha256').update(body).digest('hex')), excerptHashes[material.id], 'approved excerpts remain unchanged');
    assert.ok(material.body.length > 1500 && material.body.length > material.note.length * 5);
    const sample = materialSample(material.id);
    assert.ok(sample.body.includes(material.body));
    assert.ok(sample.body.includes('个人心得（模拟输入，不代表你的理解）'));
    for (const value of [material.source.author, material.source.url, material.source.license, material.source.licenseUrl]) assert.ok(sample.body.includes(value));
    assert.ok(materialSample(material.id, true).body.includes(material.companion.body));
    for (const field of ['recall', 'followup', 'transfer', 'review', 'retrieval', 'output', 'confirm']) assert.ok(material[field]);
    const route = getCurriculum(material.id);
    assert.equal(route.coreSteps.length, 28);
    assert.ok(route.coreSteps.every(item => !item.instruction.includes('小岚')));
    assert.equal(route.flatSteps.find(item => item.id === 'library-explain').sample, undefined);
    assert.ok(route.flatSteps.find(item => item.id === 'output-draft').sample.question.includes(material.transfer));
  }
  assert.ok(materialSample('tech').body.includes('PYTHON SOFTWARE FOUNDATION LICENSE VERSION 2'));
  assert.ok(materialSample('tech').body.includes('8. By copying, installing or otherwise using Python'));
  assert.match(materials[0].source.title, /一元一次方程/);
  assert.equal(customSample(custom).body.includes(custom.body), true);
  assert.equal(customSample(custom).title.length, 200);
  assert.throws(() => customSample({ ...custom, title: '字'.repeat(201) }));
  assert.throws(() => customSample({ ...custom, url: 'javascript:alert(1)' }));
});

async function fixture(t, materialId) {
  fs.mkdirSync(tempRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(tempRoot, 'scenario-'));
  const material = getMaterial(materialId);
  const fact = ['course', 'tech', 'custom'].includes(materialId);
  let assessment = 'correct';
  const calls = [];
  const ai = {
    async test(capability) { calls.push(`test:${capability}`); return { message: marker }; },
    async generate(input) {
      if (input.privacy !== 'cloud') fail('受控测试：未授权的原文不能外发。', 'PRIVACY_LOCAL');
      calls.push('generate');
      const ids = [...new Set([...input.prompt.matchAll(/"id":"([a-z0-9-]+)"/g)].map(match => match[1]))];
      let result;
      if (input.prompt.includes('"candidates"')) result = { candidates: ['explain', 'apply'].map(depth => ({ title: `${marker} ${material.label} ${depth}`, body: `${marker} ${material.goals[2][1]}\n${material.goals[3][1]}`, claims: fact ? [`${marker} 待查证的合成事实`] : [], depth, topic: materialId, reason: marker, prerequisites: [] })) };
      else if (input.prompt.includes('"assessment"')) result = { assessment, feedback: marker, nextQuestion: `${marker} 换一个条件时呢？` };
      else if (input.prompt.includes('"citationIds"')) result = { answer: `${marker} 练习草稿 [${ids[0]}]`, citationIds: ids.slice(0, 1) };
      else result = { relations: [] };
      return { text: JSON.stringify(result) };
    },
    async researchBatch({ claims, privacy }) {
      assert.equal(privacy, 'cloud'); calls.push('research');
      return { results: claims.map(claim => ({ claim, limitations: [], conclusion: marker, evidence: [{ title: marker, url: 'https://example.invalid/controlled-evidence', excerpt: marker, role: 'support', locator: marker, fetchedAt: new Date().toISOString() }] })) };
    },
  };
  const dataDir = path.join(root, 'data');
  const main = createService({ dataDir, vaultDir: path.join(root, 'formal'), aiOverride: ai });
  const app = createApp({ dataDir, service: main, scheduler: false });
  t.after(async () => { await app.close(); assert.ok(root.startsWith(tempRoot + path.sep)); fs.rmSync(root, { recursive: true, force: true }); });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const response = await fetch(base + '/api/session');
  const cookie = response.headers.get('set-cookie').split(';')[0], { csrf } = await response.json();
  async function request(route, body, method = body === undefined ? 'GET' : 'POST', status = 200) {
    const response = await fetch(base + route, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json(); assert.equal(response.status, status, `${route}: ${JSON.stringify(value)}`); return value;
  }
  let state = await request('/api/onboarding/start', { materialId, ...(materialId === 'custom' ? { customMaterial: custom } : {}) });
  const practiceId = state.practiceId;
  const guide = (action, input = {}, status = 200) => request(`/api/onboarding/${action}`, { practiceId, ...input }, 'POST', status);
  const practice = (route, body, method, status) => request(`/api/practice/${practiceId}/${route}`, body, method, status);
  const pump = async () => { for (let i = 0; i < 50 && (await practice('jobs')).jobs.some(job => ['queued', 'running'].includes(job.state)); i++) await app.onboarding.pump(); };
  const edit = async (id, meta) => { const note = await practice(`notes/${id}`); return practice(`notes/${id}`, { expectedHash: note.hash, meta }, 'PUT'); };
  const answer = async session => { await practice(`study/${session.id}/answer`, { requestId: randomUUID(), answer: marker }); await pump(); return practice(`study/${session.id}/finish`, {}); };
  return { root, dataDir, app, main, material, fact, calls, state, request, guide, practice, pump, edit, answer, setAssessment(value) { assessment = value; } };
}

for (const materialId of [...materials.map(item => item.id), 'custom']) test(`${materialId}: same actual source continues through learning, due review and adopted output`, { timeout: 60000 }, async t => {
  const f = await fixture(t, materialId);
  const { guide, practice, request, edit, pump } = f;
  assert.deepEqual(f.state.roles, {}, 'new scenes have no prewritten knowledge or grades');
  assert.deepEqual(f.main.store.list(), []);
  if (materialId === 'custom') {
    const progress = fs.readFileSync(path.join(f.dataDir, 'onboarding', 'state.json'), 'utf8');
    assert.ok(!progress.includes(custom.body) && !progress.includes(custom.note));
    assert.ok(f.state.customSample.body.includes(custom.body));
  }
  await request('/api/onboarding/start', { materialId: materialId === 'work' ? 'reading' : 'work' }, 'POST', 409);
  await request('/api/settings', { ai: { enabled: true, model: 'offline-controlled', baseUrl: 'https://example.invalid/v1' } }, 'PUT');
  await guide('test', { capability: 'model' });
  await guide('checkpoint', { stepId: 'capture-batch' });
  await practice('import', { captureMode: 'files', items: [{ title: marker + '伴读', body: '先导入的合成伴读，不应成为主线。' }, { title: marker + '应用问题', body: '合成扩展问题，不应成为主线。' }] });
  let current = await request('/api/onboarding/state');
  assert.equal(current.roles.capturedSource, undefined);
  assert.equal(current.roles.source, undefined);
  assert.equal((await guide('checkpoint', { stepId: 'capture-save' })).progress['capture-save'].status, 'pending');
  await practice('import', { captureMode: 'files', items: [{ title: marker + '单份伴读', body: '主线页面中导入的单份合成文件，也不应成为主线。' }] });
  await practice('import', { items: [{ title: marker + '其他导入', body: '没有粘贴表单标识的合成导入，不应成为主线。' }] });
  current = await guide('checkpoint', { stepId: 'capture-save' });
  assert.equal(current.roles.capturedSource, undefined);
  assert.equal(current.progress['capture-save'].status, 'pending');
  const sample = materialId === 'custom' ? f.state.customSample : materialSample(materialId);
  const source = (await practice('import', { captureMode: 'text', items: [{ ...sample, privacy: 'local' }] })).notes[0];
  assert.equal((await practice(`notes/${source.id}`)).body, sample.body);
  assert.equal((await practice(`notes/${source.id}`)).title, sample.title);
  assert.equal((await guide('checkpoint', { stepId: 'capture-save' })).progress['capture-save'].status, 'done');
  assert.equal((await practice(`notes/${source.id}/process`, { research: false })).state, 'queued');
  await pump();
  assert.equal((await practice('jobs')).jobs.find(job => job.type === 'process').state, 'waiting', 'no automatic cloud permission');
  await edit(source.id, { privacy: 'cloud' });
  await practice(`notes/${source.id}/process`, { research: false }); await pump();
  current = await request('/api/onboarding/state');
  assert.equal(current.roles.source, source.id);
  assert.equal(current.learningCandidates.length, 2);
  const knowledgeId = current.learningCandidates.find(note => note.depth === 'explain').id;
  if (f.fact) {
    await guide('select-knowledge', { noteId: knowledgeId }, 409);
    await request('/api/settings', { search: { enabled: true }, fetch: { enabled: true } }, 'PUT');
    await guide('test', { capability: 'search' }); await guide('test', { capability: 'fetch' });
    await practice(`notes/${source.id}/process`, { research: true }); await pump();
  }
  current = await guide('select-knowledge', { noteId: knowledgeId });
  assert.equal(current.roles.explain, knowledgeId);
  const applyId = current.learningCandidates.find(note => note.id !== knowledgeId).id;
  await guide('select-knowledge', { noteId: knowledgeId, role: 'apply' }, 409);
  await guide('select-knowledge', { noteId: applyId, role: 'apply' });
  await guide('select-knowledge', { noteId: applyId, role: 'aware' });
  current = await guide('select-knowledge', { noteId: applyId, role: 'find' });
  assert.equal(current.roles.aware, applyId);
  assert.equal(current.roles.find, applyId);
  assert.equal(current.roles.apply, applyId, 'two candidates support the main role plus sequential extension goals');
  const otherNote = await practice(`notes/${applyId}`);
  await practice(`notes/${applyId}/confirm`, { expectedHash: otherNote.hash, body: marker }); await pump();
  assert.equal((await guide('checkpoint', { stepId: 'study-confirm' })).progress['study-confirm'].status, 'pending', 'confirmation of another knowledge cannot complete the main learning step');
  await edit(knowledgeId, { privacy: 'cloud', depth: 'explain' });
  const beforeLearning = await practice('today/generate', {});
  assert.ok(!beforeLearning.items.some(item => item.noteId === knowledgeId));
  assert.equal(beforeLearning.unavailable.find(item => item.noteId === knowledgeId).code, 'stage');
  assert.equal((await guide('checkpoint', { stepId: 'study-plan' })).progress['study-plan'].status, 'pending', 'unrelated scheduled knowledge cannot complete the main planning step');
  await practice(`notes/${knowledgeId}/promote`, { stage: 'learning', depth: 'explain', reason: marker });
  const sourceBefore = await practice(`notes/${source.id}`);
  const sourceSaved = await edit(source.id, { privacy: 'cloud' });
  assert.equal(sourceSaved.hash, sourceBefore.hash, 'reconfirming source permission must not invalidate the processed source version');
  assert.deepEqual((await practice(`notes/${knowledgeId}/evidence`)).limitations, []);
  const plan = await practice('today/generate', {});
  assert.ok(plan.items.some(item => item.noteId === knowledgeId && item.state === 'pending'));
  assert.equal((await guide('checkpoint', { stepId: 'study-plan' })).progress['study-plan'].status, 'done');
  let session = await practice('study/start', { noteId: knowledgeId });
  assert.equal(session.question, f.material.recall);
  await guide('select-knowledge', { noteId: applyId }, 409);
  const completion = await f.answer(session);
  assert.equal(completion.completion.reviewSettled, true);
  await practice(`study/${session.id}/confirm`, { body: marker }); await pump();
  assert.equal((await guide('checkpoint', { stepId: 'study-confirm' })).progress['study-confirm'].status, 'done');
  const pending = await guide('checkpoint', { stepId: 'review-finish' });
  assert.equal(pending.progress['review-finish'].status, 'pending', 'time alone is not review evidence');
  current = await guide('advance', { action: 'next' });
  session = await practice('study/start', { noteId: knowledgeId });
  assert.equal(session.question, f.material.review);
  await f.answer(session);
  assert.equal((await guide('checkpoint', { stepId: 'review-finish' })).progress['review-finish'].status, 'done');
  await edit(applyId, { privacy: 'cloud', depth: 'apply' });
  await practice(`notes/${applyId}/promote`, { stage: 'learning', depth: 'apply', reason: marker });
  const application = await practice('study/start', { noteId: applyId });
  assert.ok(application.question.startsWith(f.material.transfer));
  await f.answer(application);
  await practice('search?q=' + encodeURIComponent(randomUUID()) + '&mode=keyword');
  assert.equal((await guide('checkpoint', { stepId: 'search-keyword' })).progress['search-keyword'].status, 'pending', 'an empty search cannot complete retrieval of the selected source');
  const unrelatedTerm = 'zzbranch' + randomUUID().slice(0, 8);
  const unrelated = (await practice('import', { items: [{ title: unrelatedTerm, body: unrelatedTerm }] })).notes[0];
  const unrelatedSearch = await practice('search?q=' + unrelatedTerm + '&mode=keyword');
  assert.ok(unrelatedSearch.results.some(note => note.id === unrelated.id));
  assert.equal((await guide('checkpoint', { stepId: 'search-keyword' })).progress['search-keyword'].status, 'pending', 'unrelated results cannot complete main-material retrieval');
  await practice('notes/' + unrelated.id, { expectedHash: (await practice('notes/' + unrelated.id)).hash }, 'DELETE');
  const mainTitle = (await practice('notes/' + knowledgeId)).title;
  const selectedSearch = await practice('search?q=' + encodeURIComponent(mainTitle) + '&mode=keyword');
  assert.ok(selectedSearch.results.some(note => [source.id, knowledgeId, applyId].includes(note.id)));
  assert.equal((await guide('checkpoint', { stepId: 'search-keyword' })).progress['search-keyword'].status, 'done');
  const draft = await practice('ask', { question: f.material.output, mode: 'draft', privacy: 'cloud', scope: ['knowledge', 'source'] });
  assert.equal(draft.generated, true);
  await practice(`drafts/${draft.draftId}`, { body: draft.answer + '\n' + marker, usedIds: [draft.citations[0].id] }, 'PUT');
  current = await request('/api/onboarding/state');
  assert.equal(current.materialId, materialId); assert.equal(current.roles.draft, draft.draftId); assert.equal(current.roles.explain, knowledgeId);
  for (const mode of ['answer', 'outline']) {
    const otherOutput = await practice('ask', { question: f.material.output, mode, privacy: 'cloud', scope: ['knowledge', 'source'] });
    assert.equal(otherOutput.generated, true);
    assert.notEqual(otherOutput.draftId, draft.draftId);
    current = await request('/api/onboarding/state');
    assert.equal(current.roles.draft, draft.draftId, 'optional output modes cannot replace the main draft');
    for (const stepId of ['output-draft', 'output-edit', 'output-use']) assert.equal(current.progress[stepId].status, 'done');
  }
  const backup = await practice('backup');
  await guide('pause');
  await guide('resume');
  assert.equal((await request('/api/onboarding/state')).materialId, materialId);
  const preview = await practice('restore', { backup, preview: true });
  await practice('restore', { backup, preview: false, token: preview.token });
  assert.equal((await request('/api/onboarding/state')).roles.draft, draft.draftId);
  if (materialId === 'custom') assert.ok((await request('/api/onboarding/state')).customSample.body.includes(custom.body));
  assert.deepEqual(f.main.store.list(), []); assert.deepEqual(f.main.store.records('sessions'), []);
  t.diagnostic('Only synthetic model, research and answer records; no live provider or user mastery verified.');
});

test('invalid custom input and invalid scene reset preserve the existing practice', async t => {
  const f = await fixture(t, 'reading');
  const oldId = f.state.practiceId;
  await f.guide('reset', { materialId: 'custom', customMaterial: { ...custom, body: '' } }, 400);
  await f.guide('reset', { materialId: 'custom', customMaterial: { ...custom, title: '字'.repeat(201) } }, 400);
  await f.guide('reset', { materialId: 'unknown' }, 400);
  assert.equal((await f.request('/api/onboarding/state')).practiceId, oldId);
  const changed = await f.guide('reset', { materialId: 'custom', customMaterial: custom });
  assert.notEqual(changed.practiceId, oldId); assert.equal(changed.materialId, 'custom');
  assert.ok(changed.customSample.body.includes(custom.body));
});
