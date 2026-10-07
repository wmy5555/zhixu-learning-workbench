import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Store, now, hash, fail } from './store.mjs';
import { createSecrets } from './secrets.mjs';
import { createAI } from './ai.mjs';
import { promptDefaults, renderPrompt, validatePromptOverrides, sourceExtractionStructure, sourceTitleContract, extractionResearchContract, effectivePromptTemplate } from './prompts.mjs';
import { createLearning } from './learning.mjs';
import { createLifecycle } from './knowledge-lifecycle.mjs';
import { createChatgptBridge } from './chatgpt.mjs';
import { buildUsageReport } from './usage.mjs';
import { structureBasis, structureRecord, structureView } from './source-structure.mjs';

export const defaults = {
  dailyMinutes: 25, timezone: 'Asia/Shanghai', scheduleTime: '08:00', focusTopics: [], pausedIds: [],
  ai: { enabled: false, baseUrl: '', model: '', timeoutMs: 180000, dailyCallLimit: 500, sourceCallLimit: 120, monthlyBudget: 0, inputPrice: null, outputPrice: null, cachedInputPrice: null },
  embedding: { enabled: false, baseUrl: '', model: '', inputPrice: null },
  search: { enabled: false, baseUrl: 'https://api.tavily.com', requestPrice: null }, fetch: { enabled: false },
  mcp: { enabled: false, allowProposals: false, chatgptEnabled: false, chatgptAllowRead: false }, discoveryDays: 7, prompts: {},
};
const stages = ['reference','candidate','learning','integrated','core','retired'];
const depths = ['aware','find','explain','apply'];
const usable = (n, timestamp) => n.kind === 'knowledge' && !['retired'].includes(n.meta.stage) && !n.meta.supersededBy && !(n.meta.researchLimitations?.length) && (!n.meta.reviewAfter || n.meta.reviewAfter >= timestamp);
const practicePurpose = 'onboarding-practice';
const practicePreferences = ['dailyMinutes','timezone','scheduleTime','focusTopics','pausedIds','discoveryDays','prompts'];
const externalCapabilities = ['ai','embedding','search','fetch'];
const localDay = (date, timezone) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const tokens = text => [...new Set(String(text).toLowerCase().match(/[a-z0-9_]+|[\p{Script=Han}]/gu) || [])];
function parseJSON(text) { try { return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { fail('模型没有返回要求的数据结构；原始资料已保存，可重试。', 'MODEL_FORMAT', 422); } }
function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; } return dot / (Math.sqrt(na * nb) || 1);
}

export function createService({ dataDir, vaultDir, aiOverride, learningClock = () => new Date(), getExternalSettings, practice = false, getPracticeQuestion } = {}) {
  if (practice && (!dataDir || !vaultDir)) fail('练习空间必须使用独立的数据与资料目录。', 'PRACTICE_PATH_REQUIRED');
  if (typeof learningClock !== 'function' || getExternalSettings !== undefined && typeof getExternalSettings !== 'function') fail('学习时间或外部能力配置无效。');
  dataDir ||= path.resolve('.data');
  const learningDate = () => {
    const date = learningClock();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) fail('学习时间无效。', 'INVALID_LEARNING_TIME');
    return new Date(date.getTime());
  };
  const learningNow = () => learningDate().toISOString();
  if (!vaultDir && fs.existsSync(path.join(dataDir, 'learning.sqlite'))) {
    const db = new DatabaseSync(path.join(dataDir, 'learning.sqlite'), { readOnly: true });
    try { vaultDir = JSON.parse(db.prepare("SELECT json FROM records WHERE namespace='settings' AND key='main'").get()?.json || '{}').vaultDir; } finally { db.close(); }
  }
  vaultDir ||= path.resolve('vault');
  let store = new Store({ dataDir, vaultDir, backupPurpose: practice ? practicePurpose : undefined });
  let jobRevision = randomUUID();
  let jobSnapshot = 0;
  const secret = practice ? { has: () => false, get: () => '' } : createSecrets(dataDir);
  const settings = () => {
    const saved = store.get('settings', 'main', {});
    const value = { ...defaults, ...saved };
    for (const group of ['ai','embedding','search','fetch','mcp']) value[group] = { ...defaults[group], ...saved[group], hasKey: secret.has(group === 'ai' ? 'model' : group) };
    for (const key of ['enabled', 'allowProposals', 'chatgptEnabled', 'chatgptAllowRead']) value.mcp[key] = value.mcp[key] === true;
    if (value.mcp.chatgptEnabled !== true) value.mcp.chatgptAllowRead = false;
    if (value.mcp.enabled !== true) value.mcp.allowProposals = false;
    if (practice) {
      const external = getExternalSettings?.() || {};
      for (const group of externalCapabilities) {
        const allowed = [...Object.keys(defaults[group]), 'hasKey', ...(group === 'fetch' ? ['testUrl'] : [])];
        value[group] = { ...defaults[group], hasKey: false, ...Object.fromEntries(allowed.filter(key => Object.hasOwn(external[group] || {}, key)).map(key => [key, external[group][key]])) };
      }
      value.mcp = { ...defaults.mcp, hasKey: false };
    }
    return { ...value, vaultDir: store.vaultDir, dataDir: store.dataDir };
  };
  const usage = () => {
    const calls = store.records('calls'), day = localDay(new Date(), settings().timezone), month = day.slice(0,7);
    const monthly = calls.filter(c => localDay(new Date(c.createdAt), settings().timezone).startsWith(month));
    return { callsToday: calls.filter(c => localDay(new Date(c.createdAt), settings().timezone) === day).length, costMonth: monthly.some(c => c.cost == null) ? null : monthly.reduce((s,c) => s + c.cost, 0), knownCostMonth: monthly.reduce((s,c) => s + (c.cost || 0), 0), unknownCostCalls: monthly.filter(c => c.cost == null).length };
  };
  const ai = aiOverride || createAI({ getSettings: settings, getSecret: capability => secret.get(capability === 'ai' ? 'model' : capability), getUsage: usage, recordCall: call => store.put('calls', randomUUID(), { ...call, createdAt: now() }) });
  const usageReport = ({ period, capability, model } = {}) => {
    const config = settings(), report = buildUsageReport(store.records('calls'), { period, capability, model, timezone: config.timezone });
    // Malformed imported dates must not turn a broken budget ledger into a zero balance.
    const budget = report.invalidDateCalls ? { unavailable: true } : usage();
    return { ...report, budget: { ...budget, dailyCallLimit: config.ai.dailyCallLimit, monthlyBudget: config.ai.monthlyBudget } };
  };
  function updateUsageSettings(input) {
    const current = settings();
    for (const key of ['dailyCallLimit','monthlyBudget']) if (Object.hasOwn(input.ai || {}, key)) {
      const value = input.ai[key];
      if (!['number','string'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(+value) || +value < 0) fail('调用预算必须为非负数。');
    }
    for (const group of ['ai','embedding','search']) {
      const expected = input.pricingFor?.[group];
      if (!expected || expected.baseUrl !== current[group].baseUrl || expected.model !== (current[group].model || '')) fail('服务或模型已变化，请刷新用量页面后重新设置单价。', 'PRICING_CHANGED', 409);
    }
    const pick = (group, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(input[group] || {}, key)).map(key => [key, input[group][key]]));
    return updateSettings({ ai: pick('ai', ['dailyCallLimit','sourceCallLimit','monthlyBudget','inputPrice','outputPrice','cachedInputPrice']), embedding: pick('embedding', ['inputPrice']), search: pick('search', ['requestPrice']) });
  }
  const promptText = (key, values={}) => renderPrompt(key,values,settings().prompts);
  function getPrompts() {
    const overrides=settings().prompts;
    return {prompts:Object.entries(promptDefaults).map(([key,p])=>({key,...p,defaultTemplate:p.template,template:effectivePromptTemplate(key,overrides)}))};
  }
  function updatePrompts({prompts}={}) {
    const changes=validatePromptOverrides(prompts);
    updateSettings({prompts:{...settings().prompts,...changes}});
    return getPrompts();
  }
  let processing = false, controller = null, currentJob = null, stopped = false, pausing = false, activeOperations = 0, pausePromise = null;
  const tracked = operation => async (...args) => {
    if (stopped || pausing) fail('练习正在暂停，请稍后继续。', 'BUSY', 409);
    activeOperations++;
    try { return await operation(...args); } finally { activeOperations--; }
  };
  const putJob = job => store.put('jobs', job.id, { ...job, updatedAt: now() });
  const getNote = id => { store.scan(); return store.read(id); };
  const privacyFor = n => store.outboundPrivacy(n);
  const materialLimitations = n => {
    const issues = [...(n.meta.researchLimitations || [])];
    if (n.meta.reviewAfter && n.meta.reviewAfter < learningNow()) issues.push('材料可能陈旧，需要重新研究。');
    if (n.meta.processKey) { const [sourceId,sourceHash] = n.meta.processKey.split(':'); if (store.row(sourceId)?.hash !== sourceHash) issues.push('底层原始资料已修改或删除，需要重新加工。'); }
    return issues;
  };
  const eligible = n => usable(n, learningNow()) && !materialLimitations(n).length;
  function queue(type, payload, dedupKey) {
    if (pausing || stopped) fail('当前任务正在暂停，请稍后继续。', 'BUSY', 409);
    const existing = store.records('jobs').find(j => j.dedupKey === dedupKey && ['queued','running','waiting'].includes(j.state));
    if (existing && dedupKey) return existing;
    return putJob({ id: randomUUID(), type, state: 'queued', payload, dedupKey, progress: 0, error: '', createdAt: now(), attempts: 0 });
  }
  function updateSettings(input) {
    if (practice && ['vaultDir','dataDir','ai','embedding','search','fetch','mcp','apiKey','clearKey'].some(key => Object.hasOwn(input, key))) fail('练习空间不能更改目录、连接凭据或外部能力；请返回正式设置配置。', 'PRACTICE_SETTINGS_LOCKED', 409);
    if (practice && input.prompts !== undefined && (processing || activeOperations)) fail('请等待练习任务结束后调整提示词。', 'BUSY', 409);
    const old = settings(), allowed = ['dailyMinutes','timezone','scheduleTime','focusTopics','pausedIds','ai','embedding','search','fetch','mcp','discoveryDays','prompts'];
    const next = Object.fromEntries(allowed.map(k => [k, old[k]]));
    for (const key of allowed) if (input[key] !== undefined) next[key] = typeof defaults[key] === 'object' && !Array.isArray(defaults[key]) ? { ...old[key], ...input[key] } : input[key];
    for (const key of ['enabled', 'allowProposals', 'chatgptEnabled', 'chatgptAllowRead']) if (typeof next.mcp[key] !== 'boolean') fail('MCP 接入与从属许可必须为开关值。');
    if (!next.mcp.chatgptEnabled) next.mcp.chatgptAllowRead = false;
    if (!next.mcp.enabled) next.mcp.allowProposals = false;
    next.prompts=validatePromptOverrides(next.prompts);
    if (!Number.isFinite(+next.dailyMinutes) || +next.dailyMinutes < 5 || +next.dailyMinutes > 240) fail('每日时间应为 5–240 分钟。'); next.dailyMinutes = +next.dailyMinutes;
    try { localDay(new Date(), next.timezone); } catch { fail('时区无效，请用 Asia/Shanghai 等标准时区名称。'); }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(next.scheduleTime)) fail('生成时间应为 HH:mm。');
    for (const capability of ['ai','embedding','search']) {
      const config = next[capability];
      if (config.apiKey) secret.set(capability === 'ai' ? 'model' : capability, String(config.apiKey));
      if (config.clearKey === true) secret.clear(capability === 'ai' ? 'model' : capability);
      delete config.apiKey; delete config.clearKey; delete config.hasKey;
      if (config.baseUrl) { let u; try { u = new URL(config.baseUrl); } catch { fail('服务地址无效。'); } if (u.protocol !== 'https:') fail('外部能力地址须使用 HTTPS。'); if (u.username || u.password) fail('服务地址不能包含凭据。'); }
    }
    for (const key of ['dailyCallLimit','monthlyBudget']) { if (!Number.isFinite(+next.ai[key]) || +next.ai[key] < 0) fail('调用预算必须为非负数。'); next.ai[key] = +next.ai[key]; }
    next.ai.timeoutMs = Number(next.ai.timeoutMs);
    if (!['number','string'].includes(typeof next.ai.sourceCallLimit) || String(next.ai.sourceCallLimit).trim() === '') fail('单任务请求上限须为 1–300 的整数。');
    next.ai.sourceCallLimit = Number(next.ai.sourceCallLimit);
    if (!Number.isInteger(next.ai.sourceCallLimit) || next.ai.sourceCallLimit < 1 || next.ai.sourceCallLimit > 300) fail('单份资料请求上限须为 1–300。');
    if (!Number.isInteger(next.ai.timeoutMs) || next.ai.timeoutMs < 1000 || next.ai.timeoutMs > 600000) fail('模型等待时间须为 1–600 秒。');
    for (const group of ['ai','embedding','search']) {
      const config = next[group], keys = group === 'search' ? ['requestPrice'] : ['inputPrice','outputPrice','cachedInputPrice'];
      const changed = config.baseUrl !== old[group].baseUrl || config.model !== old[group].model;
      for (const key of keys) {
        if (changed && !Object.hasOwn(input[group] || {}, key)) config[key] = null;
        if (config[key] === '' || config[key] === undefined) config[key] = null;
        if (config[key] !== null) {
          if (!['number','string'].includes(typeof config[key]) || String(config[key]).trim() === '' || !Number.isFinite(+config[key]) || +config[key] < 0) fail('价格应为空（未知）或非负数字。');
          config[key] = +config[key];
        }
      }
    }
    if (!Array.isArray(next.focusTopics) || !Array.isArray(next.pausedIds)) fail('关注主题和暂停项应为列表。');
    if (input.vaultDir && path.resolve(input.vaultDir) !== store.vaultDir) {
      if (processing) fail('请等待当前处理任务结束后更换 Vault。', 'BUSY', 409);
      if (store.list().some(n=>n.kind!=='report') || store.records('sessions').length) fail('当前库已有数据。为避免混淆学习记录，请先备份，使用独立数据目录启动另一个 Vault。', 'VAULT_NOT_EMPTY', 409);
      const newVault = path.resolve(input.vaultDir);
      if (newVault === path.parse(newVault).root || newVault === store.dataDir) fail('请选择专用的 Vault 文件夹。');
      store.close(); store = new Store({ dataDir, vaultDir: newVault }); jobRevision = randomUUID(); next.vaultDir = newVault;
    } else next.vaultDir = store.vaultDir;
    const researchChanged = practice && Object.keys(promptDefaults).filter(key => key.startsWith('research')).some(key => (old.prompts[key] ?? promptDefaults[key].template) !== (next.prompts[key] ?? promptDefaults[key].template));
    store.put('settings', 'main', practice ? Object.fromEntries(practicePreferences.map(key => [key, next[key]])) : next);
    if (researchChanged) store.db.prepare("DELETE FROM records WHERE namespace='research'").run();
    return settings();
  }
  const validExtraction = value => Array.isArray(value?.candidates) && value.candidates.length > 0 && value.candidates.length <= 8
    && value.candidates.every(candidate => typeof candidate?.title === 'string' && typeof candidate.body === 'string'
      && Array.isArray(candidate.claims) && candidate.claims.every(claim => typeof claim === 'string'));
  const processJobs = (id, sourceHash) => store.records('jobs').filter(job => job.type === 'process'
    && job.payload?.noteId === id && job.payload.hash === sourceHash && !job.presetCase && !job.payload.presetCase);
  const processReply = (job, reused = false) => ({ ...publicJob(job), reused, jobRevision, jobSnapshot: ++jobSnapshot });
  function processNote(id, { research = false, reuseExtracted = false } = {}) {
    const source = getNote(id);
    if (source.kind !== 'source') fail('请选择原始资料重新加工。');
    const payload = { noteId: id, hash: source.hash, research: research === true, ...(needsTitle(source) ? { titleRequested: true } : {}) };
    for (const task of store.records('jobs')) if (task.type === 'title' && task.payload.noteId === id && ['queued','waiting'].includes(task.state)) putJob({ ...task, state: 'cancelled', code: 'CANCELLED', error: '标题将与资料拆解一同生成。' });
    const previous = processJobs(id, source.hash);
    const pending = previous.find(job => ['queued','running','waiting'].includes(job.state));
    if (pending) return processReply(pending, true);
    if (['failed','cancelled'].includes(previous[0]?.state)) return processReply(previous[0], true);
    // Repeated decomposition reuses its record, including errors that require an explicit task retry.
    // The separate research action may refresh evidence, but still reuses the extracted candidates.
    const matching = previous.filter(job => !payload.research || job.payload.research === true);
    const existing = matching[0];
    if (existing && (existing.state !== 'done' || !payload.research || reuseExtracted !== true)) return processReply(existing, true);
    const extracted = previous.find(job => validExtraction(job.payload.extracted))?.payload.extracted;
    if (extracted) payload.extracted = structuredClone(extracted);
    return processReply(queue('process', payload, `process:${id}:${source.hash}${payload.research ? ':research' : ''}`));
  }
  const needsTitle = source => source.meta.titlePending === true && source.title === source.meta.titlePlaceholder;
  const validSourceTitle = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 80 && !/[\r\n\u0000-\u001f\u007f\u2028\u2029]/u.test(value) && !/^[#>*\x60]|\x60/u.test(value.trim());
  function titleJob(source, failure = false) {
    const task = queue('title', { noteId: source.id, hash: source.hash }, `title:${source.id}:${source.hash}`);
    return failure ? putJob({ ...task, state: 'failed', code: 'MODEL_FORMAT', error: '标题结果缺失或格式不正确；暂用原文片段，拆解结果已保留。' }) : task;
  }
  function saveSourceTitle(source, value, signal) {
    if (signal.aborted) fail('任务已取消。', 'CANCELLED');
    const current = getNote(source.id);
    if (current.hash !== source.hash) fail('资料已修改，旧标题未写入。', 'SOURCE_CHANGED');
    if (privacyFor(current) !== 'cloud') fail('资料已改为仅本地，旧标题未写入。', 'PRIVACY_LOCAL');
    if (!needsTitle(current)) fail('标题已经填写，保留当前标题。', 'TITLE_ALREADY_SET');
    if (!validSourceTitle(value)) fail('标题结果缺失或格式不正确；原文与临时标题已保留。', 'MODEL_FORMAT');
    const structure = store.get('sourceStructures', source.id), children = sourceChildren(source.id);
    const structureCurrent = structure && JSON.stringify(structure.basis) === JSON.stringify(structureBasis(source, children));
    const saved = store.update(source.id, { title: value.trim(), expectedHash: source.hash, meta: { titlePending: false, titleOrigin: 'ai' } });
    // Only this strictly checked automatic title change can carry body-derived evidence forward.
    const prefix = `${source.id}:${source.hash}:`, claims = new Set();
    for (const child of children.filter(note => note.meta.processKey?.startsWith(prefix))) {
      for (const claim of child.meta.claims || []) claims.add(claim);
      const processKey = child.meta.processKey.replace(prefix, `${source.id}:${saved.hash}:`);
      const updated = store.update(child.id, { expectedHash: child.hash, meta: { processKey } });
      for (const proposal of store.records('proposals')) if (proposal.noteId === child.id && proposal.expectedHash === child.hash && proposal.meta?.processKey === child.meta.processKey) {
        store.put('proposals', proposal.id, { ...proposal, expectedHash: updated.hash, meta: { ...proposal.meta, processKey } });
      }
    }
    for (const task of processJobs(source.id, source.hash)) {
      task.payload.hash = saved.hash;
      if (task.payload.savedCandidates?.hash === source.hash) task.payload.savedCandidates.hash = saved.hash;
      task.dedupKey = `process:${source.id}:${saved.hash}${task.payload.research ? ':research' : ''}`;
      putJob(task);
    }
    for (const claim of claims) {
      const cached = store.get('research', hash(claim + ':' + source.hash));
      if (cached) store.put('research', hash(claim + ':' + saved.hash), cached);
    }
    if (structureCurrent) store.put('sourceStructures', source.id, { ...structure, basis: structureBasis(saved, sourceChildren(source.id)) });
    return saved;
  }
  async function generateSourceTitle(job, signal) {
    const source = getNote(job.payload.noteId);
    if (source.hash !== job.payload.hash) fail('资料已修改，请重试当前版本。', 'SOURCE_CHANGED');
    if (!needsTitle(source)) fail('标题已经填写，保留当前标题。', 'TITLE_ALREADY_SET');
    const result = parseJSON((await ai.generate({ system: promptText('serviceSystem'), privacy: privacyFor(source), signal, json: true, prompt: promptText('sourceTitle', { source: source.body }) })).text);
    const saved = saveSourceTitle(source, result?.sourceTitle, signal);
    job.payload.resultHash = saved.hash;
    putJob(job);
  }
  function importItems({ items, process = false, research = false }) {
    if (!Array.isArray(items) || !items.length || items.length > 100) fail('每次请导入 1–100 份文本。');
    const result = [], jobs = [];
    for (const item of items) {
      if (typeof item.body !== 'string' || !item.body.trim() || item.body.length > 500000) fail('每份文本须为 1–500000 字符。');
      const fingerprint = hash(item.body.replaceAll('\r\n','\n').trim());
      const existing = store.list().find(n => n.kind === 'source' && n.meta.fingerprint === fingerprint);
      const origin = { platform: item.platform || '', author: item.author || '', url: item.url || '', date: item.date || '', locator: item.locator || '', ...(item.topic ? { topic: item.topic } : {}), acquiredAt: now() };
      let note;
      if (existing) {
        note = store.update(existing.id, { expectedHash: existing.hash, meta: { origins: [...(existing.meta.origins || []), origin] } });
        // A duplicate only appends provenance; pending requests use its resulting version.
        if (needsTitle(note)) for (const task of store.records('jobs')) if (task.payload?.noteId === note.id && task.payload.hash === existing.hash && ['queued','waiting','failed'].includes(task.state)
          && (task.type === 'title' || task.type === 'process' && !task.payload.extracted)) {
          task.payload.hash = note.hash;
          task.dedupKey = `${task.type}:${note.id}:${note.hash}${task.payload.research ? ':research' : ''}`;
          putJob(task);
        }
      }
      else note = store.create({ kind: 'source', title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : item.body.replace(/\s+/gu, ' ').trim().slice(0, 36), body: item.body, meta: { ...(!(typeof item.title === 'string' && item.title.trim()) ? { titlePlaceholder: item.body.replace(/\s+/gu, ' ').trim().slice(0, 36) } : {}), titlePending: !(typeof item.title === 'string' && item.title.trim()), titleOrigin: typeof item.title === 'string' && item.title.trim() ? 'manual' : 'temporary', privacy: item.privacy === 'cloud' ? 'cloud' : 'local', fingerprint, origins: [origin], ...origin, stage: 'reference' } });
      result.push(note); if (process) jobs.push(processNote(note.id, { research }));
      else if (!existing && needsTitle(note)) jobs.push(publicJob(titleJob(note)));
    }
    return { notes: result, jobs };
  }
  function listNotes(filters = {}) {
    store.scan(); return store.list().filter(n => (!filters.kind || n.kind === filters.kind) && (!filters.stage || n.meta.stage === filters.stage) && (!filters.q || `${n.title}\n${n.body}`.toLowerCase().includes(filters.q.toLowerCase())));
  }
  const operationalIssue = text => /今日外部调用次数已达到上限|BUDGET|预算|请求次数.*上限/.test(text);
  function publicNote(note) {
    const n = structuredClone(note);
    n.meta.effectivePrivacy=privacyFor(note);
    delete n.meta.evidence;
    if (n.kind === 'source' && n.meta.titlePending) n.meta.titlePending = needsTitle(note);
    if (n.kind === 'source' && needsTitle(n)) {
      const job = store.records('jobs').find(j => j.payload?.noteId === n.id && (j.type === 'title' || j.type === 'process' && j.payload.titleRequested));
      n.titleGeneration = { state: job?.state || 'waiting', code: job?.code || null };
    } else if (n.meta.titleOrigin === 'ai') n.titleGeneration = { state: 'done' };
    n.meta.sources = (n.meta.sources || []).filter(s => s.role === 'input' || !store.row(s.id) || !store.read(s.id).meta.excerptOnly);
    n.meta.researchLimitations = [...new Set((n.meta.researchLimitations || []).map(l => operationalIssue(l) ? (l.match(/^“[^”]+”/)?.[0] || '该事实')+'尚待核验。' : l))];
    if (n.meta.processKey && !n.meta.userEdited && (!n.meta.generatedBodyHash || hash(n.body) === n.meta.generatedBodyHash)) {
      const original = n.body.split('\n\n## 证据与适用范围')[0];
      const conclusions = (n.meta.researchConclusions || n.body.split('## 证据与适用范围\n\n')[1]?.split('\n\n- [')[0]?.split('### 研究范围')[0]?.split('## 尚需补充的研究')[0] || '').replace('此条未取得可引用的外部正文。','').trim();
      n.body = `${original}${conclusions ? '\n\n## 核验结论\n\n'+conclusions : ''}`;
    }
    return n;
  }
  const parentIds = n => [...new Set([...(n.meta.sources || []).filter(s => s.role === 'input').map(s => s.id), n.meta.processKey?.split(':')[0]].filter(Boolean))];
  const parentId = n => parentIds(n)[0];
  const childOrder = (a,b) => (Number(a.meta.processKey?.split(':').at(-1)) || 0) - (Number(b.meta.processKey?.split(':').at(-1)) || 0);
  const sourceChildren = id => store.list().filter(n => n.kind === 'knowledge' && !n.meta.excerptOnly && parentIds(n).includes(id)).sort(childOrder);
  function requestSourceStructure(id) {
    const source = getNote(id), notes = sourceChildren(id);
    if (source.kind !== 'source' || source.meta.excerptOnly) fail('请选择原始资料。');
    if (!notes.length) fail('请先拆解或手动整理资料，再分析逻辑关系。');
    const basis = structureBasis(source, notes);
    return processReply(queue('structure', { noteId: id, basis }, `structure:${id}:${hash(JSON.stringify(basis))}`));
  }
  async function analyzeSourceStructure(job, signal) {
    const source = getNote(job.payload.noteId), notes = sourceChildren(source.id);
    const assertCurrent = () => {
      store.scan();
      if (!store.row(source.id)) fail('原始资料已删除。', 'SOURCE_CHANGED');
      const current = store.read(source.id), children = sourceChildren(source.id);
      if (current.kind !== 'source' || current.meta.excerptOnly || !children.length) fail('资料组已变化，请先确认当前条目。', 'SOURCE_CHANGED');
      if ([current, ...children].some(n => privacyFor(n) !== 'cloud')) fail('原文及参与分析的每条拆解均须允许外发。', 'PRIVACY_LOCAL');
      if (JSON.stringify(structureBasis(current, children)) !== JSON.stringify(job.payload.basis)) fail('资料已变化，请重试以分析当前版本。', 'SOURCE_CHANGED');
    };
    assertCurrent();
    const result = await ai.generate({ system: promptText('serviceSystem'), privacy: 'cloud', signal, json: true,
      prompt: promptText('sourceStructure', { source: source.body, notes: JSON.stringify(notes.map(n => ({ id: n.id, title: n.title, body: n.body }))) }) });
    if (signal.aborted) fail('任务已取消。', 'CANCELLED');
    assertCurrent();
    const record = structureRecord(source, notes, parseJSON(result.text).structure);
    if (record.state === 'missing') fail(record.message, 'MODEL_FORMAT');
    store.put('sourceStructures', source.id, record);
  }
  function library(filters = {}) {
    const all = listNotes().filter(n=>!n.meta.excerptOnly).map(publicNote), matching = new Set(listNotes(filters).filter(n=>!n.meta.excerptOnly).map(n => n.id)), grouped = new Set();
    const groups = all.filter(n => n.kind === 'source').map(source => {
      const children = all.filter(n => n.kind === 'knowledge' && parentIds(n).includes(source.id)).sort(childOrder);
      children.forEach(n => grouped.add(n.id)); grouped.add(source.id);
      return { source, children, jobs: store.records('jobs').filter(j => j.type === 'process' && j.payload.noteId === source.id).map(j => ({id:j.id,state:j.state,progress:j.progress})) };
    }).filter(g => matching.has(g.source.id) || g.children.some(n => matching.has(n.id)));
    return { groups, standalone: all.filter(n => !grouped.has(n.id) && matching.has(n.id)) };
  }
  function readPublicNote(id) {
    const note = getNote(id);
    if (note.meta.excerptOnly) fail('内部核验资料不作为知识条目展示。', 'NOT_FOUND', 404);
    if (note.kind !== 'source') return publicNote(note);
    const children = sourceChildren(id);
    return { ...publicNote(note), children: children.map(publicNote), structure: structureView(note, children, store.get('sourceStructures', id)) };
  }
  function noteEvidence(id) {
    const note = getNote(id);
    const evidence = (note.meta.evidence || []).map(ev => {
      const ref = (note.meta.sources || []).find(s => s.role !== 'input' && store.row(s.id) && store.read(s.id).meta.url === ev.url);
      return { sourceId: ref?.id, title: ev.title || ev.url || '来源摘录', url: ev.url, excerpt: ev.excerpt, locator: ev.locator, fetchedAt: ev.fetchedAt, role: ev.role, rationale: ev.rationale };
    });
    for (const ref of note.meta.sources || []) {
      if (!store.row(ref.id) || evidence.some(e => e.sourceId === ref.id)) continue;
      const source = store.read(ref.id);
      evidence.push({ sourceId: source.id, title: source.title, url: source.meta.url, excerpt: source.body, locator: ref.locator || source.meta.locator, fetchedAt: source.meta.fetchedAt || source.meta.acquiredAt, role: ref.role, rationale: ref.rationale });
    }
    return { noteId: id, evidence, limitations: materialLimitations(note), researchedAt: note.meta.researchedAt };
  }
  function linksPreview(id) { getNote(id); return store.managedLinksPreview(id); }
  function syncLinks(id, input) { getNote(id); return store.syncManagedLinks(id, input); }
  function processSummary(job) {
    if (job.type !== 'process') return {};
    const expected = job.payload?.extracted?.candidates?.length || 0;
    const current = store.row(job.payload?.noteId);
    const prefix = job.payload?.noteId + ':' + job.payload?.hash + ':';
    const savedCount = store.db.prepare("SELECT count(DISTINCT json_extract(json,'$.meta.processKey')) count FROM notes WHERE json_extract(json,'$.kind')='knowledge' AND substr(json_extract(json,'$.meta.processKey'),1,?)=?").get(prefix.length, prefix).count;
    const extractionSaved = Boolean(expected && savedCount === expected && current?.hash === job.payload?.hash && !job.presetCase && !job.payload?.presetCase);
    return { extractionSaved, savedCount, phase: extractionSaved ? job.phase || (job.payload.research ? 'research_pending' : 'complete') : 'extracting' };
  }
  function publicJob(job) {
    const j = { ...structuredClone(job), ...processSummary(job) };
    delete j.runtimeIssues;
    if (['SOURCE_BUDGET','BUDGET_EXCEEDED','BUDGET_UNKNOWN'].includes(j.code) || operationalIssue(j.error || '')) j.error = '已保存，待继续。';
    return j;
  }
  function jobStatuses() {
    // Project small fields directly in SQLite; never return or parse stored model output here.
    const jobs = store.db.prepare(`SELECT j.key AS id,
      json_extract(j.json,'$.type') AS type, json_extract(j.json,'$.state') AS state, json_extract(j.json,'$.code') AS code,
      json_extract(j.json,'$.payload.noteId') AS noteId, json_extract(j.json,'$.payload.research') AS research,
      coalesce(json_extract(j.json,'$.presetCase'), json_extract(j.json,'$.payload.presetCase')) AS presetCase,
      json_extract(j.json,'$.createdAt') AS createdAt, json_extract(j.json,'$.updatedAt') AS updatedAt,
      substr(json_extract(n.json,'$.title'),1,70) AS title,
      json_extract(j.json,'$.phase') AS phase, json_extract(j.json,'$.stopCode') AS stopCode,
      json_extract(j.json,'$.researchProgress') AS researchProgress,
      json_array_length(j.json,'$.payload.extracted.candidates') AS expectedCount,
      n.hash = json_extract(j.json,'$.payload.hash') AS currentSource,
      (SELECT count(DISTINCT json_extract(c.json,'$.meta.processKey')) FROM notes c WHERE json_extract(c.json,'$.kind')='knowledge'
        AND substr(json_extract(c.json,'$.meta.processKey'),1,length(json_extract(j.json,'$.payload.noteId') || ':' || json_extract(j.json,'$.payload.hash') || ':')) =
        json_extract(j.json,'$.payload.noteId') || ':' || json_extract(j.json,'$.payload.hash') || ':') AS savedCount
      FROM records j LEFT JOIN notes n ON n.id=json_extract(j.json,'$.payload.noteId')
      WHERE j.namespace='jobs' AND json_extract(j.json,'$.type') IN ('process','structure','title')
      ORDER BY j.rowid DESC`).all().map(({ expectedCount, currentSource, researchProgress, ...job }) => ({ ...job,
      research: job.research === 1, researchProgress: researchProgress ? JSON.parse(researchProgress) : null,
      extractionSaved: Boolean(job.type === 'process' && currentSource && expectedCount && job.savedCount === expectedCount && !job.presetCase) }));
    return { jobs, jobRevision, jobSnapshot: ++jobSnapshot };
  }
  function editNote(id, input) {
    const old = getNote(id), meta = { ...(input.meta || {}) };
    // Content edits cannot impersonate a completed learning/confirmation action.
    for (const k of ['titlePending','titlePlaceholder','titleOrigin','confirmedAt','confirmedBy','personalUnderstanding','researchLimitations','evidence','supersededBy','generatedBodyHash','userEdited','learningEvidence']) delete meta[k];
    if (meta.stage && meta.stage !== old.meta.stage) fail('请通过晋级操作调整阶段。');
    if (meta.privacy && !['local','cloud'].includes(meta.privacy)) fail('隐私范围无效。');
    if(meta.researchIntervalDays!==undefined && (!Number.isInteger(Number(meta.researchIntervalDays)) || Number(meta.researchIntervalDays)<1 || Number(meta.researchIntervalDays)>365))fail('核验有效天数应为1–365。');
    if(meta.researchIntervalDays!==undefined)meta.researchIntervalDays=Number(meta.researchIntervalDays);
    if (!input.expectedHash || input.expectedHash !== old.hash) fail('文件已发生变化。请查看当前版本，再合并你的修改。', 'CONFLICT', 409);
    // Reconfirming unchanged fields must not create a new source version.
    if ((input.title === undefined || input.title === old.title) && (input.body === undefined || input.body === old.body)
      && Object.entries(meta).every(([key, value]) => JSON.stringify(value) === JSON.stringify(old.meta[key]))) return old;
    const result = store.update(id, { ...input, meta: { ...meta, ...(old.kind === 'source' && input.title !== undefined && input.title !== old.title ? { titlePending: false, titleOrigin: 'manual' } : {}), ...(old.kind === 'knowledge' ? { userEdited: true } : {}) } });
    if (old.kind === 'knowledge') requestRelations(id);
    return result;
  }
  function promote(id, { stage, reason = '', depth = 'explain' }) {
    const note = getNote(id); if (note.kind !== 'knowledge') fail('只有知识条目能进入学习阶段。');
    if (!stages.includes(stage) || !depths.includes(depth)) fail('阶段或学习目标无效。');
    if (['integrated','core'].includes(stage) && !note.meta.confirmedAt) fail('请先以自己的语言确认个人理解。');
    if (!reason.trim()) fail('请写下调整理由，便于以后回顾。');
    return store.update(id, { expectedHash: note.hash, meta: { stage, depth, promotionReason: reason, promotedAt: learningNow() } });
  }
  function confirmNote(id, { body, expectedHash }) {
    const note = getNote(id); if (note.kind !== 'knowledge') fail('请先把资料整理为知识条目。');
    if (!String(body || '').trim()) fail('请填写你自己的理解。');
    const managed = note.body.match(/<!-- zhixu-managed-links:start -->[\s\S]*?<!-- zhixu-managed-links:end -->/)?.[0] || '';
    const original = managed ? note.body.replace(managed, '').trimEnd() : note.body;
    const result = store.update(id, { expectedHash, meta: { stage: 'integrated', personalUnderstanding: body, confirmedAt: learningNow(), confirmedBy: 'user' }, body: `${original.split('\n## 我的理解（用户确认）')[0]}\n\n## 我的理解（用户确认）\n\n${body}${managed ? '\n\n'+managed : ''}` });
    requestRelations(id); return result;
  }
  function extractNote(sourceId, { title, body, topic = '', reason = '', depth = 'explain', claimType = 'fact' }) {
    const source = getNote(sourceId); if (source.kind !== 'source') fail('手动整理必须关联一份原始资料。');
    if (!String(body || '').trim() || !String(title || '').trim()) fail('请填写待选学知识标题和正文。');
    const limitation = claimType === 'opinion' ? [] : ['这份手工材料含需查证的事实；请对原始资料运行联网加工，再采用带证据的候选条目。'];
    const note = store.create({ kind: 'knowledge', title, body, meta: { stage:'candidate', privacy:source.meta.privacy, sources:[{id:sourceId,role:'input'}], topic, depth:depths.includes(depth)?depth:'explain', promotionReason:reason, userStructured:true, claimType, researchLimitations:limitation } });
    requestRelations(note.id); return note;
  }
  function merge({ keepId, mergeId, expectedHash, mergeHash, preview = true }) {
    const keep = getNote(keepId), other = getNote(mergeId); if (keepId === mergeId || keep.kind !== 'knowledge' || other.kind !== 'knowledge') fail('只能合并不同的知识条目。');
    const body = `${keep.body}\n\n## 合并保留的观点：${other.title}\n\n${other.body}`;
    if (preview) return { keepId, mergeId, before: keep.body, after: body, expectedHash: keep.hash, mergeHash: other.hash, warning: '将保留两份观点和全部来源；原条目标为被替代，可在历史中撤销。' };
    if (keep.hash !== expectedHash || other.hash !== mergeHash) fail('合并预览后文件已变化。', 'CONFLICT', 409);
    const sources = [...new Map([...(keep.meta.sources || []), ...(other.meta.sources || [])].map(s => [`${s.id}:${s.role}`,s])).values()];
    const result = store.update(keepId, { body, expectedHash, meta: { sources, privacy: keep.meta.privacy === 'cloud' && other.meta.privacy === 'cloud' ? 'cloud' : 'local', researchLimitations: [...(keep.meta.researchLimitations || []), ...(other.meta.researchLimitations || [])] } });
    store.update(mergeId, { expectedHash: mergeHash, meta: { stage: 'retired', supersededBy: keepId } }); return result;
  }
  async function search(query, options = {}) {
    if(options.scan!==false)store.scan(); const started = Date.now(), q = String(query || '').trim();
    if (!q) return { results: [], diagnostics: { mode: options.mode || 'keyword', semanticUsed: false, limitations: [], elapsedMs: 0 } };
    const browse = options.browse === true;
    const kinds = options.scope || (options.kind ? [options.kind] : (browse ? null : ['knowledge','source','topic']));
    const includeRetired = browse && options.stage === 'retired';
    const notes = store.list().filter(n => !n.meta.excerptOnly && (!kinds || kinds.includes(n.kind)) && (includeRetired ? n.meta.stage === 'retired' : n.meta.stage !== 'retired' && !n.meta.supersededBy) && (browse || (n.kind !== 'mistake' && n.kind !== 'report')) && (!options.stage || n.meta.stage === options.stage) && (!options.topic || n.meta.topic === options.topic) && (!options.source || n.meta.sources?.some(s => s.id === options.source)) && (!options.from || n.updatedAt.slice(0,10) >= options.from) && (!options.to || n.updatedAt.slice(0,10) <= options.to));
    const qtokens = tokens(q), limitations = [], keyword = [];
    for (const n of notes) {
      const text = `${n.title}\n${n.body}`.toLowerCase();
      const overlap = qtokens.filter(t => text.includes(t)).length / (qtokens.length || 1);
      const exact = text.includes(q.toLowerCase());
      if (exact || overlap >= Math.min(0.65, 2 / Math.max(1, qtokens.length))) keyword.push({ note: n, score: (exact ? 8 : 0) + overlap * 3 + (n.title.toLowerCase().includes(q.toLowerCase()) ? 3 : 0), via: ['keyword'] });
    }
    keyword.sort((a,b) => b.score - a.score);
    let semantic = [], semanticUsed = false;
    if (['semantic','hybrid'].includes(options.mode)) {
      if (options.privacy !== 'cloud') limitations.push('本次查询仅留本地，使用中文关键词查找；可单独允许查询外发以使用语义服务。');
      else if (!settings().embedding.enabled) limitations.push('语义服务未配置，当前使用中文关键词查找。');
      else {
        try {
          const queryVec = (await ai.embed({ texts: [q], privacy: 'cloud' })).vectors[0];
          const allowed = new Map(notes.filter(n => privacyFor(n) === 'cloud').map(n => [n.id,n]));
          const chunks = store.db.prepare('SELECT * FROM index_chunks WHERE vector IS NOT NULL AND model=?').all(settings().embedding.model);
          const best = new Map();
          const validVector = vector => Array.isArray(vector) && vector.length > 0 && vector.every(Number.isFinite) && vector.some(n => n !== 0);
          for (const c of chunks) if (allowed.has(c.noteId)) {
            const vector = JSON.parse(c.vector);
            if (!validVector(queryVec) || !validVector(vector) || queryVec.length !== vector.length) continue;
            const score = cosine(queryVec, vector);
            if (!best.has(c.noteId) || score > best.get(c.noteId).score) best.set(c.noteId, { note: allowed.get(c.noteId), score, via: ['semantic'] });
          }
          semanticUsed = best.size > 0;
          semantic = [...best.values()].filter(r => r.score > 0.2).sort((a,b) => b.score - a.score);
          const pending = store.missingEmbeddings({model:settings().embedding.model,noteIds:[...allowed.keys()]}).length;
          if (!chunks.length) limitations.push('向量索引为空；请在系统页构建索引。');
          else if (pending) limitations.push(`有 ${pending} 个片段尚待更新语义索引；本次仍结合现有关键词结果。`);
        } catch (error) { semanticUsed = false; limitations.push(error.message); }
      }
    }
    const fused = new Map();
    for (const list of (options.mode === 'semantic' && semantic.length ? [semantic] : [keyword, semantic])) list.forEach((r,i) => {
      const prior = fused.get(r.note.id) || { ...r, score: 0, via: [] };
      prior.score += 1 / (60 + i); prior.via.push(...r.via); fused.set(r.note.id, prior);
    });
    const results = [...fused.values()].sort((a,b) => (b.score + (['integrated','core'].includes(b.note.meta.stage) ? 0.002 : 0)) - (a.score + (['integrated','core'].includes(a.note.meta.stage) ? 0.002 : 0))).slice(0, Math.min(50, options.limit || 12)).map(r => ({ ...r.note, score: Number(r.score.toFixed(6)), via: [...new Set(r.via)], snippet: r.note.body.slice(0,600), limitations: materialLimitations(r.note) }));
    return { results, diagnostics: { mode: options.mode || 'keyword', semanticUsed, keywordIds: keyword.slice(0,12).map(r => r.note.id), semanticIds: semantic.slice(0,12).map(r => r.note.id), scanned: notes.length, elapsedMs: Date.now() - started, limitations } };
  }
  const {today,planAction,session,startStudy,answerStudy,hintStudy,confirmStudy,finishStudy,mistakeAction,topics,createTopic,updateTopic,topicAction,grade} = createLearning({
    get store(){return store;}, settings, getNote, eligible, limitationsFor: materialLimitations, privacyFor, queue, ai, promptText, parseJSON, confirmNote, updateSettings, learningClock: learningDate, practice, getPracticeQuestion: practice ? getPracticeQuestion : undefined
  });
  const {recommendations,recommendationAction} = createLifecycle({get store(){return store;},settings,materialLimitations,getNote,promote,merge});
  function valuableRelation(r, left, right) {
    const types = ['analogy','prerequisite','support','oppose','example','counterexample','application','correction'];
    return types.includes(r.type) && r.highValue === true &&
      ['explanation','use','boundary','sourceExcerpt','targetExcerpt'].every(k=>typeof r[k]==='string'&&r[k].trim()) &&
      left.body.includes(r.sourceExcerpt) && right.body.includes(r.targetExcerpt) &&
      r.fromHash===left.hash && r.toHash===right.hash &&
      !(parentId(left) && parentId(left)===parentId(right)) &&
      !materialLimitations(left).length && !materialLimitations(right).length;
  }
  function relationReview() {
    store.scan();
    const notes = new Map(store.list().filter(n=>n.kind==='knowledge'&&!n.meta.supersededBy&&n.meta.stage!=='retired').map(n=>[n.id,n]));
    const accepted=[], pending=[], candidates=[];
    for (const r of store.records('relations')) {
      const left=notes.get(r.fromId), right=notes.get(r.toId);
      if (!left || !right || left.id===right.id) continue;
      const row={...r,fromTitle:left.title,toTitle:right.title};
      if (r.state==='accepted') accepted.push(row);
      else if (r.state==='suggested'&&valuableRelation(r,left,right)) pending.push(row);
      else if (r.state==='candidate' && r.fromHash===left.hash && r.toHash===right.hash && !materialLimitations(left).length && !materialLimitations(right).length) candidates.push(row);
    }
    pending.sort((a,b)=>(Number(b.valueScore)||0)-(Number(a.valueScore)||0));
    return {candidates:candidates.slice(0,12),relations:[...pending.slice(0,3),...accepted],deferredCount:Math.max(0,pending.length-3),reports:listNotes({kind:'report'})};
  }
  function relationAction(id, { action, reason = '' }) {
    store.scan();
    const r = store.get('relations', id); if (!r || !['accept','reject','remove'].includes(action)) fail('关系操作无效。');
    if (action === 'remove' || (action === 'reject' && r.state === 'accepted')) {
      store.scan();
      for (const noteId of new Set([r.fromId,r.toId])) {
        if (!store.row(noteId)) continue;
        const note=store.read(noteId);
        if (note.meta.relations?.some(x=>x.id===id)) {
          store.update(note.id,{expectedHash:note.hash,meta:{relations:note.meta.relations.filter(x=>x.id!==id)}});
          const preview=store.managedLinksPreview(note.id); if(preview.changed&&!preview.conflict)store.syncManagedLinks(note.id,{expectedHash:preview.expectedHash});
        }
      }
      return store.put('relations',id,{...r,state:'rejected',removedAt:now(),updatedAt:now(),userReason:reason || '用户移除联系'});
    }
    const left = getNote(r.fromId), right = getNote(r.toId);
    if (r.fromHash !== left.hash || r.toHash !== right.hash) fail('关系涉及的内容已有变化，请重新生成建议。', 'CONFLICT', 409);
    r.state = action === 'accept' ? 'accepted' : 'rejected'; r.userReason = reason; r.updatedAt = now();
    if (action === 'accept') {
      const relations = [...(left.meta.relations || []).filter(x => x.id !== r.id), r];
      store.update(left.id, { expectedHash: left.hash, meta: { relations } });
      const preview=store.managedLinksPreview(left.id);
      if(preview.changed&&!preview.conflict)store.syncManagedLinks(left.id,{expectedHash:preview.expectedHash});
    }
    if(action==='accept'){store.scan();return store.get('relations',id);}
    return store.put('relations', id, r);
  }
  function related(id) {
    getNote(id); const relations = store.records('relations').filter(r => (r.fromId === id || r.toId === id) && ['accepted','suggested','candidate'].includes(r.state));
    const ids = new Set(relations.flatMap(r => [r.fromId,r.toId])); ids.delete(id);
    return { relations, notes: store.list().filter(n => ids.has(n.id) && !n.meta.supersededBy && n.meta.stage !== 'retired') };
  }
  async function ask({ question, scope = ['knowledge','source'], mode = 'answer', privacy = 'local' }) {
    if (!String(question || '').trim()) fail('请填写问题或输出目标。');
    const result = await search(question, { scope, mode: 'hybrid', limit: 8, privacy });
    const usableResults = result.results.filter(n => !n.limitations.length), cloud = usableResults.filter(n => privacyFor(n) === 'cloud');
    const citations = usableResults.map(n => ({ id: n.id, title: n.title, excerpt: n.snippet, sources: (n.meta.sources || []).map(s => { const source = store.row(s.id) ? store.read(s.id) : null; return { ...s, title: source?.title, url: source?.meta.url, excerpt: source?.body.slice(0,500) }; }) }));
    const limitations = [...result.diagnostics.limitations];
    let answer, modelGenerated = false;
    if (!usableResults.length) answer = '知识库中没有找到可直接支持这个问题的当前材料。请补充来源或调整查找范围。';
    else if (privacy !== 'cloud' || !cloud.length || !settings().ai.enabled) { answer = '已找到以下材料，可在本地阅读。本次问题仅限本地、模型未启用或材料仅限本地，尚未生成答案。\n\n' + citations.map(c => `- ${c.title} [${c.id}]\n${c.excerpt}`).join('\n\n'); limitations.push('未进行 AI 生成。'); }
    else {
      if (cloud.length < usableResults.length) limitations.push('仅本地资料已留在本机，未交给外部模型。');
      const prompt = promptText('ask',{question,mode,outputType:mode === 'answer' ? '回答' : mode === 'outline' ? '包含观点、证据、案例、反方、限制、未知的提纲' : '可编辑草稿',materials:JSON.stringify(cloud.map(n=>({id:n.id,kind:n.kind,stage:n.meta.stage,title:n.title,body:n.body.slice(0,6000),sources:n.meta.sources,evidence:n.meta.evidence,personalUnderstanding:n.meta.personalUnderstanding})))});
      const generated = parseJSON((await ai.generate({ system: promptText('serviceSystem'), prompt, privacy: 'cloud', json: true })).text);
      const allowed = new Set(cloud.map(n => n.id));
      if (!Array.isArray(generated.citationIds) || !generated.citationIds.length || generated.citationIds.some(id => !allowed.has(id)) || typeof generated.answer !== 'string') fail('回答引用不符合实际检索材料；已拒绝保存。', 'INVALID_CITATION', 422);
      const inline = [...generated.answer.matchAll(/\[([^\]\n]+)\]/g)].map(m=>m[1]);
      if (!inline.length || inline.some(id=>!allowed.has(id)) || generated.citationIds.some(id=>!inline.includes(id))) fail('正文中的引用与材料清单不一致；已拒绝保存。','INVALID_CITATION',422);
      answer = generated.answer; modelGenerated = true; limitations.push('AI 草稿需自行审阅，引用存在不等于每个主张都获支持。');
      citations.splice(0,citations.length,...citations.filter(c => generated.citationIds.includes(c.id)));
    }
    const id = randomUUID(); store.put('drafts', id, { id, mode, question, body: answer, citations, limitations, usedIds: [], createdAt: now() });
    return { answer, citations, limitations, draftId: id, generated: modelGenerated };
  }
  function updateDraft(id, { body, usedIds = [] }) {
    const d = store.get('drafts', id); if (!d) fail('草稿不存在。', 'NOT_FOUND', 404);
    const allowed = new Set(d.citations.map(c => c.id)); if (usedIds.some(id => !allowed.has(id))) fail('采用项须来自本草稿引用。');
    for (const use of store.records('uses').filter(u => u.draftId === id && !usedIds.includes(u.noteId))) store.remove('uses', `${id}:${use.noteId}`);
    for (const noteId of new Set(usedIds)) if (!store.get('uses', `${id}:${noteId}`)) store.put('uses', `${id}:${noteId}`, { draftId: id, noteId, actualUse: true, at: learningNow() });
    const saved = store.put('drafts', id, { ...d, body: String(body ?? d.body), usedIds, updatedAt: now() });
    return { ...saved, removedUseIds: (d.usedIds || []).filter(noteId => !usedIds.includes(noteId)) };
  }
  function propose({ noteId, body, reason, expectedHash }) {
    if (!settings().mcp.allowProposals) fail('尚未启用 MCP 写入提案。', 'MCP_PROPOSALS_DISABLED', 403);
    const n = getNote(noteId); if (!expectedHash || expectedHash !== n.hash) fail('提案基于旧版本。', 'CONFLICT', 409);
    if (typeof body !== 'string' || !body.trim() || body.length > 500000) fail('提案正文无效。');
    const id = randomUUID(); return store.put('proposals', id, { id, noteId, before: n.body, body, reason, expectedHash, state: 'pending', createdAt: now() });
  }
  function proposalAction(id, { action }) {
    const p = store.get('proposals', id); if (!p || p.state !== 'pending') fail('提案不可操作。');
    if (action === 'accept') store.update(p.noteId, { body: p.body, expectedHash: p.expectedHash, ...(p.meta ? { meta: { ...p.meta, userEdited: false, ...(p.meta.processKey ? { acceptedResearchProposal: p.id } : {}), personalUnderstanding: null, confirmedAt: null, confirmedBy: null } } : {}) }); else if (action !== 'reject') fail('提案操作无效。');
    return store.put('proposals', id, { ...p, state: action === 'accept' ? 'accepted' : 'rejected', updatedAt: now() });
  }
  async function processSource(job, signal) {
    let source = getNote(job.payload.noteId);
    // A preceding title-only task may have updated this version while processing was queued.
    if (source.hash !== job.payload.hash && store.records('jobs').some(task => task.type === 'title' && task.state === 'done' && task.payload.noteId === source.id && task.payload.hash === job.payload.hash && task.payload.resultHash === source.hash)) {
      job.payload.hash = source.hash; job.dedupKey = `process:${source.id}:${source.hash}${job.payload.research ? ':research' : ''}`; putJob(job);
    }
    if (source.hash !== job.payload.hash) fail('资料已修改，请对新版本重新加工。', 'SOURCE_CHANGED');
    // Also cover retained jobs queued before another task saved the same source extraction.
    let extracted = validExtraction(job.payload.extracted) ? job.payload.extracted
      : processJobs(source.id, source.hash).find(previous => previous.id !== job.id && validExtraction(previous.payload.extracted))?.payload.extracted;
    if (!extracted) {
      extracted = parseJSON((await ai.generate({ system: `${promptText('serviceSystem')}\n${sourceExtractionStructure}\n${extractionResearchContract}${needsTitle(source) ? '\n'+sourceTitleContract : ''}`, privacy: privacyFor(source), signal, json: true, prompt: promptText('sourceExtract',{source:source.body}) })).text);
      if (!Array.isArray(extracted.candidates) || !extracted.candidates.length || extracted.candidates.length > 8) fail('拆解结果格式不正确。', 'MODEL_FORMAT');
    }
    if (signal.aborted) fail('任务已取消。', 'CANCELLED');
    if (getNote(source.id).hash !== source.hash) fail('资料已修改，请对新版本重新加工。', 'SOURCE_CHANGED');
    for (const candidate of extracted.candidates) if (typeof candidate.title !== 'string' || typeof candidate.body !== 'string' || !Array.isArray(candidate.claims) || candidate.claims.some(x => typeof x !== 'string')) fail('待选学知识格式不正确。', 'MODEL_FORMAT');
    if (needsTitle(source)) {
      // Older custom extraction templates remain usable even if they omit sourceTitle.
      if (validSourceTitle(extracted.sourceTitle) && !job.payload.savedCandidates?.ids?.some(Boolean)) {
        source = saveSourceTitle(source, extracted.sourceTitle, signal);
        job.payload.hash = source.hash;
        job.dedupKey = `process:${source.id}:${source.hash}${job.payload.research ? ':research' : ''}`;
      } else if (!store.records('jobs').some(task => task.type === 'title' && task.payload.noteId === source.id && task.state !== 'cancelled')) titleJob(source, true);
    }
    const retained = [job, ...processJobs(source.id, source.hash)].find(previous => previous.payload?.savedCandidates?.hash === source.hash)?.payload.savedCandidates;
    job.payload.savedCandidates = retained ? structuredClone(retained) : { hash: source.hash, ids: extracted.candidates.map((_, i) => store.list().find(n => n.meta.processKey === `${source.id}:${source.hash}:${i}`)?.id || null) };
    job.payload.extracted = structuredClone(extracted); putJob(job);
    for (const candidate of extracted.candidates) candidate.claims = [...new Set(candidate.claims.map(c=>c.trim()).filter(Boolean))];
    const requestedResearch = job.payload.research === true;
    const shared = new Map(), changedClaims = new Set(), runtimeIssues = [];
    const claims = [...new Set(extracted.candidates.flatMap(candidate => candidate.claims))];
    const keyFor = claim => hash(claim + ':' + source.hash);
    function assertCurrent() {
      if (signal.aborted) fail('任务已取消。', 'CANCELLED');
      const current = getNote(source.id);
      if (current.hash !== source.hash) fail('资料已修改，请对新版本重新加工。', 'SOURCE_CHANGED');
      if (privacyFor(current) !== 'cloud') fail('资料已改为仅限本地，后续处理已停止。', 'PRIVACY_LOCAL');
      if (job.payload.savedCandidates.ids.some(id => id && !store.row(id))) fail('拆解条目已删除，核验已停止；不会自动重建已删除内容。', 'CANDIDATE_REMOVED');
    }
    function updateProgress() {
      const cached = claims.map(claim => store.get('research', keyFor(claim)));
      job.researchProgress = { total: claims.length,
        covered: cached.filter(c => c?.coverage === 'searched' || c && !c.coverage && !c.result.limitations?.some(text => /未纳入本轮|尚未轮到/.test(text))).length,
        verified: cached.filter(c => c?.result.evidence?.length && !c.result.limitations?.length && Date.now() - Date.parse(c.at) < 7*86400000).length };
      job.progress = requestedResearch && claims.length ? Math.round(job.researchProgress.covered / claims.length * 100) : 100;
      putJob(job);
    }
    async function saveResults(research) {
      assertCurrent();
      for (let i=0;i<extracted.candidates.length;i++) {
        if (signal.aborted) throw new Error('任务已取消');
        const candidate = extracted.candidates[i];
        if (research && !candidate.claims.some(claim => changedClaims.has(claim))) continue;
        if (typeof candidate.title !== 'string' || typeof candidate.body !== 'string' || !Array.isArray(candidate.claims) || candidate.claims.some(x => typeof x !== 'string')) fail('待选学知识格式不正确。', 'MODEL_FORMAT');
        const evidence = [], limitations = [], conclusions = [], notices = [];
        for (const claim of candidate.claims) {
          if (!research) { limitations.push(`“${claim}”尚待核验（未执行联网检验）。`); continue; }
          try {
            const result = shared.get(claim) || { evidence: [], limitations: ['该事实尚待核验。'] };
            evidence.push(...result.evidence); limitations.push(...result.limitations); if(result.conclusion)conclusions.push(result.conclusion);if(result.notice)notices.push(result.notice);
            if (!result.evidence.length) limitations.push(`“${claim}”尚无可读取的外部证据。`);
          } catch (error) { runtimeIssues.push({code:error.code,message:error.message}); limitations.push(`“${claim}”：尚待核验。`); }
        }
        if (signal.aborted) fail('任务已取消。','CANCELLED');
        const sourceRefs = [{ id: source.id, role: 'input' }];
        for (const ev of evidence) {
          const existing = store.list().find(n => n.kind === 'source' && n.meta.url === ev.url && n.meta.excerptHash === hash(ev.excerpt));
          const e = existing || store.create({ kind: 'source', title: ev.title || ev.url, body: ev.excerpt, meta: { url: ev.url, locator: ev.locator, fetchedAt: ev.fetchedAt, privacy: source.meta.privacy, excerptHash: hash(ev.excerpt), excerptOnly: true } });
          sourceRefs.push({ id: e.id, role: ['support','oppose','limit'].includes(ev.role) ? ev.role : 'support', locator: ev.locator });
        }
        const processKey = `${source.id}:${source.hash}:${i}`, savedId = job.payload.savedCandidates.ids[i];
        const existing = store.list().find(n => savedId ? n.id === savedId : n.meta.processKey === processKey);
        const body = `## 原资料拆解（AI 整理）\n\n${candidate.body}\n\n## 证据与适用范围\n\n${conclusions.join('\n\n')}\n\n${evidence.map(e => `- [${e.title || e.url}](${e.url})（${e.role}，读取于 ${e.fetchedAt}）\n  ${e.excerpt}${e.rationale ? '\n  对应关系：'+e.rationale : ''}`).join('\n\n') || '此条未取得可引用的外部正文。'}${notices.length ? '\n\n### 研究范围\n'+notices.join('\n') : ''}${limitations.length ? '\n\n## 尚需补充的研究\n'+limitations.map(l=>`- ${l}`).join('\n') : ''}`;
        const meta = { stage: 'candidate', privacy: source.meta.privacy, sources: sourceRefs, topic: candidate.topic || '', prerequisites: candidate.prerequisites || [], promotionReason: candidate.reason || '', depth: depths.includes(candidate.depth) ? candidate.depth : 'explain', claims: candidate.claims, evidence, researchConclusions: conclusions.join('\n\n'), researchLimitations: limitations, researchedAt: research ? now() : null, reviewAfter: research && candidate.claims.length ? new Date(learningDate().getTime()+(Number.isInteger(source.meta.researchIntervalDays)&&source.meta.researchIntervalDays>=1&&source.meta.researchIntervalDays<=365?source.meta.researchIntervalDays:30)*86400000).toISOString() : null, processKey, generatedBodyHash: hash(body) };
        if (existing && !research) continue;
        const wasEdited = existing && (existing.meta.userEdited || existing.meta.acceptedResearchProposal || existing.meta.confirmedAt || existing.meta.stage !== 'candidate' || (existing.meta.generatedBodyHash && hash(existing.body) !== existing.meta.generatedBodyHash));
        if (existing && existing.body === body && JSON.stringify(existing.meta.evidence || []) === JSON.stringify(evidence) && JSON.stringify(existing.meta.researchLimitations || []) === JSON.stringify(limitations)) { continue; }
        if (wasEdited) {
          const proposalId = hash(`research-update:${existing.id}:${existing.hash}:${hash(body)}`);
          for (const previous of store.records('proposals')) if (previous.id !== proposalId && previous.noteId === existing.id && previous.state === 'pending' && previous.meta?.processKey === processKey) {
            store.put('proposals', previous.id, { ...previous, state: 'superseded', supersededBy: proposalId, updatedAt: now() });
          }
          const previous = store.get('proposals', proposalId);
          if (!previous || previous.state === 'superseded') store.put('proposals', proposalId, { id: proposalId, noteId: existing.id, before: existing.body, body, meta, reason: '重新研究产生修订建议，已有人工内容，未自动覆盖。接受后回到候选阶段，原来的个人理解保留在历史中；请依据新材料再次确认自己的理解。', expectedHash: existing.hash, state:'pending', createdAt:previous?.createdAt || now() });
          continue;
        }
        const note = existing ? store.update(existing.id, { body, meta, expectedHash: existing.hash }) : store.create({ kind:'knowledge', title:candidate.title, body, meta });
        if (!job.payload.savedCandidates.ids[i]) { job.payload.savedCandidates.ids[i] = note.id; putJob(job); }
        if (eligible(note)) requestRelations(note.id);
      }
      // Structure is a derived view: never rewrite the source or user-edited knowledge to save it.
      store.scan();
      if (store.row(source.id)?.hash === source.hash) {
        const children = sourceChildren(source.id);
        const keys = new Map(extracted.candidates.flatMap((candidate, index) => {
          const note = children.find(n => n.meta.processKey === `${source.id}:${source.hash}:${index}`);
          return note && note.body.includes(candidate.body) ? [[String(index), note.id]] : [];
        }));
        const previous = store.get('sourceStructures', source.id);
        if (!previous || structureView(source, children, previous).state === 'stale') {
          store.put('sourceStructures', source.id, structureRecord(source, children, extracted.structure, keys));
        }
      }
    }
    // Persist extraction independently; a later network failure cannot erase this checkpoint.
    await saveResults(false);
    job.extractionSaved = true; job.savedCount = extracted.candidates.length;
    job.phase = requestedResearch && claims.length ? 'research' : 'complete';
    job.runtimeIssues = []; job.stopCode = null; updateProgress();
    if (!requestedResearch || !claims.length) return;
    const pending = [];
    for (const claim of claims) {
      const cached = store.get('research', keyFor(claim));
      const fresh = cached && Date.now() - Date.parse(cached.at) < 7*86400000;
      if (cached) {
        shared.set(claim, fresh ? cached.result : { ...cached.result, limitations: [...new Set([...(cached.result.limitations || []), `“${claim}”的核验缓存已过期，尚待重新核验。`])] });
        if (!fresh) changedClaims.add(claim);
      }
      if (fresh && cached.result.evidence?.length && !cached.result.limitations?.length) changedClaims.add(claim);
      else pending.push(claim);
    }
    // Unvisited claims precede unsuccessful earlier groups; later retries rotate fairly.
    const attempts = claim => { const c = store.get('research', keyFor(claim)); return c?.attempts ?? (c && !c.result.limitations?.some(text => /未纳入本轮|尚未轮到/.test(text)) ? 1 : 0); };
    pending.sort((a,b) => attempts(a) - attempts(b));
    await saveResults(true); changedClaims.clear();
    async function checkpoint(results) {
      assertCurrent(); changedClaims.clear();
      for (let result of results) {
        if (!pending.includes(result.claim) || result.coverage === 'unsearched' && !result.stopCode) continue;
        const key = keyFor(result.claim), previous = store.get('research', key);
        const attemptCoverage = result.coverage || 'searched';
        const coverage = previous?.coverage === 'searched' ? 'searched' : attemptCoverage;
        if (previous?.result.evidence?.length && !result.evidence?.length) result = { ...previous.result, claim: result.claim, limitations: [...new Set([...(previous.result.limitations || []), ...(result.limitations || [])])], coverage };
        store.put('research', key, { result, at: now(), coverage, attempts: (previous?.attempts || 0) + (attemptCoverage === 'unsearched' ? 0 : 1) });
        shared.set(result.claim, result); changedClaims.add(result.claim);
      }
      await saveResults(true); updateProgress();
    }
    const hints = job.payload.extracted.candidates.flatMap(candidate => (Array.isArray(candidate.claimChecks) ? candidate.claimChecks : []).flatMap(hint =>
      Number.isInteger(hint?.claimIndex) && candidate.claims[hint.claimIndex] && ['formal','empirical','attribution'].includes(hint.kind) && typeof hint.subject === 'string'
        ? [{ claim: candidate.claims[hint.claimIndex].trim(), kind: hint.kind, subject: hint.subject.slice(0,180) }] : []));
    try {
      if (pending.length && ai.researchBatch) {
        const delivered = new Set();
        const batch = await ai.researchBatch({ claims: pending, topic: source.title, privacy: privacyFor(source), signal, prompts: settings().prompts, hints,
          checkCurrent: assertCurrent, onBatch: async results => { await checkpoint(results); results.forEach(r => delivered.add(r.claim)); } });
        await checkpoint(batch.results.filter(result => !delivered.has(result.claim)));
        runtimeIssues.push(...(batch.issues || []));
      } else for (const claim of pending) {
        assertCurrent();
        await checkpoint([{ ...await ai.research({ claim, privacy: privacyFor(source), signal, prompts: settings().prompts }), claim }]);
      }
    } catch (error) {
      if (signal.aborted || ['PRIVACY_LOCAL','SOURCE_CHANGED','CANDIDATE_REMOVED'].includes(error.code)) throw error;
      runtimeIssues.push({ code: error.code || 'RESEARCH_FAILED', message: error.message });
    }
    job.runtimeIssues = runtimeIssues; job.stopCode = runtimeIssues[0]?.code || null;
    updateProgress();
    job.phase = job.researchProgress.verified === claims.length ? 'complete' : 'research_pending'; putJob(job);
    if (job.phase === 'research_pending') fail('拆解已保存，部分事实尚待核验；可先阅读，按需继续核验。', 'RESEARCH_INCOMPLETE');
  }
  function requestRelations(id, {useAI=false}={}) {
    const note=getNote(id); if(note.kind!=='knowledge') fail('请选择知识条目探索联系。');
    return queue('relate',{noteId:id,useAI:useAI===true},`relate:${id}:${note.hash}:${useAI===true}`);
  }
  async function relate(job, signal) {
    const note=job.snapshot || getNote(job.payload.noteId);
    if(!eligible(note)) { if(job.payload.useAI)fail('这条知识仍有待研究内容，请先处理依据。','RESEARCH_INCOMPLETE'); return; }
    const res=await search(`${note.title} ${note.meta.topic || ''}`,{mode:'keyword',limit:7,scan:false});
    const bridges=store.list().filter(n=>n.id!==note.id&&eligible(n)&&n.meta.topic!==note.meta.topic)
      .sort((a,b)=>hash(`${note.id}:${a.id}`).localeCompare(hash(`${note.id}:${b.id}`))).slice(0,3);
    let candidates=[...new Map([...res.results.filter(n=>n.id!==note.id&&eligible(n)).slice(0,4),...bridges].map(n=>[n.id,n])).values()];
    for(const n of candidates) {
      const id=hash([note.id,n.id].sort().join(':')), old=store.get('relations',id);
      if(!old||old.state==='candidate')store.put('relations',id,{id,fromId:note.id,toId:n.id,fromHash:note.hash,toHash:n.hash,type:'similarity',state:'candidate',explanation:'本地召回的比较材料，尚不能视为机制相同。',use:'可比较术语与适用条件。',boundary:'文字相似或同属关注领域不能证明因果或迁移关系。',evidence:[note.id,n.id],createdAt:now()});
    }
    if(!job.payload.useAI)return;
    if(privacyFor(note)!=='cloud')fail('这条知识仅限本地，请先自行决定是否允许外发。','PRIVACY_LOCAL');
    if(!settings().ai.enabled)fail('AI 未启用；本地候选已保留。','AI_DISABLED');
    const assertCurrent = notes => {
      store.scan();
      for(const before of notes) {
        if(!store.row(before.id))fail('探索时知识已删除，请重新探索。','SOURCE_CHANGED');
        const current=store.read(before.id);
        if(privacyFor(current)!=='cloud')fail('探索时资料改为仅限本地，已停止后续外发。','PRIVACY_LOCAL');
        if(current.hash!==before.hash)fail('探索时知识已有变化，请重新探索。','SOURCE_CHANGED');
      }
    };
    assertCurrent([note]);
    const current=JSON.stringify({id:note.id,title:note.title,body:note.body.slice(0,4500)});
    const expanded=parseJSON((await ai.generate({system:promptText('serviceSystem'),privacy:'cloud',signal,json:true,prompt:promptText('relationQueries',{current})})).text);
    if(!Array.isArray(expanded.queries)||expanded.queries.some(q=>typeof q!=='string'))fail('关联检索短语格式无效，本地候选已保留。','MODEL_FORMAT');
    const retrieved=[];
    for(const query of expanded.queries.slice(0,2)) {
      assertCurrent([note]);
      const result=await search(query.slice(0,120),{mode:settings().embedding.enabled?'hybrid':'keyword',privacy:'cloud',scope:['knowledge'],limit:6});
      retrieved.push(...result.results);
    }
    candidates=[...new Map([...retrieved,...candidates].filter(n=>n.id!==note.id&&privacyFor(n)==='cloud'&&eligible(n)).map(n=>[n.id,n])).values()].slice(0,10);
    if(!candidates.length)return;
    assertCurrent([note,...candidates]);
    const parsed=parseJSON((await ai.generate({system:promptText('serviceSystem'),privacy:'cloud',signal,json:true,prompt:promptText('relate',{current,candidates:JSON.stringify(candidates.map(n=>({id:n.id,title:n.title,body:n.body.slice(0,3000)})))})})).text);
    if(!Array.isArray(parsed.relations))fail('关联结果格式无效，本地候选已保留。','MODEL_FORMAT');
    if(getNote(note.id).hash!==note.hash)fail('探索时知识已有变化，请重新探索。','SOURCE_CHANGED');
    for(const r of parsed.relations.slice(0,2)) {
      const target=candidates.find(n=>n.id===r.toId);if(!target||!store.row(target.id)||getNote(target.id).hash!==target.hash)continue;
      const id=hash([note.id,target.id].sort().join(':')),old=store.get('relations',id);
      if(old&&!['suggested','candidate'].includes(old.state))continue;
      const proposed={...r,id,fromId:note.id,fromHash:note.hash,toHash:target.hash,state:'suggested',evidence:[note.id,target.id],createdAt:now()};
      if(valuableRelation(proposed,note,target))store.put('relations',id,proposed);
    }
  }
  async function discover(job, signal) {
    store.scan(); const notes=store.list().filter(n=>n.kind==='knowledge'&&n.meta.stage!=='retired');
    const relations=store.records('relations').filter(r=>r.state==='accepted'), linked=new Set(relations.flatMap(r=>[r.fromId,r.toId]));
    const isolated=notes.filter(n=>!linked.has(n.id)), unused=notes.filter(n=>!store.records('uses').some(u=>u.noteId===n.id));
    let body=`# 知识结构检查\n\n检查时间：${now()}\n知识条目：${notes.length}；已确认关系：${relations.length}。\n\n## 孤立节点\n${isolated.slice(0,30).map(n=>`- ${n.title}（${n.id}）`).join('\n') || '无'}\n\n## 尚无实际输出使用记录\n${unused.slice(0,30).map(n=>`- ${n.title}`).join('\n') || '无'}\n\n以上只是导航线索，不以曝光次数判断价值。`;
    const changed=new Set(store.records('changed').map(n=>n.id));
    let discoveryIssue=null;
    const selected=[...notes.filter(n=>changed.has(n.id)),...isolated,...notes].filter((n,i,a)=>privacyFor(n)==='cloud'&&a.findIndex(v=>v.id===n.id)===i).slice(0,16);
    if(job.payload.useAI===true&&settings().ai.enabled&&selected.length){try {const answer=await ai.generate({system:promptText('serviceSystem'),privacy:'cloud',signal,prompt:promptText('discover',{notes:JSON.stringify(selected.map(n=>({id:n.id,title:n.title,topic:n.meta.topic,summary:n.body.slice(0,900)})))})});body+=`\n\n## AI 发现建议（待审阅）\n${answer.text}`;}catch(error){discoveryIssue=error;body+=`\n\n## AI 探索未完成\n${error.message}`;}}else body+='\n\n## 探索限制\n当前为本地结构检查；没有选择付费 AI 探索或没有获准外发的摘要，尚未生成跨领域语义发现。';
    const cursor=store.get('schedule','discoveryCursor',{offset:0}).offset, available=notes.filter(eligible);
    const batch=[...available.slice(cursor),...available.slice(0,cursor)].slice(0,16);
    for(const n of batch)await relate({payload:{noteId:n.id,useAI:false},snapshot:n},signal);
    store.put('schedule','discoveryCursor',{offset:available.length?(cursor+batch.length)%available.length:0});
    if(job.payload.useAI===true&&!discoveryIssue)for(const n of selected.filter(eligible).slice(0,2)){try{await relate({payload:{noteId:n.id,useAI:true}},signal);}catch(error){discoveryIssue=error;body+=`\n\n## 关联细查未完成\n${error.message}`;break;}}
    body+=`\n\n本次本地比较 ${batch.length} 条；AI 细查最多2条。每次轮换覆盖，不能视为全库穷尽。`;
    const actions=recommendations().suggestions;
    body+='\n\n## 可处理的建议\n'+(actions.map(a=>`- ${a.title}：${a.reason}`).join('\n') || '暂无有记录依据的阶段调整建议。');
    store.create({kind:'report',title:`AI 整理建议 ${localDay(learningDate(),settings().timezone)}`,body,meta:{privacy:'local',generated:true,recommendationIds:actions.map(a=>a.id),relationIds:store.records('relations').filter(r=>['suggested','candidate'].includes(r.state)).map(r=>r.id)}});
    store.put('schedule','discovery',{at:learningNow()});for(const n of selected)store.remove('changed',n.id);
    if(discoveryIssue)throw discoveryIssue;
  }
  async function rebuildIndex(job, signal) {
    store.scan(); const ids=store.list().map(n=>n.id);
    for(let i=0;i<ids.length;i++) {
      store.scan(); if(!store.row(ids[i]))continue;
      const n=store.read(ids[i]), model=settings().embedding.model;
      store.index(n.id,`${n.title}\n${n.body}`);
      if(settings().embedding.enabled&&privacyFor(n)==='cloud'&&['knowledge','source','topic'].includes(n.kind)&&n.meta.stage!=='retired'&&!n.meta.supersededBy) {
        const chunks=store.missingEmbeddings({model,noteIds:[n.id]});
        if(chunks.length) {
          const vectors=(await ai.embed({texts:chunks.map(c=>c.body),privacy:'cloud',signal})).vectors;
          if(vectors.length!==chunks.length || vectors.some(v=>!Array.isArray(v)||!v.length||v.some(x=>!Number.isFinite(x))))fail('向量结果与检索片段不一致。');
          store.scan();
          // The material or its privacy may change while the external request is running.
          if(store.row(n.id)&&privacyFor(store.read(n.id))==='cloud'&&model===settings().embedding.model) {
            for(let j=0;j<chunks.length;j++)store.db.prepare('UPDATE index_chunks SET vector=?,model=? WHERE id=? AND noteId=? AND body=?').run(JSON.stringify(vectors[j]),model,chunks[j].id,n.id,chunks[j].body);
          }
        }
      }
      job.progress=Math.round((i+1)/ids.length*100);putJob(job);
    }
  }
  async function suggestTopics(job, signal) {
    const notes=store.list().filter(n=>eligible(n)&&privacyFor(n)==='cloud'&&n.meta.stage!=='retired').slice(0,24);
    if(!notes.length)fail('没有可交给外部模型的当前知识材料；你仍可手工建立主题。','PRIVACY_LOCAL');
    const parsed=parseJSON((await ai.generate({system:promptText('serviceSystem'),privacy:'cloud',signal,json:true,prompt:promptText('topics',{focusTopics:settings().focusTopics.join('、') || '由材料自然组织',notes:JSON.stringify(notes.map(n=>({id:n.id,title:n.title,topic:n.meta.topic,body:n.body.slice(0,1200),prerequisites:n.meta.prerequisites})))}) })).text);
    if(!Array.isArray(parsed.packages)||!parsed.packages.length)fail('模型没有给出学习包。','MODEL_FORMAT');
    for(const p of parsed.packages)if(!Array.isArray(p.noteIds)||p.noteIds.some(id=>!notes.some(n=>n.id===id)))fail('学习包包含不存在的材料。','INVALID_CITATION');
    const body=`# 学习包建议（待你调整确认）\n\n${parsed.packages.map(p=>`## ${p.title}\n\n问题：${p.problem}\n\n顺序：\n${p.noteIds.map((id,i)=>`${i+1}. ${store.read(id).title}（${id}）`).join('\n')}\n\n前置缺口：${(p.prerequisites||[]).join('；')||'未指出'}\n\n预计 ${p.minutes} 分钟`).join('\n\n')}\n\n可在主题页选择这些知识，合并、拆分、调整顺序后确认。此报告没有将任何知识标为已掌握。`;
    store.create({kind:'report',title:'AI 学习包建议',body,meta:{privacy:'local',generated:true,packages:parsed.packages}});
  }
  async function runJobs() {
    if(processing||stopped||pausing)return;
    const job=store.records('jobs').reverse().find(j=>j.state==='queued');if(!job)return;
    processing=true;currentJob=job.id;controller=new AbortController();job.state='running';job.attempts++;job.error='';job.code=null;job.runtimeIssues=[];job.stopCode=null;putJob(job);
    try{if(job.type==='process')await (ai.withBudget ? ai.withBudget({limit:settings().ai.sourceCallLimit,sourceId:job.payload.noteId},()=>processSource(job,controller.signal)) : processSource(job,controller.signal));else if(job.type==='title')await (ai.withBudget ? ai.withBudget({limit:settings().ai.sourceCallLimit,sourceId:job.payload.noteId},()=>generateSourceTitle(job,controller.signal)) : generateSourceTitle(job,controller.signal));else if(job.type==='structure')await (ai.withBudget ? ai.withBudget({limit:settings().ai.sourceCallLimit,sourceId:job.payload.noteId},()=>analyzeSourceStructure(job,controller.signal)) : analyzeSourceStructure(job,controller.signal));else if(job.type==='grade')await grade(job,controller.signal);else if(job.type==='relate')await (ai.withBudget ? ai.withBudget({limit:settings().ai.sourceCallLimit,sourceId:job.payload.noteId},()=>relate(job,controller.signal)) : relate(job,controller.signal));else if(job.type==='discover')await (ai.withBudget ? ai.withBudget({limit:settings().ai.sourceCallLimit,sourceId:'discovery'},()=>discover(job,controller.signal)) : discover(job,controller.signal));else if(job.type==='index')await rebuildIndex(job,controller.signal);else if(job.type==='topics')await suggestTopics(job,controller.signal);else fail('未知任务类型。');if(store.get('jobs',job.id)?.state!=='cancelled')putJob({...job,state:'done',progress:100});}
    catch(error){if(store.get('jobs',job.id)?.state!=='cancelled')putJob({...job,state:['PRIVACY_LOCAL','DISABLED','NOT_CONFIGURED','BUDGET_EXCEEDED','SOURCE_BUDGET','BUDGET_UNKNOWN','RESEARCH_INCOMPLETE','AI_DISABLED','MISSING_KEY','CAPABILITY_DISABLED','MISSING_CREDENTIALS'].includes(error.code)?'waiting':'failed',error:String(error.message).slice(0,800),code:error.code||'TASK_FAILED'});}
    finally{processing=false;controller=null;currentJob=null;}
  }
  function jobAction(id,{action}){if(pausing||stopped)fail('任务正在暂停，请稍后继续。','BUSY',409);const job=store.get('jobs',id);if(!job)fail('任务不存在。','NOT_FOUND',404);if(action==='cancel'){if(currentJob===id)controller?.abort();return putJob({...job,state:'cancelled',error:'用户取消；已保存的输入和回答保留。'});}if(action==='retry'){if(job.type==='structure'&&!['running','done'].includes(job.state)){const source=getNote(job.payload.noteId);job.payload.basis=structureBasis(source,sourceChildren(source.id));job.dedupKey=`structure:${source.id}:${hash(JSON.stringify(job.payload.basis))}`;const duplicate=store.records('jobs').find(j=>j.id!==id&&j.dedupKey===job.dedupKey&&['queued','running'].includes(j.state));if(duplicate)return duplicate;}if(['running','done'].includes(job.state))fail('该任务当前不可重试。');if(job.type==='title'){const source=getNote(job.payload.noteId);if(!needsTitle(source))fail('标题已经填写，保留当前标题。','TITLE_ALREADY_SET');job.payload={noteId:source.id,hash:source.hash};job.dedupKey=`title:${source.id}:${source.hash}`;const duplicate=store.records('jobs').find(j=>j.id!==id&&j.dedupKey===job.dedupKey&&['queued','running'].includes(j.state));if(duplicate)return duplicate;}if(job.type==='process'){const source=getNote(job.payload.noteId);if(source.hash!==job.payload.hash){job.payload={noteId:source.id,hash:source.hash,research:job.payload.research===true,...(needsTitle(source)?{titleRequested:true}:{})};job.dedupKey=`process:${source.id}:${source.hash}${job.payload.research ? ':research' : ''}`;job.progress=0;}const duplicate=store.records('jobs').find(j=>j.id!==id&&j.dedupKey===job.dedupKey&&['queued','running'].includes(j.state));if(duplicate)return duplicate;}return putJob({...job,state:'queued',error:'',code:null});}fail('任务操作无效。');}
  function pauseJobs() {
    if (pausePromise) return pausePromise;
    pausing = true;
    const interruptedId = currentJob;
    controller?.abort();
    pausePromise = (async () => {
      while (processing || activeOperations) await new Promise(resolve => setTimeout(resolve, 20));
      for (const job of store.records('jobs')) if (['queued','running'].includes(job.state) || job.id === interruptedId && job.state === 'failed') {
        putJob({ ...job, state: 'waiting', code: 'PRACTICE_PAUSED', error: '练习已暂停；输入与回答已保存，请确认后手动重试。' });
      }
      return { paused: true };
    })().finally(() => { pausing = false; pausePromise = null; });
    return pausePromise;
  }
  function tick(){if(practice)return runJobs();store.scan();const cfg=settings(),date=learningDate(),time=new Intl.DateTimeFormat('en-GB',{timeZone:cfg.timezone,hour:'2-digit',minute:'2-digit',hour12:false}).format(date);if(time>=cfg.scheduleTime)today();const last=store.get('schedule','discovery');if(store.list().some(n=>n.kind==='knowledge')&&(!last||date.getTime()-Date.parse(last.at)>cfg.discoveryDays*86400000))queue('discover',{},`discovery:${localDay(date,cfg.timezone)}`);return runJobs();}
  function demo(){const existing=store.list().filter(n=>n.meta.demo);if(existing.length)return{notes:existing};const source=store.create({kind:'source',title:'演示资料 · 小林的读书项目',body:'【虚构演示，不代表用户真实经历】小林正在整理一份读书报告。他保存了原始摘录，希望用自己的话说明观点，再找到能支持或反对它的材料。此条用于体验输入、查找和编辑。',meta:{demo:true,privacy:'local',platform:'内置演示'}});const note=store.create({kind:'knowledge',title:'演示知识 · 给读书报告保留出处',body:'【演示设定】为小林的读书报告记录：一句观点、对应原文、页码，以及哪些条件会限制该观点。\n\n练习：假设你是小林，请用自己的话说明报告中为何要保留出处。这个练习仅针对上述虚构任务，没有预先记录任何学习成绩。',meta:{demo:true,privacy:'local',stage:'candidate',topic:'读书与表达',depth:'explain',sources:[{id:source.id,role:'input'}],promotionReason:'用于试用学习流程，可自行加入学习。'}});return{notes:[source,note]};}
  function diagnostics() {
    store.scan();
    const notes=store.list(), allowed=notes.filter(n=>privacyFor(n)==='cloud'&&['knowledge','source','topic'].includes(n.kind)&&n.meta.stage!=='retired'&&!n.meta.supersededBy);
    const chunks=store.db.prepare('SELECT COUNT(*) count,SUM(CASE WHEN vector IS NOT NULL AND model=? THEN 1 ELSE 0 END) vectors FROM index_chunks').get(settings().embedding.model);
    const pending=store.missingEmbeddings({model:settings().embedding.model,noteIds:allowed.map(n=>n.id)}).length;
    const pendingLinks=store.pendingManagedLinks().map(p=>({id:p.id,title:store.read(p.id).title,conflict:p.conflict,privacyChanged:p.privacyChanged}));
    return {usage:usage(),calls:store.records('calls').slice(0,100),index:{...chunks,pending,notes:notes.length,method:'中文关键词与可选语义检索；现有片段保留，缺失向量需手动更新，本地资料不外发'},mcp:{...settings().mcp,transport:'stdio',tools:['search_knowledge','read_note','read_source','related_knowledge','propose_change'],events:store.records('mcpCalls').slice(0,30)},storage:{vaultDir:store.vaultDir,dataDir:store.dataDir,conflicts:store.conflicts,pendingLinks,retention:'删除移除当前文件与检索缓存；历史版本和你此前导出的备份仍保留。JSON备份只包含Markdown与运行记录；附件和.obsidian请另行备份整个Vault。'},sessions:store.records('sessions').slice(0,20)};
  }
  function backup(){const config=settings();return{...store.backup(),...(practice?{purpose:practicePurpose}:{}),preferences:practice?Object.fromEntries(practicePreferences.map(key=>[key,config[key]])):config};}
  function restore({backup:input,preview=true,token}) {
    if (practice !== (input?.purpose === practicePurpose)) fail(practice ? '练习空间只能恢复新手练习备份。' : '新手练习备份不能恢复到正式知识库。', 'BACKUP_PURPOSE_MISMATCH', 409);
    if (processing || activeOperations || pausing) fail('请等待或取消正在运行的任务后恢复。', 'BUSY', 409);
    const info = store.validateBackup(input), digest = hash(JSON.stringify(input));
    if (preview) { const token = randomUUID(); store.put('restore', token, { digest, at: now() }); return { ...info, token }; }
    const saved = store.get('restore', token);
    if (!saved || saved.digest !== digest || Date.now() - Date.parse(saved.at) > 600000) fail('恢复预览已过期或内容改变，请重新预览。', 'CONFLICT', 409);
    const result = store.restore(input);
    jobRevision = randomUUID();
    if (input.preferences) {
      const preferences = practice ? Object.fromEntries(practicePreferences.filter(key => Object.hasOwn(input.preferences, key)).map(key => [key, input.preferences[key]])) : { ...input.preferences };
      delete preferences.vaultDir; delete preferences.dataDir;
      updateSettings(preferences);
    }
    recoverJobs(); return result;
  }
  function recoverJobs(){for(const j of store.records('jobs'))if(j.state==='running'||practice&&j.state==='queued')putJob({...j,state:'waiting',error:'服务曾停止或练习备份已恢复；为避免重复计费，请确认后手动重试。'});}
  recoverJobs();
  const chatgpt = createChatgptBridge({ getStore: () => store, settings, search: tracked(search), getNote, related });
  return { get store(){return store;}, get processing(){return processing;}, get hasPendingOperations(){return processing||activeOperations>0||pausing;}, chatgpt, learningNow, settings, updateSettings, getPrompts, updatePrompts, usage, usageReport, updateUsageSettings, ai, importItems, processNote, requestSourceStructure, listNotes, publicNote, publicJob, library, readPublicNote, noteEvidence, linksPreview, syncLinks, getNote, editNote, extractNote, promote, confirmNote, merge, search:tracked(search), today, planAction, startStudy, session, answerStudy, hintStudy, confirmStudy, finishStudy, mistakeAction, topics, createTopic, updateTopic, topicAction, recommendations, recommendationAction, requestRelations, relationReview, relationAction, related, ask:tracked(ask), updateDraft, propose, proposalAction, queue, runJobs, pauseJobs, jobAction, tick, demo, diagnostics, backup, restore,
    jobStatuses,
    bootstrap(){return{settings:settings(),stats:{notes:store.list().filter(n=>!n.meta.excerptOnly).length,sources:store.list().filter(n=>n.kind==='source'&&!n.meta.excerptOnly).length,knowledge:store.list().filter(n=>n.kind==='knowledge').length,pending:store.records('jobs').filter(j=>['waiting','failed'].includes(j.state)).length},today:today(),notes:listNotes().filter(n=>!n.meta.excerptOnly).map(publicNote),jobs:store.records('jobs').map(publicJob),jobRevision,jobSnapshot:++jobSnapshot,conflicts:store.conflicts,capabilities:{offline:true,model:settings().ai.enabled,embedding:settings().embedding.enabled,search:settings().search.enabled}};},
    async close(){stopped=true;if(practice)await pauseJobs();else{controller?.abort();while(processing||activeOperations)await new Promise(resolve=>setTimeout(resolve,20));}store.close();}
  };
}
