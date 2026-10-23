import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';
import { Buffer } from 'buffer';
import runtime from './runtime.native.js';
const digest = (fn, key) => { const chunks = []; return { update(value) { chunks.push(Buffer.from(value)); return this; }, digest(encoding) { const bytes = Buffer.from(key ? hmac(fn, key, Buffer.concat(chunks)) : fn(Buffer.concat(chunks))); return encoding ? bytes.toString(encoding) : bytes; } }; };
export const createHash = type => { if(type !== 'sha256')throw Error('Only SHA256 is supported'); return digest(sha256); };
export const createHmac = (type,key) => { if(type !== 'sha256')throw Error('Only HMAC-SHA256 is supported'); return digest(sha256,Buffer.from(key)); };
export const randomUUID = () => runtime.uuid();
export const randomBytes = count => Buffer.from(runtime.random(count),'base64');
export function timingSafeEqual(a,b) { if(a.length !== b.length)throw Error('Length mismatch'); let different=0; for(let i=0;i<a.length;i++)different|=a[i]^b[i];return different===0; }
export default { createHash,createHmac,randomUUID,randomBytes,timingSafeEqual };
