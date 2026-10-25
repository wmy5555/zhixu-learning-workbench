// Throwaway, local-only preview. No product server, data, scheduler, or AI calls.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const root = new URL('../public/web/prototype-feed/', import.meta.url);
const files = new Map([
  ['/web/prototype-feed/', ['index.html', 'text/html; charset=utf-8']],
  ['/web/prototype-feed/feed.css', ['feed.css', 'text/css; charset=utf-8']],
  ['/web/prototype-feed/feed.mjs', ['feed.mjs', 'text/javascript; charset=utf-8']],
  ['/web/prototype-feed/immersive-deck.mjs', ['immersive-deck.mjs', 'text/javascript; charset=utf-8']],
  ['/web/prototype-feed/immersive.css', ['immersive.css', 'text/css; charset=utf-8']],
  ['/web/prototype-feed/discovery-layout.mjs', ['discovery-layout.mjs', 'text/javascript; charset=utf-8']],
  ['/web/prototype-feed/discovery.css', ['discovery.css', 'text/css; charset=utf-8']],
]);
if (process.env.NODE_ENV === 'production') throw new Error('Prototype must not run in production.');
const port = Number(process.env.PROTOTYPE_PORT || 4361);
const server = createServer(async (req, res) => {
  const host = req.headers.host;
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) { res.writeHead(403); res.end(); return; }
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  if (url.pathname === '/') { res.writeHead(302, { Location:'/web/prototype-feed/?variant=A' }); res.end(); return; }
  const file = files.get(url.pathname);
  if (!file) { res.writeHead(404); res.end('Prototype file not found'); return; }
  res.writeHead(200, {
    'Content-Type':file[1], 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff',
    'Content-Security-Policy':"default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  });
  res.end(req.method === 'HEAD' ? undefined : await readFile(new URL(file[0], root)));
});
server.listen(port, '127.0.0.1', () => console.log(`PROTOTYPE_READY http://127.0.0.1:${port}/web/prototype-feed/?variant=A`));
