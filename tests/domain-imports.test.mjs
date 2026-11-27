import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

test('learning, settings and ChatGPT modules can load without SQLite', async t => {
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      assert.notEqual(specifier, 'node:sqlite', `SQLite must be loaded by the persistence layer, reached from ${context.parentURL}`);
      return nextResolve(specifier, context);
    },
  });
  t.after(() => hook.deregister());

  for (const name of [
    'capability-test', 'chatgpt', 'chatgpt-undo', 'knowledge-lifecycle', 'learning',
    'onboarding-assistant', 'onboarding-cases', 'recycle-bin', 'secrets', 'source-files',
  ]) {
    await import(`../src/${name}.mjs`);
  }
});
