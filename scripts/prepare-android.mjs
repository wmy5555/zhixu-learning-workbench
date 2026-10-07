import { mkdir, readFile, writeFile, copyFile, lstat, realpath, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Only public UI assets are packaged. Never traverse the repository/data directories.
const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'public');
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
const assets = execFileSync('git', ['ls-files', '-z', '--', 'public'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
for (const asset of assets) {
  const input = path.join(root, asset), relative = path.relative(source, input);
  if (relative.startsWith('..') || path.isAbsolute(relative) || (await lstat(input)).isSymbolicLink()) throw new Error('Invalid UI asset path');
  const resolved = await realpath(input);
  if (path.relative(await realpath(source), resolved).startsWith('..')) throw new Error('UI asset escaped the public directory');
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
console.log('Prepared Android assets from the shared public UI; no user data included.');
