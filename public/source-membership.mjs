function* sourceLinks(note) {
  for (const ref of (note.meta.sources || []).values()) {
    if (ref.role === 'input' && ref.id) yield ref.id;
  }
  const legacy = note.meta.processKey?.split(':')[0];
  if (legacy) yield legacy;
}

export const sourceParentIds = note => [...new Set(sourceLinks(note))];
const isMember = note => note.kind === 'knowledge' && !note.meta.excerptOnly;
const childOrder = note => Number(note.meta.processKey?.split(':').at(-1)) || 0;
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
  // The imported graph reader can use an explicit input without consulting an
  // unrelated, externally edited legacy key. Processing examines every binding.
  return notes.filter(note => {
    if (note.meta && isMember(note)) {
      for (const id of sourceLinks(note)) if (id === sourceId) return true;
    }
    return false;
  }).sort(inSourceOrder);
}
