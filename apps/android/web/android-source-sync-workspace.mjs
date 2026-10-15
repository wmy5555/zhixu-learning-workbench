import { createNativeSourceSyncRepository } from './source-sync-native.mjs';
import { inspectSyncSource, listSyncSources, validateSyncSource } from './source-sync.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sourceFields = ['platform', 'author', 'url', 'date', 'locator', 'topic'];
function fail(message, code = 'SYNC_INVALID') { throw Object.assign(new Error(message), { code }); }
function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== allowed.length
      || allowed.some(key => !Object.hasOwn(value, key))) fail('请重新打开同步预览后操作。');
}
function id(value) { if (typeof value !== 'string' || !UUID.test(value)) fail('原文身份无效。'); return value; }
function original(note) {
  if (!note || note.kind !== 'source' || typeof note.hash !== 'string' || !note.hash) fail('原文快照无效。');
  id(note.id);
  return validateSyncSource({ title: note.title, body: note.body,
    source: Object.fromEntries(sourceFields.map(key => [key, note.meta?.[key] ?? ''])) });
}

// The transport serializes all operations. No network or learned/AI/permission fields enter this workspace.
export function createAndroidSourceSyncWorkspace(plugin) {
  const repository = createNativeSourceSyncRepository(plugin, { context: 'formal' });
  return {
    async summary() {
      const state = await repository.load(), result = await plugin.list({});
      if (!Array.isArray(result?.notes) || result.notes.length > 100) fail('手机原文列表无效或超限。');
      const sources = new Map();
      for (const note of result.notes) {
        id(note.id); if (sources.has(note.id) || note.kind !== 'source' || typeof note.title !== 'string') fail('手机原文列表无效。');
        sources.set(note.id, { sourceId: note.id, title: note.title, local: true, status: 'absent', versions: 0 });
      }
      for (const view of listSyncSources(state)) {
        const existing = sources.get(view.sourceId);
        sources.set(view.sourceId, { sourceId: view.sourceId, title: existing?.title
          || view.versions.find(version => version.value)?.value.title || '已删除的原文记录',
        local: !!existing, status: view.status, versions: view.versions.length });
      }
      return { context: 'formal', connected: false, sources: [...sources.values()], events: state.events.length };
    },
    async preview({ sourceId }) {
      id(sourceId);
      const preview = await plugin.syncSourcePreview({ context: 'formal', sourceId });
      if (preview?.context !== 'formal' || preview.sourceId !== sourceId) fail('原文预览不属于当前资料库。', 'SYNC_SCOPE');
      return preview;
    },
    async stage(request) {
      fields(request, ['sourceId', 'expectedHash', 'expectedHeads']); id(request.sourceId);
      if (typeof request.expectedHash !== 'string' || !request.expectedHash) fail('请先核对手机原文。');
      const note = (await plugin.read({ id: request.sourceId })).note;
      if (note?.hash !== request.expectedHash || note.id !== request.sourceId) fail('手机原文已修改，请重新预览。', 'SYNC_STALE');
      const value = original(note), current = await repository.load(), view = inspectSyncSource(current, request.sourceId);
      if (!Array.isArray(request.expectedHeads) || JSON.stringify([...request.expectedHeads].sort())
          !== JSON.stringify(view.versions.map(version => version.id))) fail('同步版本已变化，请重新预览。', 'SYNC_STALE');
      if (view.status === 'present' && JSON.stringify(view.versions[0].value) === JSON.stringify(value)) return { unchanged: true };
      await repository.change({ sourceId: request.sourceId, expectedHeads: request.expectedHeads, operation: 'put', value });
      return { unchanged: false };
    },
    async resolve(request) {
      fields(request, ['sourceId', 'eventId', 'expectedHeads']); id(request.sourceId);
      const state = await repository.load(), view = inspectSyncSource(state, request.sourceId);
      const version = view.versions.find(version => version.id === request.eventId);
      if (view.status !== 'conflict' || !version) fail('冲突版本已变化，请重新预览。', 'SYNC_STALE');
      // Deletion materialization remains unavailable; its journal and every prior body stay intact.
      if (version.operation !== 'put') fail('删除应用尚未接入；删除记录和旧原文仍保留。', 'ANDROID_UNAVAILABLE');
      await repository.change({ sourceId: request.sourceId, expectedHeads: request.expectedHeads,
        operation: version.operation, value: version.value });
      return { resolved: true };
    },
    async apply(request) {
      fields(request, ['token']); id(request.token);
      return plugin.syncSourceApply({ context: 'formal', token: request.token });
    },
  };
}
