import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('iOS packaging reads its precise committed Web version, never active Web, Android or private directories', async () => {
  const workspace = fileURLToPath(new URL('../', import.meta.url));
  const temporary = path.join(workspace, '.tmp'); await mkdir(temporary, { recursive: true });
  const root = await mkdtemp(path.join(temporary, 'ios-packaging-'));
  try {
    for (const folder of ['scripts', 'apps/ios/web', 'public', 'node_modules/@capacitor/core/dist']) await mkdir(path.join(root, folder), { recursive: true });
    await copyFile(new URL('../scripts/prepare-ios.mjs', import.meta.url), path.join(root, 'scripts/prepare-ios.mjs'));
    await writeFile(path.join(root, 'public/index.html'), '<head></head><script type="module" src="/app.mjs"></script>');
    await writeFile(path.join(root, 'public/app.mjs'), '// committed synthetic Web version');
    await writeFile(path.join(root, 'node_modules/@capacitor/core/dist/index.js'), '// synthetic core');
    for (const name of ['ios-entry.mjs', 'ios-client.mjs', 'ios-ui.mjs', 'ios.css', 'source-exchange.mjs']) await writeFile(path.join(root, 'apps/ios/web', name), `// synthetic ${name}`);
    const git = (...args) => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
    git('init', '-q'); git('add', 'public'); git('-c', 'user.name=synthetic-test', '-c', 'user.email=synthetic@example.invalid', 'commit', '-qm', 'synthetic baseline');
    const baseline = { schemaVersion: 1, webBaselineCommit: git('rev-parse', 'HEAD').trim(), sourceDirectory: 'public', updatePolicy: 'explicit-versioned-review' };
    await writeFile(path.join(root, 'apps/ios/web-baseline.json'), JSON.stringify(baseline));
    await writeFile(path.join(root, 'public/app.mjs'), '// live changes must stay out');
    await writeFile(path.join(root, 'public/untracked.txt'), 'synthetic untracked material');
    const run = () => execFileSync(process.execPath, ['scripts/prepare-ios.mjs'], { cwd: root, stdio: 'pipe' });
    run();
    assert.equal(await readFile(path.join(root, 'dist/ios-web/app.mjs'), 'utf8'), '// committed synthetic Web version');
    await assert.rejects(readFile(path.join(root, 'dist/ios-web/untracked.txt')), { code: 'ENOENT' });
    const html = await readFile(path.join(root, 'dist/ios-web/index.html'), 'utf8');
    assert.match(html, /ios-entry\.mjs/); assert.match(html, /connect-src 'none'/);
    await writeFile(path.join(root, 'dist/ios-web/stale.txt'), 'obsolete build asset'); run();
    await assert.rejects(readFile(path.join(root, 'dist/ios-web/stale.txt')), { code: 'ENOENT' });
    baseline.sourceDirectory = '.data'; await writeFile(path.join(root, 'apps/ios/web-baseline.json'), JSON.stringify(baseline));
    assert.throws(run, /Invalid iOS web baseline/);
    const manifest = JSON.parse(await readFile(path.join(root, 'dist/ios-web/ios-assets.json'), 'utf8'));
    assert.equal(manifest.baseline.webBaselineCommit, baseline.webBaselineCommit); assert.ok(manifest.files.every(file => file.sha256.length === 64));
  } finally {
    const relative = path.relative(temporary, root); assert.ok(relative.startsWith('ios-packaging-') && !relative.includes(path.sep));
    await rm(root, { recursive: true, force: true });
  }
});
