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

export function confirmAction({ title, message, confirmText = "确认", danger = false }) {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "dialog-backdrop" });
    const dialog = el("div", { class: "dialog", role: "dialog", ariaModal: "true" }, [
      el("h2", { text: title }),
      el("p", { text: message }),
    ]);
    const finish = (value) => { overlay.remove(); resolve(value); };
    dialog.append(el("div", { class: "dialog-actions" }, [
      button("取消", { onClick: () => finish(false) }),
      button(confirmText, { kind: danger ? "danger" : "primary", onClick: () => finish(true) }),
    ]));
    overlay.append(dialog);
    document.body.append(overlay);
    dialog.querySelector("button")?.focus();
  });
}

export function promptAction({ title, message = "", label = "说明", initialValue = "", placeholder = "", submitText = "提交", danger = false, required = false }) {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "dialog-backdrop" });
    const textarea = el("textarea", { rows: 5, value: initialValue, placeholder, required, ariaLabel: label });
    const form = el("form", { class: "dialog", role: "dialog", ariaModal: "true" }, [
      el("h2", { text: title }),
      message ? el("p", { text: message }) : null,
      el("label", { class: "field" }, [el("span", { class: "field-label", text: label }), textarea]),
    ]);
    const finish = (value) => { overlay.remove(); resolve(value); };
    form.append(el("div", { class: "dialog-actions" }, [
      button("取消", { onClick: () => finish(null) }),
      button(submitText, { kind: danger ? "danger" : "primary", type: "submit" }),
    ]));
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
