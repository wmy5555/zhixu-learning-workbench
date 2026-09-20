import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const project = path.resolve(import.meta.dirname, '..');
const checkScript = path.join(project, 'scripts/check-project.mjs');

function fixture(t) {
  mkdirSync(path.join(project, '.tmp'), { recursive: true });
  const root = mkdtempSync(path.join(project, '.tmp', 'maintenance-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], { cwd: root, stdio: 'pipe' });
  git('init');
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: {} }));
  writeFileSync(path.join(root, 'pnpm-lock.yaml'), 'importers:\n  .:\n    dependencies: {}\n');
  const run = () => {
    git('add', '--all');
    return spawnSync(process.execPath, [checkScript], {
      cwd: root, encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: root.replaceAll('\\', '/') },
    });
  };
  return { root, run };
}

test('repository guard permits an env example but rejects accidentally tracked user data', t => {
  const { root, run } = fixture(t);
  writeFileSync(path.join(root, '.env.example'), '# no credentials\n');
  assert.equal(run().status, 0);
  mkdirSync(path.join(root, 'vault'));
  writeFileSync(path.join(root, 'vault', 'synthetic.md'), 'Synthetic fixture, never user data');
  writeFileSync(path.join(root, '.env'), '# synthetic fixture only\n');
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /vault\/synthetic.md: private\/runtime/);
  assert.match(result.stderr, /\.env: private\/runtime/);
});

test('repository guard blocks syntax errors and mutable action references', t => {
  const { root, run } = fixture(t);
  writeFileSync(path.join(root, 'broken.mjs'), 'export const = ;');
  mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'jobs:\n  test:\n    steps:\n      - uses: actions/checkout@v4\n');
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /broken.mjs:/);
  assert.match(result.stderr, /pin third-party actions/);
});
