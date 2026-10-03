import { hash, now } from './store.mjs';

const types = new Set(['support', 'explain', 'prerequisite', 'example', 'counterexample', 'limit', 'application', 'sequence']);
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const array = value => Array.isArray(value) ? value : [];
export const structureBasis = (source, notes) => ({
  sourceHash: source.hash,
  notes: notes.map(n => [n.id, hash(JSON.stringify([n.title, n.body]))]).sort(([a], [b]) => a.localeCompare(b)),
});

// Hierarchy expresses containment; typed edges express a different, possibly cyclic, relationship.
export function normalizeStructure(raw, notes, keys = new Map(notes.map(n => [n.id, n.id]))) {
  const byId = new Map(notes.map(n => [n.id, n])), parents = new Map(), edges = [], seen = new Set();
  let discarded = 0;
  const resolve = key => keys.get(String(key));
  for (const item of array(raw?.hierarchy).slice(0, 2000)) {
    if (!item || typeof item !== 'object') { discarded++; continue; }
    const child = resolve(item.child), parent = item.parent == null ? null : resolve(item.parent);
    if (!byId.has(child) || (parent !== null && !byId.has(parent)) || child === parent || parents.has(child)) { discarded++; continue; }
    let cursor = parent;
    while (cursor && cursor !== child) cursor = parents.get(cursor);
    if (cursor === child) { discarded++; continue; }
    parents.set(child, parent);
  }
  for (const item of array(raw?.edges).slice(0, 2000)) {
    if (!item || typeof item !== 'object') { discarded++; continue; }
    const from = resolve(item.from), to = resolve(item.to);
    const sourceExcerpt = text(item.sourceExcerpt, 700), targetExcerpt = text(item.targetExcerpt, 700);
    const explanation = text(item.explanation, 700), key = JSON.stringify([from, to, item.type]);
    if (!byId.has(from) || !byId.has(to) || from === to || !types.has(item.type) || seen.has(key)
      || !explanation || !sourceExcerpt || !targetExcerpt
      || !byId.get(from).body.includes(sourceExcerpt) || !byId.get(to).body.includes(targetExcerpt)) { discarded++; continue; }
    seen.add(key); edges.push({ id: hash(key).slice(0, 20), from, to, type: item.type, explanation, sourceExcerpt, targetExcerpt });
  }
  return { hierarchy: [...parents].map(([child, parent]) => ({ child, parent })), edges, discarded };
}

export function structureRecord(source, notes, raw, keys) {
  const valid = normalizeStructure(raw, notes, keys);
  const missing = !raw || !Array.isArray(raw.edges) || !Array.isArray(raw.hierarchy);
  if (missing) { valid.edges = []; valid.hierarchy = []; }
  return { version: 1, sourceId: source.id, basis: structureBasis(source, notes), generatedAt: now(),
    ...valid, state: missing ? 'missing' : valid.discarded ? 'partial' : 'ready',
    message: missing ? '本次拆解未提供可用结构。可单独补充逻辑关系。' : valid.discarded ? '部分关系缺少有效依据或层级不完整，已保留可用部分。' : '' };
}

export function structureView(source, notes, stored) {
  const nodes = notes.map(n => ({ id: n.id, title: n.title }));
  if (!stored || stored.version !== 1) return { state: 'missing', nodes, hierarchy: [], edges: [], message: '尚未分析资料内部结构。当前仅展示来源归属。' };
  if (JSON.stringify(structureBasis(source, notes)) !== JSON.stringify(stored.basis)) {
    return { state: 'stale', nodes, hierarchy: [], edges: [], message: '结构待更新：原文或拆解内容已有变化，请重新分析。' };
  }
  const valid = normalizeStructure(stored, notes);
  return { state: valid.discarded ? 'partial' : stored.state, nodes, hierarchy: valid.hierarchy, edges: valid.edges,
    generatedAt: stored.generatedAt, message: stored.message || (valid.discarded ? '部分关系已失效，请重新分析。' : '') };
}
