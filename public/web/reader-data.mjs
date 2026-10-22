import { endpoint } from './api.mjs';
import { learningReadiness } from './reader-actions.mjs';
import { relatedReadingNotes } from './reading-content.mjs';

export function sameReaderData(a, b) {
  const identity = note => note.hash ? [note.id, note.hash] : note;
  const signature = data => JSON.stringify([identity(data.note), data.note.structure,
    data.note.children?.map(identity), data.related.map(identity), data.readiness]);
  return signature(a) === signature(b);
}

// Bootstrap already contains full public bodies. Keep only a few enriched details,
// in memory, scoped to the current space, successful-write revision and bootstrap.
export function createReaderData(api, { limit = 6 } = {}) {
  let scope, bootstrap;
  const cache = new Map(), pending = new Map();
  function current(boot) {
    const { version, revision } = api.getContext();
    const key = `${version}:${revision}`;
    if (key !== scope || boot !== bootstrap) {
      scope = key; bootstrap = boot; cache.clear(); pending.clear();
    }
    return key;
  }
  function project(note, notes, relations = [], limitations) {
    return { note, related: relatedReadingNotes(note, notes, relations),
      readiness: note.kind === 'knowledge' ? learningReadiness(note, notes, limitations) : null };
  }
  function peek(id, boot) {
    current(boot);
    if (cache.has(id)) {
      const entry = cache.get(id); cache.delete(id); cache.set(id, entry); return entry;
    }
    const notes = boot?.notes || [], note = notes.find(n => n.id === id);
    if (!note || typeof note.body !== 'string') return null;
    const children = note.kind === 'source' ? notes.filter(n => n.kind === 'knowledge' &&
      (n.meta?.processKey?.split(':')[0] === id || n.meta?.sources?.some(s => s.role === 'input' && s.id === id)))
      .sort((a,b) => (Number(a.meta?.processKey?.split(':').at(-1)) || 0) - (Number(b.meta?.processKey?.split(':').at(-1)) || 0)) : undefined;
    return project(children ? { ...note, children } : note, notes);
  }
  function load(id, boot) {
    const key = current(boot);
    if (pending.has(id)) return pending.get(id);
    const known = peek(id, boot), notes = boot?.notes || [];
    const evidence = known?.note.kind === 'knowledge' ? api.get(endpoint('notes', id, 'evidence')) : null;
    const request = Promise.all([api.get(endpoint('notes', id)), api.get('/api/relations'), evidence])
      .then(async ([note, relations, detail]) => {
        if (note.kind === 'knowledge' && !detail) detail = await api.get(endpoint('notes', id, 'evidence'));
        const result = project(note, notes, relations.relations || [], detail?.limitations);
        const context = api.getContext();
        if (bootstrap === boot && scope === key && `${context.version}:${context.revision}` === key) {
          cache.delete(id); cache.set(id, result);
          while (cache.size > limit) cache.delete(cache.keys().next().value);
        }
        return result;
      }).finally(() => { if (pending.get(id) === request) pending.delete(id); });
    pending.set(id, request);
    return request;
  }
  return { peek, load };
}
