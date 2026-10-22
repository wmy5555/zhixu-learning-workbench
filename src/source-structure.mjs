import { validateKnowledgeStructure } from './knowledge-structure.mjs';
import { hash, now } from './store.mjs';

const types = new Set(['support', 'explain', 'prerequisite', 'example', 'counterexample', 'limit', 'application', 'sequence']);
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const array = value => Array.isArray(value) ? value : [];
const missingMessage = '本次拆解未提供可用结构，可点击「重新分析结构」重试；已保存的条目保留。';
export const structureBasis = (source, notes) => ({
  sourceHash: source.hash,
  ...(source.structureSources ? { referenceSources: source.structureSources.map(s => [s.id, s.hash]).sort(([a],[b]) => a.localeCompare(b)) } : {}),
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

export function structureRecord(source, notes, raw, keys, { user = false } = {}) {
  if (raw?.version === 2) {
    if (![raw.units, raw.topics, raw.edges].every(Array.isArray)) return { version: 2, state: 'missing', message: missingMessage };
    const input = user ? raw : { ...raw, edges: raw.edges.map(e => e?.status === 'user' ? { ...e, status: 'pending' } : e), topics: raw.topics.map(t => t?.origin === 'user' ? { ...t, origin: 'ai' } : t) };
    const valid = validateKnowledgeStructure(input, source, notes, keys);
    return { version: 2, sourceId: source.id, basis: structureBasis(source, notes), generatedAt: now(),
      ...valid, hierarchy: [], state: valid.gaps.length ? 'partial' : 'ready',
      message: '结构校验不等于事实核验；事实性是知识维度，不表示已证实。' };
  }
  const valid = normalizeStructure(raw, notes, keys);
  const missing = !raw || !Array.isArray(raw.edges) || !Array.isArray(raw.hierarchy);
  if (missing) { valid.edges = []; valid.hierarchy = []; }
  return { version: 1, sourceId: source.id, basis: structureBasis(source, notes), generatedAt: now(),
    ...valid, state: missing ? 'missing' : valid.discarded ? 'partial' : 'ready',
    message: missing ? missingMessage : valid.discarded ? '部分关系缺少有效依据或层级不完整，已保留可用部分。' : '' };
}

export function structureView(source, notes, stored) {
  const nodes = notes.map(n => ({ id: n.id, title: n.title }));
  if (!stored || ![1, 2].includes(stored.version)) return { state: 'missing', nodes, hierarchy: [], edges: [], message: '尚未分析资料内部结构。当前仅展示来源归属。' };
  if (JSON.stringify(structureBasis(source, notes)) !== JSON.stringify(stored.basis)) {
    if (stored.version === 2) {
      const pendingCurrent = stored.pendingCandidate && JSON.stringify(stored.pendingCandidate.basis) === JSON.stringify(structureBasis(source, notes));
      return { version: 2, state: 'stale', nodes, hierarchy: [], ...validateKnowledgeStructure({ units: stored.units, topics: [], edges: [] }, source, notes),
        revision: hash(JSON.stringify(stored)), hasPendingCandidate: Boolean(pendingCurrent),
        pendingCandidate: pendingCurrent ? { version: 2, ...validateKnowledgeStructure(stored.pendingCandidate, source, notes) } : undefined,
        message: '原文或条目已变化，旧导航与关系暂不展示；人工修订仍保留，新候选须核对后采用。' };
    }
    return { state: 'stale', nodes, hierarchy: [], edges: [], message: '结构待更新：原文或拆解内容已有变化，请重新分析。' };
  }
  if (stored.version === 2) {
    const valid = validateKnowledgeStructure(stored, source, notes);
    valid.gaps = [...new Set([...(stored.gaps || []), ...valid.gaps])];
    return { ...stored, ...valid, nodes, revision: hash(JSON.stringify(stored)), pendingCandidate: stored.pendingCandidate ? { version: 2, ...validateKnowledgeStructure(stored.pendingCandidate, source, notes) } : undefined, previousRevision: undefined,
      hasPendingCandidate: Boolean(stored.pendingCandidate), state: valid.gaps.length ? 'partial' : 'ready' };
  }
  const valid = normalizeStructure(stored, notes);
  return { state: valid.discarded ? 'partial' : stored.state, nodes, hierarchy: valid.hierarchy, edges: valid.edges,
    generatedAt: stored.generatedAt, message: stored.state === 'missing' ? missingMessage : stored.message || (valid.discarded ? '部分关系已失效，请重新分析。' : '') };
}
