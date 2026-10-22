// A new web client for the documented HTTP contract. Session tokens stay in memory.
export function createClient(fetcher = (...args) => fetch(...args)) {
  let csrf = '';
  let practiceId='', pending=0, version=0, revision=0;
  const context=()=>({practiceId,pending,version,revision});
  const setContext=(id='')=>{if(id===practiceId)return;if(pending)throw Error('当前操作仍在处理中，请稍后切换知识库。');if(id&&!/^[a-zA-Z0-9-]+$/.test(id))throw Error('练习空间标识无效。');practiceId=id;version++;};
  let starting;
  async function session() {
    if (!starting) starting = fetcher('/api/session', { credentials: 'same-origin', cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || !data.csrf) throw new Error(data.error || '无法建立本地会话。');
        csrf = data.csrf;
      }).finally(() => { starting = null; });
    return starting;
  }
  async function request(path, { method = 'GET', body, binary, signal } = {}) {
    if (!path.startsWith('/api/') || path.includes('://')) throw new Error('只允许调用本机知识接口。');
    const requestVersion=version;
    const scoped=practiceId&&!['session','onboarding'].includes(path.split('/')[2]);
    const actual=scoped?'/api/practice/'+encodeURIComponent(practiceId)+path.slice(4):path;
    pending++;
    try {
    for(let attempt=0;attempt<2;attempt++){
    if(signal?.aborted)throw signal.reason;
    if (!csrf) await session();
    const requestCsrf=csrf;
    const response = await fetcher(actual, {
      method, signal, credentials: 'same-origin', cache: 'no-store',
      headers: { ...(binary ? { 'Content-Type': binary.type || 'application/octet-stream' } : body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-CSRF-Token': requestCsrf } : {}) },
      ...(binary ? { body: binary } : body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) {
      const expired=response.status===401&&data.code==='SESSION_REQUIRED';
      // A late response must not discard a session another request just renewed.
      if ((expired || data.code === 'CSRF_DENIED')&&csrf===requestCsrf) csrf = '';
      // Only retry reads rejected before routing; never replay writes or other failures.
      if(expired&&method==='GET'&&attempt===0)continue;
      const error = new Error(data.error || `请求未完成（${response.status}）`);
      error.code = data.code;
      throw error;
    }
    if(version!==requestVersion)throw Error('知识空间已经改变，请重新读取。');
    if(!['GET','HEAD'].includes(method))revision++;
    return data;
    }
    } finally {pending--;}
  }
  return { request, session, getContext:context, setContext,
    url:path=>practiceId?`/api/practice/${encodeURIComponent(practiceId)}${path.slice(4)}`:path,
    get: (path, options) => request(path, options),
    post: (path, body = {}) => request(path, { method: 'POST', body }),
    put: (path, body) => request(path, { method: 'PUT', body }),
    remove: (path, body) => request(path, { method: 'DELETE', body }),
    upload: (file, id) => request(`/api/uploads?${new URLSearchParams({ name:file.name, uploadId:id })}`, { method:'POST', binary:file }),
  };
}
export const api = createClient();
export const endpoint = (resource, id, action = '') => `/api/${resource}/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;
export function pendingPlan(today = {}) {
  const items = (today.items || []).filter(item => item.state === 'pending');
  return { items, first: items.find(item => ['learn', 'study', 'review', 'mistake'].includes(item.kind)),
    minutes: items.reduce((total, item) => total + (Number(item.minutes) || 0), 0), budget: Number(today.budget) || 0 };
}
export function capturePayload(form) {
  const process = form.process === true;
  return { captureMode:'text', items: [{ title: form.title || '', body: form.body, platform: form.platform || '', url: form.url || '', author: form.author || '', topic: form.topic || '', date: form.date || '', locator: form.locator || '' }],
    process, research: process && form.research === true };
}
