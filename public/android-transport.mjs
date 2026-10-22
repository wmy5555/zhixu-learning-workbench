// The prototype only exposes local source operations. Unsupported actions never fall back to HTTP.
function unavailable() {
  const error = new Error('此 Android 样机尚未接入这项功能，请在电脑端使用。');
  error.code = 'ANDROID_UNAVAILABLE';
  throw error;
}

export function createAndroidTransport(plugin) {
  return {
    runtime: Object.freeze({ kind: 'android-prototype' }),
    async startSession() { return { local: true }; },
    async request(path, options = {}) {
      if (!path.startsWith('/api/') || path.includes('#')) return unavailable();
      const url = new URL(path, 'https://localhost');
      if (url.origin !== 'https://localhost') return unavailable();
      const method = options.method || 'GET';
      const payload = options.body || {};
      const route = url.pathname;
      if (method === 'GET' && route === '/api/bootstrap') {
        const { notes } = await plugin.list({});
        return { notes, stats: { notes: notes.length }, jobs: [], conflicts: [],
          settings: { ai: { enabled: false }, mcp: { enabled: false } },
          capabilities: { ai: false, search: false, fetch: false, embedding: false } };
      }
      if (method === 'GET' && (route === '/api/library' || route === '/api/notes')) {
        const { notes } = await plugin.list({ q: url.searchParams.get('q') || '' });
        const kind = url.searchParams.get('kind'), stage = url.searchParams.get('stage');
        const filtered = notes.filter(note => (!kind || note.kind === kind) && (!stage || note.meta.stage === stage));
        return route === '/api/notes' ? { notes: filtered } : { groups: filtered.map(source => ({ source, children: [], jobs: [] })), standalone: [] };
      }
      if (method === 'POST' && route === '/api/import') {
        if (payload.process || payload.research || payload.captureMode !== 'text' || !Array.isArray(payload.items) || payload.items.length !== 1) return unavailable();
        const item = payload.items[0];
        if (item.privacy !== 'local') return unavailable();
        const { title, body, platform = '', author = '', url = '', date = '', locator = '' } = item;
        const result = await plugin.save({ title, body, meta: { platform, author, url, date, locator } });
        return { notes: [result.note], jobs: [] };
      }
      const match = route.match(/^\/api\/notes\/([a-f0-9-]{36})$/);
      if (match && method === 'GET') return (await plugin.read({ id: match[1] })).note;
      if (match && method === 'PUT') return (await plugin.save({ ...payload, id: match[1] })).note;
      return unavailable();
    },
  };
}
