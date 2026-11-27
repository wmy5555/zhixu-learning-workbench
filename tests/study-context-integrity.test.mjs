import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createService } from '../src/service.mjs';

function fixture(t) {
  const parent = path.resolve(import.meta.dirname, '../.tmp'); fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'study-context-')), prompts = [];
  const service = createService({ dataDir: path.join(root, 'data'), vaultDir: path.join(root, 'vault'),
    aiOverride: { async generate({ prompt }) {
      prompts.push(prompt); return { text: JSON.stringify({ assessment:'correct', feedback:'合成反馈。' }) };
    } } });
  t.after(async () => { await service.close(); fs.rmSync(root, { recursive:true, force:true }); });
  const store = service.store;
  const knowledge = store.create({ kind:'knowledge', title:'健康知识', body:'正常的学习材料。', meta:{ stage:'learning', depth:'explain' } });
  const topic = store.create({ kind:'topic', title:'主题', body:'合成主题。', meta:{ noteIds:[knowledge.id] } });
  const mistake = store.create({ kind:'mistake', title:'错题', body:'合成错题。', meta:{ correctionState:'open',
    noteId:knowledge.id, nextQuestion:'ONLY_FROM_MISTAKE', omission:'错题遗漏' } });
  const edit = (note, meta) => store.update(note.id, { expectedHash:service.getNote(note.id).hash, meta });
  return { service, store, knowledge, topic, mistake, edit, prompts };
}

for (const [label, bad] of [['unknown classification', { stage:'待核对的旧阶段' }], ['damaged source', { processKey:7 }]]) {
  test(`automatic plans omit ${label} topic and mistake contexts without bypassing topic pause`, t => {
    const { service:s, store, knowledge:k, topic, mistake, edit } = fixture(t);
    const item = () => s.today().items.find(x => x.noteId === k.id && x.state === 'pending');
    assert.equal(item().topicId, topic.id); assert.equal(item().mistakeId, mistake.id);
    edit(topic, bad);
    assert.equal(s.topics().find(row => row.id === topic.id).progress.nextNoteId, label === 'unknown classification' ? null : k.id);
    assert.equal(item().topicId, undefined); assert.equal(item().mistakeId, mistake.id);
    edit(mistake, bad);
    const regular = item();
    assert.equal(regular.kind, 'learn'); assert.equal(regular.topicId, undefined); assert.equal(regular.mistakeId, undefined);
    assert.equal(store.get('plans', regular.id).mistakeId, undefined);
    const started = s.startStudy({ noteId:k.id, planId:regular.id });
    assert.equal(started.noteId, k.id); assert.equal(started.mistakeId, undefined); assert.equal(started.topicId, undefined);
    assert.equal(s.readPublicNote(topic.id).title, topic.title); assert.equal(s.readPublicNote(mistake.id).body, mistake.body);
    edit(topic, { paused:true }); assert.equal(item(), undefined);
    assert.equal(s.today().unavailable.find(x => x.noteId === k.id).code, 'paused');
    edit(topic, { paused:false, stage:'reference', processKey:null });
    assert.equal(item().topicId, topic.id); assert.equal(item().mistakeId, undefined);
  });
}

test('explicit practice with a damaged mistake stays local after repair and is never reused as model history', async t => {
  const { service:s, store, knowledge:k, mistake, edit, prompts } = fixture(t);
  s.updateSettings({ ai:{ enabled:true } });
  edit(mistake, { processKey:7 });
  const local = s.startStudy({ noteId:k.id, mistakeId:mistake.id, requestId:'local-start' });
  assert.equal(local.privacy, 'local'); assert.equal(local.outboundIntentVersion, undefined);
  assert.equal(local.question, 'ONLY_FROM_MISTAKE');
  const pending = s.answerStudy(local.id, { answer:'LOCAL_ONLY_ANSWER', requestId:'local-round' });
  edit(mistake, { processKey:null, nextQuestion:'可用的修订问题' });
  await s.runJobs();
  assert.equal(store.get('jobs', pending.pendingJobId).code, 'PRIVACY_LOCAL');
  assert.equal(prompts.length, 0); assert.equal(s.session(local.id).turns[0].answer, 'LOCAL_ONLY_ANSWER');
  // Old clients captured this mistake locally but recorded a generic start intent.
  const legacy = structuredClone(store.get('sessions', local.id));
  delete legacy.sourceBindingInvalid; legacy.outboundIntentVersion = 1; legacy.id = 'legacy-local-context';
  legacy.turns[0].answer = 'LEGACY_LOCAL_MISTAKE_ANSWER'; store.put('sessions', legacy.id, legacy);
  const fresh = s.startStudy({ noteId:k.id, requestId:'fresh-start' });
  const answer = s.answerStudy(fresh.id, { answer:'FRESH_ANSWER', requestId:'fresh-round' });
  await s.runJobs(); assert.equal(store.get('jobs',answer.pendingJobId).state, 'done');
  assert.equal(prompts.length, 1); assert.ok(prompts[0].includes('FRESH_ANSWER'));
  assert.doesNotMatch(prompts[0], /LOCAL_ONLY_ANSWER|ONLY_FROM_MISTAKE|LEGACY_LOCAL_MISTAKE_ANSWER/);
});

test('manual topic practice can read locally without a grant after its source binding was damaged', async t => {
  const { service:s, store, knowledge:k, topic, edit, prompts } = fixture(t);
  s.updateSettings({ ai:{ enabled:true } });
  edit(topic, { processKey:7 });
  const local = s.startStudy({ noteId:k.id, topicId:topic.id });
  assert.equal(local.privacy, 'local'); assert.equal(local.outboundIntentVersion, undefined);
  const waiting = s.answerStudy(local.id, { answer:'LOCAL_TOPIC_ONLY', requestId:'topic-local-answer' });
  edit(topic, { processKey:null });
  await s.runJobs();
  assert.equal(store.get('jobs', waiting.pendingJobId).code, 'PRIVACY_LOCAL');
  assert.equal(prompts.length, 0); assert.equal(s.session(local.id).turns[0].answer, 'LOCAL_TOPIC_ONLY');
});
