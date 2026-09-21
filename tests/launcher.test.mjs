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

test('Windows launcher reuses a ready service without Node lookup or data writes', { skip: !windows }, async t => {
  const { root, run } = fixture(t);
  const server = await listener(t, (_req, res) => res.end('<script src="/app.mjs"></script>'));
  const result = await run(server.address().port, { PATH: '', USERPROFILE: root });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /ReadyMs=\d+; BrowserDispatchMs=\d+; TotalMs=\d+/);
  assert.equal(fs.existsSync(path.join(root, '.data')), false);
});

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
  assert.equal(cold.code, 0, cold.stderr);
  const pid = fs.readFileSync(path.join(root, '.data/web.pid'), 'utf8');
  assert.match(await (await fetch(`http://127.0.0.1:${port}/`)).text(), /app\.mjs/);
  const warm = await run(port);
  assert.equal(warm.code, 0, warm.stderr);
  assert.equal(fs.readFileSync(path.join(root, '.data/web.pid'), 'utf8'), pid);
  t.diagnostic(`Isolated launcher process: cold=${cold.ms}ms, warm=${warm.ms}ms; browser excluded.`);
});

for (const redirect of [false, true]) {
  test(`Windows launcher rejects ${redirect ? 'redirects' : 'unrelated HTML'} and reports a stopped child`, { skip: !windows }, async t => {
    const { root, run } = fixture(t);
    fs.writeFileSync(path.join(root, 'src/server.mjs'), 'process.exit(1);');
    let redirected = 0;
    const server = await listener(t, (req, res) => {
      if (req.url === '/other') { redirected++; res.end('app.mjs'); }
      else if (redirect) { res.writeHead(302, { Location: '/other' }); res.end('app.mjs'); }
      else res.end('Another local application');
    });
    const result = await run(server.address().port);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /The server stopped/);
    assert.equal(redirected, 0);
  });
}
