import { spawn } from 'node:child_process';
import { readFile, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function credentialDirectory() {
  if (process.env.HISTORY_CREDENTIAL_DIR) return resolve(process.env.HISTORY_CREDENTIAL_DIR);
  if (process.env.HISTORY_RUNTIME_DIR) return join(resolve(process.env.HISTORY_RUNTIME_DIR), 'credentials');
  if (!process.env.LOCALAPPDATA) throw new Error('历史读取器本机认证目录不可用。');
  return join(process.env.LOCALAPPDATA, 'ChatGPTHistoryReader');
}

async function assertRegularPrivatePath(file) {
  let current = dirname(file);
  while (true) {
    if ((await lstat(current)).isSymbolicLink()) throw new Error('历史读取器认证目录不安全。');
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('历史读取器认证文件不安全。');
}

function unprotect(ciphertext) {
  return new Promise((resolvePromise, reject) => {
    const script = fileURLToPath(new URL('../kit/history-handoff-dpapi.ps1', import.meta.url));
    const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
    });
    const chunks = [];
    let size = 0, settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const chunk of chunks) chunk.fill(0);
      error ? reject(error) : resolvePromise(value);
    };
    const timer = setTimeout(() => { child.kill(); finish(new Error('历史读取器本机认证解密超时。')); }, 20000);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 16384) { child.kill(); finish(new Error('历史读取器本机认证数据过大。')); }
      else chunks.push(chunk);
    });
    child.once('error', () => finish(new Error('历史读取器本机认证无法解密。')));
    child.stdin.once('error', () => finish(new Error('历史读取器本机认证无法解密。')));
    child.once('exit', code => {
      if (code !== 0) return finish(new Error('历史读取器本机认证无法解密。'));
      const encoded = Buffer.concat(chunks).toString('ascii').trim();
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return finish(new Error('历史读取器本机认证数据无效。'));
      finish(null, Buffer.from(encoded, 'base64'));
    });
    child.stdin.end(ciphertext.toString('base64'));
  });
}

export async function readHistoryHandoffKey({ file = join(credentialDirectory(), 'handoff-auth.dpapi.json'), decrypt = unprotect } = {}) {
  if (process.platform !== 'win32') throw new Error('历史读取器本机认证当前仅支持 Windows。');
  await assertRegularPrivatePath(file);
  const record = JSON.parse(await readFile(file, 'utf8'));
  if (record.version !== 1 || record.scope !== 'Windows CurrentUser DPAPI' ||
    typeof record.ciphertext !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(record.ciphertext)) {
    throw new Error('历史读取器本机认证文件无效。');
  }
  const ciphertext = Buffer.from(record.ciphertext, 'base64');
  try {
    const key = await decrypt(ciphertext);
    if (!Buffer.isBuffer(key) || key.length !== 32) { key?.fill?.(0); throw new Error('历史读取器本机认证密钥无效。'); }
    return key;
  } finally { ciphertext.fill(0); }
}
