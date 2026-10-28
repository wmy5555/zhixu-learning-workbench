// Rebuildable local projection. Markdown and notes remain authoritative.
export const searchTokens = text => [...new Set(String(text).toLowerCase().match(/[a-z0-9_]+|[\p{Script=Han}]/gu) || [])];
const gram = text => 'g' + Buffer.from(text).toString('hex');
function grams(text, query = false) {
  const chars = Array.from(text.toLowerCase()), result = new Set();
  const lengths = query ? [Math.min(3, chars.length)] : [1, 2, 3];
  for (const length of lengths) for (let i = 0; length && i <= chars.length - length; i++) result.add(gram(chars.slice(i, i + length).join('')));
  return [...result];
}
export class SearchIndex {
  constructor(db) {
    this.db = db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS search_documents (id TEXT PRIMARY KEY, hash TEXT NOT NULL, summary TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(grams, detail=none);
      CREATE TABLE IF NOT EXISTS search_segments (id INTEGER PRIMARY KEY,noteId TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS search_segments_note ON search_segments(noteId);
      CREATE TABLE IF NOT EXISTS search_dirty (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS search_state (singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL, version INTEGER NOT NULL);
      INSERT OR IGNORE INTO search_state VALUES(1,0,0);
      CREATE TRIGGER IF NOT EXISTS search_insert AFTER INSERT ON notes BEGIN
        INSERT INTO search_dirty SELECT new.id WHERE NOT EXISTS(SELECT 1 FROM search_dirty WHERE id=new.id); UPDATE search_state SET revision=revision+1;
      END;
      CREATE TRIGGER IF NOT EXISTS search_update AFTER UPDATE ON notes BEGIN
        INSERT INTO search_dirty SELECT new.id WHERE NOT EXISTS(SELECT 1 FROM search_dirty WHERE id=new.id); UPDATE search_state SET revision=revision+1;
      END;
      CREATE TRIGGER IF NOT EXISTS search_delete AFTER DELETE ON notes BEGIN
        INSERT INTO search_dirty SELECT old.id WHERE NOT EXISTS(SELECT 1 FROM search_dirty WHERE id=old.id); UPDATE search_state SET revision=revision+1;
      END;`);
    if (db.prepare('SELECT version FROM search_state').get().version !== 2 ||
      db.prepare('SELECT count(*) n FROM search_fts').get().n !== db.prepare('SELECT count(*) n FROM search_segments').get().n ||
      db.prepare('SELECT count(DISTINCT noteId) n FROM search_segments').get().n !== db.prepare('SELECT count(*) n FROM search_documents').get().n) this.rebuild();
  }
  revision() { return this.db.prepare('SELECT revision FROM search_state').get().revision; }
  rebuild() {
    this.db.exec('SAVEPOINT search_rebuild');
    try {
      this.db.exec('DELETE FROM search_fts; DELETE FROM search_segments; DELETE FROM search_documents; DELETE FROM search_dirty; INSERT INTO search_dirty SELECT id FROM notes; UPDATE search_state SET version=2,revision=revision+1;');
      this.sync();
      this.db.exec('RELEASE search_rebuild');
    } catch (error) { this.db.exec('ROLLBACK TO search_rebuild; RELEASE search_rebuild'); throw error; }
  }
  sync() {
    if (!this.db.prepare('SELECT 1 FROM search_dirty LIMIT 1').get()) return 0;
    let count=0;
    this.db.exec('SAVEPOINT search_sync');
    try {
      const remove = this.db.prepare('DELETE FROM search_fts WHERE rowid IN (SELECT id FROM search_segments WHERE noteId=?)');
      const removeSegments = this.db.prepare('DELETE FROM search_segments WHERE noteId=?');
      const put = this.db.prepare('INSERT INTO search_documents VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash,summary=excluded.summary,title=excluded.title,text=excluded.text');
      const fts = this.db.prepare('INSERT INTO search_fts(rowid,grams) VALUES(?,?)');
      const segment = this.db.prepare('INSERT INTO search_segments(noteId) VALUES(?)');
      for (const row of this.db.prepare('SELECT d.id,n.json,s.text FROM search_dirty d LEFT JOIN notes n ON n.id=d.id LEFT JOIN search_documents s ON s.id=d.id').iterate()) {
        count++;
        if (row.json) {
          const { body, ...summary } = JSON.parse(row.json), text = `${summary.title}\n${body}`.toLowerCase();
          put.run(row.id, summary.hash, JSON.stringify(summary), summary.title.toLowerCase(), text);
          // Metadata still refreshes above, but identical normalized title/body
          // cannot change the grams. Compare within this synchronous transaction.
          if (row.text === text) continue;
          remove.run(row.id);removeSegments.run(row.id);
          // Bound the temporary Set/array/token string independently of note
          // length. Overlap contains any supported query (512 UTF-16 units,
          // at most 1024 after Unicode lowercasing), including boundary hits.
          for(let start=0;start<text.length;start+=7168) {
            const rowid=segment.run(row.id).lastInsertRowid;
            fts.run(rowid,grams(text.slice(start,start+8192)).join(' '));
          }
        } else {
          remove.run(row.id);removeSegments.run(row.id);
          this.db.prepare('DELETE FROM search_documents WHERE id=?').run(row.id);
        }
      }
      this.db.exec('DELETE FROM search_dirty; RELEASE search_sync');
    } catch (error) { this.db.exec('ROLLBACK TO search_sync; RELEASE search_sync'); throw error; }
    return count;
  }
  candidates(query, options = {}, { all = false } = {}) {
    const q = query.toLowerCase(), tokens = searchTokens(q), params = [], clauses = [];
    const bind = value => { params.push(value); return '?'; };
    const prop = key => `json_extract(d.summary,'$.${key}')`;
    const browse = options.browse === true, kinds = options.scope || (options.kind ? [options.kind] : (browse ? null : ['knowledge','source','topic']));
    const falsy = value => `COALESCE(${value}=0 OR ${value}='',1)`;
    clauses.push(falsy(prop('meta.excerptOnly')));
    if (kinds) clauses.push(kinds.length ? `${prop('kind')} IN (${kinds.map(bind).join(',')})` : '0');
    if (browse && options.stage === 'retired') clauses.push(`${prop('meta.stage')}='retired'`);
    else clauses.push(`COALESCE(${prop('meta.stage')},'')!='retired' AND ${falsy(prop('meta.supersededBy'))}`);
    if (!browse) clauses.push(`${prop('kind')} NOT IN ('mistake','report')`);
    for (const key of ['stage','topic']) if (options[key]) clauses.push(`${prop('meta.' + key)}=${bind(options[key])}`);
    if (options.source) clauses.push(`EXISTS(SELECT 1 FROM json_each(d.summary,'$.meta.sources') s WHERE json_extract(CASE WHEN s.type='object' THEN s.value ELSE '{}' END,'$.id')=${bind(options.source)})`);
    for (const [key,op] of [['from','>='],['to','<=']]) if (options[key]) clauses.push(`substr(${prop('updatedAt')},1,10)${op}${bind(options[key])}`);
    let sql;
    if (all) sql = `SELECT d.summary,0 score FROM search_documents d WHERE ${clauses.join(' AND ')} ORDER BY d.id DESC`;
    else {
      // FTS only selects a superset. Literal substring checks preserve previous
      // Chinese single-character, short-term and embedded model-number recall.
      const expression = [...new Set([q, ...tokens])].map(t => '(' + grams(t, true).slice(0, 32).join(' AND ') + ')').join(' OR ');
      const match = bind(expression), exact = bind(q), title = bind(q);
      const overlap = tokens.length ? tokens.map(t => `(instr(d.text,${bind(t)})>0)`).join('+') : '0';
      const threshold = Math.min(0.65, 2 / Math.max(1, tokens.length));
      sql = `WITH hits AS (SELECT d.id,d.summary,(instr(d.text,${exact})>0) exact,(instr(d.title,${title})>0) titleHit,(${overlap})*1.0/${tokens.length || 1} overlap
        FROM search_documents d WHERE d.id IN (SELECT s.noteId FROM search_fts JOIN search_segments s ON s.id=search_fts.rowid WHERE search_fts MATCH ${match}) AND ${clauses.join(' AND ')})
        SELECT summary,exact*8+overlap*3+titleHit*3 score FROM hits WHERE exact OR overlap>=${threshold} ORDER BY score DESC,id DESC`;
      // SQL parameter order follows the SELECT, MATCH, then WHERE clauses.
      const filterCount = params.length - (3 + tokens.length);
      const filterParams = params.slice(0, filterCount);
      const tail = params.slice(filterCount);
      params.splice(0, params.length, tail[1], tail[2], ...tail.slice(3), tail[0], ...filterParams);
    }
    return this.db.prepare(sql).all(...params).map(row => ({ note: JSON.parse(row.summary), score: row.score, via: ['keyword'] }));
  }
}

export function searchContext(note, query, semanticOffset) {
  const body = String(note.body || ''), lower = body.toLowerCase(), q = String(query).trim().toLowerCase();
  let offset = lower.indexOf(q), term = q, type = 'exact', field = 'body';
  if (offset < 0 && note.title.toLowerCase().includes(q)) { field='title';offset=note.title.toLowerCase().indexOf(q); }
  else if (offset < 0) {
    const matches = searchTokens(q).map(t => ({ t, at: lower.indexOf(t) })).filter(m => m.at >= 0).sort((a,b) => b.t.length-a.t.length || a.at-b.at);
    if (matches.length) { offset = matches[0].at; term = matches[0].t; type = 'token'; }
    else { offset = Math.max(0, Math.min(body.length, semanticOffset || 0)); term = ''; type = 'semantic'; }
  }
  // Translate lowercased offsets back to original UTF-16 positions (e.g. İ).
  if (field === 'body' && type !== 'semantic' && body.length !== lower.length) {
    let normalized = 0, original = 0;
    for (const char of body) { if (normalized >= offset) break; normalized += char.toLowerCase().length; original += char.length; }
    offset = original;
  }
  const start = field === 'title' ? 0 : Math.max(0, offset - Math.min(160, Math.max(0,600-term.length))), end = Math.min(body.length, start + Math.max(600, term.length));
  const before = body.slice(0, field === 'title' ? 0 : offset), lines = before.split('\n');
  const heading = [...before.matchAll(/^#{1,6}\s+(.+)$/gm)].at(-1)?.[1] || '';
  return { snippet: body.slice(start, end), location: { field, type, offset, end: offset + term.length, line: field === 'title' ? null : lines.length, column: field === 'title' ? null : lines.at(-1).length + 1, heading, path: note.path, hash: note.hash, snippetStart: start, snippetEnd: end } };
}
