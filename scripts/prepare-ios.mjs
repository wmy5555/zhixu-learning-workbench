import { mkdir, readFile, writeFile, lstat, realpath, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = JSON.parse(await readFile(path.join(root, 'apps/ios/web-baseline.json'), 'utf8'));
if (baseline.schemaVersion !== 1 || baseline.sourceDirectory !== 'public'
  || baseline.updatePolicy !== 'explicit-versioned-review' || !/^[a-f0-9]{40}$/.test(baseline.webBaselineCommit)) throw new Error('Invalid iOS web baseline');
const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 8 * 1024 * 1024 });
const target = path.join(root, 'dist/ios-web');
const resolvedRoot = await realpath(root);
for (const directory of [path.join(root, 'dist'), target]) {
  const info = await lstat(directory).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (info?.isSymbolicLink()) throw new Error('iOS output must not be a symbolic link');
}
await mkdir(target, { recursive: true });
if (await realpath(target) !== path.join(resolvedRoot, 'dist/ios-web')) throw new Error('iOS output escaped the project');
const entries = git(['ls-tree', '-rz', baseline.webBaselineCommit, '--', 'public']).toString('utf8').split('\0').filter(Boolean);
if (!entries.length) throw new Error('No committed iOS web baseline');
// Only replace this fixed, resolved build directory. Never read user data or the live public/ tree.
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
const files = [];
for (const entry of entries) {
  const [metadata, source] = entry.split('\t');
  if (!/^100(?:644|755) blob [a-f0-9]{40}$/.test(metadata) || !source?.startsWith('public/') || /(?:^|\/)\.\.(?:\/|$)|\\/.test(source)) throw new Error('Invalid committed UI asset');
  const relative = source.slice('public/'.length);
  const bytes = git(['show', `${baseline.webBaselineCommit}:${source}`]);
  if (bytes.length > 5 * 1024 * 1024) throw new Error('UI asset exceeds source limit');
  const output = path.join(target, relative);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, bytes);
  files.push({ path: relative, origin: `${baseline.webBaselineCommit}:${source}`, sha256: createHash('sha256').update(bytes).digest('hex') });
}
for (const relative of ['ios-entry.mjs', 'ios-client.mjs', 'ios-ui.mjs', 'ios.css', 'source-exchange.mjs']) {
  const input = path.join(root, 'apps/ios/web', relative);
  if ((await lstat(input)).isSymbolicLink() || await realpath(input) !== path.join(resolvedRoot, 'apps/ios/web', relative)) throw new Error('Invalid iOS overlay');
  const bytes = await readFile(input);
  await writeFile(path.join(target, relative), bytes);
  files.push({ path: relative, origin: `apps/ios/web/${relative}`, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const core = await readFile(path.join(root, 'node_modules/@capacitor/core/dist/index.js'));
await writeFile(path.join(target, 'capacitor-core.mjs'), core);
const indexPath = path.join(target, 'index.html');
const html = await readFile(indexPath, 'utf8');
const entry = '<script type="module" src="/app.mjs"></script>';
if (html.split(entry).length !== 2) throw new Error('Web entry changed; update the iOS adapter explicitly');
const adapted = html.replace(entry, '<script type="module" src="/ios-entry.mjs"></script>')
  .replace('width=device-width, initial-scale=1', 'width=device-width, initial-scale=1, viewport-fit=cover')
  .replace('</head>', `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'" /><link rel="stylesheet" href="/ios.css" /></head>`);
await writeFile(indexPath, adapted);
const index = files.find(file => file.path === 'index.html');
index.adaptedSha256 = createHash('sha256').update(adapted).digest('hex');
await writeFile(path.join(target, 'ios-assets.json'), JSON.stringify({ schemaVersion: 1, baseline, files }, null, 2) + '\n');
console.log(`Prepared iOS assets from Web ${baseline.webBaselineCommit.slice(0, 7)}; native source preview, full parity pending.`);
