// Source positions use UTF-16 offsets into the unmodified source body.
const list = value => Array.isArray(value) ? value : [];
const text = (value, max = 700) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export const dimensions = ['factual', 'conceptual', 'procedural', 'metacognitive', 'unknown'];
export const roles = ['definition', 'claim', 'evidence', 'reason', 'step', 'event', 'example', 'personal', 'unknown'];
const statuses = ['explicit', 'inferred', 'user', 'pending'];
export const relationTypes = ['support', 'oppose', 'explain', 'prerequisite', 'example', 'counterexample', 'limit', 'application', 'sequence', 'is-a', 'cause', 'condition'];

export function validateKnowledgeStructure(raw, source, notes, keys = new Map(notes.map(n => [n.id, n.id]))) {
  const gaps = [], ids = new Set(notes.map(n => n.id)), resolve = key => keys.get(String(key));
  function refs(values, owner) {
    return list(values).slice(0, 20).flatMap(ref => {
      const quote = typeof ref?.quote === 'string' ? ref.quote : '';
      const target = ref?.sourceId && ref.sourceId !== source.id ? (source.structureSources || []).find(s => s.id === ref.sourceId) : source;
      if (!target) { gaps.push(`${owner}：来源不存在`); return []; }
      let start = ref?.start, end = ref?.end;
      // A unique exact quote can be located without asking the model to count characters.
      if (start == null && quote && target.body.indexOf(quote) === target.body.lastIndexOf(quote)) {
        start = target.body.indexOf(quote); end = start + quote.length;
      }
      if (!quote || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || target.body.slice(start, end) !== quote) {
        gaps.push(`${owner}：原文定位无效或有歧义`); return [];
      }
      return [{ sourceId: target.id, start, end, quote }];
    });
  }
  const inputUnits = new Map();
  for (const unit of list(raw?.units).slice(0, 2000)) {
    const id = resolve(unit?.id);
    if (!ids.has(id) || inputUnits.has(id)) { gaps.push('内容单元 ID 缺失或重复'); continue; }
    inputUnits.set(id, unit);
  }
  const units = notes.map(note => {
    const value = inputUnits.get(note.id) || {};
    const select = (values, allowed) => [...new Set(list(values).filter(v => allowed.includes(v)))];
    const knowledgeDimensions = select(value.dimensions, dimensions), contentRoles = select(value.roles, roles);
    const sourceRefs = refs(value.sourceRefs, note.title);
    const eventTime = text(value.eventTime, 80);
    if (eventTime && !sourceRefs.some(ref => ref.quote.includes(eventTime))) gaps.push(`${note.title}：时间标签缺少对应原文依据，保留待定`);
    if (!sourceRefs.length) gaps.push(`${note.title}：缺少原文依据，待回查`);
    return { id: note.id, shortTitle: text(value.shortTitle || note.title, 36), dimensions: knowledgeDimensions.length ? knowledgeDimensions : ['unknown'],
      roles: contentRoles.length ? contentRoles : ['unknown'], sourceRefs, eventTime: sourceRefs.some(ref => ref.quote.includes(eventTime)) ? eventTime : '' };
  });
  const topics = [], topicIds = new Set();
  for (const value of list(raw?.topics).slice(0, 200)) {
    const id = text(value?.id, 100);
    if (!id || topicIds.has(id) || !text(value.title, 80)) { gaps.push('主题 ID 或标题无效'); continue; }
    topicIds.add(id);
    topics.push({ id, title: text(value.title, 80), parent: value.parent == null ? null : text(value.parent, 100),
      origin: value.origin === 'original' ? 'original' : value.origin === 'user' ? 'user' : 'ai',
      sourceRefs: refs(value.sourceRefs, `主题 ${id}`), members: [...new Set(list(value.members).map(resolve).filter(id => ids.has(id)))] });
    if (list(value.members).some(key => !ids.has(resolve(key)))) gaps.push(`主题 ${id}：成员不存在`);
  }
  const byTopic = new Map(topics.map(t => [t.id, t]));
  for (const topic of topics) {
    const seen = new Set([topic.id]); let parent = topic.parent;
    while (parent && byTopic.has(parent) && !seen.has(parent)) { seen.add(parent); parent = byTopic.get(parent).parent; }
    if (parent) { gaps.push(`主题 ${topic.id}：循环或父主题缺失，已置于顶层`); topic.parent = null; }
    if (topic.origin === 'original' && !topic.sourceRefs.length) { topic.origin = 'ai'; gaps.push(`主题 ${topic.id}：原文目录依据缺失，按整理导航显示`); }
  }
  const edges = [], seen = new Set();
  for (const value of list(raw?.edges).slice(0, 2000)) {
    const from = resolve(value?.from), to = resolve(value?.to), type = value?.type;
    const key = JSON.stringify([from, to, type, value?.condition]);
    if (!ids.has(from) || !ids.has(to) || from === to || !relationTypes.includes(type) || seen.has(key) || !text(value.label, 24)) { gaps.push('关系端点、关系词或类型无效'); continue; }
    seen.add(key);
    const sourceRefs = refs(value.sourceRefs, `关系 ${from} → ${to}`);
    if (!sourceRefs.length) { gaps.push(`关系 ${from} → ${to}：无原文依据，未连线`); continue; }
    const status = statuses.includes(value.status) ? value.status : 'pending';
    if (status !== 'explicit' && status !== 'user') gaps.push(`关系 ${from} → ${to}：${status === 'inferred' ? 'AI 推断' : '待核'}，需语义回查`);
    if (type === 'condition' && !text(value.condition)) { gaps.push(`关系 ${from} → ${to}：条件分支缺少条件，未连线`); continue; }
    if (value.direction && value.direction !== 'from-to') { gaps.push('关系方向约定无效，未连线'); continue; }
    edges.push({ id: `relation-${edges.length}`, from, to, type, label: text(value.label, 24), direction: 'from-to',
      condition: text(value.condition), exceptions: text(value.exceptions), status, sourceRefs,
      explanation: text(value.explanation), sourceExcerpt: sourceRefs[0].quote, targetExcerpt: '',
      semanticCheck: 'pending' });
  }
  if (list(raw?.edges).length > 2000 || list(raw?.topics).length > 200 || list(raw?.units).length > 2000) gaps.push('结构超过处理上限，部分内容未纳入');
  return { units, topics, edges, gaps: [...new Set(gaps)], semanticCheck: 'pending' };
}
