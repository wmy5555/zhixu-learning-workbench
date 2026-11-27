import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectWebModules, inspectServerModules } from '../scripts/check-architecture.mjs';

test('网页依赖图使用浏览器根路径，识别异步导入与重导出', () => {
  const { graph, errors } = inspectWebModules(new Map([
    ['web/main.mjs', "export { show } from './screen.mjs'; import('/shared.mjs?reload');"],
    ['web/screen.mjs', "export const show = () => api.import({}); // import '/missing.mjs'"],
    ['shared.mjs', "export default \"import('/missing.mjs')\";"],
  ]));
  assert.deepEqual(errors, []);
  assert.equal(graph['web/main.mjs'].length, 2);
  assert.ok(graph['web/main.mjs'].some(edge => edge.target === 'shared.mjs' && edge.lazy));
  assert.deepEqual(graph['shared.mjs'], []);
});

test('禁止页面模块反向依赖入口，并发现经由异步导入形成的环和未解析路径', () => {
  const { errors } = inspectWebModules(new Map([
    ['web/main.mjs', "import './feature.mjs';"],
    ['web/feature.mjs', "import('/web/main.mjs'); import('../src/private.mjs'); import(name);"],
  ]));
  assert.ok(errors.some(error => error.includes('入口')));
  assert.ok(errors.some(error => error.includes('web/main.mjs → web/feature.mjs → web/main.mjs')));
  assert.ok(errors.some(error => error.includes('找不到网页模块 src/private.mjs')));
  assert.ok(errors.some(error => error.includes('可静态定位')));
});

test('共用控件不能再从业务页面集引入，即使没有形成循环', () => {
  const { errors } = inspectWebModules(new Map([
    ['web/main.mjs', "import './parity.mjs';"],
    ['web/parity.mjs', ''],
    ['web/focus.mjs', "import './parity.mjs';"],
  ]));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /web\/focus\.mjs:1 .*主入口装配/);
});

test('供应商模块须有实际资源或已知的挂载入口，错误地址带文件与行号', () => {
  const source = [
    "import('/vendor/filepond.esm.js');",
    "import('/vendor/editor.js');",
    "import('/vendor/filepnd.esm.js');",
    "import('./%oops.mjs');",
  ].join('\n');
  const { errors } = inspectWebModules(new Map([['web/editor.mjs', source]]), ['vendor/editor.js']);
  assert.equal(errors.length, 2);
  assert.ok(errors.some(error => error.startsWith('web/editor.mjs:3 ') && error.includes('filepnd')));
  assert.ok(errors.some(error => error.startsWith('web/editor.mjs:4 ') && error.includes('%oops')));
});

test('直接启动工具会输出可读取的真实网页依赖图', () => {
  const script = fileURLToPath(new URL('../scripts/check-architecture.mjs', import.meta.url));
  const graph = JSON.parse(execFileSync(process.execPath, [script, '--json'], { encoding: 'utf8' }));
  assert.ok(graph.web['web/main.mjs'].some(edge => edge.target === 'web/parity.mjs'));
  assert.ok(graph.server['src/attachments.mjs'].some(edge => edge.target === 'src/word-worker.mjs'));
});

test('服务端边界覆盖工作线程、第三方包、共享数据的传递依赖与模块环', () => {
  const sources = new Map([
    ['src/a.mjs', "import 'yaml'; import 'node:fs'; new Worker(new URL('./b.mjs', import.meta.url));"],
    ['src/b.mjs', "import './a.mjs'; import '../public/web/reader.mjs'; import 'unlisted';"],
  ]);
  const web = { 'web/onboarding-model.mjs': [{ target: 'web/main.mjs' }] };
  const { errors } = inspectServerModules(sources, web, { yaml: '2' });
  assert.ok(errors.some(error => error.includes('src/a.mjs → src/b.mjs → src/a.mjs')));
  assert.ok(errors.some(error => error.includes('reader.mjs')));
  assert.ok(errors.some(error => error.includes('unlisted')));
  assert.ok(errors.some(error => error.includes('不应依赖浏览器专用模块')));
});

test('跨端数据模块不能把站点根路径当作 Node 文件系统根路径', () => {
  const sources = new Map([
    ['onboarding-materials.mjs', "import '/source-file-limits.mjs';"],
    ['source-file-limits.mjs', ''],
  ]);
  assert.match(inspectWebModules(sources).errors.join('\n'), /跨端数据模块请使用相对路径/);
});
