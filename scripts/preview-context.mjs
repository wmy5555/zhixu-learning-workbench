import fs from 'node:fs';
import path from 'node:path';

const parent = path.resolve(import.meta.dirname, '../.tmp');
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
function registeredMetadata(file) {
  const metadataFile = path.resolve(file);
  const directory = path.dirname(metadataFile);
  if (path.dirname(directory) !== parent || !path.basename(directory).startsWith('parity-preview-')
    || path.basename(metadataFile) !== 'preview.json')
    throw new Error('预览信息路径无效，请使用独立预览目录中的 preview.json。');
  if (fs.lstatSync(directory).isSymbolicLink() || fs.lstatSync(metadataFile).isSymbolicLink())
    throw new Error('预览信息路径不能使用符号链接。');
  const meta = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
  const root = path.resolve(meta.root || '');
  if (!meta.synthetic || meta.scheduler !== false || !alive(meta.pid)
    || path.dirname(root) !== parent || !path.basename(root).startsWith('parity-preview-')
    || metadataFile !== path.join(root, 'preview.json') || meta.metadataFile !== metadataFile)
    throw new Error('预览信息无效或预览已结束，请重新启动并使用其 metadataFile。');
  return meta;
}
async function verifyMetadata(meta) {
  if (!/^[a-f0-9]{48}$/.test(meta.proof || '')) throw new Error('预览身份无效。');
  for (const [role, url] of [['candidate', meta.candidate], ...(meta.baseline ? [['baseline', meta.baseline]] : [])]) {
    const value = new URL(url);
    if (value.protocol !== 'http:' || value.hostname !== '127.0.0.1' || !value.port || value.port === '4318' || value.pathname !== '/' || value.search || value.hash || value.username || value.password)
      throw new Error('预览地址无效，必须使用独立回环端口。');
    const response = await fetch(url + '/__zhixu_preview/' + meta.proof + '/' + role, {signal:AbortSignal.timeout(1500), redirect:'error'});
    if (!response.ok || await response.text() !== meta.proof + ':' + role) throw new Error('预览身份无法核对。');
  }
  return meta;
}
// Keep the old no-argument invocation only when it has one unambiguous owner.
export async function previewMetadata(file) {
  // Legacy callers may pass the former shared filename; resolve it safely instead.
  if (file && path.resolve(file) !== path.join(parent, 'parity-preview.json')) return verifyMetadata(registeredMetadata(file));
  const candidates = fs.existsSync(parent) ? fs.readdirSync(parent, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('parity-preview-'))
    .map(entry => path.join(parent, entry.name, 'preview.json')) : [];
  const live = [];
  for (const candidate of candidates) {
    try { live.push(registeredMetadata(candidate)); } catch { /* stale or incomplete instance */ }
  }
  if (live.length !== 1) throw new Error('预览数量不是一个；请把启动输出中的 metadataFile 作为第 4 个参数传入。');
  return verifyMetadata(live[0]);
}
export function evidenceDirectory(meta, name) {
  const parent = path.join(meta.root, 'evidence');
  fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, name + '-'));
  console.log('证据目录：' + dir);
  return dir;
}
