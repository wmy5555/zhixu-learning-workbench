import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const project = path.resolve(import.meta.dirname, '..');
const windows = process.platform === 'win32';
const shell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const applicationEntry = '<script type="module" src="/app.mjs"></script>';
const reviewEntry = '<script type="module" src="/review-entry.mjs"></script>';

// Exercise the launcher's literal readiness markers against the actual served file
// on every OS; the Windows cases below still execute the real PowerShell probe.
test('launcher readiness markers recognize the deployed shell and reject bare filenames', () => {
  const source = fs.readFileSync(path.join(project, 'start.ps1'), 'utf8');
  const markers = [...source.matchAll(/\.Contains\('([^']+)'\)/g)].map(match => match[1]);
  const recognizes = html => markers.some(marker => html.includes(marker));
  assert.ok(recognizes(fs.readFileSync(path.join(project, 'public/index.html'), 'utf8')), 'The current shell must satisfy the actual launcher readiness markers');
  assert.ok(recognizes(applicationEntry));
  assert.ok(recognizes(reviewEntry));
  for (const html of ['Another local application; app.mjs and review-entry.mjs are only text.',
    '<script type="module" src="/not-app.mjs"></script>', '<script type="module" src="/app.mjs.bak"></script>',
    '<script type="module" src="https://example.invalid/review-entry.mjs"></script>']) {
    assert.equal(recognizes(html), false);
  }
});

async function listener(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server;
}

function fixture(t) {
  fs.mkdirSync(path.join(project, '.tmp'), { recursive: true });
  const root = fs.mkdtempSync(path.join(project, '.tmp', 'launcher 知序 '));
  fs.copyFileSync(path.join(project, 'start.ps1'), path.join(root, 'start.ps1'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'node_modules/yaml'), { recursive: true });
  t.after(() => {
    // Only a PID written by our isolated fixture may be stopped.
    const pidFile = path.join(root, '.data/web.pid');
    if (fs.existsSync(pidFile)) {
      try { process.kill(Number(fs.readFileSync(pidFile, 'utf8'))); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    // Windows can retain log handles briefly after termination; keep ignored test files.
  });
  const run = (port, env = {}) => new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'start.ps1'), '-NoBrowser', '-Timing', '-Port', String(port)], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, LEARNING_DATA_DIR: path.join(root, '.data'), LEARNING_VAULT_DIR: path.join(root, 'vault'), ...env },
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', code => {
      child.stdout.destroy(); child.stderr.destroy();
      resolve({ code, stdout, stderr, ms: Math.round(performance.now() - started) });
    });
  });
  return { root, run };
}

for (const [entryName, html] of [['application', applicationEntry], ['review', fs.readFileSync(path.join(project, 'public/index.html'), 'utf8')]]) {
test(`Windows launcher reuses a ready ${entryName} service without Node lookup or data writes`, { skip: !windows }, async t => {
  const { root, run } = fixture(t);
  const server = await listener(t, (_req, res) => res.end(html));
  const result = await run(server.address().port, { PATH: '', USERPROFILE: root });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /ReadyMs=\d+; BrowserDispatchMs=\d+; TotalMs=\d+/);
  assert.equal(fs.existsSync(path.join(root, '.data')), false);
});
}

test('Windows launcher starts the real app in an isolated directory and reuses its PID', { skip: !windows }, async t => {
  const { root, run } = fixture(t);
  const reservation = http.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const moduleUrl = pathToFileURL(path.join(project, 'src/server.mjs')).href;
  fs.writeFileSync(path.join(root, 'src/server.mjs'), `import {createApp} from ${JSON.stringify(moduleUrl)};
const app = createApp({scheduler:false});
app.server.listen(Number(process.env.PORT), '127.0.0.1');
app.server.on('error', () => process.exit(1));
`);
  const cold = await run(port);
  if (cold.code !== 0) {
    const pidFile = path.join(root, '.data/web.pid'), errorFile = path.join(root, '.data/server-error.log');
    const pid = fs.existsSync(pidFile) ? Number(fs.readFileSync(pidFile, 'utf8')) : null;
    let alive = false, response;
    if (Number.isSafeInteger(pid) && pid > 0) { try { process.kill(pid, 0); alive = true; } catch {} }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual', signal: AbortSignal.timeout(2000) });
      const html = await res.text();
      response = { status: res.status, applicationEntry: html.includes(applicationEntry), reviewEntry: html.includes(reviewEntry) };
    } catch (error) { response = { error: error.cause?.code || error.name }; }
    // Only this synthetic fixture's stderr is included; never read credential files.
    const stderr = fs.existsSync(errorFile) ? fs.readFileSync(errorFile, 'utf8').slice(-4096).replace(/\b[a-f0-9]{64}\b/gi, '[redacted]') : '(missing)';
    t.diagnostic(JSON.stringify({ elapsedMs: cold.ms, pid, alive, response, stderr }));
  }
  assert.equal(cold.code, 0, cold.stderr);
  const pid = fs.readFileSync(path.join(root, '.data/web.pid'), 'utf8');
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), fs.readFileSync(path.join(project, 'public/index.html'), 'utf8'));
  const warm = await run(port);
  assert.equal(warm.code, 0, warm.stderr);
  assert.equal(fs.readFileSync(path.join(root, '.data/web.pid'), 'utf8'), pid);
  t.diagnostic(`Isolated launcher process: cold=${cold.ms}ms, warm=${warm.ms}ms; browser excluded.`);
});

for (const { name, redirect, status = 200, body } of [
  { name: 'unrelated HTML', body: 'Another local application' },
  { name: 'bare entry filenames', body: 'app.mjs and review-entry.mjs are only text.' },
  { name: 'redirects', redirect: true, body: reviewEntry },
  { name: 'non-200 responses', status: 201, body: applicationEntry },
]) {
  test(`Windows launcher rejects ${name} and reports a stopped child`, { skip: !windows }, async t => {
    const { root, run } = fixture(t);
    fs.writeFileSync(path.join(root, 'src/server.mjs'), 'process.exit(1);');
    let redirected = 0;
    const server = await listener(t, (req, res) => {
      if (req.url === '/other') { redirected++; res.end(reviewEntry); }
      else if (redirect) { res.writeHead(302, { Location: '/other' }); res.end(body); }
      else { res.writeHead(status); res.end(body); }
    });
    const result = await run(server.address().port);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /The server stopped/);
    assert.equal(redirected, 0);
  });
}
