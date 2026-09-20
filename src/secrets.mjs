import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { atomicWrite, fail } from './store.mjs';

export function createSecrets(dataDir) {
  const file = path.join(dataDir, 'secrets.enc.json');
  let secrets = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const dpapi = (value, decrypt = false) => {
    const script = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $v=[Security.Cryptography.ProtectedData]::${decrypt ? 'Unprotect' : 'Protect'}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Convert]::ToBase64String($v))`;
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input: value, encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim();
  };
  function encode(text) {
    if (process.platform === 'win32') return { type: 'dpapi', value: dpapi(Buffer.from(text).toString('base64')) };
    if (!process.env.LEARNING_MASTER_KEY) fail('此系统需设置 LEARNING_MASTER_KEY 才能保存密钥。');
    const key = createHash('sha256').update(process.env.LEARNING_MASTER_KEY).digest(), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    return { type: 'aes', iv: iv.toString('base64'), tag: null, ...(() => { const value = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('base64'); return { value, tag: cipher.getAuthTag().toString('base64') }; })() };
  }
  return {
    has: capability => !!secrets[capability],
    get(capability) {
      const s = secrets[capability]; if (!s) return '';
      if (s.type === 'dpapi') return Buffer.from(dpapi(s.value, true), 'base64').toString('utf8');
      if (!process.env.LEARNING_MASTER_KEY) fail('密钥未解锁。', 'SECRET_LOCKED');
      const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(process.env.LEARNING_MASTER_KEY).digest(), Buffer.from(s.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(s.tag, 'base64')); return Buffer.concat([decipher.update(Buffer.from(s.value, 'base64')), decipher.final()]).toString('utf8');
    },
    set(capability, value) { if (value) { secrets[capability] = encode(value); atomicWrite(file, JSON.stringify(secrets)); } },
    clear(capability) { delete secrets[capability]; atomicWrite(file, JSON.stringify(secrets)); },
  };
}
