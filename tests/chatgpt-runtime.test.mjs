import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createPolicy, healthUrl, classifyDiagnostic, readLiveStatus, writeReceipt, runSupervisor, query } from '../scripts/chatgpt-runtime.mjs';

test('a running web service starts its missing tunnel', () => {
  const p = createPolicy();
  assert.equal(p.step({ now: 0, backend: true, alive: false, ready: false }), 'start');
  assert.equal(p.step({ now: 10000, backend: true, alive: true, ready: true }), 'ready');
});

test('Windows cold launcher returns with a running detached supervisor and warm launch reuses it', { skip: process.platform !== 'win32' }, async () => {
  fs.mkdirSync('.tmp', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('.tmp/chatgpt-cold-start-'));
  const configPath = path.join(root, 'runtime.json');
  const formalConfigPath = path.join(root, 'formal.json');
  const stopFile = path.join(root, 'stop');
  const runtimeUrl = new URL('../scripts/chatgpt-runtime.mjs', import.meta.url).href;
  fs.copyFileSync('scripts/Ensure-ChatgptRuntime.ps1', path.join(root, 'Ensure-ChatgptRuntime.ps1'));
  fs.writeFileSync(formalConfigPath, JSON.stringify({ port: 4318, sourceSha: 'b'.repeat(40), appRoot: root, dataDir: root }));
  fs.writeFileSync(configPath, JSON.stringify({ formalConfigPath, stateRoot: root, nodePath: process.execPath, pollMs: 30,
    tunnelClientPath: process.execPath, profileFile: path.join(root, 'unused.yaml'), credentialEnvFile: path.join(root, 'unused.env') }));
  fs.writeFileSync(path.join(root, 'chatgpt-runtime.mjs'), `import {runSupervisor,query} from ${JSON.stringify(runtimeUrl)};
    import fs from 'node:fs'; import {spawn} from 'node:child_process';
    const config=process.argv[2];
    if(process.argv[3]==='run') await runSupervisor(config,{backendProbe:async()=>true,tunnelProbe:async()=>true,stop:()=>fs.existsSync(${JSON.stringify(stopFile)}),launch:()=>spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:['ignore','pipe','pipe']})});
    else {let s; const until=Date.now()+(process.argv.includes('--wait-ready')?4000:0); do {try{s=await query(config)}catch{s={phase:'unavailable',tunnelReady:false}}; if(s.tunnelReady||Date.now()>=until)break; await new Promise(r=>setTimeout(r,20));}while(true);console.log(JSON.stringify(s));}`);
  const args = ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'Ensure-ChatgptRuntime.ps1'),'-ConfigPath',configPath,'-WaitReady'];
  try {
    const execute = promisify(execFile);
    const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const cold = await execute(powershell, args, { windowsHide: true, timeout: 12000 });
    const first = JSON.parse(cold.stdout.trim());
    assert.equal(first.tunnelReady, true);
    const warm = await execute(powershell, args, { windowsHide: true, timeout: 6000 });
    assert.equal(JSON.parse(warm.stdout.trim()).supervisorPid, first.supervisorPid);
  } finally {
    fs.writeFileSync(stopFile, 'stop synthetic owner');
    for (let n=0;n<100;n++) { try { await query(configPath); await new Promise(resolve=>setTimeout(resolve,50)); } catch { break; } }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('web readiness alone never declares plugin readiness', () => {
  const p = createPolicy();
  p.step({ now: 0, backend: true, alive: false });
  assert.equal(p.step({ now: 10000, backend: true, alive: true, ready: false }), 'waiting');
  assert.equal(p.step({ now: 91000, backend: true, alive: true, ready: false }), 'restart');
});
test('crashed tunnels retry with backoff and rate limits preserve a cooldown', () => {
  const p = createPolicy();
  p.step({ now: 0, backend: true, alive: false });
  assert.equal(p.step({ now: 100, backend: true, alive: false }), 'cooldown');
  assert.equal(p.step({ now: 1000, backend: true, alive: false }), 'cooldown');
  assert.equal(p.step({ now: 11000, backend: true, alive: false }), 'start');
  p.diagnostic('UPSTREAM_RATE_LIMIT', 12000);
  assert.equal(p.step({ now: 13000, backend: true, alive: true, ready: true }), 'restart');
  assert.equal(p.step({ now: 14000, backend: true, alive: false }), 'cooldown');
  assert.equal(p.step({ now: 71000, backend: true, alive: false }), 'cooldown');
  assert.equal(p.step({ now: 73000, backend: true, alive: false }), 'start');
});
test('backend outage stops only the owned tunnel and waits without retry storms', () => {
  const p = createPolicy();
  p.step({ now: 0, backend: true, alive: false });
  assert.equal(p.step({ now: 1, backend: false, alive: true }), 'stop');
  assert.equal(p.step({ now: 10000, backend: false, alive: false }), 'backend-unavailable');
  assert.equal(p.step({ now: 20000, backend: true, alive: false }), 'start');
});
test('brief readiness does not reset repeated failure backoff', () => {
  const p = createPolicy();
  p.step({ now: 0, backend: true, alive: false });
  p.step({ now: 1000, backend: true, alive: true, ready: true });
  p.step({ now: 2000, backend: true, alive: false });
  p.step({ now: 13000, backend: true, alive: false });
  p.step({ now: 14000, backend: true, alive: true, ready: true });
  p.step({ now: 15000, backend: true, alive: false });
  assert.equal(p.step({ now: 26000, backend: true, alive: false }), 'cooldown');
});
test('only plain loopback health URLs are accepted', () => {
  assert.equal(healthUrl('http://127.0.0.1:1234/').href, 'http://127.0.0.1:1234/readyz');
  for (const u of ['https://127.0.0.1/', 'http://evil.test/', 'http://user:pw@127.0.0.1/', 'http://127.0.0.1/x', 'http://127.0.0.1/?secret=1']) {
    assert.throws(() => healthUrl(u));
  }
});
test('diagnostics retain categories but no raw credentials or payloads', () => {
  assert.equal(classifyDiagnostic('HTTP 429 sk-fake-private'), 'UPSTREAM_RATE_LIMIT');
  assert.equal(classifyDiagnostic('status_code=401 bearer secret'), 'UPSTREAM_AUTH');
  assert.equal(classifyDiagnostic('token=secret note content'), null);
});
test('stale ready receipts and dead supervisors are never live ready', () => {
  const s = { phase: 'ready', updatedAt: new Date(1000).toISOString(), backendReady: true, tunnelReady: true };
  assert.equal(readLiveStatus(s, 100000).phase, 'unavailable');
  assert.equal(readLiveStatus(s, 1001).phase, 'ready');
  assert.equal(readLiveStatus(s, 1001, false).tunnelReady, false);
});
test('a locked diagnostic receipt does not terminate a healthy tunnel', () => {
  let cleaned = false;
  const io = { writeFileSync() {}, renameSync() { throw Object.assign(Error('busy'), { code: 'EPERM' }); }, rmSync() { cleaned = true; } };
  assert.equal(writeReceipt('synthetic-status.json', { phase: 'ready' }, io), false);
  assert.equal(cleaned, true);
});

test('real pipe singleton survives tunnel crash and unhealthy live children without touching a backend', async () => {
  fs.mkdirSync('.tmp', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('.tmp/chatgpt-runtime-'));
  const configPath = path.join(root, 'runtime.json');
  const formalConfigPath = path.join(root, 'formal.json');
  fs.writeFileSync(formalConfigPath, JSON.stringify({ port: 4318, sourceSha: 'a'.repeat(40), appRoot: root, dataDir: root }));
  fs.writeFileSync(configPath, JSON.stringify({ formalConfigPath, stateRoot: root, nodePath: process.execPath,
    tunnelClientPath: process.execPath, profileFile: path.join(root, 'unused.yaml'), credentialEnvFile: path.join(root, 'unused.env') }));
  let launches = 0, clock = 0, stop = false, stage = 0, ready = true, crashed, receiptWrites = 0;
  const children = [];
  try {
    await runSupervisor(configPath, {
      backendProbe: async () => true, tunnelProbe: async () => ready, now: () => clock, stop: () => stop,
      writeReceipt: (file, status) => ++receiptWrites === 2 ? false : writeReceipt(file, status),
      launch: () => { launches++; const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: ['ignore','pipe','pipe'] }); children.push(child); return child; },
      sleep: async () => {
        clock += 11000;
        await new Promise(resolve => setTimeout(resolve, 30));
        const s = await query(configPath);
        if (stage === 0 && s.phase === 'ready') {
          await runSupervisor(configPath, { launch: () => { throw Error('DUPLICATE_LAUNCH'); } });
          assert.equal(launches, 1);
          crashed = s.tunnelPid; children.at(-1).kill(); await once(children.at(-1), 'exit'); stage = 1;
        } else if (stage === 1 && s.phase === 'ready' && s.starts === 2) {
          assert.notEqual(s.tunnelPid, crashed); ready = false; stage = 2;
        } else if (stage === 2 && s.phase === 'restart') {
          assert.equal(s.tunnelReady, false); ready = true; stage = 3;
        } else if (stage === 3 && s.phase === 'ready' && s.starts === 3) { stage = 4; stop = true; }
        assert.ok(clock < 600000, `Recovery stuck at stage ${stage}: ${s.phase}`);
      },
    });
    assert.equal(stage, 4);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'status.json'))).phase, 'stopped');
    await assert.rejects(query(configPath));
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
