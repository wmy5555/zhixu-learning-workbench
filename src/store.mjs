import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import YAML from 'yaml';
import { SearchIndex } from './search-index.mjs';
import { assertBackupSize, backupObject, validBackupId, validateBackupPath, validateBackupMarkdown, validateBackupRecord, BACKUP_ITEM_MAX_BYTES, BACKUP_MAX_BYTES } from './backup-contract.mjs';
import { includeAttachments, validateAttachments, installAttachments } from './attachment-backup.mjs';

export const now = () => new Date().toISOString();
export const hash = value => createHash('sha256').update(value).digest('hex');
export function fail(message, code = 'INVALID', status = 400) {
  const error = new Error(message); Object.assign(error, { code, status }); throw error;
}
export function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, content, { mode: 0o600 });
    const delays = [20, 50, 100];
    for (let attempt = 0; ; attempt++) {
      try { fs.renameSync(tmp, file); break; }
      catch (error) {
        // Windows scanners and synced folders may briefly hold the destination open.
        // Retry the same atomic replacement; never remove the previous good file.
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= delays.length) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delays[attempt]);
      }
    }
  }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function atomicWriteExclusive(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, content, { mode: 0o600, flag: 'wx' });
    // Linking a complete same-directory file is atomic and cannot replace an occupant.
    // Unsupported filesystems fail closed; never fall back to an overwriting rename.
    fs.linkSync(tmp, file);
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function durableWrite(file, content) {
  atomicWrite(file, content);
  const fd = fs.openSync(file, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
const folders = { source: '01 原始资料', knowledge: '02 知识', mistake: '03 错题修正', topic: '04 主题', report: '05 发现' };
const reserved = new Set(['id', 'kind', 'title', 'createdAt', 'updatedAt']);
const linkStart = '<!-- zhixu-managed-links:start -->';
const linkEnd = '<!-- zhixu-managed-links:end -->';
const stableJSON = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const restorePlanDigest = manifest => hash(stableJSON(Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'phase'))));
function parse(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const doc = YAML.parseDocument(match?.[1] || '{}');
  if (doc.errors.length) fail('Markdown 属性格式错误，请在原文件修正。', 'FRONTMATTER');
  const meta = doc.toJS({ maxAliasCount: 50 }) || {};
  if (typeof meta !== 'object' || Array.isArray(meta)) fail('文件属性必须为键值对象。');
  return { doc, meta, body: match ? raw.slice(match[0].length) : raw };
}
function unchangedFrontmatter(file, raw, root) {
  const header = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[0];
  // An unclosed header can acquire metadata anywhere in the remaining bytes.
  if (!header && /^---\r?\n/.test(raw)) return false;
  const expected = Buffer.from(header ?? raw.slice(0, 5));
  // An EOF delimiter must remain at EOF; a short plain file may gain a header.
  const checkEnd = header ? !header.endsWith('\n') : raw.length < 5;
  const bytes = Buffer.alloc(expected.length + (checkEnd ? 1 : 0));
  const fd = fs.openSync(assertTree(file, root), 'r');
  try {
    const length = fs.readSync(fd, bytes, 0, bytes.length, 0);
    return length === expected.length && bytes.subarray(0, length).equals(expected);
  } finally { fs.closeSync(fd); }
}
function serialize(raw, fields, body) {
  const { doc } = parse(raw);
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) doc.set(key, value);
  return `---\n${doc.toString({ lineWidth: 0 }).trimEnd()}\n---\n${body}`;
}
function assertTree(file, root) {
  const rel = path.relative(root, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) fail('文件路径不在授权 Vault 内。', 'PATH_ESCAPE', 403);
  let current = root;
  for (const part of rel.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) fail('不允许通过链接访问其他目录。', 'SYMLINK', 403);
  }
  return file;
}
export class Store {
  constructor({ dataDir, vaultDir, backupPurpose }) {
    if (backupPurpose !== undefined && backupPurpose !== 'onboarding-practice') fail('备份用途无效。');
    this.backupPurpose = backupPurpose;
    this.dataDir = path.resolve(dataDir); this.vaultDir = path.resolve(vaultDir);
    fs.mkdirSync(this.dataDir, { recursive: true }); fs.mkdirSync(this.vaultDir, { recursive: true });
    if (fs.lstatSync(this.vaultDir).isSymbolicLink()) fail('Vault 根目录不能是链接。');
    this.db = new DatabaseSync(path.join(this.dataDir, 'learning.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY,path TEXT UNIQUE NOT NULL,hash TEXT NOT NULL,raw TEXT NOT NULL,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records (namespace TEXT NOT NULL,key TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(namespace,key));
      CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY,noteId TEXT NOT NULL,path TEXT NOT NULL,hash TEXT NOT NULL,raw TEXT NOT NULL,reason TEXT NOT NULL,createdAt TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS versions_note ON versions(noteId);
      CREATE TABLE IF NOT EXISTS index_chunks (id TEXT PRIMARY KEY,noteId TEXT NOT NULL,body TEXT NOT NULL,vector TEXT,model TEXT);
      CREATE INDEX IF NOT EXISTS index_chunks_note ON index_chunks(noteId);
      CREATE TABLE IF NOT EXISTS restore_transactions (id TEXT PRIMARY KEY,digest TEXT NOT NULL,committed INTEGER NOT NULL DEFAULT 0);`);
    this.conflicts = [];
    this.scanCache = new Map(); this.lastFullScan = 0;
    try { this.recoverInterruptedRestore(); this.searchIndex = new SearchIndex(this.db); this.scan(); this.searchIndex.sync(); }
    catch (error) { this.db.close(); throw error; }
  }
  recoverInterruptedRestore() {
    for (const name of fs.readdirSync(this.vaultDir).filter(item => item.startsWith('.learning-restore-'))) {
      const stageRoot = path.join(this.vaultDir, name), manifestFile = path.join(stageRoot, 'manifest.json');
      let manifest;
      try {
        assertTree(stageRoot, this.vaultDir);
        if (!/^\.learning-restore-[a-f0-9-]{36}$/.test(name) || !fs.lstatSync(stageRoot).isDirectory()) fail('恢复暂存目录名称或类型无效。');
        assertTree(manifestFile, this.vaultDir);
        if (fs.statSync(manifestFile).size > BACKUP_MAX_BYTES) fail('恢复阶段记录超限。');
        manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
        if (!backupObject(manifest) || manifest.format !== 'learning-workbench-restore' || manifest.version !== 1 || manifest.id !== name.slice('.learning-restore-'.length) || !Array.isArray(manifest.incoming) || !Array.isArray(manifest.previous)) fail('恢复阶段记录格式无效。');
        const maps = {};
        for (const group of ['incoming','previous']) {
          const ids = new Set(), paths = new Set(); maps[group] = new Map();
          for (const item of manifest[group]) {
            if (!backupObject(item) || !validBackupId(item.id) || typeof item.hash !== 'string' || !/^[a-f0-9]{64}$/.test(item.hash)) fail('恢复文件证据无效。');
            validateBackupPath(item.path);
            if (ids.has(item.id) || paths.has(item.path.toLowerCase())) fail('恢复文件计划存在重复身份或路径。');
            ids.add(item.id); paths.add(item.path.toLowerCase());
            maps[group].set(process.platform === 'win32' ? item.path.toLowerCase() : item.path, item);
          }
        }
        const readEvidence = (file, expected) => {
          assertTree(file, this.vaultDir);
          if (!fs.existsSync(file)) return null;
          if (!fs.lstatSync(file).isFile() || fs.statSync(file).size > BACKUP_ITEM_MAX_BYTES) fail('恢复路径已被替换或文件超限。');
          const raw = fs.readFileSync(file);
          if (!expected.includes(hash(raw))) fail('恢复文件存在外部修改；保留现场，未覆盖。');
          return raw;
        };
        // Inspect the entire staging tree before deleting anything. Unknown files and
        // links are evidence we cannot safely attribute to this transaction.
        const inspect = (dir, prefix = '') => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const rel = prefix + entry.name, file = path.join(dir, entry.name);
            assertTree(file, this.vaultDir);
            if (entry.isSymbolicLink()) fail('恢复暂存包含链接。');
            if (entry.isDirectory()) {
              if (!['incoming','previous'].includes(rel.split('/')[0])) fail('恢复暂存包含未知目录。');
              inspect(file, rel + '/');
            } else if (rel !== 'manifest.json') {
              const slash = rel.indexOf('/'), group = rel.slice(0, slash), relative = rel.slice(slash + 1);
              const item = maps[group]?.get(process.platform === 'win32' ? relative.toLowerCase() : relative);
              if (!item) fail('恢复暂存包含未知文件。');
              readEvidence(file, [item.hash]);
            }
          }
        };
        inspect(stageRoot);
        const digest = restorePlanDigest(manifest);
        const marker = this.db.prepare('SELECT digest,committed FROM restore_transactions WHERE id=?').get(manifest.id);
        if (!marker || marker.digest !== digest || ![0,1].includes(marker.committed)) fail('恢复提交证据缺失或与文件计划不一致。');
        const committed = marker.committed === 1;
        const expectedRows = committed ? manifest.incoming : manifest.previous;
        const actualRows = this.db.prepare('SELECT id,path,hash FROM notes').all().sort((a,b) => a.id.localeCompare(b.id));
        if (stableJSON(actualRows) !== stableJSON([...expectedRows].sort((a,b) => a.id.localeCompare(b.id)))) fail('数据库与恢复计划不一致；未猜测覆盖。');
        const actions = [];
        const keys = new Set([...maps.previous.keys(), ...maps.incoming.keys()]);
        for (const key of keys) {
          const old = maps.previous.get(key), incoming = maps.incoming.get(key), item = old || incoming;
          const target = path.join(this.vaultDir, ...item.path.split('/'));
          const raw = readEvidence(target, [old?.hash,incoming?.hash].filter(Boolean));
          if (committed) {
            if (incoming && (!raw || hash(raw) !== incoming.hash) || !incoming && raw) fail('已提交恢复的新文件不完整或被修改。');
          } else if (old) {
            const previous = readEvidence(path.join(stageRoot, 'previous', ...old.path.split('/')), [old.hash]);
            if (raw && hash(raw) === old.hash) continue;
            if (!previous) fail('恢复前原文件缺失，无法证明安全回滚。');
            actions.push({ target, raw: previous, expected: raw ? hash(raw) : null });
          } else if (raw) actions.push({ target, raw: null, expected: hash(raw) });
        }
        for (const action of actions) {
          const current = readEvidence(action.target, action.expected ? [action.expected] : []);
          if (action.expected === null && current) fail('恢复处理时文件发生变化。');
          if (action.expected !== null && !current) fail('恢复处理时文件被移除。');
          if (action.raw === null) fs.unlinkSync(action.target);
          else durableWrite(action.target, action.raw);
        }
        // Copies in previous remain until all replacements have completed, so a
        // second interruption can repeat this recovery without losing its source.
        fs.rmSync(stageRoot, { recursive: true, force: true });
        this.db.prepare('DELETE FROM restore_transactions WHERE id=?').run(manifest.id);
      } catch (cause) {
        const error = new Error(`恢复中断后的证据不足或处理失败；为避免混合资料与记录，已停止启动。请保留暂存目录和安全备份：${stageRoot}`);
        Object.assign(error, { code: 'RESTORE_RECOVERY_REQUIRED', status: 503, recoveryPath: stageRoot, manifestPath: manifestFile, safetyBackup: manifest?.safetyBackup, cause });
        throw error;
      }
    }
  }
  get(namespace, key, fallback = null) {
    this.assertAvailable();
    const row = this.db.prepare('SELECT json FROM records WHERE namespace=? AND key=?').get(namespace, key);
    return row ? JSON.parse(row.json) : fallback;
  }
  put(namespace, key, data) {
    this.assertAvailable();
    this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET json=excluded.json').run(namespace, key, JSON.stringify(data)); return data;
  }
  assertAvailable() { if (this.recoveryBlocked) throw this.recoveryBlocked; }
  records(namespace) { this.assertAvailable(); return this.db.prepare('SELECT json FROM records WHERE namespace=? ORDER BY rowid DESC').all(namespace).map(r => JSON.parse(r.json)); }
  remove(namespace, key) { this.assertAvailable(); this.db.prepare('DELETE FROM records WHERE namespace=? AND key=?').run(namespace, key); }
  row(id) { this.assertAvailable(); return this.db.prepare('SELECT * FROM notes WHERE id=?').get(id); }
  read(id) { const row = this.row(id); if (!row) fail('内容不存在，可能已经删除或存在文件冲突。', 'NOT_FOUND', 404); return JSON.parse(row.json); }
  readPersisted(id, { includeRaw = false } = {}) {
    const row = this.row(id);
    if (!row) fail('已保存内容缺失，无法完成磁盘核验。', 'PERSISTED_UNAVAILABLE', 409);
    try {
      if (fs.lstatSync(this.vaultDir).isSymbolicLink()) throw new Error('unsafe root');
      const file = assertTree(path.resolve(this.vaultDir, row.path), this.vaultDir);
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > 5_000_000) throw new Error('invalid persisted file');
      const bytes = fs.readFileSync(file), raw = bytes.toString('utf8'), digest = hash(bytes), { meta, body } = parse(raw);
      const fresh = { id, kind: folders[meta.kind || 'knowledge'] ? (meta.kind || 'knowledge') : 'knowledge',
        title: String(meta.title || path.basename(file, '.md')), body,
        meta: Object.fromEntries(Object.entries(meta).filter(([key]) => !reserved.has(key))),
        hash: digest, path: path.relative(this.vaultDir, file).replaceAll('\\', '/'),
        updatedAt: meta.updatedAt || stat.mtime.toISOString() };
      if ((meta.id !== undefined && meta.id !== id) || row.hash !== digest || row.raw !== raw ||
        stableJSON(JSON.parse(row.json)) !== stableJSON(fresh)) throw new Error('disk/index mismatch');
      return includeRaw === true ? { ...fresh, raw } : fresh;
    } catch {
      fail('磁盘内容与保存索引不一致，尚未通过完整性核验；已保留现有文件。', 'PERSISTED_MISMATCH', 409);
    }
  }
  list() { this.assertAvailable(); return this.db.prepare('SELECT json FROM notes ORDER BY rowid DESC').all().map(r => JSON.parse(r.json)); }
  version(row, reason) {
    if (!row) return;
    this.db.prepare('INSERT INTO versions VALUES(?,?,?,?,?,?,?)').run(randomUUID(), row.id, row.path, row.hash, row.raw, reason, now());
  }
  index(id, body) {
    const previous = this.db.prepare('SELECT * FROM index_chunks WHERE noteId=?').all(id);
    const reusable = new Map();
    for (const chunk of previous) if (!reusable.has(chunk.body) || chunk.vector !== null) reusable.set(chunk.body, chunk);
    const keep = new Set();
    const insert = this.db.prepare(`INSERT INTO index_chunks(id,noteId,body,vector,model) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,vector=excluded.vector,model=excluded.model
      WHERE index_chunks.body IS NOT excluded.body OR index_chunks.vector IS NOT excluded.vector OR index_chunks.model IS NOT excluded.model`);
    for (let i = 0; i < body.length; i += 700) {
      const chunkId = `${id}:${i}`, text = body.slice(i, i + 900), old = reusable.get(text);
      keep.add(chunkId); insert.run(chunkId, id, text, old?.vector ?? null, old?.model ?? null);
    }
    for (const chunk of previous) if (!keep.has(chunk.id)) this.db.prepare('DELETE FROM index_chunks WHERE id=?').run(chunk.id);
  }
  missingEmbeddings({ model, noteIds } = {}) {
    const selected = noteIds ? new Set(noteIds) : null;
    return this.db.prepare('SELECT * FROM index_chunks WHERE vector IS NULL OR model IS NULL OR model != ? ORDER BY noteId,id').all(model ?? '')
      .filter(chunk => (!selected || selected.has(chunk.noteId)) && (model !== undefined || chunk.vector === null));
  }
  upsert(file, raw, id, parsed, { versionedHash } = {}) {
    const { meta, body } = parsed || parse(raw);
    const existing = this.row(id), digest = hash(raw);
    const cleanMeta = Object.fromEntries(Object.entries(meta).filter(([key]) => !reserved.has(key)));
    const note = { id, kind: meta.kind || 'knowledge', title: String(meta.title || path.basename(file, '.md')), body, meta: cleanMeta, hash: digest, path: path.relative(this.vaultDir, file).replaceAll('\\', '/'), updatedAt: meta.updatedAt || fs.statSync(file).mtime.toISOString() };
    if (!folders[note.kind]) note.kind = 'knowledge';
    if (existing?.hash === digest && existing.path === note.path && existing.raw === raw && existing.json === JSON.stringify(note)) return note;
    // A controlled write already saved this exact before-image. Scans and any
    // different indexed version must still retain their own history event.
    if (existing && existing.hash !== digest && existing.hash !== versionedHash) this.version(existing, '外部修改或历史版本');
    this.db.prepare('INSERT INTO notes VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET path=excluded.path,hash=excluded.hash,raw=excluded.raw,json=excluded.json').run(id, note.path, digest, raw, JSON.stringify(note));
    if (!existing || existing.hash !== digest) { this.index(id, `${note.title}\n${body}`); this.put('changed', id, { id, hash: digest, at: now() }); }
    return note;
  }
  ensureFresh({ freshFrontmatter = false } = {}) {
    // Metadata is checked on every search, independent of lossy/asynchronous OS
    // watch delivery. A full hash reconciliation also catches preserved stamps.
    return this.scan({ incremental: Date.now() - this.lastFullScan < 60_000, freshFrontmatter });
  }
  scan({ dryRun = false, incremental = false, freshFrontmatter = false } = {}) {
    this.assertAvailable();
    if (!fs.existsSync(this.vaultDir) || fs.lstatSync(this.vaultDir).isSymbolicLink()) fail('Vault 根目录不存在或已被替换为链接。', 'SYMLINK', 403);
    const files = [], conflicts = [], seen = new Map(), valid = [], cache = new Map();
    let readFiles = 0;
    const walk = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (entry.name.toLowerCase().endsWith('.md')) {
          const stat = fs.statSync(file, { bigint: true });
          if (stat.size <= 5_000_000n) files.push({ file, fingerprint: [stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].join(':') });
        }
      }
    };
    walk(this.vaultDir);
    const previous = this.db.prepare('SELECT id,path,hash FROM notes').all();
    const byPath = new Map(previous.map(row => [row.path, row])), byHash = new Map();
    for (const row of previous) { const matches=byHash.get(row.hash)||[];matches.push(row);byHash.set(row.hash,matches); }
    for (const { file, fingerprint } of files) {
      const rel = path.relative(this.vaultDir, file).replaceAll('\\', '/');
      try {
        const cached = incremental && this.scanCache.get(file);
        let unchanged = cached?.fingerprint === fingerprint;
        if (unchanged && freshFrontmatter) unchanged = unchangedFrontmatter(file, cached.raw, this.vaultDir);
        let raw, parsed;
        if (unchanged) ({ raw, parsed } = cached);
        else { raw = fs.readFileSync(assertTree(file, this.vaultDir), 'utf8'); readFiles++; parsed = parse(raw); }
        let id = parsed.meta.id;
        if (id !== undefined && (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id))) fail('id 必须为短字符串。');
        const missing = !id && !byPath.has(rel) ? (byHash.get(hash(raw))||[]).filter(row=>!fs.existsSync(path.join(this.vaultDir,row.path))) : [];
        id ||= byPath.get(rel)?.id || (missing.length===1 ? missing[0].id : null) || (!freshFrontmatter && cached?.id) || randomUUID();
        if (seen.has(id)) conflicts.push({ path: rel, id, error: '重复稳定 id；两个文件暂时从检索中隔离。', other: seen.get(id) });
        seen.set(id, rel); valid.push({ id, file, raw, parsed, unchanged });
        cache.set(file, { fingerprint, raw, parsed, id });
      } catch (error) { conflicts.push({ path: rel, error: error.message }); }
    }
    const duplicates = new Set(conflicts.filter(c => c.id).map(c => c.id));
    const accepted = valid.filter(v => !duplicates.has(v.id));
    if (dryRun) {
      for (const entry of accepted) {
        try { validateBackupMarkdown(entry.raw, entry.id); }
        catch (error) { conflicts.push({ path: path.relative(this.vaultDir, entry.file).replaceAll('\\', '/'), error: error.message }); }
      }
      return { count: accepted.length, conflicts, paths: accepted.map(entry => path.relative(this.vaultDir, entry.file).replaceAll('\\', '/')) };
    }
    const currentIds = new Set(accepted.map(v => v.id));
    const acceptedById = new Map(accepted.map(v => [v.id, v]));
    const previousById = new Map(previous.map(row => [row.id, row]));
    let changed = false;
    // Remove stale paths first so external moves/swaps do not hit path uniqueness.
    this.db.exec('SAVEPOINT vault_scan');
    try {
      for (const row of previous) {
        const current = acceptedById.get(row.id);
        if (!currentIds.has(row.id) || row.path !== path.relative(this.vaultDir, current.file).replaceAll('\\', '/')) {
          changed = true;
          if (!currentIds.has(row.id)) this.version(this.row(row.id), '文件移除或冲突隔离');
          this.db.prepare('DELETE FROM notes WHERE id=?').run(row.id);
          if (!currentIds.has(row.id)) this.db.prepare('DELETE FROM index_chunks WHERE noteId=?').run(row.id);
        }
      }
      for (const entry of accepted) {
        const prior = previousById.get(entry.id);
        if (!entry.unchanged || !prior || prior.path !== path.relative(this.vaultDir, entry.file).replaceAll('\\', '/')) {
          const before = this.searchIndex?.revision();
          this.upsert(entry.file, entry.raw, entry.id, entry.parsed);
          changed ||= before !== this.searchIndex?.revision();
        }
      }
      const blocked = new Set(previous.filter(row => conflicts.some(c => c.id === row.id || c.path === row.path || c.other === row.path)).map(row => row.id));
      if (!incremental || changed || JSON.stringify(conflicts) !== JSON.stringify(this.conflicts.filter(c => c.type !== 'mirror'))) this.syncMirrors(conflicts, blocked);
      this.db.exec('RELEASE vault_scan');
    } catch (error) { this.db.exec('ROLLBACK TO vault_scan; RELEASE vault_scan'); throw error; }
    this.scanCache = cache;
    if (!incremental) this.lastFullScan = Date.now();
    return { count: accepted.length, conflicts: this.conflicts, mode: incremental ? 'incremental' : 'full', checkedFiles: files.length, readFiles };
  }
  syncMirrors(conflicts = this.conflicts.filter(item => item.type !== 'mirror'), blocked = new Set()) {
    const notes = this.list(), byId = new Map(notes.map(note => [note.id, note])), claims = new Map();
    const owners = new Map(this.records('vaultRelations').map(item => [item.id, item]));
    for (const owner of owners.values()) for (const entry of owner.ownerPaths || []) {
      if (conflicts.some(item => item.id === entry.id || item.path === entry.path || item.other === entry.path)) blocked.add(entry.id);
    }
    const issue = (note, error, extra = {}) => conflicts.push({ type: 'mirror', path: note?.path || '', error, ...extra });
    for (const note of notes) {
      if (note.kind === 'topic') {
        const noteIds = note.meta.noteIds ?? [], paused = note.meta.paused ?? false;
        if (!Array.isArray(noteIds) || noteIds.some(id => typeof id !== 'string') || typeof paused !== 'boolean') {
          issue(note, '主题的 noteIds 或 paused 属性无效；未覆盖已有调度镜像。');
        } else this.put('topics', note.id, { ...this.get('topics', note.id, {}), id: note.id, noteIds: [...new Set(noteIds)], paused });
      }
      if (note.meta.relations === undefined) continue;
      if (!Array.isArray(note.meta.relations)) { issue(note, 'relations 必须是已确认关系的列表。'); blocked.add(note.id); continue; }
      for (const relation of note.meta.relations) {
        if (!relation || typeof relation !== 'object' || typeof relation.id !== 'string' || !relation.id ||
          typeof relation.fromId !== 'string' || typeof relation.toId !== 'string' || relation.fromId === relation.toId ||
          ![relation.fromId, relation.toId].includes(note.id) || ![undefined, 'accepted'].includes(relation.state)) {
          issue(note, '关系属性无效或并非已确认关系；未当作可用联系。'); blocked.add(note.id); continue;
        }
        const entries = claims.get(relation.id) || [];
        entries.push({ note, relation }); claims.set(relation.id, entries);
      }
    }
    for (const topic of this.records('topics')) if (!byId.has(topic.id) && !blocked.has(topic.id)) this.remove('topics', topic.id);
    for (const [id, entries] of claims) {
      const relation = entries[0].relation, ownerIds = [...new Set(entries.map(entry => entry.note.id))];
      const conflict = entries.some(entry => stableJSON(entry.relation) !== stableJSON(relation));
      const missing = !byId.has(relation.fromId) || !byId.has(relation.toId);
      const message = conflict ? '同一关系在多个笔记中的定义不一致；请检查原文件。' : missing ? '确认关系引用的笔记已删除或被冲突隔离。' : '';
      const mirrored = { ...this.get('relations', id, {}), ...relation, state: conflict ? 'conflict' : missing ? 'orphaned' : 'accepted', vaultOwnerIds: ownerIds };
      delete mirrored.vaultRemovedAt; delete mirrored.mirrorConflict;
      if (message) { mirrored.mirrorConflict = message; issue(entries[0].note, message, { relationId: id }); }
      this.put('relations', id, mirrored);
      this.put('vaultRelations', id, { id, ownerIds, ownerPaths: entries.map(entry => ({ id: entry.note.id, path: entry.note.path })) });
    }
    for (const relation of this.records('relations')) {
      if (claims.has(relation.id) || !['accepted', 'conflict', 'orphaned'].includes(relation.state)) continue;
      const prior = owners.get(relation.id), unavailable = prior?.ownerIds.some(id => blocked.has(id) || (!byId.has(id) && conflicts.some(item => item.type !== 'mirror')));
      if (prior && !unavailable) {
        this.put('relations', relation.id, { ...relation, state: 'rejected', vaultRemovedAt: relation.vaultRemovedAt || now(), mirrorConflict: null });
      } else {
        const message = unavailable ? '确认关系所属文件存在冲突，未覆盖或删除原关系。' : '数据库中的确认关系没有对应的 Vault 记录；请检查原笔记。';
        this.put('relations', relation.id, { ...relation, state: 'conflict', mirrorConflict: message });
        issue(byId.get(relation.fromId), message, { relationId: relation.id });
      }
    }
    this.conflicts = conflicts;
  }
  outboundPrivacy(noteOrId) {
    const visited = new Set();
    const visit = (id, expectedHash) => {
      if (typeof id !== 'string' || !id) return 'local';
      if (visited.has(id)) return 'cloud';
      const row = this.row(id);
      if (!row) return 'local';
      let meta, body;
      try {
        const file = assertTree(path.resolve(this.vaultDir, row.path), this.vaultDir);
        if (fs.lstatSync(this.vaultDir).isSymbolicLink()) return 'local';
        const raw = fs.readFileSync(file, 'utf8');
        if (expectedHash && hash(raw) !== expectedHash) return 'local';
        ({ meta, body } = parse(raw));
      } catch { return 'local'; }
      // Legacy privacy is retained in Markdown for rollback, but is no longer a material classification.
      if (meta.id !== undefined && meta.id !== id) return 'local';
      const ids = meta.managedLinkIds ?? [], start = body.indexOf(linkStart), end = body.indexOf(linkEnd);
      if (!Array.isArray(ids) || ids.some(target => typeof target !== 'string' || !target)) return 'local';
      if (meta.managedLinksHash || ids.length || start !== -1 || end !== -1) {
        if (!meta.managedLinksHash || !Array.isArray(meta.managedLinkIds) || !ids.length || start === -1 || end < start ||
          body.indexOf(linkStart, start + linkStart.length) !== -1 || body.indexOf(linkEnd, end + linkEnd.length) !== -1 ||
          hash(body.slice(start, end + linkEnd.length)) !== meta.managedLinksHash) return 'local';
      }
      const targets = new Set(ids);
      if (meta.kind === 'topic') {
        if (meta.noteIds !== undefined && !Array.isArray(meta.noteIds)) return 'local';
        for (const target of meta.noteIds || []) targets.add(target);
      }
      if (meta.relations !== undefined && !Array.isArray(meta.relations)) return 'local';
      for (const relation of meta.relations || []) {
        if (!relation || ![undefined, 'accepted'].includes(relation.state) || ![relation.fromId, relation.toId].includes(id)) return 'local';
        targets.add(relation.fromId === id ? relation.toId : relation.fromId);
      }
      for (const relation of this.records('relations')) {
        if (!relation.vaultOwnerIds?.includes(id) && relation.fromId !== id) continue;
        if (['conflict', 'orphaned'].includes(relation.state)) return 'local';
        if (relation.state === 'accepted') targets.add(relation.fromId === id ? relation.toId : relation.fromId);
      }
      visited.add(id);
      for (const target of targets) if (visit(target) !== 'cloud') return 'local';
      return 'cloud';
    };
    return visit(typeof noteOrId === 'string' ? noteOrId : noteOrId?.id, typeof noteOrId === 'string' ? undefined : noteOrId?.hash);
  }
  managedLinksPreview(id, { scan = true } = {}) {
    if (scan) this.scan();
    const note = this.read(id), before = note.body;
    const rows = [], seen = new Set(), labels = { analogy: '类比', prerequisite: '前置知识', support: '支持', oppose: '反对', example: '例子', counterexample: '反例', application: '应用', correction: '修正', similarity: '相关材料' };
    // Compatibility metadata only: a rollback must not broaden an older app's permission.
    let rollbackLocal = false;
    const plain = value => String(value || '').replace(/[\r\n<>]/g, ' ');
    const link = target => `[[${target.path.replace(/\.md$/i, '')}|${plain(target.title).replace(/[\[\]|]/g, ' ')}]]`;
    const failPreview = message => ({ id, path: note.path, expectedHash: note.hash, before, body: before, meta: {}, changed: false, conflict: message });
    for (const relation of this.records('relations').filter(item => item.state === 'accepted' && item.vaultOwnerIds?.includes(id))) {
      const targetId = relation.fromId === id ? relation.toId : relation.fromId;
      if (!this.row(targetId)) continue;
      const target = this.read(targetId);
      rollbackLocal ||= target.meta.privacy !== 'cloud';
      if (/[\[\]|#^\r\n]/.test(target.path)) return failPreview('目标文件名包含 Obsidian 链接保留符号，请先调整文件名。');
      rows.push(`- ${link(target)} — ${labels[relation.type] || plain(relation.type) || '已确认联系'}${relation.explanation ? `：${plain(relation.explanation)}` : ''}${relation.use ? `；用途：${plain(relation.use)}` : ''}${relation.boundary ? `；边界：${plain(relation.boundary)}` : ''}`);
      seen.add(targetId);
    }
    if (note.kind === 'topic' && Array.isArray(note.meta.noteIds)) for (const targetId of note.meta.noteIds) {
      if (seen.has(targetId) || !this.row(targetId)) continue;
      const target = this.read(targetId);
      rollbackLocal ||= target.meta.privacy !== 'cloud';
      if (/[\[\]|#^\r\n]/.test(target.path)) return failPreview('目标文件名包含 Obsidian 链接保留符号，请先调整文件名。');
      rows.push(`- ${link(target)}`); seen.add(targetId);
    }
    const start = before.indexOf(linkStart), end = before.indexOf(linkEnd);
    const hasBlock = start !== -1 || end !== -1;
    if (hasBlock && (start === -1 || end < start || before.indexOf(linkStart, start + linkStart.length) !== -1 || before.indexOf(linkEnd, end + linkEnd.length) !== -1)) return failPreview('自动链接区标记不完整或重复，请先核对该笔记。');
    const oldBlock = hasBlock ? before.slice(start, end + linkEnd.length) : '';
    if (hasBlock && (!note.meta.managedLinksHash || hash(oldBlock) !== note.meta.managedLinksHash)) return failPreview('自动链接区曾被外部修改，已保留原文；请人工核对后再更新。');
    if (!hasBlock && note.meta.managedLinksHash) return failPreview('自动链接区已被外部移除，未重新写回。');
    const block = rows.length ? `${linkStart}\n## 已确认的知识链接\n\n${rows.join('\n')}\n${linkEnd}` : '';
    const body = hasBlock ? `${before.slice(0, start)}${block}${before.slice(end + linkEnd.length)}` : block ? `${before}\n\n${block}` : before;
    const managedLinkIds = [...seen], referencesChanged = stableJSON(note.meta.managedLinkIds || []) !== stableJSON(managedLinkIds);
    return { id, path: note.path, expectedHash: note.hash, before, body, meta: { managedLinksHash: block ? hash(block) : null, managedLinkIds, ...(rollbackLocal ? { privacy: 'local' } : {}) }, changed: body !== before || rollbackLocal && note.meta.privacy === 'cloud' || referencesChanged, conflict: null };
  }
  pendingManagedLinks() {
    this.scan();
    return this.list().filter(note => note.meta.managedLinksHash || note.meta.relations?.length || (note.kind === 'topic' && note.meta.noteIds?.length))
      .map(note => this.managedLinksPreview(note.id, { scan: false })).filter(preview => preview.changed || preview.conflict);
  }
  syncManagedLinks(id, { expectedHash } = {}) {
    const preview = this.managedLinksPreview(id);
    if (!expectedHash || preview.expectedHash !== expectedHash) fail('链接预览后笔记已变化，请重新检查。', 'CONFLICT', 409);
    if (preview.conflict) fail(preview.conflict, 'MANAGED_LINK_CONFLICT', 409);
    if (!preview.changed) return this.read(id);
    return this.update(id, { expectedHash, body: preview.body, meta: preview.meta });
  }
  create({ id = randomUUID(), kind = 'knowledge', title, body, meta = {}, exclusive = false }) {
    if (!folders[kind]) fail('不支持的知识文件类型。');
    if (!String(title || '').trim() || !String(body || '').trim()) fail('标题和正文不能为空。');
    if (this.row(id)) fail('内容 id 已存在。', 'CONFLICT', 409);
    const file = assertTree(path.join(this.vaultDir, folders[kind], `${id}.md`), this.vaultDir);
    const fields = { ...meta, id, kind, title: String(title).slice(0, 200), createdAt: now(), updatedAt: now() };
    const raw = serialize('', fields, String(body));
    try { if (exclusive) atomicWriteExclusive(file, raw); else atomicWrite(file, raw); }
    catch (error) { if (exclusive && error.code === 'EEXIST') fail('目标文件已被占用，未覆盖已有内容。', 'CONFLICT', 409); throw error; }
    const result = this.upsert(file, raw, id); this.version(this.row(id), kind === 'source' ? '原始输入快照' : '首次创建'); this.syncMirrors(); return result;
  }
  update(id, { body, title, meta = {}, expectedHash }) {
    this.scan(); const old = this.row(id), note = this.read(id);
    if (!expectedHash || note.hash !== expectedHash) fail('文件已发生变化。请查看当前版本，再合并你的修改。', 'CONFLICT', 409);
    const file = assertTree(path.resolve(this.vaultDir, old.path), this.vaultDir);
    if (hash(fs.readFileSync(file)) !== expectedHash) fail('外部编辑冲突，未覆盖文件。', 'CONFLICT', 409);
    const safeMeta = Object.fromEntries(Object.entries(meta).filter(([key]) => !reserved.has(key)));
    const raw = serialize(old.raw, { ...safeMeta, id, kind: note.kind, title: title ?? note.title, updatedAt: now() }, body ?? note.body);
    this.version(old, 'Web 修改前'); atomicWrite(file, raw); const result = this.upsert(file, raw, id, undefined, { versionedHash: old.hash }); this.syncMirrors(); return result;
  }
  beginFileOperation(id, relative, { operationId = randomUUID(), kind, beforeHash = null, afterHash = null, undoId = null } = {}) {
    if (this.get('fileRecovery', operationId)) fail('文件操作已有恢复记录，须核对后继续。', 'FILE_OPERATION_PENDING', 409);
    const holdingPath = path.join(path.dirname(relative), `.zhixu-recovery-${randomUUID()}.raw`).replaceAll('\\', '/');
    const operation = { id: operationId, noteId: id, path: relative, holdingPath, kind, beforeHash, afterHash, undoId, state: 'prepared', createdAt: now() };
    this.put('fileRecovery', operation.id, operation);
    return operation;
  }
  claimFile(operation, code) {
    const file = assertTree(path.resolve(this.vaultDir, operation.path), this.vaultDir);
    const holding = assertTree(path.resolve(this.vaultDir, operation.holdingPath), this.vaultDir);
    // Move the actual occupant first, then inspect those claimed bytes. Never unlink
    // or replace a file merely because an earlier read matched. Retain the claim
    // even after success: an editor holding the old inode may still save to it.
    fs.renameSync(file, holding);
    const stat = fs.lstatSync(holding);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || hash(fs.readFileSync(holding)) !== operation.beforeHash) {
      this.preserveFileClaim(operation);
      fail('原子接管时发现外部修改，原文件或恢复副本已保留，未覆盖或删除新内容。', code, 409);
    }
    this.put('fileRecovery', operation.id, { ...operation, state: 'claimed' });
  }
  preserveFileClaim(operation) {
    const file = assertTree(path.resolve(this.vaultDir, operation.path), this.vaultDir);
    const holding = assertTree(path.resolve(this.vaultDir, operation.holdingPath), this.vaultDir);
    if (fs.existsSync(holding)) {
      try { fs.linkSync(holding, file); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    this.put('fileRecovery', operation.id, { ...operation, state: 'preserved' });
  }
  completeFileOperation(operation) {
    const versions = this.history(operation.noteId).map(version =>
      [version.versionId, version.path, version.hash, version.reason, version.createdAt]).toSorted((a, b) => a[0].localeCompare(b[0]));
    this.put('fileRecovery', operation.id, { ...operation, state: 'complete', versions, completedAt: now() });
  }
  delete(id, expectedHash, { operationId, undoId = null } = {}) {
    this.scan(); const row = this.row(id); this.read(id);
    if (!expectedHash || expectedHash !== row.hash) fail('删除前检测到版本变化。', 'CONFLICT', 409);
    this.version(row, '用户删除');
    const file = assertTree(path.join(this.vaultDir, row.path), this.vaultDir);
    if (hash(fs.readFileSync(file)) !== expectedHash) fail('版本审计期间文件发生变化，未删除新内容。', 'CONFLICT', 409);
    const operation = this.beginFileOperation(id, row.path, { operationId, kind: 'recycle', beforeHash: expectedHash, undoId });
    this.claimFile(operation, 'CONFLICT');
    this.db.prepare('DELETE FROM notes WHERE id=?').run(id); this.db.prepare('DELETE FROM index_chunks WHERE noteId=?').run(id);
    this.remove('changed', id); this.put('deleted', id, { id, deletedAt: now(), operationId: operation.id,
      ...(undoId ? { chatgptUndoId: undoId, rawSha256: expectedHash } : {}) });
    this.syncMirrors(); this.completeFileOperation(operation); return { deleted: true };
  }
  history(id) { this.assertAvailable(); return this.db.prepare('SELECT id as versionId,noteId,path,hash,raw,reason,createdAt FROM versions WHERE noteId=? ORDER BY createdAt DESC').all(id); }
  deletedNotes() {
    this.scan();
    return this.records('deleted').flatMap(item=>{
      if(this.row(item.id))return [];
      const version=this.history(item.id)[0];if(!version)return [];
      const note=parse(version.raw);
      // Sources retain their dedicated recycle-bin recovery and purge boundary.
      return note.meta.kind==='knowledge'?[{id:item.id,title:note.meta.title,deletedAt:item.deletedAt,versionId:version.versionId}]:[];
    });
  }
  restoreVersion(id, versionId, expectedHash) {
    const version = this.db.prepare('SELECT * FROM versions WHERE id=? AND noteId=?').get(versionId, id);
    if (!version) fail('找不到历史版本。', 'NOT_FOUND', 404);
    const parsed = parse(version.raw);
    if (this.row(id)) return this.update(id, { body: parsed.body, title: parsed.meta.title, meta: parsed.meta, expectedHash });
    // A missing index entry is not proof that the file or its stable identity is free.
    this.scan();
    if (this.row(id) || this.conflicts.some(conflict => conflict.id === id || conflict.path === version.path)) fail('恢复目标已存在或存在文件冲突，请刷新后核对。', 'CONFLICT', 409);
    if (expectedHash) fail('已删除文件恢复不应携带现行哈希。', 'CONFLICT', 409);
    const result = this.create({ id, kind: parsed.meta.kind, title: parsed.meta.title, body: parsed.body, meta: parsed.meta, exclusive: true });
    this.remove('deleted', id);
    return result;
  }
  restoreVersionExact(id, versionId, { expectedHash, expectMissing = false, operationId } = {}) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id || '') || typeof versionId !== 'string' ||
      (expectMissing ? expectedHash !== undefined : !/^[a-f0-9]{64}$/.test(expectedHash || ''))) {
      fail('精确恢复必须指定已有版本和当前文件版本，或明确要求文件缺失。', 'EXACT_RESTORE_INVALID', 409);
    }
    const version = this.db.prepare('SELECT * FROM versions WHERE id=? AND noteId=?').get(versionId, id);
    if (!version || hash(version.raw) !== version.hash) fail('恢复所需的原始版本缺失或无法核对。', 'EXACT_RESTORE_UNAVAILABLE', 409);
    const parsed = parse(version.raw);
    if (parsed.meta.id !== id || !folders[parsed.meta.kind]) fail('原始版本的身份无法核对。', 'EXACT_RESTORE_INVALID', 409);
    this.scan();
    const row = this.row(id);
    if (this.conflicts.some(conflict => conflict.id === id || conflict.path === version.path)) fail('恢复目标存在文件冲突。', 'EXACT_RESTORE_CONFLICT', 409);
    const file = assertTree(path.resolve(this.vaultDir, version.path), this.vaultDir);
    if (expectMissing) {
      if (row || fs.existsSync(file)) fail('原位置已被使用，未覆盖新内容。', 'EXACT_RESTORE_CONFLICT', 409);
    } else {
      if (!row || row.path !== version.path || row.hash !== expectedHash || this.readPersisted(id).hash !== expectedHash) {
        fail('恢复前当前文件或路径发生变化，未覆盖。', 'EXACT_RESTORE_CONFLICT', 409);
      }
      this.version(row, '受限撤销或恢复前原始版本');
    }
    // Recheck after the audit write; an external save during it must be retained.
    if (expectMissing ? this.row(id) || fs.existsSync(file) : this.readPersisted(id).hash !== expectedHash) {
      fail('版本审计期间文件发生变化，未覆盖。', 'EXACT_RESTORE_CONFLICT', 409);
    }
    const operation = this.beginFileOperation(id, version.path, { operationId, kind: 'restore', beforeHash: expectedHash ?? null, afterHash: version.hash });
    if (!expectMissing) this.claimFile(operation, 'EXACT_RESTORE_CONFLICT');
    try { atomicWriteExclusive(file, version.raw); }
    catch (error) {
      if (!expectMissing) this.preserveFileClaim(operation);
      if (error.code === 'EEXIST') fail('恢复位置已被占用，未覆盖已有内容；原件仍在恢复记录中。', 'EXACT_RESTORE_CONFLICT', 409);
      throw error;
    }
    const result = this.upsert(file, version.raw, id, parsed);
    this.version(this.row(id), '受限精确恢复后的原始版本');
    this.remove('deleted', id);
    this.syncMirrors();
    if (this.readPersisted(id).hash !== version.hash) fail('精确恢复后的磁盘核验未完成。', 'EXACT_RESTORE_VERIFY_FAILED', 409);
    this.completeFileOperation(operation);
    return result;
  }
  backup() {
    this.scan();
    if (this.conflicts.length) fail('Vault 中仍有冲突或无法解析的 Markdown；为避免静默遗漏，修复后再备份。', 'BACKUP_CONFLICT', 409);
    const backup = includeAttachments(this.vaultDir, { format: 'learning-workbench-backup', version: 1, ...(this.backupPurpose ? { purpose: this.backupPurpose } : {}), createdAt: now(), scope: { managedMarkdown: true, runtimeRecords: true, attachments: false, obsidianConfig: false }, notes: this.db.prepare('SELECT id,path,raw FROM notes').all(), records: this.db.prepare("SELECT * FROM records WHERE namespace NOT IN ('settings','changed','restore','attachmentUploads')").all(), versions: this.db.prepare('SELECT * FROM versions').all() });
    this.validateBackup(backup);
    return backup;
  }
  validateBackup(backup) {
    if (!backupObject(backup) || backup.format !== 'learning-workbench-backup' || ![1,2].includes(backup.version) || !Array.isArray(backup.notes) || !Array.isArray(backup.records) || !Array.isArray(backup.versions)) fail('备份格式不正确。');
    assertBackupSize(backup);
    if (backup.purpose !== this.backupPurpose) fail('备份用途与当前知识库不一致。', 'BACKUP_PURPOSE_MISMATCH', 409);
    if (backup.preferences !== undefined && !backupObject(backup.preferences)) fail('备份偏好设置必须为键值对象。');
    if (backup.createdAt !== undefined && (typeof backup.createdAt !== 'string' || !Number.isFinite(Date.parse(backup.createdAt)))) fail('备份创建时间无效。');
    if (backup.scope !== undefined && (!backupObject(backup.scope) || backup.scope.managedMarkdown !== true || backup.scope.runtimeRecords !== true || backup.scope.attachments !== (backup.version === 2) || backup.scope.obsidianConfig !== false)) fail('备份范围无效；此格式仅支持受管理 Markdown 和运行记录。');
    const validId = validBackupId;
    const validatePath = value => {
      validateBackupPath(value);
      const parts = value.split('/');
      const target = path.resolve(this.vaultDir, ...parts);
      assertTree(target, this.vaultDir);
      return { normalized: parts.join('/'), target };
    };
    const ids = new Set(), paths = new Set();
    for (const item of backup.notes) {
      if (!backupObject(item) || !validId(item.id)) fail('备份包含非法 Markdown。');
      const checkedPath = validatePath(item.path);
      const pathKey = checkedPath.normalized.toLowerCase();
      if (ids.has(item.id) || paths.has(pathKey)) fail('备份包含重复身份或路径。');
      validateBackupMarkdown(item.raw, item.id);
      ids.add(item.id); paths.add(pathKey);
    }
    const recordKeys = new Set(), billing = new Map();
    for (const r of backup.records) {
      const value = validateBackupRecord(r);
      if (['calls','callLedger','callResults'].includes(r.namespace)) billing.set(`${r.namespace}:${r.key}`, value);
      const recordKey = `${r.namespace}\0${r.key}`;
      if (recordKeys.has(recordKey)) fail('备份包含重复运行记录。');
      recordKeys.add(recordKey);
    }
    for (const row of backup.records.filter(item => item.namespace === 'callLedger')) {
      const ledger = billing.get(`callLedger:${row.key}`), response = billing.get(`callResults:${row.key}`);
      const call = billing.get(`calls:${row.key}`);
      if (ledger.phase !== 'cancelled' && !call) fail('备份调用账本缺少对应的预算记账记录。');
      if (['received','accounted'].includes(ledger.phase) && (!response || response.entry.capability !== ledger.capability || response.entry.model !== ledger.model)) fail('备份调用账本缺少对应的完整响应证据。');
      if (ledger.phase === 'accounted' && call.cost !== response.entry.cost) fail('备份调用费用与已记账响应不一致。');
    }
    const versionIds = new Set();
    for (const version of backup.versions) {
      if (!version || typeof version !== 'object' || !validId(version.id) || !validId(version.noteId) || versionIds.has(version.id)) fail('备份历史版本身份无效或重复。');
      validatePath(version.path);
      if (typeof version.raw !== 'string' || Buffer.byteLength(version.raw) > BACKUP_ITEM_MAX_BYTES || typeof version.hash !== 'string' || !/^[a-f0-9]{64}$/.test(version.hash) || hash(version.raw) !== version.hash) fail('备份历史版本内容或哈希无效。');
      validateBackupMarkdown(version.raw, version.noteId);
      if (typeof version.reason !== 'string' || !version.reason.trim() || version.reason.length > 4_000 || typeof version.createdAt !== 'string' || version.createdAt.length > 100 || !Number.isFinite(Date.parse(version.createdAt))) fail('备份历史版本说明或时间无效。');
      versionIds.add(version.id);
    }
    // Exercise the same mirror reconstruction against an isolated SQLite database.
    // No live files or records change while rejecting an inconsistent candidate.
    const candidate = Object.create(Store.prototype);
    candidate.db = new DatabaseSync(':memory:'); candidate.conflicts = [];
    try {
      candidate.db.exec('CREATE TABLE records(namespace TEXT,key TEXT,json TEXT,PRIMARY KEY(namespace,key)); CREATE TABLE notes(json TEXT);');
      for (const row of backup.records) candidate.put(row.namespace, row.key, JSON.parse(row.json));
      for (const item of backup.notes) {
        const { meta, body } = parse(item.raw);
        candidate.db.prepare('INSERT INTO notes VALUES(?)').run(JSON.stringify({ id: item.id, path: item.path, kind: meta.kind || 'knowledge', title: meta.title || path.basename(item.path, '.md'), body, meta }));
      }
      candidate.syncMirrors([]);
      if (candidate.conflicts.length) fail('备份包含不一致的主题或关系镜像；请先在原知识库处理冲突。', 'RESTORE_CONFLICT', 409);
    } finally { candidate.close(); }
    const current = this.scan({ dryRun: true }), currentPaths = new Set(current.paths.map(value => value.toLowerCase()));
    if (current.conflicts.length || this.conflicts.some(item => item.type === 'mirror')) fail('当前 Vault 有冲突或无法解析的 Markdown；恢复前必须先处理，避免遗漏或覆盖。', 'RESTORE_CONFLICT', 409);
    for (const item of backup.notes) {
      const { target } = validatePath(item.path);
      if (fs.existsSync(target) && (!currentPaths.has(item.path.toLowerCase()) || !fs.lstatSync(target).isFile())) fail('恢复目标与未纳入当前索引的文件冲突，未覆盖。', 'RESTORE_CONFLICT', 409);
      let parent = path.dirname(target);
      while (parent !== this.vaultDir) {
        if (fs.existsSync(parent) && !fs.lstatSync(parent).isDirectory()) fail('恢复目标的父路径不是目录。', 'RESTORE_CONFLICT', 409);
        parent = path.dirname(parent);
      }
    }
    validateAttachments(this.vaultDir, backup);
    return { notes: backup.notes.length, records: backup.records.length, versions: backup.versions.length, attachments: backup.attachments?.length || 0, replaces: this.list().length, retention: '恢复前自动备份；JSON 包含受管理 Markdown、运行记录、历史版本及受管理附件；附件按哈希只增补，不覆盖。外部附件、.obsidian 与其他未索引文件不会写入或删除，需另行复制整个 Vault 保存。' };
  }
  restore(backup, { settings } = {}) {
    this.assertAvailable();
    if (fs.readdirSync(this.vaultDir).some(name => name.startsWith('.learning-restore-'))) fail('上一次恢复暂存目录尚未处理；请先核对阶段记录与安全备份。', 'RESTORE_RECOVERY_REQUIRED', 503);
    this.validateBackup(backup);
    if (settings !== undefined && !backupObject(settings)) fail('恢复设置必须为键值对象。');
    if (settings !== undefined) assertBackupSize({ settings });
    const safetyFile = path.join(this.dataDir, 'backups', `before-restore-${Date.now()}-${randomUUID()}.json`);
    const safety = this.backup(), oldSettings = this.get('settings', 'main');
    if (backupObject(oldSettings)) safety.preferences = oldSettings;
    durableWrite(safetyFile, assertBackupSize(safety));
    installAttachments(this.vaultDir, validateAttachments(this.vaultDir, backup));
    const currentRows = this.db.prepare('SELECT * FROM notes').all();
    const currentPaths = new Set(currentRows.map(row => row.path.toLowerCase()));
    const restoreId = randomUUID();
    const stageRoot = assertTree(path.join(this.vaultDir, `.learning-restore-${restoreId}`), this.vaultDir);
    const incomingRoot = path.join(stageRoot, 'incoming');
    const previousRoot = path.join(stageRoot, 'previous');
    const incoming = backup.notes.map(item => ({
      ...item,
      relativePath: item.path.split('/').join(path.sep),
      target: assertTree(path.resolve(this.vaultDir, ...item.path.split('/')), this.vaultDir),
    }));
    const movedCurrent = [], installedIncoming = [];
    const manifestFile = path.join(stageRoot, 'manifest.json');
    const manifest = { format: 'learning-workbench-restore', version: 1, id: restoreId, phase: 'staging', safetyBackup: safetyFile, createdAt: now(), incoming: incoming.map(item => ({ id: item.id, path: item.path, hash: hash(item.raw) })), previous: currentRows.map(row => ({ id: row.id, path: row.path, hash: row.hash })) };
    const checkpoint = phase => { manifest.phase = phase; durableWrite(manifestFile, JSON.stringify(manifest)); };
    let transaction = false, committed = false, rollbackError = null, cleanupPending = null;
    try {
      fs.mkdirSync(stageRoot, { recursive: false });
      checkpoint('staging');
      for (const item of incoming) {
        const staged = assertTree(path.join(incomingRoot, item.relativePath), stageRoot);
        durableWrite(staged, item.raw);
        if (fs.readFileSync(staged, 'utf8') !== item.raw) fail('恢复暂存校验失败。', 'RESTORE_IO');
        if (fs.existsSync(item.target) && !currentPaths.has(item.path.toLowerCase())) fail('恢复目标与未纳入当前索引的文件冲突，未覆盖。', 'RESTORE_CONFLICT', 409);
      }
      for (const row of currentRows) {
        const source = assertTree(path.resolve(this.vaultDir, ...row.path.split('/')), this.vaultDir);
        if (!fs.existsSync(source) || hash(fs.readFileSync(source)) !== row.hash) fail('恢复前检测到外部文件变化，未开始替换。', 'RESTORE_CONFLICT', 409);
      }

      checkpoint('prepared');
      // Bind this plan in SQLite before changing a single managed file. The final
      // flag changes in the same transaction as notes, history, records and settings.
      this.db.prepare('INSERT INTO restore_transactions(id,digest) VALUES(?,?)').run(restoreId, restorePlanDigest(manifest));
      this.db.exec('BEGIN IMMEDIATE'); transaction = true;
      checkpoint('replacing-files');
      for (const row of currentRows) {
        const source = assertTree(path.resolve(this.vaultDir, ...row.path.split('/')), this.vaultDir);
        const staged = assertTree(path.join(previousRoot, ...row.path.split('/')), stageRoot);
        fs.mkdirSync(path.dirname(staged), { recursive: true });
        fs.renameSync(source, staged); movedCurrent.push({ source, staged, hash: row.hash });
      }
      for (const item of incoming) {
        const staged = assertTree(path.join(incomingRoot, item.relativePath), stageRoot);
        fs.mkdirSync(path.dirname(item.target), { recursive: true });
        fs.renameSync(staged, item.target); installedIncoming.push({ target: item.target, hash: hash(item.raw) });
      }

      checkpoint('files-installed');
      const localBillingIds = new Set(this.db.prepare("SELECT key FROM records WHERE namespace IN ('calls','callLedger','callResults')").all().map(row => row.key));
      const localLedger = this.records('callLedger').filter(row => row.phase !== 'cancelled');
      const logicalKeys = new Set(localLedger.map(row => row.key).filter(key => typeof key === 'string' && key));
      const contextKeys = new Set(localLedger.map(row => row.contextKey).filter(key => typeof key === 'string' && key));
      const gradeJobs = new Set([...this.records('jobs'), ...backup.records.filter(row => row.namespace === 'jobs').map(row => JSON.parse(row.json))].filter(job => job.type === 'grade').map(job => job.id));
      const singleRequest = row => row.singleRequest === true || typeof row.turnId === 'string' && !!row.turnId || gradeJobs.has(row.jobId);
      const protectedContexts = new Set(localLedger.filter(row => singleRequest(row) || row.phase === 'resolved_unknown').map(row => row.contextKey).filter(key => typeof key === 'string' && key));
      // A different machine can assign a different attempt ID to the same logical
      // operation. Preserve all three local evidence records as one unit; grading
      // also keeps its original round when the request fingerprint has changed.
      const foreignCollisionIds = new Set(backup.records.filter(row => row.namespace === 'callLedger').map(row => JSON.parse(row.json))
        .filter(row => row.key && logicalKeys.has(row.key) || row.contextKey && (protectedContexts.has(row.contextKey) || singleRequest(row) && contextKeys.has(row.contextKey))).map(row => row.id));
      this.db.exec("DELETE FROM notes; DELETE FROM index_chunks; DELETE FROM records WHERE namespace NOT IN ('settings','restore','calls','callLedger','callResults'); DELETE FROM versions;");
      for (const r of backup.records) {
        if (['calls','callLedger','callResults'].includes(r.namespace) && (localBillingIds.has(r.key) || foreignCollisionIds.has(r.key))) continue;
        this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(namespace,key) DO NOTHING').run(r.namespace, r.key, r.json);
      }
      for (const v of backup.versions) this.db.prepare('INSERT INTO versions VALUES(?,?,?,?,?,?,?)').run(v.id, v.noteId, v.path, v.hash, v.raw, v.reason, v.createdAt);
      for (const item of incoming) this.upsert(item.target, item.raw, item.id, parse(item.raw));
      this.syncMirrors([]);
      if (this.conflicts.length) fail('恢复资料包含无法重建的主题或关系镜像。', 'RESTORE_CONFLICT', 409);
      if (settings !== undefined) this.put('settings', 'main', settings);
      this.db.prepare('UPDATE restore_transactions SET committed=1 WHERE id=? AND digest=?').run(restoreId, restorePlanDigest(manifest));
      this.db.exec('COMMIT'); transaction = false; committed = true;
      checkpoint('database-committed');
    } catch (error) {
      // A committed SQLite transaction cannot be undone by deleting its Markdown.
      if (committed) {
        cleanupPending = stageRoot;
        return { restored: true, safetyBackup: safetyFile, stagingCleanupPending: cleanupPending };
      }
      if (transaction) {
        try { this.db.exec('ROLLBACK'); } catch (rollback) { rollbackError = rollback; }
        transaction = false;
      }
      for (const item of installedIncoming.reverse()) {
        try {
          assertTree(item.target, this.vaultDir);
          if (fs.existsSync(item.target)) {
            if (!fs.lstatSync(item.target).isFile() || hash(fs.readFileSync(item.target)) !== item.hash) fail('回滚目标已有外部修改；保留现场，未覆盖。', 'RESTORE_CONFLICT', 409);
            fs.unlinkSync(item.target);
          }
        } catch (rollback) { rollbackError ||= rollback; }
      }
      for (const item of movedCurrent.reverse()) {
        try {
          fs.mkdirSync(path.dirname(item.source), { recursive: true });
          assertTree(item.source, this.vaultDir); assertTree(item.staged, this.vaultDir);
          if (fs.existsSync(item.source)) {
            if (!fs.lstatSync(item.source).isFile() || hash(fs.readFileSync(item.source)) !== item.hash) fail('回滚原路径已有外部修改；保留现场，未覆盖。', 'RESTORE_CONFLICT', 409);
          } else {
            if (!fs.existsSync(item.staged) || hash(fs.readFileSync(item.staged)) !== item.hash) fail('回滚原件缺失或被修改。', 'RESTORE_CONFLICT', 409);
            fs.renameSync(item.staged, item.source);
          }
        } catch (rollback) { rollbackError ||= rollback; }
      }
      if (rollbackError) {
        const failed = new Error(`恢复失败且自动回滚未完整完成；请使用安全备份或暂存目录恢复。安全备份：${safetyFile}；暂存目录：${stageRoot}`);
        Object.assign(failed, { code: 'RESTORE_ROLLBACK_FAILED', status: 500, cause: error, rollbackError, safetyBackup: safetyFile, recoveryPath: stageRoot });
        this.recoveryBlocked = failed;
        throw failed;
      }
      throw error;
    } finally {
      if (!rollbackError && fs.existsSync(stageRoot)) {
        try {
          fs.rmSync(stageRoot, { recursive: true, force: true });
          this.db.prepare('DELETE FROM restore_transactions WHERE id=?').run(restoreId);
        }
        catch { if (committed) cleanupPending = stageRoot; }
      }
    }
    return { restored: true, safetyBackup: safetyFile, ...(cleanupPending ? { stagingCleanupPending: cleanupPending } : {}) };
  }
  close() { this.db.close(); }
}
