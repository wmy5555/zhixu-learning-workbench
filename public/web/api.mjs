// A new web client for the documented HTTP contract. Session tokens stay in memory.
export function createClient(fetcher = (...args) => fetch(...args)) {
  let csrf = '';
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
    if (!csrf) await session();
    const response = await fetcher(path, {
      method, signal, credentials: 'same-origin', cache: 'no-store',
      headers: { ...(binary ? { 'Content-Type': binary.type || 'application/octet-stream' } : body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}) },
      ...(binary ? { body: binary } : body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401 || data.code === 'CSRF_DENIED') csrf = '';
      const error = new Error(data.error || `请求未完成（${response.status}）`);
      error.code = data.code;
      throw error;
    }
    return data;
  }
  return { request, session,
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
  return { items: [{ title: form.title || '', body: form.body, platform: form.platform || '', url: form.url || '', author: form.author || '', topic: form.topic || '', date: form.date || '', locator: form.locator || '' }],
    process, research: process && form.research === true };
}
