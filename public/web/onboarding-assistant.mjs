export function bindGuideAssistant({ dialog, api, practiceId, propose }) {
  const form = dialog.querySelector('#guide-question');
  const input = form.querySelector('[name="question"]');
  const consent = form.querySelector('[name="allowCloud"]');
  const send = form.querySelector('[type="submit"]');
  const reply = dialog.querySelector('[data-guide-reply]');
  const status = dialog.querySelector('[data-guide-ai-status]');
  let pending = false, dismissed = false;
  let history = [];
  const update = () => { send.disabled = pending || !consent.checked; input.readOnly = pending; consent.disabled = pending; form.setAttribute('aria-busy', String(pending)); };
  consent.addEventListener('change', update);
  dialog.addEventListener('close', () => { dismissed = true; }, { once: true });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (event.isComposing || pending || !consent.checked || !input.value.trim()) return;
    const question = input.value.trim();
    const message = dialog.querySelector('.guide-user-message');
    message.hidden = false; message.textContent = question;
    dialog.querySelector('#guide-suggestions').replaceChildren();
    pending = true; update();
    status.textContent = '正在生成学习建议…';
    reply.textContent = '我会结合你当前的引导步骤，帮你找到下一件可以做的小事。';
    try {
      const result = await api.post('/api/onboarding/assist', { question, history, allowCloud: true, practiceId });
      if (dismissed) return;
      reply.textContent = result.answer;
      status.textContent = `AI 学习建议 · ${result.model || '已配置模型'} · 请结合实际核对`;
      history = [...history, {role:'user',content:question}, {role:'assistant',content:result.answer}].slice(-6);
      if (result.goal) propose(dialog, result.goal, { keepAnswer: true });
    } catch (error) {
      if (!dismissed) {
        status.textContent = '这次 AI 回答未完成';
        const reason = error.code === 'CALL_RECOVERY_REQUIRED' ? '之前有一次 AI 请求没有收到完整回复，暂时无法确认费用。新的 AI 请求已暂停，可到“系统 → 用量与费用”查看。' : error.message || '暂时无法生成回答。';
        reply.textContent = `${reason}\n问题已保留；不会自动重试。也可以选择下方的本地路线。`;
      }
    } finally { pending = false; if (!dismissed) update(); }
  });
  update();
}
