import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, copyFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('Android packaging stays on its tracked frozen snapshot when public changes', async () => {
  const workspace = fileURLToPath(new URL('../', import.meta.url));
  const temporary = path.join(workspace, '.tmp');
  await mkdir(temporary, { recursive: true });
  const root = await mkdtemp(path.join(temporary, 'android-packaging-'));
  try {
    for (const folder of ['scripts', 'apps/android/web', 'public', 'node_modules/@capacitor/core/dist']) {
      await mkdir(path.join(root, folder), { recursive: true });
    }
    await copyFile(new URL('../scripts/prepare-android.mjs', import.meta.url), path.join(root, 'scripts/prepare-android.mjs'));
    await copyFile(new URL('../apps/android/web-baseline.json', import.meta.url), path.join(root, 'apps/android/web-baseline.json'));
    await writeFile(path.join(root, 'apps/android/web/index.html'), '<script type="module" src="/app.mjs"></script>');
    await writeFile(path.join(root, 'apps/android/web/app.mjs'), '// frozen Android source');
    await writeFile(path.join(root, 'public/app.mjs'), '// later web release, not approved for Android');
    await writeFile(path.join(root, 'node_modules/@capacitor/core/dist/index.js'), '// synthetic build fixture');
    const git = (...args) => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], { cwd: root, stdio: 'pipe' });
    git('init', '-q');
    git('add', 'apps/android/web');
    // Untracked material must never be included even if it is inside the snapshot directory.
    await writeFile(path.join(root, 'apps/android/web/untracked.txt'), 'synthetic untracked material');
    const build = () => execFileSync(process.execPath, ['scripts/prepare-android.mjs'], { cwd: root, stdio: 'pipe' });
    build();
    assert.equal(await readFile(path.join(root, 'dist/android-web/app.mjs'), 'utf8'), '// frozen Android source');
    await assert.rejects(readFile(path.join(root, 'dist/android-web/untracked.txt')), { code: 'ENOENT' });
    assert.match(await readFile(path.join(root, 'dist/android-web/index.html'), 'utf8'), /android-entry\.mjs/);
    await writeFile(path.join(root, 'public/app.mjs'), '// another main change');
    await writeFile(path.join(root, 'dist/android-web/stale.txt'), 'obsolete output');
    build();
    assert.equal(await readFile(path.join(root, 'dist/android-web/app.mjs'), 'utf8'), '// frozen Android source');
    await assert.rejects(readFile(path.join(root, 'dist/android-web/stale.txt')), { code: 'ENOENT' });
    const manifest = JSON.parse(await readFile(path.join(root, 'apps/android/web-baseline.json'), 'utf8'));
    manifest.sourceDirectory = 'public';
    await writeFile(path.join(root, 'apps/android/web-baseline.json'), JSON.stringify(manifest));
    assert.throws(build, /Invalid Android web baseline/);
  } finally {
    const relative = path.relative(temporary, root);
    assert.ok(relative.startsWith('android-packaging-') && !relative.includes(path.sep));
    await rm(root, { recursive: true, force: true });
  }
});
