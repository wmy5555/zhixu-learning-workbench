import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
const fail=(code,message)=>Object.assign(new Error(message),{code});

function normalizeResponseHeaders(headers) {
  const result = new Map();
  if (headers?.forEach) headers.forEach((value, key) => result.set(key.toLowerCase(), value));
  else for (const [key, value] of Object.entries(headers ?? {})) {
    result.set(key.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value ?? ''));
  }
  return { get: (name) => result.get(String(name).toLowerCase()) ?? null };
}


// Connection fallback happens before HTTP transmission; this makes one ClientRequest.
// The caller must reject the whole DNS answer if any address is not public.
export function pinnedRequest(target, options, maxBytes) {
  const addresses = target.addresses.map(({address,family}) => ({address,family}));
  const url = target.url;
  const client = url.protocol === 'https:' ? https : http;
  const defaultPort = url.protocol === 'https:' ? 443 : 80;
  const hostHeader = url.port && Number(url.port) !== defaultPort ? `${url.hostname}:${url.port}` : url.hostname;
  const requestOptions = {
    protocol: url.protocol,
    hostname: url.hostname.replace(/^\[|\]$/g, ''),
    // Only the already validated DNS snapshot may be used. No second DNS lookup.
    lookup: (_hostname, lookupOptions, callback) => lookupOptions.all
      ? callback(null, addresses.map(a=>({...a})))
      : callback(null, addresses[0].address, addresses[0].family),
    autoSelectFamily: true,
    autoSelectFamilyAttemptTimeout: 500,
    agent: false,
    port: url.port || defaultPort,
    method: options.method,
    path: `${url.pathname}${url.search}`,
    headers: { ...options.headers, host: hostHeader },
    signal: options.signal,
  };
  if (url.protocol === 'https:') requestOptions.servername = isIP(url.hostname.replace(/^\[|\]$/g, '')) ? undefined : url.hostname;

  return new Promise((resolve, reject) => {
    const request = client.request(requestOptions, (response) => {
      const chunks = [];
      let size = 0;
      const declared = Number(response.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) {
        response.destroy();
        reject(fail('RESPONSE_TOO_LARGE', '外部响应超过大小限制。'));
        return;
      }
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          response.destroy(fail('RESPONSE_TOO_LARGE', '外部响应超过大小限制。'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        headers: normalizeResponseHeaders(response.headers),
        body: Buffer.concat(chunks),
      }));
      response.on('error', reject);
    });
    request.on('error', error => {
      if (!error.message && error.errors?.length) error.message = `连接已校验的服务地址失败（${error.errors.map(e=>e.code||'NETWORK_ERROR').join(', ')}）；未获得 HTTP 响应。`;
      reject(error);
    });
    if (options.body) request.write(options.body);
    request.end();
  });
}
