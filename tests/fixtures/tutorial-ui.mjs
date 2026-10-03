// Synthetic UI data only. No provider requests, credentials, or user records.
export function tutorialFixture(step = {}) {
  const roles = Object.fromEntries(['capturedSource', 'source', 'aware', 'find', 'explain', 'apply', 'evidenceKnowledge', 'staleKnowledge', 'versionNote', 'mergeKeep', 'mergeOther', 'deleteNote', 'skipKnowledge', 'pauseKnowledge', 'mistake', 'createdTopic', 'topicBlocked', 'hintSession', 'relationAccept', 'relationReject', 'relationIgnore', 'coreKnowledge', 'dismissKnowledge', 'failedJob', 'cancelJob', 'proposal', 'proposalReject', 'linkTopic', 'conflictNote'].map(role => [role, `fixture-${role}`]));
  const notes = Object.entries(roles).map(([role, id]) => ({ id, kind: ['source', 'capturedSource'].includes(role) ? 'source' : 'knowledge', title: `预设界面检查 · ${role}`, body: '这是原创虚构的界面检查材料。先整理线索，再用自己的话说明。', hash: 'fixture-hash', meta: { privacy: 'local', stage: 'learning', depth: 'explain', platform: '虚构读书任务', sources: [{ id: roles.source, role: 'input' }] }, children: [], jobs: [] }));
  const sessions = [{ id: roles.hintSession, noteId: roles.explain }, { id: 'fixture-session', noteId: roles.explain }].map(session => ({ ...session, title: '预设演示练习', status: step.id === 'study-hide' ? 'reading' : 'feedback', material: '原创虚构学习材料', question: '请用自己的话解释。', turns: step.id === 'study-hide' ? [] : [{ answer: '预设演示回答', feedback: { assessment: 'correct', summary: '仅用于界面验证的受控反馈' } }] }));
  const topics = ['createdTopic', 'topicBlocked'].map(role => ({ id: roles[role], title: '预设主题', body: '虚构读书分享', noteIds: [roles.explain], members: [{ id: roles.explain, title: '解释示例', available: true }], progress: { total: 1, completedCount: 0, nextNoteId: roles.explain } }));
  const drafts = [{ id: 'fixture-draft', title: '预设草稿', body: '仅用于界面检查的虚构草稿。', citations: [{ id: roles.explain, title: '解释示例', excerpt: '虚构摘录' }], usedIds: [] }];
  const today = { items: ['explain', 'apply', 'skipKnowledge', 'pauseKnowledge'].map(role => ({ id: `plan-${role}`, noteId: roles[role], title: `预设安排 · ${role}`, kind: 'study', state: 'pending', minutes: 5, reason: '受控检查安排' })) };
  const settings = { dailyMinutes: 25, timezone: 'Asia/Shanghai', ai: {}, embedding: {}, search: {}, fetch: {}, mcp: {} };
  const bootstrap = { notes, settings, capabilities: { ai: true }, conflicts: [{ id: roles.conflictNote, title: '预设冲突', message: '仅用于界面检查' }] };
  const reads = [];
  const data = {
    bootstrap: () => bootstrap, today: () => today, settings: () => settings, prompts: () => ({ prompts: [] }),
    notes: () => ({ notes }), note: id => { const note = notes.find(note => note.id === id); if (!note) throw new Error('预设条目不存在'); return note; },
    library: () => ({ groups: [{ source: notes[0], children: [notes.find(note => note.id === roles.explain)], jobs: [] }], standalone: notes.filter(note => note.kind === 'knowledge') }),
    recommendations: () => ({ suggestions: [] }), history: () => ({ versions: [{ id: 'fixture-version', body: '旧版虚构内容', createdAt: '2026-10-01T00:00:00Z' }] }),
    studySessions: () => ({ sessions }), study: id => sessions.find(session => session.id === id), mistakes: () => ({ mistakes: [] }),
    topics: () => ({ topics }), drafts: () => ({ drafts }), relations: () => ({ relations: [] }), search: () => ({ results: [] }),
    jobs: () => ({ jobs: [] }), diagnostics: () => ({ storage: { vaultDir: 'synthetic/practice-vault' }, index: { pending: 1 }, calls: [] }), proposals: () => ({ proposals: [] }),
    linksPreview: () => ({ changed: true, before: '虚构旧链接', body: '虚构新链接' }), evidence: () => ({ evidence: [], limitations: [] }),
    usage: () => ({ budget: {}, totals: {}, daily: [], models: [], calls: [] }),
  };
  const api = Object.fromEntries(Object.entries(data).map(([name, read]) => [name, async (...args) => { reads.push({ name, args }); return structuredClone(read(...args)); }]));
  api.getContext = () => ({ practiceId: 'fixture-practice', pending: 0 });
  api.onboarding = async () => ({});
  return { api, roles, notes, sessions, drafts, bootstrap, reads };
}
