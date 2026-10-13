import { createSourceSyncRepository } from './source-sync-repository.mjs';
import { validateSyncState } from './source-sync.mjs';

// This bridge stores only the reconciliation journal. It never edits source documents.
export function createNativeSourceSyncRepository(plugin, { context = 'formal' } = {}) {
  if (!['formal', 'practice'].includes(context) || typeof plugin?.syncLoad !== 'function'
      || typeof plugin?.syncCommit !== 'function') throw new TypeError('需要对应资料库的手机同步存储。');
  let identity;
  function fail(message, code = 'SYNC_INVALID') { throw Object.assign(new Error(message), { code }); }
  function revision(value) {
    if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value)
        || BigInt(value) > 9223372036854775807n) fail('手机同步存储版本无效。');
    return value;
  }
  function scopedState(value) {
    const state = validateSyncState(value);
    if (state.context !== context) fail('手机同步日记属于其他资料库。', 'SYNC_SCOPE');
    const current = `${state.libraryId}/${state.replicaId}`;
    if (identity && current !== identity) fail('手机同步库或设备身份发生变化，请重新核对。', 'SYNC_SCOPE');
    identity = current;
    return state;
  }
  function snapshot(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'revision') || !Object.hasOwn(value, 'state')) fail('手机同步存储回执无效。');
    const version = revision(value.revision);
    return { revision: version, state: scopedState(value.state) };
  }
  return createSourceSyncRepository({
    load: async () => snapshot(await plugin.syncLoad({ context })),
    async commit({ expectedRevision, state }) {
      const request = { context, expectedRevision: revision(expectedRevision), state: scopedState(state) };
      const committed = snapshot(await plugin.syncCommit(request));
      if (BigInt(committed.revision) <= BigInt(expectedRevision)
          || JSON.stringify(committed.state) !== JSON.stringify(request.state)) fail('手机同步提交尚未得到完整回执。', 'SYNC_COMMIT_UNKNOWN');
    },
  });
}
