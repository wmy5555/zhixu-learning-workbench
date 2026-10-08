import { createAndroidLearning, validateLearningState } from './android-learning.mjs';

const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const noteRoute = new RegExp(`^/api/notes/(${UUID})(?:/(extract|promote|confirm|evidence))?$`);
const studyRoute = new RegExp(`^/api/study/(${UUID})(?:/(answer|hint|confirm|finish|mistake))?$`);
const topicRoute = new RegExp(`^/api/topics/(${UUID})(/action)?$`);
const mistakeRoute = new RegExp(`^/api/mistakes/(${UUID})/action$`);
const historyRoute = new RegExp(`^/api/history/(${UUID})(/restore)?$`);
const nativeActions = {
  '/api/android/source-file': 'pickSource',
  '/api/android/source-export': 'exportSource',
  '/api/android/backup-export': 'exportBackup',
  '/api/android/backup-preview': 'previewBackup',
  '/api/android/backup-restore': 'restoreBackup',
};
const learningFiles = {
  '/api/android/learning-backup-export': 'exportLearningBackup',
  '/api/android/learning-backup-preview': 'previewLearningBackup',
  '/api/android/learning-backup-restore': 'restoreLearningBackup',
};
function unavailable() {
  throw Object.assign(new Error('此 Android 版本尚未接入这项功能。'), { code: 'ANDROID_UNAVAILABLE' });
}
function invalid(message = '操作参数无效，请重新打开页面后重试。') {
  throw Object.assign(new Error(message), { code: 'VALIDATION' });
}
function fields(payload, allowed) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Object.keys(payload).some(key => !allowed.includes(key))) invalid();
}
function sourceInput(payload) {
  if (payload.process || payload.research || payload.captureMode !== 'text'
      || !Array.isArray(payload.items) || payload.items.length !== 1) return unavailable();
  const item = payload.items[0];
  if (!item || item.privacy !== 'local') return unavailable();
  const { title, body, platform = '', author = '', url = '', date = '', locator = '', topic = '' } = item;
  return { title, body, meta: { platform, author, url, date, locator, topic } };
}
function guideSummary(service) {
  const notes = service.list({}), sessions = Object.values(service.state.records.sessions || {});
  const steps = [
    { id: 'source', label: '保存一份原文', completed: notes.some(note => note.kind === 'source') },
    { id: 'knowledge', label: '手动整理一条知识，保留事实或观点分类', completed: notes.some(note => note.kind === 'knowledge') },
    { id: 'answer', label: '加入学习后，留下自己的回答', completed: sessions.some(session => session.turns?.length > 0) },
    { id: 'finish', label: '结束练习并保存记录（尚未批改）', completed: sessions.some(session => session.status === 'completed') },
  ];
  return { steps, completed: steps.every(step => step.completed), dismissed: service.state.guide.dismissed === true };
}

// Serialize reads and writes; return success only after a native atomic commit.
// Native revisions also reject stale writes from another WebView.
export function createAndroidTransport(plugin, { clock } = {}) {
  let tail = Promise.resolve();
  async function dispatch(path, options) {
    if (typeof path !== 'string' || !path.startsWith('/api/') || /[\u0000-\u0020\\#]/.test(path)) return unavailable();
    const url = new URL(path, 'https://localhost');
    if (url.origin !== 'https://localhost' || url.pathname !== path.split('?')[0]) return unavailable();
    const method = options.method || 'GET', payload = options.body || {};
    if (!['GET', 'POST', 'PUT'].includes(method)) return unavailable();
    fields(payload, Object.keys(payload));
    let route = url.pathname, context = 'formal';
    if (route.startsWith('/api/practice/')) {
      const scoped = route.match(/^\/api\/practice\/android-local(\/.*)$/);
      if (!scoped) return unavailable();
      route = `/api${scoped[1]}`; context = 'practice';
    }
    if (Object.hasOwn(nativeActions, route)) {
      if (method !== 'POST' || url.search || context === 'practice' && route !== '/api/android/source-file') return unavailable();
      return plugin[nativeActions[route]](payload);
    }
    if (Object.hasOwn(learningFiles, route)) {
      if (method !== 'POST' || url.search) return unavailable();
      fields(payload, route.endsWith('-restore') ? ['token'] : []);
      const result = await plugin[learningFiles[route]]({ ...payload, context });
      if (route.endsWith('-preview')) {
        // Use the exact WebView schema before exposing a token the UI could restore.
        // This also covers platform differences in Date.parse and Intl time zones.
        const candidate = validateLearningState(result.candidateState);
        if (result.context !== context || context === 'formal' && candidate.notes.some(note => note.kind === 'source')) invalid('备份的资料库类型不一致。');
        const { candidateState, ...summary } = result;
        return summary;
      }
      return result;
    }
    const history = route.match(historyRoute);
    if (history) {
      if (context !== 'formal' || url.search) return unavailable();
      if (method === 'GET' && !history[2]) return plugin.history({ id: history[1] });
      if (method === 'POST' && history[2]) return (await plugin.restoreVersion({ ...payload, id: history[1] })).note;
      return unavailable();
    }
    if (route === '/api/import' && method === 'POST' && !url.search && context === 'formal') {
      return { notes: [(await plugin.save(sourceInput(payload))).note], jobs: [] };
    }
    if (route === '/api/android/practice') {
      if (url.search || !['GET', 'POST'].includes(method)) return unavailable();
      fields(payload, method === 'GET' ? [] : ['action']);
      if (method === 'POST' && !['start', 'reset'].includes(payload.action)) invalid();
      if (payload.action === 'reset' && context !== 'practice') return unavailable();
      let loaded = await plugin.learningLoad({ context: 'practice' });
      if (payload.action === 'reset') loaded = await plugin.learningReset({ context: 'practice', expectedRevision: loaded.revision });
      if (payload.action === 'start' && !loaded.state.guide?.started) {
        const practice = createAndroidLearning({ state: structuredClone(loaded.state), practice: true, clock });
        practice.saveSource({ title: '合成练习材料：我的学习安排反思', body: '这是用于熟悉操作的虚构个人反思，不是经过验证的学习规律。\n\n我发现自己常把收集材料当成已经学会。我想试试每天只选一小段，用自己的话解释，再写下仍不明白的地方。这是我的个人打算，是否适合自己还需要观察。', meta: { platform: '知序本地练习', author: '虚构练习者', topic: '个人反思' } });
        practice.updateGuide({ started: true });
        loaded = await plugin.learningCommit({ context: 'practice', expectedRevision: loaded.revision, state: practice.state });
      }
      return { practiceId: 'android-local', exists: loaded.state.guide?.started === true || loaded.state.notes.length > 0,
        summary: { notes: loaded.state.notes.length, sessions: Object.keys(loaded.state.records.sessions || {}).length } };
    }
    const note = route.match(noteRoute), study = route.match(studyRoute), topic = route.match(topicRoute), mistake = route.match(mistakeRoute);
    const plan = route.match(/^\/api\/today\/([^/]+)\/action$/);
    const getRoutes = ['/api/bootstrap', '/api/notes', '/api/library', '/api/today', '/api/study', '/api/mistakes', '/api/topics', '/api/settings', '/api/android/guide'];
    const isGet = method === 'GET' && (getRoutes.includes(route) || note && (!note[2] || note[2] === 'evidence') || study && !study[2]);
    const isWrite = method === 'POST' && (route === '/api/import' || route === '/api/today/generate' || route === '/api/study/start' || route === '/api/topics' || route === '/api/android/guide' || plan || note?.[2] && note[2] !== 'evidence' || study?.[2] || topic?.[2] || mistake)
      || method === 'PUT' && (route === '/api/settings' || note && !note[2] || topic && !topic[2]);
    if (!isGet && !isWrite || url.search && !['/api/notes', '/api/library'].includes(route)) return unavailable();
    const loaded = await plugin.learningLoad({ context });
    const sources = context === 'formal' ? (await plugin.list({})).notes : [];
    if (context === 'formal' && note && (note[2] === 'extract' || method === 'GET' && !loaded.state.notes.some(item => item.id === note[1]))) {
      const full = (await plugin.read({ id: note[1] })).note;
      const index = sources.findIndex(item => item.id === full.id);
      if (index < 0) sources.push(full); else sources[index] = full;
    }
    const before = JSON.stringify(loaded.state);
    const service = createAndroidLearning({ state: structuredClone(loaded.state), sources, practice: context === 'practice', clock });
    let result;
    if (route === '/api/bootstrap') {
      result = service.bootstrap();
      result.capabilities = { ...result.capabilities, ai: false, search: false, fetch: false, embedding: false, localLearning: true };
      result.jobs = []; result.conflicts = [];
      result.stats = { ...result.stats, notes: result.notes.length, pending: 0 };
      result.practice = context === 'practice' ? { id: 'android-local', local: true } : null;
    } else if (route === '/api/notes' || route === '/api/library') {
      const filters = Object.fromEntries(['q', 'kind', 'stage'].map(key => [key, url.searchParams.get(key) || '']));
      result = route === '/api/notes' ? { notes: service.list(filters) } : service.library(filters);
    } else if (route === '/api/import') result = { notes: [service.saveSource(sourceInput(payload))], jobs: [] };
    else if (route === '/api/today' || route === '/api/today/generate') result = service.learning.today();
    else if (plan) result = service.learning.planAction(decodeURIComponent(plan[1]), payload);
    else if (route === '/api/study/start') result = service.learning.startStudy(payload);
    else if (route === '/api/study') result = { sessions: Object.values(service.state.records.sessions || {}).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 50) };
    else if (study) {
      const actions = { answer: 'answerStudy', hint: 'hintStudy', confirm: 'confirmStudy', finish: 'finishStudy' };
      result = study[2] === 'mistake' ? service.createMistake(study[1], payload)
        : study[2] ? service.learning[actions[study[2]]](study[1], payload) : service.learning.session(study[1]);
    } else if (route === '/api/mistakes') result = { mistakes: service.list({ kind: 'mistake' }) };
    else if (mistake) result = service.learning.mistakeAction(mistake[1], payload);
    else if (route === '/api/topics') result = method === 'GET' ? { topics: service.learning.topics() } : service.learning.createTopic(payload);
    else if (topic) result = topic[2] ? service.learning.topicAction(topic[1], payload) : service.learning.updateTopic(topic[1], payload);
    else if (route === '/api/settings') result = method === 'GET' ? service.settings() : service.updateSettings(payload);
    else if (route === '/api/android/guide') {
      if (method === 'POST') { fields(payload, ['dismissed']); service.updateGuide(payload); }
      result = guideSummary(service);
    } else if (note) {
      if (!note[2] && method === 'PUT' && context === 'formal' && !service.state.notes.some(item => item.id === note[1])) {
        return (await plugin.save({ ...payload, id: note[1] })).note;
      }
      const actions = { extract: 'extractSource', promote: 'promote', confirm: 'confirmNote', evidence: 'evidence' };
      result = note[2] ? service[actions[note[2]]](note[1], payload)
        : method === 'GET' ? service.getNote(note[1]) : service.editNote(note[1], payload);
    } else return unavailable();
    // Nothing optimistic escapes: the native manifest commits records and documents together.
    if (JSON.stringify(service.state) !== before) await plugin.learningCommit({ context, expectedRevision: loaded.revision, state: service.state });
    return structuredClone(result);
  }
  return {
    runtime: Object.freeze({ kind: 'android-prototype', localLearning: true }),
    async startSession() { return { local: true }; },
    request(path, options = {}) {
      const captured = { ...options, body: structuredClone(options.body ?? {}) };
      const operation = tail.then(() => dispatch(path, captured));
      tail = operation.catch(() => {});
      return operation;
    },
  };
}
