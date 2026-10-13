import { receiveSyncBatch, recordSyncChange, syncVector, validateSyncState } from './source-sync.mjs';

// Storage must provide durable atomic CAS for the ENTIRE journal, including its cursor.
// This interface deliberately has no default adapter and cannot touch a live library.
export function createSourceSyncRepository(storage) {
  if (typeof storage?.load !== 'function' || typeof storage?.commit !== 'function') throw new TypeError('需要原子同步存储适配器。');
  let pending = Promise.resolve();
  function run(action) {
    const task = pending.then(action); pending = task.catch(() => {}); return task;
  }
  async function persist(before, next) {
    if (JSON.stringify(before.state) === JSON.stringify(next)) return;
    try { await storage.commit({ expectedRevision: before.revision, state: next }); }
    catch (cause) {
      // commit() may have installed the whole journal before its response was interrupted.
      // load() must reconcile/fsync it before returning a committed state, never a staged file.
      let readback;
      try { readback = validateSyncState((await storage.load()).state); }
      catch { throw Object.assign(new Error('同步提交结果未知；重新读取并重试同一批次，不能提前确认游标。', { cause }), { code: 'SYNC_COMMIT_UNKNOWN' }); }
      if (JSON.stringify(readback) !== JSON.stringify(next)) throw cause;
    }
  }
  return {
    load: () => run(async () => validateSyncState((await storage.load()).state)),
    receive: batch => { const packet = structuredClone(batch); return run(async () => {
      const before = await storage.load(); before.state = validateSyncState(before.state);
      const result = receiveSyncBatch(before.state, packet);
      await persist(before, result.state);
      // Only a durable success yields the cursor used as the next peer ACK.
      return result;
    }); },
    change: change => { const request = structuredClone(change); return run(async () => {
      const before = await storage.load(); before.state = validateSyncState(before.state);
      const state = recordSyncChange(before.state, request);
      await persist(before, state);
      return { state, cursor: syncVector(state) };
    }); },
  };
}
