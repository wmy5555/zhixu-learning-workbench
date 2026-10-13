import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const argument = process.argv.indexOf('--port');
const port = argument < 0 ? 4389 : Number(process.argv[argument + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || [4318, 4386].includes(port)) throw new Error('Use an independent preview port, not 4318 or 4386');
const web = await realpath(path.join(root, 'dist/ios-web'));
const previewEntry = `import { createIOSClient } from '/ios-client.mjs';
import { mountIOSPreview } from '/ios-ui.mjs';
import { createPreviewPlugin } from '/preview-native.mjs';
const fixture = createPreviewPlugin();
window.__zhixuIOSPreview = fixture.controls;
document.documentElement.style.setProperty('--ios-safe-top', '47px');
document.documentElement.style.setProperty('--ios-safe-bottom', '34px');
await mountIOSPreview(createIOSClient(fixture.plugin), { browserPreview: true });
`;
const frame = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>知序 iOS · Windows 阶段预览</title><style>body{margin:0;background:#edf1f2;color:#15313b;font:16px system-ui;padding:20px}header{max-width:950px;margin:auto auto 20px}h1{font-size:22px}p{line-height:1.6}select{padding:8px;border:1px solid #90a2a8;border-radius:8px}main{display:flex;justify-content:center}iframe{width:390px;height:844px;background:white;border:6px solid #233a42;border-radius:32px;box-shadow:0 20px 60px #233a4230}@media(max-width:460px){body{padding:8px}iframe{width:100%;border:0;border-radius:0}}</style><header><h1>Windows 浏览器阶段预览</h1><p>实际 iOS 阶段 UI · 合成数据 · 原生文件/恢复接口为内存模拟。安全区域近似为顶部 47、底部 34 px。不是 iOS/WKWebView、编译或真机验收。</p><label>近似屏幕 <select id="size"><option value="390,844">390 × 844（iPhone 尺寸）</option><option value="375,667">375 × 667（小屏）</option><option value="844,390">844 × 390（横屏）</option><option value="768,1024">768 × 1024（iPad 尺寸）</option></select></label><p id="version">源码版本：加载中</p></header><main><iframe id="phone" title="iOS 阶段 UI，Windows 浏览器模拟" src="/app/"></iframe></main><script>document.querySelector('#size').onchange=e=>{const [w,h]=e.target.value.split(',');const f=document.querySelector('#phone');f.style.width=w+'px';f.style.height=h+'px'};fetch('/preview-version.json').then(r=>r.json()).then(v=>document.querySelector('#version').textContent='Web 基线 '+v.webBaselineCommit.slice(0,7)+' · 当前 UI SHA-256 '+v.uiSha256.slice(0,12)+' · 刷新会重置合成资料')</script></html>`;
const mime = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.txt': 'text/plain', '.md': 'text/plain' };
const server = http.createServer(async (request, response) => {
  const host = request.headers.host;
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) { response.writeHead(403); response.end('Invalid preview host'); return; }
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
  response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`), route = decodeURIComponent(url.pathname);
    let bytes, type = 'text/html; charset=utf-8';
    if (route === '/') bytes = Buffer.from(frame);
    else if (route === '/preview-entry.mjs') { bytes = Buffer.from(previewEntry); type = 'text/javascript'; }
    else if (route === '/preview-native.mjs') { bytes = await readFile(path.join(root, 'scripts/fixtures/ios-preview-native.mjs')); type = 'text/javascript'; }
    else if (route === '/preview-version.json') {
      const assets = JSON.parse(await readFile(path.join(web, 'ios-assets.json'), 'utf8'));
      bytes = Buffer.from(JSON.stringify({ webBaselineCommit: assets.baseline.webBaselineCommit, uiSha256: createHash('sha256').update(await readFile(path.join(web, 'ios-ui.mjs'))).digest('hex') })); type = 'application/json';
    } else {
      const asset = route === '/app/' ? 'index.html' : route.slice(1);
      if (!asset || asset.includes('\\') || asset.split('/').some(part => !part || part === '.' || part === '..') || !mime[path.extname(asset)]) throw new Error('Invalid asset');
      const file = await realpath(path.join(web, asset));
      if (!file.startsWith(web + path.sep)) throw new Error('Asset escaped preview');
      bytes = await readFile(file); type = `${mime[path.extname(file)]}; charset=utf-8`;
      if (asset === 'index.html') bytes = Buffer.from(bytes.toString('utf8').replace('src="/ios-entry.mjs"', 'src="/preview-entry.mjs"'));
    }
    response.writeHead(200, { 'Content-Type': type }); response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch { response.writeHead(404); response.end('Preview asset not found'); }
});
server.on('error', error => { console.error(`Preview could not start: ${error.code || 'ERROR'}. Existing services were not stopped.`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Windows browser preview with synthetic platform APIs: http://127.0.0.1:${port}`));
