import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'acorn';

// Read syntax without evaluating the application, including lazy imports and re-exports.
function moduleRequests(source) {
  const pending = [parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true })];
  const requests = [];
  while (pending.length) {
    const node = pending.pop();
    const worker = node.type === 'NewExpression' && node.callee.name === 'Worker';
    const address = worker && node.arguments[0];
    const workerPath = address?.type === 'NewExpression' && address.callee.name === 'URL' && address.arguments[0];
    if (worker || (['ImportDeclaration', 'ExportAllDeclaration', 'ExportNamedDeclaration', 'ImportExpression'].includes(node.type) && node.source)) {
      const value = worker ? workerPath || {} : node.source;
      const path = value.type === 'Literal' ? value.value :
        value.type === 'TemplateLiteral' && !value.expressions.length ? value.quasis[0].value.cooked : null;
      requests.push({ path, line: node.loc.start.line, lazy: worker || node.type === 'ImportExpression' });
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) pending.push(...child.filter(item => item?.type));
      else if (child?.type) pending.push(child);
    }
  }
  return requests.reverse();
}

// These four URLs are supplied by the HTTP vendor route from installed packages.
// Other vendor modules must exist in the tracked static assets.
const mountedModules = [
  'filepond', 'filepond-plugin-file-validate-type',
  'filepond-plugin-file-validate-size', 'filepond-plugin-image-preview',
].map(name => 'vendor/' + name + '.esm.js');

const routedPages = new Set(['web/parity.mjs', 'web/library-page.mjs', 'web/search-page.mjs']);

export function inspectWebModules(sources, vendorFiles = []) {
  const vendor = new Set([...mountedModules, ...vendorFiles]);
  const graph = {};
  const errors = [];
  for (const [file, source] of sources) {
    const edges = graph[file] = [];
    for (const { path, line, lazy } of moduleRequests(source)) {
      const at = file + ':' + line;
      if (typeof path !== 'string' || !/^(?:\.\.?\/|\/(?!\/))/.test(path)) {
        errors.push(at + ' 请使用可静态定位的站内模块路径。');
        continue;
      }
      let url, target;
      try {
        url = new URL(path, 'https://workbench.invalid/' + file);
        target = decodeURIComponent(url.pathname.slice(1));
      } catch {
        errors.push(at + ' 无法解析网页模块地址 ' + path);
        continue;
      }
      edges.push({ target, lazy });
      if (url.origin !== 'https://workbench.invalid') errors.push(at + ' 网页模块必须来自本站。');
      else if (shared.has('public/' + file) && path.startsWith('/')) errors.push(at + ' 跨端数据模块请使用相对路径，使浏览器与 Node 解析到同一文件。');
      else if (vendor.has(target)) continue;
      else if (!sources.has(target)) errors.push(at + ' 找不到网页模块 ' + target + '，请核对浏览器地址及 Git 跟踪文件。');
      else if (target === 'web/main.mjs' || target === 'app.mjs') errors.push(at + ' 请直接引用功能模块，页面入口只能负责组装。');
      else if (routedPages.has(target) && file !== 'web/main.mjs') errors.push(at + ' 请直接引用共享展示或控件模块，' + target + ' 只由主入口装配。');
    }
  }
  errors.push(...cycles(graph));
  return { graph, errors };
}

function cycles(graph) {
  const errors = [], visited = new Set();
  const path = [];
  function visit(file) {
    if (path.includes(file)) {
      errors.push('请解除循环依赖：' + [...path.slice(path.indexOf(file)), file].join(' → '));
      return;
    }
    if (visited.has(file)) return;
    visited.add(file);
    path.push(file);
    for (const { target } of graph[file]) if (Object.hasOwn(graph, target)) visit(target);
    path.pop();
  }
  for (const file of Object.keys(graph)) visit(file);
  return errors;
}

// Both environments consume these data-only files. Their dependencies must also
// belong to this set so importing one cannot bring a browser page into Node.
const shared = new Set(['public/source-membership.mjs', 'public/note-classification.mjs', 'public/source-file-limits.mjs', 'public/onboarding-curriculum.mjs',
  'public/onboarding-materials.mjs', 'public/web/onboarding-model.mjs']);

export function inspectServerModules(sources, webGraph, dependencies) {
  const graph = {}, errors = [];
  for (const [file, source] of sources) {
    const edges = graph[file] = [];
    for (const { path, line, lazy } of moduleRequests(source)) {
      const at = file + ':' + line;
      if (typeof path !== 'string') {
        errors.push(at + ' 请使用可静态定位的服务端模块路径。');
        continue;
      }
      if (isBuiltin(path)) { edges.push({ target: path, lazy }); continue; }
      if (!path.startsWith('./') && !path.startsWith('../')) {
        const name = path.split('/').slice(0, path.startsWith('@') ? 2 : 1).join('/');
        if (!Object.hasOwn(dependencies, name)) errors.push(at + ' 请使用已声明的运行依赖：' + path);
        edges.push({ target: 'npm:' + path, lazy });
        continue;
      }
      const target = posix.join(posix.dirname(file), path);
      edges.push({ target, lazy });
      if (shared.has(target) && Object.hasOwn(webGraph, target.slice('public/'.length))) continue;
      if (!sources.has(target)) errors.push(at + ' 请引用服务端模块或已登记的跨端数据定义：' + target);
    }
  }
  for (const file of shared) {
    for (const { target } of webGraph[file.slice('public/'.length)] ?? []) {
      if (!shared.has('public/' + target)) errors.push(file + ' 不应依赖浏览器专用模块：' + target);
    }
  }
  errors.push(...cycles(graph));
  return { graph, errors };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const root = new URL('../public/', import.meta.url);
  const project = new URL('../', root);
  const files = execFileSync('git', ['ls-files', '-z', '--', 'public', 'src'], { cwd: project, encoding: 'utf8' })
    .split('\0').filter(file => /\.m?js$/.test(file));
  const sources = new Map(files.filter(file => file.startsWith('public/') && !file.startsWith('public/vendor/')).map(file => {
    const name = posix.relative('public', file);
    return [name, readFileSync(new URL(name, root), 'utf8')];
  }));
  const vendorFiles = files.filter(file => file.startsWith('public/vendor/')).map(file => posix.relative('public', file));
  const web = inspectWebModules(sources, vendorFiles);
  const serverSources = new Map(files.filter(file => file.startsWith('src/')).map(file => [file, readFileSync(new URL(file, project), 'utf8')]));
  const { dependencies } = JSON.parse(readFileSync(new URL('package.json', project), 'utf8'));
  const server = inspectServerModules(serverSources, web.graph, dependencies);
  const errors = [...web.errors, ...server.errors];
  if (process.argv.includes('--json')) console.log(JSON.stringify({ web: web.graph, server: server.graph }, null, 2));
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else if (!process.argv.includes('--json')) {
    console.log(`模块依赖检查通过，网页 ${sources.size} 个模块，服务端 ${serverSources.size} 个模块。`);
  }
}
