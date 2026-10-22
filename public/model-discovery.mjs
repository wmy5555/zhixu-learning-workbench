import { el, button, field, clear } from './ui.mjs';

// This controller holds only model IDs, never a credential-bearing cache key.
// Credentials are read just before dispatch and stay only in the request body.
export function attachModelDiscovery({ panel, address, key, model, capability, discover, connected = () => panel.isConnected, delay = 600, interval = 3000 }) {
  let version = 0, timer, controller, lastAttempt = 0, models = [], disposed = false;
  const status = el('p', { class: 'api-discovery-status', role: 'status', 'aria-live': 'polite', text: '填写地址与密钥后离开输入框，将自动访问该服务的模型目录。也可直接手填模型 ID。' });
  const query = el('input', { type: 'search', placeholder: '搜索完整模型 ID', 'aria-label': '搜索模型目录', disabled: true });
  const choices = el('select', { size: 5, disabled: true, 'aria-label': '选择模型 ID' });
  const refresh = button('刷新模型列表', { onClick: () => run() });
  function render() {
    clear(choices);
    const filtered = models.filter(id => id.toLowerCase().includes(query.value.toLowerCase()));
    for (const id of filtered) choices.append(el('option', { value: id, text: id, title: id }));
    choices.disabled = !filtered.length;
    choices.value = filtered.includes(model.value) ? model.value : '';
  }
  function invalidate() {
    version++; clearTimeout(timer); controller?.abort(); controller = null;
    models = []; query.value = ''; query.disabled = true; render();
    refresh.disabled = false;
    status.textContent = '连接输入已修改，旧目录已清除；地址/密钥离焦后自动刷新，也可手动刷新或手填模型 ID。';
  }
  function queue() {
    clearTimeout(timer);
    timer = setTimeout(() => run(), Math.max(delay, interval - (Date.now() - lastAttempt)));
  }
  async function run() {
    if (disposed || !connected() || controller || !address.value.trim()) return;
    if (Date.now() - lastAttempt < interval) { queue(); return; }
    clearTimeout(timer);
    const requestVersion = version, current = new AbortController(); controller = current; lastAttempt = Date.now();
    refresh.disabled = true; status.textContent = '正在读取所填服务的模型目录…（不会发送学习资料）';
    const timeout = setTimeout(() => current.abort(), 12000);
    try {
      const result = await discover(capability, { baseUrl: address.value, apiKey: key.value, model: model.value }, { signal: current.signal });
      if (disposed || requestVersion !== version || !connected()) return;
      models = [...new Set((Array.isArray(result.models) ? result.models : []).filter(id => typeof id === 'string' && id.length > 0 && id.length <= 512))].slice(0, 500);
      query.disabled = !models.length; render();
      status.dataset.state = typeof result.status === 'string' ? result.status : models.length ? 'ready' : 'empty';
      status.textContent = models.length ? `已读取 ${models.length} 个模型${result.truncated ? "（列表已截断，可手填未列出的 ID）" : ""}。目录可读不代表推理或嵌入可用；请选择后测试。模型 ID 始终可手填。` : (result.message || '目录为空；请手填模型 ID 后测试。');
    } catch (error) {
      if (disposed || requestVersion !== version || !connected()) return;
      const messages = { MODELS_UNSUPPORTED: '该服务不支持模型目录（404/405）。', MODELS_UNAUTHORIZED: '模型目录鉴权失败（401/403），请核对地址和密钥。', MODELS_INVALID: '该服务返回了非标准模型目录。', MODELS_RATE_LIMITED: '读取过于频繁，请稍后刷新。', CREDENTIAL_REQUIRED: '请为当前服务输入密钥。' };
      status.textContent = `${current.signal.aborted ? '读取模型目录超时或已取消。' : messages[error.code] || '模型目录读取失败，请检查地址、凭据或网络。'} 可继续手填模型 ID 并测试。`;
    } finally {
      clearTimeout(timeout);
      if (controller === current) { controller = null; refresh.disabled = false; }
    }
  }
  model.addEventListener('input', invalidate);
  model.addEventListener('change', invalidate);
  query.addEventListener('input', render);
  choices.addEventListener('change', () => { if (choices.value) { model.value = choices.value; model.dispatchEvent(new Event('input', { bubbles: true })); } });
  for (const input of [address, key]) { input.addEventListener('input', invalidate); input.addEventListener('change', invalidate); input.addEventListener('blur', queue); }
  panel.append(el('div', { class: 'api-model-discovery' }, [status, refresh, field('筛选目录', query), field('可选模型（完整 ID）', choices), el('p', { class: 'fine-print', text: '目录不会按模型名称猜测能力或隐藏结果。选择不更改启用开关，不会自动保存。' })]));
  return { invalidate, dispose() { disposed = true; clearTimeout(timer); controller?.abort(); models = []; }, run };
}
