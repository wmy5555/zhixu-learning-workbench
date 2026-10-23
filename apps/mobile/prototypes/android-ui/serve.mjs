import http from 'node:http';
import fs from 'node:fs';
if (process.env.NODE_ENV === 'production') throw Error('This throwaway design route is not a production app.');
const file = new URL('./index.html', import.meta.url);
const port = Number(process.env.PROTOTYPE_PORT || 14348);
http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (!['/', '/prototype/android-ui', '/prototype/android-ui/'].includes(url.pathname)) {
    response.writeHead(404); response.end(); return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(fs.readFileSync(file));
}).listen(port, '127.0.0.1', () => console.log(`Android UI prototype: http://127.0.0.1:${port}/prototype/android-ui?variant=A`));
