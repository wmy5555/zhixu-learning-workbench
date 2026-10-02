export class ApiError extends Error {
  constructor(message, { status = 0, code = "REQUEST_FAILED", detail = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

let csrfToken = "";
const CONTEXT_KEY = "zhixu.practiceContext.v1";
let practiceId = "";
let contextVersion = 0;
let inFlight = 0;
try { practiceId = sessionStorage.getItem(CONTEXT_KEY) || ""; } catch { /* Storage may be unavailable. */ }

export function getApiContext() { return { practiceId, version: contextVersion, pending: inFlight }; }

export function setApiContext(id = "") {
  const next = String(id || "");
  if (next === practiceId) return getApiContext();
  if (inFlight) throw new ApiError("请等当前操作完成后再切换知识库。", { code: "CONTEXT_BUSY" });
  practiceId = next;
  contextVersion++;
  try { if (next) sessionStorage.setItem(CONTEXT_KEY, next); else sessionStorage.removeItem(CONTEXT_KEY); } catch { /* Context remains explicit for this page. */ }
  return getApiContext();
}

function notifyRequest(detail) {
  if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") window.dispatchEvent(new CustomEvent("zhixu:request", { detail }));
}

function toQuery(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== "" && value !== null && value !== undefined) query.set(key, String(value));
  });
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

async function parseResponse(response) {
  const type = response.headers.get("content-type") || "";
  if (type.includes("application/json")) return response.json();
  const text = await response.text();
  return text ? { message: text } : {};
}

export async function startSession() {
  const response = await fetch("/api/session", { credentials: "same-origin" });
  const data = await parseResponse(response);
  if (!response.ok || !data.csrf) {
    throw new ApiError(data.error || "无法建立本地会话", {
      status: response.status,
      code: data.code || "SESSION_FAILED",
      detail: data,
    });
  }
  csrfToken = data.csrf;
  return data;
}

export async function request(path, options = {}) {
  const version = contextVersion;
  const id = options.scope === "main" ? "" : practiceId;
  const target = id && path.startsWith("/api/") && !path.startsWith("/api/onboarding/")
    ? `/api/practice/${encodeURIComponent(id)}${path.slice(4)}` : path;
  inFlight++;
  try {
    const result = await performRequest(target, options);
    if (options.scope !== "main" && version !== contextVersion) throw new ApiError("知识库已切换，已忽略旧页面的返回结果。", { code: "STALE_CONTEXT" });
    notifyRequest({ path, method: options.method || "GET", practiceId: id, ok: true });
    return result;
  } finally { inFlight--; }
}

async function performRequest(path, options = {}) {
  const method = options.method || "GET";
  const headers = new Headers(options.headers || {});
  const init = { method, headers, credentials: "same-origin" };
  if (!["GET", "HEAD"].includes(method)) {
    if (!csrfToken) await startSession();
    headers.set("X-CSRF-Token", csrfToken);
    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
      init.body = JSON.stringify(options.body);
    }
  }
  let response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    throw new ApiError("无法连接本地服务，请确认应用仍在运行", { code: "OFFLINE", detail: error });
  }
  if (options.blob) {
    if (!response.ok) {
      const data = await parseResponse(response);
      throw new ApiError(data.error || "下载失败", { status: response.status, code: data.code, detail: data });
    }
    return response.blob();
  }
  const data = await parseResponse(response);
  if (!response.ok) {
    throw new ApiError(data.error || `请求失败（${response.status}）`, {
      status: response.status,
      code: data.code || "REQUEST_FAILED",
      detail: data,
    });
  }
  return data;
}

export const api = {
  getContext: getApiContext,
  setContext: setApiContext,
  onboarding: (action = "state", body = {}) => request(`/api/onboarding/${action}${action === "state" ? toQuery(body) : ""}`, action === "state" ? { scope: "main" } : { method: "POST", body, scope: "main" }),
  mainSettings: () => request("/api/settings", { scope: "main" }),
  updateMainSettings: (body) => request("/api/settings", { method: "PUT", body, scope: "main" }),
  bootstrap: () => request("/api/bootstrap"),
  library: (filters) => request(`/api/library${toQuery(filters)}`),
  notes: (filters) => request(`/api/notes${toQuery(filters)}`),
  note: (id) => request(`/api/notes/${encodeURIComponent(id)}`),
  evidence: (id) => request(`/api/notes/${encodeURIComponent(id)}/evidence`),
  linksPreview: (id) => request(`/api/notes/${encodeURIComponent(id)}/links-preview`),
  syncLinks: (id, body) => request(`/api/notes/${encodeURIComponent(id)}/links-sync`, { method: "POST", body }),
  relate: (id, body = { useAI: false }) => request(`/api/notes/${encodeURIComponent(id)}/relate`, { method: "POST", body }),
  recommendations: () => request("/api/recommendations"),
  recommendationAction: (id, body) => request(`/api/recommendations/${encodeURIComponent(id)}/action`, { method: "POST", body }),
  import: (body) => request("/api/import", { method: "POST", body }),
  updateNote: (id, body) => request(`/api/notes/${encodeURIComponent(id)}`, { method: "PUT", body }),
  deleteNote: (id, expectedHash) => request(`/api/notes/${encodeURIComponent(id)}`, { method: "DELETE", body: { expectedHash } }),
  processNote: (id, options = {}) => request(`/api/notes/${encodeURIComponent(id)}/process`, { method: "POST", body: options }),
  extractSource: (id, body) => request(`/api/notes/${encodeURIComponent(id)}/extract`, { method: "POST", body }),
  promote: (id, body) => request(`/api/notes/${encodeURIComponent(id)}/promote`, { method: "POST", body }),
  confirmNote: (id, body) => request(`/api/notes/${encodeURIComponent(id)}/confirm`, { method: "POST", body }),
  merge: (body) => request("/api/notes/merge", { method: "POST", body }),
  search: (filters) => request(`/api/search${toQuery(filters)}`),
  ask: (body) => request("/api/ask", { method: "POST", body }),
  drafts: () => request("/api/drafts"),
  updateDraft: (id, body) => request(`/api/drafts/${encodeURIComponent(id)}`, { method: "PUT", body }),
  captureDraft: (id, body) => request(`/api/drafts/${encodeURIComponent(id)}/capture`, { method: "POST", body }),
  today: () => request("/api/today"),
  generateToday: () => request("/api/today/generate", { method: "POST", body: {} }),
  todayAction: (id, body) => request(`/api/today/${encodeURIComponent(id)}/action`, { method: "POST", body }),
  studySessions: () => request("/api/study"),
  startStudy: (body) => request("/api/study/start", { method: "POST", body }),
  study: (id) => request(`/api/study/${encodeURIComponent(id)}`),
  answer: (id, body) => request(`/api/study/${encodeURIComponent(id)}/answer`, { method: "POST", body }),
  hint: (id) => request(`/api/study/${encodeURIComponent(id)}/hint`, { method: "POST", body: {} }),
  confirmStudy: (id, body) => request(`/api/study/${encodeURIComponent(id)}/confirm`, { method: "POST", body }),
  finishStudy: (id) => request(`/api/study/${encodeURIComponent(id)}/finish`, { method: "POST", body: {} }),
  mistakes: () => request("/api/mistakes"),
  mistakeAction: (id, body) => request(`/api/mistakes/${encodeURIComponent(id)}/action`, { method: "POST", body }),
  topics: () => request("/api/topics"),
  createTopic: (body) => request("/api/topics", { method: "POST", body }),
  suggestTopics: () => request("/api/topics/suggest", { method: "POST", body: {} }),
  updateTopic: (id, body) => request(`/api/topics/${encodeURIComponent(id)}`, { method: "PUT", body }),
  topicAction: (id, body) => request(`/api/topics/${encodeURIComponent(id)}/action`, { method: "POST", body }),
  relations: () => request("/api/relations"),
  relationAction: (id, body) => request(`/api/relations/${encodeURIComponent(id)}/action`, { method: "POST", body }),
  discover: (body = {}) => request("/api/discover", { method: "POST", body }),
  jobs: () => request("/api/jobs"),
  jobAction: (id, body) => request(`/api/jobs/${encodeURIComponent(id)}/action`, { method: "POST", body }),
  settings: () => request("/api/settings"),
  updateSettings: (body) => request("/api/settings", { method: "PUT", body }),
  prompts: () => request("/api/prompts"),
  updatePrompts: (body) => request("/api/prompts", { method: "PUT", body }),
  testSetting: (capability) => request("/api/settings/test", { method: "POST", body: { capability } }),
  diagnostics: () => request("/api/diagnostics"),
  usage: (filters = {}) => request(`/api/usage?${new URLSearchParams(filters)}`),
  updateUsageSettings: (body) => request("/api/usage/settings", { method: "PUT", body }),
  rebuildIndex: () => request("/api/index/rebuild", { method: "POST", body: {} }),
  updateIndex: () => request("/api/index/update", { method: "POST", body: {} }),
  backup: () => request("/api/backup", { blob: true }),
  restore: (body) => request("/api/restore", { method: "POST", body }),
  history: (id) => request(`/api/history/${encodeURIComponent(id)}`),
  restoreVersion: (id, body) => request(`/api/history/${encodeURIComponent(id)}/restore`, { method: "POST", body }),
  proposals: () => request("/api/proposals"),
  proposalAction: (id, body) => request(`/api/proposals/${encodeURIComponent(id)}/action`, { method: "POST", body }),
  demo: () => request("/api/demo", { method: "POST", body: {} }),
};
