import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { atomicWrite, fail } from './store.mjs';
import { credentialBinding } from './settings-validation.mjs';

export function createSecrets(dataDir, { db, getBinding } = {}) {
  const file = path.join(dataDir, 'secrets.enc.json');
  let secrets = {};
  if (db) {
    // Separate from runtime records: encrypted credentials never enter JSON backups.
    db.exec('CREATE TABLE IF NOT EXISTS encrypted_credentials (capability TEXT PRIMARY KEY,json TEXT NOT NULL)');
    if (!db.prepare('SELECT 1 FROM encrypted_credentials WHERE capability=?').get('_initialized')) {
      const legacy = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const capability of ['model','embedding','search']) if (legacy[capability]) {
          db.prepare('INSERT INTO encrypted_credentials VALUES(?,?)').run(capability, JSON.stringify({ ...legacy[capability], binding: getBinding?.(capability) }));
        }
        db.prepare('INSERT INTO encrypted_credentials VALUES(?,?)').run('_initialized', 'true');
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      // Keep the original encrypted file as a rollback source. The marker prevents resurrection.
    }
  } else secrets = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const stored = capability => db ? (() => { const row = db.prepare('SELECT json FROM encrypted_credentials WHERE capability=?').get(capability); return row ? JSON.parse(row.json) : null; })() : secrets[capability];
  const usable = (capability, value) => !!value && (!getBinding || JSON.stringify(value.binding) === JSON.stringify(getBinding(capability)));
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
    has: capability => usable(capability, stored(capability)),
    get(capability, config) {
      const s = stored(capability);
      if (!usable(capability, s) || config && JSON.stringify(s.binding) !== JSON.stringify(credentialBinding(config))) return '';
      if (s.type === 'dpapi') return Buffer.from(dpapi(s.value, true), 'base64').toString('utf8');
      if (!process.env.LEARNING_MASTER_KEY) fail('密钥未解锁。', 'SECRET_LOCKED');
      const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(process.env.LEARNING_MASTER_KEY).digest(), Buffer.from(s.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(s.tag, 'base64')); return Buffer.concat([decipher.update(Buffer.from(s.value, 'base64')), decipher.final()]).toString('utf8');
    },
    prepare(changes) {
      return changes.map(change => ({ capability: change.capability, value: change.clear ? null : { ...encode(change.value), binding: change.binding ?? getBinding?.(change.capability) } }));
    },
    apply(changes) {
      if (db) for (const { capability, value } of changes) {
        if (value === null) db.prepare('DELETE FROM encrypted_credentials WHERE capability=?').run(capability);
        else db.prepare('INSERT INTO encrypted_credentials VALUES(?,?) ON CONFLICT(capability) DO UPDATE SET json=excluded.json').run(capability, JSON.stringify(value));
      }
      else {
        const next = { ...secrets };
        for (const { capability, value } of changes) { if (value === null) delete next[capability]; else next[capability] = value; }
        atomicWrite(file, JSON.stringify(next)); secrets = next;
      }
    },
    set(capability, value, config) { if (value) this.apply(this.prepare([{ capability, value, ...(config ? { binding: credentialBinding(config) } : {}) }])); },
    clear(capability) { this.apply([{ capability, value: null }]); },
  };
}
