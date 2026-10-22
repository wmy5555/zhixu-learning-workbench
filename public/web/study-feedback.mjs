export const feedbackPending = session => session.status === 'awaiting_feedback' || !!session.pendingJobId;

// Read only the visible waiting session; never enqueue or retry AI work here.
export function watchStudyFeedback({ read, isCurrent, onReady, schedule = setTimeout, cancel = clearTimeout, interval = 1000 }) {
  const controller = new AbortController();
  let timer, stopped = false, failures = 0;
  const active = () => !stopped && isCurrent();
  function stop() { stopped = true; cancel(timer); controller.abort(); }
  async function check() {
    if (!active()) return stop();
    try {
      const session = await read(controller.signal);
      if (!active()) return stop();
      failures = 0;
      if (!feedbackPending(session)) {
        stop();
        await onReady(session);
        return;
      }
    } catch {
      if (!active()) return stop();
      failures++;
    }
    if (active()) timer = schedule(check, Math.min(15000, interval * 2 ** Math.min(failures, 4)));
  }
  timer = schedule(check, interval);
  return stop;
}
