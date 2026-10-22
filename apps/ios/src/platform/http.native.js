import EventEmitter from 'eventemitter3';
import { Buffer } from 'buffer';
import runtime from './runtime.native.js';
export function request(options, callback) {
  const req=new EventEmitter(),chunks=[],id=runtime.uuid();
  req.write=data=>chunks.push(Buffer.from(data));
  req.end=()=>{
    const abort=()=>runtime.cancel(id);
    if(options.signal?.aborted) { queueMicrotask(()=>req.emit('error',options.signal.reason)); return; }
    options.signal?.addEventListener('abort',abort,{once:true});
    runtime.request(id,JSON.stringify({...options,signal:undefined,body:Buffer.concat(chunks).toString('base64')})).then(raw=>{
      const result=JSON.parse(raw),res=new EventEmitter();
      if(result.error)throw Object.assign(Error(result.error.message),{code:result.error.code});
      res.headers=result.headers;res.statusCode=result.status;let destroyed=false;
      res.destroy=error=>{destroyed=true;if(error)queueMicrotask(()=>res.emit('error',error));};
      callback(res);
      if(!destroyed){res.emit('data',Buffer.from(result.body,'base64'));if(!destroyed)res.emit('end');}
    }).catch(error=>req.emit('error',error)).finally(()=>options.signal?.removeEventListener('abort',abort));
  };
  return req;
}
export default { request };
