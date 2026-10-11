import { mkdir, readFile, writeFile, copyFile, lstat, realpath, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Package the explicitly frozen Android UI only. Never follow current public/ or user data.
const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'apps/android/web');
const baseline = JSON.parse(await readFile(path.join(root, 'apps/android/web-baseline.json'), 'utf8'));
if (baseline.schemaVersion !== 1 || baseline.sourceDirectory !== 'apps/android/web'
  || baseline.updatePolicy !== 'manual-major-release-opt-in'
  || !/^[a-f0-9]{40}$/.test(baseline.webBaselineCommit)) throw new Error('Invalid Android web baseline');
const target = path.join(root, 'dist/android-web');
for (const directory of [path.join(root, 'dist'), target]) {
  const info = await lstat(directory).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (info?.isSymbolicLink()) throw new Error('Android output must not be a symbolic link');
}
await mkdir(target, { recursive: true });
const expected = path.join(await realpath(root), 'dist', 'android-web');
if (await realpath(target) !== expected) throw new Error('Android output escaped the project');
// This fixed, resolved build-only directory is safe to replace; remove obsolete packaged assets too.
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
const assets = execFileSync('git', ['ls-files', '-z', '--', 'apps/android/web'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
if (!assets.length) throw new Error('Android web snapshot must be tracked before packaging');
for (const asset of assets) {
  const input = path.join(root, asset), relative = path.relative(source, input);
  if (relative.startsWith('..') || path.isAbsolute(relative) || (await lstat(input)).isSymbolicLink()) throw new Error('Invalid UI asset path');
  const resolved = await realpath(input);
  if (path.relative(await realpath(source), resolved).startsWith('..')) throw new Error('UI asset escaped the Android web snapshot');
  const output = path.join(target, relative);
  await mkdir(path.dirname(output), { recursive: true });
  await copyFile(input, output);
}
const html = await readFile(path.join(source, 'index.html'), 'utf8');
const entry = '<script type="module" src="/app.mjs"></script>';
if (!html.includes(entry)) throw new Error('Shared UI entry changed; update the Android entry explicitly');
await writeFile(path.join(target, 'index.html'), html.replace(entry, '<script type="module" src="/android-entry.mjs"></script>'));
await copyFile(path.join(root, 'node_modules/@capacitor/core/dist/index.js'), path.join(target, 'capacitor-core.mjs'));
await writeFile(path.join(target, 'android-entry.mjs'), `import { registerPlugin, Capacitor } from './capacitor-core.mjs';
import { configureLocalTransport } from './api.mjs';
import { createAndroidTransport } from './android-transport.mjs';
if (Capacitor.getPlatform() !== 'android') throw new Error('Android native runtime is required');
configureLocalTransport(createAndroidTransport(registerPlugin('ZhixuLocal')));
await import('./app.mjs');
`);
console.log(`Prepared Android assets from the frozen web baseline ${baseline.webBaselineCommit.slice(0, 7)}; no current public/ or user data included.`);
