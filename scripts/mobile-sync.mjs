import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { atomicWrite } from '../src/store.mjs';
import { MAX_TRANSFER_BYTES, newSyncState, validateTransfer, exportMobileSnapshot, applyMobileTransfer } from '../src/mobile-sync.mjs';

export function localBase(value = 'http://127.0.0.1:4318') {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('桌面连接仅允许 http://127.0.0.1:端口 或 http://localhost:端口。');
  }
  return url.origin;
}

export async function connectLocalApi(base) {
  base = localBase(base);
  const response = await fetch(`${base}/api/session`, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('无法建立桌面本机会话。');
  const session = await response.json(), cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!session.csrf || !cookie) throw new Error('桌面服务未返回有效会话。');
  async function request(route, method = 'GET', body) {
    const response = await fetch(`${base}${route}`, { method, signal: AbortSignal.timeout(15000),
      headers: { Cookie: cookie, Origin: base, 'X-CSRF-Token': session.csrf, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error || '桌面操作失败。'), { code: result.code, status: response.status });
    return result;
  }
  return {
    note: id => request(`/api/notes/${encodeURIComponent(id)}`),
    sources: async () => (await request('/api/notes?kind=source')).notes,
    edit: (id, value) => request(`/api/notes/${encodeURIComponent(id)}`, 'PUT', value),
    import: value => request('/api/import', 'POST', value),
    settings: () => request('/api/settings'),
  };
}

export async function main(args = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') options.apply = true;
    else if (['--base', '--state-dir', '--pull', '--push', '--out'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) options[args[i].slice(2)] = args[++i];
    else throw new Error('参数无效。使用 --state-dir、--pull ID列表 或 --push 文件、--out 文件；写入另加 --apply。');
  }
  if (!options['state-dir'] || !options.out || Boolean(options.pull) === Boolean(options.push)) throw new Error('必须指定独立 --state-dir、--out，以及 --pull 或 --push。');
  let transfer;
  if (options.push) {
    if (fs.statSync(options.push).size > MAX_TRANSFER_BYTES) throw new Error('交换文件超过 8 MiB。');
    transfer = validateTransfer(JSON.parse(fs.readFileSync(options.push, 'utf8')));
    if (!options.apply) {
      console.log(JSON.stringify({ preview: true, pending: transfer.notes.filter(n => n.dirty).length, message: '尚未写入。审阅后加 --apply；冲突不会覆盖。' }));
      return;
    }
  }
  const base = localBase(options.base), api = await connectLocalApi(base);
  const settings = await api.settings();
  const desktopIdentity = createHash('sha256').update(`${base}\n${settings.vaultDir}`).digest('hex');
  const stateDir = path.resolve(options['state-dir']), stateFile = path.join(stateDir, 'mobile-sync-state.json');
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { ...newSyncState(), desktopIdentity };
  if (state.version !== 1 || state.desktopIdentity !== desktopIdentity || !state.bindings || !state.receipts) throw new Error('交换目录属于另一个桌面连接或 Vault，请使用不同目录。');
  const save = () => { fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 }); atomicWrite(stateFile, JSON.stringify(state)); };
  if (path.resolve(options.out) === stateFile || options.push && path.resolve(options.out) === path.resolve(options.push)) throw new Error('输出不能覆盖交换状态或手机输入文件。');
  const result = options.pull
    ? await exportMobileSnapshot({ api, state, noteIds: options.pull.split(',') })
    : await applyMobileTransfer({ api, state, transfer, checkpoint: save });
  save();
  fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true, mode: 0o700 });
  atomicWrite(path.resolve(options.out), JSON.stringify(result));
  console.log(JSON.stringify({ exported: result.notes.length, saved: result.results?.filter(r => r.status === 'saved').length || 0,
    conflicts: result.results?.filter(r => r.status === 'conflict').length || 0 }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
