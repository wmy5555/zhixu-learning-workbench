// Frozen desktop business rules; platform import adaptation only unless documented.
import fs from '../platform/fs.js';
import path from '../platform/path.js';
import { randomUUID } from '../platform/crypto.js';
import YAML from 'yaml';
import { fail, hash } from './store.mjs';
import { readAttachment, attachmentPath } from './attachments.mjs';

const metadata = raw => YAML.parseDocument(raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] || '{}').toJS({ maxAliasCount: 50 });
const attachments = meta => [meta.sourceFile, ...(meta.attachments || [])].filter(Boolean);

// Only explicit user deletions of sources belong here. Version history and
// ChatGPT undo records have separate ownership and are never swept into trash.
export function createRecycleBin(store) {
  function entries() {
    store.scan();
    return store.records('deleted').filter(item => !item.chatgptUndoId && !store.row(item.id)).flatMap(item => {
      const operation = item.operationId ? store.get('fileRecovery', item.operationId) : null;
      if (item.operationId && (operation?.kind !== 'recycle' || operation.state !== 'complete')) return [];
      const version = store.history(item.id).find(v => v.reason === '用户删除' && (!operation || v.hash === operation.beforeHash && v.path === operation.path));
      if (!version) return [];
      const meta = metadata(version.raw);
      if (meta.kind !== 'source' || meta.id !== item.id) return [];
      return [{ id: item.id, title: meta.title, deletedAt: item.deletedAt, versionId: version.versionId,
        hash: version.hash, meta }];
    });
  }
  function list() {
    const items = entries();
    const pending = store.records('recyclePurge');
    return { pendingCleanup: pending.length, items: items.map(({ meta, ...item }) => ({ ...item, attachmentCount: attachments(meta).length })),
      revision: hash(JSON.stringify([items.map(({ id, versionId, hash }) => [id, versionId, hash]).sort(), pending.map(item => item.id).sort()])) };
  }
  function restore(id, versionId) {
    const item = entries().find(item => item.id === id && item.versionId === versionId);
    if (!item) fail('回收站项目已变化，请刷新后重试。', 'RECYCLE_CONFLICT', 409);
    for (const descriptor of attachments(item.meta)) readAttachment(store.vaultDir, descriptor);
    return store.restoreVersionExact(id, versionId, { expectMissing: true });
  }
  function clear({ confirmed, revision } = {}, selected = null) {
    if (confirmed !== true) fail('永久清空需要明确确认。', 'RECYCLE_CONFIRM_REQUIRED', 409);
    const preview = list();
    if (revision !== preview.revision) fail('回收站已变化，请重新确认清空范围。', 'RECYCLE_CONFLICT', 409);
    const all = entries();
    const items = selected ? all.filter(item => item.id === selected.id && item.versionId === selected.versionId) : all;
    if (selected && items.length !== 1) fail('回收站项目已变化，请刷新后重新确认。', 'RECYCLE_CONFLICT', 409);
    const ids = new Set(items.map(item => item.id));
    const claims = store.records('fileRecovery').filter(item => ids.has(item.noteId));
    if (claims.some(item => item.state !== 'complete')) fail('存在未完成的文件恢复操作，暂不能清空。', 'RECYCLE_CONFLICT', 409);
    // Validate every claimed file before removing anything. Never delete a path
    // supplied by the client or a recovery copy changed by an external editor.
    const files = claims.flatMap(operation => {
      const file = path.resolve(store.vaultDir, operation.holdingPath);
      const relative = path.relative(store.vaultDir, file);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !/^\.zhixu-recovery-[a-f0-9-]+\.raw$/.test(path.basename(file))) fail('恢复副本路径无效。', 'RECYCLE_CONFLICT', 409);
      let current = store.vaultDir;
      for (const part of relative.split(path.sep)) {
        if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) fail('恢复路径不能是链接。', 'SYMLINK', 403);
        current = path.join(current, part);
      }
      if (!fs.existsSync(file)) return [];
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || hash(fs.readFileSync(file)) !== operation.beforeHash) fail('恢复副本已变化，未清空。', 'RECYCLE_CONFLICT', 409);
      return [file];
    });
    // Shared attachments, surviving records, and surviving history retain ownership.
    const uploads = store.records('attachmentUploads').filter(item => ids.has(item.noteId));
    const surviving = [
      ...store.db.prepare('SELECT raw FROM notes').all().map(row => row.raw),
      ...store.db.prepare('SELECT noteId,raw FROM versions').all().filter(row => !ids.has(row.noteId)).map(row => row.raw),
      ...store.db.prepare('SELECT namespace,key,json FROM records').all().filter(row =>
        !(row.namespace === 'deleted' && ids.has(row.key)) &&
        !(row.namespace === 'fileRecovery' && claims.some(item => item.id === row.key)) &&
        !(row.namespace === 'attachmentUploads' && uploads.some(item => item.id === row.key))).map(row => row.json),
    ];
    const descriptors = items.flatMap(item => store.history(item.id).flatMap(version => attachments(metadata(version.raw))));
    const assets = [...new Map(descriptors.map(item => [item.id, item])).values()]
      .filter(item => !surviving.some(raw => raw.includes(item.id))).flatMap(item => {
        const file = attachmentPath(store.vaultDir, item.id);
        if (!fs.existsSync(file)) return [];
        readAttachment(store.vaultDir, item);
        return [file];
      });
    const purge = { id: randomUUID(), files: [...files, ...assets].map(file => ({ path: path.relative(store.vaultDir, file), hash: hash(fs.readFileSync(file)) })) };
    store.db.exec('SAVEPOINT recycle_clear');
    try {
      if (purge.files.length) store.put('recyclePurge', purge.id, purge);
      for (const id of ids) {
        store.db.prepare('DELETE FROM versions WHERE noteId=?').run(id);
        store.remove('deleted', id);
      }
      for (const item of claims) store.remove('fileRecovery', item.id);
      for (const item of uploads) store.remove('attachmentUploads', item.id);
      store.db.exec('RELEASE recycle_clear');
    } catch (error) { store.db.exec('ROLLBACK TO recycle_clear; RELEASE recycle_clear'); throw error; }
    // Commit the permanent removal first. Interrupted physical cleanup retains
    // a journal, retried only after another explicit clear confirmation.
    // A single-item confirmation never authorizes cleanup from earlier operations.
    for (const pending of selected ? (purge.files.length ? [purge] : []) : store.records('recyclePurge')) {
      for (const entry of pending.files) {
        const file = path.resolve(store.vaultDir, entry.path), relative = path.relative(store.vaultDir, file);
        if (relative.startsWith('..') || path.isAbsolute(relative) || !/^([.]zhixu-attachments[\\/][a-f0-9]{64}[.](png|jpg|gif|webp|pdf|doc|docx)|.+[\\/][.]zhixu-recovery-[a-f0-9-]+[.]raw)$/.test(relative)) fail('清理日志路径无效。', 'RECYCLE_CONFLICT', 409);
        let current = store.vaultDir;
        for (const part of relative.split(path.sep)) {
          if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) fail('清理路径不能是链接。', 'SYMLINK', 403);
          current = path.join(current, part);
        }
        if (!fs.existsSync(file)) continue;
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || hash(fs.readFileSync(file)) !== entry.hash) fail('文件已变化，未继续清理；请核对清理日志。', 'RECYCLE_CONFLICT', 409);
        // A retained/reimported attachment may have gained a new owner since a
        // previous failed cleanup; preserve it conservatively.
        const assetId = path.basename(file);
        if (relative.startsWith('.zhixu-attachments') && [
          ...store.db.prepare('SELECT raw FROM notes UNION ALL SELECT raw FROM versions').all().map(row => row.raw),
          ...store.db.prepare("SELECT json FROM records WHERE namespace!='recyclePurge'").all().map(row => row.json),
        ].some(raw => raw.includes(assetId))) continue;
        fs.unlinkSync(file);
      }
      store.remove('recyclePurge', pending.id);
    }
    return { cleared: ids.size };
  }
  function purge(id, versionId, confirmation) {
    return clear(confirmation, { id, versionId });
  }
  return { list, restore, clear, purge };
}
