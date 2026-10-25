// Independent, loopback-only static preview. Never loads the app or real data.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
const root = new URL('../public/prototype-star-tree/', import.meta.url);
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/scene.js', ['scene.js', 'text/javascript; charset=utf-8']],
  ['/vendor/scrollama.min.js', ['vendor/scrollama.min.js', 'text/javascript; charset=utf-8']],
  ['/vendor/LICENSE.scrollama.txt', ['vendor/LICENSE.scrollama.txt', 'text/plain; charset=utf-8']],
  ['/RESEARCH.md', ['RESEARCH.md', 'text/plain; charset=utf-8']],
]);
const port = Number(process.env.PROTOTYPE_PORT || 0);
const server = http.createServer(async (req, res) => {
  const host = req.headers.host || '';
  if (!/^127\.0\.0\.1:\d+$/.test(host) && !/^localhost:\d+$/.test(host)) { res.writeHead(403).end(); return; }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
  const file = files.get(path);
  if (!file) { res.writeHead(404).end('Not found'); return; }
  try {
    const body = await readFile(new URL(file[0], root));
    res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404).end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Zhixu prototype: http://127.0.0.1:${server.address().port}/`));
