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
  bootstrap: () => request("/api/bootstrap"),
  library: (filters) => request(`/api/library${toQuery(filters)}`),
  notes: (filters) => request(`/api/notes${toQuery(filters)}`),
  note: (id) => request(`/api/notes/${encodeURIComponent(id)}`),
  import: (body) => request("/api/import", { method: "POST", body }),
  updateNote: (id, body) => request(`/api/notes/${encodeURIComponent(id)}`, { method: "PUT", body }),
  deleteNote: (id, expectedHash) => request(`/api/notes/${encodeURIComponent(id)}`, { method: "DELETE", body: { expectedHash } }),
  processNote: (id) => request(`/api/notes/${encodeURIComponent(id)}/process`, { method: "POST", body: {} }),
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
  mistakes: () => request("/api/mistakes"),
  mistakeAction: (id, body) => request(`/api/mistakes/${encodeURIComponent(id)}/action`, { method: "POST", body }),
  topics: () => request("/api/topics"),
  createTopic: (body) => request("/api/topics", { method: "POST", body }),
  suggestTopics: () => request("/api/topics/suggest", { method: "POST", body: {} }),
  updateTopic: (id, body) => request(`/api/topics/${encodeURIComponent(id)}`, { method: "PUT", body }),
  topicAction: (id, body) => request(`/api/topics/${encodeURIComponent(id)}/action`, { method: "POST", body }),
  relations: () => request("/api/relations"),
  relationAction: (id, body) => request(`/api/relations/${encodeURIComponent(id)}/action`, { method: "POST", body }),
  discover: () => request("/api/discover", { method: "POST", body: {} }),
  jobs: () => request("/api/jobs"),
  jobAction: (id, body) => request(`/api/jobs/${encodeURIComponent(id)}/action`, { method: "POST", body }),
  settings: () => request("/api/settings"),
  updateSettings: (body) => request("/api/settings", { method: "PUT", body }),
  prompts: () => request("/api/prompts"),
  updatePrompts: (body) => request("/api/prompts", { method: "PUT", body }),
  testSetting: (capability) => request("/api/settings/test", { method: "POST", body: { capability } }),
  diagnostics: () => request("/api/diagnostics"),
  rebuildIndex: () => request("/api/index/rebuild", { method: "POST", body: {} }),
  backup: () => request("/api/backup", { blob: true }),
  restore: (body) => request("/api/restore", { method: "POST", body }),
  history: (id) => request(`/api/history/${encodeURIComponent(id)}`),
  restoreVersion: (id, body) => request(`/api/history/${encodeURIComponent(id)}/restore`, { method: "POST", body }),
  proposals: () => request("/api/proposals"),
  proposalAction: (id, body) => request(`/api/proposals/${encodeURIComponent(id)}/action`, { method: "POST", body }),
  demo: () => request("/api/demo", { method: "POST", body: {} }),
};
