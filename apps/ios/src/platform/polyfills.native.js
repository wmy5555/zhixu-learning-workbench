import { Buffer } from 'buffer';
globalThis.Buffer ??= Buffer;
globalThis.structuredClone ??= value => JSON.parse(JSON.stringify(value));
// These APIs are present in Node 24 but are not guaranteed by every Hermes build.
if(!AbortSignal.timeout)AbortSignal.timeout=ms=>{const controller=new AbortController();setTimeout(()=>controller.abort(Object.assign(Error('请求超时'),{name:'TimeoutError'})),ms);return controller.signal;};
if(!AbortSignal.any)AbortSignal.any=signals=>{const controller=new AbortController(),cleanups=[];const abort=signal=>{if(!controller.signal.aborted)controller.abort(signal.reason);for(const cleanup of cleanups)cleanup();};for(const signal of signals){if(signal.aborted){abort(signal);break;}const listener=()=>abort(signal);signal.addEventListener('abort',listener,{once:true});cleanups.push(()=>signal.removeEventListener('abort',listener));}return controller.signal;};
