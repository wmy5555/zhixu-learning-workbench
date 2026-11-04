import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
export function healthUrl(value) {
  const u = new URL(value.trim());
  if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw Error('INVALID_HEALTH_URL');
  return new URL('/readyz', u);
}
export function classifyDiagnostic(line) {
  if (/(?:HTTP|status(?:_code)?|code)[^\d]{0,12}429\b|too many requests|rate.limit/i.test(line)) return 'UPSTREAM_RATE_LIMIT';
  if (/(?:HTTP|status(?:_code)?|code)[^\d]{0,12}(?:401|403)\b/i.test(line)) return 'UPSTREAM_AUTH';
  return null;
}
export function readLiveStatus(s, now = Date.now(), alive = true) {
  const age = now - Date.parse(s.updatedAt);
  if (!alive || !Number.isFinite(age) || age < 0 || age > 25000) return { ...s, phase: 'unavailable', backendReady: false, tunnelReady: false };
  return s;
}
export function writeReceipt(file, status, io = fs) {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    io.writeFileSync(temporary, JSON.stringify(status, null, 2));
    io.renameSync(temporary, file);
    return true;
  } catch {
    // OneDrive/antivirus may briefly hold the diagnostic file. The live pipe
    // remains authoritative; a diagnostic failure must not drop a healthy tunnel.
    try { io.rmSync(temporary, { force: true }); } catch { /* Only our temporary receipt. */ }
    return false;
  }
}
export function createPolicy() {
  let active = false, failures = 0, unhealthyAt = null, healthyAt = null, forcedStop = false;
  let nextRetryAt = 0;
  const fail = now => { active = false; healthyAt = null; unhealthyAt = null; nextRetryAt = Math.max(nextRetryAt, now + Math.min(300000, 10000 * 2 ** Math.min(failures++, 5))); };
  return {
    get nextRetryAt() { return nextRetryAt; },
    diagnostic(code, now) {
      forcedStop = true;
      fail(now);
      nextRetryAt = Math.max(nextRetryAt, now + (code === 'UPSTREAM_AUTH' ? 300000 : 60000));
    },
    step({ now, backend, alive, ready = false }) {
      if (forcedStop) { forcedStop = false; return alive ? 'restart' : 'cooldown'; }
      if (!backend) { active = false; healthyAt = null; unhealthyAt = null; return alive ? 'stop' : 'backend-unavailable'; }
      if (!alive) {
        if (active) fail(now);
        if (now < nextRetryAt) return 'cooldown';
        active = true; unhealthyAt = now; return 'start';
      }
      if (ready) {
        unhealthyAt = null;
        healthyAt ??= now;
        if (now - healthyAt >= 60000) failures = 0;
        return 'ready';
      }
      healthyAt = null; unhealthyAt ??= now;
      if (now - unhealthyAt >= 90000) { fail(now); return 'restart'; }
      return 'waiting';
    },
  };
}
function pipeName(configPath) {
  const id = createHash('sha256').update(path.resolve(configPath).toLowerCase()).digest('hex').slice(0, 20);
  return process.platform === 'win32' ? `\\\\.\\pipe\\zhixu-chatgpt-${id}` : path.join(path.dirname(configPath), `runtime-${id}.sock`);
}
export async function query(configPath) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(pipeName(configPath));
    let bytes = '';
    socket.setTimeout(2000, () => socket.destroy(Error('RUNTIME_STATUS_TIMEOUT')));
    socket.on('data', data => { bytes += data; if (bytes.length > 16384) socket.destroy(Error('INVALID_STATUS')); });
    socket.on('end', () => { try { resolve(readLiveStatus(JSON.parse(bytes))); } catch { reject(Error('INVALID_STATUS')); } });
    socket.on('error', reject);
  });
}
async function httpReady(url) {
  try { return (await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(2000) })).status === 200; } catch { return false; }
}
function formalConfig(config) {
  const formal = readJson(config.formalConfigPath);
  if (formal.port !== 4318 || !/^[a-f0-9]{40}$/.test(formal.sourceSha) || !path.isAbsolute(formal.appRoot) || !path.isAbsolute(formal.dataDir)) throw Error('INVALID_FORMAL_CONFIGURATION');
  return formal;
}
function runtimeKey(config) {
  // Existing tunnel credential stays inside the runtime; never log or copy it.
  const entries = fs.readFileSync(config.credentialEnvFile, 'utf8').split(/\r?\n/).filter(line => line.startsWith(`${config.credentialEnvName}=`));
  if (entries.length !== 1) throw Error('RUNTIME_CREDENTIAL_UNAVAILABLE');
  let value = entries[0].slice(config.credentialEnvName.length + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  if (value.length < 16 || /[\r\n]/.test(value)) throw Error('RUNTIME_CREDENTIAL_INVALID');
  return value;
}
export async function runSupervisor(configPath, dependencies = {}) {
  const config = readJson(configPath);
  for (const key of ['formalConfigPath', 'stateRoot', 'nodePath', 'tunnelClientPath', 'profileFile', 'credentialEnvFile']) {
    if (!path.isAbsolute(config[key] ?? '')) throw Error('ABSOLUTE_RUNTIME_PATH_REQUIRED');
  }
  fs.mkdirSync(config.stateRoot, { recursive: true });
  let status = { phase: 'starting', backendReady: false, tunnelReady: false, updatedAt: new Date().toISOString() };
  const server = net.createServer(socket => { socket.on('error', () => {}); socket.end(JSON.stringify(readLiveStatus(status))); });
  const acquired = await new Promise((resolve, reject) => {
    server.once('error', e => e.code === 'EADDRINUSE' ? resolve(false) : reject(e));
    server.listen(pipeName(configPath), () => resolve(true));
  });
  if (!acquired) return;
  const policy = createPolicy();
  let child, stopping = false, starts = 0, sourceSha, lastCode = null, lastSource;
  const alive = () => child && !child.failed && child.exitCode === null && child.signalCode === null;
  let verifiedSource;
  const probeBackend = dependencies.backendProbe ?? (async formal => {
    if (!await httpReady('http://127.0.0.1:4318/api/session')) { verifiedSource = null; return false; }
    if (verifiedSource === formal.sourceSha) return true;
    try {
      const response = await fetch('http://127.0.0.1:4318/app.mjs', { redirect: 'error', signal: AbortSignal.timeout(2000) });
      if (response.status !== 200 || createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex') !== formal.appSha256) return false;
      verifiedSource = formal.sourceSha;
      return true;
    } catch { return false; }
  });
  const probeTunnel = dependencies.tunnelProbe ?? (async () => {
    try { return await httpReady(healthUrl(fs.readFileSync(path.join(config.stateRoot, 'health.url'), 'utf8'))); } catch { return false; }
  });
  const wait = dependencies.sleep ?? sleep;
  const now = dependencies.now ?? Date.now;
  const publishReceipt = dependencies.writeReceipt ?? writeReceipt;
  const stopChild = async () => {
    if (!alive()) return;
    // Only this supervisor's child tree; never enumerate/kill other tunnels.
    if (process.platform === 'win32') {
      await exec(path.join(process.env.SystemRoot, 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => { if (alive()) throw Error('OWNED_TUNNEL_STOP_FAILED'); });
    } else child.kill('SIGTERM');
    for (let i = 0; i < 40 && alive(); i++) await sleep(50);
    if (alive()) throw Error('OWNED_TUNNEL_STOP_FAILED');
  };
  const launch = dependencies.launch ?? (formal => {
    const health = path.join(config.stateRoot, 'health.url');
    fs.rmSync(health, { force: true });
    const command = `command="${config.nodePath.replaceAll('\\', '/')}" "${path.join(formal.appRoot, 'src/mcp-chatgpt.mjs').replaceAll('\\', '/')}",channel=main`;
    const env = { ...process.env, CONTROL_PLANE_API_KEY: runtimeKey(config), LEARNING_BASE_URL: 'http://127.0.0.1:4318', LEARNING_DATA_DIR: formal.dataDir };
    delete env.OPENAI_API_KEY; delete env.LEARNING_CHATGPT_MCP_TOKEN;
    return spawn(config.tunnelClientPath, ['run', '--profile-file', config.profileFile, '--mcp.command', command,
      '--health.listen-addr', '127.0.0.1:0', '--health.url-file', health, '--mcp.stdio-send-initialized-notification=true',
      '--mcp.connection-max-ttl', '1h', '--log.level', 'warn', '--log.http-raw-unsafe=false', '--harpoon.capture-payloads=false'],
    { cwd: formal.appRoot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  });
  const shutdown = () => { stopping = true; };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  const started = Date.now();
  try {
    while (!stopping && !dependencies.stop?.()) {
      let formal, backend = false, tunnelReady = false;
      try { formal = formalConfig(config); backend = await probeBackend(formal); } catch { lastCode = 'FORMAL_CONFIGURATION_UNAVAILABLE'; }
      const identity = formal && `${formal.appRoot}:${formal.sourceSha}`;
      if (lastSource && identity && lastSource !== identity && alive()) { await stopChild(); lastCode = 'FORMAL_SOURCE_CHANGED'; }
      if (alive() && backend) tunnelReady = await probeTunnel();
      let phase = policy.step({ now: now(), backend, alive: Boolean(alive()), ready: tunnelReady });
      if (phase === 'stop' || phase === 'restart') { await stopChild(); tunnelReady = false; }
      if (phase === 'start') {
        try {
          child = launch(formal); starts++; lastSource = identity; sourceSha = formal.sourceSha;
          child.once('error', () => { child.failed = true; lastCode = 'TUNNEL_SPAWN_FAILED'; });
          // Keep only categories. No raw upstream logs, identities, or tool payloads.
          let buffer = '';
          const diagnostic = chunk => {
            buffer = (buffer + chunk.toString()).slice(-32768);
            const lines = buffer.split(/\r?\n/); buffer = lines.pop();
            for (const line of lines) { const code = classifyDiagnostic(line); if (code) { lastCode = code; policy.diagnostic(code, now()); } }
          };
          child.stdout?.on('data', diagnostic); child.stderr?.on('data', diagnostic);
        } catch { lastCode = 'TUNNEL_START_FAILED'; child = null; policy.diagnostic('UPSTREAM_AUTH', now()); }
        phase = 'starting-tunnel'; tunnelReady = false;
      }
      status = { phase, backendReady: backend, tunnelReady: phase === 'ready' && tunnelReady, supervisorPid: process.pid,
        tunnelPid: alive() ? child.pid : null, sourceSha, starts, lastCode, nextRetryAt: policy.nextRetryAt,
        uptimeMs: Date.now() - started, rssBytes: process.memoryUsage().rss, cpuMicros: process.cpuUsage(), updatedAt: new Date().toISOString() };
      status.receiptWritable = publishReceipt(path.join(config.stateRoot, 'status.json'), status);
      await wait(config.pollMs ?? 10000);
    }
  } finally {
    try { await stopChild(); }
    finally {
      status = { ...status, phase: 'stopped', backendReady: false, tunnelReady: false, updatedAt: new Date().toISOString() };
      publishReceipt(path.join(config.stateRoot, 'status.json'), status);
      server.close();
      process.off('SIGINT', shutdown); process.off('SIGTERM', shutdown);
    }
  }
}
async function cli() {
  const configPath = path.resolve(process.argv[2]);
  const action = process.argv[3] ?? 'status';
  if (action === 'run') return runSupervisor(configPath);
  if (action !== 'status') throw Error('UNKNOWN_ACTION');
  let status;
  try { status = await query(configPath); } catch { /* A dead process cannot hold the pipe lock. */ }
  const deadline = Date.now() + (process.argv.includes('--wait-ready') ? 20000 : 2500);
  while ((!status || process.argv.includes('--wait-ready') && status.phase !== 'ready') && Date.now() < deadline) {
    await sleep(250);
    try { status = await query(configPath); } catch { status = undefined; }
  }
  console.log(JSON.stringify(status ?? { phase: 'unavailable', backendReady: false, tunnelReady: false }));
  if (action === 'status' && status?.phase !== 'ready') process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) cli().catch(error => {
  console.error(/^[A-Z_]+$/.test(error.message) ? error.message : 'CHATGPT_RUNTIME_FAILED'); process.exitCode = 1;
});
