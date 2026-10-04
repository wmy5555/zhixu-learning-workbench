import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createService } from './service.mjs';
import { atomicWrite, fail, hash } from './store.mjs';
import { chapters, getCurriculum } from '../public/onboarding-curriculum.mjs';
import { seedPractice, loadCase, caseIds } from './onboarding-cases.mjs';
import { getMaterial, customSample } from '../public/onboarding-materials.mjs';

const capabilityGroups = ['ai', 'embedding', 'search', 'fetch'];
const isId = id => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id);
const iso = () => new Date().toISOString();
const emptyRecord = () => ({ version: 1, practice: null, receipts: {}, events: {}, dismissed: false });
const checkAliases = {
  'ai-test': 'model-test', 'embedding-test': 'test-embedding', 'search-test': 'test-search', 'fetch-test': 'test-fetch',
  'research-done': 'research', 'promote-learning': 'stage-learning', 'promote-reference': 'stage-reference', 'promote-retired': 'stage-retired',
  'history-open': 'history-read', 'recommendations-open': 'recommendations-read', 'plan-defer': 'today-defer', 'plan-skip': 'today-skip', 'plan-pause': 'today-pause',
  'review-finish': 'review', 'mistake-study': 'mistake-practice', 'topics-done': 'topic-suggest', 'index-done': 'index-update',
  'relations-local': 'relate-local', 'discovery-done': 'discover-local', 'ask-answer': 'output-answer', 'ask-outline': 'output-outline', 'ask-draft': 'output-draft',
  'draft-edit': 'draft-save', 'backup-download': 'backup',
  'evidence-open': 'evidence',
};
const clientEvents = new Set(['study-hide', 'study-resume', 'jobs-filter', 'job-open', 'calls-open', 'appearance-theme', 'appearance-accent', 'search-filter', 'library-filter', 'topic-open', 'conflicts-open', 'topic-copy', 'topic-split', 'topic-study', 'prompts-reset', 'mistake-open', 'recommendations-open', 'history-open']);

// Progress and connection receipts live outside backups; object mappings accompany practice files.
export function createOnboarding({ dataDir, mainService, serviceFactory = createService }) {
  const root = path.resolve(dataDir, 'onboarding');
  const stateFile = path.join(root, 'state.json');
  let record = emptyRecord(), runtime = null, closed = false, transitioning = false;
  const steps = () => getCurriculum(record.practice?.materialId).flatSteps;
  const evidenceRole = step => step.noteRole || (record.practice?.materialId && step.id === 'capture-save' ? 'capturedSource' : null);
  function safePath(file) {
    const relative = path.relative(path.resolve(dataDir), file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail('练习路径无效。', 'PRACTICE_PATH', 403);
    let cursor = path.resolve(dataDir);
    for (const part of relative.split(path.sep)) {
      cursor = path.join(cursor, part);
      if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) fail('练习目录不能使用文件链接。', 'PRACTICE_PATH', 403);
    }
    return file;
  }
  function assertVaultIsolation(vaultDir = mainService.store.vaultDir) {
    const canonical = input => {
      let existing = path.resolve(input);
      const pending = [];
      while (!fs.existsSync(existing)) {
        const parent = path.dirname(existing);
        if (parent === existing) fail('资料目录无法核对。', 'PRACTICE_PATH', 403);
        pending.unshift(path.basename(existing)); existing = parent;
      }
      return path.join(fs.realpathSync(existing), ...pending);
    };
    const within = (parent, child) => {
      const relative = path.relative(parent, child);
      return !relative || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    };
    const formal = canonical(vaultDir), practice = canonical(root);
    if (within(formal, practice) || within(practice, formal)) {
      fail('正式 Vault 与新手练习目录重叠。请选择与练习目录分开的正式 Vault，避免两边资料混在一起。', 'PRACTICE_VAULT_OVERLAP', 409);
    }
  }
  safePath(stateFile);
  if (fs.existsSync(stateFile)) {
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (saved.version !== 1 || (saved.practice && !isId(saved.practice.id))) fail('练习进度文件无效。', 'PRACTICE_STATE');
    record = { ...emptyRecord(), ...saved };
    if (record.practice) record.practice.status = 'paused';
  }
  const persist = () => {
    if (runtime?.anchor && record.practice?.status === 'active') { record.practice.clockAt = learningNow().toISOString(); runtime.anchor = Date.now(); }
    // Object identities travel with their files during restore; completion evidence stays in state.json.
    if (runtime && record.practice) runtime.service.store.put('onboardingContext', 'identity', { roles: record.practice.roles, cases: record.practice.cases, materialId: record.practice.materialId || null, learningTime: record.practice.clockAt });
    safePath(stateFile); atomicWrite(stateFile, JSON.stringify(record));
  };
  const fingerprint = capability => {
    const cfg = mainService.settings();
    return hash(JSON.stringify([cfg[capability === 'model' ? 'ai' : capability] || {}, record.revisions?.[capability] || 0]));
  };
  const ready = capability => {
    capability = capability === 'ai' ? 'model' : capability;
    return record.receipts[capability]?.fingerprint === fingerprint(capability)
      && mainService.settings()[capability === 'model' ? 'ai' : capability]?.enabled === true;
  };
  const requirePractice = id => {
    if (!isId(id) || record.practice?.id !== id) fail('练习空间已重置或不存在，请从引导入口继续。', 'PRACTICE_NOT_FOUND', 404);
    return record.practice;
  };
  function learningNow() {
    const saved = record.practice?.clockAt || iso();
    return new Date(Date.parse(saved) + (runtime?.anchor && record.practice?.status === 'active' ? Date.now() - runtime.anchor : 0));
  }
  function freezeClock() {
    if (record.practice) record.practice.clockAt = learningNow().toISOString();
    if (runtime) runtime.anchor = 0;
  }
  function open() {
    assertVaultIsolation();
    if (runtime) return runtime;
    const p = record.practice;
    if (!p) fail('请先开始新手引导。', 'PRACTICE_NOT_FOUND', 404);
    const folder = safePath(path.join(root, p.id));
    const instance = { service: null, requests: 0, anchor: 0, pumping: false };
    instance.service = serviceFactory({ dataDir: safePath(path.join(folder, 'data')), vaultDir: safePath(path.join(folder, 'vault')), practice: true,
      aiOverride: mainService.ai, getExternalSettings: () => mainService.settings(), learningClock: learningNow,
      getPracticeQuestion: note => {
        const material = getMaterial(p.materialId);
        if (!material || note.meta.presetCase) return null;
        if (p.roles.apply === note.id && note.meta.depth === 'apply') return material.transfer + (material.transferCode ? `\n\n${material.transferCode}` : '');
        if (p.roles.explain !== note.id) return null;
        const timezone = instance.service.settings().timezone;
        const day = date => new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(date));
        const previous = instance.service.store.records('sessions').some(session => session.noteId === note.id && !session.presetCase && session.completion?.reviewSettled && day(session.completedAt) !== day(learningNow()));
        return previous ? material.review : material.recall;
      } });
    runtime = instance;
    return runtime;
  }
  function assertIdle() {
    if (transitioning || runtime?.requests || runtime?.pumping || runtime?.service.processing || runtime?.service.hasPendingOperations) {
      fail('请等待当前练习操作结束后再切换、恢复或推进时间。', 'PRACTICE_BUSY', 409);
    }
  }
  function noteEvent(name, details = {}) {
    const p = record.practice;
    if (!p) return;
    p.events ||= {};
    const old = p.events[name];
    p.events[name] = [...(Array.isArray(old) ? old : old ? [old] : []), { at: iso(), ...details }].slice(-160);
  }
  function exists(id) { return Boolean(id && runtime?.service.store.row(id)); }
  function facts() {
    if (!runtime) return null;
    const service = runtime.service, store = service.store;
    return { service, store, notes: store.list(), jobs: store.records('jobs'), sessions: store.records('sessions'), reviews: store.records('reviews'), drafts: store.records('drafts') };
  }
  function matchingEvents(checkId, step = {}) {
    const p = record.practice, value = p?.events?.[checkId] || record.events?.[checkId];
    const items = Array.isArray(value) ? value : value ? [value] : [];
    const role = evidenceRole(step), roleId = p?.roles?.[role];
    if (p?.materialId && role && !roleId) return [];
    return items.filter(event => {
      if (!step.caseId && event.presetCase) return false;
      if (step.caseId && (!p?.cases?.[step.caseId] || event.at < p.cases[step.caseId].at)) return false;
      if (roleId && ![event.noteId, ...(event.entities || [])].includes(roleId)) return false;
      return !event.noteId || exists(event.noteId) || ['note-delete'].includes(checkId);
    });
  }
  function check(checkId, f, step = {}) {
    if (!checkId) return false;
    const role = evidenceRole(step);
    if (record.practice?.materialId && role && !record.practice.roles[role]) return false;
    checkId = checkAliases[checkId] || checkId;
    if (checkId === 'model-test') return ready('model');
    if (checkId.startsWith('test-')) return ready(checkId.slice(5));
    const events = matchingEvents(checkId, step);
    if (checkId.startsWith('depth-')) {
      const depth = checkId.slice(6), stages = ['aware','find'].includes(depth) ? ['reference'] : ['learning'];
      return events.some(event => event.depth === depth && stages.includes(event.stage));
    }
    if (events.length) return true;
    if (!f) return false;
    const preset = record => Boolean(record.presetCase || (record.noteId && exists(record.noteId) && f.store.read(record.noteId).meta.presetCase));
    const targetId = record.practice?.roles?.[role];
    const realSessions = f.sessions.filter(s => !preset(s) && (!targetId || s.noteId === targetId || s.id === targetId));
    const realEvidence = f.store.records('studyEvidence').filter(e => !preset(e) && (!targetId || e.noteId === targetId));
    const done = type => f.jobs.some(j => j.type === type && j.state === 'done' && !j.presetCase && (!targetId || j.payload?.noteId === targetId));
    const tests = {
      process: () => done('process'),
      'process-done': () => done('process'),
      'study-feedback': () => realSessions.some(s => s.turns?.some(t => t.feedback) || s.feedback),
      'study-followup': () => realSessions.some(s => s.turns?.filter(t => t.feedback).length >= 2),
      'study-finish': () => realSessions.some(s => s.status === 'completed' && !s.completion?.abandoned),
      'study-confirm': () => f.notes.some(n => n.meta.confirmedAt && !n.meta.presetCase && (!targetId || n.id === targetId)),
      review: () => realEvidence.some(e => e.reviewSettled && realEvidence.some(other => other.noteId === e.noteId && other.day !== e.day)),
      'topic-suggest': () => done('topics'),
      'index-update': () => ready('embedding') && done('index') && Number(f.service.diagnostics().index.vectors) > 0,
      'discover-local': () => f.jobs.some(j => j.type === 'discover' && j.state === 'done' && !j.payload.useAI),
      'discover-ai': () => f.jobs.some(j => j.type === 'discover' && j.state === 'done' && j.payload.useAI),
      'relations-done': () => f.jobs.some(j => j.type === 'relate' && j.state === 'done' && j.payload.useAI),
      'review-same-day': () => {
        return realEvidence.some(e => realEvidence.some(other => other.sessionId !== e.sessionId && other.noteId === e.noteId && other.day === e.day));
      },
      research: () => ready('search') && ready('fetch') && f.jobs.some(j => j.type === 'process' && j.state === 'done' && j.payload.research === true && !j.presetCase && (!targetId || j.payload.noteId === targetId)),
    };
    return Boolean(tests[checkId]?.());
  }
  function progress() {
    const p = record.practice, result = {}, f = facts();
    for (const step of steps()) {
      let status = 'pending';
      const events = matchingEvents(checkAliases[step.check] || step.check, step);
      if (check(step.check, f, step) && (!step.caseId || p?.cases?.[step.caseId])) status = step.kind === 'case' || step.caseId || events.length && events.every(e => e.presetCase) ? 'demonstrated' : 'done';
      else if (p?.acknowledged?.[step.id]) status = 'demonstrated';
      else if (step.needs?.some(cap => !ready(cap))) status = 'needs_setup';
      result[step.id] = { status };
    }
    return result;
  }
  function state() {
    const p = record.practice;
    if (p && !runtime) open();
    const states = progress(), counts = { done: 0, demonstrated: 0, pending: 0, needs_setup: 0 };
    for (const item of Object.values(states)) counts[item.status]++;
    const mcpCalls = mainService.store.records('mcpCalls').filter(call => (call.client === undefined || call.client === 'local') && Number.isFinite(Date.parse(call.at))).sort((a, b) => b.at.localeCompare(a.at));
    const externalConnections = {
      mcp: { status: mcpCalls.length ? 'observed' : p?.acknowledged?.['mcp-read'] ? 'reported' : 'pending', lastSeenAt: mcpCalls[0]?.at || null, operations: [...new Set(mcpCalls.map(call => call.operation).filter(op => ['search', 'notes', 'sources', 'related', 'proposals'].includes(op)))] },
      obsidian: { status: p?.acknowledged?.['obsidian-open'] ? 'reported' : 'pending', editReported: Boolean(p?.acknowledged?.['obsidian-edit']) },
    };
    const learningCandidates = p?.materialId && exists(p.roles.capturedSource) ? runtime.service.store.list().filter(note => note.kind === 'knowledge' && !note.meta.presetCase && !note.meta.supersededBy && note.meta.sources?.some(ref => ref.id === p.roles.capturedSource && ref.role === 'input')).map(note => ({ id: note.id, title: note.title, stage: note.meta.stage, depth: note.meta.depth, limitations: runtime.service.noteEvidence(note.id).limitations })) : [];
    const learningStarted = Boolean(p?.roles.explain && runtime?.service.store.records('sessions').some(session => session.noteId === p.roles.explain && !session.presetCase));
    return { practiceId: p?.id || null, status: p?.status || 'new', materialId: p?.materialId || null, customSample: p?.materialId === 'custom' ? runtime.service.store.get('onboardingMaterials', 'custom') : null, learningCandidates, learningStarted, currentStepId: p?.currentStepId || steps()[0]?.id,
      clock: { now: learningNow().toISOString(), realNow: iso(), paused: p?.status !== 'active', timezone: runtime?.service.settings().timezone || mainService.settings().timezone },
      progress: states, summary: { ...counts, total: steps().length }, modelReady: ready('model'),
      capabilities: Object.fromEntries(['model', 'embedding', 'search', 'fetch'].map(cap => [cap, ready(cap)])),
      settings: mainService.settings(), roles: p?.roles || {}, cases: p?.cases || {}, dismissed: record.dismissed,
      busy: Boolean(transitioning || runtime?.requests || runtime?.pumping || runtime?.service.hasPendingOperations),
      jobs: runtime ? runtime.service.store.records('jobs').map(j => ({ id: j.id, state: j.state, type: j.type })) : [],
      unfinishedSessions: runtime ? runtime.service.store.records('sessions').filter(s => s.status !== 'completed' && s.turns?.length && !s.presetCase).map(s => ({ id: s.id, title: exists(s.noteId) ? runtime.service.store.read(s.noteId).title : '材料已删除', status: s.status })) : [],
      practiceVault: runtime?.service.store.vaultDir || null, externalConnections,
      notice: '练习资料独立保存；真实 API 请求计入日常调用上限。演示学习日期不改变电脑时间。' };
  }
  function start(materialId, customInput) {
    if (closed) fail('服务已关闭。', 'PRACTICE_CLOSED', 503);
    if (materialId !== undefined && !getMaterial(materialId)) fail('请选择一个可用的练习场景。', 'ONBOARDING_MATERIAL', 400);
    if (record.practice) {
      if (materialId !== undefined && materialId !== record.practice.materialId) fail('要换场景，请先确认重置独立练习；已有资料不会静默替换。', 'ONBOARDING_MATERIAL_LOCKED', 409);
      return resume(record.practice.id);
    }
    assertIdle();
    assertVaultIsolation();
    let sample;
    if (materialId === 'custom') { try { sample = customSample(customInput); } catch (error) { fail(error.message, 'ONBOARDING_MATERIAL', 400); } }
    record.practice = { id: randomUUID(), materialId: materialId || null, status: 'active', clockAt: iso(), currentStepId: steps()[0]?.id, roles: {}, cases: {}, events: {}, acknowledged: {} };
    const instance = open();
    if (sample) instance.service.store.put('onboardingMaterials', 'custom', sample);
    const seeded = seedPractice(instance.service, materialId);
    record.practice.roles = seeded.roles || seeded;
    instance.anchor = Date.now(); persist(); return state();
  }
  function resume(id) {
    const p = requirePractice(id); assertIdle(); open();
    if (p.status !== 'active') { p.status = 'active'; runtime.anchor = Date.now(); }
    persist(); return state();
  }
  async function pause(id) {
    const p = requirePractice(id);
    if (transitioning) fail('正在切换练习空间。', 'PRACTICE_BUSY', 409);
    transitioning = true; freezeClock(); p.status = 'paused';
    try {
      if (runtime) {
        await runtime.service.pauseJobs();
        while (runtime.requests || runtime.pumping) await new Promise(resolve => setTimeout(resolve, 20));
      }
      persist();
    } finally { transitioning = false; }
    return state();
  }
  async function reset(id, materialId, customInput) {
    const p = requirePractice(id); assertIdle();
    materialId ??= p.materialId || undefined;
    if (materialId !== undefined && !getMaterial(materialId)) fail('请选择一个可用的练习场景。', 'ONBOARDING_MATERIAL', 400);
    if (materialId === 'custom') { try { customSample(customInput); } catch (error) { fail(error.message, 'ONBOARDING_MATERIAL', 400); } }
    await pause(id); transitioning = true;
    try {
      if (runtime) await runtime.service.close();
      runtime = null;
      const folder = safePath(path.join(root, id));
      fs.rmSync(folder, { recursive: true, force: true });
      record.practice = null; persist();
    } finally { transitioning = false; }
    return start(materialId, customInput);
  }
  function selectKnowledge(id, { noteId, role = 'explain' }) {
    const p = requirePractice(id); assertIdle();
    if (p.status !== 'active') fail('请先继续练习。', 'PRACTICE_PAUSED', 409);
    if (!p.materialId || !['aware', 'find', 'explain', 'apply'].includes(role)) fail('学习目标无效。', 'INVALID');
    const service = open().service;
    const note = service.getNote(noteId);
    if (note.kind !== 'knowledge' || note.meta.presetCase || note.meta.supersededBy || !note.meta.sources?.some(ref => ref.id === p.roles.capturedSource && ref.role === 'input')) fail('请选择当前原文下的实际候选知识，不能使用预设案例。', 'ONBOARDING_KNOWLEDGE', 409);
    if (role === 'explain' ? ['aware', 'find', 'apply'].some(other => p.roles[other] === noteId) : p.roles.explain === noteId) fail('请为扩展目标选择主线以外的知识，保留主线知识的目标与学习记录。', 'ONBOARDING_KNOWLEDGE', 409);
    if (role === 'explain' && p.roles.explain !== noteId && service.store.records('sessions').some(session => session.noteId === p.roles.explain && !session.presetCase)) fail('这条知识已经开始学习，请继续当前知识；换主线需确认重新练习。', 'ONBOARDING_LEARNING_LOCKED', 409);
    if (service.noteEvidence(noteId).limitations.length) fail('这条知识仍需核验或复查。请先对原文联网加工并审阅依据，再选入主线；不要改成个人观点绕过核验。', 'RESEARCH_REQUIRED', 409);
    p.roles[role] = noteId; p.roles.source = p.roles.capturedSource;
    persist(); return state();
  }
  function advance(id, action) {
    const p = requirePractice(id); assertIdle();
    if (p.status !== 'active') fail('请先继续练习。', 'PRACTICE_PAUSED', 409);
    const submitted = runtime.service.store.records('sessions').some(session => session.status !== 'completed' && session.turns?.length
      && !session.presetCase && !(exists(session.noteId) && runtime.service.store.read(session.noteId).meta.presetCase));
    if (submitted) fail('请先处理已提交回答的反馈，并结束本次练习后再推进日期；取消任务仍不等于结束练习。', 'PRACTICE_BUSY', 409);
    const unfinished = runtime.service.store.records('jobs').some(j => ['queued', 'running'].includes(j.state) || j.type === 'grade' && j.state === 'waiting' && !j.presetCase);
    if (unfinished) fail('请先完成或取消正在等待的练习任务，再推进演示日期。', 'PRACTICE_BUSY', 409);
    const ms = learningNow().getTime(); let next;
    if (action === 'day') next = ms + 86400000;
    else if (action === 'next') {
      const service = runtime.service, paused = new Set(service.settings().pausedIds || []);
      for (const topic of service.topics().filter(topic => topic.paused)) for (const id of topic.meta.noteIds || []) paused.add(id);
      const reviews = service.store.records('reviews').filter(r => {
        if (!exists(r.noteId) || paused.has(r.noteId) || r.presetCase) return false;
        const note = service.getNote(r.noteId);
        return !note.meta.presetCase && !note.meta.supersededBy && ['learning', 'integrated', 'core'].includes(note.meta.stage) && !service.noteEvidence(note.id).limitations.length;
      });
      const mainReview = reviews.find(r => r.noteId === p.roles.explain);
      const due = (mainReview ? [mainReview] : reviews).map(r => Date.parse(r.dueAt)).filter(n => Number.isFinite(n));
      if (!due.length) fail('暂无未来的复习安排，请先结束一轮练习。', 'NO_REVIEW', 409);
      next = Math.max(ms, Math.min(...due)) + 1000;
    } else fail('请选择推进一天或前往下次复习。', 'INVALID');
    p.clockAt = new Date(next).toISOString(); runtime.anchor = Date.now();
    runtime.service.today(); noteEvent('clock-advance'); noteEvent(action === 'day' ? 'clock-day' : 'clock-due'); persist(); return state();
  }
  function caseAction(id, caseId) {
    const p = requirePractice(id); assertIdle();
    if (p.status !== 'active') fail('请先继续练习。', 'PRACTICE_PAUSED', 409);
    const loaded = loadCase(open().service, caseId, p.roles);
    p.roles = { ...p.roles, ...(loaded.roles || {}) }; p.cases[caseId] ||= { at: iso() };
    persist(); return state();
  }
  function abandon(id, sessionId) {
    const p = requirePractice(id); assertIdle();
    if (p.status !== 'active') fail('请先继续练习。', 'PRACTICE_PAUSED', 409);
    const service = open().service, session = service.store.get('sessions', sessionId);
    if (!session) fail('练习会话不存在。', 'NOT_FOUND', 404);
    if (session.status === 'completed') return state();
    for (const job of service.store.records('jobs').filter(j => j.type === 'grade' && j.payload.sessionId === sessionId && j.state !== 'done')) service.jobAction(job.id, { action: 'cancel' });
    service.store.put('sessions', sessionId, { ...session, status: 'completed', pendingJobId: null, completedAt: learningNow().toISOString(), completion: { abandoned: true, reviewSettled: false, interval: null, reason: '用户结束了未完成练习；原回答与已有反馈保留，没有新增学习成绩或调整复习间隔。' } });
    persist(); return state();
  }
  function checkpoint(id, { stepId, mode = 'check' }) {
    const p = requirePractice(id), step = steps().find(s => s.id === stepId);
    if (!step) fail('引导步骤不存在。', 'STEP_NOT_FOUND', 404);
    p.currentStepId = step.id;
    if (mode === 'read' && step.kind === 'read') p.acknowledged[step.id] = { at: iso() };
    if (mode === 'external' && step.kind === 'external') p.acknowledged[step.id] = { at: iso(), selfReported: true };
    persist(); return state();
  }
  function settingsChanged(input) {
    record.revisions ||= {};
    for (const group of capabilityGroups) if (input[group] !== undefined) {
      const cap = group === 'ai' ? 'model' : group;
      delete record.receipts[cap]; record.revisions[cap] = (record.revisions[cap] || 0) + 1;
    }
    record.events['settings-save'] = { at: iso() };
    if (record.practice || Object.keys(record.receipts).length) persist();
  }
  function tested(capability, expectedFingerprint = fingerprint(capability)) {
    if (!['model', 'embedding', 'search', 'fetch'].includes(capability)) fail('能力不存在。');
    if (expectedFingerprint !== fingerprint(capability)) fail('测试期间配置发生变化，请重试。', 'CONFIG_CHANGED', 409);
    record.receipts[capability] = { fingerprint: expectedFingerprint, at: iso() }; persist();
  }
  async function test(capability) {
    if (!['model', 'embedding', 'search', 'fetch'].includes(capability)) fail('请选择可测试的能力。');
    const before = fingerprint(capability);
    delete record.receipts[capability]; persist();
    const result = await mainService.ai.test(capability); tested(capability, before);
    return { ...state(), testResult: result };
  }
  function acquire(id, { resource, method, query = {} }) {
    const p = requirePractice(id);
    if (transitioning || p.status !== 'active') fail('练习已暂停，请从引导入口继续。', 'PRACTICE_PAUSED', 409);
    const instance = open();
    const outboundRead = resource === 'search' && query.privacy === 'cloud' && ['semantic', 'hybrid'].includes(query.mode);
    if (((method !== 'GET' && method !== 'HEAD') || outboundRead) && !ready('model') && !['settings', 'prompts'].includes(resource)) {
      fail('请先保存 AI 配置并测试连接，成功后开始实操。', 'MODEL_TEST_REQUIRED', 409);
    }
    if (resource === 'restore' && (instance.requests || instance.pumping || instance.service.hasPendingOperations)) fail('请等待练习操作结束后再恢复。', 'PRACTICE_BUSY', 409);
    instance.requests++;
    return { service: instance.service, release() { instance.requests--; } };
  }
  function observe(id, { resource, itemId, action, method, body, query, result }) {
    const p = requirePractice(id);
    // Persist only operation names and generated IDs, never form bodies or API keys.
    const observedNoteId = exists(result?.noteId) ? result.noteId : (result?.id && exists(result.id) ? result.id : exists(itemId) ? itemId : null);
    const storedItem = itemId && ['jobs', 'proposals', 'relations'].includes(resource) ? runtime.service.store.get(resource, itemId) : null;
    const presetCase = result?.presetCase || result?.meta?.presetCase || storedItem?.presetCase || (observedNoteId && runtime.service.store.read(observedNoteId).meta.presetCase);
    const entities = [itemId, result?.id, result?.draftId, result?.noteId, body.noteId, body.mistakeId, body.topicId, body.keepId, ...(Array.isArray(result?.notes) ? result.notes.map(note => note.id) : [])].filter(value => typeof value === 'string');
    const event = name => noteEvent(name, { entities, ...(observedNoteId ? { noteId: observedNoteId } : {}), ...(presetCase ? { presetCase } : {}), ...(result?.meta?.depth ? { depth: result.meta.depth, stage: result.meta.stage } : {}) });
    if (resource === 'import' && method === 'POST') {
      event('import'); event(body.items?.length > 1 ? 'import-batch' : 'import-text');
      const mainCapture = !p.materialId || p.currentStepId === 'capture-save' && body.captureMode === 'text' && body.items?.length === 1;
      if (mainCapture && result.notes?.[0] && !exists(p.roles.capturedSource)) {
        p.roles.capturedSource = result.notes[0].id;
        if (p.materialId) p.roles.source = result.notes[0].id;
      }
    }
    if (resource === 'notes') {
      if (method === 'GET' && itemId && !action) event('note-open');
      if (method === 'PUT') {
        event('note-edit');
        if (body.meta?.privacy === 'cloud') event('privacy-cloud');
        if (body.meta?.researchIntervalDays) event('research-interval');
        if (body.meta?.depth) event(`depth-${body.meta.depth}`);
      }
      if (method === 'DELETE') event('note-delete');
      if (action === 'extract') { event('extract'); p.roles.extractedKnowledge = result.id; }
      if (action === 'promote') { event('promote'); event(`stage-${body.stage}`); if(body.depth)event(`depth-${body.depth}`); }
      if (action === 'confirm') event('study-confirm');
      if (action === 'evidence') event('evidence');
      if (action === 'links-preview') event('links-preview');
      if (action === 'links-sync') event('links-sync');
      if (itemId === 'merge') event(body.preview !== false ? 'merge-preview' : 'merge');
      if (action === 'relate') event(body.useAI ? 'relate-ai-request' : 'relate-local');
    }
    if (resource === 'today' && method === 'POST') { event('today-generate'); if (action === 'action') event(`today-${body.action}`); }
    if (resource === 'study') {
      if (itemId === 'start') { event('study-start'); p.roles.currentSession = result.id; if (body.mistakeId) event('mistake-practice'); }
      if (action === 'answer') event('study-answer');
      if (action === 'hint') event('study-hint');
      if (action === 'finish' && result.status === 'completed' && !result.completion?.abandoned) event('study-finish');
      if (action === 'confirm') event('study-confirm');
    }
    if (resource === 'mistakes' && action === 'action') event(`mistake-${body.action}`);
    if (resource === 'topics') {
      if (method === 'POST' && !itemId) { event('topic-create'); if (!exists(p.roles.createdTopic)) p.roles.createdTopic = result.id; if(runtime.service.store.records('jobs').some(j=>j.type==='topics'&&j.state==='done'))event('topic-adopt'); }
      if (method === 'PUT') event('topic-edit');
      if (action === 'action') event(`topic-${body.action}`);
    }
    if (resource === 'relations' && action === 'action') event(`relation-${body.action}`);
    const fromMaterial = noteId => exists(noteId) && (noteId === p.roles.capturedSource || runtime.service.getNote(noteId).meta.sources?.some(ref => ref.id === p.roles.capturedSource && ref.role === 'input'));
    if (resource === 'search') {
      const mode = query.mode || 'keyword';
      const matchedMaterial = !p.materialId || result.results?.some(note => fromMaterial(note.id));
      if ((!['semantic','hybrid'].includes(mode) || result.diagnostics?.semanticUsed === true) && (mode !== 'keyword' || matchedMaterial)) event(`search-${mode}`);
      if (!result.results?.length) event('search-empty');
      if (Object.keys(query).some(k => ['stage', 'topic', 'kind', 'source', 'from', 'to'].includes(k))) event('search-filter');
    }
    if (resource === 'ask' && method === 'POST' && result.draftId && (!p.materialId || result.generated === true && result.citations?.some(citation => fromMaterial(citation.id)))) {
      if(result.generated===true)event(`output-${body.mode || 'answer'}`);
      if (!p.materialId || body.mode === 'draft') p.roles.draft = result.draftId;
    }
    if (resource === 'drafts' && method === 'PUT') {
      event('draft-save');
      if (body.usedIds?.length && (!p.materialId || body.usedIds.some(fromMaterial))) event('draft-use');
      if (result.removedUseIds?.length) event('draft-unuse');
    }
    if (resource === 'drafts' && action === 'capture') event('draft-capture');
    if (resource === 'recommendations') { event('recommendations-read'); if (action === 'action') event(`recommendation-${body.action}`); }
    if (resource === 'jobs' && action === 'action') event(`job-${body.action}`);
    if (resource === 'prompts' && method === 'PUT') event('prompts-save');
    if (resource === 'settings' && method === 'PUT') event('preferences-save');
    if (resource === 'backup') event('backup');
    if (resource === 'restore') { event(body.preview !== false ? 'restore-preview' : 'restore'); if (body.preview === false) {
      const context = runtime.service.store.get('onboardingContext', 'identity');
      if (context && typeof context.roles === 'object' && typeof context.cases === 'object') {
        p.roles = Object.fromEntries(Object.entries(context.roles || {}).filter(([role, value]) => /^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(role) && typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,160}$/.test(value)));
        p.cases = Object.fromEntries(Object.entries(context.cases || {}).filter(([key, value]) => caseIds.includes(key) && Number.isFinite(Date.parse(value?.at))).map(([key, value]) => [key, { at: new Date(value.at).toISOString() }]));
        if (context.materialId == null || getMaterial(context.materialId)) p.materialId = context.materialId || null;
      }
      const restoredTime = body.backup?.learningTime || context?.learningTime;
      if (Number.isFinite(Date.parse(restoredTime))) { p.clockAt = new Date(restoredTime).toISOString(); runtime.anchor = Date.now(); }
    } }
    if (resource === 'history') event(action === 'restore' ? 'history-restore' : 'history-read');
    if (resource === 'proposals' && action === 'action') event(`proposal-${body.action}`);
    persist();
  }
  async function pump() {
    if (closed || transitioning || record.practice?.status !== 'active' || !runtime || runtime.pumping || !ready('model')) return;
    const instance = runtime; instance.pumping = true;
    try {
      const pending = instance.service.store.records('jobs').reverse().find(j => j.state === 'queued');
      if (pending?.presetCase === 'jobs') {
        instance.service.store.scan();
        instance.service.store.put('jobs', pending.id, { ...pending, state: 'done', progress: 100, attempts: pending.attempts + 1, error: '', updatedAt: iso(), notice: '预设演示案例：本地重试完成，没有向量或模型请求。' });
      } else await instance.service.runJobs();
      freezeClock(); instance.anchor = Date.now(); persist();
    }
    finally { instance.pumping = false; }
  }
  async function close() {
    if (closed) return;
    closed = true;
    if (record.practice) await pause(record.practice.id);
    if (runtime) { await runtime.service.close(); runtime = null; }
  }
  return { state, start, resume, pause, reset, selectKnowledge, advance, caseAction, abandon, checkpoint, settingsChanged, tested, fingerprint, test, acquire, observe, pump, close, assertVaultIsolation,
    clientEvent(id, name) {
      const p = requirePractice(id); if (!clientEvents.has(name)) fail('不能通过界面事件完成这项操作。', 'INVALID_EVENT');
      const step = steps().find(item => item.id === p.currentStepId), entity = p.roles[step?.noteRole];
      noteEvent(checkAliases[name] || name, { ...(entity ? { entities: [entity] } : {}), ...(step?.caseId ? { presetCase: step.caseId } : {}) }); persist(); return state();
    },
    dismiss() { record.dismissed = true; persist(); return state(); },
    get currentService() { return runtime?.service; }, chapters };
}
