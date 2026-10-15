import { createLearning } from './learning-core.mjs';
import { clone, fail, text, titleText, idText, jsonObject, jsonValue, inputObject, strings, validateNote, createMemoryStore, learningLimits } from './learning-runtime.mjs';

export { learningLimits } from './learning-runtime.mjs';
export const defaults = Object.freeze({ dailyMinutes: 25, timezone: 'Asia/Shanghai', scheduleTime: '08:00', focusTopics: [], pausedIds: [], discoveryDays: 7 });
const stages = ['reference', 'candidate', 'learning', 'integrated', 'core', 'retired'];
const depths = ['aware', 'find', 'explain', 'apply'];
const settingsKeys = Object.keys(defaults);
const namespaces = ['sessions', 'plans', 'reviews', 'studyEvidence', 'topics', 'jobs', 'relations', 'research', 'proposals', 'drafts', 'uses'];
const byteLength = value => new TextEncoder().encode(JSON.stringify(value)).length;

function validateSettings(saved) {
  inputObject(saved, settingsKeys, '学习设置');
  const next = { ...clone(defaults), ...clone(saved) };
  if (!Number.isInteger(next.dailyMinutes) || next.dailyMinutes < 5 || next.dailyMinutes > 240) fail('每日时间应为 5–240 分钟的整数。');
  text(next.timezone, '时区', 128);
  try { new Intl.DateTimeFormat('en-CA', { timeZone: next.timezone }).format(new Date()); } catch { fail('时区无效，请用 Asia/Shanghai 等标准时区名称。'); }
  if (typeof next.scheduleTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(next.scheduleTime)) fail('生成时间应为 HH:mm。');
  next.focusTopics = strings(next.focusTopics, '关注主题', 100);
  next.pausedIds = strings(next.pausedIds, '暂停条目', 200);
  if (!Number.isInteger(next.discoveryDays) || next.discoveryDays < 1 || next.discoveryDays > 365) fail('发现范围应为 1–365 天的整数。');
  return next;
}

export function createEmptyLearningState() { return { notes: [], records: {}, settings: {}, guide: {} }; }
export function validateLearningState(state) {
  inputObject(state, ['notes', 'records', 'settings', 'guide'], '学习数据');
  if (!Array.isArray(state.notes) || state.notes.length > learningLimits.notes) fail('手机最多保存 200 条学习内容。', 'LIMIT_REACHED');
  const ids = new Set();
  for (const note of state.notes) { validateNote(note, { persisted: true }); if (ids.has(note.id)) fail('学习数据包含重复条目。'); ids.add(note.id); }
  jsonObject(state.records, '学习记录');
  if (Object.keys(state.records).some(key => !namespaces.includes(key))) fail('学习记录类型无效。');
  let count = 0;
  const startRequests = new Set();
  for (const [namespace, records] of Object.entries(state.records)) {
    jsonObject(records, '学习记录');
    for (const [key, record] of Object.entries(records)) {
      idText(key); jsonObject(record, '记录'); jsonValue(record); count++;
      if (namespace === 'sessions') {
        idText(record.id); idText(record.noteId); text(record.sourceHash, '学习材料版本', 256);
        if (Object.hasOwn(record, 'startRequestId') || Object.hasOwn(record, 'startIntent')) {
          text(record.startRequestId, '开始学习的防重标识', learningLimits.requestId);
          inputObject(record.startIntent, ['noteId', 'planId', 'topicId', 'mistakeId'], '开始学习参数');
          for (const field of ['noteId', 'planId', 'topicId', 'mistakeId']) {
            if (!Object.hasOwn(record.startIntent, field)) fail('开始学习参数不完整。');
            if (record[field] != null) idText(record[field]);
            if (record.startIntent[field] !== null) {
              idText(record.startIntent[field]);
              if (record.startIntent[field] !== record[field]) fail('开始学习参数与会话不一致。');
            }
          }
          // Only topic/mistake may be inherited from a plan; only a mistake can supply an omitted note.
          if (record.startIntent.planId === null && record.planId != null
              || record.startIntent.noteId === null && record.mistakeId == null
              || ['topicId', 'mistakeId'].some(field => record.startIntent[field] === null && record[field] != null && record.planId == null)) fail('开始学习参数与会话不一致。');
          if (record.id !== key || startRequests.has(record.startRequestId)) fail('开始学习的防重标识重复或会话身份不一致。');
          startRequests.add(record.startRequestId);
        }
        const online = record.assessmentMode === 'online';
        if (record.assessmentMode !== undefined && !online) fail('学习评估模式无效。');
        if (!(online ? ['reading', 'unassessed', 'awaiting_feedback', 'feedback', 'completed'] : ['reading', 'unassessed', 'completed']).includes(record.status) || !Array.isArray(record.turns) || record.turns.length > 500) fail('学习会话格式无效。');
        text(record.material, '学习材料', learningLimits.bodyBytes);
        if (!online && (record.pendingJobId || record.feedback !== undefined)) fail('手机离线记录不能包含自动评估结果。');
        if (online && record.pendingJobId) idText(record.pendingJobId);
        if (record.feedback !== undefined) validateFeedback(record.feedback);
        if (!Number.isInteger(record.hintCount) || record.hintCount < 0 || record.hintCount > 1000) fail('提示记录格式无效。');
        for (const turn of record.turns) { jsonObject(turn); idText(turn.id); text(turn.requestId, '提交标识', learningLimits.requestId); text(turn.answer, '回答', learningLimits.bodyBytes); if (typeof turn.hintUsed !== 'boolean') fail('提示记录格式无效。'); if (!online && (turn.assessment !== 'unassessed' || turn.feedback !== undefined)) fail('手机离线回答只能标记为尚未评估。'); if (online && turn.feedback !== undefined) validateFeedback(turn.feedback); if (online && turn.assessment !== undefined && !['unassessed','correct','partial','incorrect','ambiguous'].includes(turn.assessment)) fail('回答评估格式无效。'); }
        if (record.status === 'completed') {
          if (!record.turns.length) fail('完成记录不能没有回答。');
          if (online) { validateOnlineEvidence(record.completion?.evidence); if (record.completion.reviewSettled !== record.completion.evidence.reviewSettled || (record.completion.reviewSettled ? !Number.isInteger(record.completion.interval) || record.completion.interval < 1 || record.completion.interval > 120 : record.completion.interval !== null)) fail('在线复习结算无效。'); }
          else { if (record.completion?.reviewSettled !== false || record.completion?.interval !== null) fail('离线完成记录不能更新复习间隔。'); validateOfflineEvidence(record.completion.evidence); }
        }
      }
      if (namespace === 'studyEvidence') record.assessmentMode === 'online' ? validateOnlineEvidence(record) : validateOfflineEvidence(record);
      if (namespace === 'jobs') { if(record.id!==key)fail('任务标识不一致。');validateOnlineJob(record); }
      if (['research','proposals','drafts','uses'].includes(namespace)) validateOnlineRecord(namespace, key, record);
      if (namespace === 'plans' && (!['pending', 'done', 'skip', 'defer', 'pause', 'budget_deferred', 'paused'].includes(record.state) || typeof record.minutes !== 'number' || !Number.isFinite(record.minutes))) fail('今日安排格式无效。');
    }
  }
  if (count > 2000 || byteLength(state.records) > learningLimits.recordsBytes) fail('学习记录超过手机保存上限，请先导出备份。', 'LIMIT_REACHED');
  validateSettings(state.settings); jsonObject(state.guide, '教程进度'); jsonValue(state.guide);
  if (byteLength(state) > learningLimits.stateBytes) fail('学习内容超过手机保存上限，请先导出备份。', 'LIMIT_REACHED');
  return clone(state);
}

export function validateFeedback(value) {
  inputObject(value, ['assessment','feedback','omission','correction','nextQuestion','suggestion','disputedMisconception']);
  if (!['correct','partial','incorrect','ambiguous'].includes(value.assessment)) fail('反馈评估无效。', 'MODEL_FORMAT');
  text(value.feedback, '反馈', 16384);
  for (const key of ['omission','correction','nextQuestion','suggestion']) if (value[key] !== undefined) text(value[key], key, 16384, { empty: true });
  if (value.disputedMisconception !== undefined && typeof value.disputedMisconception !== 'boolean') fail('争议反馈格式无效。');
  return clone(value);
}
function validateOnlineEvidence(value) {
  jsonObject(value);
  if (value.assessmentMode !== 'online' || !['correct','needs_practice','with_hints','ambiguous'].includes(value.assessment)) fail('在线学习证据格式无效。');
  for (const key of ['independent','explanationPractice','applicationPractice','spacedRecall','reviewSettled','usedHints','errorObserved','ambiguous']) if (typeof value[key] !== 'boolean') fail('在线学习证据格式无效。');
  if (value.ambiguous && (value.reviewSettled || value.independent) || value.independent && (value.usedHints || value.errorObserved) || (value.explanationPractice || value.applicationPractice || value.spacedRecall) && !value.independent) fail('学习证据不能把争议或提示回答算作独立掌握。');
}
function validateOnlineJob(record) {
  inputObject(record, ['id','onlineVersion','type','context','state','phase','progress','createdAt','updatedAt','payload','requests','checkpoint','error','code','extractionSaved','researchProgress','result','dedupKey']);
  idText(record.id);
  if (record.onlineVersion !== 1 || !['process','structure','grade','ask'].includes(record.type) || !['formal','practice'].includes(record.context) || !['queued','running','waiting','failed','cancelled','done'].includes(record.state)) fail('手机在线任务格式无效。');
  if (!Number.isFinite(record.progress) || record.progress < 0 || record.progress > 100) fail('任务进度无效。');
  text(record.phase, '任务阶段',128); text(record.dedupKey,'任务标识',1024);
  for (const key of ['createdAt','updatedAt']) if (typeof record[key] !== 'string' || !Number.isFinite(Date.parse(record[key]))) fail('任务时间无效。');
  jsonObject(record.payload); jsonObject(record.requests);
  if (record.type === 'process') { inputObject(record.payload,['noteId','hash','research','reuseExtracted','savedCandidates','extracted']); idText(record.payload.noteId); text(record.payload.hash,'原文版本',256); if(typeof record.payload.research!=='boolean'||typeof record.payload.reuseExtracted!=='boolean')fail('任务研究选项无效。'); if(record.payload.savedCandidates!==undefined){inputObject(record.payload.savedCandidates,['ids']);strings(record.payload.savedCandidates.ids,'候选标识',8);} if(record.payload.extracted!==undefined)validateSavedExtraction(record.payload.extracted);if(record.extractionSaved===true&&(!record.payload.savedCandidates||record.payload.savedCandidates.ids.length!==record.payload.extracted?.candidates.length))fail('已保存候选的检查点不完整。'); }
  if (record.type === 'grade') { inputObject(record.payload,['sessionId','turnId']); idText(record.payload.sessionId); idText(record.payload.turnId); }
  if (record.type === 'structure') {
    inputObject(record.payload,['noteId','hash','basis','structure']);idText(record.payload.noteId);text(record.payload.hash,'原文版本',256);
    if(!Array.isArray(record.payload.basis)||!record.payload.basis.length||record.payload.basis.length>200)fail('结构知识版本清单无效。');
    for(const ref of record.payload.basis){inputObject(ref,['id','hash']);idText(ref.id);text(ref.hash,'知识版本',256);}
    if(record.payload.structure!==undefined){inputObject(record.payload.structure,['hierarchy','edges']);if(!Array.isArray(record.payload.structure.hierarchy)||!Array.isArray(record.payload.structure.edges)||record.payload.structure.hierarchy.length>200||record.payload.structure.edges.length>400)fail('结构结果无效。');}
  }
  if (record.type === 'ask') { inputObject(record.payload,['question','scope','mode','privacy','basis','draftId']); text(record.payload.question,'问题',8192); if(!['answer','outline','draft'].includes(record.payload.mode)||!['local','cloud'].includes(record.payload.privacy)||!Array.isArray(record.payload.scope)||record.payload.scope.some(k=>!['source','knowledge'].includes(k))||!Array.isArray(record.payload.basis)||record.payload.basis.length>8)fail('问答任务格式无效。');for(const ref of record.payload.basis){inputObject(ref,['id','hash']);idText(ref.id);text(ref.hash,'引用版本',256);} }
  for (const item of Object.values(record.requests)) { inputObject(item, ['requestId','state','capability']); idText(item.requestId); if (!['prepared','succeeded','failed','unknown'].includes(item.state) || !['model','search','fetch'].includes(item.capability)) fail('请求检查点无效。'); }
}
function validateSavedExtraction(value) {
  inputObject(value,['sourceTitle','candidates','structure']);
  if(!Array.isArray(value.candidates)||value.candidates.length<1||value.candidates.length>8)fail('保存的拆解无效。');
  for(const c of value.candidates){inputObject(c,['title','body','topic','claims','claimChecks','prerequisites','reason','depth']);titleText(c.title);text(c.body,'保存的拆解',learningLimits.bodyBytes);if(!Array.isArray(c.claims)||c.claims.length>3)fail('保存的事实无效。');for(const claim of c.claims)text(claim,'保存的事实',4096);}
  if(value.structure!==undefined){inputObject(value.structure,['hierarchy','edges']);if(!Array.isArray(value.structure.hierarchy)||value.structure.hierarchy.length>8||!Array.isArray(value.structure.edges)||value.structure.edges.length>64)fail('保存的结构无效。');const indexes=new Set(value.candidates.map((_,i)=>String(i)));for(const h of value.structure.hierarchy){inputObject(h,['child','parent']);if(!indexes.has(h.child)||h.parent!==null&&!indexes.has(h.parent)||h.child===h.parent)fail('保存的层级无效。');}for(const e of value.structure.edges){inputObject(e,['from','to','type','explanation','sourceExcerpt','targetExcerpt']);if(!indexes.has(e.from)||!indexes.has(e.to)||e.from===e.to||!['support','explain','prerequisite','example','counterexample','limit','application','sequence'].includes(e.type))fail('保存的关系无效。');for(const key of ['explanation','sourceExcerpt','targetExcerpt'])text(e[key],key,8192);if(!value.candidates[Number(e.from)].body.includes(e.sourceExcerpt)||!value.candidates[Number(e.to)].body.includes(e.targetExcerpt))fail('保存的关系缺乏原文摘录。');}}
}
function validateOnlineRecord(namespace, key, record) {
  if (record.onlineVersion !== 1 || record.id !== key) fail('在线工作记录格式无效。');
  if (namespace === 'research') {
    inputObject(record,['id','onlineVersion','sourceId','sourceHash','claim','result','at']);idText(record.sourceId);text(record.sourceHash,'来源版本',256);text(record.claim,'研究事实',4096);
    inputObject(record.result,['claim','evidence','limitations','conclusion','coverage','notice']);
    if(record.result.claim!==record.claim||!['searched','incomplete','unsearched'].includes(record.result.coverage)||!Array.isArray(record.result.evidence)||record.result.evidence.length>24)fail('研究记录无效。');
    strings(record.result.limitations,'研究限制',100);text(record.result.conclusion,'研究结论',16384,{empty:true});
    for(const ev of record.result.evidence){inputObject(ev,['url','title','excerpt','role','rationale','fetchedAt','locator']);if(!['support','oppose','limit'].includes(ev.role))fail('证据角色无效。');for(const k of ['url','title','excerpt','rationale','fetchedAt','locator'])text(ev[k],k,8192);}
  } else if (namespace === 'proposals') {
    inputObject(record,['id','onlineVersion','noteId','expectedHash','body','meta','state','reason','createdAt']);idText(record.noteId);text(record.expectedHash,'建议版本',256);text(record.body,'建议正文',learningLimits.bodyBytes);jsonObject(record.meta);if(!['pending','accepted','rejected','superseded'].includes(record.state))fail('建议状态无效。');text(record.reason,'建议理由',8192);
  } else if (namespace === 'drafts') {
    inputObject(record,['id','onlineVersion','mode','question','body','citations','limitations','usedIds','createdAt','updatedAt']);if(!['answer','outline','draft'].includes(record.mode))fail('草稿类型无效。');text(record.question,'草稿问题',8192);text(record.body,'草稿正文',learningLimits.bodyBytes,{empty:true});strings(record.limitations,'草稿限制',100);strings(record.usedIds,'采用项',8);
    if(!Array.isArray(record.citations)||record.citations.length>8)fail('草稿引用无效。');for(const c of record.citations){inputObject(c,['id','title','excerpt','sources']);idText(c.id);titleText(c.title);text(c.excerpt,'引用摘录',8192,{empty:true});if(!Array.isArray(c.sources))fail('草稿来源无效。');}if(record.usedIds.some(id=>!record.citations.some(c=>c.id===id)))fail('采用项须来自实际引用。');
  } else {
    inputObject(record,['id','onlineVersion','draftId','noteId','actualUse','at']);idText(record.draftId);idText(record.noteId);if(record.actualUse!==true)fail('采用记录无效。');
  }
}

function validateOfflineEvidence(evidence) {
  jsonObject(evidence, '离线练习证据');
  if (evidence.assessment !== 'unassessed' || evidence.reviewSettled !== false
    || ['independent', 'explanationPractice', 'applicationPractice', 'spacedRecall'].some(key => evidence[key] !== false)) fail('离线练习尚未评估，不能作为已掌握或增加复习间隔的证据。');
}

// Each call owns a draft. The transport commits api.state atomically only after
// the request succeeds; this service performs no HTTP or native plugin calls.
export function createAndroidLearning({ state = createEmptyLearningState(), sources = [], practice = false, clock = () => new Date(), online = null } = {}) {
  const draft = validateLearningState(state);
  if (typeof practice !== 'boolean' || typeof clock !== 'function' || !Array.isArray(sources) || sources.length > 200) fail('学习环境无效。');
  if (!practice && draft.notes.some(n => n.kind === 'source')) fail('正式原文应独立保存，不能写入学习数据。');
  if (practice && sources.length) fail('练习空间不能读取正式原文。', 'PRACTICE_ISOLATION', 409);
  if (Object.values(draft.records.jobs || {}).some(job => job.context !== (practice ? 'practice' : 'formal'))) fail('任务不能在不同知识库之间运行。', 'PRACTICE_ISOLATION', 409);
  const externalIds = new Set();
  for (const note of sources) { validateNote(note, { sourceOnly: true, summary: true }); if (externalIds.has(note.id) || draft.notes.some(n => n.id === note.id)) fail('来源标识冲突。'); externalIds.add(note.id); }
  const learningDate = () => { const date = clock(); if (!(date instanceof Date) || !Number.isFinite(date.getTime())) fail('学习时间无效。', 'INVALID_LEARNING_TIME'); return new Date(date.getTime()); };
  const now = () => learningDate().toISOString();
  const store = createMemoryStore(draft, sources, now);
  const getRawNote = id => { idText(id); return store.read(id); };
  const settings = () => ({ ...validateSettings(draft.settings), ai: { enabled: false, hasKey: false }, embedding: { enabled: false, hasKey: false }, search: { enabled: false, hasKey: false }, fetch: { enabled: false }, mcp: { enabled: false, allowProposals: false, chatgptEnabled: false, chatgptAllowRead: false }, prompts: {}, ...(online?.settings || {}) });
  function limitationsFor(note) {
    const issues = [...(note.meta.researchLimitations || [])];
    if (note.meta.reviewAfter && note.meta.reviewAfter < now()) issues.push('材料可能陈旧，需要重新研究。');
    if (note.meta.processKey) { const [sourceId, sourceHash] = note.meta.processKey.split(':'); if (store.row(sourceId)?.hash !== sourceHash) issues.push('底层原始资料已修改或删除，需要重新加工。'); }
    for (const ref of note.meta.sources || []) if (ref.role === 'input' && ref.hash && store.row(ref.id)?.hash !== ref.hash) issues.push('底层原始资料已修改或删除，需要重新加工。');
    return [...new Set(issues)];
  }
  const eligible = note => note.kind === 'knowledge' && note.meta.stage !== 'retired' && !note.meta.supersededBy && !limitationsFor(note).length;
  const publicNote = note => ({ ...clone(note), limitations: limitationsFor(note), meta: { ...clone(note.meta), effectivePrivacy: 'local' } });
  const complete = result => { validateLearningState(draft); return clone(result); };
  function updateSettings(input) { inputObject(input, settingsKeys); const value = validateSettings({ ...draft.settings, ...input }); draft.settings = value; return complete(settings()); }
  function editNote(id, input) {
    inputObject(input, ['title', 'body', 'meta', 'expectedHash']);
    const old = getRawNote(id); text(input.expectedHash, '当前版本', 256);
    if (old.kind === 'topic') fail('请通过主题编辑入口调整主题成员和顺序。');
    const meta = input.meta || {}; inputObject(meta, ['stage', 'privacy', 'topic', 'depth', 'prerequisites', 'researchIntervalDays', 'platform', 'author', 'url', 'date', 'locator']);
    if (input.title !== undefined) titleText(input.title);
    if (input.body !== undefined) text(input.body, '正文', learningLimits.bodyBytes);
    if (meta.stage !== undefined && meta.stage !== old.meta.stage) fail('请通过晋级操作调整阶段。');
    if (meta.privacy !== undefined && meta.privacy !== 'local') fail('手机端仅支持本地资料。');
    if (meta.depth !== undefined && !depths.includes(meta.depth)) fail('学习目标无效。');
    if (meta.topic !== undefined) text(meta.topic, '主题', 800, { empty: true });
    if (meta.researchIntervalDays !== undefined && (!Number.isInteger(meta.researchIntervalDays) || meta.researchIntervalDays < 1 || meta.researchIntervalDays > 365)) fail('核验有效天数应为 1–365。');
    if (meta.prerequisites !== undefined) validatePrerequisites(strings(meta.prerequisites, '前置知识', 100));
    if (old.hash !== input.expectedHash) fail('内容已发生变化，请刷新后合并修改。', 'CONFLICT', 409);
    if ((input.title === undefined || input.title === old.title) && (input.body === undefined || input.body === old.body) && Object.entries(meta).every(([key, value]) => JSON.stringify(value) === JSON.stringify(old.meta[key]))) return publicNote(old);
    return complete(publicNote(store.update(id, { ...input, meta: { ...meta, ...(old.kind === 'knowledge' ? { userEdited: true } : {}) } })));
  }
  function promote(id, input) {
    inputObject(input, ['stage', 'reason', 'depth', 'expectedHash']);
    const note = getRawNote(id); if (note.kind !== 'knowledge') fail('只有知识条目能进入学习阶段。');
    if (!stages.includes(input.stage) || input.depth !== undefined && !depths.includes(input.depth)) fail('阶段或学习目标无效。');
    text(input.reason, '调整理由', 4096);
    if (input.expectedHash !== undefined && input.expectedHash !== note.hash) fail('内容已发生变化，请刷新。', 'CONFLICT', 409);
    if (['integrated', 'core'].includes(input.stage) && !note.meta.confirmedAt) fail('请先以自己的语言确认个人理解。');
    return complete(publicNote(store.update(id, { expectedHash: note.hash, meta: { stage: input.stage, depth: input.depth || note.meta.depth || 'explain', promotionReason: input.reason, promotedAt: now() } })));
  }
  function confirmNote(id, input) {
    inputObject(input, ['body', 'expectedHash']); const note = getRawNote(id);
    if (note.kind !== 'knowledge') fail('请先把资料整理为知识条目。');
    text(input.body, '自己的理解', learningLimits.bodyBytes); text(input.expectedHash, '当前版本', 256);
    const heading = '\n\n## 我的理解（用户确认）\n\n';
    const linkStart = '<!-- zhixu-managed-links:start -->', linkEnd = '<!-- zhixu-managed-links:end -->';
    // Keep a single terminal managed block in place after the new understanding.
    // Ambiguous or nonterminal blocks stay byte-for-byte in the original text.
    const terminalLinks = note.body.indexOf(linkStart) === note.body.lastIndexOf(linkStart)
      && note.body.indexOf(linkEnd) === note.body.lastIndexOf(linkEnd)
      ? note.body.match(/\n\n<!-- zhixu-managed-links:start -->[\s\S]*?<!-- zhixu-managed-links:end -->[\t \r\n]*$/) : null;
    const suffix = terminalLinks?.[0] || '';
    let original = suffix ? note.body.slice(0, terminalLinks.index) : note.body;
    // Only the exact last block recorded by the previous confirmation is ours
    // to replace. Later chapters or external edits must never be truncated.
    const previous = typeof note.meta.personalUnderstanding === 'string' && note.meta.personalUnderstanding
      ? `${heading}${note.meta.personalUnderstanding}` : '';
    if (previous && original.endsWith(previous) && original.indexOf(previous) === original.lastIndexOf(previous)) original = original.slice(0, -previous.length);
    return complete(publicNote(store.update(id, { expectedHash: input.expectedHash, meta: { stage: note.meta.stage === 'retired' ? 'retired' : 'integrated', personalUnderstanding: input.body, confirmedAt: now(), confirmedBy: 'user' },
      body: `${original}${heading}${input.body}${suffix}` })));
  }
  function extractSource(id, input) {
    inputObject(input, ['title', 'body', 'topic', 'reason', 'depth', 'claimType', 'expectedHash']); const source = getRawNote(id);
    if (source.kind !== 'source') fail('手动整理必须关联一份原始资料。');
    text(input.expectedHash, '原文当前版本', 256);
    if (input.expectedHash !== source.hash) fail('原文版本已变化，请刷新后整理。', 'SOURCE_CHANGED', 409);
    text(source.body, '原文正文', learningLimits.bodyBytes);
    titleText(input.title); text(input.body, '知识正文', learningLimits.bodyBytes);
    for (const key of ['topic', 'reason']) if (input[key] !== undefined) text(input[key], key, 4096, { empty: true });
    if (input.depth !== undefined && !depths.includes(input.depth)) fail('学习目标无效。');
    if (!['fact', 'opinion'].includes(input.claimType)) fail('请明确选择事实或个人观点。');
    return complete(publicNote(store.create({ kind: 'knowledge', title: input.title, body: input.body, meta: {
      stage: 'candidate', privacy: 'local', sources: [{ id: source.id, role: 'input', hash: source.hash }],
      sourceSnapshot: { id: source.id, hash: source.hash, title: source.title, body: source.body, meta: clone(source.meta) },
      topic: input.topic || '', depth: input.depth || 'explain', promotionReason: input.reason || '', userStructured: true, claimType: input.claimType,
      researchLimitations: input.claimType === 'opinion' ? [] : ['这份手工材料含需查证的事实；请在电脑端对原始资料运行联网加工，再采用带证据的候选条目。'],
      ...(practice ? { demo: true, practice: true } : {}),
    } })));
  }
  function saveSource(input) {
    if (!practice) fail('正式原文请通过原文保存入口写入。', 'ANDROID_UNAVAILABLE', 409);
    inputObject(input, ['id', 'title', 'body', 'meta', 'expectedHash']);
    titleText(input.title); text(input.body, '正文', learningLimits.bodyBytes);
    const meta = input.meta || {}; inputObject(meta, ['platform', 'author', 'url', 'date', 'locator', 'topic']);
    for (const [key, value] of Object.entries(meta)) text(value, key, 4096, { empty: true });
    const fields = { platform: '', author: '', url: '', date: '', locator: '', topic: '', ...meta, privacy: 'local', stage: 'reference', demo: true, practice: true };
    if (input.id) { const old = getRawNote(input.id); if (old.kind !== 'source') fail('条目不是原文。'); return complete(publicNote(store.update(input.id, { ...input, meta: { ...old.meta, ...meta, privacy: 'local', stage: 'reference', demo: true, practice: true } }))); }
    return complete(publicNote(store.create({ kind: 'source', title: input.title, body: input.body, meta: fields })));
  }
  function validatePrerequisites(ids) {
    for (const id of ids) { const note = getRawNote(id); if (note.kind !== 'knowledge' || !eligible(note)) fail('前置知识必须选择当前可用、尚未停用或替代的知识条目。', 'INVALID_PREREQUISITE'); }
  }
  const dependencies = { store, settings, getNote: getRawNote, eligible, limitationsFor, privacyFor: () => 'local', confirmNote, updateSettings,
    learningClock: learningDate, practice, assessmentMode: 'offline', strictPrerequisites: true, validateTopicPrerequisites: validatePrerequisites,
    queue: online?.queue || (() => fail('离线练习不会创建自动反馈任务。', 'ANDROID_UNAVAILABLE')),
    ai: { generate() { fail('请通过明确授权的手机反馈任务评估。', 'ANDROID_UNAVAILABLE'); } },
  };
  const core = createLearning(dependencies);
  const withMode = fn => (id, ...args) => { dependencies.assessmentMode = store.get('sessions', id)?.assessmentMode === 'online' ? 'online' : 'offline'; try { return fn(id, ...args); } finally { dependencies.assessmentMode = 'offline'; } };
  const operation = (fn, validator) => (...args) => { validator?.(...args); return complete(fn(...args)); };
  const idOperation = (fn, fields = []) => operation(fn, (id, input = {}) => { idText(id); inputObject(input, fields); });
  const learning = {
    today: operation(core.today), topics: operation(core.topics), session: idOperation(core.session),
    startStudy: operation(core.startStudy, (input = {}) => { inputObject(input, ['noteId', 'planId', 'topicId', 'mistakeId', 'requestId']); for (const [key, value] of Object.entries(input)) key === 'requestId' ? text(value, '开始学习的防重标识', learningLimits.requestId) : idText(value); }),
    answerStudy: operation(core.answerStudy, (id, input) => { idText(id); inputObject(input, ['answer', 'hintUsed', 'requestId']); text(input.answer, '回答', learningLimits.bodyBytes); text(input.requestId, '提交标识', learningLimits.requestId); if (input.hintUsed !== undefined && typeof input.hintUsed !== 'boolean') fail('提示使用情况应为开关值。'); }),
    hintStudy: idOperation(core.hintStudy), finishStudy: idOperation(withMode(core.finishStudy)),
    confirmStudy: idOperation(withMode(core.confirmStudy), ['body']),
    planAction: operation(core.planAction, (id, input) => { idText(id); inputObject(input, ['action', 'days']); if (input.days !== undefined && (!Number.isInteger(input.days) || input.days < 1 || input.days > 365)) fail('延期天数应为 1–365 的整数。'); }),
    mistakeAction: operation(core.mistakeAction, (id, input) => { idText(id); inputObject(input, ['action', 'reason']); if (input.reason !== undefined) text(input.reason, '处理理由', 4096, { empty: true }); }),
    createTopic: operation(core.createTopic, input => { inputObject(input, ['title', 'body', 'noteIds', 'prerequisites', 'minutes']); titleText(input.title); if (input.body !== undefined) text(input.body, '主题正文', learningLimits.bodyBytes, { empty: true }); if (input.noteIds !== undefined) strings(input.noteIds, '主题成员', 500); if (input.prerequisites !== undefined) strings(input.prerequisites, '前置知识', 100); if (input.minutes !== undefined && (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 1440)) fail('预计投入应为 1–1440 分钟的整数。'); }),
    updateTopic: operation(core.updateTopic, (id, input) => { idText(id); inputObject(input, ['title', 'body', 'expectedHash', 'meta']); if (input.meta !== undefined) { inputObject(input.meta, ['noteIds', 'prerequisites', 'minutes']); if (input.meta.noteIds !== undefined) strings(input.meta.noteIds, '主题成员', 500); if (input.meta.prerequisites !== undefined) strings(input.meta.prerequisites, '前置知识', 100); if (input.meta.minutes !== undefined && (!Number.isInteger(input.meta.minutes) || input.meta.minutes < 1 || input.meta.minutes > 1440)) fail('预计投入应为 1–1440 分钟的整数。'); } if (input.title !== undefined) titleText(input.title); if (input.body !== undefined) text(input.body, '主题正文', learningLimits.bodyBytes); text(input.expectedHash, '当前版本', 256); }),
    topicAction: idOperation(core.topicAction, ['action']),
    grade: core.grade,
  };
  function list(filters = {}) {
    inputObject(filters, ['q', 'kind', 'stage']);
    if (filters.q !== undefined) text(filters.q, '查询内容', 4096, { empty: true });
    if (filters.kind && !['source', 'knowledge', 'topic', 'mistake'].includes(filters.kind) || filters.stage && !stages.includes(filters.stage)) fail('筛选条件无效。');
    return store.list().filter(n => !n.meta.excerptOnly && (!filters.kind || n.kind === filters.kind) && (!filters.stage || n.meta.stage === filters.stage)
      // A user's old incorrect answer is a historical record, never a correct
      // knowledge search hit. Mistakes remain available in their dedicated list.
      && (!filters.q || n.kind !== 'mistake' && `${n.title}\n${n.body || ''}`.toLowerCase().includes(filters.q.toLowerCase()))).map(publicNote);
  }
  function library(filters = {}) {
    const all = list(), matched = new Set(list(filters).map(n => n.id)), grouped = new Set();
    const groups = all.filter(n => n.kind === 'source').map(source => {
      const children = all.filter(n => n.kind === 'knowledge' && (n.meta.sources || []).some(ref => ref.role === 'input' && ref.id === source.id));
      grouped.add(source.id); children.forEach(n => grouped.add(n.id)); return { source, children, jobs: [] };
    }).filter(group => matched.has(group.source.id) || group.children.some(n => matched.has(n.id)));
    return { groups, standalone: all.filter(n => !grouped.has(n.id) && matched.has(n.id)) };
  }
  function createMistake(sessionId, input) {
    inputObject(input, ['omission', 'correction', 'reason', 'nextQuestion', 'title', 'origin']); idText(sessionId);
    if (input.origin !== undefined && input.origin !== 'user') fail('手机错题只能标记为用户记录。');
    const session = core.session(sessionId); if (!session.turns.length) fail('请先留下自己的回答，再记录需要修正之处。');
    for (const key of ['omission', 'correction', 'reason']) text(input[key], key, 8192);
    if (input.title !== undefined) titleText(input.title);
    if (input.nextQuestion !== undefined) text(input.nextQuestion, '后续练习', 8192, { empty: true });
    const note = getRawNote(session.noteId), turn = session.turns.at(-1);
    const body = `## 问题\n${turn.question}\n\n## 用户当时的回答（错误记录，不能作为正确知识引用）\n${turn.answer}\n\n## 用户记录的误解或遗漏（尚未自动评估）\n${input.omission}\n\n## 用户写下的修正与依据\n${input.correction}\n\n## 用户记录理由\n${input.reason}\n\n## 后续练习\n${input.nextQuestion || session.question}`;
    return complete(publicNote(store.create({ kind: 'mistake', title: input.title || `误解：${note.title}`.slice(0, 200).replace(/[\uD800-\uDBFF]$/u, ''), body, meta: {
      origin: 'user', noteId: note.id, sessionId, sessions: [sessionId], correctionState: 'open', privacy: 'local', sources: [{ id: note.id, role: 'input', hash: session.sourceHash }],
      omission: input.omission, correction: input.correction, userReason: input.reason, nextQuestion: input.nextQuestion || session.question,
      assessment: 'unassessed', ...(practice ? { demo: true, practice: true } : {}),
    } })));
  }
  function getNote(id) {
    const note = publicNote(getRawNote(id));
    if (note.kind === 'source') {
      const children=list({kind:'knowledge'}).filter(n=>n.meta.sources?.some(ref=>ref.id===id&&ref.role==='input'));
      const jobs=store.records('jobs').filter(j=>['process','structure'].includes(j.type)&&j.payload.noteId===id);
      const job=jobs.filter(j=>j.type==='structure'&&j.payload.structure||j.type==='process'&&j.extractionSaved&&j.payload.extracted?.structure).sort((a,b)=>String(a.updatedAt).localeCompare(String(b.updatedAt))).at(-1);
      let structure={state:'missing',hierarchy:[],edges:[],message:'尚无自动结构建议，可先手动整理。'};
      if(job){
        const standalone=job.type==='structure',ids=standalone?job.payload.basis.map(ref=>ref.id):job.payload.savedCandidates.ids,raw=standalone?job.payload.structure:job.payload.extracted.structure;
        const current=job.payload.hash===note.hash&&(standalone?children.length===job.payload.basis.length&&job.payload.basis.every(ref=>children.some(n=>n.id===ref.id&&n.hash===ref.hash)):ids.every(child=>children.some(n=>n.id===child&&!n.meta.userEdited&&n.body===n.meta.generatedBody)));
        const resolve=key=>standalone?key:ids[Number(key)];
        structure={state:current?'ready':'stale',nodes:children.map(n=>({id:n.id,title:n.title})),hierarchy:current?raw.hierarchy.map(h=>({child:resolve(h.child),parent:h.parent===null?null:resolve(h.parent)})):[],edges:current?raw.edges.map((e,index)=>({...e,id:`android-edge-${job.id}-${index}`,from:resolve(e.from),to:resolve(e.to)})):[],message:current?'AI 结构建议，仍需自行核对。':'原文或知识已变化；旧结构保留在任务记录，仅供查阅。'};
      }
      return{...note,children,jobs,structure};
    }
    return note;
  }
  function bootstrap() {
    const notes = list(); return complete({ settings: settings(), notes, topics: core.topics(), today: core.today(),
      stats: { notes: notes.length, sources: notes.filter(n => n.kind === 'source').length, knowledge: notes.filter(n => n.kind === 'knowledge').length, pending: 0 },
      jobs: [], jobRevision: 'android-offline', jobSnapshot: 0, conflicts: [], practice,
      capabilities: { offline: true, model: false, ai: false, search: false, fetch: false, embedding: false, assessment: 'unavailable', onlineResearch: false } });
  }
  function updateGuide(input) {
    inputObject(input, ['started', 'dismissed']);
    for (const value of Object.values(input)) if (typeof value !== 'boolean') fail('教程进度应为开关值。');
    draft.guide = { ...draft.guide, ...input }; return complete(draft.guide);
  }
  return { get state() { return clone(draft); }, store, bootstrap, list, library, getNote, saveSource, extractSource, editNote, promote, confirmNote, createMistake, updateSettings, updateGuide, settings,
    sessions: () => store.records('sessions'), mistakes: () => list({ kind: 'mistake' }), learning,
    evidence(id) { const note = getRawNote(id); return { noteId: id, evidence: clone(note.meta.evidence || []), limitations: limitationsFor(note), researchedAt: note.meta.researchedAt || null, sourceSnapshot: clone(note.meta.sourceSnapshot || null) }; },
    linksPreview: id => store.managedLinksPreview(id), syncLinks: () => store.syncManagedLinks(),
  };
}
