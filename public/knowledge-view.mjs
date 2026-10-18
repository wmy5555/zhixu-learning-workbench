import { el, button, clear } from './ui.mjs';

export const dimensionLabels = { factual: '事实性（未必已证实）', conceptual: '概念性', procedural: '程序性', metacognitive: '元认知', unknown: '待判断' };
export const roleLabels = { definition: '定义', claim: '主张', evidence: '证据', reason: '理由', step: '步骤', event: '事件', example: '例子', personal: '个人理解', unknown: '待判断' };
const statusLabels = { explicit: '原文明说', inferred: 'AI 推断', user: '用户补充', pending: '待核' };
const modes = { overview: '目录总览', concept: '分层概念图', argument: '论证图', flow: '流程图', timeline: '事件顺序（原文）', list: '原文与列表' };
const families = { concept: ['is-a', 'explain', 'example', 'application', 'prerequisite', 'cause'], argument: ['support', 'oppose', 'counterexample', 'limit'], flow: ['sequence', 'condition'] };
export function selectKnowledgeView(data, purpose = 'auto') {
  if (purpose !== 'auto' && modes[purpose]) return purpose;
  const available = Object.entries(families).filter(([, types]) => data.edges?.some(edge => types.includes(edge.type))).map(([mode]) => mode);
  if (data.units?.some(unit => unit.roles.includes('event'))) available.push('timeline');
  if (available.length === 1) return available[0];
  return data.topics?.length || available.length > 1 ? 'overview' : 'list';
}

export function createKnowledgeView({ source, children, view, renderDetail, analyze, saveStructure, onExpand, renderGraph }) {
  const data = source.structure, notes = new Map(children.map(n => [n.id, n]));
  const root = el('section', { class: 'knowledge-views panel', dataset: { tour: 'source-structure' } }), toolbar = el('div', { class: 'map-toolbar' }), body = el('div');
  const feedback = el('p', { role: 'status', class: 'fine-print' });
  view.purpose ||= 'auto';
  const purpose = el('select', { 'aria-label': '学习目的与结构视图' });
  for (const [value, label] of Object.entries({ auto: '按结构推荐', ...modes })) purpose.append(el('option', { value, text: label }));
  purpose.value = view.purpose;
  purpose.addEventListener('change', () => { view.purpose = purpose.value; draw(); });
  const analyzeButton = button('重新分析结构', { kind: 'quiet compact', onClick: analyze });
  analyzeButton.dataset.structureSubmit = source.id;
  toolbar.append(el('label', { text: '查看目的 ' }, [purpose]), analyzeButton);
  function unitDetail(note, index) {
    const unit = data.units.find(u => u.id === note.id), box = el('section');
    if (unit) {
      box.append(el('p', { class: 'fine-print', text: `${unit.dimensions.map(v => dimensionLabels[v]).join(' · ')} / ${unit.roles.map(v => roleLabels[v]).join(' · ')}` }));
    }
    box.append(renderDetail(note, index)); return box;
  }
  function entry(id) {
    const note = notes.get(id), unit = data.units.find(u => u.id === id);
    return note ? el('details', { class: 'map-edge-detail' }, [el('summary', { text: unit?.shortTitle || note.title }), unitDetail(note, children.indexOf(note))]) : el('span');
  }
  function outline() {
    const assigned = new Set(data.topics.flatMap(t => t.members));
    function topicView(topic, visited = new Set()) {
      if (visited.has(topic.id)) return el('span');
      const next = new Set([...visited, topic.id]);
      const item = el('details', { open: true }, [el('summary', { text: `${topic.title} · ${topic.origin === 'original' ? '原文目录' : topic.origin === 'user' ? '用户导航' : 'AI 整理导航'}` })]);
      topic.members.forEach(id => item.append(entry(id)));
      data.topics.filter(t => t.parent === topic.id).forEach(t => item.append(topicView(t, next)));
      return item;
    }
    data.topics.filter(t => !t.parent).forEach(t => body.append(topicView(t)));
    const rest = children.filter(n => !assigned.has(n.id));
    if (rest.length) body.append(el('h3', { text: '未归类内容' }), ...rest.map(n => entry(n.id)));
    body.append(el('p', { class: 'fine-print', text: '主题仅用于导航。同一内容可出现在多个主题中，仍引用同一单元。可切换目的查看局部关系。' }));
  }
  function draw() {
    clear(body);
    const mode = selectKnowledgeView(data, view.purpose);
    feedback.textContent = `${modes[mode]} · 切换视图复用已保存内容，不调用模型。结构校验不代表事实已证实。`;
    if (mode === 'overview') return outline();
    if (mode === 'list') { children.forEach(n => body.append(entry(n.id))); return; }
    if (mode === 'timeline') {
      // Preserve source order; never infer temporal order from the model's arbitrary array order.
      const events = data.units.filter(u => u.roles.includes('event')).sort((a, b) => (a.sourceRefs[0]?.start ?? Infinity) - (b.sourceRefs[0]?.start ?? Infinity));
      body.append(el('p', { class: 'fine-print', text: '按原文出现顺序展示事件；时间标签来自原文，未据此推断因果。无明确时间保留待定。' }));
      if (!events.length) body.append(el('p', { text: '没有事件结构，保留内容列表。' }), ...children.map(n => entry(n.id)));
      for (const unit of events) body.append(el('article', { class: 'knowledge-event' }, [el('strong', { text: unit.eventTime || '时间待定' }), entry(unit.id)]));
      const other = data.units.filter(u => !u.roles.includes('event'));
      if (other.length) body.append(el('details', {}, [el('summary', { text: '其他内容' }), ...other.map(u => entry(u.id))]));
      return;
    }
    const edges = data.edges.filter(e => families[mode].includes(e.type)).slice(0, 24);
    if (!edges.length) { body.append(el('p', { text: '此目的下没有有依据的关系，保留列表，不补造连线。' }), ...children.map(n => entry(n.id))); return; }
    const memberIds = new Set(edges.flatMap(e => [e.from, e.to]));
    const nodes = children.filter(n => memberIds.has(n.id)).map(n => {
      const unit = data.units.find(u => u.id === n.id);
      const visualRole = mode === 'flow' ? (edges.some(e => e.from === n.id && e.type === 'condition') ? '判断 · 条件分支' : '步骤')
        : mode === 'argument' ? (unit?.roles.map(role => roleLabels[role]).join(' / ') || '论证内容')
        : edges.some(e => e.to === n.id && e.type === 'is-a') ? '上位概念' : edges.some(e => e.from === n.id && e.type === 'is-a') ? '下位概念' : '概念联系';
      return { ...n, title: unit?.shortTitle || n.title, visualRole };
    });
    body.append(el('p', { class: 'knowledge-legend', text: mode === 'flow' ? '从判断节点沿条件分支前进；每条分支保留明确条件。' : mode === 'argument' ? '支持：实线 / 支持关系词；反驳与反例：虚线 / 对应关系词。颜色只作辅助。' : '上位概念置于上层；箭头仍从下位概念指向上位概念，读作“是一种”。其他关系按箭头与关系词阅读。' }));
    if (mode === 'flow') body.append(el('ul', { class: 'knowledge-branches' }, edges.filter(e => e.type === 'condition').map(e => el('li', { text: `${nodes.find(n => n.id === e.from)?.title} → [${e.condition}] → ${nodes.find(n => n.id === e.to)?.title}` }))));
    view.graphs ||= {};
    view.graphs[mode] ||= { mode: 'logic', reading: false };
    body.append(renderGraph({ source: { ...source, structure: { version: 1, edges, hierarchy: [], message: `${modes[mode]} · 局部关系；全部内容保留在总览与列表。` } }, children: nodes, view: view.graphs[mode], visualKind: mode, renderDetail: unitDetail, analyze, onExpand }));
    if (data.edges.filter(e => families[mode].includes(e.type)).length > 24) body.append(el('p', { text: '当前展示前24条关系，其余保留在修订与依据中。' }));
    const other = children.filter(n => !memberIds.has(n.id));
    if (other.length) body.append(el('details', {}, [el('summary', { text: '未连接内容' }), ...other.map(n => entry(n.id))]));
  }
  root.append(el('h2', { text: `知识结构（${children.length} 个内容单元）` }), toolbar, feedback);
  if (data.hasPendingCandidate) {
    const candidate = el('details', {}, [el('summary', { text: '新分析候选（你的修订仍保留）' })]);
    for (const unit of data.pendingCandidate.units) candidate.append(el('p', { text: `${unit.shortTitle} · ${unit.dimensions.map(v => dimensionLabels[v]).join(' / ')}` }));
    for (const topic of data.pendingCandidate.topics) candidate.append(el('p', { text: `导航：${topic.title}` }));
    for (const edge of data.pendingCandidate.edges) candidate.append(el('p', { text: `${notes.get(edge.from)?.title} → ${edge.label} → ${notes.get(edge.to)?.title} · ${edge.condition || '未注明条件'} · ${edge.sourceRefs.map(r => r.quote).join('；')}` }));
    if (saveStructure) candidate.append(button('采用这份候选替换当前结构', { kind: 'quiet compact', onClick: async () => {
      try { await saveStructure({ structure: data.pendingCandidate, revision: data.revision }); feedback.textContent = '已按你的选择采用候选；重新打开资料查看。'; }
      catch (error) { feedback.textContent = error.message; }
    } }));
    root.append(candidate);
  }
  if (data.gaps?.length) root.append(el('details', {}, [el('summary', { text: `待回查缺口（${data.gaps.length}）` }), ...data.gaps.map(text => el('p', { text }))]));
  if (data.message) root.append(el('p', { text: data.message, role: 'status' }));
  root.append(el('p', { class: 'structure-job-status notice info', role: 'status', hidden: true, dataset: { sourceId: source.id } }), body);
  if (saveStructure && data.state !== 'stale') root.append(editor());
  function editor() {
    const draft = structuredClone({ version: 2, units: data.units, topics: data.topics, edges: data.edges });
    const panel = el('details', {}, [el('summary', { text: '修订分类、导航与关系' })]);
    function input(label, object, key, max = 700) {
      const control = el('input', { value: object[key] || '', maxlength: String(max), 'aria-label': label });
      control.addEventListener('input', () => { object[key] = control.value; });
      return el('label', { class: 'knowledge-field', text: label }, [control]);
    }
    function choices(label, unit, key, labels) {
      const group = el('fieldset', {}, [el('legend', { text: label })]);
      for (const [value, title] of Object.entries(labels)) {
        const control = el('input', { type: 'checkbox', checked: unit[key].includes(value) });
        control.addEventListener('change', () => { unit[key] = control.checked ? [...new Set([...unit[key], value])] : unit[key].filter(x => x !== value); });
        group.append(el('label', {}, [control, el('span', { text: title })]));
      }
      return group;
    }
    for (const unit of draft.units) panel.append(el('details', {}, [el('summary', { text: unit.shortTitle }), input('短标题', unit, 'shortTitle', 36), choices('知识维度', unit, 'dimensions', dimensionLabels), choices('内容角色', unit, 'roles', roleLabels)]));
    for (const topic of draft.topics) {
      const item = el('details', {}, [el('summary', { text: `导航：${topic.title}` }), input('主题标题', topic, 'title', 80)]);
      const parent = el('select', { 'aria-label': `${topic.title} 的上级主题` });
      parent.append(el('option', { value: '', text: '顶层主题' }));
      draft.topics.filter(t => t.id !== topic.id).forEach(t => parent.append(el('option', { value: t.id, text: t.title })));
      parent.value = topic.parent || ''; parent.addEventListener('change', () => { topic.parent = parent.value || null; topic.origin = 'user'; });
      item.append(parent);
      for (const unit of draft.units) {
        const control = el('input', { type: 'checkbox', checked: topic.members.includes(unit.id) });
        control.addEventListener('change', () => { topic.members = control.checked ? [...new Set([...topic.members, unit.id])] : topic.members.filter(id => id !== unit.id); topic.origin = 'user'; });
        item.append(el('label', {}, [control, el('span', { text: unit.shortTitle })]));
      }
      panel.append(item);
    }
    for (const edge of draft.edges) {
      const item = el('details', {}, [el('summary', { text: `${notes.get(edge.from)?.title} → ${edge.label} → ${notes.get(edge.to)?.title}` }),
        input('关系词', edge, 'label', 24), input('成立条件', edge, 'condition'), input('例外', edge, 'exceptions'), el('p', { text: statusLabels[edge.status] }), ...edge.sourceRefs.map(ref => el('blockquote', { text: ref.quote }))]);
      item.append(button('反转方向', { kind: 'quiet compact', onClick: () => { [edge.from, edge.to] = [edge.to, edge.from]; edge.status = 'user'; item.querySelector('summary').textContent = `${notes.get(edge.from)?.title} → ${edge.label} → ${notes.get(edge.to)?.title}`; } }), button('移除关系', { kind: 'quiet compact', onClick: () => { draft.edges = draft.edges.filter(e => e !== edge); item.remove(); } }));
      panel.append(item);
    }
    const message = el('p', { role: 'status' });
    const save = button('保存结构修订', { onClick: async () => {
      save.disabled = true;
      try { await saveStructure({ structure: draft, revision: data.revision }); message.textContent = '修订已保存，重新打开资料查看；后续分析不会覆盖。'; }
      catch (error) { message.textContent = error.message; save.disabled = false; }
    } });
    panel.append(save, message); return panel;
  }
  draw(); return root;
}
