import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { createService } from '../src/service.mjs';
import { createSecrets } from '../src/secrets.mjs';

function fixture(t, { practice = false } = {}) {
  const tempRoot = path.resolve(import.meta.dirname, '../.tmp'); fs.mkdirSync(tempRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(tempRoot, 'settings-reliability-'));
  const dataDir = path.join(root, 'data'), vaultDir = path.join(root, 'vault');
  let service = createService({ dataDir, vaultDir, practice });
  t.after(async () => { await service.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, dataDir, vaultDir, get service() { return service; }, async reopen() { await service.close(); service = createService({ dataDir, vaultDir, practice }); } };
}
const syntheticKey = () => randomBytes(32).toString('hex');
const credentials = service => service.store.db.prepare('SELECT * FROM encrypted_credentials ORDER BY capability').all();
const configure = (service, key) => service.updateSettings({ ai: { baseUrl: 'https://EXAMPLE.invalid/v1/', model: 'synthetic-model', apiKey: key, enabled: true } });

test('all fields validate before setting, replacing, clearing credentials or changing Vault', async t => {
  const h = fixture(t), key = syntheticKey(); configure(h.service, key);
  const before = h.service.settings(), encrypted = credentials(h.service);
  assert.equal(createSecrets(h.dataDir, { db: h.service.store.db }).get('model', before.ai), key);
  assert.equal(createSecrets(h.dataDir, { db: h.service.store.db }).get('model', { ...before.ai, baseUrl: 'https://other.invalid/v1' }), '');
  for (const patch of [
    { ai: { apiKey: syntheticKey(), monthlyBudget: -1 } },
    { ai: { clearKey: true }, embedding: { baseUrl: 'http://example.invalid' } },
    { ai: { apiKey: syntheticKey() }, fetch: { enabled: 'false' } },
    { ai: { clearKey: true }, focusTopics: [false] },
    { vaultDir: path.join(h.root, 'new-vault'), ai: { apiKey: syntheticKey() }, pausedIds: 'wrong' },
    { vaultDir: h.dataDir, ai: { clearKey: true } },
    { ai: { clearKey: 'true' } }, { ai: { apiKey: 123 } },
  ]) {
    assert.throws(() => h.service.updateSettings(patch), { code: 'INVALID' });
    assert.deepEqual(h.service.settings(), before); assert.deepEqual(credentials(h.service), encrypted);
  }
  assert.equal(fs.existsSync(path.join(h.root, 'new-vault')), false);
  assert.ok(!JSON.stringify(h.service.backup()).includes(key));
});

test('security switches reject coercion and valid dependent switches follow their parents', t => {
  const h = fixture(t);
  for (const group of ['ai','embedding','search','fetch']) for (const value of ['true', 1, null]) {
    assert.throws(() => h.service.updateSettings({ [group]: { enabled: value } }), { code: 'INVALID' });
  }
  for (const key of ['enabled','allowProposals','chatgptEnabled','chatgptAllowRead']) assert.throws(() => h.service.updateSettings({ mcp: { [key]: 'false' } }), { code: 'INVALID' });
  const next = h.service.updateSettings({ ai: { dailyCallLimit: '12', monthlyBudget: '4.5' }, mcp: { enabled: false, allowProposals: true, chatgptEnabled: false, chatgptAllowRead: true } });
  assert.equal(next.ai.dailyCallLimit, 12); assert.equal(next.ai.monthlyBudget, 4.5);
  assert.equal(next.mcp.allowProposals, false); assert.equal(next.mcp.chatgptAllowRead, false);
});

test('credential write failure rolls back settings, earlier credential changes and Vault scan', t => {
  const h = fixture(t), key = syntheticKey(); configure(h.service, key);
  const before = h.service.settings(), encrypted = credentials(h.service), newVault = path.join(h.root, 'candidate-vault');
  fs.mkdirSync(newVault); fs.writeFileSync(path.join(newVault, 'candidate.md'), 'Synthetic local note');
  h.service.store.db.exec("CREATE TEMP TRIGGER reject_embedding BEFORE INSERT ON encrypted_credentials WHEN NEW.capability='embedding' BEGIN SELECT RAISE(ABORT,'synthetic credential failure'); END");
  assert.throws(() => h.service.updateSettings({ vaultDir: newVault, dailyMinutes: 40, ai: { clearKey: true }, embedding: { apiKey: syntheticKey() } }), /synthetic credential failure/);
  assert.deepEqual(h.service.settings(), before); assert.deepEqual(credentials(h.service), encrypted);
  assert.equal(h.service.store.list().length, 0); assert.equal(h.service.store.vaultDir, h.vaultDir);
});

test('settings write failure preserves credentials and successful writes survive restart', async t => {
  const h = fixture(t), key = syntheticKey(); configure(h.service, key);
  const before = h.service.settings(), encrypted = credentials(h.service);
  h.service.store.db.exec("CREATE TEMP TRIGGER reject_settings BEFORE UPDATE ON records WHEN NEW.namespace='settings' BEGIN SELECT RAISE(ABORT,'synthetic settings failure'); END");
  assert.throws(() => h.service.updateSettings({ dailyMinutes: 50, ai: { apiKey: syntheticKey() } }), /synthetic settings failure/);
  assert.deepEqual(h.service.settings(), before); assert.deepEqual(credentials(h.service), encrypted);
  h.service.store.db.exec('DROP TRIGGER reject_settings');
  h.service.updateSettings({ dailyMinutes: 50, ai: { apiKey: '' } });
  await h.reopen(); assert.equal(h.service.settings().dailyMinutes, 50); assert.equal(h.service.settings().ai.hasKey, true);
});

test('invalid backup settings are rejected before preview or replacing any files', t => {
  const source = fixture(t), target = fixture(t);
  source.service.importItems({ items: [{ title: 'Incoming', body: 'Incoming synthetic text', privacy: 'local' }] });
  const note = target.service.importItems({ items: [{ title: 'Kept', body: 'Kept synthetic text', privacy: 'local' }] }).notes[0];
  const raw = fs.readFileSync(path.join(target.vaultDir, note.path), 'utf8'), before = target.service.settings();
  const backup = source.service.backup(), preview = target.service.restore({ backup });
  for (const preferences of [{ ai: { monthlyBudget: -1 } }, { fetch: { enabled: 'false' } }, { mcp: { chatgptAllowRead: 1 } }, { ai: { apiKey: syntheticKey() } }]) {
    const bad = { ...backup, preferences };
    assert.throws(() => target.service.restore({ backup: bad }), { code: 'INVALID' });
    assert.throws(() => target.service.restore({ backup: bad, preview: false, token: preview.token }), { code: 'INVALID' });
    assert.equal(fs.readFileSync(path.join(target.vaultDir, note.path), 'utf8'), raw);
    assert.deepEqual(target.service.settings(), before);
  }
});

test('restore settings failure rolls back restored files and runtime records', t => {
  const source = fixture(t), target = fixture(t);
  source.service.importItems({ items: [{ title: 'Incoming', body: 'New synthetic text', privacy: 'local' }] });
  const old = target.service.importItems({ items: [{ title: 'Kept', body: 'Old synthetic text', privacy: 'local' }] }).notes[0];
  target.service.updateSettings({ dailyMinutes: 20 }); const before = target.service.backup();
  const backup = source.service.backup(), preview = target.service.restore({ backup });
  target.service.store.db.exec("CREATE TEMP TRIGGER reject_restore_settings BEFORE UPDATE ON records WHEN NEW.namespace='settings' BEGIN SELECT RAISE(ABORT,'synthetic restore settings failure'); END");
  assert.throws(() => target.service.restore({ backup, preview: false, token: preview.token }), /synthetic restore settings failure/);
  assert.equal(target.service.store.read(old.id).body, old.body);
  assert.equal(fs.readFileSync(path.join(target.vaultDir, old.path), 'utf8'), before.notes[0].raw);
  assert.equal(target.service.settings().dailyMinutes, 20);
});

test('restored capabilities stay off, endpoint changes cannot reuse local credentials, and jobs wait', async t => {
  const source = fixture(t), target = fixture(t), key = syntheticKey(); configure(target.service, key);
  source.service.updateSettings({ ai: { enabled: true, baseUrl: 'https://other.invalid/v1', model: 'other-model' }, embedding: { enabled: true }, search: { enabled: true }, fetch: { enabled: true }, mcp: { enabled: true, allowProposals: true, chatgptEnabled: true, chatgptAllowRead: true } });
  const queued = source.service.queue('index', {}, 'queued'), running = source.service.queue('index', {}, 'running');
  source.service.store.put('jobs', running.id, { ...running, state: 'running' });
  const encrypted = credentials(target.service), backup = source.service.backup(), preview = target.service.restore({ backup });
  assert.equal(preview.settingsChanges.allExternalCapabilitiesDisabled, true); assert.equal(preview.pendingTasksRequiringConfirmation, 2);
  assert.equal(preview.settingsChanges.providers[0].backup.baseUrl, 'https://other.invalid/v1');
  assert.ok(!JSON.stringify(preview).includes(key));
  target.service.restore({ backup, preview: false, token: preview.token });
  for (const group of ['ai','embedding','search','fetch','mcp']) assert.equal(target.service.settings()[group].enabled, false);
  assert.equal(target.service.settings().mcp.chatgptEnabled, false); assert.equal(target.service.settings().ai.hasKey, false);
  assert.deepEqual(credentials(target.service), encrypted);
  assert.equal(target.service.store.get('jobs', queued.id).state, 'waiting'); assert.equal(target.service.store.get('jobs', running.id).state, 'waiting');
  await target.service.runJobs(); assert.ok(target.service.store.records('jobs').every(job => job.state === 'waiting'));
  target.service.updateSettings({ ai: { enabled: true } });
  await assert.rejects(target.service.ai.generate({ prompt: 'Synthetic prompt', privacy: 'cloud' }), { code: 'MISSING_CREDENTIALS' });
  assert.equal(target.service.store.records('calls').length, 0);
  target.service.updateSettings({ ai: { baseUrl: 'https://example.invalid/v1', model: 'synthetic-model' } });
  assert.equal(target.service.settings().ai.hasKey, true);
  await target.reopen(); assert.equal(target.service.store.get('jobs', queued.id).state, 'waiting');
});

test('legacy encrypted file is preserved, migration is atomic, and cleared keys never resurrect', async t => {
  const h = fixture(t), key = syntheticKey(), file = path.join(h.dataDir, 'secrets.enc.json');
  const legacy = createSecrets(h.dataDir); legacy.set('model', key);
  const previous = fs.readFileSync(file, 'utf8');
  h.service.store.put('settings', 'main', { ai: { baseUrl: 'https://example.invalid/v1/', model: 'legacy' } });
  h.service.store.db.exec("DELETE FROM encrypted_credentials; CREATE TEMP TRIGGER reject_migration BEFORE INSERT ON encrypted_credentials WHEN NEW.capability='_initialized' BEGIN SELECT RAISE(ABORT,'synthetic migration failure'); END");
  assert.throws(() => createSecrets(h.dataDir, { db: h.service.store.db, getBinding: () => ({ baseUrl: 'https://example.invalid/v1', model: 'legacy' }) }), /synthetic migration failure/);
  assert.equal(credentials(h.service).length, 0); assert.equal(fs.readFileSync(file, 'utf8'), previous);
  h.service.store.db.exec('DROP TRIGGER reject_migration');
  await h.reopen(); assert.equal(h.service.settings().ai.hasKey, true); assert.equal(fs.readFileSync(file, 'utf8'), previous);
  h.service.updateSettings({ ai: { clearKey: true } }); await h.reopen();
  assert.equal(h.service.settings().ai.hasKey, false); assert.equal(fs.readFileSync(file, 'utf8'), previous);
  const reader = createSecrets(h.dataDir, { db: h.service.store.db }); assert.equal(reader.get('model'), '');
});
