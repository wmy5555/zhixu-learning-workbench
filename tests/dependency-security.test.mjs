import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { captureRestoreSchema, captureUndoSchema } from '../src/chatgpt.mjs';

const require = createRequire(import.meta.url);

test('RFC UUID receipts and default undo revisions remain valid while malformed selectors reject', () => {
  const undoId = randomUUID();
  assert.deepEqual(captureRestoreSchema.parse({ undoId }), { undoId });
  assert.equal(captureRestoreSchema.safeParse({ undoId: '11111111-1111-1111-1111-111111111111' }).success, false);
  assert.equal(captureRestoreSchema.safeParse({ undoId, confirm: true }).success, false);
  const selector = { requestId: 'synthetic-request', noteId: 'synthetic-source' };
  assert.equal(captureUndoSchema.parse(selector).syncRevision, null);
  assert.equal(captureUndoSchema.safeParse({ ...selector, syncRevision: Number.MAX_SAFE_INTEGER + 1 }).success, false);
});

// Exercise the installed parser, not its version string: limits must bound parsing work.
for (const kind of ['array', 'set']) {
  test(`oversized ${kind} stops before validating members while valid input still parses`, () => {
    let visited = 0;
    const value = z.string().transform(text => { visited++; return text.toUpperCase(); });
    const schema = kind === 'array' ? z.array(value).max(1) : z.set(value).max(1);
    const input = entries => kind === 'array' ? entries : new Set(entries);

    assert.deepEqual(schema.parse(input(['ok'])), input(['OK']));
    assert.equal(visited, 1, 'ordinary input must still run member validation');
    visited = 0;

    const rejected = schema.safeParse(input(['first', 'second', 'third']));
    assert.equal(rejected.success, false);
    assert.equal(visited, 0, 'an oversized collection must not allocate per-member validation work');
  });
}

test('the patched uuid retains the CommonJS API used by the Xcode project writer', () => {
  const cliRequire = createRequire(require.resolve('@capacitor/cli/package.json'));
  const xcode = cliRequire('xcode');
  const project = xcode.project('synthetic-do-not-read.pbxproj');
  project.hash = { project: { objects: {} } };
  assert.match(project.generateUuid(), /^[A-F0-9]{24}$/);
});

test('Mammoth command-line parsing remains usable with the patched argument parser', () => {
  const manifestPath = require.resolve('mammoth/package.json');
  const manifest = require(manifestPath);
  const result = spawnSync(process.execPath, [path.resolve(path.dirname(manifestPath), manifest.bin.mammoth), '--help'],
    { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
  assert.match(result.stdout, /usage:/i);
});
