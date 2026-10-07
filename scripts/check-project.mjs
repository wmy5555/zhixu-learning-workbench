import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { parse } from 'yaml';

// Scan version-controlled files only: never inspect the user's Vault or secrets.
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const errors = [];
for (const file of files) {
  if (/^(?:\.data|vault|\.tmp|node_modules|backups|exports|dist|coverage)\//.test(file)
    || /(?:^|\/)\.env(?:\..*)?$/.test(file) && file !== '.env.example'
    || /(?:^|\/)(?:build|\.gradle)\//.test(file) || /(?:^|\/)local\.properties$/.test(file)
    || /\.(?:pem|key|p12|pfx|jks|keystore|apk|aab|sqlite(?:-wal|-shm)?|db|log)$/i.test(file)) {
    errors.push(`${file}: private/runtime file must not be tracked`);
    continue;
  }
  if (statSync(file).size > 5 * 1024 * 1024) errors.push(`${file}: exceeds the 5 MiB source-file limit`);
  if (!/\.(?:mjs|json|ya?ml|md|txt|html|css|ps1|cmd|java|xml|gradle|properties)$/.test(file)) continue;
  const source = readFileSync(file, 'utf8');
  if (/^(?:<{7} |={7}$|>{7} )/m.test(source)) errors.push(`${file}: unresolved merge conflict`);
  try {
    if (file.endsWith('.json')) JSON.parse(source);
    if (/\.ya?ml$/.test(file)) parse(source, { uniqueKeys: true });
    if (file.endsWith('.mjs')) {
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      if (result.status !== 0) errors.push(`${file}: ${result.stderr || result.error}`);
    }
  } catch (error) { errors.push(`${file}: ${error.message}`); }
}
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = parse(readFileSync('pnpm-lock.yaml', 'utf8'));
for (const group of ['dependencies', 'devDependencies']) for (const [name, version] of Object.entries(pkg[group] || {})) {
  if (lock.importers['.'][group]?.[name]?.specifier !== version) errors.push(`${name}: lockfile mismatch`);
}
for (const file of files.filter(file => /^\.github\/workflows\/.*\.ya?ml$/.test(file))) {
  const workflow = parse(readFileSync(file, 'utf8'));
  for (const job of Object.values(workflow.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (step.uses && !step.uses.startsWith('./') && !/@[a-f0-9]{40}$/.test(step.uses)) errors.push(`${file}: pin third-party actions to a commit SHA`);
    }
  }
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`Checked ${files.length} tracked files: syntax, config, lockfile, conflict markers, upload boundaries and action pins.`);
