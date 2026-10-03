import { el, button, clear } from './ui.mjs';

export const sourceMapLabels = { support: '支持', explain: '解释', prerequisite: '前提', example: '实例', counterexample: '反例', limit: '限定', application: '应用', sequence: '先后' };
let mapSerial = 0;

// Collapse strongly connected components before ranking, keeping cyclic edges visible.
export function layoutSourceMap(nodes, edges, hierarchy, mode = 'logic', collapsed = new Set()) {
  const ids = nodes.map(n => n.id), allowed = new Set(ids), ranks = new Map(), visible = [];
  const links = edges.filter(e => allowed.has(e.from) && allowed.has(e.to));
  const parents = new Map(hierarchy.filter(h => allowed.has(h.child) && (h.parent === null || allowed.has(h.parent))).map(h => [h.child, h.parent]));
  if (mode === 'mind') {
    for (const id of ids) {
      let parent = parents.get(id), rank = 1, hidden = false;
      const visited = new Set([id]);
      while (parent && !visited.has(parent)) { visited.add(parent); if (collapsed.has(parent)) hidden = true; rank++; parent = parents.get(parent); }
      if (!hidden) { visible.push(id); ranks.set(id, rank); }
    }
  } else {
    let index = 0;
    const indices = new Map(), low = new Map(), stack = [], active = new Set(), components = [], group = new Map();
    const adjacency = new Map(ids.map(id => [id, []]));
    for (const e of links) adjacency.get(e.from).push(e.to);
    function visit(id) {
      indices.set(id, index); low.set(id, index++); stack.push(id); active.add(id);
      for (const to of adjacency.get(id)) {
        if (!indices.has(to)) { visit(to); low.set(id, Math.min(low.get(id), low.get(to))); }
        else if (active.has(to)) low.set(id, Math.min(low.get(id), indices.get(to)));
      }
      if (indices.get(id) === low.get(id)) {
        const members = []; let item;
        do { item = stack.pop(); active.delete(item); group.set(item, components.length); members.push(item); } while (item !== id);
        components.push(members);
      }
    }
    ids.forEach(id => { if (!indices.has(id)) visit(id); });
    const incoming = components.map(() => new Set()), outgoing = components.map(() => new Set()), rank = components.map(() => 0);
    for (const e of links) { const a = group.get(e.from), b = group.get(e.to); if (a !== b) { outgoing[a].add(b); incoming[b].add(a); } }
    const ready = incoming.flatMap((set, i) => set.size ? [] : [i]);
    for (let i = 0; i < ready.length; i++) for (const next of outgoing[ready[i]]) {
      rank[next] = Math.max(rank[next], rank[ready[i]] + 1); incoming[next].delete(ready[i]); if (!incoming[next].size) ready.push(next);
    }
    for (const id of ids) { visible.push(id); ranks.set(id, rank[group.get(id)]); }
  }
  const levels = new Map();
  for (const id of visible) { const rank = ranks.get(id); if (!levels.has(rank)) levels.set(rank, []); levels.get(rank).push(id); }
  const positions = new Map(), cardWidth = 184, cardHeight = 76;
  const maxItems = Math.max(1, ...[...levels.values()].map(items => items.length));
  const maxRank = Math.max(0, ...ranks.values());
  if (mode === 'mind') {
    const visited = new Set(), rows = new Map(); let leaf = 0;
    function place(id) {
      if (visited.has(id)) return rows.get(id) || 0;
      visited.add(id);
      const kids = visible.filter(child => parents.get(child) === id && !visited.has(child));
      const childRows = kids.map(place), row = childRows.length ? (childRows[0] + childRows.at(-1)) / 2 : leaf++;
      rows.set(id, row); return row;
    }
    visible.filter(id => !visible.includes(parents.get(id))).forEach(place);
    visible.forEach(id => { if (!visited.has(id)) place(id); });
    const height = Math.max(300, leaf * 120 + 50), offset = (height - Math.max(0, leaf - 1) * 120 - cardHeight) / 2;
    positions.set('__source__', { x: 24, y: height / 2 - cardHeight / 2 });
    for (const id of visible) positions.set(id, { x: 24 + ranks.get(id) * 255, y: offset + rows.get(id) * 120 });
    return { positions, width: (maxRank + 1) * 255, height, cardWidth, cardHeight };
  }
  const width = Math.max(620, maxItems * 230 + 70);
  for (const [rank, members] of levels) members.forEach((id, i) => positions.set(id, { x: (i + .5) * width / members.length - cardWidth / 2, y: 32 + rank * 118 }));
  return { positions, width, height: Math.max(220, (maxRank + 1) * 118 + 26), cardWidth, cardHeight };
}

export function createSourceMap({ source, children, view = {}, renderDetail, analyze, onExpand = () => {} }) {
  const data = source.structure || { state: 'missing', hierarchy: [], edges: [], message: '尚未分析内部逻辑；当前仅显示来源归属。' };
  const edges = Array.isArray(data.edges) ? data.edges : [], hierarchy = Array.isArray(data.hierarchy) ? data.hierarchy : [];
  const notes = new Map(children.map(note => [note.id, note]));
  view.mode ||= 'logic'; view.collapsed ||= new Set(); view.zoom ||= 1;
  if (!notes.has(view.selected)) view.selected = children[0]?.id;
  const root = el('section', { class: 'source-map panel', dataset: { tour: 'source-structure' } });
  const toolbar = el('div', { class: 'map-toolbar' });
  const tabs = el('div', { class: 'map-tabs', role: 'group', 'aria-label': '结构视图' });
  const viewport = el('div', { class: 'map-viewport', role: 'region', 'aria-label': '资料结构，可使用节点按钮阅读' });
  const detail = el('div', { class: 'map-detail', 'aria-live': 'polite' });
  const relationDetail = el('div', { class: 'map-relations' });
  const nodeButtons = new Map(), modeButtons = new Map();
  const svgElement = (tag, attrs = {}, content = '') => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
    if (content) element.textContent = content;
    return element;
  };
  let listMode = false;
  view.expanded ||= false;
  onExpand(view.expanded);
  function select(id, focus = false) { view.selected = id; draw(); if (focus) nodeButtons.get(id)?.focus({ preventScroll: true }); }
  function drawDetail() {
    clear(detail); clear(relationDetail);
    const note = notes.get(view.selected);
    if (!note) return;
    detail.append(renderDetail(note, children.indexOf(note)));
    const relevant = edges.filter(e => e.from === note.id || e.to === note.id);
    relationDetail.append(el('h3', { text: '与这条内容的联系' }));
    if (!relevant.length) relationDetail.append(el('p', { class: 'muted', text: '尚无有依据的逻辑连线；同一来源只表示资料归属。' }));
    for (const edge of relevant) {
      if (!notes.has(edge.from) || !notes.has(edge.to)) continue;
      const other = edge.from === note.id ? edge.to : edge.from;
      relationDetail.append(el('details', { class: 'map-edge-detail', dataset: { edgeId: edge.id } }, [
        el('summary', { text: `${notes.get(edge.from).title} → ${sourceMapLabels[edge.type] || '关联'} → ${notes.get(edge.to).title}` }),
        el('p', { text: edge.explanation }), el('blockquote', { text: edge.sourceExcerpt }), el('blockquote', { text: edge.targetExcerpt }),
        button('查看关联条目', { kind: 'text compact', onClick: () => select(other, true) }),
      ]));
    }
  }
  function draw() {
    const left = viewport.scrollLeft || 0, top = viewport.scrollTop || 0;
    clear(viewport); nodeButtons.clear();
    readAll.textContent = listMode ? '返回结构图' : '阅读全部条目';
    for (const [mode, control] of modeButtons) control.setAttribute('aria-pressed', String(!listMode && view.mode === mode));
    if (listMode) { children.forEach((note, i) => viewport.append(renderDetail(note, i))); detail.hidden = true; relationDetail.hidden = true; return; }
    detail.hidden = false; relationDetail.hidden = false;
    const layout = layoutSourceMap(children, edges, hierarchy, view.mode, view.collapsed);
    const frame = el('div', { class: 'map-frame' });
    frame.style.width = `${layout.width * view.zoom}px`; frame.style.height = `${layout.height * view.zoom}px`;
    const canvas = el('div', { class: 'map-canvas' });
    canvas.style.width = `${layout.width}px`; canvas.style.height = `${layout.height}px`; canvas.style.transform = `scale(${view.zoom})`;
    canvas.style.left = `${Math.max(0, ((viewport.clientWidth || 0) - layout.width * view.zoom) / 2)}px`;
    const svg = svgElement('svg', { width: layout.width, height: layout.height, 'aria-hidden': 'true', class: 'map-lines' });
    const markerId = `map-arrow-${++mapSerial}`, defs = svgElement('defs'), marker = svgElement('marker', { id: markerId, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
    marker.append(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'currentColor' })); defs.append(marker); svg.append(defs);
    const painted = view.mode === 'mind' ? children.map(n => ({ from: hierarchy.find(h => h.child === n.id)?.parent || '__source__', to: n.id, type: 'contains' })) : edges;
    for (const [i, edge] of painted.entries()) {
      const a = layout.positions.get(edge.from), b = layout.positions.get(edge.to); if (!a || !b) continue;
      const related = edge.from === view.selected || edge.to === view.selected;
      let d, tx, ty;
      if (view.mode === 'mind') {
        const x1 = a.x + layout.cardWidth, x2 = b.x, y1 = a.y + 38, y2 = b.y + 38;
        d = `M${x1},${y1} C${(x1+x2)/2},${y1} ${(x1+x2)/2},${y2} ${x2},${y2}`;
      } else if (b.y - a.y > 118) {
        // Route a relation that skips layers beside intermediate cards, never through their text.
        const left = a.x < b.x, rail = left ? b.x - 36 : b.x + layout.cardWidth + 36;
        const x1 = a.x + 92, y1 = a.y + 76, x2 = left ? b.x : b.x + layout.cardWidth, y2 = b.y + 38;
        d = `M${x1},${y1} C${x1},${y1+22} ${rail},${y1+22} ${rail},${y1+38} L${rail},${y2-14} Q${rail},${y2} ${x2},${y2}`;
        tx = rail + (left ? -16 : 16); ty = (y1+y2)/2;
      } else if (b.y > a.y) {
        const x1 = a.x + 92, x2 = b.x + 92, y1 = a.y + 76, y2 = b.y, mid = (y1+y2)/2;
        d = `M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}`; tx = (x1+x2)/2; ty = mid - 6;
      } else {
        const y = Math.max(12, Math.min(a.y,b.y) - 18 - (i % 3)*9), x1 = a.x+125, x2 = b.x+60;
        d = `M${x1},${a.y} C${x1},${y} ${x2},${y} ${x2},${b.y}`; tx = (x1+x2)/2; ty = y-2;
      }
      svg.append(svgElement('path', { d, class: `map-line${related ? ' is-related' : ''}`, ...(view.mode === 'logic' ? { 'marker-end': `url(#${markerId})` } : {}) }));
      if (view.mode === 'logic') svg.append(svgElement('text', { x: tx, y: ty, 'text-anchor': 'middle', class: 'map-edge-label' }, sourceMapLabels[edge.type] || '关联'));
    }
    canvas.append(svg);
    for (const [id, position] of layout.positions) {
      const note = notes.get(id), isRoot = id === '__source__';
      const card = isRoot ? el('div', { class: 'map-node is-root', text: source.title }) : button(note.title, { kind: 'map-node', onClick: () => select(id, true) });
      card.classList.add('map-node');
      card.style.left = `${position.x}px`; card.style.top = `${position.y}px`;
      if (!isRoot) {
        card.dataset.noteId = id; card.setAttribute('aria-pressed', String(id === view.selected)); card.title = note.title; nodeButtons.set(id, card);
        if (edges.some(e => e.from === view.selected && e.to === id || e.to === view.selected && e.from === id)) card.classList.add('is-related');
      }
      canvas.append(card);
      if (view.mode === 'mind' && hierarchy.some(h => h.parent === id)) {
        const collapse = button(view.collapsed.has(id) ? '+' : '−', { kind: 'map-collapse', onClick: () => { if (view.collapsed.has(id)) view.collapsed.delete(id); else view.collapsed.add(id); select(id, true); } });
        collapse.setAttribute('aria-label', `${view.collapsed.has(id) ? '展开' : '折叠'} ${note.title}`); collapse.setAttribute('aria-expanded', String(!view.collapsed.has(id)));
        collapse.style.left = `${position.x+190}px`; collapse.style.top = `${position.y+25}px`; canvas.append(collapse);
      }
    }
    frame.append(canvas); viewport.append(frame); viewport.scrollLeft = left; viewport.scrollTop = top; drawDetail();
  }
  for (const [mode, label] of [['logic','逻辑图'], ['mind','思维导图']]) {
    const control = button(label, { kind: 'quiet compact', onClick: () => { view.mode = mode; listMode = false; fit(); control.focus(); } }); modeButtons.set(mode, control); tabs.append(control);
  }
  const fit = () => {
    const layout = layoutSourceMap(children, edges, hierarchy, view.mode, view.collapsed);
    view.zoom = Math.max(.15, Math.min(1, ((viewport.clientWidth || 650) - 2) / layout.width, (window.innerHeight || 950) * .55 / layout.height));
    viewport.scrollLeft = 0; viewport.scrollTop = 0; draw();
  };
  const expand = button(view.expanded ? '恢复窗口' : '放大查看', { kind: 'quiet compact', onClick: () => { view.expanded = !view.expanded; onExpand(view.expanded); expand.textContent = view.expanded ? '恢复窗口' : '放大查看'; fit(); } });
  const zoomOut = button('−', { kind: 'quiet compact', onClick: () => { view.zoom = Math.max(.15, view.zoom-.15); draw(); } });
  const zoomIn = button('+', { kind: 'quiet compact', onClick: () => { view.zoom = Math.min(1.8, view.zoom+.15); draw(); } });
  zoomOut.setAttribute('aria-label', '缩小结构图'); zoomIn.setAttribute('aria-label', '放大结构图');
  const readAll = button('阅读全部条目', { kind: 'text compact', onClick: () => { listMode = !listMode; draw(); } });
  toolbar.append(tabs, button('适应窗口', { kind: 'text compact', onClick: fit }), expand,
    zoomOut, zoomIn, readAll);
  const analyzeButton = button(data.state === 'missing' ? '补充逻辑关系' : '重新分析结构', { kind: 'quiet compact', onClick: analyze });
  analyzeButton.dataset.structureSubmit = source.id;
  root.append(el('div', { class: 'map-heading' }, [el('h2', { text: '资料结构' }), el('span', { class: 'badge badge-warn', text: 'AI 结构建议' }), analyzeButton]),
    el('p', { class: 'fine-print', text: '结构用于辅助阅读，尚未经你确认；点击分析会发送获准的原文与拆解，可能产生费用。' }),
    el('p', { class: 'map-status', role: 'status', text: data.message || (edges.length ? `${children.length} 条拆解 · ${edges.length} 条逻辑联系 · 虚线表示 AI 建议` : '没有可靠的逻辑连线；思维导图显示资料归属与已分析层级。') }),
    el('p', { class: 'fine-print', text: `全部条目来自《${source.title}》。思维导图的分支仅表示层级；逻辑依据可在选中条目下查看。` }),
    el('p', { class: 'structure-job-status notice info', role: 'status', hidden: true, dataset: { sourceId: source.id } }), toolbar, viewport, relationDetail, detail);
  draw();
  if (!view.initialized) { view.initialized = true; queueMicrotask(() => { if (root.isConnected) fit(); }); }
  return root;
}
