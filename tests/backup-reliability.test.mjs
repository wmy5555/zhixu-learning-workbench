import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import YAML from 'yaml';
import { Store, hash } from '../src/store.mjs';
import { createCallLedger } from '../src/call-ledger.mjs';
import { assertBackupSize, BACKUP_MAX_BYTES, BACKUP_REQUEST_MAX_BYTES } from '../src/backup-contract.mjs';

const tempRoot = path.resolve(import.meta.dirname, '..', '.tmp');
fs.mkdirSync(tempRoot, { recursive: true });
function harness(t) {
  const root = fs.mkdtempSync(path.join(tempRoot, 'backup-reliability-'));
  const dataDir = path.join(root, 'data'), vaultDir = path.join(root, 'vault');
  const store = new Store({ dataDir, vaultDir });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const note = store.create({ id: 'current-note', title: '原资料', body: '原正文', meta: { privacy: 'local' } });
  store.put('sessions', 'answer', { id: 'answer', answer: '保留回答' });
  return { root, dataDir, vaultDir, store, note };
}
function snapshot(h) {
  return {
    rows: h.store.db.prepare('SELECT * FROM notes').all(),
    records: h.store.db.prepare('SELECT * FROM records').all(),
    versions: h.store.db.prepare('SELECT * FROM versions').all(),
    chunks: h.store.db.prepare('SELECT * FROM index_chunks').all(),
    raw: fs.readFileSync(path.join(h.vaultDir, h.note.path), 'utf8'),
  };
}
function noteMeta(backup, fields) {
  const item = backup.notes[0], match = item.raw.match(/^---\n([\s\S]*?)\n---\n/);
  item.raw = `---\n${YAML.stringify({ ...YAML.parse(match[1]), ...fields })}---\n${item.raw.slice(match[0].length)}`;
}

test('invalid backup payloads leave Markdown, runtime records, indexes and history untouched', t => {
  const h = harness(t), original = h.store.backup(), before = snapshot(h);
  // A pending external edit must not be scanned into the live DB on failed preview.
  fs.writeFileSync(path.join(h.vaultDir, h.note.path), before.raw.replace('原正文', '外部改动尚未扫描'));
  const current = snapshot(h);
  const cases = [
    b => { b.version = 2; },
    b => { b.notes[0].raw = '---\nkind: knowledge\n'; },
    b => { b.notes[0].raw = '---\n- scalar\n---\n正文'; },
    b => { b.notes[0].raw = b.notes[0].raw.replace('privacy: local', 'privacy: unsafe'); },
    b => { b.notes[0].raw = b.notes[0].raw.replace('kind: knowledge', 'kind: unsupported'); },
    b => { b.notes[0].raw = b.notes[0].raw.replace('id: current-note', 'id: other-note'); },
    b => noteMeta(b, { relations: [null] }),
    b => noteMeta(b, { kind: 'topic', noteIds: 'malformed' }),
    b => { b.notes.push(structuredClone(b.notes[0])); },
    b => { b.notes.push({ ...b.notes[0], id: 'another', path: b.notes[0].path.toUpperCase() }); },
    b => { b.notes[0].path = '../escape.md'; },
    b => { b.notes[0].path = 'NUL.md'; },
    b => { b.notes[0].path = 'folder/\u0001.md'; },
    b => { b.records[0].json = 'null'; },
    b => { b.records[0].json = '{invalid'; },
    b => { b.records.push(structuredClone(b.records[0])); },
    b => { b.records.push({ namespace: 'jobs', key: 'broken', json: JSON.stringify({ id: 'broken', state: 'running', payload: null }) }); },
    b => { b.records.push({ namespace: 'vaultRelations', key: 'broken', json: JSON.stringify({ id: 'broken', ownerIds: null }) }); },
    b => { b.records.push({ namespace: 'askRequests', key: 'broken', json: JSON.stringify({ id: 'broken', input: { question: '合成问题' }, completed: true }) }); },
    b => { const at = new Date().toISOString(); b.records.push({ namespace: 'callLedger', key: 'incomplete', json: JSON.stringify({ id: 'incomplete', phase: 'received', capability: 'model', model: 'model', reservedCost: null, createdAt: at, updatedAt: at }) }); },
    b => { const at = new Date().toISOString(); b.records.push({ namespace: 'callLedger', key: 'missing-cost', json: JSON.stringify({ id: 'missing-cost', phase: 'unknown', capability: 'model', model: 'model', reservedCost: null, createdAt: at, updatedAt: at }) }); },
    b => { b.versions[0].hash = '0'.repeat(64); },
    b => { b.versions[0].raw = '---\npaused: wrong\n---\n正文'; b.versions[0].hash = hash(b.versions[0].raw); },
    b => { b.versions[0].createdAt = 'invalid'; },
    b => { b.preferences = []; },
    b => { b.scope.attachments = true; },
  ];
  for (const mutate of cases) {
    const candidate = structuredClone(original); mutate(candidate);
    assert.throws(() => h.store.validateBackup(candidate));
    assert.throws(() => h.store.restore(candidate));
    assert.deepEqual(snapshot(h), current);
    assert.equal(fs.existsSync(path.join(h.dataDir, 'backups')), false);
  }
});

test('submitted ask intent and prepared state round-trip without accepting malformed references', t => {
  const h = harness(t), input = { question: '合成问题', scope: ['knowledge','source'], mode: 'answer', privacy: 'cloud' };
  const initial = { id: 'initial-ask', input, draftId: 'initial-draft', createdAt: new Date().toISOString() };
  const prepared = { ...initial, id: 'prepared-ask', basisHash: 'a'.repeat(64), prepared: { generated: true, references: [{ id: h.note.id, hash: h.note.hash, cloud: true }], citations: [{ id: h.note.id, title: h.note.title, excerpt: h.note.body, sources: [] }], limitations: [] } };
  h.store.put('askRequests', initial.id, initial);
  h.store.put('askRequests', prepared.id, prepared);
  const backup = h.store.backup();
  h.store.restore(backup);
  assert.deepEqual(h.store.get('askRequests', initial.id), initial);
  assert.deepEqual(h.store.get('askRequests', prepared.id), prepared);
  const malformed = structuredClone(backup), row = malformed.records.find(r => r.key === prepared.id);
  const value = JSON.parse(row.json); value.prepared.references[0].cloud = 'yes'; row.json = JSON.stringify(value);
  assert.throws(() => h.store.validateBackup(malformed), /问答准备状态/);
  const invalidIdentity = structuredClone(backup), initialRow = invalidIdentity.records.find(r => r.key === initial.id);
  initialRow.json = JSON.stringify({ ...initial, callId: '../foreign-call' });
  assert.throws(() => h.store.validateBackup(invalidIdentity), /问答完成调用身份/);
});

test('inconsistent relationship mirrors and file collisions fail during preview without scanning current edits', t => {
  const h = harness(t), backup = h.store.backup(), before = snapshot(h);
  noteMeta(backup, { relations: [{ id: 'relation', fromId: 'current-note', toId: 'missing-note', state: 'accepted' }] });
  assert.throws(() => h.store.validateBackup(backup), { code: 'RESTORE_CONFLICT' });
  assert.deepEqual(snapshot(h), before);
  const collision = h.store.backup(); collision.notes[0].path = 'assets/current.md';
  fs.writeFileSync(path.join(h.vaultDir, 'assets'), '附件原文');
  assert.throws(() => h.store.restore(collision), { code: 'RESTORE_CONFLICT' });
  assert.deepEqual(snapshot(h), before);
});

test('restored settings share the files and records transaction, including rollback on settings failure', t => {
  const h = harness(t), backup = h.store.backup(), oldSettings = { timezone: 'Asia/Shanghai' };
  h.store.put('settings', 'main', oldSettings);
  backup.notes[0].raw = backup.notes[0].raw.replace('原正文', '新正文');
  const before = snapshot(h), originalPut = h.store.put;
  h.store.put = function (namespace, key, value) { if (namespace === 'settings') throw new Error('settings write failed'); return originalPut.call(this, namespace, key, value); };
  assert.throws(() => h.store.restore(backup, { settings: { timezone: 'UTC' } }), /settings write failed/);
  h.store.put = originalPut;
  assert.deepEqual(snapshot(h), before);
  const result = h.store.restore(backup, { settings: { timezone: 'UTC' } });
  assert.equal(result.restored, true);
  assert.equal(h.store.read(h.note.id).body, '新正文');
  assert.deepEqual(h.store.get('settings', 'main'), { timezone: 'UTC' });
  assert.deepEqual(JSON.parse(fs.readFileSync(result.safetyBackup)).preferences, oldSettings);
});

test('restoring older backups preserves local billing evidence and imports other historical calls', t => {
  const h = harness(t), backup = h.store.backup(), at = new Date().toISOString();
  const ledger = { id: 'local-call', phase: 'unknown', capability: 'model', model: 'model', reservedCost: null, createdAt: at, updatedAt: at };
  const currentCall = { id: 'local-call', createdAt: at, cost: 2 };
  h.store.put('callLedger', ledger.id, ledger); h.store.put('calls', currentCall.id, currentCall);
  backup.records.push({ namespace: 'callLedger', key: 'local-call', json: JSON.stringify({ ...ledger, phase: 'accounted' }) });
  backup.records.push({ namespace: 'callResults', key: 'local-call', json: JSON.stringify({ id: 'local-call', response: { status: 200, body: '{}', headers: {} }, entry: { capability: 'model', model: 'model', cost: 0, ok: true, durationMs: 1 }, receivedAt: at }) });
  backup.records.push({ namespace: 'calls', key: 'local-call', json: JSON.stringify({ ...currentCall, cost: 0 }) });
  backup.records.push({ namespace: 'calls', key: 'imported-call', json: JSON.stringify({ id: 'imported-call', createdAt: at, cost: 1 }) });
  h.store.restore(backup);
  assert.deepEqual(h.store.get('callLedger', 'local-call'), ledger);
  assert.equal(h.store.get('callResults', 'local-call'), null, 'incoming response must not resolve a different local unknown call with a colliding identity');
  assert.deepEqual(h.store.get('calls', 'local-call'), currentCall);
  assert.equal(h.store.get('calls', 'imported-call').cost, 1);
});

test('restore keeps local logical-call evidence when a different machine uses a different call id', t => {
  for (const grade of [false, true]) {
    const h = harness(t), backup = h.store.backup(), at = new Date().toISOString();
    const local = { id: 'local-unknown', phase: 'unknown', capability: 'model', model: 'model', reservedCost: null,
      key: hash('local-request'), contextKey: hash('original-task'), ...(grade ? { turnId: 'original-turn' } : {}), createdAt: at, updatedAt: at };
    h.store.put('callLedger', local.id, local);
    h.store.put('calls', local.id, { id: local.id, createdAt: at, cost: null });
    const addRemote = (id, key, contextKey) => {
      const ledger = { ...local, id, key, contextKey, phase: 'accounted' };
      const result = { id, response: { status: 200, body: '{}', headers: {} }, entry: { capability: 'model', model: 'model', cost: 1, ok: true, durationMs: 1 }, receivedAt: at };
      for (const [namespace, value] of [['callLedger', ledger], ['calls', { id, createdAt: at, cost: 1 }], ['callResults', result]]) backup.records.push({ namespace, key: id, json: JSON.stringify(value) });
    };
    addRemote('foreign-same-operation', grade ? hash('changed-model-and-prompt') : local.key, local.contextKey);
    addRemote('foreign-unrelated-operation', hash('unrelated-request'), hash('unrelated-task'));
    if (!grade) addRemote('foreign-other-step', hash('other-request-in-same-task'), local.contextKey);
    h.store.restore(backup);
    assert.deepEqual(h.store.get('callLedger', local.id), local);
    const recovery = createCallLedger({ store: h.store });
    assert.throws(() => recovery.replay(grade ? hash('changed-model-and-prompt') : local.key, { contextKey: local.contextKey, singleRequest: grade }), { code: 'CALL_RECOVERY_REQUIRED' });
    assert.equal(recovery.listPending().find(row => row.id === local.id).phase, 'unknown');
    assert.equal(h.store.get('calls', local.id).cost, null);
    for (const namespace of ['callLedger','calls','callResults']) assert.equal(h.store.get(namespace, 'foreign-same-operation'), null, `${namespace} must not import a different attempt over local logical evidence`);
    assert.equal(h.store.get('callLedger', 'foreign-unrelated-operation').phase, 'accounted');
    if (!grade) assert.equal(h.store.get('callLedger', 'foreign-other-step').phase, 'accounted', 'different requests of a multi-step task remain importable');
  }
});

test('backup and restore accept a maximum-size escaped fetch response while keeping decoded and other record limits', t => {
  const h = harness(t), at = new Date().toISOString(), body = '"\\'.repeat(3 * 1024 * 1024 / 2), id = 'large-fetch';
  const ledger = { id, phase: 'accounted', capability: 'fetch', model: null, reservedCost: 0, createdAt: at, updatedAt: at };
  const result = { id, response: { status: 200, body, headers: { 'content-type': 'text/html' } }, entry: { capability: 'fetch', model: null, cost: 0, ok: true, durationMs: 1 }, receivedAt: at };
  assert.equal(Buffer.byteLength(body), 3 * 1024 * 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) > 5_000_000);
  h.store.put('callLedger', id, ledger); h.store.put('calls', id, { id, createdAt: at, cost: 0 }); h.store.put('callResults', id, result);
  const controlId = 'control-fetch', controlResult = { ...result, id: controlId, response: { ...result.response, body: '\u0000'.repeat(3 * 1024 * 1024) } };
  h.store.put('callLedger', controlId, { ...ledger, id: controlId });
  h.store.put('calls', controlId, { id: controlId, createdAt: at, cost: 0 });
  h.store.put('callResults', controlId, controlResult);
  const backup = JSON.parse(assertBackupSize(h.store.backup()));
  const target = harness(t);
  target.store.restore(backup);
  assert.equal(target.store.get('callResults', id).response.body, body);
  assert.equal(target.store.get('callResults', controlId).response.body, controlResult.response.body, 'six-byte JSON control escapes also fit the accepted decoded body limit');
  const oversizedBody = structuredClone(backup);
  oversizedBody.records.find(row => row.namespace === 'callResults').json = JSON.stringify({ ...result, response: { ...result.response, body: body + 'x' } });
  assert.throws(() => target.store.validateBackup(oversizedBody), /备份调用响应无效/);
  const oversizedOther = structuredClone(backup);
  oversizedOther.records.push({ namespace: 'extra', key: 'large-other', json: JSON.stringify({ text: 'x'.repeat(5_000_000) }) });
  assert.throws(() => target.store.validateBackup(oversizedOther), /备份运行记录不正确/);
});

test('scan participates in an enclosing settings transaction without committing it', t => {
  const h = harness(t), before = snapshot(h);
  fs.writeFileSync(path.join(h.vaultDir, h.note.path), before.raw.replace('原正文', '外部变更'));
  h.store.db.exec('BEGIN IMMEDIATE'); h.store.scan();
  assert.equal(h.store.read(h.note.id).body, '外部变更');
  h.store.db.exec('ROLLBACK');
  assert.equal(h.store.read(h.note.id).body, '原正文');
});

test('a failed rollback blocks further reads and writes, then safely recovers on restart from intact original copies', t => {
  const h = harness(t), backup = h.store.backup(), rename = fs.renameSync;
  let installationFailed = false;
  fs.renameSync = function (from, to) {
    if (String(from).includes(`${path.sep}incoming${path.sep}`) && !String(to).includes('.learning-restore-')) { installationFailed = true; throw new Error('install failure'); }
    if (installationFailed && String(from).includes(`${path.sep}previous${path.sep}`)) throw new Error('rollback failure');
    return rename.call(fs, from, to);
  };
  let failure;
  try { assert.throws(() => h.store.restore(backup), error => { failure = error; return error.code === 'RESTORE_ROLLBACK_FAILED'; }); }
  finally { fs.renameSync = rename; }
  assert.ok(fs.existsSync(failure.safetyBackup));
  assert.ok(fs.existsSync(path.join(failure.recoveryPath, 'manifest.json')));
  assert.throws(() => h.store.read(h.note.id), { code: 'RESTORE_ROLLBACK_FAILED' });
  assert.throws(() => h.store.put('sessions', 'new', { id: 'new' }), { code: 'RESTORE_ROLLBACK_FAILED' });
  assert.throws(() => h.store.scan(), { code: 'RESTORE_ROLLBACK_FAILED' });
  const recovered = new Store({ dataDir: h.dataDir, vaultDir: h.vaultDir });
  assert.equal(recovered.read(h.note.id).body, '原正文');
  assert.deepEqual(recovered.get('sessions', 'answer'), { id: 'answer', answer: '保留回答' });
  recovered.close();
});

test('an external edit during failed restore survives rollback and blocks automatic recovery', t => {
  const h = harness(t), backup = h.store.backup(), originalPut = h.store.put;
  backup.notes[0].raw = backup.notes[0].raw.replace('原正文', '备份正文');
  const file = path.join(h.vaultDir, h.note.path);
  let externalRaw;
  h.store.put = function (namespace, key, value) {
    if (namespace === 'settings') {
      externalRaw = fs.readFileSync(file, 'utf8').replace('备份正文', '外部编辑器新正文');
      fs.writeFileSync(file, externalRaw);
      throw new Error('settings write failed after external edit');
    }
    return originalPut.call(this, namespace, key, value);
  };
  assert.throws(() => h.store.restore(backup, { settings: { timezone: 'UTC' } }), { code: 'RESTORE_ROLLBACK_FAILED' });
  assert.equal(fs.readFileSync(file, 'utf8'), externalRaw);
  assert.throws(() => h.store.scan(), { code: 'RESTORE_ROLLBACK_FAILED' });
  assert.throws(() => new Store({ dataDir: h.dataDir, vaultDir: h.vaultDir }), { code: 'RESTORE_RECOVERY_REQUIRED' });
  assert.equal(fs.readFileSync(file, 'utf8'), externalRaw);
});

test('capacity counts final escaped UTF-8 JSON equally for export and restore', t => {
  const h = harness(t), text = '"'.repeat(2_300_000);
  // Each inner record JSON is under 5 MB, but the outer JSON escapes it again.
  for (let i = 0; i < 11; i++) h.store.put('extra', `large-${i}`, { text });
  assert.throws(() => h.store.backup(), { code: 'TOO_LARGE', status: 413 });
  const backup = { format: 'learning-workbench-backup', version: 1, notes: [], versions: [], records: h.store.db.prepare("SELECT * FROM records WHERE namespace='extra'").all() };
  assert.throws(() => h.store.validateBackup(backup), { code: 'TOO_LARGE', status: 413 });
  assert.ok(BACKUP_REQUEST_MAX_BYTES > BACKUP_MAX_BYTES);
  assert.equal(assertBackupSize({ preferences: { title: '中文' } }), JSON.stringify({ preferences: { title: '中文' } }));
});

for (const phase of ['replacing-files','files-installed','database-committed','external-change','manifest-change','recovery-kill']) test(`a killed Node process at ${phase} recovers only from matching commit and file evidence`, t => {
  const root = fs.mkdtempSync(path.join(tempRoot, 'backup-kill-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'data'), vaultDir = path.join(root, 'vault');
  const storeURL = new URL('../src/store.mjs', import.meta.url).href;
  const killPhase = ['external-change','manifest-change','recovery-kill'].includes(phase) ? 'files-installed' : phase;
  const script = `
    import fs from 'node:fs'; import path from 'node:path'; import { Store } from ${JSON.stringify(storeURL)};
    const store = new Store(${JSON.stringify({ dataDir, vaultDir })});
    store.create({ id: 'original', kind: 'source', title: '原资料', body: '原正文', meta:{platform:'合成来源',author:'合成作者',url:'https://example.com/source'} });
    store.put('sessions','old-answer',{id:'old-answer',answer:'原回答'});
    const backup = store.backup(); backup.notes[0].raw = backup.notes[0].raw.replace('原正文','新正文');
    backup.records = [{namespace:'sessions',key:'new-answer',json:JSON.stringify({id:'new-answer',answer:'新回答'})}];
    const oldRename = fs.renameSync, oldFsync = fs.fsyncSync;
    fs.renameSync = function(from,to) {
      const result = oldRename.call(fs,from,to);
      if (${JSON.stringify(killPhase)} === 'replacing-files' && String(to).includes(path.sep+'previous'+path.sep)) process.kill(process.pid,'SIGKILL');
      return result;
    };
    fs.fsyncSync = function(fd) {
      const result = oldFsync.call(fs,fd);
      for (const name of fs.readdirSync(${JSON.stringify(vaultDir)}).filter(name=>name.startsWith('.learning-restore-'))) {
        const manifestFile=path.join(${JSON.stringify(vaultDir)},name,'manifest.json');
        if (fs.existsSync(manifestFile) && JSON.parse(fs.readFileSync(manifestFile)).phase === ${JSON.stringify(killPhase)} && ${JSON.stringify(killPhase)} !== 'replacing-files') process.kill(process.pid,'SIGKILL');
      }
      return result;
    };
    store.restore(backup); process.exit(22);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { timeout: 30_000, encoding: 'utf8' });
  assert.equal(result.error, undefined); assert.notEqual(result.status, 0); assert.notEqual(result.status, 22, result.stderr);
  const stage = fs.readdirSync(vaultDir).find(name => name.startsWith('.learning-restore-'));
  assert.ok(stage, result.stderr);
  const manifestFile = path.join(vaultDir, stage, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile));
  assert.equal(manifest.phase, killPhase); assert.ok(fs.existsSync(manifest.safetyBackup));
  const db = new DatabaseSync(path.join(dataDir, 'learning.sqlite'));
  const before = db.prepare('SELECT * FROM notes').all(), records = db.prepare('SELECT * FROM records').all(), versions = db.prepare('SELECT * FROM versions').all();
  const committed = phase === 'database-committed';
  assert.equal(JSON.parse(before[0].json).body, committed ? '新正文' : '原正文');
  assert.ok(records.some(row => row.namespace === 'sessions' && row.key === (committed ? 'new-answer' : 'old-answer')));
  if (phase === 'external-change' || phase === 'manifest-change') {
    const currentFile = path.join(vaultDir, ...manifest.incoming[0].path.split('/'));
    const changed = fs.readFileSync(currentFile, 'utf8').replace('新正文', phase === 'external-change' ? '外部作者新改动' : '新正文');
    if (phase === 'external-change') fs.writeFileSync(currentFile, changed);
    else fs.writeFileSync(manifestFile, JSON.stringify({ ...manifest, safetyBackup: '外部篡改过的阶段记录' }));
    assert.throws(() => new Store({ dataDir, vaultDir }), error => error.code === 'RESTORE_RECOVERY_REQUIRED' && error.manifestPath === manifestFile);
    assert.equal(fs.readFileSync(currentFile, 'utf8'), changed);
    assert.deepEqual(db.prepare('SELECT * FROM notes').all(), before);
    assert.deepEqual(db.prepare('SELECT * FROM records').all(), records);
    assert.deepEqual(db.prepare('SELECT * FROM versions').all(), versions);
    assert.ok(fs.existsSync(manifestFile));
  } else {
    if (phase === 'recovery-kill') {
      const recoveryScript = `
        import fs from 'node:fs'; import { Store } from ${JSON.stringify(storeURL)};
        const oldFsync=fs.fsyncSync;
        fs.fsyncSync=function(fd){const result=oldFsync(fd);process.kill(process.pid,'SIGKILL');return result;};
        new Store(${JSON.stringify({ dataDir,vaultDir })});process.exit(22);
      `;
      const second = spawnSync(process.execPath, ['--input-type=module','-e',recoveryScript], { timeout: 30_000, encoding: 'utf8' });
      assert.equal(second.error, undefined); assert.notEqual(second.status, 0); assert.notEqual(second.status, 22, second.stderr);
      assert.ok(fs.existsSync(manifestFile));
      assert.ok(fs.existsSync(path.join(vaultDir, stage, 'previous', ...manifest.previous[0].path.split('/'))));
    }
    const recovered = new Store({ dataDir, vaultDir });
    assert.equal(recovered.read('original').body, committed ? '新正文' : '原正文');
    assert.equal(recovered.read('original').meta.platform, '合成来源');
    assert.equal(recovered.read('original').meta.author, '合成作者');
    assert.equal(recovered.read('original').meta.url, 'https://example.com/source');
    assert.deepEqual(recovered.db.prepare('SELECT * FROM notes').all(), before);
    assert.deepEqual(recovered.db.prepare('SELECT * FROM records').all(), records);
    assert.deepEqual(recovered.db.prepare('SELECT * FROM versions').all(), versions);
    assert.ok(recovered.history('original')[0].raw.endsWith('原正文'));
    assert.equal(fs.existsSync(manifestFile), false);
    assert.equal(recovered.db.prepare('SELECT count(*) count FROM restore_transactions').get().count, 0);
    recovered.close();
  }
  db.close();
});
