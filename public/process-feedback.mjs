const activeStates = new Set(['queued', 'running']);
const list = value => Array.isArray(value) ? value : [];

// Observe local job records only; this monitor never submits or retries work.
export function createProcessFeedback({ getContext, readJobs, notify, onChange = () => {},
  schedule = (callback, delay) => window.setTimeout(callback, delay),
  cancel = timer => window.clearTimeout(timer) }) {
  const contexts = new Map();
  let timer = null, started = false, polling = false;
  const key = () => getContext().practiceId || '';
  function current() {
    const id = key();
    if (!contexts.has(id)) contexts.set(id, { initialized: false, revision: '', snapshot: 0, oldRevisions: new Set(), jobs: new Map(), notes: new Map(), submitting: new Set() });
    return contexts.get(id);
  }
  function observe(snapshot) {
    const state = current(), changed = [];
    if (snapshot.jobRevision && snapshot.jobRevision !== state.revision) {
      if (state.oldRevisions.has(snapshot.jobRevision)) return;
      if (state.revision) state.oldRevisions.add(state.revision);
      changed.push(...[...state.jobs.values()].map(job => ({ ...job, state: 'removed' })));
      state.jobs.clear(); state.initialized = false; state.revision = snapshot.jobRevision; state.snapshot = 0;
    }
    if (Number.isInteger(snapshot.jobSnapshot)) {
      if (snapshot.jobSnapshot <= state.snapshot) return;
      state.snapshot = snapshot.jobSnapshot;
    }
    for (const note of list(snapshot.notes)) state.notes.set(note.id, { title: note.title });
    if (Array.isArray(snapshot.jobs)) {
      const ids = new Set(snapshot.jobs.filter(job => job.type === 'process').map(job => job.id));
      for (const [id, record] of state.jobs) if (!ids.has(id)) { state.jobs.delete(id); changed.push({ ...record, state: 'removed' }); }
    }
    for (const job of list(snapshot.jobs)) {
      if (job.type !== 'process' || !job.id) continue;
      const previous = state.jobs.get(job.id);
      // A slower bootstrap read must not undo completion observed by the poller.
      if (previous?.state === 'done' && activeStates.has(job.state)
        || previous?.updatedAt && job.updatedAt && job.updatedAt < previous.updatedAt) continue;
      const noteId = job.noteId || job.payload?.noteId;
      const note = state.notes.get(noteId);
      const record = { id: job.id, state: job.state, noteId, research: job.research === true || job.payload?.research === true,
        presetCase: job.presetCase || job.payload?.presetCase,
        createdAt: job.createdAt || '', updatedAt: job.updatedAt || '' };
      state.jobs.set(job.id, record);
      if (previous?.state === record.state && previous?.updatedAt === record.updatedAt) continue;
      changed.push(record);
      if (!state.initialized || record.presetCase || previous?.state === record.state) continue;
      const title = String(job.title || note?.title || '资料').slice(0, 70);
      if (record.state === 'done') notify(`《${title}》的 AI 拆解已完成${record.research ? '（含联网核验）' : ''}`, 'success');
      else if (record.state === 'failed') notify(`《${title}》的 AI 拆解未完成，原文已保留。请到「系统 → 任务」查看原因。`, 'error');
    }
    state.initialized = true;
    if (changed.length) {
      onChange(changed);
      if (timer !== null) cancel(timer);
      timer = null; arm();
    }
  }
  function status(noteId) {
    const state = current();
    if (state.submitting.has(noteId)) return { active: true, state: 'submitting', message: '正在提交 AI 拆解…' };
    const jobs = [...state.jobs.values()].reverse().filter(job => job.noteId === noteId && !job.presetCase)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const job = jobs.find(job => activeStates.has(job.state)) || jobs[0];
    if (!job) return null;
    const messages = { queued: 'AI 拆解已排队，请等待…', running: 'AI 正在拆解，请等待…',
      waiting: '拆解需等待条件满足，请到「系统 → 任务」查看原因并重试。',
      failed: 'AI 拆解未完成，请到「系统 → 任务」查看原因并重试。',
      cancelled: '拆解任务已取消，原文已保留。', done: 'AI 拆解已完成。' };
    return { ...job, active: activeStates.has(job.state), message: messages[job.state] || '' };
  }
  function begin(noteId) {
    if (status(noteId)?.active) return false;
    current().submitting.add(noteId); onChange([]); return true;
  }
  function end(noteId) { current().submitting.delete(noteId); onChange([]); }
  async function poll() {
    if (polling) return;
    polling = true;
    const context = getContext();
    try {
      const snapshot = await readJobs();
      const next = getContext();
      if (context.practiceId === next.practiceId && context.version === next.version) observe(snapshot);
    } catch { /* Keep the last known state; a failed read is not task completion. */ }
    finally { polling = false; }
  }
  function arm() {
    if (!started || timer !== null) return;
    const delay = [...current().jobs.values()].some(job => activeStates.has(job.state)) ? 3000 : 15000;
    timer = schedule(async () => { timer = null; if (!started) return; await poll(); arm(); }, delay);
  }
  return { observe, status, begin, end, poll,
    start() { started = true; arm(); },
    stop() { started = false; if (timer !== null) cancel(timer); timer = null; },
  };
}
