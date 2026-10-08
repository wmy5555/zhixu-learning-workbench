import { el, button, clear } from './ui.mjs';

export const sourceMapLabels = { support: '支持', explain: '解释', prerequisite: '前提', example: '实例', counterexample: '反例', limit: '限定', application: '应用', sequence: '先后' };
let mapSerial = 0;

// Collapse strongly connected components before ranking, keeping cyclic edges visible.
export function layoutSourceMap(nodes, edges, hierarchy, mode = 'logic', collapsed = new Set(), sourceTitle = '') {
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
    // Bring supporting leaves close to their first conclusion instead of spanning empty layers.
    for (const component of [...ready].reverse()) if (outgoing[component].size) {
      rank[component] = Math.max(rank[component], Math.min(...[...outgoing[component]].map(next => rank[next])) - 1);
    }
    for (const id of ids) { visible.push(id); ranks.set(id, rank[group.get(id)]); }
  }
  const levels = new Map();
  for (const id of visible) { const rank = ranks.get(id); if (!levels.has(rank)) levels.set(rank, []); levels.get(rank).push(id); }
  // Title length changes with the material. Reserve up to four readable lines.
  const titleUnits = value => [...String(value || '')].reduce((size, char) => size + (char.codePointAt(0) > 255 ? 1 : .55), 0);
  const lines = Math.max(1, ...nodes.map(n => Math.ceil(titleUnits(n.title) / 12)), mode === 'mind' ? Math.ceil(titleUnits(sourceTitle) / 12) : 1);
  const positions = new Map(), cardWidth = 220, cardHeight = Math.max(96, 52 + Math.min(4, lines) * 22);
  const rowStep = cardHeight + 64, levelStep = cardHeight + 100, columnStep = cardWidth + 100;
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
    const height = Math.max(340, leaf * rowStep + 48), offset = (height - Math.max(0, leaf - 1) * rowStep - cardHeight) / 2;
    positions.set('__source__', { x: 32, y: height / 2 - cardHeight / 2 });
    for (const id of visible) positions.set(id, { x: 32 + ranks.get(id) * columnStep, y: offset + rows.get(id) * rowStep });
    return { positions, width: maxRank * columnStep + cardWidth + 64, height, cardWidth, cardHeight, levelStep };
  }
  // Each edge has a reserved caption lane between cards. Back/cycle edges use the
  // band above their earliest endpoint; long edges travel through side gutters.
  const gutter = 48 + links.length * 8;
  const width = Math.max(560, maxItems * (cardWidth + 56) + gutter * 2);
  for (const [rank, members] of levels) members.forEach((id, i) => positions.set(id, { x: gutter + (i + .5) * (width - gutter * 2) / members.length - cardWidth / 2, y: 0 }));
  const bands = new Map();
  for (const edge of links) {
    const a = ranks.get(edge.from), b = ranks.get(edge.to), band = b > a ? a : Math.min(a,b) - 1;
    if (!bands.has(band)) bands.set(band, []);
    bands.get(band).push(edge);
  }
  const gap = rank => Math.max(80, (bands.get(rank)?.length || 0) * 32 + 32);
  let y = gap(-1);
  const rowY = new Map();
  for (let rank = 0; rank <= maxRank; rank++) {
    rowY.set(rank, y);
    for (const id of levels.get(rank) || []) positions.get(id).y = y;
    y += cardHeight + gap(rank);
  }
  const routes = links.map((edge, index) => {
    const a = positions.get(edge.from), b = positions.get(edge.to);
    const forward = b.y > a.y, band = forward ? ranks.get(edge.from) : Math.min(ranks.get(edge.from),ranks.get(edge.to)) - 1;
    const floor = band < 0 ? 0 : rowY.get(band) + cardHeight;
    const ty = floor + 24 + bands.get(band).indexOf(edge) * 32;
    const x1 = a.x + cardWidth / 2, x2 = b.x + cardWidth / 2;
    const rail = index % 2 ? width - 20 - index * 8 : 20 + index * 8;
    let d, tx;
    if (forward && ranks.get(edge.to) === ranks.get(edge.from) + 1) {
      d = 'M'+x1+','+(a.y+cardHeight)+' L'+x1+','+ty+' L'+x2+','+ty+' L'+x2+','+b.y;
      tx = (x1+x2)/2;
    } else if (forward) {
      d = 'M'+x1+','+(a.y+cardHeight)+' L'+x1+','+ty+' L'+rail+','+ty+' L'+rail+','+(b.y-12)+' L'+x2+','+(b.y-12)+' L'+x2+','+b.y;
      tx = (x1+rail)/2;
    } else {
      const start = a.x + cardWidth * .7, end = b.x + cardWidth * .3;
      d = 'M'+start+','+a.y+' L'+start+','+(a.y-12)+' L'+rail+','+(a.y-12)+' L'+rail+','+ty+' L'+end+','+ty+' L'+end+','+b.y;
      tx = (rail+end)/2;
    }
    return { edge, d, tx, ty, label: { x: tx-22, y: ty-15, width: 44, height: 24 } };
  });
  return { positions, width, height: Math.max(320, y), cardWidth, cardHeight, levelStep, routes };

}

export function enableMapPanning(viewport) {
  let drag = null, suppressClick = false;
  const finish = () => {
    const previous = drag; drag = null;
    viewport.classList.remove('is-panning');
    if (previous?.moved) {
      suppressClick = true;
      if (viewport.hasPointerCapture?.(previous.id)) viewport.releasePointerCapture(previous.id);
    }
  };
  viewport.addEventListener('pointerdown', event => {
    suppressClick = false;
    if (viewport.dataset.reading !== 'false' || event.button !== 0 || event.pointerType === 'touch' || drag) return;
    if (event.target.closest?.('.map-collapse-button, a, input, select, textarea')) return;
    const bounds = viewport.getBoundingClientRect();
    // Leave native scrollbars and touch scrolling available.
    if (event.clientX >= bounds.left + viewport.clientWidth || event.clientY >= bounds.top + viewport.clientHeight) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop, moved: false };
  });
  viewport.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    if (!(event.buttons & 1)) { finish(); return; }
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (!drag.moved) {
      drag.moved = true; viewport.setPointerCapture?.(drag.id); viewport.classList.add('is-panning');
    }
    event.preventDefault();
    viewport.scrollLeft = drag.left - dx; viewport.scrollTop = drag.top - dy;
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) viewport.addEventListener(name, event => {
    if (drag?.id === event.pointerId) finish();
  });
  viewport.addEventListener('pointerleave', () => { if (drag && !drag.moved) finish(); });
  viewport.addEventListener('click', event => {
    if (suppressClick && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); }
    suppressClick = false;
  }, true);
  return finish;
}

export function createSourceMap({ source, children, view = {}, renderDetail, analyze, onExpand = () => {} }) {
  const data = source.structure || { state: 'missing', hierarchy: [], edges: [], message: '这份旧资料尚无结构建议，可重新分析；当前仅显示来源归属。' };
  const edges = Array.isArray(data.edges) ? data.edges : [], hierarchy = Array.isArray(data.hierarchy) ? data.hierarchy : [];
  const notes = new Map(children.map(note => [note.id, note]));
  view.mode ||= 'logic'; view.collapsed ||= new Set(); view.zoom ||= 1;
  for (const id of view.collapsed) if (!notes.has(id)) view.collapsed.delete(id);
  if (!notes.has(view.selected)) {
    const degree = id => edges.filter(edge => edge.from === id || edge.to === id).length;
    view.selected = children.reduce((best, note) => degree(note.id) > degree(best?.id) ? note : best, children[0])?.id;
  }
  const root = el('section', { class: 'source-map panel', dataset: { tour: 'source-structure' } });
  const toolbar = el('div', { class: 'map-toolbar' });
  const tabs = el('div', { class: 'map-tabs', role: 'group', 'aria-label': '结构视图' });
  const viewport = el('div', { class: 'map-viewport', role: 'region', tabindex: '0', 'aria-label': '资料结构，可按住鼠标拖动、滚轮缩放，使用节点按钮阅读' });
  const finishPan = enableMapPanning(viewport);
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
  const layoutForView = () => layoutSourceMap(children, edges, hierarchy, view.mode, view.collapsed, source.title);
  const parentById = new Map(hierarchy.map(h => [h.child, h.parent]));
  const branchRoots = children.filter(note => !notes.has(parentById.get(note.id))).map(note => note.id);
  const branches = children.filter(note => branchRoots.includes(parentById.get(note.id)) || branchRoots.includes(note.id) && !hierarchy.some(h => h.parent === note.id)).map(note => note.id);
  function toneFor(id) {
    const seen = new Set();
    while (notes.has(parentById.get(id)) && !branches.includes(id) && !seen.has(id)) { seen.add(id); id = parentById.get(id); }
    return ['blue', 'green', 'warm'][Math.max(0, branches.indexOf(id)) % 3];
  }
  function centerSelected() {
    const layout = layoutForView(), position = layout.positions.get(view.selected);
    if (!position || listMode) return;
    viewport.scrollLeft = Math.max(0, (position.x + layout.cardWidth / 2) * view.zoom - viewport.clientWidth / 2);
    viewport.scrollTop = Math.max(0, (position.y + layout.cardHeight / 2) * view.zoom - viewport.clientHeight / 2);
  }
  function select(id, focus = false) { view.selected = id; draw(); if (focus) nodeButtons.get(id)?.focus({ preventScroll: true }); }
  function scaleCanvas(frame, canvas, width, height) {
    frame.style.width = `${width * view.zoom}px`; frame.style.height = `${height * view.zoom}px`;
    canvas.style.transform = `scale(${view.zoom})`;
    canvas.style.left = `max(0px, calc((100% - ${width * view.zoom}px) / 2))`;
    canvas.style.top = `max(0px, calc((100% - ${height * view.zoom}px) / 2))`;
  }
  viewport.addEventListener('wheel', event => {
    // Preserve browser zoom gestures, horizontal scrolling and the full-text reader.
    if (listMode || event.ctrlKey || event.metaKey || event.shiftKey || !Number.isFinite(event.deltaY) || !event.deltaY) return;
    const bounds = viewport.getBoundingClientRect();
    if (event.clientX >= bounds.left + viewport.clientWidth || event.clientY >= bounds.top + viewport.clientHeight) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
    const next = Math.max(.15, Math.min(1.8, view.zoom * Math.exp(-Math.max(-160, Math.min(160, event.deltaY * unit)) * .002)));
    if (next === view.zoom) return;
    const frame = viewport.querySelector('.map-frame'), canvas = viewport.querySelector('.map-canvas');
    if (!frame || !canvas) return;
    finishPan();
    const before = canvas.getBoundingClientRect();
    const x = (event.clientX - before.left) / view.zoom, y = (event.clientY - before.top) / view.zoom;
    view.zoom = next;
    scaleCanvas(frame, canvas, parseFloat(canvas.style.width), parseFloat(canvas.style.height));
    const after = canvas.getBoundingClientRect();
    // Compensate for both native scroll clamping and centering when the map is smaller than its window.
    viewport.scrollLeft += after.left + x * next - event.clientX;
    viewport.scrollTop += after.top + y * next - event.clientY;
    zoomReset.textContent = `${Math.round(next * 100)}%`;
    zoomOut.disabled = next <= .15; zoomIn.disabled = next >= 1.8;
  }, { passive: false });
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
    finishPan();
    const left = viewport.scrollLeft || 0, top = viewport.scrollTop || 0;
    clear(viewport); nodeButtons.clear();
    viewport.dataset.mode = view.mode;
    viewport.dataset.reading = String(listMode);
    zoomReset.textContent = `${Math.round(view.zoom * 100)}%`;
    for (const control of [zoomOut, zoomReset, zoomIn, fitButton]) control.disabled = listMode;
    zoomOut.disabled ||= view.zoom <= .15; zoomIn.disabled ||= view.zoom >= 1.8;
    readAll.textContent = listMode ? '返回结构图' : '阅读全部条目';
    for (const [mode, control] of modeButtons) control.setAttribute('aria-pressed', String(!listMode && view.mode === mode));
    if (listMode) { children.forEach((note, i) => viewport.append(renderDetail(note, i))); detail.hidden = true; relationDetail.hidden = true; return; }
    detail.hidden = false; relationDetail.hidden = false;
    const layout = layoutForView();
    const frame = el('div', { class: 'map-frame' });
    const canvas = el('div', { class: 'map-canvas' });
    canvas.style.width = `${layout.width}px`; canvas.style.height = `${layout.height}px`;
    // CSS recenters after a drawer/viewport resize without changing the user's zoom.
    scaleCanvas(frame, canvas, layout.width, layout.height);
    const svg = svgElement('svg', { width: layout.width, height: layout.height, 'aria-hidden': 'true', class: 'map-lines' });
    const markerId = `map-arrow-${++mapSerial}`, defs = svgElement('defs'), marker = svgElement('marker', { id: markerId, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
    marker.append(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'context-stroke' })); defs.append(marker); svg.append(defs);
    const painted = view.mode === 'mind' ? children.map(n => ({ from: hierarchy.find(h => h.child === n.id)?.parent || '__source__', to: n.id, type: 'contains' })) : edges;
    const captions = svgElement('g');
    for (const edge of painted) {
      const a = layout.positions.get(edge.from), b = layout.positions.get(edge.to); if (!a || !b) continue;
      const related = edge.from === view.selected || edge.to === view.selected;
      let d, tx, ty;
      if (view.mode === 'mind') {
        const x1 = a.x + layout.cardWidth, x2 = b.x, y1 = a.y + layout.cardHeight / 2, y2 = b.y + layout.cardHeight / 2;
        d = `M${x1},${y1} C${(x1+x2)/2},${y1} ${(x1+x2)/2},${y2} ${x2},${y2}`;
      } else {
        const route = layout.routes.find(route => route.edge === edge);
        if (!route) continue;
        ({ d, tx, ty } = route);
      }
      svg.append(svgElement('path', { d, 'data-tone': toneFor(edge.to), class: `map-line${related ? ' is-related' : ''}`, ...(view.mode === 'logic' ? { 'marker-end': `url(#${markerId})` } : {}) }));
      if (view.mode === 'logic') {
        const label = svgElement('g', { class: `map-edge-caption${related ? ' is-related' : ''}` });
        label.append(svgElement('rect', { x: tx - 22, y: ty - 15, width: 44, height: 24, rx: 8 }),
          svgElement('text', { x: tx, y: ty + 2, 'text-anchor': 'middle', class: 'map-edge-label' }, sourceMapLabels[edge.type] || '关联'));
        captions.append(label);
      }
    }
    svg.append(captions);
    canvas.append(svg);
    for (const [id, position] of layout.positions) {
      const note = notes.get(id), isRoot = id === '__source__';
      const title = isRoot ? source.title : note.title;
      const card = isRoot ? el('div', { class: 'map-node is-root' }) : button('', { kind: 'map-node', onClick: () => select(id, true) });
      card.classList.add('map-node');
      card.dataset.tone = isRoot ? 'blue' : toneFor(id); card.title = title;
      card.append(el('span', { class: 'map-node-kicker', text: isRoot ? '原始资料' : `拆解 ${String(children.indexOf(note) + 1).padStart(2, '0')}` }), el('span', { class: 'map-node-title', text: title }));
      card.style.left = `${position.x}px`; card.style.top = `${position.y}px`; card.style.width = `${layout.cardWidth}px`; card.style.height = `${layout.cardHeight}px`;
      if (!isRoot) {
        card.dataset.noteId = id; card.setAttribute('aria-label', title); card.setAttribute('aria-pressed', String(id === view.selected)); nodeButtons.set(id, card);
        if (edges.some(e => e.from === view.selected && e.to === id || e.to === view.selected && e.from === id)) card.classList.add('is-related');
      }
      canvas.append(card);
      if (view.mode === 'mind' && hierarchy.some(h => h.parent === id)) {
        const collapse = button(view.collapsed.has(id) ? '+' : '−', { kind: 'map-collapse', onClick: () => { if (view.collapsed.has(id)) view.collapsed.delete(id); else view.collapsed.add(id); select(id, true); } });
        collapse.setAttribute('aria-label', `${view.collapsed.has(id) ? '展开' : '折叠'} ${note.title}`); collapse.setAttribute('aria-expanded', String(!view.collapsed.has(id)));
        collapse.style.left = `${position.x+layout.cardWidth+10}px`; collapse.style.top = `${position.y+layout.cardHeight/2-14}px`; canvas.append(collapse);
      }
    }
    frame.append(canvas); viewport.append(frame); viewport.scrollLeft = left; viewport.scrollTop = top; drawDetail();
  }
  for (const [mode, label] of [['logic','逻辑图'], ['mind','思维导图']]) {
    const control = button(label, { kind: 'quiet compact', onClick: () => { view.mode = mode; listMode = false; draw(); centerSelected(); control.focus({ preventScroll: true }); } }); modeButtons.set(mode, control); tabs.append(control);
  }
  const fit = () => {
    const layout = layoutForView();
    view.zoom = Math.max(.15, Math.min(1, ((viewport.clientWidth || 650) - 24) / layout.width, ((viewport.clientHeight || 420) - 24) / layout.height));
    viewport.scrollLeft = 0; viewport.scrollTop = 0; draw();
  };
  const expand = button(view.expanded ? '恢复窗口' : '展开窗口', { kind: 'quiet compact', title: '只改变窗口大小，保留图形比例', onClick: () => { view.expanded = !view.expanded; onExpand(view.expanded); expand.textContent = view.expanded ? '恢复窗口' : '展开窗口'; expand.setAttribute('aria-pressed', String(view.expanded)); } });
  expand.setAttribute('aria-pressed', String(view.expanded));
  const zoomOut = button('−', { kind: 'quiet compact', onClick: () => { view.zoom = Math.max(.15, view.zoom-.15); draw(); } });
  const zoomIn = button('+', { kind: 'quiet compact', onClick: () => { view.zoom = Math.min(1.8, view.zoom+.15); draw(); } });
  zoomOut.setAttribute('aria-label', '缩小结构图'); zoomIn.setAttribute('aria-label', '放大结构图');
  const zoomReset = button('100%', { kind: 'text compact map-zoom-value', title: '恢复原始比例', onClick: () => { view.zoom = 1; draw(); } });
  zoomReset.setAttribute('aria-label', '恢复原始比例');
  const fitButton = button('适应窗口', { kind: 'quiet compact', title: '缩放整张图，使其尽量完整显示', onClick: fit });
  const readAll = button('阅读全部条目', { kind: 'text compact', onClick: () => { listMode = !listMode; draw(); } });
  toolbar.append(tabs, el('div', { class: 'map-tools' }, [el('div', { class: 'map-zoom-controls', role: 'group', 'aria-label': '图形缩放' }, [zoomOut, zoomReset, zoomIn]), fitButton, expand]));
  const analyzeButton = button('重新分析结构', { kind: 'quiet compact', onClick: analyze });
  analyzeButton.dataset.structureSubmit = source.id;
  root.append(el('div', { class: 'map-heading' }, [el('h2', { text: '资料结构' }), el('span', { class: 'badge badge-warn', text: 'AI 结构建议' }), analyzeButton]),
    el('p', { class: 'fine-print', text: '新资料在 AI 拆解时一并分析结构。重新分析会发送获准的原文与当前条目，可能产生费用。' }),
    el('p', { class: 'map-status', role: 'status', text: data.message || (edges.length ? `${children.length} 条拆解 · ${edges.length} 条逻辑联系 · 点击条目查看正文与依据` : '没有可靠的逻辑连线；思维导图显示资料归属与已分析层级。') }),
    el('p', { class: 'structure-job-status notice info', role: 'status', hidden: true, dataset: { sourceId: source.id } }), toolbar, viewport,
    el('div', { class: 'map-reading-bar' }, [el('span', { class: 'fine-print', text: '按住鼠标拖动 · 滚轮向上放大、向下缩小 · AI 建议尚未确认' }), readAll]), relationDetail, detail);
  draw();
  queueMicrotask(() => { if (root.isConnected) centerSelected(); });
  return root;
}
