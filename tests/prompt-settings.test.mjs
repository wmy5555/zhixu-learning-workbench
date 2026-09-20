import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createService } from '../src/service.mjs';

const projectDir = path.resolve(import.meta.dirname, '..');
const tempRoot = path.join(projectDir, '.tmp');
await mkdir(tempRoot, { recursive: true });

async function tempPaths(prefix = 'prompt-settings-') {
  const root = await mkdtemp(path.join(tempRoot, prefix));
  return {
    root,
    dataDir: path.join(root, 'data'),
    vaultDir: path.join(root, 'vault'),
  };
}

function promptByKey(service, key) {
  return service.getPrompts().prompts.find(prompt => prompt.key === key);
}

test('prompt overrides merge with settings and persist across a service restart', async t => {
  const paths = await tempPaths();
  let service = createService(paths);
  t.after(async () => {
    await service.close();
    await rm(paths.root, { recursive: true, force: true });
  });
  const listed = service.getPrompts();
  assert.ok(Array.isArray(listed.prompts));
  const sourceExtract = promptByKey(service, 'sourceExtract');
  assert.deepEqual(
    Object.keys(sourceExtract).sort(),
    ['defaultTemplate', 'description', 'key', 'template', 'title', 'variables'],
  );
  assert.deepEqual(sourceExtract.variables, ['source']);
  assert.equal(sourceExtract.template, sourceExtract.defaultTemplate);

  service.updateSettings({ dailyMinutes: 35, focusTopics: ['提示词设置保留测试'] });
  const custom = `PERSISTED_SOURCE_EXTRACT\n${sourceExtract.defaultTemplate}`;
  const updated = service.updatePrompts({ prompts: { sourceExtract: custom } });
  assert.equal(updated.prompts.find(prompt => prompt.key === 'sourceExtract').template, custom);
  assert.equal(service.settings().dailyMinutes, 35);
  assert.deepEqual(service.settings().focusTopics, ['提示词设置保留测试']);

  service.updateSettings({ dailyMinutes: 40 });
  assert.equal(promptByKey(service, 'sourceExtract').template, custom);
  await service.close();

  service = createService(paths);
  assert.equal(promptByKey(service, 'sourceExtract').template, custom);
  assert.equal(service.settings().dailyMinutes, 40);
  assert.deepEqual(service.settings().focusTopics, ['提示词设置保留测试']);
});

test('unknown keys and missing required variables are rejected without saving partial changes', async t => {
  const paths = await tempPaths('prompt-validation-');
  const service = createService(paths);
  t.after(async () => {
    await service.close();
    await rm(paths.root, { recursive: true, force: true });
  });
  const original = promptByKey(service, 'sourceExtract').template;
  const validButUncommitted = `SHOULD_NOT_BE_SAVED\n${original}`;

  assert.throws(
    () => service.updatePrompts({
      prompts: {
        sourceExtract: validButUncommitted,
        unknownPromptKey: '未知提示词',
      },
    }),
    error => error.code === 'INVALID_PROMPT' && /未知提示词/.test(error.message),
  );
  assert.equal(promptByKey(service, 'sourceExtract').template, original);

  const missingSource = original.replace(/{{\s*source\s*}}/g, '');
  assert.notEqual(missingSource, original);
  assert.throws(
    () => service.updatePrompts({ prompts: { sourceExtract: missingSource } }),
    error => error.code === 'INVALID_PROMPT' && /source/.test(error.message),
  );
  assert.equal(promptByKey(service, 'sourceExtract').template, original);
  assert.deepEqual(service.settings().prompts, {});
});

test('source processing renders the saved sourceExtract template into the actual model request', async t => {
  const paths = await tempPaths('prompt-render-');
  const generateCalls = [];
  const ai = {
    async generate(input) {
      generateCalls.push(input);
      return {
        text: JSON.stringify({
          candidates: [{
            title: '提示词渲染候选',
            body: '提示词渲染候选正文。',
            topic: '提示词透明',
            claims: [],
            prerequisites: [],
            reason: '验证用户模板进入实际请求。',
            depth: 'explain',
          }],
        }),
      };
    },
  };
  const service = createService({ ...paths, aiOverride: ai });
  t.after(async () => {
    await service.close();
    await rm(paths.root, { recursive: true, force: true });
  });
  const sourceBody = 'SOURCE_BODY_RENDER_VALUE';
  const custom = 'CUSTOM_SOURCE_EXTRACT_MARKER\n只处理这份资料：{{source}}';
  service.updatePrompts({ prompts: { sourceExtract: custom } });
  const imported = service.importItems({
    items: [{ title: '提示词渲染来源', body: sourceBody, privacy: 'local' }],
    process: true,
  });

  await service.runJobs();

  assert.equal(generateCalls.length, 1);
  assert.equal(generateCalls[0].prompt, `CUSTOM_SOURCE_EXTRACT_MARKER\n只处理这份资料：${sourceBody}`);
  assert.doesNotMatch(generateCalls[0].prompt, /{{\s*source\s*}}/);
  assert.equal(service.store.get('jobs', imported.jobs[0].id).state, 'done');
  assert.equal(service.listNotes({ kind: 'knowledge' }).length, 1);
});
