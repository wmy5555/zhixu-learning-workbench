import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const files = ['index.html','catalog.mjs','host.mjs','prototype.mjs','onboarding.css','host/prototype.css','host/styles.css','host/cds/cds-theme.css','host/cds/ClaudeMotionPresets.mjs','host/cds/motion-bridge.mjs'];
const types = {html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',mjs:'text/javascript; charset=utf-8'};
if(process.env.NODE_ENV==='production') throw new Error('Throwaway prototype: production execution is disabled.');
const port = Number(process.env.PROTOTYPE_PORT||4341);
createServer(async(req,res)=>{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  const file=path==='/'?'index.html':path.slice(1);
  if(!['GET','HEAD'].includes(req.method)||!files.includes(file)){res.writeHead(404);res.end('Prototype resource not found');return;}
  const content=await readFile(new URL(file,import.meta.url));
  res.writeHead(200,{'Content-Type':types[file.split('.').pop()],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});
  res.end(req.method==='HEAD'?undefined:content);
}).listen(port,'127.0.0.1',()=>console.log(`Zhixu onboarding prototype: http://127.0.0.1:${port}/?variant=A`));
