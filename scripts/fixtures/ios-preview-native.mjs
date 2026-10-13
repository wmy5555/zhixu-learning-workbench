// Browser-only synthetic platform adapter. Never packaged by prepare-ios.mjs.
const copy = value => structuredClone(value);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const now = '2026-10-13T02:15:00Z';
const firstID = '11111111-1111-4111-8111-111111111111';
const fields = { platform: '合成阶段预览', author: '虚构演示者', url: '', date: '2024年春', locator: '演示第 1 段', topic: '资料与建议分离' };
const note = (id, title, body, meta = fields) => ({ id, hash: crypto.randomUUID(), title, body, kind: 'source', meta: { ...meta, stage: 'reference', privacy: 'local', effectivePrivacy: 'local' }, createdAt: now, updatedAt: now });
export function createPreviewPlugin() {
  const current = new Map(), history = new Map(), receipts = new Map(), previews = new Map();
  const first = note(firstID, '合成原文：把资料与建议分开', '这是一份虚构的阶段演示材料。\n\n原文应原样保留。AI 的建议、自己的回答和最终确认需要分别记录；页面预览不会生成真实学习成绩或供应商费用。');
  const old = { ...copy(first), hash: crypto.randomUUID(), body: '这是这份合成原文的最初版本。\n编辑后的内容应有独立版本，旧页面不能静默覆盖新内容。' };
  current.set(first.id, first); history.set(first.id, [old]);
  const second = note('22222222-2222-4222-8222-222222222222', '合成原文：离线与恢复边界', '浏览器预览仅用内存模拟原生接口。\n\n文件选择、后台恢复、真实键盘和 Keychain 仍需 iOS 环境验收。', { ...fields, date: '', topic: '平台限制' });
  current.set(second.id, second); history.set(second.id, []);
  let revision = 0;
  const controls = { failNextSave: false, dropNextSaveResponse: false, dropNextLearningResponse: false, changeSourceBeforeLearningCommit: false, calls: [] };
  const emptyLearning = () => ({ notes: [], records: {}, settings: {}, guide: {} });
  const learning = new Map(['formal', 'practice'].map(context => [context, { revision: 'empty', state: emptyLearning(), receipts: new Map() }]));
  function learningContext(context) { if (!learning.has(context)) fail('INVALID', '合成学习范围无效。'); return learning.get(context); }
  function learningMutation(method, input, state) {
    const currentLearning = learningContext(input.context), intent = JSON.stringify([method, { ...input, requestId: undefined }]);
    const prior = currentLearning.receipts.get(input.requestId);
    if (prior) { if (prior.intent !== intent) fail('REQUEST_CONFLICT', '合成学习回执不一致。'); return copy(prior.result); }
    if (currentLearning.revision !== input.expectedRevision) fail('CONFLICT', '合成学习库版本已改变。');
    if (controls.changeSourceBeforeLearningCommit) { controls.changeSourceBeforeLearningCommit = false; current.get(firstID).hash = crypto.randomUUID(); }
    if (input.context === 'formal' && method === 'learningCommit') {
      const versions = Object.fromEntries([...current.values()].map(note => [note.id, note.hash]));
      if (Object.keys(versions).length !== Object.keys(input.sourceVersions).length || Object.entries(versions).some(([id, hash]) => input.sourceVersions[id] !== hash)) fail('SOURCE_CHANGED', '合成原文在提交前发生变化。');
    }
    currentLearning.state = copy(state); currentLearning.revision = crypto.randomUUID();
    const result = { committed: true, revision: currentLearning.revision }; currentLearning.receipts.set(input.requestId, { intent, result });
    if (controls.dropNextLearningResponse) { controls.dropNextLearningResponse = false; fail('COMMIT_UNKNOWN', '合成学习已提交但响应丢失。'); }
    return copy(result);
  }
  function mutation(action, input, operation) {
    const intent = JSON.stringify([action, { ...input, requestId: undefined }]);
    if (receipts.has(input.requestId)) {
      const saved = receipts.get(input.requestId);
      if (saved.intent !== intent) fail('REQUEST_CONFLICT', '合成请求身份冲突。');
      return copy(saved.result);
    }
    const result = operation(); receipts.set(input.requestId, { intent, result: copy(result) }); revision++;
    return result;
  }
  const plugin = {
    async learningLoad({ context }) { const selected = learningContext(context); return { context, revision: selected.revision, state: copy(selected.state) }; },
    async learningCommit(input) { controls.calls.push(['learningCommit', copy(input)]); return learningMutation('learningCommit', input, input.state); },
    async learningReset(input) { if (input.context !== 'practice') fail('INVALID', '不能模拟清空正式库。'); return learningMutation('learningReset', input, emptyLearning()); },
    async exportLearningBackup({ context }) { learningContext(context); return { saved: true, simulated: true }; },
    async previewLearningBackup({ context }) {
      const selected = learningContext(context), token = crypto.randomUUID();
      previews.set(token, { learning: true, context, revision: selected.revision, deadline: Date.now() + 300000 });
      return { token, context, notes: 0, history: 0, canRestore: selected.state.notes.length === 0, identical: false, candidateState: emptyLearning(), simulated: true };
    },
    async restoreLearningBackup(input) {
      const selected = learningContext(input.context), previous = previews.get(input.token);
      if (!previous || !previous.learning || previous.context !== input.context || previous.revision !== selected.revision || previous.deadline <= Date.now()) fail('PREVIEW_EXPIRED', '合成学习备份预览已失效。');
      if (selected.state.notes.length) fail('CONFLICT', '合成学习库已有不同内容。');
      return { restored: true, simulated: true };
    },
    async list() { controls.calls.push('list'); return { notes: copy([...current.values()]) }; },
    async read({ id }) { controls.calls.push('read'); if (!current.has(id)) fail('NOT_FOUND', '合成原文不存在。'); return { note: copy(current.get(id)) }; },
    async save(input) {
      controls.calls.push(['save', input.requestId]);
      if (controls.failNextSave) { controls.failNextSave = false; fail('STORE_ERROR', '故障演示：写入前失败，草稿仍在。'); }
      const result = mutation('save', input, () => {
        const old = input.id ? current.get(input.id) : null;
        if (input.id && (!old || old.hash !== input.expectedHash)) fail('CONFLICT', '合成原文已修改，请核对版本。');
        const next = note(old?.id || crypto.randomUUID(), input.title, input.body, input.meta);
        next.createdAt = old?.createdAt || now;
        if (old) history.get(old.id).push(copy(old)); else history.set(next.id, []);
        current.set(next.id, next); return { note: copy(next) };
      });
      if (controls.dropNextSaveResponse) { controls.dropNextSaveResponse = false; fail('COMMIT_UNKNOWN', '故障演示：已保存但响应丢失；同一草稿重试复用请求身份。'); }
      return result;
    },
    async history({ id }) { controls.calls.push('history'); return { versions: copy(history.get(id) || []).reverse() }; },
    async restoreVersion(input) {
      return mutation('restoreVersion', input, () => {
        const old = current.get(input.id), version = (history.get(input.id) || []).find(note => note.hash === input.versionId);
        if (!old || old.hash !== input.expectedHash || !version) fail('CONFLICT', '合成历史或当前版本不匹配。');
        history.get(input.id).push(copy(old));
        const next = { ...copy(version), hash: crypto.randomUUID(), updatedAt: now };
        current.set(input.id, next); return { note: next };
      });
    },
    async pickSource() { return { name: '合成选择文件.txt', text: '这是模拟文件选择返回的合成正文。\n\n请先核对草稿，再保存。没有访问 Windows 或 iOS 的个人文件。' }; },
    async exportSource({ id, expectedHash }) { if (current.get(id)?.hash !== expectedHash) fail('CONFLICT', '合成导出版本已改变。'); return { saved: true, simulated: true }; },
    async exportBackup() { return { saved: true, simulated: true }; },
    async rebuildIndex() { return { rebuilt: current.size, simulated: true }; },
    async previewBackup() {
      const token = crypto.randomUUID();
      previews.set(token, { revision, deadline: Date.now() + 300000 });
      return { token, newCount: current.has('33333333-3333-4333-8333-333333333333') ? 0 : 1, sameCount: 0, versionCount: 0, conflicts: [] };
    },
    async restoreBackup(input) {
      return mutation('restoreBackup', input, () => {
        const preview = previews.get(input.token);
        if (!preview || preview.revision !== revision || preview.deadline <= Date.now()) fail('PREVIEW_EXPIRED', '合成预览已失效，请重新核对。');
        const id = '33333333-3333-4333-8333-333333333333';
        const exists = current.has(id);
        if (!exists) { current.set(id, note(id, '合成备份恢复条目', '这条内容由明确标记的内存模拟恢复。\n没有执行原生文件恢复或跨设备同步。')); history.set(id, []); }
        previews.delete(input.token); return { imported: exists ? 0 : 1, same: exists ? 1 : 0, conflicts: 0 };
      });
    },
  };
  return { plugin, controls };
}
