// Static, loopback-only prototype. No backend, proxy, database or credentials.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const files=new Set(['index.html','architecture.html','prototype.css','prototype.mjs','ui.mjs','onboarding-motion.mjs','onboarding-model.mjs','onboarding-motion.css','cds/ClaudeMotionPresets.mjs']);
const types={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',mjs:'text/javascript; charset=utf-8'};
const port=Number(process.env.PROTOTYPE_PORT||4349);
createServer(async(req,res)=>{
 const pathname=new URL(req.url,'http://127.0.0.1').pathname;
 const file=pathname==='/'?'index.html':pathname.slice(1);
 if(!['GET','HEAD'].includes(req.method)||!files.has(file)){res.writeHead(404);res.end();return;}
 try{const body=await readFile(new URL(file,import.meta.url));res.writeHead(200,{'Content-Type':types[file.split('.').pop()],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:body);}catch{res.writeHead(404);res.end();}
}).listen(port,'127.0.0.1',()=>console.log(`Zhixu disposable prototype: http://127.0.0.1:${port}/?variant=A`));
