import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import YAML from 'yaml';

export const now = () => new Date().toISOString();
export const hash = value => createHash('sha256').update(value).digest('hex');
export function fail(message, code = 'INVALID', status = 400) {
  const error = new Error(message); Object.assign(error, { code, status }); throw error;
}
export function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(tmp, content, { mode: 0o600 }); fs.renameSync(tmp, file); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
const folders = { source: '01 原始资料', knowledge: '02 知识', mistake: '03 错题修正', topic: '04 主题', report: '05 发现' };
const reserved = new Set(['id', 'kind', 'title', 'createdAt', 'updatedAt']);
function parse(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const doc = YAML.parseDocument(match?.[1] || '{}');
  if (doc.errors.length) fail('Markdown 属性格式错误，请在原文件修正。', 'FRONTMATTER');
  const meta = doc.toJS({ maxAliasCount: 50 }) || {};
  if (typeof meta !== 'object' || Array.isArray(meta)) fail('文件属性必须为键值对象。');
  return { doc, meta, body: match ? raw.slice(match[0].length) : raw };
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
  constructor({ dataDir, vaultDir }) {
    this.dataDir = path.resolve(dataDir); this.vaultDir = path.resolve(vaultDir);
    fs.mkdirSync(this.dataDir, { recursive: true }); fs.mkdirSync(this.vaultDir, { recursive: true });
    if (fs.lstatSync(this.vaultDir).isSymbolicLink()) fail('Vault 根目录不能是链接。');
    this.db = new DatabaseSync(path.join(this.dataDir, 'learning.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY,path TEXT UNIQUE NOT NULL,hash TEXT NOT NULL,raw TEXT NOT NULL,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records (namespace TEXT NOT NULL,key TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(namespace,key));
      CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY,noteId TEXT NOT NULL,path TEXT NOT NULL,hash TEXT NOT NULL,raw TEXT NOT NULL,reason TEXT NOT NULL,createdAt TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS versions_note ON versions(noteId);
      CREATE TABLE IF NOT EXISTS index_chunks (id TEXT PRIMARY KEY,noteId TEXT NOT NULL,body TEXT NOT NULL,vector TEXT,model TEXT);`);
    this.conflicts = []; this.scan();
  }
  get(namespace, key, fallback = null) {
    const row = this.db.prepare('SELECT json FROM records WHERE namespace=? AND key=?').get(namespace, key);
    return row ? JSON.parse(row.json) : fallback;
  }
  put(namespace, key, data) {
    this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET json=excluded.json').run(namespace, key, JSON.stringify(data)); return data;
  }
  records(namespace) { return this.db.prepare('SELECT json FROM records WHERE namespace=? ORDER BY rowid DESC').all(namespace).map(r => JSON.parse(r.json)); }
  remove(namespace, key) { this.db.prepare('DELETE FROM records WHERE namespace=? AND key=?').run(namespace, key); }
  row(id) { return this.db.prepare('SELECT * FROM notes WHERE id=?').get(id); }
  read(id) { const row = this.row(id); if (!row) fail('内容不存在，可能已经删除或存在文件冲突。', 'NOT_FOUND', 404); return JSON.parse(row.json); }
  list() { return this.db.prepare('SELECT json FROM notes ORDER BY rowid DESC').all().map(r => JSON.parse(r.json)); }
  version(row, reason) {
    if (!row) return;
    this.db.prepare('INSERT INTO versions VALUES(?,?,?,?,?,?,?)').run(randomUUID(), row.id, row.path, row.hash, row.raw, reason, now());
  }
  index(id, body) {
    this.db.prepare('DELETE FROM index_chunks WHERE noteId=?').run(id);
    const insert = this.db.prepare('INSERT INTO index_chunks(id,noteId,body) VALUES(?,?,?)');
    for (let i = 0; i < body.length; i += 700) insert.run(`${id}:${i}`, id, body.slice(i, i + 900));
  }
  upsert(file, raw, id, parsed) {
    const { meta, body } = parsed || parse(raw);
    const existing = this.row(id), digest = hash(raw);
    const cleanMeta = Object.fromEntries(Object.entries(meta).filter(([key]) => !reserved.has(key)));
    const note = { id, kind: meta.kind || 'knowledge', title: String(meta.title || path.basename(file, '.md')), body, meta: cleanMeta, hash: digest, path: path.relative(this.vaultDir, file).replaceAll('\\', '/'), updatedAt: meta.updatedAt || fs.statSync(file).mtime.toISOString() };
    if (!folders[note.kind]) note.kind = 'knowledge';
    if (existing && existing.hash !== digest) this.version(existing, '外部修改或历史版本');
    this.db.prepare('INSERT INTO notes VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET path=excluded.path,hash=excluded.hash,raw=excluded.raw,json=excluded.json').run(id, note.path, digest, raw, JSON.stringify(note));
    if (!existing || existing.hash !== digest) { this.index(id, `${note.title}\n${body}`); this.put('changed', id, { id, hash: digest, at: now() }); }
    return note;
  }
  scan() {
    if (!fs.existsSync(this.vaultDir) || fs.lstatSync(this.vaultDir).isSymbolicLink()) fail('Vault 根目录不存在或已被替换为链接。', 'SYMLINK', 403);
    const files = [], conflicts = [], seen = new Map(), valid = [];
    const walk = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (entry.name.toLowerCase().endsWith('.md') && fs.statSync(file).size <= 5_000_000) files.push(file);
      }
    };
    walk(this.vaultDir);
    const previous = this.db.prepare('SELECT * FROM notes').all();
    for (const file of files) {
      const rel = path.relative(this.vaultDir, file).replaceAll('\\', '/');
      try {
        const raw = fs.readFileSync(assertTree(file, this.vaultDir), 'utf8'), parsed = parse(raw);
        let id = parsed.meta.id;
        if (id !== undefined && (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id))) fail('id 必须为短字符串。');
        id ||= previous.find(r => r.path === rel)?.id || previous.find(r => r.hash === hash(raw) && !fs.existsSync(path.join(this.vaultDir, r.path)))?.id || randomUUID();
        if (seen.has(id)) conflicts.push({ path: rel, id, error: '重复稳定 id；两个文件暂时从检索中隔离。', other: seen.get(id) });
        seen.set(id, rel); valid.push({ id, file, raw, parsed });
      } catch (error) { conflicts.push({ path: rel, error: error.message }); }
    }
    const duplicates = new Set(conflicts.filter(c => c.id).map(c => c.id));
    const accepted = valid.filter(v => !duplicates.has(v.id));
    const currentIds = new Set(accepted.map(v => v.id));
    // Remove stale paths first so external moves/swaps do not hit path uniqueness.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of previous) {
        const current = accepted.find(v => v.id === row.id);
        if (!currentIds.has(row.id) || row.path !== path.relative(this.vaultDir, current.file).replaceAll('\\', '/')) {
          if (!currentIds.has(row.id)) this.version(row, '文件移除或冲突隔离');
          this.db.prepare('DELETE FROM notes WHERE id=?').run(row.id);
          this.db.prepare('DELETE FROM index_chunks WHERE noteId=?').run(row.id);
        }
      }
      for (const entry of accepted) this.upsert(entry.file, entry.raw, entry.id, entry.parsed);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    this.conflicts = conflicts; return { count: accepted.length, conflicts };
  }
  create({ id = randomUUID(), kind = 'knowledge', title, body, meta = {} }) {
    if (!folders[kind]) fail('不支持的知识文件类型。');
    if (!String(title || '').trim() || !String(body || '').trim()) fail('标题和正文不能为空。');
    if (this.row(id)) fail('内容 id 已存在。', 'CONFLICT', 409);
    const file = assertTree(path.join(this.vaultDir, folders[kind], `${id}.md`), this.vaultDir);
    const fields = { ...meta, id, kind, title: String(title).slice(0, 200), createdAt: now(), updatedAt: now() };
    const raw = serialize('', fields, String(body)); atomicWrite(file, raw);
    const result = this.upsert(file, raw, id); this.version(this.row(id), kind === 'source' ? '原始输入快照' : '首次创建'); return result;
  }
  update(id, { body, title, meta = {}, expectedHash }) {
    this.scan(); const old = this.row(id), note = this.read(id);
    if (!expectedHash || note.hash !== expectedHash) fail('文件已发生变化。请查看当前版本，再合并你的修改。', 'CONFLICT', 409);
    const file = assertTree(path.resolve(this.vaultDir, old.path), this.vaultDir);
    if (hash(fs.readFileSync(file)) !== expectedHash) fail('外部编辑冲突，未覆盖文件。', 'CONFLICT', 409);
    const safeMeta = Object.fromEntries(Object.entries(meta).filter(([key]) => !reserved.has(key)));
    const raw = serialize(old.raw, { ...safeMeta, id, kind: note.kind, title: title ?? note.title, updatedAt: now() }, body ?? note.body);
    this.version(old, 'Web 修改前'); atomicWrite(file, raw); return this.upsert(file, raw, id);
  }
  delete(id, expectedHash) {
    this.scan(); const row = this.row(id); this.read(id);
    if (!expectedHash || expectedHash !== row.hash) fail('删除前检测到版本变化。', 'CONFLICT', 409);
    this.version(row, '用户删除');
    fs.unlinkSync(assertTree(path.join(this.vaultDir, row.path), this.vaultDir));
    this.db.prepare('DELETE FROM notes WHERE id=?').run(id); this.db.prepare('DELETE FROM index_chunks WHERE noteId=?').run(id);
    this.remove('changed', id); this.put('deleted', id, { id, deletedAt: now() }); return { deleted: true };
  }
  history(id) { return this.db.prepare('SELECT id as versionId,noteId,path,hash,raw,reason,createdAt FROM versions WHERE noteId=? ORDER BY createdAt DESC').all(id); }
  restoreVersion(id, versionId, expectedHash) {
    const version = this.db.prepare('SELECT * FROM versions WHERE id=? AND noteId=?').get(versionId, id);
    if (!version) fail('找不到历史版本。', 'NOT_FOUND', 404);
    const parsed = parse(version.raw);
    if (this.row(id)) return this.update(id, { body: parsed.body, title: parsed.meta.title, meta: parsed.meta, expectedHash });
    if (expectedHash) fail('已删除文件恢复不应携带现行哈希。', 'CONFLICT', 409);
    this.remove('deleted', id);
    return this.create({ id, kind: parsed.meta.kind, title: parsed.meta.title, body: parsed.body, meta: parsed.meta });
  }
  backup() {
    this.scan();
    if (this.conflicts.length) fail('Vault 中仍有冲突或无法解析的 Markdown；为避免静默遗漏，修复后再备份。', 'BACKUP_CONFLICT', 409);
    return { format: 'learning-workbench-backup', version: 1, createdAt: now(), scope: { managedMarkdown: true, runtimeRecords: true, attachments: false, obsidianConfig: false }, notes: this.db.prepare('SELECT id,path,raw FROM notes').all(), records: this.db.prepare("SELECT * FROM records WHERE namespace NOT IN ('settings','changed','restore')").all(), versions: this.db.prepare('SELECT * FROM versions').all() };
  }
  validateBackup(backup) {
    if (backup?.format !== 'learning-workbench-backup' || backup.version !== 1 || !Array.isArray(backup.notes) || !Array.isArray(backup.records) || !Array.isArray(backup.versions)) fail('备份格式不正确。');
    const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
    const validatePath = value => {
      if (typeof value !== 'string' || !value || value.length > 1_000 || value.includes('\\') || value.includes('\0') || path.isAbsolute(value)) fail('备份包含非法 Markdown 路径。');
      const parts = value.split('/');
      const windowsDevice = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
      if (parts.some(part => !part || part === '.' || part === '..' || part.startsWith('.') || /[<>:"|?*]/.test(part) || /[. ]$/.test(part) || windowsDevice.test(part)) || path.extname(value).toLowerCase() !== '.md') fail('备份包含非法 Markdown 路径。');
      const target = path.resolve(this.vaultDir, ...parts);
      assertTree(target, this.vaultDir);
      return { normalized: parts.join('/'), target };
    };
    const ids = new Set(), paths = new Set();
    let totalBytes = 0;
    for (const item of backup.notes) {
      if (!item || typeof item !== 'object' || !validId(item.id) || typeof item.raw !== 'string' || Buffer.byteLength(item.raw) > 5_000_000) fail('备份包含非法 Markdown。');
      const checkedPath = validatePath(item.path);
      const pathKey = checkedPath.normalized.toLowerCase();
      if (ids.has(item.id) || paths.has(pathKey)) fail('备份包含重复身份或路径。');
      const { meta } = parse(item.raw);
      if (meta.id !== undefined && meta.id !== item.id) fail('备份 Markdown 的稳定身份不一致。');
      totalBytes += Buffer.byteLength(item.raw);
      ids.add(item.id); paths.add(pathKey);
    }
    const recordKeys = new Set();
    for (const r of backup.records) {
      if (!r || typeof r !== 'object' || typeof r.namespace !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(r.namespace) || ['settings','changed','restore'].includes(r.namespace) || typeof r.key !== 'string' || !r.key || r.key.length > 500 || typeof r.json !== 'string' || Buffer.byteLength(r.json) > 5_000_000) fail('备份运行记录不正确。');
      const recordKey = `${r.namespace}\0${r.key}`;
      if (recordKeys.has(recordKey)) fail('备份包含重复运行记录。');
      try { JSON.parse(r.json); } catch { fail('备份运行记录不是有效 JSON。'); }
      totalBytes += Buffer.byteLength(r.json); recordKeys.add(recordKey);
    }
    const versionIds = new Set();
    for (const version of backup.versions) {
      if (!version || typeof version !== 'object' || !validId(version.id) || !validId(version.noteId) || versionIds.has(version.id)) fail('备份历史版本身份无效或重复。');
      validatePath(version.path);
      if (typeof version.raw !== 'string' || Buffer.byteLength(version.raw) > 5_000_000 || typeof version.hash !== 'string' || !/^[a-f0-9]{64}$/.test(version.hash) || hash(version.raw) !== version.hash) fail('备份历史版本内容或哈希无效。');
      const { meta } = parse(version.raw);
      if (meta.id !== undefined && meta.id !== version.noteId) fail('备份历史版本的笔记身份不一致。');
      if (typeof version.reason !== 'string' || !version.reason.trim() || version.reason.length > 4_000 || typeof version.createdAt !== 'string' || version.createdAt.length > 100 || !Number.isFinite(Date.parse(version.createdAt))) fail('备份历史版本说明或时间无效。');
      totalBytes += Buffer.byteLength(version.raw); versionIds.add(version.id);
    }
    if (totalBytes > 100_000_000) fail('备份展开后超过 100 MB 限制。', 'TOO_LARGE', 413);
    this.scan();
    if (this.conflicts.length) fail('当前 Vault 有冲突或无法解析的 Markdown；恢复前必须先处理，避免遗漏或覆盖。', 'RESTORE_CONFLICT', 409);
    return { notes: backup.notes.length, records: backup.records.length, versions: backup.versions.length, replaces: this.list().length, retention: '恢复前自动备份；JSON 只覆盖本应用索引的 Markdown、运行记录和历史版本。附件、.obsidian 与其他未索引文件不会写入或删除，需另行复制整个 Vault 保存。' };
  }
  restore(backup) {
    this.validateBackup(backup);
    const safetyFile = path.join(this.dataDir, 'backups', `before-restore-${Date.now()}.json`);
    atomicWrite(safetyFile, JSON.stringify(this.backup()));
    const currentRows = this.db.prepare('SELECT * FROM notes').all();
    const currentPaths = new Set(currentRows.map(row => row.path.toLowerCase()));
    const stageRoot = assertTree(path.join(this.vaultDir, `.learning-restore-${randomUUID()}`), this.vaultDir);
    const incomingRoot = path.join(stageRoot, 'incoming');
    const previousRoot = path.join(stageRoot, 'previous');
    const incoming = backup.notes.map(item => ({
      ...item,
      relativePath: item.path.split('/').join(path.sep),
      target: assertTree(path.resolve(this.vaultDir, ...item.path.split('/')), this.vaultDir),
    }));
    const movedCurrent = [], installedIncoming = [];
    let transaction = false, committed = false, rollbackError = null, cleanupPending = null;
    try {
      fs.mkdirSync(stageRoot, { recursive: false });
      for (const item of incoming) {
        const staged = assertTree(path.join(incomingRoot, item.relativePath), stageRoot);
        atomicWrite(staged, item.raw);
        if (fs.readFileSync(staged, 'utf8') !== item.raw) fail('恢复暂存校验失败。', 'RESTORE_IO');
        if (fs.existsSync(item.target) && !currentPaths.has(item.path.toLowerCase())) fail('恢复目标与未纳入当前索引的文件冲突，未覆盖。', 'RESTORE_CONFLICT', 409);
      }
      for (const row of currentRows) {
        const source = assertTree(path.resolve(this.vaultDir, ...row.path.split('/')), this.vaultDir);
        if (!fs.existsSync(source) || hash(fs.readFileSync(source)) !== row.hash) fail('恢复前检测到外部文件变化，未开始替换。', 'RESTORE_CONFLICT', 409);
      }

      this.db.exec('BEGIN IMMEDIATE'); transaction = true;
      for (const row of currentRows) {
        const source = assertTree(path.resolve(this.vaultDir, ...row.path.split('/')), this.vaultDir);
        const staged = assertTree(path.join(previousRoot, ...row.path.split('/')), stageRoot);
        fs.mkdirSync(path.dirname(staged), { recursive: true });
        fs.renameSync(source, staged); movedCurrent.push({ source, staged });
      }
      for (const item of incoming) {
        const staged = assertTree(path.join(incomingRoot, item.relativePath), stageRoot);
        fs.mkdirSync(path.dirname(item.target), { recursive: true });
        fs.renameSync(staged, item.target); installedIncoming.push(item.target);
      }

      this.db.exec("DELETE FROM notes; DELETE FROM index_chunks; DELETE FROM records WHERE namespace NOT IN ('settings','restore'); DELETE FROM versions;");
      for (const r of backup.records) this.db.prepare('INSERT INTO records VALUES(?,?,?)').run(r.namespace, r.key, r.json);
      for (const v of backup.versions) this.db.prepare('INSERT INTO versions VALUES(?,?,?,?,?,?,?)').run(v.id, v.noteId, v.path, v.hash, v.raw, v.reason, v.createdAt);
      for (const item of incoming) this.upsert(item.target, item.raw, item.id, parse(item.raw));
      this.db.exec('COMMIT'); transaction = false; committed = true; this.conflicts = [];
    } catch (error) {
      if (transaction) {
        try { this.db.exec('ROLLBACK'); } catch (rollback) { rollbackError = rollback; }
        transaction = false;
      }
      for (const target of installedIncoming.reverse()) {
        try { if (fs.existsSync(target)) fs.unlinkSync(target); } catch (rollback) { rollbackError ||= rollback; }
      }
      for (const item of movedCurrent.reverse()) {
        try {
          fs.mkdirSync(path.dirname(item.source), { recursive: true });
          if (fs.existsSync(item.source)) fs.unlinkSync(item.source);
          if (fs.existsSync(item.staged)) fs.renameSync(item.staged, item.source);
        } catch (rollback) { rollbackError ||= rollback; }
      }
      if (rollbackError) {
        const failed = new Error(`恢复失败且自动回滚未完整完成；请使用安全备份或暂存目录恢复。安全备份：${safetyFile}；暂存目录：${stageRoot}`);
        Object.assign(failed, { code: 'RESTORE_ROLLBACK_FAILED', status: 500, cause: error, rollbackError, safetyBackup: safetyFile, recoveryPath: stageRoot });
        throw failed;
      }
      throw error;
    } finally {
      if (!rollbackError && fs.existsSync(stageRoot)) {
        try { fs.rmSync(stageRoot, { recursive: true, force: true }); }
        catch { if (committed) cleanupPending = stageRoot; }
      }
    }
    return { restored: true, safetyBackup: safetyFile, ...(cleanupPending ? { stagingCleanupPending: cleanupPending } : {}) };
  }
  close() { this.db.close(); }
}
