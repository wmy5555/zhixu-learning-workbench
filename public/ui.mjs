export function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(options).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = String(value);
    else if (key === "dataset") Object.entries(value).forEach(([k, v]) => { node.dataset[k] = String(v); });
    else if (key === "on") Object.entries(value).forEach(([event, handler]) => node.addEventListener(event, handler));
    else if (key in node && !key.startsWith("aria")) node[key] = value;
    else node.setAttribute(key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`), String(value));
  });
  const items = Array.isArray(children) ? children : [children];
  items.flat().forEach((child) => {
    if (child === null || child === undefined || child === false) return;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

export function button(label, { kind = "quiet", onClick, disabled = false, type = "button", title = "" } = {}) {
  const [variant, ...modifiers] = kind.trim().split(/\s+/);
  return el("button", { class: [`${variant}-button`, ...modifiers].join(" "), text: label, type, disabled, title, on: onClick ? { click: onClick } : {} });
}

export function badge(label, tone = "neutral") {
  return el("span", { class: `badge badge-${tone}`, text: label });
}

export function emptyState(title, description, action) {
  return el("div", { class: "empty-state" }, [
    el("div", { class: "empty-symbol", text: "○" }),
    el("h3", { text: title }),
    el("p", { text: description }),
    action || null,
  ]);
}

export function formatDate(value, withTime = false) {
  if (!value) return "未记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "short", day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

export function truncate(value, length = 150) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

export function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

const STAGES = {
  reference: "仅供查阅", candidate: "待选学", learning: "正在学习",
  integrated: "已整理个人理解", core: "重点知识", retired: "不再使用",
};
const KINDS = { source: "原始资料", knowledge: "知识", mistake: "错题", topic: "主题学习包", report: "AI 整理建议" };
const STATES = {
  queued: "排队中", running: "处理中", waiting: "等待条件", failed: "失败",
  done: "已完成", cancelled: "已取消", pending: "待确认", accepted: "已接受", rejected: "已拒绝",
  due: "待完成", completed: "已完成", skipped: "已跳过", deferred: "已延期", paused: "已暂停",
  suggested: "待确认", open: "待纠正", resolved: "已纠正", disputed: "有争议", revoked: "已撤销",
};

export const labels = {
  stage: (value) => STAGES[value] || value || "未分层",
  kind: (value) => KINDS[value] || value || "资料",
  state: (value) => STATES[value] || value || "未知",
};

export function stateTone(value) {
  if (["done", "accepted", "completed", "integrated", "core", "resolved"].includes(value)) return "good";
  if (["failed", "rejected", "disputed"].includes(value)) return "danger";
  if (["running", "learning", "queued"].includes(value)) return "accent";
  if (["waiting", "candidate", "pending", "deferred"].includes(value)) return "warn";
  return "neutral";
}

// Explain stored failures at read time so older task records benefit as well.
export function describeJobError(job = {}) {
  const code = String(job.code || '').toUpperCase(), raw = String(job.error || '');
  const evidence = `${code} ${raw}`;
  const service = job.type === 'structure' ? 'AI 服务' : '外部服务';
  const result = (title, reason, next) => ({ title, reason, next });
  if (code === 'CANCELLED' || job.state === 'cancelled') return result('任务已取消', '本次任务已停止。', '需要继续时可手动重试；涉及外部服务的重试可能产生费用。');
  if (['PRIVACY_LOCAL'].includes(code)) return result('资料尚未允许外发', '任务已暂停，资料的外发设置不允许这次分析。', '如需使用 AI，请先核对原文及条目的外发设置，再决定是否重试。');
  if (/今日外部(?:调用|请求)次数已达到上限|daily.*limit.*exceeded/i.test(raw)) return result('今日外部请求次数已用完', '任务已保存，当前不能继续调用外部服务。', '等待每日额度恢复后，再点击“重试”。');
  if (['BUDGET_EXCEEDED', 'SOURCE_BUDGET', 'BUDGET_UNKNOWN'].includes(code)) return result('调用预算暂不允许继续', code === 'BUDGET_UNKNOWN' ? '费用尚无法确定，预算保护已暂停调用。' : '已达到任务或本月的调用预算。', '到“系统 → 用量与费用”核对预算、单价和用量，再决定是否重试。');
  if (['DISABLED', 'AI_DISABLED', 'CAPABILITY_DISABLED', 'NOT_CONFIGURED', 'MISSING_KEY', 'MISSING_CREDENTIALS', 'INVALID_CONFIG'].includes(code)) return result('所需能力尚未准备好', '外部能力未启用，或地址、模型、凭据配置不完整。', '到“系统 → 能力设置”检查相关能力，并完成连接测试后重试。');
  if (code === 'SOURCE_CHANGED') return result('资料内容已经变化', '本次分析依据的版本已过期，结构建议未更新。', '确认当前原文和条目后重试，系统将分析当前版本。');
  if (/\b(?:ETIMEDOUT|ESOCKETTIMEDOUT|REQUEST_TIMEOUT|UND_ERR_\w*TIMEOUT|TimeoutError)\b|连接.*超时|请求超时/i.test(evidence)) return result(job.type === 'structure' ? '连接 AI 服务超时' : '连接外部服务超时', '服务未在等待时间内回应，本次任务未完成。', '先检查网络或代理是否可用，再到“系统 → 能力设置”测试连接。连接恢复后点击“重试”，重试可能产生调用费用。');
  if (/\b(?:ENOTFOUND|EAI_AGAIN|DNS_FAILED)\b/i.test(evidence)) return result('无法找到外部服务地址', '服务地址未能解析，可能与地址填写或网络有关。', '核对能力设置中的服务地址，并检查网络，连接测试成功后重试。');
  if (/\b(?:ECONNRESET|ECONNREFUSED|EPIPE|ENETUNREACH|EHOSTUNREACH|NETWORK_ERROR)\b|fetch failed/i.test(evidence)) return result(`${service}连接中断或无法建立`, '未能通过网络完成这次请求。', '检查网络、代理和服务是否可用，完成连接测试后再重试。');
  if (/\b(?:CERT_HAS_EXPIRED|UNABLE_TO_VERIFY_LEAF_SIGNATURE|DEPTH_ZERO_SELF_SIGNED_CERT|ERR_TLS_CERT_ALTNAME_INVALID)\b/i.test(evidence)) return result('服务的安全证书无法验证', '连接未通过安全检查。', '核对服务地址、系统时间或联系服务商修复证书，再进行连接测试。');
  if (['INVALID_URL', 'SSRF_BLOCKED', 'UNSAFE_REDIRECT'].includes(code)) return result('服务地址未通过安全检查', '当前地址或跳转不满足外部访问要求。', '检查相关能力的服务地址，使用可信的公网 HTTPS 地址。');
  if (/(?:\bHTTP(?: status)?|状态码|外部服务返回)[^\d]{0,15}(?:401|403)\b|^\s*(?:401|403)\b|unauthorized|invalid[\s_]api[\s_]key/i.test(raw)) return result('外部服务拒绝了访问', '凭据可能无效、已过期，或没有相应模型的访问权限。', '到能力设置核对凭据、模型及账户权限，连接测试成功后重试。');
  if (/(?:\bHTTP(?: status)?|状态码|外部服务返回)[^\d]{0,15}429\b|^\s*429\b|rate.limit|too many requests/i.test(raw)) return result('外部服务暂时限制了请求', '服务方可能正在限流，或账户额度不足。', '稍后重试；若仍失败，请检查服务方的账户额度与请求限制。');
  if (['MODEL_FORMAT', 'INVALID_RESPONSE', 'MODEL_TRUNCATED', 'MODEL_REFUSAL', 'RESPONSE_TOO_LARGE'].includes(code)) return result('AI 返回的结果暂时无法使用', code === 'MODEL_TRUNCATED' ? '结果达到长度限制，尚未完整返回。' : '结果缺少所需内容、格式不正确，或模型拒绝了本次请求。', '检查材料长度、模型和自定义提示词，再决定是否重试。此次请求可能已计费。');
  if (code === 'RESEARCH_INCOMPLETE') return result('拆解已保存，部分事实仍待核验', '联网核验尚未满足完成条件。', '可以先阅读已保存的拆解，再检查搜索、网页读取与预算设置，按需重试。');
  return result('任务暂未完成', '暂时无法确定具体原因，系统保留了原始错误信息。', '展开“技术信息”查看错误代码，供排查使用；确认原因后再决定是否重试。');
}

export function field(labelText, control, hint = "") {
  return el("label", { class: "field" }, [
    el("span", { class: "field-label", text: labelText }), control,
    hint ? el("small", { class: "field-hint", text: hint }) : null,
  ]);
}

export function toast(message, tone = "default", timeout = 4200) {
  const region = document.querySelector("#toast-region");
  const item = el("div", { class: `toast toast-${tone}` }, [
    el("span", { text: message }),
    button("×", { kind: "icon", onClick: () => item.remove() }),
  ]);
  region.append(item);
  window.setTimeout(() => item.remove(), timeout);
}

function containDialogKeyboard(dialog, cancel) {
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); return; }
    if (event.key !== "Tab") return;
    const controls = [...dialog.querySelectorAll("button, [href], input, select, textarea, [tabindex]")].filter(node => !node.disabled && node.getAttribute("tabindex") !== "-1" && node.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
}

export function confirmAction({ title, message, confirmText = "确认", danger = false }) {
  return new Promise((resolve) => {
    const returnFocus = document.activeElement;
    const overlay = el("div", { class: "dialog-backdrop" });
    const dialog = el("div", { class: "dialog", role: "dialog", ariaModal: "true", ariaLabel: title }, [
      el("h2", { text: title }),
      el("p", { text: message }),
    ]);
    const finish = (value) => { overlay.remove(); if (returnFocus?.isConnected) returnFocus.focus(); resolve(value); };
    dialog.append(el("div", { class: "dialog-actions" }, [
      button("取消", { onClick: () => finish(false) }),
      button(confirmText, { kind: danger ? "danger" : "primary", onClick: () => finish(true) }),
    ]));
    containDialogKeyboard(dialog, () => finish(false));
    overlay.append(dialog);
    document.body.append(overlay);
    dialog.querySelector("button")?.focus();
  });
}

export function promptAction({ title, message = "", label = "说明", initialValue = "", placeholder = "", submitText = "提交", danger = false, required = false }) {
  return new Promise((resolve) => {
    const returnFocus = document.activeElement;
    const overlay = el("div", { class: "dialog-backdrop" });
    const textarea = el("textarea", { rows: 5, value: initialValue, placeholder, required, ariaLabel: label });
    const form = el("form", { class: "dialog", role: "dialog", ariaModal: "true" }, [
      el("h2", { text: title }),
      message ? el("p", { text: message }) : null,
      el("label", { class: "field" }, [el("span", { class: "field-label", text: label }), textarea]),
    ]);
    const finish = (value) => { overlay.remove(); if (returnFocus?.isConnected) returnFocus.focus(); resolve(value); };
    form.append(el("div", { class: "dialog-actions" }, [
      button("取消", { onClick: () => finish(null) }),
      button(submitText, { kind: danger ? "danger" : "primary", type: "submit" }),
    ]));
    containDialogKeyboard(form, () => finish(null));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = textarea.value.trim();
      if (required && !value) { textarea.focus(); return; }
      finish(value);
    });
    overlay.addEventListener("click", (event) => { if (event.target === overlay) finish(null); });
    overlay.append(form);
    document.body.append(overlay);
    textarea.focus();
  });
}

export function serializeForm(form) {
  return Object.fromEntries(new FormData(form).entries());
}
