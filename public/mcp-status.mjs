// This status describes only the local diagnostics read, never a webpage connection.
export function localCheckStatus({ enabled, checkedAt, failed = false }, now = Date.now()) {
  if (failed) return { state: 'failed', text: '本地检查失败：无法取回当前状态。请确认知序正在运行后重试；网页连接仍尚未检查。' };
  if (!Number.isFinite(checkedAt)) return { state: 'unchecked', text: '本地尚未检查。点击刷新获取状态；不会连接外部服务。' };
  const time = new Date(checkedAt).toLocaleString('zh-CN');
  if (now - checkedAt > 5 * 60 * 1000) return { state: 'expired', text: `本地检查已过期（上次 ${time}），请刷新。网页连接仍尚未检查。` };
  if (!enabled) return { state: 'disabled', text: `MCP 未开启（检查于 ${time}）。需要使用时勾选上方权限并明确保存。` };
  return { state: 'ready', text: `本地状态检查成功（${time}），接入权限已开启。仅证明本地已就绪；网页连接尚未检查，请按指南到 ChatGPT 核对。` };
}

// Only fixed, user-facing explanations leave the diagnostics log.
export function callFailureReason(error) {
  const value = typeof error === "object" ? String(error?.code || "") + " " + String(error?.message || "") : String(error || "");
  if (/401|403|unauthor|forbidden|凭据|密钥/i.test(value)) return "服务拒绝了授权。请核对对应能力的密钥与访问权限。";
  if (/429|rate.?limit|限流/i.test(value)) return "服务请求过于频繁。请稍后重试。";
  if (/budget|预算|额度/i.test(value)) return "本次请求受到预算或额度限制。请到用量与费用核对。";
  if (/timeout|timed.?out|超时/i.test(value)) return "等待服务响应超时。请稍后重试，或核对最长等待时间。";
  return "本次调用未完成。请核对对应能力的服务地址与可用状态后重试。";
}
