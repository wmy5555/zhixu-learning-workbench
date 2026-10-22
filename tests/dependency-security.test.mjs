import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { docx } from './fixtures/source-files.mjs';

const require = createRequire(import.meta.url);
const sdkRequire = createRequire(require.resolve('@modelcontextprotocol/sdk/server/stdio.js'));
const capacitorRequire = createRequire(require.resolve('@capacitor/cli/package.json'));
const xcodeRequire = createRequire(capacitorRequire.resolve('xcode'));

test('SDK static middleware does not decode a protected path twice and still serves normal names', async () => {
  const { Hono } = sdkRequire('hono');
  const { serveStatic } = sdkRequire('hono/serve-static');
  const reads = [];
  const app = new Hono();
  app.use('/static/admin/*', c => c.text('Unauthorized', 401));
  app.use('/static/*', serveStatic({ getContent: filename => { reads.push(filename); return 'fixture:' + filename; } }));
  assert.equal((await app.request('/static/admin/secret.txt')).status, 401);
  for (const url of ['/static/%%36%31dmin/secret.txt', '/static/%2Fadmin/secret.txt', '/static/100%25.txt']) {
    assert.equal((await app.request(url)).status, 404, url);
  }
  assert.deepEqual(reads, [], 'rejected paths must not reach the file reader');
  for (const [url, filename] of [['/static/hello%20world.txt', 'static/hello world.txt'], ['/static/%E4%B8%AD%E6%96%87.txt', 'static/中文.txt']]) {
    const response = await app.request(url);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'fixture:' + filename);
  }
});

test('xcode UUID dependency rejects partial writes while its CommonJS UUID generation remains compatible', () => {
  const uuid = xcodeRequire('uuid');
  for (const method of ['v3', 'v5', 'v6']) {
    for (const [length, offset] of [[8, 4], [16, -1], [16, 1]]) {
      const buffer = new Uint8Array(length).fill(170);
      const call = method === 'v6' ? () => uuid.v6({}, buffer, offset)
        : () => uuid[method]('fixture', uuid[method].DNS, buffer, offset);
      assert.throws(call, RangeError, method + ':' + length + ':' + offset);
      assert.ok(buffer.every(value => value === 170), 'invalid bounds must not mutate output');
    }
  }
  assert.equal(uuid.v5('www.example.com', uuid.v5.DNS), '2ed6657d-e927-568b-95e1-2665a8aea6a2');
  const project = capacitorRequire('xcode').project('synthetic.pbxproj');
  project.hash = { project: { objects: {} } };
  const generated = Array.from({ length: 8 }, () => project.generateUuid());
  assert.ok(generated.every(value => /^[0-9A-F]{24}$/.test(value)));
  assert.equal(new Set(generated).size, generated.length);
});

test('Mammoth CLI retains v1 argument compatibility without the vulnerable sprintf dependency', async t => {
  const lock = parse(readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8'));
  assert.ok(!Object.keys(lock.packages).some(key => key.startsWith('sprintf-js@')));
  const mammothRoot = path.dirname(require.resolve('mammoth/package.json'));
  const cli = path.join(mammothRoot, 'bin', 'mammoth');
  const tmp = path.resolve(import.meta.dirname, '..', '.tmp');
  mkdirSync(tmp, { recursive: true });
  const root = mkdtempSync(path.join(tmp, 'dependency-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, '合成 文档 %.101f.docx');
  writeFileSync(input, await docx('依赖兼容正文 %.0g'));
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 10000 });
  const help = run(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--output-format/);
  for (const args of [[input], [input, '--output-format', 'markdown']]) {
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /依赖兼容正文 %\\?\.0g/);
  }
  const output = path.join(root, '输出.html');
  assert.equal(run([input, output]).status, 0);
  assert.match(readFileSync(output, 'utf8'), /依赖兼容正文/);
  const directory = path.join(root, '输出目录');
  mkdirSync(directory);
  const result = run([input, '--output-dir', directory]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(path.join(directory, path.basename(input, '.docx') + '.html'), 'utf8'), /依赖兼容正文/);
  const invalid = run([input, output, '--output-dir', directory]);
  assert.equal(invalid.status, 2);
  assert.doesNotMatch(invalid.stderr, /RangeError/);
});
