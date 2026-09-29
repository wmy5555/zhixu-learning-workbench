import { hash, now, fail } from './store.mjs';

// These are reviewable suggestions from recorded behaviour, never mastery scores.
export function createLifecycle(deps) {
  function recommendations() {
    const store = deps.store;
    store.scan();
    const notes = store.list().filter(n => n.kind === 'knowledge' && n.meta.stage !== 'retired' && !n.meta.supersededBy);
    const uses = store.records('uses').filter(u => u.actualUse === true);
    const evidence = store.records('studyEvidence');
    const topicIds = new Set(store.list().filter(n => n.kind === 'topic' && !n.meta.paused).flatMap(n => n.meta.noteIds || []));
    const suggestions = [];
    const add = (note, type, targetStage, reason, signals, extra = {}) => {
      const id = hash(JSON.stringify([note.id, note.hash, type, targetStage, signals, extra]));
      if (store.get('recommendationActions', id)) return;
      suggestions.push({ id, noteId: note.id, title: note.title, stage: note.meta.stage, targetStage, type, reason, signals, ...extra });
    };
    for (const n of notes) {
      const limitations = deps.materialLimitations(n);
      const used = uses.filter(u => u.noteId === n.id);
      const learned = evidence.filter(e => e.noteId === n.id);
      const review = store.get('reviews', n.id);
      const sourceId = (n.meta.sources || []).find(s => s.role === 'input')?.id || n.meta.processKey?.split(':')[0];
      if (limitations.length && sourceId && store.row(sourceId)) {
        add(n, 'research', n.meta.stage, '资料已有变化或仍有待核验内容，先复查依据。', limitations, { sourceId });
        continue;
      }
      if (['integrated', 'core'].includes(n.meta.stage) && ['partial', 'incorrect', 'needs_practice', 'with_hints'].includes(review?.lastAssessment)) {
        add(n, 'relearn', 'learning', '最近的已结束练习出现遗漏，建议回到学习中针对练习。', [`最近表现：${review.lastAssessment}`, `练习：${review.lastSettledSession || review.lastSession || ''}`]);
      } else if (['candidate', 'reference'].includes(n.meta.stage) && (used.length || topicIds.has(n.id)) && ['explain', 'apply'].includes(n.meta.depth)) {
        add(n, 'promotion', 'learning', '这条知识已被实际采用或加入主题，并选择了需要理解的学习目标。', [`实际采用 ${used.length} 次`, topicIds.has(n.id) ? '属于正在使用的主题包' : '未加入活动主题包']);
      } else if (n.meta.stage === 'candidate' && ['aware', 'find'].includes(n.meta.depth) && !topicIds.has(n.id)) {
        add(n, 'reference', 'reference', '目前目标是了解或能找到，可先作为参考保留，减少每日练习负担。', [`当前目标：${n.meta.depth === 'aware' ? '了解' : '能找到'}`]);
      }
      // Only independent, completed sessions on different local days qualify.
      const days = new Set(learned.filter(e => e.assessment === 'correct' && e.reviewSettled === true && e.completedAt >= n.meta.confirmedAt && e.independent === true && ['explain', 'apply'].includes(e.depth)).map(e => e.day));
      const dayFormatter = new Intl.DateTimeFormat('en-CA', {timeZone:deps.settings().timezone,year:'numeric',month:'2-digit',day:'2-digit'});
      const useDays = new Set(used.filter(u=>Number.isFinite(Date.parse(u.at))&&u.at>=n.meta.confirmedAt).map(u=>dayFormatter.format(new Date(u.at))));
      if (n.meta.stage === 'integrated' && n.meta.confirmedAt && days.size >= 3 && useDays.size >= 2) {
        add(n, 'promotion', 'core', '已有跨日独立练习和多次实际输出记录，可由你决定是否作为核心知识。', [`跨日独立练习 ${days.size} 天`, `实际采用 ${useDays.size} 天`]);
      }
    }
    const bodies = new Map();
    for (const n of notes) {
      const key = n.body.trim().replace(/\s+/g, ' ');
      if (key.length < 20) continue;
      const other = bodies.get(key);
      if (other) add(n, 'merge', n.meta.stage, '两条知识正文相同，建议先预览合并并保留全部来源。', ['正文一致；尚未合并'], { relatedId: other.id });
      else bodies.set(key, n);
    }
    return { suggestions, summary: '建议来自已记录的学习目标、练习、实际采用和资料状态；接受前不会改变知识阶段，也不会启动付费调用。' };
  }
  function recommendationAction(id, { action } = {}) {
    if (!['accept', 'dismiss'].includes(action)) fail('建议操作无效。');
    const suggestion = recommendations().suggestions.find(s => s.id === id);
    if (!suggestion) fail('建议已变化或处理，请刷新后重试。', 'CONFLICT', 409);
    if (action === 'accept' && suggestion.type === 'merge') return deps.merge({ keepId: suggestion.relatedId, mergeId: suggestion.noteId, preview: true });
    if (action === 'accept' && suggestion.type === 'research') return { ...suggestion, requiresResearch: true };
    let note;
    if (action === 'accept') {
      const current = deps.getNote(suggestion.noteId);
      note = deps.promote(suggestion.noteId, { stage: suggestion.targetStage, reason: suggestion.reason, depth: current.meta.depth || 'explain' });
    }
    deps.store.put('recommendationActions', id, { id, action, noteId: suggestion.noteId, at: now() });
    return { ...suggestion, action, ...(note ? { note } : {}) };
  }
  return { recommendations, recommendationAction };
}
