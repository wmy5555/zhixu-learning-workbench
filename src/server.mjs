import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createService } from './service.mjs';
import { atomicWrite, fail, now } from './store.mjs';
import { createOnboarding } from './onboarding.mjs';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const safeEqual = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function readJSON(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 50 * 1024 * 1024) fail('请求超过 50 MB，请拆分导入。', 'TOO_LARGE', 413); chunks.push(chunk); }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('请求不是有效的 JSON。'); }
}
export function createApp({ dataDir = path.resolve(process.env.LEARNING_DATA_DIR || '.data'), vaultDir = process.env.LEARNING_VAULT_DIR ? path.resolve(process.env.LEARNING_VAULT_DIR) : undefined, scheduler = true, service: supplied } = {}) {
  const service = supplied || createService({ dataDir, vaultDir });
  const mainService = service;
  const onboarding = createOnboarding({ dataDir, mainService });
  const tokenPath = path.join(dataDir,'mcp-token');
  if (!fs.existsSync(tokenPath)) atomicWrite(tokenPath, randomBytes(32).toString('hex'));
  let mcpToken = fs.readFileSync(tokenPath,'utf8').trim();
  const sessions = new Map(); let timer, busyTick = false;
  function json(res, status, data, headers = {}) { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', ...headers }); res.end(JSON.stringify(data)); }
  const server = http.createServer(async(req,res) => {
    try {
      const localPort = server.address()?.port;
      const allowedHosts = [`127.0.0.1:${localPort}`,`localhost:${localPort}`];
      if (!allowedHosts.includes(req.headers.host)) fail('仅允许从本机地址访问。','HOST_DENIED',403);
      const origin = `http://${req.headers.host}`;
      if (req.headers.origin && req.headers.origin !== origin) fail('拒绝跨站调用本地知识服务。','ORIGIN_DENIED',403);
      const url = new URL(req.url,origin), parts=url.pathname.split('/').filter(Boolean).map(decodeURIComponent), query=Object.fromEntries(url.searchParams), method=req.method;
      if (!url.pathname.startsWith('/api/')) {
        if(method!=='GET'&&method!=='HEAD')fail('不支持的方法。','METHOD',405);
        let rel=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
        if (rel.includes('..') || rel.includes('\\') || rel.includes('\0')) fail('路径无效。','PATH_ESCAPE',403);
        const file=path.join(publicDir,rel); if(!fs.existsSync(file)||!fs.statSync(file).isFile())fail('页面不存在。','NOT_FOUND',404);
        const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8'};
        // Only the read-only guide may be embedded by our own help dialog.
        const frameAncestors = file === path.join(publicDir, 'guide.html') ? "'self'" : "'none'";
        res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors ${frameAncestors}; form-action 'self'`}); if(method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);return;
      }
      if (parts[1]==='session'&&method==='GET') {
        const existingId = (req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith('learning_session='))?.slice(17);
        const existing = sessions.get(existingId);
        if (existing && Date.now()-existing.at <= 86400000) return json(res,200,{csrf:existing.csrf});
        const id=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
        sessions.set(id,{csrf,at:Date.now()});
        for(const [key,value]of sessions)if(Date.now()-value.at>86400000)sessions.delete(key);
        return json(res,200,{csrf},{'Set-Cookie':`learning_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`});
      }
      if(parts[1]==='mcp'){
        if(!safeEqual(req.headers.authorization || '',`Bearer ${mcpToken}`))fail('MCP 访问凭据无效。','MCP_UNAUTHORIZED',401);
        if(!service.settings().mcp.enabled)fail('MCP 尚未启用。','MCP_DISABLED',403);
        const body=method==='POST'?await readJSON(req):{};
        let result;
        if(parts[2]==='search'&&method==='GET')result=await service.search(query.q,{...query,mode:query.mode||'keyword'});
        else if(parts[2]==='notes'&&method==='GET')result=service.getNote(parts[3]);
        else if(parts[2]==='sources'&&method==='GET'){result=service.getNote(parts[3]);if(result.kind!=='source')fail('来源不存在。','NOT_FOUND',404);}
        else if(parts[2]==='related'&&method==='GET')result=service.related(parts[3]);
        else if(parts[2]==='proposals'&&method==='POST')result={proposal:service.propose(body)};
        else fail('MCP 接口不存在。','NOT_FOUND',404);
        service.store.put('mcpCalls',randomBytes(10).toString('hex'),{operation:parts[2],id:parts[3]||null,at:now(),resultCount:result.results?.length ?? result.notes?.length ?? 1});
        return json(res,method==='POST'?201:200,result);
      }
      const cookie=(req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith('learning_session='))?.slice(17),session=sessions.get(cookie);
      if(!session||Date.now()-session.at>86400000)fail('会话已过期，请刷新页面。','SESSION_REQUIRED',401);
      if(!['GET','HEAD'].includes(method)&&!safeEqual(req.headers['x-csrf-token']||'',session.csrf))fail('请求缺少有效的操作凭据，请刷新页面。','CSRF_DENIED',403);
      const body=['POST','PUT','DELETE'].includes(method)?await readJSON(req):{};
      if (parts[1] === 'onboarding') {
        let result;
        if (parts[2] === 'state' && method === 'GET') result = onboarding.state();
        else if (method === 'POST') {
          if (parts[2] === 'start') result = onboarding.start();
          else if (parts[2] === 'resume') result = onboarding.resume(body.practiceId);
          else if (parts[2] === 'pause') result = await onboarding.pause(body.practiceId);
          else if (parts[2] === 'reset') result = await onboarding.reset(body.practiceId);
          else if (parts[2] === 'advance') result = onboarding.advance(body.practiceId, body.action);
          else if (parts[2] === 'case') result = onboarding.caseAction(body.practiceId, body.caseId);
          else if (parts[2] === 'abandon') result = onboarding.abandon(body.practiceId, body.sessionId);
          else if (parts[2] === 'checkpoint') result = onboarding.checkpoint(body.practiceId, body);
          else if (parts[2] === 'event') result = onboarding.clientEvent(body.practiceId, body.event);
          else if (parts[2] === 'test') result = await onboarding.test(body.capability);
          else if (parts[2] === 'dismiss') result = onboarding.dismiss();
          else fail('引导接口不存在。', 'NOT_FOUND', 404);
        } else fail('引导接口不存在。', 'NOT_FOUND', 404);
        return json(res, 200, result);
      }
      const practiceId = parts[1] === 'practice' ? parts[2] : null;
      const route=parts.slice(practiceId !== null ? 3 : 1),[resource,id,action]=route;
      const lease = practiceId !== null ? onboarding.acquire(practiceId, { resource, method, query }) : null;
      try {
      const service = lease?.service || mainService;
      let result;
      if(resource==='bootstrap'&&method==='GET'){result=service.bootstrap();if(practiceId)result.conflicts.push(...service.store.records('onboardingConflicts'));}
      else if(resource==='library'&&method==='GET')result=service.library(query);
      else if(resource==='notes'&&!id&&method==='GET')result={notes:service.listNotes(query).filter(n=>!n.meta.excerptOnly).map(service.publicNote)};
      else if(resource==='notes'&&id==='merge'&&method==='POST')result=service.merge(body);
      else if(resource==='notes'&&id&&!action&&method==='GET')result=service.readPublicNote(id);
      else if(resource==='notes'&&id&&!action&&method==='PUT')result=service.editNote(id,body);
      else if(resource==='notes'&&id&&!action&&method==='DELETE'){result=service.store.delete(id,body.expectedHash);for(const j of service.store.records('jobs'))if(j.payload.noteId===id&&['queued','waiting','running'].includes(j.state))service.jobAction(j.id,{action:'cancel'});service.store.db.prepare("DELETE FROM records WHERE namespace='research'").run();}
      else if(resource==='notes'&&action==='extract'&&method==='POST')result=service.extractNote(id,body);
      else if(resource==='notes'&&action==='process'&&method==='POST')result=service.processNote(id,body);
      else if(resource==='notes'&&action==='promote'&&method==='POST')result=service.promote(id,body);
      else if(resource==='notes'&&action==='confirm'&&method==='POST')result=service.confirmNote(id,body);
      else if(resource==='notes'&&action==='evidence'&&method==='GET')result=service.noteEvidence(id);
      else if(resource==='notes'&&action==='relate'&&method==='POST')result=service.requestRelations(id,body);
      else if(resource==='notes'&&action==='links-preview'&&method==='GET')result=service.linksPreview(id);
      else if(resource==='notes'&&action==='links-sync'&&method==='POST')result=service.syncLinks(id,body);
      else if(resource==='recommendations'&&!id&&method==='GET')result=service.recommendations();
      else if(resource==='recommendations'&&action==='action'&&method==='POST')result=service.recommendationAction(id,body);
      else if(resource==='import'&&method==='POST')result=service.importItems(body);
      else if(resource==='search'&&method==='GET'){result=await service.search(query.q,{...query,browse:true});result.results=result.results.map(n=>{const clean=service.publicNote(n);return {...clean,snippet:clean.body.slice(0,500)};});}
      else if(resource==='ask'&&method==='POST')result=await service.ask(body);
      else if(resource==='drafts'&&!id&&method==='GET')result={drafts:service.store.records('drafts')};
      else if(resource==='drafts'&&id&&!action&&method==='PUT')result=service.updateDraft(id,body);
      else if(resource==='drafts'&&action==='capture'&&method==='POST'){if(!service.store.get('drafts',id))fail('草稿不存在。','NOT_FOUND',404);result=service.importItems({items:[{...body,platform:'应用内 AI 草稿（用户选取）'}]}).notes[0];}
      else if(resource==='today'&&(!id||id==='generate'))result=service.today({regenerate:method==='POST'});
      else if(resource==='today'&&action==='action'&&method==='POST')result=service.planAction(id,body);
      else if(resource==='study'&&id==='start'&&method==='POST')result=service.startStudy(body);
      else if(resource==='study'&&!id&&method==='GET')result={sessions:service.store.records('sessions').slice(0,50)};
      else if(resource==='study'&&id&&!action&&method==='GET')result=service.session(id);
      else if(resource==='study'&&action==='answer'&&method==='POST')result=service.answerStudy(id,body);
      else if(resource==='study'&&action==='hint'&&method==='POST')result=service.hintStudy(id);
      else if(resource==='study'&&action==='confirm'&&method==='POST')result=service.confirmStudy(id,body);
      else if(resource==='study'&&action==='finish'&&method==='POST')result=service.finishStudy(id);
      else if(resource==='mistakes'&&!id&&method==='GET')result={mistakes:service.listNotes({kind:'mistake'})};
      else if(resource==='mistakes'&&action==='action'&&method==='POST')result=service.mistakeAction(id,body);
      else if(resource==='topics'&&!id&&method==='GET')result={topics:service.topics()};
      else if(resource==='topics'&&id==='suggest'&&method==='POST')result=service.queue('topics',{},'topics:manual');
      else if(resource==='topics'&&!id&&method==='POST')result=service.createTopic(body);
      else if(resource==='topics'&&id&&!action&&method==='PUT')result=service.updateTopic(id,body);
      else if(resource==='topics'&&action==='action'&&method==='POST')result=service.topicAction(id,body);
      else if(resource==='relations'&&!id&&method==='GET')result=service.relationReview();
      else if(resource==='relations'&&action==='action'&&method==='POST')result=service.relationAction(id,body);
      else if(resource==='discover'&&method==='POST')result=service.queue('discover',{useAI:body.useAI===true},`discovery:manual:${new Date().toISOString().slice(0,10)}:${body.useAI===true}`);
      else if(resource==='jobs'&&!id&&method==='GET')result={jobs:service.store.records('jobs').map(service.publicJob)};
      else if(resource==='jobs'&&action==='action'&&method==='POST')result=service.jobAction(id,body);
      else if(resource==='prompts'&&method==='GET')result=service.getPrompts();
      else if(resource==='prompts'&&method==='PUT')result=service.updatePrompts(body);
      else if(resource==='settings'&&!id&&method==='GET')result=service.settings();
      else if(resource==='settings'&&!id&&method==='PUT'){if(!practiceId&&body.vaultDir)onboarding.assertVaultIsolation(body.vaultDir);result=service.updateSettings(body);if(!practiceId)onboarding.settingsChanged(body);}
      else if(resource==='settings'&&id==='test'&&method==='POST')result=(await onboarding.test(body.capability)).testResult;
      else if(resource==='diagnostics'&&method==='GET'){result=service.diagnostics();if(practiceId){result.usage=mainService.usage();result.calls=mainService.store.records('calls').slice(0,100);result.sharedUsage=true;result.usageNotice='请求上限与日常使用共用。下方调用记录来自共用 AI 服务，包含正式与练习请求；仅在此查看，不写入练习备份。';}}
      else if(resource==='index'&&id==='rebuild'&&method==='POST')result=service.queue('index',{},'index:manual');
      else if(resource==='index'&&id==='update'&&method==='POST')result=service.queue('index',{incremental:true},'index:manual');
      else if(resource==='backup'&&method==='GET'){
        result=service.backup();
        if(practiceId){result.learningTime=onboarding.state().clock.now;onboarding.observe(practiceId,{resource,itemId:id,action,method,body,query,result});}
        return json(res,200,result,{'Content-Disposition':`attachment; filename="${practiceId?'practice':'learning'}-backup-${Date.now()}.json"`});
      }
      else if(resource==='restore'&&method==='POST')result=service.restore(body);
      else if(resource==='history'&&id&&!action&&method==='GET')result={versions:service.store.history(id)};
      else if(resource==='history'&&action==='restore'&&method==='POST')result=service.store.restoreVersion(id,body.versionId,body.expectedHash);
      else if(resource==='proposals'&&!id&&method==='GET')result={proposals:service.store.records('proposals')};
      else if(resource==='proposals'&&action==='action'&&method==='POST')result=service.proposalAction(id,body);
      else if(resource==='demo'&&method==='POST')result=service.demo();
      else fail('接口不存在。','NOT_FOUND',404);
      if(practiceId)onboarding.observe(practiceId,{resource,itemId:id,action,method,body,query,result});
      json(res,200,result);
      } finally { lease?.release(); }
    }catch(error){if(!res.headersSent)json(res,error.status||400,{error:error.message||'请求失败。',code:error.code||'REQUEST_FAILED'});else res.end();}
  });
  server.requestTimeout=60000;server.headersTimeout=15000;
  let practiceTimer;
  server.on('listening',()=>{if(scheduler){const tick=async()=>{if(busyTick)return;busyTick=true;try{await service.tick();}catch(error){console.error('后台任务暂时失败：',error.code||'ERROR');}finally{busyTick=false;}};timer=setInterval(tick,3000);timer.unref();tick();practiceTimer=setInterval(()=>{onboarding.pump().catch(error=>console.error('练习任务暂时失败：',error.code||'ERROR'));},1000);practiceTimer.unref();}});
  return {server,service,onboarding,async close(){clearInterval(timer);clearInterval(practiceTimer);await new Promise(resolve=>server.close(resolve));await onboarding.close();await service.close();}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const app=createApp();const port=Number(process.env.PORT||4318);
  app.server.listen(port,'127.0.0.1',()=>console.log(`知序 · 个人学习工作台已启动：http://127.0.0.1:${port}\n数据保存在本机。关闭本进程将停止后台调度。`));
  app.server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'端口已被使用，应用可能已经启动。':error.message);process.exitCode=1;});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await app.close();process.exit(0);});
}
