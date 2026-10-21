import test from 'node:test';
import assert from 'node:assert/strict';
import { watchStudyFeedback, feedbackPending } from '../public/web/study-feedback.mjs';

function harness(read) {
  const timers = new Map(), updates = [], delays = [];
  let key = 0, current = true;
  const stop = watchStudyFeedback({ read, isCurrent: () => current,
    onReady: value => updates.push(value),
    schedule(fn, delay) { delays.push(delay); timers.set(++key, fn); return key; },
    cancel(id) { timers.delete(id); },
  });
  return { timers, updates, delays, stop, leave() { current = false; }, async tick() {
    assert.equal(timers.size, 1, 'only one poll may be scheduled');
    const [id, fn] = timers.entries().next().value; timers.delete(id); await fn();
  } };
}

test('pending feedback updates once when the answer is graded, then stops polling', async () => {
  const ready = { status: 'feedback', pendingJobId: null, turns: [{ feedback: { assessment: 'correct' } }] };
  const values = [{ status: 'awaiting_feedback', pendingJobId: 'job' }, ready];
  const h = harness(async () => values.shift());
  await h.tick(); assert.equal(h.updates.length, 0);
  await h.tick(); assert.deepEqual(h.updates, [ready]); assert.equal(h.timers.size, 0);
  assert.equal(feedbackPending({ status: 'reading', pendingJobId: 'job' }), true);
  assert.equal(feedbackPending({ status: 'completed' }), false);
});

test('leaving while a read is in flight aborts it and ignores its late response', async () => {
  let resolve, signal;
  const h = harness(s => { signal = s; return new Promise(r => { resolve = r; }); });
  const pending = h.tick(); h.stop();
  assert.equal(signal.aborted, true);
  resolve({ status: 'feedback' }); await pending;
  assert.equal(h.updates.length, 0); assert.equal(h.timers.size, 0);
});

test('a stale page cannot apply feedback even if a request ignores abort', async () => {
  let resolve;
  const h = harness(() => new Promise(r => { resolve = r; }));
  const pending = h.tick(); h.leave(); resolve({ status: 'feedback' }); await pending;
  assert.equal(h.updates.length, 0); assert.equal(h.timers.size, 0);
});

test('temporary read failure retries with backoff and recovers without AI writes', async () => {
  let reads = 0;
  const h = harness(async () => { if (!reads++) throw Error('offline'); return { status: 'feedback' }; });
  await h.tick(); assert.deepEqual(h.delays, [1000, 2000]);
  await h.tick(); assert.equal(h.updates.length, 1); assert.equal(h.timers.size, 0);
});

test('navigation cancels a scheduled read before it starts', () => {
  const h = harness(() => assert.fail('must not read after navigation'));
  h.stop(); assert.equal(h.timers.size, 0);
});

// Exercise the real finish handler without booting the rest of the application.
import vm from 'node:vm';
import fs from 'node:fs';
function finishHarness({ accept = true, post = async () => {} } = {}) {
  const source = fs.readFileSync(new URL('../public/web/main.mjs', import.meta.url), 'utf8');
  const handler = source.match(/async function actions\(control\) \{[\s\S]*?\n\}/)[0];
  const state = { dirty: true, saving: 0, sequence: 1 }, form = { inert: false }, calls = [];
  const scope = vm.createContext({ state, confirm: async () => accept,
    endpoint: (...parts) => parts.join('/'), api: { post: async () => { calls.push('post'); return post(); } },
    refreshBoot: async () => { calls.push('bootstrap'); }, go: async () => { calls.push('go'); },
  });
  const act = vm.runInContext('(' + handler + ')', scope);
  return { state, form, calls, run: () => act({ dataset: { action: 'finish', id: 'synthetic' }, closest: selector => selector === 'form' ? form : null }) };
}
test('finish cancellation keeps the draft and never posts', async () => {
  const h = finishHarness({ accept: false }); await h.run();
  assert.deepEqual(h.calls, []); assert.equal(h.state.dirty, true); assert.equal(h.form.inert, false);
});
test('finish locks input until completion and restores the form afterwards', async () => {
  let release, entered; const started = new Promise(r => { entered = r; });
  const h = finishHarness({ post: () => { entered(); return new Promise(r => { release = r; }); } });
  const pending = h.run(); await started;
  assert.equal(h.form.inert, true); assert.equal(h.state.saving, 1);
  release(); await pending;
  assert.deepEqual(h.calls, ['post', 'bootstrap', 'go']); assert.equal(h.state.dirty, false);
  assert.equal(h.form.inert, false); assert.equal(h.state.saving, 0);
});
test('finish request failure retains the draft and unlocks editing', async () => {
  const h = finishHarness({ post: async () => { throw Error('offline'); } });
  await assert.rejects(h.run(), /offline/);
  assert.deepEqual(h.calls, ['post']); assert.equal(h.state.dirty, true);
  assert.equal(h.form.inert, false); assert.equal(h.state.saving, 0);
});
