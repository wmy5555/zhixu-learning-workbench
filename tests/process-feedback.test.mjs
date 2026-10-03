import assert from 'node:assert/strict';
import test from 'node:test';
import { createProcessFeedback } from '../public/process-feedback.mjs';

const job = (id, state, extra = {}) => ({ id, type: 'process', state, createdAt: '2026-10-03T00:00:00Z', payload: { noteId: 'source' }, ...extra });
function monitor(readJobs = async () => ({ jobs: [] })) {
  let context = { practiceId: '', version: 0 };
  const messages = [], timers = new Map(), changes = [];
  let timerId = 0;
  const feedback = createProcessFeedback({ getContext: () => ({ ...context }), readJobs,
    notify: (text, tone) => messages.push({ text, tone }), onChange: value => changes.push(value),
    schedule: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
    cancel: id => timers.delete(id),
  });
  return { feedback, messages, timers, changes, switchTo(id) { context = { practiceId: id, version: context.version + 1 }; } };
}

test('existing completed jobs stay quiet; each newly completed real process notifies once in its own library', () => {
  const ui = monitor();
  const notes = [{ id: 'source', title: '合成原文', meta: {} }];
  ui.feedback.observe({ jobs: [job('old', 'done'), job('pending', 'queued')], notes });
  assert.equal(ui.messages.length, 0);
  ui.feedback.observe({ jobs: [job('pending', 'running')] });
  ui.feedback.observe({ jobs: [job('pending', 'done')] });
  ui.feedback.observe({ jobs: [job('pending', 'running')] });
  ui.feedback.observe({ jobs: [job('pending', 'done')] });
  assert.equal(ui.feedback.status('source').state, 'done', 'a delayed pending read cannot restart the spinner');
  assert.equal(ui.messages.length, 1);
  assert.match(ui.messages[0].text, /合成原文.*已完成/);
  ui.switchTo('practice-one');
  ui.feedback.observe({ jobs: [job('pending', 'queued')], notes: [{ id: 'source', title: '虚构练习原文', meta: { practice: true } }] });
  ui.feedback.observe({ jobs: [job('pending', 'done')] });
  assert.equal(ui.messages.length, 2, 'real processing in the practice library is included');
  ui.switchTo(''); ui.feedback.observe({ jobs: [job('pending', 'done')] });
  assert.equal(ui.messages.length, 2, 'returning to a library does not replay completion');
});

test('saved partial decomposition notifies once without claiming that research is complete', () => {
  const ui = monitor();
  ui.feedback.observe({ jobs: [job('partial', 'running')] });
  const waiting = job('partial', 'waiting', { code: 'RESEARCH_INCOMPLETE' });
  ui.feedback.observe({ jobs: [waiting] }); ui.feedback.observe({ jobs: [waiting] });
  assert.equal(ui.messages.length, 1); assert.match(ui.messages[0].text, /已保存.*尚待核验/);
  assert.equal(ui.feedback.status('source').active, false);
  ui.feedback.observe({ jobs: [job('conditions', 'waiting', { code: 'MODEL_DISABLED' })] });
  assert.equal(ui.messages.length, 1, 'unprocessed waiting tasks do not count as saved decomposition');
});

test('fast and real processing of preset sources notify; simulated jobs and unrelated task types stay quiet', () => {
  const ui = monitor(); ui.feedback.observe({ jobs: [] });
  const jobs = [job('fast', 'done'), job('preset', 'done', { presetCase: 'synthetic-case' }),
    job('preset-payload', 'done', { payload: { noteId: 'source', presetCase: 'synthetic-case' } }),
    job('index', 'done', { type: 'index' }), job('preset-note', 'done', { payload: { noteId: 'preset-source' } })];
  ui.feedback.observe({ jobs, notes: [{ id: 'preset-source', meta: { presetCase: 'synthetic-case' } }] });
  ui.feedback.observe({ jobs });
  assert.equal(ui.messages.length, 2); assert.ok(ui.messages.every(message => message.tone === 'success'));
  ui.feedback.observe({ jobs: [job('real-case', 'running', { payload: { noteId: 'preset-source' } })] });
  assert.equal(ui.feedback.status('preset-source').active, true);
  assert.equal(ui.feedback.begin('preset-source'), false, 'a preset source does not exempt real pending work from the submit guard');
  ui.feedback.observe({ jobs: [job('real-case', 'done', { payload: { noteId: 'preset-source' } })] });
  assert.equal(ui.messages.length, 3);
});

test('authoritative snapshots remove old jobs and backup restoration resets terminal state without replaying history', () => {
  const ui = monitor();
  ui.feedback.observe({ jobs: [job('same', 'done', { updatedAt: '2026-10-03T02:00:00Z' })], jobRevision: 'before', jobSnapshot: 1 });
  ui.feedback.observe({ jobs: [job('same', 'running')], jobRevision: 'after', jobSnapshot: 2 });
  assert.equal(ui.feedback.status('source').active, true, 'restoring an old queued job may reuse its identifier');
  ui.feedback.observe({ jobs: [job('same', 'done')], jobRevision: 'before', jobSnapshot: 8 });
  assert.equal(ui.feedback.status('source').active, true, 'an old response from before restoration is discarded');
  ui.feedback.observe({ jobs: [job('same', 'done')], jobRevision: 'after', jobSnapshot: 3 });
  assert.equal(ui.messages.length, 1);
  ui.feedback.observe({ jobs: [], jobRevision: 'after', jobSnapshot: 2 });
  assert.equal(ui.feedback.status('source').state, 'done', 'a delayed snapshot cannot remove a newly observed job');
  ui.feedback.observe({ jobs: [], jobRevision: 'after', jobSnapshot: 4 });
  assert.equal(ui.feedback.status('source'), null);
  assert.equal(ui.feedback.begin('source'), true, 'removed jobs cannot keep their source disabled');
  ui.feedback.end('source');
  ui.feedback.observe({ jobs: [job('historical', 'done')], jobRevision: 'another-restore', jobSnapshot: 5 });
  assert.equal(ui.messages.length, 1, 'restored historical completion remains quiet');
});

test('a submitted job reply retains other jobs and rejects older full snapshots until current status arrives', () => {
  const ui = monitor();
  const other = job('other', 'running', { payload: { noteId: 'other-source' } });
  ui.feedback.observe({ jobs: [other], jobRevision: 'same', jobSnapshot: 1 });
  ui.feedback.begin('source');
  ui.feedback.observe({ jobs: [job('accepted', 'queued')], partial: true, jobRevision: 'same', jobSnapshot: 3 });
  ui.feedback.end('source');
  assert.equal(ui.feedback.status('other-source').active, true);
  ui.feedback.observe({ jobs: [other], jobRevision: 'same', jobSnapshot: 2 });
  assert.equal(ui.feedback.status('source').active, true);
  assert.equal(ui.feedback.begin('source'), false);
  ui.feedback.observe({ jobs: [other, job('accepted', 'done')], jobRevision: 'same', jobSnapshot: 4 });
  assert.equal(ui.messages.length, 1);
});

test('pending work blocks repeats; waiting and failure stop spinning, and a user retry can later complete', () => {
  const ui = monitor(); ui.feedback.observe({ jobs: [] });
  assert.equal(ui.feedback.begin('source'), true); assert.equal(ui.feedback.begin('source'), false);
  assert.equal(ui.feedback.status('source').state, 'submitting');
  ui.feedback.observe({ jobs: [job('retry', 'queued')] }); ui.feedback.end('source');
  assert.equal(ui.feedback.begin('source'), false);
  ui.feedback.observe({ jobs: [job('retry', 'waiting')] });
  assert.equal(ui.feedback.status('source').active, false); assert.equal(ui.messages.length, 0);
  ui.feedback.observe({ jobs: [job('retry', 'queued')] });
  ui.feedback.observe({ jobs: [job('retry', 'failed')] }); ui.feedback.observe({ jobs: [job('retry', 'failed')] });
  assert.equal(ui.feedback.status('source').active, false); assert.equal(ui.messages.length, 1);
  assert.equal(ui.messages[0].tone, 'error'); assert.doesNotMatch(ui.messages[0].text, /已完成/);
  ui.feedback.observe({ jobs: [job('retry', 'queued')] });
  ui.feedback.observe({ jobs: [job('retry', 'done', { payload: { noteId: 'source', research: true } })] });
  assert.equal(ui.messages.length, 2); assert.match(ui.messages[1].text, /含联网核验/);
});

test('polls are serial, failures keep the known state, and a switched library discards a delayed result', async () => {
  let resolve, reads = 0;
  const ui = monitor(() => { reads++; return new Promise(done => { resolve = done; }); });
  ui.feedback.observe({ jobs: [job('slow', 'running')] });
  const pending = ui.feedback.poll(); await ui.feedback.poll(); assert.equal(reads, 1);
  ui.switchTo('practice-one'); resolve({ jobs: [job('slow', 'done')] }); await pending;
  assert.equal(ui.messages.length, 0); assert.equal(ui.feedback.status('source'), null);
  ui.switchTo(''); assert.equal(ui.feedback.status('source').state, 'running');
  const offline = monitor(async () => { throw new Error('synthetic offline'); });
  offline.feedback.observe({ jobs: [job('slow', 'running')] }); await offline.feedback.poll();
  assert.equal(offline.feedback.status('source').state, 'running'); assert.equal(offline.messages.length, 0);
});

test('the monitor slows down when idle, promptly watches active work, and stops cleanly', () => {
  const ui = monitor(); ui.feedback.observe({ jobs: [] }); ui.feedback.start();
  assert.equal([...ui.timers.values()][0].delay, 15000);
  ui.feedback.observe({ jobs: [job('new', 'queued')] });
  assert.equal(ui.timers.size, 1); assert.equal([...ui.timers.values()][0].delay, 3000);
  ui.feedback.observe({ jobs: [job('new', 'done')] });
  assert.equal([...ui.timers.values()][0].delay, 15000);
  ui.feedback.stop(); assert.equal(ui.timers.size, 0);
});
