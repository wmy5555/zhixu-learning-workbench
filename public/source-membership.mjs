const invalidProcessKey = Object.freeze({ invalid: true });
const isSourceId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
export const sourceBindingWarning = '来源关联损坏，请先核对原始资料和来源记录。';
export const missingLocalSourceWarning = '本地原始资料已删除，请恢复原文或修正来源关联。';

export function processKeyBinding(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return invalidProcessKey;
  const parts = value.split(':');
  const [sourceId, sourceHash] = parts;
  if (!isSourceId(sourceId) || !sourceHash?.trim()) return invalidProcessKey;
  return { sourceId, sourceHash, order: Number(parts.at(-1)) || 0 };
}

const isSourceReference = ref => isSourceId(ref?.id) && typeof ref.role === 'string';

export function sourceReferences(meta) {
  return Array.isArray(meta?.sources) ? meta.sources.filter(isSourceReference) : [];
}

export function hasInvalidSourceBinding(meta) {
  const sources = meta?.sources;
  return processKeyBinding(meta?.processKey)?.invalid === true
    || (sources != null && (!Array.isArray(sources) || sources.some(ref => !isSourceReference(ref))));
}

export function reprocessingSourceId(meta) {
  if (hasInvalidSourceBinding(meta)) return null;
  const legacy = processKeyBinding(meta?.processKey);
  if (legacy) return legacy.sourceId;
  const inputs = new Set(sourceReferences(meta).filter(ref => ref.role === 'input').map(ref => ref.id));
  return inputs.size === 1 ? inputs.values().next().value : null;
}

function* sourceLinks(note) {
  for (const ref of sourceReferences(note.meta)) {
    if (ref.role === 'input') yield ref.id;
  }
  const legacy = processKeyBinding(note.meta?.processKey)?.sourceId;
  if (legacy) yield legacy;
}

export const sourceParentIds = note => [...new Set(sourceLinks(note))];
const isMember = note => note.kind === 'knowledge' && !note.meta.excerptOnly;
const childOrder = note => processKeyBinding(note.meta.processKey)?.order ?? 0;
const inSourceOrder = (left, right) => childOrder(left) - childOrder(right);

export function groupSourceChildren(notes, sourceIds) {
  const groups = new Map(sourceIds.map(id => [id, []]));
  if (!groups.size) return groups;
  for (const note of notes) {
    if (!isMember(note)) continue;
    for (const id of sourceParentIds(note)) groups.get(id)?.push(note);
  }
  // Equal or missing order values retain the order of the supplied snapshot.
  for (const children of groups.values()) children.sort(inSourceOrder);
  return groups;
}

export function sourceChildren(notes, sourceId) {
  // Reading can still use a valid explicit source when the legacy key is damaged.
  return notes.filter(note => {
    if (note.meta && isMember(note)) {
      for (const id of sourceLinks(note)) if (id === sourceId) return true;
    }
    return false;
  }).sort(inSourceOrder);
}
