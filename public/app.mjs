import { renderRecycleBin } from './recycle-bin.mjs';
import { attachModelDiscovery } from "./model-discovery.mjs";
import { testAndSaveCapability } from "./capability-test.mjs";
import { api, ApiError, startSession } from "./api.mjs";
import { parseSourceFile } from "./source-exchange.mjs";
import { renderMarkdown } from "./markdown-reader.mjs";
import { createMarkdownEditor } from "./markdown-editor.mjs";
import { createFileImportPanel, attachmentPanel, canProcessFile, sourceFileNotice, imageInsertControls } from "./source-files.mjs";
import { attachmentUrl } from "./api.mjs";
import { createProcessFeedback } from "./process-feedback.mjs";
import { createSourceMap } from "./source-map.mjs";
import { initSidebar } from "./sidebar.mjs";
import {
  el, clear, button, badge, emptyState, formatDate, formatCalendarDate, truncate, safeExternalUrl,
  labels, stateTone, field, toast, confirmAction, promptAction, serializeForm, describeJobError,
} from "./ui.mjs";

const refs = {
  main: document.querySelector("#main"),
  nav: document.querySelector("#nav-list"),
  sidebar: document.querySelector("#sidebar"),
  menu: document.querySelector("#menu-button"),
  title: document.querySelector("#page-title"),
  eyebrow: document.querySelector("#page-eyebrow"),
  refresh: document.querySelector("#global-refresh"),
  quickCapture: document.querySelector("#quick-capture"),
  drawer: document.querySelector("#drawer"),
  drawerBackdrop: document.querySelector("#drawer-backdrop"),
  drawerBody: document.querySelector("#drawer-body"),
  drawerTitle: document.querySelector("#drawer-title"),
  drawerEyebrow: document.querySelector("#drawer-eyebrow"),
  drawerClose: document.querySelector("#drawer-close"),
};

const sidebarNavigation = initSidebar({
  document,
  media: window.matchMedia('(max-width: 780px)'),
  storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) },
});

const pages = {
  today: ["今日工作台", "把注意力留给值得学习的内容"],
  capture: ["收集与加工", "先保存原文，再决定如何使用"],
  library: ["知识库", "查看每条内容的来源、学习状态与变更"],
  study: ["学习与错题", "用自己的语言解释，再逐步修正"],
  topics: ["主题学习包", "围绕问题组织材料与学习顺序"],
  discover: ["检索与发现", "找到材料，也看见有依据的联系"],
  output: ["问答与输出", "从已有资料出发，形成可追溯的答案"],
  trash: ["回收站", "恢复原始资料或永久清空当前资料库的回收站"],
  system: ["系统", "配置能力并检查真实运行状态"],
};

const state = {
  view: "today",
  bootstrap: null,
  libraryFilters: { q: "", kind: "", stage: "" },
  searchFilters: { q: "", mode: "keyword", kind: "", stage: "", topic: "", source: "", from: "", to: "", privacy: "local" },
  currentStudy: null,
  studyMaterialVisible: true,
  systemTab: "settings",
  studyTab: "queue",
  lastOutput: null,
  lastCapture: null,
  restoreBackup: null,
  restoreToken: "",
  sourceMaps: new Map(),
  libraryFoldState: new Map(),
};

let libraryRenderSequence = 0;
let searchRenderSequence = 0;
let libraryRegionSequence = 0;

function libraryFoldControl(key, title, content) {
  const context = api.getContext();
  const scopedKey = `${context.practiceId || 'formal'}:${key}`;
  let collapsed = state.libraryFoldState.get(scopedKey) === true;
  content.id = `library-region-${++libraryRegionSequence}`;
  const control = button('', { kind: 'quiet compact', onClick: () => {
    const latest = api.getContext();
    if (latest.version !== context.version || latest.practiceId !== context.practiceId) return;
    const form = refs.drawer.classList.contains('is-open') ? refs.drawerBody.querySelector('form') : null;
    if (!collapsed && (form?.hasUnsavedChanges?.() || unsavedInputForm()?.hasUnsavedChanges?.())) {
      toast('请先保存当前编辑，再折叠内容。', 'info');
      return;
    }
    collapsed = !collapsed;
    state.libraryFoldState.set(scopedKey, collapsed);
    sync();
  } });
  control.classList.add('library-fold-toggle');
  control.setAttribute('aria-controls', content.id);
  function sync() {
    content.hidden = collapsed;
    control.textContent = `${collapsed ? '展开' : '折叠'}${title}`;
    control.setAttribute('aria-expanded', String(!collapsed));
  }
  sync();
  return control;
}

function librarySection(key, title, copy, content, count, unit) {
  const body = el('div', { class: 'library-section-body' }, content);
  const control = libraryFoldControl(key, title, body);
  return el('section', { class: 'library-content-section', dataset: { librarySection: key } }, [
    sectionHeading(title, copy, el('div', { class: 'section-actions' }, [badge(`${count} ${unit}`), control])), body,
  ]);
}

function sourceBodyPreview(value, length = 420) {
  const text = String(value || '');
  return text.length > length ? `${text.slice(0, length)}\n…` : text;
}

function conversationReading(note) {
  if (note?.meta?.chatgptCapture || note?.meta?.chatgptSync) return true;
  const body = String(note?.body || '');
  return note?.kind === 'source'
    && /^## 会话原文（按收到的顺序保留）\s*$/m.test(body)
    && /^### \d+\. (?:用户|ChatGPT)\s*$/m.test(body);
}
function sourceReadingBody(value, className = '', emptyText = '暂无原文', note = null) {
  const images = [note?.meta?.sourceFile, ...(note?.meta?.attachments || [])].filter(file => file?.kind === 'image');
  return renderMarkdown(value, { className: `prose ${className}`.trim(), emptyText,
    conversation: conversationReading(note), imageResolver: target => {
    const file = images.find(item => target === '../.zhixu-attachments/' + item.id);
    return file ? attachmentUrl(note.id, file.id) : '';
  } });
}

function historyReadingBody(note, version) {
  if (note.kind !== 'source') return el('pre', { class: 'mono-block', text: version.raw || version.body || '此版本没有可显示的正文快照' });
  const raw = String(version.raw || '');
  const frontmatter = raw.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  const body = version.body ?? (frontmatter ? raw.slice(frontmatter[0].length) : raw);
  return el('div', { class: 'history-reading-body' }, [
    renderMarkdown(body, { className: 'prose', emptyText: '此版本没有可显示的正文快照', conversation: conversationReading(note) }),
    frontmatter ? el('details', {}, [el('summary', { text: '查看版本属性' }), el('pre', { class: 'mono-block history-metadata', text: frontmatter[0] })]) : null,
  ]);
}
let onboarding = null;
function isMobilePrototype() { return api.runtime?.kind === "android-prototype"; }
function mobileNotice() { return el("div", { class: "notice info", text: "Android 共用界面样机：可在手机保存、搜索、查看和编辑原文。资料仅存本机；学习、AI、同步和备份尚未接入，请只使用可丢弃的试用资料。" }); }
const processFeedback = createProcessFeedback({
  getContext: () => api.getContext(), readJobs: () => api.jobStatuses(), notify: toast,
  onChange: changed => {
    refs.drawerBody.querySelectorAll(".process-controls").forEach(updateProcessControls);
    refs.drawerBody.querySelectorAll("[data-structure-submit]").forEach(updateStructureButton);
    refs.drawerBody.querySelectorAll('.structure-job-status').forEach(updateStructureStatus);
    if (changed.length) onboarding?.refresh();
    const sourceId = refs.drawerBody.querySelector(".source-group-drawer")?.dataset.sourceId;
    if (sourceId && changed.some(job => job.noteId === sourceId && (job.extractionSaved || ["done", "waiting", "failed", "cancelled"].includes(job.state)))) refreshCompletedSource(sourceId).catch(handleError);
  },
});
function tour(node, id) { node.dataset.tour = id; return node; }
function recordTourEvent(event) {
  const practiceId = api.getContext?.().practiceId;
  if (practiceId) api.onboarding("event", { practiceId, event }).catch(handleError);
}

function asArray(value) { return Array.isArray(value) ? value : []; }
function asObject(value) { return value && typeof value === "object" ? value : {}; }
function number(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }

function setPage(view) {
  state.view = pages[view] ? view : "today";
  const [eyebrow, title] = pages[state.view];
  refs.eyebrow.textContent = eyebrow;
  refs.title.textContent = title;
  refs.nav.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("is-active", item.dataset.view === state.view));
  sidebarNavigation.closeMobile();
  window.history.replaceState(null, "", state.view === "system" ? `#system/${state.systemTab}` : `#${state.view}`);
}

function showLoading(message = "正在读取…") {
  clear(refs.main).append(el("div", { class: "loading-panel" }, [el("span", { class: "spinner" }), el("p", { text: message })]));
}

function errorMessage(error) {
  if (error instanceof ApiError) {
    if (error.code === "CONFLICT") return "内容已在其他位置修改。请刷新查看冲突，当前更改没有覆盖新版本。";
    return error.message;
  }
  return error?.message || "出现未知错误";
}

function renderFailure(error, retry) {
  const actions = el("div", { class: "form-actions" }, [button("重试", { kind: "primary", onClick: retry })]);
  if (api.getContext?.().practiceId) actions.append(button("明确返回正式知识库", { onClick: async () => {
    try { api.setContext(""); onboarding?.dispose(); onboarding = null; state.currentStudy = null; state.lastOutput = null; state.lastCapture = null; state.bootstrap = null; await init(); }
    catch (nextError) { handleError(nextError); }
  } }));
  clear(refs.main).append(emptyState("暂时无法读取", errorMessage(error), actions));
}

function handleError(error) { toast(errorMessage(error), "error", 6500); }

function sectionHeading(title, description = "", action = null) {
  return el("div", { class: "section-heading" }, [
    el("div", {}, [el("h2", { text: title }), description ? el("p", { text: description }) : null]),
    action,
  ]);
}

function selectControl(options, value = "", name = "") {
  const select = el("select", { name });
  options.forEach(([optionValue, label]) => select.append(el("option", { value: optionValue, text: label, selected: optionValue === value })));
  return select;
}

function noteMeta(note) {
  const meta = asObject(note.meta);
  return el("div", { class: "item-meta" }, [
    badge(labels.kind(note.kind)),
    badge(labels.stage(meta.stage), stateTone(meta.stage)),
    state.bootstrap?.settings?.mcp?.chatgptEnabled && state.bootstrap?.settings?.mcp?.chatgptAllowRead ? badge("另已授权 ChatGPT 读取", "warn") : null,
    meta.topic ? badge(meta.topic, "accent") : null,
  ]);
}

function openDrawer(title, eyebrow, content) {
  refs.drawerTitle.textContent = title;
  refs.drawerEyebrow.textContent = eyebrow;
  clear(refs.drawerBody).append(content);
  refs.drawer.classList.add("is-open");
  refs.drawer.setAttribute("aria-hidden", "false");
  refs.drawerBackdrop.hidden = false;
  onboarding?.rendered();
}

function closeDrawer() {
  refs.drawer.classList.remove("map-expanded");
  refs.drawer.classList.remove("is-open");
  refs.drawer.setAttribute("aria-hidden", "true");
  refs.drawerBackdrop.hidden = true;
  onboarding?.rendered();
}

async function requestCloseDrawer() {
  if (!refs.drawer.classList.contains("is-open")) return;
  if (!await confirmDrawerDiscard()) return;
  closeDrawer();
}

function drawerInputForm() {
  return refs.drawer.classList.contains("is-open") ? refs.drawerBody.querySelector("form") : null;
}

async function confirmDrawerDiscard() {
  const form = drawerInputForm();
  return !form?.confirmDiscardChanges || await form.confirmDiscardChanges();
}

async function refreshBootstrap() {
  state.bootstrap = await api.bootstrap();
  processFeedback.observe(state.bootstrap);
  return state.bootstrap;
}

async function refreshCompletedSource(sourceId) {
  const context = api.getContext(), scrollTop = refs.drawerBody.scrollTop;
  let source;
  try { source = await api.note(sourceId, { background: true }); }
  catch (error) { if (api.getContext().version === context.version && error.code !== "STALE_CONTEXT") throw error; return; }
  if (api.getContext().version !== context.version || !refs.drawer.classList.contains("is-open")
    || refs.drawerBody.querySelector(".source-group-drawer")?.dataset.sourceId !== sourceId) return;
  renderSourceGroupDrawer(source);
  refs.drawerBody.scrollTop = scrollTop;
}

async function navigate(view, options = {}) {
  const context = api.getContext(), mainForm = unsavedInputForm(), drawerForm = drawerInputForm();
  if (!await confirmUnsavedInputDiscard()) return false;
  if (!options.keepDrawer && !await confirmDrawerDiscard()) return false;
  const latest = api.getContext();
  if (latest.version !== context.version || latest.practiceId !== context.practiceId
    || unsavedInputForm() !== mainForm || drawerInputForm() !== drawerForm) return false;
  setPage(view);
  if (!options.keepDrawer) closeDrawer();
  showLoading();
  try {
    await renderCurrent();
    refs.main.focus({ preventScroll: true });
    return true;
  } catch (error) {
    renderFailure(error, () => navigate(view));
  }
}

function capabilityNotice() {
  if (isMobilePrototype()) return mobileNotice();
  const capabilities = asObject(state.bootstrap?.capabilities);
  const aiReady = capabilities.ai ?? state.bootstrap?.settings?.ai?.enabled;
  if (aiReady) return null;
  return el("div", { class: "notice info", text: "AI 或联网能力尚未启用。你仍可保存、编辑和检索本地资料；需要模型的任务会明确等待，不会生成假结果。" });
}

function statCard(label, value, detail = "") {
  return el("div", { class: "stat" }, [el("span", { text: label }), el("strong", { text: String(value) }), detail ? el("small", { text: detail }) : null]);
}

function todayItem(item) {
  const actions = el("div", { class: "item-actions" });
  if (item.state === "pending") {
    if (["study", "learn", "review", "mistake"].includes(item.kind)) {
      actions.append(button("开始", { kind: "primary compact", onClick: event => beginStudy(item.noteId, item.id, item, event.currentTarget || event.target) }));
    }
    actions.append(button("延期", { kind: "quiet compact", onClick: () => actToday(item.id, "defer", 1) }));
    actions.append(button("跳过", { kind: "text compact", onClick: () => actToday(item.id, "skip") }));
    actions.append(button("暂停", { kind: "text compact", onClick: () => actToday(item.id, "pause") }));
  } else actions.append(badge(planStateLabel(item.state), stateTone(item.state)));
  return el("article", { class: "list-item" }, [
    el("div", { class: "item-symbol", text: item.kind === "mistake" ? "错" : item.kind === "review" ? "复" : "学" }),
    el("div", { class: "item-copy" }, [
      el("h3", { text: item.title || "未命名学习项" }),
      el("p", { text: item.reason || "等待安排说明" }),
      el("div", { class: "item-meta" }, [badge(`${number(item.minutes)} 分钟`), badge(planStateLabel(item.state), stateTone(item.state))]),
    ]),
    actions,
  ]);
}

async function actToday(id, action, days) {
  try {
    await api.todayAction(id, { action, ...(days ? { days } : {}) });
    toast(action === "defer" ? "已延期" : "已更新今日安排", "success");
    await refreshBootstrap();
    await renderToday();
  } catch (error) { handleError(error); }
}

async function renderToday() {
  const boot = state.bootstrap || await refreshBootstrap();
  const today = asObject(boot.today);
  const items = asArray(today.items);
  const stats = asObject(boot.stats);
  const jobs = asArray(boot.jobs);
  const pendingJobs = jobs.filter((job) => ["queued", "running", "waiting", "failed"].includes(job.state));

  const hero = el("section", { class: "hero" }, [
    el("div", {}, [
      el("p", { class: "eyebrow", text: today.date ? formatCalendarDate(today.date) : "今天" }),
      el("h2", { text: items.length ? `今天有 ${items.length} 项值得投入` : "今天可以从容整理" }),
      el("p", { text: items.length ? `预计 ${number(today.minutes)} 分钟，时间预算 ${number(today.budget)} 分钟。可延期或跳过，不制造学习欠债。` : "目前没有学习任务。你可以生成清单，或先收集一份真正想理解的材料。" }),
    ]),
    el("div", { class: "hero-actions" }, [
      button("收集资料", { onClick: () => navigate("capture") }),
      tour(button(items.length ? "重新安排" : "生成今日清单", { kind: "primary", onClick: generateToday }), "today-generate"),
    ]),
  ]);

  const statsRow = el("section", { class: "stats" }, [
    statCard("已存内容", stats.notes ?? stats.totalNotes ?? 0, "包含原始资料、知识、主题学习包与 AI 整理建议"),
    statCard("今日待学习", items.filter((item) => item.state === "pending").length, "受每日预算约束"),
    statCard("待处理任务", stats.pending ?? stats.proposals ?? 0, "等待继续或失败的任务"),
    statCard("异常任务", jobs.filter((x) => x.state === "failed").length, "保留失败原因"),
  ]);

  const taskPanel = el("section", { dataset: { tour: "today-plan" } }, [
    sectionHeading("今日安排", "主题学习、到期复习与错题会在这里汇合", button("调整预算", { onClick: () => { state.systemTab = "settings"; navigate("system"); } })),
    items.length ? el("div", { class: "list" }, items.map(todayItem)) : emptyState("还没有今日任务", "生成清单只会安排已有内容，并受时间预算和暂停项限制。", button("生成清单", { kind: "primary", onClick: generateToday })),
  ]);
  const unavailable = asArray(today.unavailable);
  if (unavailable.length) taskPanel.append(el("details", { open: !items.some(item => item.state === "pending") }, [
    el("summary", { text: `未安排的原因 · ${unavailable.length} 项` }),
    el("div", { class: "list" }, unavailable.map(item => el("div", { class: "list-item no-icon" }, [
      el("div", { class: "item-copy" }, [el("h3", { text: item.title }), el("p", { text: item.reason })]),
      el("div", { class: "item-actions" }, [button("查看知识", { kind: "text", onClick: () => openNote(item.noteId) }),
        item.prerequisiteId ? button(`查看前置知识：${item.prerequisiteTitle}`, { kind: "text", onClick: () => openNote(item.prerequisiteId) }) : null,
        item.sourceId ? button("查看原文并重新加工", { kind: "text", onClick: () => openNote(item.sourceId) }) : null]),
    ]))),
  ]));

  const side = el("aside", { class: "page-stack" }, [
    el("section", { class: "panel" }, [
      sectionHeading("处理动态", "仅显示真实任务状态"),
      pendingJobs.length ? el("div", { class: "list" }, pendingJobs.slice(0, 5).map(jobRow)) : emptyState("当前没有后台任务", "需要 AI 或联网的操作会显示在这里。"),
      pendingJobs.length ? button("查看所有任务", { kind: "text", onClick: () => { state.systemTab = "jobs"; navigate("system"); } }) : null,
    ]),
    el("section", { class: "panel soft" }, [
      el("p", { class: "eyebrow", text: "今日原则" }),
      el("h2", { text: "理解优先于数量" }),
      el("p", { class: "muted", text: "先用自己的话解释，再结合反馈补充。学习记录会保留回答、提示使用和后续修正，方便回顾。" }),
    ]),
  ]);

  clear(refs.main).append(el("div", { class: "page-stack" }, [onboarding?.entryCard(), hero, capabilityNotice(), statsRow, el("div", { class: "split-layout" }, [taskPanel, side])]));
}

async function generateToday() {
  try {
    const today = await api.generateToday();
    if (state.bootstrap) state.bootstrap.today = today;
    toast(asArray(today.items).some(item => item.state === "pending") ? "今日清单已更新" : "本次没有待学项，请查看未安排的原因", "success");
    await renderToday();
  } catch (error) { handleError(error); }
}

function jobRow(job) {
  const progress = number(job.progress);
  const displayState = isQuotaWaitMessage(job.error) ? "waiting" : job.state;
  const progressBar = el("div", { class: "progress" }, el("span"));
  progressBar.firstChild.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  return el("div", { class: "list-item no-icon" }, [
    el("div", { class: "item-copy" }, [
      el("h3", { text: ({process:"资料加工",title:"原文标题生成",structure:"逻辑关系分析",relate:"知识关联",discover:"知识发现",grade:"学习反馈",index:"更新索引",topics:"主题整理"})[job.type] || "后台任务" }),
      el("p", { text: jobSummary(job) }),
      progress > 0 ? progressBar : null,
      el("div", { class: "item-meta" }, [badge(labels.state(displayState), stateTone(displayState))]),
    ]),
  ]);
}

function isQuotaWaitMessage(value) {
  return /今日外部(?:调用|请求)次数已达到上限|外部请求.*(?:已达|达到).*上限|daily(?: external)? (?:call|request) limit|daily.*limit.*exceeded/i.test(String(value || ""));
}

function jobSummary(job) {
  if (isQuotaWaitMessage(job?.error)) return "已保存，待外部请求额度恢复后继续";
  return job?.error || job?.code ? describeJobError(job).title : `更新于 ${formatDate(job?.updatedAt, true)}`;
}

function groupJobSummary(job) {
  if (isQuotaWaitMessage(job?.error) || job?.state === "waiting") return "已保存，待继续";
  if (job?.error || job?.code) return describeJobError(job).title;
  if (job?.state === "failed") return "处理未完成，已保留任务记录";
  if (job?.state === "done") return "拆解任务已完成";
  return "拆解任务正在处理";
}

async function renderCapture() {
  if (unsavedInputForm()?.hasUnsavedChanges() && !await confirmUnsavedInputDiscard()) return;
  const captureContext = api.getContext();
  const sameCaptureContext = () => {
    const current = api.getContext();
    return current.version === captureContext.version && current.practiceId === captureContext.practiceId;
  };
  const savedReceipt = el("div", { class: "notice", role: "status", ariaLive: "polite", dataset: { tour: "capture-saved" }, hidden: true });
  function renderSavedReceipt() {
    const receipt = state.lastCapture;
    clear(savedReceipt); savedReceipt.hidden = true;
    if (!receipt) return;
    if (!sameCaptureContext() || receipt.context.version !== captureContext.version || receipt.context.practiceId !== captureContext.practiceId) {
      state.lastCapture = null;
      return;
    }
    savedReceipt.hidden = false;
    savedReceipt.append(el("strong", { text: "最近一次快速收集已保存" }),
      el("p", { text: "原文已保存。重复内容会沿用已有资料；AI 加工状态请在整组详情中查看。可以继续输入下一份资料。" }),
      el("div", { class: "list" }, receipt.notes.map(note => el("div", { class: "item-copy" }, [
        el("p", { text: note.title || "未命名资料" }),
        button("查看整组", { kind: "text", title: `查看资料 ${note.id}`, onClick: () => {
          if (!sameCaptureContext()) { renderSavedReceipt(); return; }
          return openNote(note.id);
        } }),
      ]))));
  }
  renderSavedReceipt();
  const sourceForm = el("form", { class: "panel capture-form", dataset: { tour: "capture-form" } });
  const title = el("input", { name: "title", placeholder: "可留空，根据原文生成便于检索的标题" });
  const body = el("textarea", { name: "body", placeholder: "粘贴原文。系统会保留这份原始快照，不用摘要替代。", required: true, rows: 12 });
  const bodyEditor = !isMobilePrototype() ? createMarkdownEditor(body) : null;
  let fileDrafts = [], fileLoadVersion = 0, filesLoading = false, importing = false, saving = false;
  const process = el("input", { name: "process", type: "checkbox" });
  const research = el("input", { name: "research", type: "checkbox", disabled: true });
  const syncResearchOption = () => {
    if (isMobilePrototype()) { process.checked = false; process.disabled = true; }
    research.disabled = !process.checked;
    if (research.disabled) research.checked = false;
  };
  process.addEventListener("change", syncResearchOption);
  // reset 事件在浏览器恢复默认值之前触发，等恢复完成后再同步依赖。
  sourceForm.addEventListener("reset", () => queueMicrotask(() => { bodyEditor?.setValue(body.defaultValue || ""); syncResearchOption(); }));
  if (isMobilePrototype()) syncResearchOption();
  const titleField = field("标题（可选）", title, "留空会先使用原文片段作为标题；主动 AI 拆解时一同生成标题，也可手动填写。");
  titleField.classList.add("span-2");
  const bodyField = bodyEditor ? el("div", { class: "field" }, [el("span", { class: "field-label", text: "原文" }), bodyEditor,
    el("small", { class: "field-hint", text: "网页或模型输出中的指令不会获得程序权限。" })]) : field("原文", body, "网页或模型输出中的指令不会获得程序权限。");
  bodyField.classList.add("span-2");
  const sourceField = field("来源信息", el("div", { class: "form-grid capture-source-grid" }, [
    el("input", { name: "platform", placeholder: "平台，例如：网页 / 抖音 / AI 对话" }),
    el("input", { name: "author", placeholder: "作者（可选）" }),
    el("input", { name: "url", type: "url", placeholder: "https://…" }),
    el("input", { name: "date", type: "date" }),
    el("input", { name: "locator", class: "span-2", placeholder: "页码、时间点、段落等定位" }),
  ]));
  sourceField.classList.add("span-2");
  sourceForm.append(
    sectionHeading("快速收集", "来源不完整可以留空，系统不会编造"),
    el("div", { class: "form-grid" }, [
      titleField,
      bodyField,
      sourceField,
    ]),
    el("label", { class: "check-field" }, [process, el("span", { text: "保存后使用 AI 拆解（发送所需原文给已配置的服务，可能计费）" })]),
    el("label", { class: "check-field" }, [research, el("span", { text: "拆解时联网检验正确性并寻找反例（可选，需同时勾选 AI 拆解）" })]),
    el("div", { class: "form-actions" }, [button("保存原始资料", { kind: "primary", type: "submit" }), button("清空", { onClick: () => sourceForm.reset() })]),
    savedReceipt,
  );
  const captureValues = () => ({ ...serializeForm(sourceForm), body: bodyEditor?.getValue() ?? body.value, process: process.checked, research: research.checked });
  const importItems = () => fileDrafts.map(({ item, title, editor }) => ({ ...item, title: title.value, body: editor.getValue() }));
  const draftValues = () => JSON.stringify({ capture: captureValues(), files: importItems(), filesLoading });
  protectUnsavedInput(sourceForm, draftValues, "收集内容");
  sourceForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving) return;
    const data = captureValues();
    const submitted = JSON.stringify(data);
    const item = {
      title: data.title, body: data.body, platform: data.platform, author: data.author,
      url: data.url, date: data.date, locator: data.locator,
    };
    try {
      const submit = sourceForm.querySelector("button[type='submit']");
      saving = true; submit.disabled = true;
      const result = await api.import({ items: [item], captureMode: "text", process: process.checked, research: process.checked && research.checked });
      if (!sameCaptureContext()) return;
      const notes = asArray(result.notes).filter(note => typeof note?.id === "string" && note.id);
      state.lastCapture = notes.length ? { context: captureContext, notes: notes.map(({ id, title }) => ({ id, title })) } : null;
      renderSavedReceipt();
      if (JSON.stringify(captureValues()) === submitted) sourceForm.reset();
      toast(`已保存 ${asArray(result.notes).length || 1} 条原始资料${!String(item.title || "").trim() ? "，暂用原文片段作为标题" : ""}`, "success");
      await refreshBootstrap();
    } catch (error) { handleError(error); }
    finally { saving = false; sourceForm.querySelector("button[type='submit']").disabled = false; }
  });

  const fileInput = el("input", { type: "file", accept: ".txt,.md,text/plain,text/markdown", multiple: true });
  const fileList = el("div", { class: "list" });
  const batchPanel = el("section", { class: "panel", dataset: { tour: "capture-batch" } }, [
    sectionHeading("批量导入", "支持 UTF-8 文本和 Markdown，预览并编辑后再保存为原始资料"),
    field("选择文件", fileInput, "文件内容先在浏览器读取，再通过本地会话保存。"),
    fileList,
    el("div", { class: "form-actions" }, [button("导入所选文件", { kind: "primary", disabled: true }), button("清空导入预览", { onClick: () => resetFileDrafts() })]),
  ]);
  const importButton = batchPanel.querySelector(".primary-button");
  if (isMobilePrototype()) {
    fileInput.disabled = true;
    batchPanel.append(el("p", { class: "muted", text: "样机暂不支持文件导入，请先粘贴文本。" }));
  }
  const syncImportButton = () => { importButton.disabled = filesLoading || importing || !fileDrafts.length; };
  function resetFileDrafts() {
    if (importing) return;
    fileLoadVersion++; filesLoading = false;
    fileDrafts.forEach(({ editor }) => editor.destroy()); fileDrafts = [];
    fileInput.value = ""; clear(fileList); syncImportButton();
  }
  fileInput.addEventListener("change", async () => {
    const files = [...fileInput.files], request = ++fileLoadVersion;
    if (importing) return;
    if (!files.length) { filesLoading = false; syncImportButton(); return; }
    if (fileDrafts.length && !await confirmAction({ title: "替换导入预览？", message: "已有文件预览尚未保存，替换会放弃其中的修改。取消可保留当前预览。", confirmText: "替换预览", danger: true })) {
      if (request === fileLoadVersion) { fileInput.value = ""; filesLoading = false; syncImportButton(); }
      return;
    }
    if (request !== fileLoadVersion || refs.main.querySelector('[data-tour="capture-form"]') !== sourceForm) return;
    filesLoading = true; syncImportButton();
    try {
      const items = await Promise.all(files.map(async (file) => {
        if (file.size > 2 * 1024 * 1024) throw new Error(`${file.name} 过大；每份原文最多 500000 个字符。`);
        let text;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
        }
        catch { throw new Error(`${file.name} 不是有效的 UTF-8 文件。`); }
        return parseSourceFile({ name: file.name, text });
      }));
      if (request !== fileLoadVersion || refs.main.querySelector('[data-tour="capture-form"]') !== sourceForm) return;
      fileDrafts.forEach(({ editor }) => editor.destroy()); clear(fileList);
      fileDrafts = items.map((item, index) => {
        const title = el("input", { value: item.title, required: true, ariaLabel: `导入标题 ${index + 1}` });
        const textarea = el("textarea", { rows: 10 });
        const editor = createMarkdownEditor(textarea, { value: item.body });
        fileList.append(el("details", { class: "panel soft markdown-import-preview", open: true }, [
          el("summary", { text: `预览并编辑：${files[index].name}` }), field("标题", title), editor,
        ]));
        editor.mount(refs.main);
        return { item, title, editor };
      });
    } catch (error) { if (request === fileLoadVersion) handleError(error); }
    finally { if (request === fileLoadVersion) { filesLoading = false; syncImportButton(); } }
  });
  importButton.addEventListener("click", async () => {
    if (importing || filesLoading || !fileDrafts.length) return;
    try {
      importing = true; fileInput.disabled = true; syncImportButton();
      const items = importItems();
      const result = await api.import({ items, captureMode: "files", process: false });
      toast(`已导入 ${asArray(result.notes).length || items.length} 个文件`, "success");
      // A successful request must not erase edits made while it was in flight.
      importing = false;
      if (JSON.stringify(importItems()) === JSON.stringify(items)) resetFileDrafts();
      await refreshBootstrap();
    } catch (error) { handleError(error); }
    finally { importing = false; fileInput.disabled = isMobilePrototype(); syncImportButton(); }
  });

  const flowPanel = el("section", { class: "panel soft" }, [
    sectionHeading("内容怎样流动", "保存、内化和整合彼此分开"),
    el("div", { class: "step-list" }, [
      step("1. 原始资料", "保留实际收到的文本、来源和定位。", true),
      step("2. 拆解与核验", "区分事实、观点、证据、反证与适用限制。", false),
      step("3. 选择用途", "可查找、值得学习、值得长期建立联系分别判断。", false),
      step("4. 个人理解", "只有你的确认，才能形成正式的个人知识。", false),
    ]),
  ]);
  const filesPanel = !isMobilePrototype() ? createFileImportPanel({ onSaved: () => refreshBootstrap(), onError: handleError }) : null;
  clear(refs.main).append(el("div", { class: "page-stack" }, [capabilityNotice(), el("div", { class: "split-layout capture-layout" }, [sourceForm, el("div", { class: "page-stack" }, [batchPanel, filesPanel, flowPanel])])]));
  bodyEditor?.mount(refs.main);
}

function step(title, copy, done) {
  return el("div", { class: `step${done ? " is-done" : ""}` }, [el("h3", { text: title }), el("p", { text: copy })]);
}

async function renderLibrary() {
  const sequence = ++libraryRenderSequence;
  const context = api.getContext(), view = state.view;
  const filters = { ...state.libraryFilters };
  const current = () => {
    const latest = api.getContext();
    return sequence === libraryRenderSequence && latest.practiceId === context.practiceId && latest.version === context.version && state.view === view;
  };
  const filtered = Boolean(String(filters.q || '').trim() || filters.kind || filters.stage);
  if (filtered) {
    const oldAdvice = refs.main.querySelector('[data-tour="library-recommendations"]');
    if (oldAdvice) oldAdvice.hidden = true;
  }
  let data;
  try { data = await api.library(filters); }
  catch (error) { if (current()) throw error; return; }
  if (!current()) return;
  const groups = asArray(data.groups).filter((group) => group?.source && !isExcerptOnly(group.source));
  const standalone = asArray(data.standalone).filter((note) => !isExcerptOnly(note));
  const form = el("form", { class: "filter-bar", dataset: { tour: "library-filter" } });
  const q = el("input", { name: "q", value: filters.q, placeholder: "搜索标题和正文" });
  form.append(
    el("div", { class: "search-input" }, q),
    selectControl([["", "内容类别"], ["source", "原始资料"], ["knowledge", "知识"], ["mistake", "错题"], ["topic", "主题学习包"], ["report", "AI 整理建议"]], filters.kind, "kind"),
    selectControl([["", "学习状态"], ["reference", "仅供查阅"], ["candidate", "待选学"], ["learning", "正在学习"], ["integrated", "已整理个人理解"], ["core", "重点知识"], ["retired", "不再使用"]], filters.stage, "stage"),
    button("筛选", { kind: "primary", type: "submit" }),
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    state.libraryFilters = serializeForm(form);
    recordTourEvent("library-filter");
    renderLibrary().catch(handleError);
  });
  const keepLatestFilters = () => {
    if (refs.main.querySelector('[data-tour="library-filter"]') !== form) return;
    const latest = api.getContext();
    if (latest.version !== context.version || latest.practiceId !== context.practiceId) return;
    state.libraryFilters = serializeForm(form);
    // A response must not replace a newer query that is still being typed.
    libraryRenderSequence++;
    const advice = refs.main.querySelector('[data-tour="library-recommendations"]');
    if (advice) advice.hidden = true;
  };
  form.addEventListener('input', keepLatestFilters);
  form.addEventListener('change', keepLatestFilters);
  const groupCards = groups.map((group) => sourceGroupCard(group));
  const standaloneCards = standalone.map((note) => el("article", { class: "card" }, [
    el("div", { class: "card-head" }, [badge(labels.kind(note.kind)), badge(labels.stage(note.meta?.stage), stateTone(note.meta?.stage))]),
    el("h3", { text: note.title || "未命名" }),
    note.kind === 'source' ? sourceReadingBody(sourceBodyPreview(note.body), 'markdown-preview') : el("p", { text: truncate(readableBody(note.body), 135) || "暂无正文" }),
    el("div", { class: "card-foot" }, [el("span", { text: formatDate(note.updatedAt, true) }), button("查看", { kind: "text", onClick: () => openNote(note.id) })]),
  ]));
  const visibleCount = groups.length + standalone.length;
  const conflicts = asArray(state.bootstrap?.conflicts);
  const conflictPanel = conflicts.length ? el("section", { class: "notice danger" }, [
    el("strong", { text: `检测到 ${conflicts.length} 个文件冲突` }),
    el("div", { text: "重复稳定 ID、解析错误或并发修改不会被静默覆盖。请打开相关条目处理。" }),
  ]) : null;
  // Only actual matches may expand a source into its explicitly linked children.
  // A group retained for one matching child must not include its siblings' advice.
  let visibleIds = null;
  if (filtered) {
    visibleIds = new Set(asArray(data.matchingIds));
    for (const group of groups) if (visibleIds.has(group.source.id)) for (const child of asArray(group.children)) visibleIds.add(child.id);
  }
  const advice = isMobilePrototype() ? mobileNotice() : await recommendationsPanel(visibleIds);
  if (!current()) return;
  const page = el("div", { class: "page-stack" }, [
    conflictPanel,
    el("section", {}, [sectionHeading("资料与拆解", `${groups.length} 份原始资料，${standalone.length} 条独立内容；核验依据可在知识详情中展开`, button("收集资料", { kind: "primary", onClick: () => navigate("capture") })), form]),
    advice,
    visibleCount ? el("div", { class: "library-sections", dataset: { tour: "library-content" } }, [
      groups.length ? librarySection('sources', '原始资料', '每份资料及其拆解集中在同一个窗口', el("div", { class: "card-grid group-grid" }, groupCards), groups.length, '份资料') : null,
      standalone.length ? librarySection('standalone', '独立内容', '没有归属于某份原始资料的内容', el("div", { class: "card-grid" }, standaloneCards), standalone.length, '条内容') : null,
    ]) : emptyState("没有匹配的内容", "尝试清除筛选，或先收集一份原始资料。", button("清除筛选", { onClick: () => { state.libraryFilters = { q: "", kind: "", stage: "" }; renderLibrary(); } })),
  ]);
  clear(refs.main).append(page);
}

function isExcerptOnly(note) {
  return Boolean(note?.meta?.excerptOnly);
}

function evidenceRow(evidence) {
  const url = safeExternalUrl(evidence.url);
  return el("article", { class: "citation" }, [
    el("div", { class: "card-head" }, [el("strong", { text: evidence.title || "保存的核验来源" }), badge(sourceRole(evidence.role))]),
    url ? el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: "打开原始网页" }) : null,
    sourceReadingBody(evidence.excerpt, '', '未保存可展示的正文摘录。'),
    evidence.rationale ? el("p", { text: `与主张的关系：${evidence.rationale}` }) : null,
    evidence.locator ? el("p", { class: "fine-print", text: `原文定位：${evidence.locator}` }) : null,
    evidence.fetchedAt ? el("p", { class: "fine-print", text: `读取时间：${formatDate(evidence.fetchedAt, true)}` }) : null,
  ]);
}

function evidenceDetails(noteId, sources = null) {
  const content = el("div", { class: "page-stack original-body" });
  const details = el("details", { class: "original-material", dataset: { tour: "note-evidence" } }, [el("summary", { text: "查看核验依据与底层来源" }), content]);
  let loaded = false, loading = false;
  const load = async () => {
    if (loaded || loading) return;
    loading = true;
    clear(content).append(el("p", { text: "正在读取已保存的证据…" }));
    try {
      const data = sources === null ? await api.evidence(noteId) : { evidence: sources };
      const evidence = asArray(data.evidence);
      clear(content).append(el("p", { class: "fine-print", text: "这里展示已保存的正文与定位。来源存在不等于结论正确，个人理解仍需你确认。" }));
      if (data.researchedAt) content.append(el("p", { class: "fine-print", text: `上次核验：${formatDate(data.researchedAt, true)}` }));
      content.append(evidence.length ? el("div", { class: "list" }, evidence.map(evidenceRow)) : el("p", { text: "尚无已保存的外部核验依据。" }));
      if (asArray(data.limitations).length) content.append(el("div", { class: "notice" }, el("ul", {}, data.limitations.map(value => el("li", { text: value })))));
      loaded = true;
    } catch (error) {
      clear(content).append(el("p", { text: errorMessage(error) }), button("重新读取依据", { onClick: load }));
    } finally { loading = false; }
  };
  details.addEventListener("toggle", () => { if (details.open) load(); });
  return details;
}

function relationControls(note) {
  const useAI = el("input", { type: "checkbox", checked: false });
  const status = el("p", { class: "fine-print", role: "status" });
  const run = button("查找关联", { onClick: async () => {
    run.disabled = true;
    try {
      await api.relate(note.id, { useAI: useAI.checked });
      status.textContent = "关联任务已排队，可在检索与发现页查看结果。";
    } catch (error) { status.textContent = errorMessage(error); }
    finally { run.disabled = false; }
  } });
  return el("details", { class: "child-more-actions", dataset: { tour: "note-relations" } }, [
    el("summary", { text: "查找关联" }),
    el("div", { class: "page-stack original-body" }, [el("p", { class: "fine-print", text: "默认仅在本机查找可探索的材料。主动 AI 分析会发送所需材料，并可能产生费用。" }),
      el("div", { class: "notice info" }, [
        el("strong", { text: "什么时候使用 AI 分析？" }),
        el("ul", {}, [
          el("li", { text: "先用本机查找：想找同一主题的材料，或只是快速浏览可能的联系时，先不勾选 AI。" }),
          el("li", { text: "再考虑 AI：本机结果不够贴切，或想比较说法不同但机制、用途相似的知识，分辨它们是否相互支持、存在冲突或适用条件不同时。" }),
        ]),
        el("p", { class: "fine-print", text: "主动开启后会发送相关材料给已配置的 AI。分析结果只是建议，请核对原文依据后再决定是否接受；AI 不一定能找到有用的关联。" }),
      ]),
      el("label", { class: "check-field" }, [useAI, el("span", { text: "本次允许 AI 分析关联（可能产生费用）" })]),
      el("div", { class: "form-actions" }, [run, button("查看关联结果", { kind: "text", onClick: () => { closeDrawer(); navigate("discover"); } })]), status]),
  ]);
}

async function recommendationsPanel(visibleIds = null) {
  if (visibleIds && !visibleIds.size) return null;
  const panel = el('div', { class: 'page-stack' });
  let suggestionCount = 0;
  try {
    const data = await api.recommendations();
    recordTourEvent("recommendations-open");
    const suggestions = asArray(data.suggestions).filter(suggestion => !visibleIds || [suggestion.noteId, suggestion.sourceId, suggestion.relatedId].some(id => typeof id === 'string' && visibleIds.has(id)));
    if (visibleIds && !suggestions.length) return null;
    suggestionCount = suggestions.length;
    panel.append(suggestions.length ? el("div", { class: "list" }, suggestions.map(suggestion => el("article", { class: "list-item no-icon recommendation-card" }, [
      el("div", { class: "item-copy" }, [el("h3", { text: suggestion.title || "知识建议", title: suggestion.title || "知识建议" }), el("p", { text: truncate(suggestion.reason, 160) }),
        el("div", { class: "item-meta" }, [badge(({ promotion: "调整学习阶段", relearn: "重新学习", reference: "转为查阅", merge: "检查重复", research: "补充研究" })[suggestion.type] || "建议"), suggestion.targetStage ? badge(labels.stage(suggestion.targetStage)) : null]),
        asArray(suggestion.signals).length || String(suggestion.reason || "").length > 160 ? el("details", { class: "recommendation-details" }, [
          el("summary", { text: asArray(suggestion.signals).length ? `查看依据（${suggestion.signals.length} 条）` : "查看完整说明" }),
          el("div", { class: "recommendation-evidence", tabIndex: 0, ariaLabel: "建议完整说明与依据" }, [
            el("p", { text: suggestion.reason }),
            asArray(suggestion.signals).length ? el("ul", {}, suggestion.signals.map(signal => el("li", { text: signal }))) : null,
          ]),
        ]) : null]),
      el("div", { class: "item-actions wrap" }, [
        button("查看知识", { kind: "text compact", onClick: () => openNote(suggestion.noteId) }),
        button(suggestion.type === "merge" ? "预览合并" : suggestion.type === "research" ? "打开待核验资料" : "采用建议", { kind: "primary compact", onClick: async () => {
          try {
            if (suggestion.type === "merge") { const note = await api.note(suggestion.noteId); openDrawer(note.title, "合并建议", el("div")); await renderMerge(note, suggestion.relatedId); return; }
            const result = await api.recommendationAction(suggestion.id, { action: "accept" });
            if (result.requiresResearch && result.sourceId) { await openNote(result.sourceId); return; }
            toast("已按你的选择调整；个人理解和掌握证据分别保留", "success");
            await refreshBootstrap(); await renderLibrary();
          } catch (error) { handleError(error); }
        } }),
        button("暂不采用", { kind: "text compact", onClick: async () => { try { await api.recommendationAction(suggestion.id, { action: "dismiss" }); await renderLibrary(); } catch (error) { handleError(error); } } }),
      ]),
    ]))) : el("p", { class: "muted", text: "目前没有新的调整建议。继续学习或标记输出中实际采用的知识后，可再次查看。" }));
  } catch (error) { if (visibleIds) return null; panel.append(el("p", { text: `建议暂不可用：${errorMessage(error)}` })); }
  const section = librarySection('recommendations', '知识使用建议', '根据实际采用、学习和已有关系提出建议；是否调整由你决定，不自动宣称掌握', panel, suggestionCount, '条建议');
  section.classList.add('panel');
  section.dataset.tour = 'library-recommendations';
  return section;
}

async function previewNoteLinks(noteId) {
  refs.drawerBody.dataset.tour = "note-links";
  try {
    const preview = await api.linksPreview(noteId);
    openDrawer("核对 Obsidian 链接", "稳定身份与可读链接", el("div", { class: "page-stack" }, [
      el("p", { text: "请核对来源、主题和关系链接。确认后仅更新应用维护的链接区块。" }),
      preview.conflict ? el("div", { class: "notice danger", text: "链接区块已被手动修改，请先处理冲突；本次不会覆盖。" }) : null,
      el("div", { class: "two-column" }, [el("section", {}, [el("h3", { text: "更新前" }), sourceReadingBody(preview.before, '', '无')]), el("section", {}, [el("h3", { text: "更新后" }), sourceReadingBody(preview.body, '', '无')])]),
      button(preview.changed ? "确认更新链接" : "链接已是最新", { kind: "primary", disabled: !preview.changed || Boolean(preview.conflict), onClick: async () => {
        try { await api.syncLinks(noteId, { expectedHash: preview.expectedHash }); toast("可读链接已更新", "success"); await openNote(noteId); }
        catch (error) { handleError(error); }
      } }),
    ]));
  } catch (error) { handleError(error); }
}

function sourceGroupCard(group) {
  const source = group.source;
  const children = asArray(group.children).filter((note) => !isExcerptOnly(note));
  const jobs = asArray(group.jobs);
  const activeJob = jobs.find((job) => ["queued", "running", "waiting", "failed"].includes(job.state));
  const childPreview = children.slice(0, 4);
  return el("article", { class: "card source-group-card" }, [
    el("div", { class: "card-head" }, [badge("原始资料", "accent"), badge(`${children.length} 条拆解`, children.length ? "good" : "neutral")]),
    el("h3", { text: source.title || "未命名原始资料" }),
    sourceReadingBody(sourceBodyPreview(source.body), 'markdown-preview'),
    childPreview.length ? el("div", { class: "group-child-preview" }, childPreview.map((child) => el("div", { class: "group-child-preview-item" }, [
      el("span", { text: child.title || "未命名拆解" }),
      badge(labels.stage(child.meta?.stage), stateTone(child.meta?.stage)),
    ]))) : el("p", { class: "group-empty", text: "尚未形成拆解" }),
    children.length > childPreview.length ? el("p", { class: "fine-print", text: `另有 ${children.length - childPreview.length} 条拆解` }) : null,
    activeJob ? el("div", { class: "group-job" }, [badge(labels.state(activeJob.state), stateTone(activeJob.state)), el("span", { text: groupJobSummary(activeJob) })]) : null,
    el("div", { class: "card-foot" }, [el("span", { text: formatDate(source.updatedAt, true) }), button("查看整组", { kind: "text", onClick: () => openNote(source.id) })]),
  ]);
}

async function openNote(id, searchHit = null) {
  openDrawer("正在读取…", "知识详情", el("div", { class: "loading-panel" }, el("span", { class: "spinner" })));
  try {
    const note = await api.note(id);
    if (isExcerptOnly(note)) {
      refs.drawerTitle.textContent = "内容不在知识库展示";
      clear(refs.drawerBody).append(emptyState("这是后台核验材料", "联网证据只用于形成研究结论和限制，不作为独立资料展示。"));
      return;
    }
    if (note.kind === "source") renderSourceGroupDrawer(note);
    else renderNoteDrawer(note);
    if (searchHit?.location) {
      if (searchHit.location.hash !== note.hash) toast('内容已更新，请重新检索以定位当前版本。', 'info');
      else {
        const where = searchHit.location;
        const target = where.heading && [...refs.drawerBody.querySelectorAll('h1,h2,h3,h4,h5,h6')].find(node => node.textContent === where.heading);
        const locator = el('section', { class: 'notice', dataset: { tour: 'search-location' } }, [
          el('strong', { text: where.field === 'title' ? '命中标题' : `命中正文第 ${where.line} 行${where.heading ? ' · '+where.heading : ''}` }),
          el('p', { text: searchHit.snippet }),
        ]);
        refs.drawerBody.prepend(locator);
        (target || locator).scrollIntoView({ block: 'center' });
      }
    }
  } catch (error) {
    refs.drawerTitle.textContent = "读取失败";
    clear(refs.drawerBody).append(emptyState("无法打开这条内容", errorMessage(error), button("重试", { onClick: () => openNote(id) })));
  }
}

function renderSourceGroupDrawer(source) {
  refs.drawerBody.dataset.tour = "note-detail";
  const meta = asObject(source.meta);
  const children = asArray(source.children).filter((note) => !isExcerptOnly(note));
  const jobs = asArray(source.jobs);
  refs.drawerTitle.textContent = source.title || "未命名原始资料";
  refs.drawerEyebrow.textContent = "原始资料与拆解";
  const content = el("div", { class: "page-stack source-group-drawer", dataset: { sourceId: source.id } });
  const headActions = el("div", { class: "form-actions" }, [
    button("编辑原始资料", { kind: "primary", onClick: () => renderNoteEditor(source, { returnToSourceId: source.id }) }),
    button("查看版本", { disabled: isMobilePrototype(), title: isMobilePrototype() ? "样机暂不支持查看版本" : "", onClick: () => renderHistory(source, { returnToSourceId: source.id }) }),
    button("移入回收站", { kind: "danger", disabled: isMobilePrototype(), title: isMobilePrototype() ? "样机暂不支持删除" : "", onClick: () => deleteNote(source) }),
  ]);
  content.append(noteMeta(source), headActions);
  if (source.meta?.titlePending) content.append(el('p', { class: 'muted', text: '暂用原文片段作为标题，标题尚未生成。可手动编辑，或在主动 AI 拆解时生成。' }));

  if (children.length) {
    const key = `${api.getContext().practiceId || ''}:${source.id}`;
    if (!state.sourceMaps.has(key)) state.sourceMaps.set(key, {});
    content.append(createSourceMap({ source, children, view: state.sourceMaps.get(key),
      renderDetail: (note, index) => childSection(note, source, index),
      analyze: () => analyzeStructure(source),
      onExpand: value => refs.drawer.classList.toggle('map-expanded', value),
    }));
  }

  let original;
  const fullscreen = button('全屏阅读', { kind: 'text compact', onClick: event => {
    event.preventDefault();
    event.stopPropagation?.();
    openSourceReader(source);
  } });
  original = el("details", { class: "original-material", dataset: { tour: "note-original" } }, [
    el("summary", {}, [
      el("span", { text: "查看原始资料全文" }),
      el('span', { class: 'original-summary-actions' }, [el("small", { text: `${String(source.body || "").length} 字` }), fullscreen]),
    ]),
    sourceReadingBody(source.body, 'original-body', '暂无原文', source),
  ]);
  if (isMobilePrototype()) original.open = true;
  content.append(original);
  if (attachmentPanel(source)) content.append(attachmentPanel(source));

  const currentUrl = safeExternalUrl(meta.url);
  if (meta.platform || meta.author || meta.date || meta.locator || currentUrl) content.append(el("details", { class: "source-metadata" }, [
    el("summary", { text: "原始资料信息" }),
    el("dl", { class: "key-values" }, [
      el("div", { class: "key-value" }, [el("dt", { text: "平台" }), el("dd", { text: meta.platform || "未记录" })]),
      el("div", { class: "key-value" }, [el("dt", { text: "作者" }), el("dd", { text: meta.author || "未记录" })]),
      el("div", { class: "key-value" }, [el("dt", { text: "资料日期" }), el("dd", { text: meta.date || "未记录" })]),
      meta.dateBasis ? el("div", { class: "key-value" }, [el("dt", { text: "导入时日期依据" }), el("dd", { text: meta.dateBasis })]) : null,
      el("div", { class: "key-value" }, [el("dt", { text: "原文定位" }), el("dd", { text: meta.locator || "未记录" })]),
      el("div", { class: "key-value" }, [el("dt", { text: "原始地址" }), el("dd", {}, currentUrl ? el("a", { href: currentUrl, target: "_blank", rel: "noopener noreferrer", text: currentUrl }) : "未记录")]),
    ]),
  ]));

  if (isMobilePrototype()) {
    content.append(el("p", { class: "muted", text: "加工、核验和学习尚未迁移到手机，本次保存只保留原文。" }));
    clear(refs.drawerBody).append(content);
    return;
  }
  content.append(el("section", { class: "panel soft group-process-actions" }, [
    sectionHeading("继续整理", "生成的拆解会继续归入这个窗口。"),
    el("div", { class: "form-actions" }, [
      processControls(source, source.id),
      button("手动整理为待选学", { disabled: !canProcessFile(source), onClick: () => manualExtract(source, source.id) }),
    ]),
    jobs.length ? el("div", { class: "group-job-list" }, jobs.slice(0, 3).map((job) => el("div", { class: "group-job" }, [
      badge(labels.state(job.state), stateTone(job.state)),
      el("span", { text: groupJobSummary(job) }),
    ]))) : null,
  ]));

  if (!children.length) content.append(emptyState("尚未形成拆解", canProcessFile(source) ? "可以提交 AI 拆解，按需勾选联网核验，或手动整理一条待选学知识。" : sourceFileNotice(source)));
  clear(refs.drawerBody).append(content);
  refs.drawerBody.querySelectorAll('[data-structure-submit]').forEach(updateStructureButton);
  refs.drawerBody.querySelectorAll('.structure-job-status').forEach(updateStructureStatus);
}

function openSourceReader(source) {
  const returnFocus = document.activeElement;
  const backdrop = el('div', { class: 'source-reader-backdrop' });
  const dialog = el('section', { class: 'source-reader-dialog', role: 'dialog', ariaModal: 'true', ariaLabel: `原始资料全文：${source.title || '未命名原始资料'}` });
  const close = () => {
    backdrop.remove();
    if (returnFocus?.isConnected) returnFocus.focus();
  };
  const closeButton = button('关闭全屏阅读', { kind: 'quiet', onClick: close });
  dialog.append(
    el('header', { class: 'source-reader-header' }, [
      el('div', {}, [el('p', { class: 'eyebrow', text: '原始资料全文' }), el('h2', { text: source.title || '未命名原始资料' })]),
      el('div', { class: 'source-reader-actions' }, [el('small', { text: `${String(source.body || '').length} 字` }), closeButton]),
    ]),
    el('div', { class: 'source-reader-body' }, sourceReadingBody(source.body, '', '暂无原文', source)),
  );
  backdrop.addEventListener('click', event => { if (event.target === backdrop) close(); });
  backdrop.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
  backdrop.append(dialog);
  document.body.append(backdrop);
  closeButton.focus();
}

function updateStructureStatus(control) {
  const status = processFeedback.status(control.dataset.sourceId);
  control.textContent = status?.message || '';
  control.hidden = !status || status.type !== 'structure';
}

function updateStructureButton(control) {
  const status = processFeedback.status(control.dataset.structureSubmit);
  control.disabled = Boolean(status?.active);
  if (!control.dataset.idleLabel) control.dataset.idleLabel = control.textContent;
  control.textContent = status?.active ? '正在处理，请等待…' : control.dataset.idleLabel;
  control.title = status?.message || '仅分析现有条目的关系，保留正文';
}

const structureConfirmations = new Set();
async function runConfirmedStructure(key, title, run) {
  const context = api.getContext(), scopedKey = `${context.practiceId || ''}:${key}`;
  if (structureConfirmations.has(scopedKey)) return;
  structureConfirmations.add(scopedKey);
  const contextChanged = () => { const current = api.getContext(); return current.practiceId !== context.practiceId || current.version !== context.version; };
  try {
    if (typeof title === 'function') title = await title();
    if (contextChanged()) return;
    if (!await confirmAction({ title: '重新分析资料结构？', confirmText: '确认重新分析',
      message: `${title ? `《${title}》：` : ''}将把必要原文和当前拆解条目发送给已配置的 AI 服务，重新分析逻辑关系和分支层级，可能产生调用费用。原文与条目正文保留，成功后更新结构建议。` })) return;
    if (contextChanged()) {
      toast('知识库已切换，本次分析未提交。请在当前资料中重新操作。', 'info'); return;
    }
    await run();
  } catch (error) { if (!contextChanged()) handleError(error); }
  finally { structureConfirmations.delete(scopedKey); }
}

async function analyzeStructure(source) {
  if (processFeedback.status(source.id)?.active) return;
  await runConfirmedStructure(`source:${source.id}`, source.title, async () => {
    if (!processFeedback.begin(source.id, 'structure')) return;
    try {
      const job = await api.sourceStructure(source.id);
      processFeedback.observe({ jobs: [job], notes: [source], partial: true, jobRevision: job.jobRevision, jobSnapshot: job.jobSnapshot });
      toast(['queued', 'running'].includes(job.state) ? '逻辑关系分析已排队，原文和拆解内容保留' : '该任务正在等待条件，请到「系统 → 任务」查看原因并重试', ['queued', 'running'].includes(job.state) ? 'success' : 'info');
    } finally { processFeedback.end(source.id); }
  });
}

function childSection(note, source, index) {
  const meta = asObject(note.meta);
  const limitations = asArray(meta.researchLimitations);
  const actions = el("div", { class: "child-actions", dataset: { tour: "note-lifecycle" } }, [
    button("开始学习", { kind: "primary compact", onClick: event => beginStudy(note.id, undefined, {}, event.currentTarget || event.target) }),
    button("编辑", { kind: "quiet compact", onClick: () => renderNoteEditor(note, { returnToSourceId: source.id }) }),
    button("设为仅供查阅", { kind: "text compact", onClick: () => promoteNote(note, "reference", source.id) }),
    button("设为待选学", { kind: "text compact", onClick: () => promoteNote(note, "candidate", source.id) }),
    button("加入学习", { kind: "text compact", onClick: () => promoteNote(note, "learning", source.id) }),
  ]);
  const more = el("details", { class: "child-more-actions" }, [
    el("summary", { text: "更多操作" }),
    el("div", { class: "form-actions" }, [
      button("确认个人理解", { onClick: () => confirmDirect(note, source.id) }),
      button("标记已整理个人理解", { onClick: () => promoteNote(note, "integrated", source.id) }),
      button("设为重点知识", { onClick: () => promoteNote(note, "core", source.id) }),
      button("不再使用", { kind: "danger", onClick: () => promoteNote(note, "retired", source.id) }),
      button("查看版本", { onClick: () => renderHistory(note, { returnToSourceId: source.id }) }),
      button("删除", { kind: "danger", onClick: () => deleteNote(note, source.id) }),
    ]),
  ]);
  return el("section", { class: "child-note" }, [
    el("div", { class: "child-note-head" }, [
      el("div", {}, [el("p", { class: "eyebrow", text: `拆解 ${index + 1}` }), el("h3", { text: note.title || "未命名拆解" })]),
      el("div", { class: "item-meta" }, [badge(labels.stage(meta.stage), stateTone(meta.stage)), meta.topic ? badge(meta.topic, "accent") : null]),
    ]),
    sourceReadingBody(readableBody(note.body), 'child-note-body', '暂无正文'),
    evidenceDetails(note.id),
    limitations.length ? el("div", { class: "notice danger child-limitations" }, [
      el("strong", { text: "尚需补充研究" }),
      el("p", { text: "这些事实仍需进一步核验，暂不用于学习计划或有据回答。" }),
      el("ul", {}, limitations.map((limitation) => el("li", { text: limitation }))),
    ]) : null,
    actions,
    relationControls(note),
    more,
  ]);
}

async function refreshSourceGroup(sourceId, { refreshLibrary = true } = {}) {
  const source = await api.note(sourceId);
  if (!isExcerptOnly(source)) renderSourceGroupDrawer(source);
  if (refreshLibrary && state.view === "library") await renderLibrary();
  return source;
}

function renderNoteDrawer(note) {
  refs.drawerBody.dataset.tour = "note-detail";
  const meta = asObject(note.meta);
  refs.drawerTitle.textContent = note.title || "未命名";
  refs.drawerEyebrow.textContent = labels.kind(note.kind);
  const content = el("div", { class: "page-stack" });
  const headActions = el("div", { class: "form-actions" }, [
    button("编辑", { kind: "primary", onClick: () => renderNoteEditor(note) }),
    button("查看版本", { onClick: () => renderHistory(note) }),
    button("删除", { kind: "danger", onClick: () => deleteNote(note) }),
  ]);
  if (note.kind === "knowledge") headActions.insertBefore(button("合并", { onClick: () => renderMerge(note) }), headActions.lastChild);
  content.append(noteMeta(note), headActions, sourceReadingBody(readableBody(note.body), '', '暂无正文'));
  if (note.kind === "knowledge") content.append(evidenceDetails(note.id), relationControls(note));
  content.append(button("查看 Obsidian 链接更新", { onClick: () => previewNoteLinks(note.id) }));
  const values = el("dl", { class: "key-values" });
  [
    ["稳定 ID", note.id], ["文件路径", note.path], ["内容哈希", note.hash],
    ["更新时间", formatDate(note.updatedAt, true)], ["学习目标", meta.depth ? depthLabel(meta.depth) : "未设置"],
    ["知识主题", meta.topic || "未归入主题"],
  ].forEach(([key, value]) => values.append(el("div", { class: "key-value" }, [el("dt", { text: key }), el("dd", { text: value || "未记录" })])));
  content.append(values);
  const sourceRefs = asArray(meta.sources).filter((source) => source?.role === "input");
  if (sourceRefs.length) content.append(sectionHeading("来源关系", "角色不会与资料出处混为一谈"), el("div", { class: "list" }, sourceRefs.map((source) => {
    const savedSource = asArray(state.bootstrap?.notes).find((item) => item.id === source.id);
    return el("div", { class: "citation" }, [
      el("strong", { text: savedSource?.title || (source.id ? "保存的来源已删除或暂不可读" : "来源未记录") }),
      el("p", { text: sourceRole(source.role) }),
      source.locator ? el("p", { text: `定位：${source.locator}` }) : null,
      savedSource ? button("查看保存的来源", { kind: "text", onClick: () => openNote(source.id) }) : source.id ? el("span", { class: "badge badge-danger", text: "来源不可用" }) : null,
    ]);
  })));
  const researchLimitations = asArray(meta.researchLimitations);
  if (researchLimitations.length) content.append(el("section", { class: "notice danger" }, [
    el("strong", { text: "尚需补充研究" }),
    el("p", { text: "以下限制会阻止这条内容被默认用于学习或有据回答：" }),
    el("ul", {}, researchLimitations.map((limitation) => el("li", { text: limitation }))),
  ]));
  if (note.kind === "source") {
    const currentUrl = safeExternalUrl(meta.url);
    content.append(sectionHeading("当前来源信息", "可在编辑中补充或修正；最初收集记录仍保留在下方"), el("dl", { class: "key-values" }, [
      el("div", { class: "key-value" }, [el("dt", { text: "平台" }), el("dd", { text: meta.platform || "未记录" })]),
      el("div", { class: "key-value" }, [el("dt", { text: "作者" }), el("dd", { text: meta.author || "未记录" })]),
      el("div", { class: "key-value" }, [el("dt", { text: "资料日期" }), el("dd", { text: meta.date || "未记录" })]),
      meta.dateBasis ? el("div", { class: "key-value" }, [el("dt", { text: "导入时日期依据" }), el("dd", { text: meta.dateBasis })]) : null,
      el("div", { class: "key-value" }, [el("dt", { text: "原文定位" }), el("dd", { text: meta.locator || "未记录" })]),
      el("div", { class: "key-value" }, [el("dt", { text: "原始地址" }), el("dd", {}, currentUrl ? el("a", { href: currentUrl, target: "_blank", rel: "noopener noreferrer", text: currentUrl }) : "未记录")]),
    ]));
  }
  const origins = asArray(meta.origins);
  if (origins.length) content.append(sectionHeading("原始出处", "缺失字段保持空白，不会自动补写"), el("div", { class: "list" }, origins.map((origin) => {
    const originUrl = safeExternalUrl(origin.url);
    return el("div", { class: "citation" }, [
      el("strong", { text: origin.platform || "未记录平台" }),
      el("p", { text: [origin.author, origin.date, origin.locator].filter(Boolean).join(" · ") || "未记录作者、日期或定位" }),
      origin.dateBasis ? el("p", { text: `导入时日期依据：${origin.dateBasis}` }) : null,
      origin.acquiredAt ? el("p", { text: `收集于 ${formatDate(origin.acquiredAt, true)}` }) : null,
      originUrl ? el("a", { href: originUrl, target: "_blank", rel: "noopener noreferrer", text: "打开原始地址 ↗" }) : null,
    ]);
  })));
  const url = safeExternalUrl(meta.url);
  if (url) content.append(el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: "打开原始网页 ↗" }));
  const nextActions = el("div", { class: "form-actions", dataset: { tour: "note-lifecycle" } });
  if (note.kind === "source") nextActions.append(
    processControls(note),
    button("手动整理为待选学", { disabled: !canProcessFile(note), onClick: () => manualExtract(note) }),
  );
  if (note.kind === "knowledge") nextActions.append(
    button("开始学习", { kind: "primary", onClick: event => beginStudy(note.id, undefined, {}, event.currentTarget || event.target) }),
    button("设为仅供查阅", { onClick: () => promoteNote(note, "reference") }),
    button("设为待选学", { onClick: () => promoteNote(note, "candidate") }),
    button("加入学习", { kind: "primary", onClick: () => promoteNote(note, "learning") }),
    button("确认个人理解", { onClick: () => confirmDirect(note) }),
    el("details", {}, [el("summary", { text: "更多学习状态操作" }), el("div", { class: "form-actions" }, [
      button("标记已整理个人理解", { onClick: () => promoteNote(note, "integrated") }),
      button("设为重点知识", { onClick: () => promoteNote(note, "core") }),
      button("不再使用", { kind: "danger", onClick: () => promoteNote(note, "retired") }),
    ])]),
  );
  content.append(el("section", { class: "panel soft" }, [
    sectionHeading("下一步", "选择用途不等于宣称已经掌握"),
    nextActions.children.length ? nextActions : el("p", { class: "muted", text: "这类内容可继续查看、编辑或通过对应工作区处理。" }),
  ]));
  clear(refs.drawerBody).append(content);
}

function renderNoteEditor(note, { returnToSourceId = "" } = {}) {
  refs.drawerBody.dataset.tour = "note-editor";
  refs.drawerBody.dataset.tourSubject = note.id;
  const meta = asObject(note.meta);
  const form = el("form", { class: "page-stack" });
  const title = el("input", { name: "title", value: note.title || "", required: true });
  const body = el("textarea", { name: "body", textContent: note.body || "", rows: 18, required: true });
  const imageUploads = [];
  const imageControls = note.kind === "source" && !isMobilePrototype() ? imageInsertControls(body, imageUploads, { getNote: () => note }) : null;
  const bodyEditor = !isMobilePrototype() ? createMarkdownEditor(body, { value: note.body || "", ...imageControls?.editorOptions }) : null;
  const editorValues = () => { const values = serializeForm(form); if (bodyEditor) values.body = bodyEditor.getValue(); if (imageControls) values.attachmentUploadIds = [...imageUploads]; return values; };
  const sourceFields = note.kind === "source" ? el("section", { class: "panel soft" }, [
    sectionHeading("来源信息", "补充或修正当前来源，不会改写最初收集快照"),
    el("div", { class: "form-grid" }, [
      field("平台", el("input", { name: "platform", value: meta.platform || "", placeholder: "网页、抖音、AI 对话等" })),
      field("作者", el("input", { name: "author", value: meta.author || "" })),
      field("原始地址", el("input", { name: "url", type: "url", value: meta.url || "", placeholder: "https://…" })),
      field("资料日期", el("input", { name: "date", type: "text", value: String(meta.date || ""), placeholder: "保留原始日期格式" })),
      field("原文定位", el("input", { name: "locator", value: meta.locator || "", placeholder: "页码、时间点或段落" })),
      field("本资料下次核验有效天数", el("input", { dataset: { tour: "note-validity" }, name: "researchIntervalDays", type: "number", min: 1, max: 365, step: 1, value: meta.researchIntervalDays ?? 30, required: true }), "仅在后续成功核验时生效；默认 30 天，可设置 1–365 天。"),
    ]),
  ]) : null;
  form.append(
    el("div", { class: "notice", text: "保存时会核对内容哈希；若文件已被 Obsidian 或其他窗口修改，本次保存会停下并显示冲突。" }),
    field("标题", title), bodyEditor ? el("div", { class: "field" }, [el("span", { class: "field-label", text: "正文" }), tour(bodyEditor, "note-body")]) : field("正文", tour(body, "note-body")),
    ...(imageControls ? [imageControls] : []),
    ...(sourceFields ? [sourceFields] : []),
    el("div", { class: "form-grid" }, [
      el("div", { class: "field" }, [
        field("学习状态", el("input", { value: labels.stage(meta.stage), disabled: true }), "学习状态请通过相应操作调整，以便保留理由。"),
        note.kind === "knowledge" ? button("前往状态操作", { kind: "text compact", onClick: async () => {
          const context = api.getContext();
          if (JSON.stringify(editorValues()) !== originalValues && !await confirmAction({ title: "前往状态操作？", message: "当前修改尚未保存。请取消并先保存；也可以放弃这些修改，返回这条知识的详情进行状态操作。", confirmText: "放弃修改并前往" })) return;
          const latest = api.getContext();
          if (latest.practiceId !== context.practiceId || latest.version !== context.version || refs.drawerBody.querySelector("form") !== form) return;
          renderNoteDrawer(note);
          const target = refs.drawerBody.querySelector('[data-tour="note-lifecycle"]');
          if (target) {
            target.tabIndex = -1;
            target.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
            target.focus({ preventScroll: true });
          }
        } }) : null,
      ]),
      field("知识主题", el("input", { name: "topic", value: meta.topic || "", placeholder: "可留空" })),
      learningGoalField(meta.depth),
    ]),
    el("div", { class: "form-actions" }, [button("保存修改", { kind: "primary", type: "submit" }), button("取消", { onClick: async () => {
      if (!await form.confirmDiscardChanges()) return;
      await leaveEditor(JSON.stringify(editorValues())).catch(handleError);
    } })]),
  );
  let initialFields = editorValues();
  if (isMobilePrototype()) {
    for (const name of ["depth", "researchIntervalDays"]) form.querySelector(`[name="${name}"]`).disabled = true;
  }
  let originalValues = JSON.stringify(editorValues()), saving = false;
  form.hasUnsavedChanges = () => JSON.stringify(editorValues()) !== originalValues;
  let confirmingDiscard = false;
  form.confirmDiscardChanges = async () => {
    if (confirmingDiscard) return false;
    const context = api.getContext();
    if (JSON.stringify(editorValues()) !== originalValues) {
      confirmingDiscard = true;
      try {
        if (!await confirmAction({ title: "放弃未保存的修改？", message: "当前修改尚未保存。取消可继续编辑；确认放弃后，本次输入不会保存。", confirmText: "放弃修改", danger: true })) return false;
      } finally { confirmingDiscard = false; }
    }
    const latest = api.getContext();
    return latest.practiceId === context.practiceId && latest.version === context.version && refs.drawerBody.querySelector("form") === form;
  };
  const currentEditor = (context, open) => {
    const latest = api.getContext();
    return latest.practiceId === context.practiceId && latest.version === context.version
      && refs.drawerBody.querySelector("form") === form && refs.drawer.classList.contains("is-open") === open;
  };
  async function leaveEditor(snapshot, context = api.getContext(), open = refs.drawer.classList.contains("is-open")) {
    const canLeave = () => currentEditor(context, open) && JSON.stringify(editorValues()) === snapshot;
    if (!canLeave()) return;
    const source = returnToSourceId ? await api.note(returnToSourceId) : null;
    if (!canLeave()) return;
    if (source) { if (!isExcerptOnly(source)) renderSourceGroupDrawer(source); }
    else renderNoteDrawer(note);
    if (state.view === "library") await renderLibrary();
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving) return;
    const data = editorValues(), submitted = JSON.stringify(data), context = api.getContext();
    const open = refs.drawer.classList.contains("is-open"), previousHash = note.hash;
    const submit = form.querySelector("button[type='submit']");
    saving = true; submit.disabled = true;
    try {
      if (bodyEditor && !data.body.trim()) throw new Error("正文不能为空。");
      if (!isMobilePrototype() && note.kind === "source" && (!Number.isInteger(Number(data.researchIntervalDays)) || Number(data.researchIntervalDays) < 1 || Number(data.researchIntervalDays) > 365)) throw new Error("核验有效天数应为 1–365 的整数。");
      const sourceMeta = note.kind === "source" ? { platform: data.platform || "", author: data.author || "", url: data.url || "", date: data.date || "", locator: data.locator || "", researchIntervalDays: Number(data.researchIntervalDays) } : {};
      const changedMeta = Object.fromEntries(Object.entries({ topic: data.topic, depth: data.depth, ...sourceMeta }).filter(([key]) => data[key] !== initialFields[key]));
      if (isMobilePrototype()) for (const key of ["depth", "researchIntervalDays"]) delete changedMeta[key];
      const updated = await api.updateNote(note.id, { body: data.body, title: data.title, expectedHash: previousHash, meta: changedMeta,
        ...(imageControls ? { attachmentUploadIds: data.attachmentUploadIds } : {}) });
      if (!currentEditor(context, open)) return;
      const bound = new Set(data.attachmentUploadIds || []);
      for (let i = imageUploads.length - 1; i >= 0; i--) if (bound.has(imageUploads[i])) imageUploads.splice(i, 1);
      note = { ...note, ...updated };
      initialFields = data;
      const savedValues = JSON.stringify({ ...data, ...(imageControls ? { attachmentUploadIds: [] } : {}) });
      originalValues = savedValues;
      toast(updated.hash === previousHash ? "内容未改变，已确认当前设置" : "已保存，并保留版本记录", "success");
      await refreshBootstrap();
      if (!currentEditor(context, open)) return;
      if (JSON.stringify(editorValues()) !== savedValues) {
        toast("提交时的版本已保存；后续输入仍在当前草稿，请再次保存。", "info");
        return;
      }
      await leaveEditor(savedValues, context, open);
      if (currentEditor(context, open) && JSON.stringify(editorValues()) !== savedValues) {
        toast("提交时的版本已保存；后续输入仍在当前草稿，请再次保存。", "info");
      }
    } catch (error) { if (currentEditor(context, open)) handleError(error); }
    finally { saving = false; submit.disabled = false; }
  });
  clear(refs.drawerBody).append(form);
  bodyEditor?.mount(refs.drawerBody);
}

async function deleteNote(note, returnToSourceId = "") {
  const source = note.kind === 'source';
  const ok = await confirmAction({ title: source ? '移入回收站？' : '移入本地历史区？', message: source ? '将从当前资料列表移除，可在左下角回收站恢复原文和附件。已有知识与学习记录会保留。' : '当前索引会移除这条内容，版本与备份仍按保留策略存在。', confirmText: source ? '移入回收站' : '移入历史区', danger: true });
  if (!ok) return;
  try {
    await api.deleteNote(note.id, note.hash);
    toast(source ? '已移入回收站' : '已移入本地历史区并从当前索引移除', 'success');
    await refreshBootstrap();
    if (returnToSourceId) await refreshSourceGroup(returnToSourceId);
    else {
      closeDrawer();
      if (state.view === "library") await renderLibrary();
    }
  } catch (error) { handleError(error); }
}

function processControls(note, returnToSourceId = "") {
  const research = el("input", { type: "checkbox", name: "research" });
  const controls = el("div", { class: "page-stack process-controls", dataset: { tour: "note-process", processNoteId: note.id } }, [
    el("label", { class: "check-field" }, [research, el("span", { text: "联网核验事实与适用条件（含反例，可选）" })]),
    el("div", { class: "form-actions" }, [
      button("提交 AI 拆解", { kind: "primary process-submit", onClick: () => processNote(note, returnToSourceId, { research: research.checked }) }),
      button("联网核验事实与适用条件", { kind: "quiet process-research", onClick: () => processNote(note, returnToSourceId, { research: true, reuseExtracted: true }) }),
    ]),
    el("div", { class: "process-status", role: "status", ariaLive: "polite", hidden: true }),
    el("p", { class: "muted", text: "默认只拆解。生成后可手动联网核验整份资料；已有拆解会复用，人工编辑内容将生成修订建议。" }),
  ]);
  controls.dataset.fileBlocked = canProcessFile(note) ? '' : 'true';
  if (sourceFileNotice(note)) controls.append(el('p', { class: 'notice', text: sourceFileNotice(note) }));
  updateProcessControls(controls);
  return controls;
}

function updateProcessControls(controls) {
  const status = processFeedback.status(controls.dataset.processNoteId);
  const pending = Boolean(status?.active);
  const disabled = pending || controls.dataset.fileBlocked === 'true';
  controls.querySelector(".process-submit").disabled = disabled;
  controls.querySelector(".process-submit").textContent = pending ? (status.type === 'structure' ? '逻辑关系分析中…' : "AI 拆解处理中…") : "提交 AI 拆解";
  controls.querySelector(".process-research").disabled = disabled;
  controls.querySelector("input").disabled = disabled;
  if (disabled) controls.querySelector("input").checked = false;
  const indicator = controls.querySelector(".process-status");
  indicator.hidden = !status;
  clear(indicator).append(...[pending ? el("span", { class: "spinner process-spinner", ariaHidden: "true" }) : null,
    el("span", { text: status?.message || "" })].filter(Boolean));
}

async function processNote(note, returnToSourceId = "", options = {}) {
  if (!processFeedback.begin(note.id)) return;
  try {
    const job = await api.processNote(note.id, options);
    processFeedback.observe({ jobs: [job], notes: [note], partial: true, jobRevision: job.jobRevision, jobSnapshot: job.jobSnapshot });
    const waitingForQuota = isQuotaWaitMessage(job.error);
    toast(job.extractionSaved && job.state !== "done" ? "拆解已保存，可先阅读；剩余事实可到任务页继续核验。" : waitingForQuota || job.state === "waiting" ? "任务已保存，待条件满足后继续" : job.state === "failed" ? "任务已记录失败原因，请到「系统 → 任务」手动重试" : job.state === "cancelled" ? "已有任务已取消，请到「系统 → 任务」手动重试" : job.reused && job.state === "done" ? "这份资料已有拆解结果，可直接查看。" : job.reused ? "这份资料正在拆解，请稍候。" : (options.research ? "已提交联网核验任务" : "已提交 AI 拆解任务"), job.state === "failed" && !waitingForQuota ? "error" : "success");
    await refreshBootstrap();
    if (returnToSourceId || note.kind === "source") await refreshSourceGroup(returnToSourceId || note.id);
    else renderNoteDrawer(note);
  } catch (error) { handleError(error); }
  finally { processFeedback.end(note.id); }
}

function manualExtract(source, returnToSourceId = "") {
  refs.drawerBody.dataset.tour = "note-extract";
  const form = el("form", { class: "page-stack" });
  const title = el("input", { name: "title", required: true, placeholder: "这段内容在讨论什么" });
  const body = el("textarea", { name: "body", required: true, rows: 14, placeholder: "复制并整理你要保留的片段。请保留决定结论的条件和上下文。" });
  const topic = el("input", { name: "topic", placeholder: "可选，例如：检索与证据" });
  const reason = el("textarea", { name: "reason", required: true, rows: 4, placeholder: "它为什么值得查找、学习或建立联系？" });
  const depth = learningGoalField("explain");
  const claimType = selectControl([["fact", "含需查证事实（默认）"], ["opinion", "仅个人观点或虚构练习"]], "fact", "claimType");
  form.append(
    el("div", { class: "notice info", text: "此操作不需要 AI。新条目会自动关联这份原始资料，并标记为用户手动整理；它不会因此被宣称已经外部核验或已经掌握。" }),
    field("待选学知识标题", title), field("整理后的正文", body),
    el("div", { class: "form-grid" }, [field("内容性质", claimType, "含事实的内容会保留待研究限制，不默认进入学习；纯观点或虚构练习可由你主动加入学习。"), depth, field("知识主题", topic)]),
    field("保留与学习理由", reason),
    el("div", { class: "form-actions" }, [button("创建待选学知识", { kind: "primary", type: "submit" }), button("取消", { onClick: () => returnToSourceId ? refreshSourceGroup(returnToSourceId).catch(handleError) : renderNoteDrawer(source) })]),
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = serializeForm(form);
    try {
      const knowledge = await api.extractSource(source.id, { title: data.title, body: data.body, topic: data.topic, reason: data.reason, depth: data.depth, claimType: data.claimType });
      toast("待选学知识已创建，并保留原始来源关系", "success");
      await refreshBootstrap();
      if (returnToSourceId) await refreshSourceGroup(returnToSourceId);
      else renderNoteDrawer(knowledge);
    } catch (error) { handleError(error); }
  });
  clear(refs.drawerBody).append(form);
}

async function promoteNote(note, stage, returnToSourceId = "") {
  const reason = await promptAction({
    title: stage === "retired" ? "标记为不再使用" : `调整为${labels.stage(stage)}`,
    message: stage === "retired"
      ? "请说明这条知识为何不再使用，例如内容过时、被替代或不再适用。标记后不再安排学习，也不用于默认答案引用；内容和已有记录仍保留。"
      : "请写下这次分流或晋级的真实理由，便于以后回顾。已整理个人理解和重点知识需要先确认个人理解。",
    label: stage === "retired" ? "不再使用的理由" : "调整理由",
    initialValue: stage === "retired" ? "" : "与当前学习目标相关",
    placeholder: stage === "retired" ? "例如：内容已被新版资料替代。" : "",
    submitText: stage === "retired" ? "确认不再使用" : "确认调整",
    danger: stage === "retired",
    required: true,
  });
  if (reason === null) return;
  try {
    const updated = await api.promote(note.id, { stage, reason, depth: note.meta?.depth || "aware" });
    toast(`已设为${labels.stage(stage)}`, "success");
    await refreshBootstrap();
    if (state.view === "today") await renderToday();
    if (returnToSourceId) await refreshSourceGroup(returnToSourceId);
    else renderNoteDrawer(updated);
  } catch (error) { handleError(error); }
}

function confirmDirect(note, returnToSourceId = "") {
  refs.drawerBody.dataset.tour = "note-confirm";
  refs.drawerBody.dataset.tourSubject = note.id;
  refs.drawerBody.dataset.tourMode = "direct";
  const form = el("form", { class: "page-stack" });
  const body = el("textarea", { rows: 14, placeholder: "请用自己的语言写下：它解决什么问题、成立条件是什么、哪里可能失效，以及你会怎样应用。" });
  form.append(el("div", { class: "notice", text: "AI 可以帮助整理，但只有你主动提交的文字才会成为正式个人理解。" }), field("我的理解", body), el("div", { class: "form-actions" }, [button("确认写入", { kind: "primary", type: "submit" }), button("取消", { onClick: () => returnToSourceId ? refreshSourceGroup(returnToSourceId).catch(handleError) : renderNoteDrawer(note) })]));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const updated = await api.confirmNote(note.id, { body: body.value, expectedHash: note.hash });
      toast("个人理解已确认", "success");
      await refreshBootstrap();
      if (returnToSourceId) await refreshSourceGroup(returnToSourceId);
      else renderNoteDrawer(updated);
    } catch (error) { handleError(error); }
  });
  clear(refs.drawerBody).append(form);
}

async function renderMerge(note, relatedId = "") {
  refs.drawerBody.dataset.tour = "note-merge";
  try {
    const data = await api.notes({ kind: "knowledge" });
    const candidates = asArray(data.notes).filter((item) => item.id !== note.id);
    if (!candidates.length) { toast("目前没有可与此条合并的其他知识", "error"); return; }
    const form = el("form", { class: "page-stack" });
    const select = selectControl(candidates.map((item) => [item.id, item.title || item.id]), candidates.some(item => item.id === relatedId) ? relatedId : candidates[0].id, "mergeId");
    const preview = el("div");
    form.append(el("div", { class: "notice", text: "合并仅适用于明确重复的知识。不同观点会保留为独立段落和来源，不会自动抹平分歧。" }), field("合并另一条知识", select), button("生成合并预览", { kind: "primary", type: "submit" }), preview);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const other = candidates.find((item) => item.id === select.value);
      try {
        const result = await api.merge({ keepId: note.id, mergeId: other.id, expectedHash: note.hash, mergeHash: other.hash, preview: true });
        clear(preview).append(el("section", { class: "panel soft" }, [el("div", { class: "notice", text: result.warning || "请核对预览后再确认。" }), sourceReadingBody(result.after), button("确认合并", { kind: "danger", onClick: async () => {
          const ok = await confirmAction({ title: "确认合并？", message: "将保留两份观点与来源，另一条知识会标为被替代。", confirmText: "合并", danger: true });
          if (!ok) return;
          try {
            const merged = await api.merge({ keepId: note.id, mergeId: other.id, expectedHash: result.expectedHash || note.hash, mergeHash: result.mergeHash || other.hash, preview: false });
            toast("知识已合并，原条目保留替代关系", "success");
            await refreshBootstrap();
            renderNoteDrawer(merged);
          } catch (error) { handleError(error); }
        } })]));
      } catch (error) { handleError(error); }
    });
    clear(refs.drawerBody).append(form);
  } catch (error) { handleError(error); }
}

async function renderHistory(note, { returnToSourceId = "" } = {}) {
  refs.drawerBody.dataset.tour = "note-history";
  try {
    const data = await api.history(note.id);
    const versions = asArray(data.versions);
    recordTourEvent("history-open");
    clear(refs.drawerBody).append(
      button("← 返回内容", { kind: "text", onClick: () => returnToSourceId ? refreshSourceGroup(returnToSourceId).catch(handleError) : renderNoteDrawer(note) }),
      versions.length ? el("div", { class: "list" }, versions.map((version) => el("div", { class: "list-item no-icon" }, [
        el("div", { class: "item-copy" }, [
          el("h3", { text: formatDate(version.createdAt || version.updatedAt, true) }),
          el("p", { text: version.reason || version.hash || "历史版本" }),
          el("details", {}, [el("summary", { text: "审阅旧版本正文" }), historyReadingBody(note, version)]),
        ]),
        button("恢复此版本", { onClick: () => restoreVersion(note, version, returnToSourceId) }),
      ]))) : emptyState("没有可用的历史版本", "首次修改后，旧版本会出现在这里。"),
    );
  } catch (error) { handleError(error); }
}

async function restoreVersion(note, version, returnToSourceId = "") {
  const ok = await confirmAction({ title: "恢复这个版本？", message: "恢复前会检查当前内容哈希，并保留覆盖前版本。", confirmText: "恢复" });
  if (!ok) return;
  try {
    const restored = await api.restoreVersion(note.id, { versionId: version.versionId || version.id, expectedHash: note.hash });
    toast("版本已恢复", "success");
    await refreshBootstrap();
    if (returnToSourceId) await refreshSourceGroup(returnToSourceId);
    else renderNoteDrawer(restored);
  } catch (error) { handleError(error); }
}

const learningGoals = {
  aware: { label: "了解用途", summary: "知道何时会用到", description: "知道它有什么用，遇到什么问题时会想到它；不要求记住原理和细节。" },
  find: { label: "会查资料", summary: "需要时能找到", description: "需要时能用关键词或出处找到资料，并核对适用条件；不要求脱离资料背出内容。" },
  explain: { label: "讲清原理", summary: "用自己的话说明", description: "不看原文，用自己的话说明它为什么成立、适用条件，并举一个例子。" },
  apply: { label: "换场景应用", summary: "用于新的问题", description: "换一个不同于原文例子的问题，说明怎么用、需要哪些条件，以及什么时候不适用。" },
};
function depthLabel(value) {
  return Object.hasOwn(learningGoals, value) ? learningGoals[value].label : value;
}
function learningGoalField(value) {
  const selected = Object.hasOwn(learningGoals, value) ? value : "explain";
  const select = selectControl(Object.entries(learningGoals).map(([key, goal]) => [key, `${goal.label} · ${goal.summary}`]), selected, "depth");
  const hint = el("small", { class: "field-hint", id: "learning-goal-hint", ariaLive: "polite" });
  select.setAttribute("aria-describedby", "learning-goal-hint");
  const updateHint = () => { hint.textContent = learningGoals[select.value].description; };
  select.value = selected;
  select.addEventListener("change", updateHint);
  updateHint();
  const goalField = field("学习目标", select);
  goalField.append(hint, el("small", { class: "field-hint", text: "选择想学到的程度，用来决定练习方式；不代表已经掌握。按实际需要选即可。" }));
  return goalField;
}
function planStateLabel(value) {
  return ({ pending: "待学习", done: "已完成", skip: "已跳过", skipped: "已跳过", defer: "已延期", deferred: "已延期", pause: "已暂停", paused: "已暂停" })[value] || labels.state(value);
}
function sourceRole(value) {
  return ({ input: "原始输入", support: "支持", oppose: "反对", limit: "适用限制" })[value] || value || "来源";
}

let studyStartPending = false;
// Retain uncertain POST results for retries; any successful start retires them.
const studyStartRequests = new Map();
async function beginStudy(noteId, planId, context = {}, control) {
  if (!noteId) { toast("这项任务没有关联知识，暂时无法开始", "error"); return; }
  if (studyStartPending) return;
  studyStartPending = true;
  const wasDisabled = control?.disabled;
  if (control) control.disabled = true;
  try {
    const library = api.getContext();
    const intentKey = JSON.stringify([library.practiceId || '', library.version, noteId, planId || null, context.topicId || null, context.mistakeId || null]);
    let requestId = studyStartRequests.get(intentKey);
    if (!requestId) { requestId = crypto.randomUUID(); studyStartRequests.set(intentKey, requestId); }
    state.currentStudy = await api.startStudy({ requestId, noteId, ...(planId ? { planId } : {}), ...(context.topicId ? { topicId: context.topicId } : {}), ...(context.mistakeId ? { mistakeId: context.mistakeId } : {}) });
    studyStartRequests.clear();
    if (context.topicId) recordTourEvent("topic-study");
    closeDrawer();
    state.studyMaterialVisible = true;
    state.studyTab = "session";
    await navigate("study");
  } catch (error) { handleError(error); }
  finally { studyStartPending = false; if (control) control.disabled = wasDisabled; }
}

async function renderStudy() {
  const context = api.getContext();
  const currentForm = refs.main.querySelector('[data-tour="study-session"]');
  const keepDraft = state.studyTab === "session" && currentForm?.dataset.sessionId === state.currentStudy?.id
    && currentForm?.draftContextVersion === context.version && currentForm.draftPracticeId === context.practiceId;
  if (!keepDraft && !await confirmUnsavedInputDiscard()) { state.studyTab = "session"; return; }
  const wrapper = el("div", { class: "page-stack" });
  const tabs = el("div", { class: "tabs" }, [
    tabButton("queue", "学习队列"), tabButton("session", "当前学习"), tabButton("mistakes", "错题库"),
  ]);
  wrapper.append(...[tabs, capabilityNotice()].filter(Boolean));
  if (state.studyTab === "session") wrapper.append(await studySessionPanel());
  else if (state.studyTab === "mistakes") wrapper.append(await mistakesPanel());
  else wrapper.append(await studyQueuePanel());
  if (keepDraft) {
    const latest = api.getContext(), nextForm = wrapper.querySelector('[data-tour="study-session"]');
    if (latest.version !== context.version || latest.practiceId !== context.practiceId || unsavedInputForm() !== currentForm) return;
    if (!nextForm || nextForm.dataset.sessionId !== currentForm.dataset.sessionId) return;
    nextForm.restoreAnswerDraft(currentForm.readAnswerDraft());
  }
  clear(refs.main).append(wrapper);
}

function tabButton(value, label) {
  return el("button", { class: `tab${state.studyTab === value ? " is-active" : ""}`, text: label, on: { click: async () => { state.studyTab = value; await renderStudy().catch(handleError); } } });
}

async function studyQueuePanel() {
  const [todayData, notesData, sessionsData] = await Promise.all([api.today(), api.notes({ stage: "learning" }), api.studySessions()]);
  const today = asArray(todayData.items).filter((item) => item.noteId);
  const learning = asArray(notesData.notes);
  const byId = new Map();
  today.forEach((item) => byId.set(item.noteId, { ...item, inToday: true }));
  learning.forEach((note) => { if (!byId.has(note.id)) byId.set(note.id, { id: `note-${note.id}`, noteId: note.id, title: note.title, reason: "已加入学习", minutes: 0, state: "available" }); });
  const items = [...byId.values()];
  const sessions = asArray(sessionsData.sessions);
  return el("section", { dataset: { tour: "study-queue" } }, [
    sectionHeading("学习队列", "今日安排和正在学习的内容彼此独立，未安排不等于被遗忘"),
    items.length ? el("div", { class: "list" }, items.map((item) => el("article", { class: "list-item" }, [
      el("div", { class: "item-symbol", text: item.inToday ? "今" : "学" }),
      el("div", { class: "item-copy" }, [el("h3", { text: item.title || "未命名知识" }), el("p", { text: item.reason || "等待学习" }), el("div", { class: "item-meta" }, [item.minutes ? badge(`${item.minutes} 分钟`) : null, item.inToday ? badge("今日", "accent") : badge("学习池")])]),
      el("div", { class: "item-actions" }, button("开始学习", { kind: "primary compact", onClick: event => beginStudy(item.noteId, item.inToday ? item.id : undefined, item, event.currentTarget || event.target) })),
    ]))) : emptyState("学习队列为空", "在知识详情中选择“加入学习”，或先处理一份原始资料。", button("浏览知识", { onClick: () => navigate("library") })),
    tour(sectionHeading("最近学习记录", "服务重启后仍可继续已有会话，原始回答和提示使用不会丢失"), "study-history"),
    sessions.length ? el("div", { class: "list" }, sessions.map((session) => {
      const related = asArray(state.bootstrap?.notes).find((note) => note.id === session.noteId);
      return el("article", { class: "list-item" }, [
        el("div", { class: "item-symbol", text: asArray(session.turns).length ? "续" : "读" }),
        el("div", { class: "item-copy" }, [
          el("h3", { text: related?.title || "关联知识已删除或暂不可读" }),
          el("p", { text: session.question || "学习会话" }),
          el("div", { class: "item-meta" }, [badge(`${asArray(session.turns).length} 轮回答`), badge(studyStatusLabel(session.status), stateTone(session.status)), badge(formatDate(session.createdAt, true))]),
        ]),
        el("div", { class: "item-actions" }, button(session.status === "completed" ? "查看记录" : "继续", { kind: "primary compact", disabled: !related, onClick: () => continueStudy(session) })),
      ]);
    })) : emptyState("还没有学习记录", "开始一次学习后，可从这里恢复。"),
  ]);
}

function continueStudy(session) {
  recordTourEvent("study-resume");
  state.currentStudy = session;
  state.studyMaterialVisible = !asArray(session.turns).length && session.status === "reading";
  state.studyTab = "session";
  renderStudy().catch(handleError);
}

async function studySessionPanel() {
  let session = state.currentStudy;
  if (session?.id) {
    try { session = await api.study(session.id); state.currentStudy = session; }
    catch (error) { if (error.status !== 404) throw error; state.currentStudy = null; }
  }
  if (!session) return emptyState("还没有进行中的学习", "从学习队列开始一次回忆与解释。系统会保留你的原始回答。", button("打开学习队列", { kind: "primary", onClick: () => { state.studyTab = "queue"; renderStudy(); } }));
  const turns = asArray(session.turns);
  const latest = turns.at(-1);
  const goalPanel = () => el("div", { class: "notice info" }, [
    el("strong", { text: `本次目标：${Object.hasOwn(learningGoals, session.depth) ? depthLabel(session.depth) + (session.presetCase ? "（预设演示案例）" : "") : session.goal || depthLabel("explain")}` }),
    Object.hasOwn(learningGoals, session.depth) ? el("p", { text: learningGoals[session.depth].description }) : null,
    session.mistakeId ? el("p", { text: "误解专项练习：重点检查此前的遗漏或错误，实际反馈会保留为后续纠正依据。" }) : null,
    session.topicId ? el("p", { text: "本次属于主题学习包，结束后可按顺序继续。" }) : null,
    el("p", { text: "结束练习保存本轮表现；确认个人理解保存你自己的表达。这两项记录分别保留，均不等于永久掌握。" }),
  ]);
  if (state.studyMaterialVisible && !turns.length) {
    return el("div", { class: "page-stack" }, [
      goalPanel(),
      el("section", { class: "panel accent-panel" }, [
        el("p", { class: "eyebrow", text: "先阅读必要材料" }),
        el("h2", { text: "理解内容后，再隐藏原文主动回忆" }),
        el("p", { class: "muted", text: "隐藏后请用自己的语言解释问题、条件和边界。重新查看原文会被记录为使用提示。" }),
      ]),
      el("section", { class: "panel", dataset: { tour: "study-material" } }, [sectionHeading("学习材料", "完整正文，仅在阅读阶段显示"), sourceReadingBody(session.material, '', '这次会话没有可显示的材料。')]),
      evidenceDetails(session.noteId),
      tour(button("隐藏材料，开始回忆", { kind: "primary", onClick: () => { state.studyMaterialVisible = false; recordTourEvent("study-hide"); renderStudy().catch(handleError); } }), "study-hide"),
    ]);
  }
  const awaiting = session.status === "awaiting_feedback" || Boolean(session.pendingJobId);
  const completed = session.status === "completed";
  const answer = el("textarea", { name: "answer", dataset: { tour: "study-answer" }, placeholder: "先不看答案，用自己的语言解释。可以写出不确定处。", rows: 7, disabled: awaiting || completed });
  const hintArea = el("div");
  const hintUsed = { value: false };
  const feedback = latest?.feedback || session.feedback;
  const form = el("form", { class: "page-stack", dataset: { tour: "study-session" } }, [
    goalPanel(),
    completed ? el("div", { class: "notice info" }, [el("strong", { text: "本轮练习已结束" }), el("p", { text: "本轮原答、提示与反馈已保留。可以继续主题中的下一项，或稍后复习。" }),
      session.completion?.reason ? el("p", { text: session.completion.reason }) : null,
      session.completion?.evidence ? el("div", { class: "item-meta" }, [badge(({ correct: "独立完成", needs_practice: "还需练习", with_hints: "借助提示完成", ambiguous: "存在争议" })[session.completion.evidence.assessment] || "已保留本轮记录"), session.completion.evidence.spacedRecall ? badge("跨日保持证据", "good") : null, session.completion.evidence.applicationPractice ? badge("本次应用练习", "good") : null]) : null,
      session.topicId ? button("回到主题，继续下一条", { onClick: () => openTopic({ id: session.topicId }).catch(handleError) }) : button("回到学习队列", { onClick: () => { state.studyTab = "queue"; renderStudy().catch(handleError); } })]) : null,
    el("section", { class: "study-question" }, [
      el("p", { class: "eyebrow", text: ["waiting", "awaiting_feedback"].includes(session.status) ? "回答已保存 · 等待反馈" : "主动回忆" }),
      el("h2", { text: session.question || "请用自己的语言解释这项知识。" }),
    ]),
    awaiting ? el("div", { class: "notice info" }, [el("strong", { text: "回答已保存，正在等待反馈" }), el("p", { text: "请勿重复提交。模型不可用时，原回答仍会保留，你也可以直接整理并确认自己的理解。" }), button("刷新反馈", { onClick: () => renderStudy().catch(handleError) })]) : null,
    feedback ? tour(renderFeedback(feedback, "针对上一轮的反馈"), "study-feedback") : null,
    field("你的回答", answer, "措辞不必像标准答案；系统关注概念、条件、机制和应用。"),
    hintArea,
    el("div", { class: "form-actions" }, [
      button("提交回答", { kind: "primary", type: "submit", disabled: awaiting || completed }),
      tour(button("分级提示", { onClick: async () => {
        try {
          const result = await api.hint(session.id);
          hintUsed.value = true;
          clear(hintArea).append(el("div", { class: "notice info", text: result.hint || "当前没有可用提示" }));
        } catch (error) { handleError(error); }
      }, disabled: awaiting || completed }), "study-hint"),
      button("查看原文（记为提示）", { disabled: awaiting || completed, onClick: async () => {
        if (!session.noteId) return;
        try {
          await api.hint(session.id);
          hintUsed.value = true;
          openNote(session.noteId);
        } catch (error) { handleError(error); }
      } }),
      tour(button("结束本轮练习", { kind: "primary", disabled: completed || awaiting || session.status !== "feedback" || !latest?.feedback, onClick: async () => {
        try { state.currentStudy = await api.finishStudy(session.id); toast("本轮练习已结束，表现已保留", "success"); await refreshBootstrap(); await renderStudy(); }
        catch (error) { handleError(error); }
      } }), "study-finish"),
    ]),
  ]);
  protectUnsavedInput(form, () => answer.value, "回答");
  form.dataset.sessionId = session.id;
  form.readAnswerDraft = () => ({ answer: answer.value, hintUsed: hintUsed.value });
  form.restoreAnswerDraft = draft => { answer.value = draft.answer; hintUsed.value = draft.hintUsed; };
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (awaiting || completed) return;
    if (!answer.value.trim()) { toast("请先写下你的理解", "error"); return; }
    const submit = form.querySelector("button[type='submit']");
    submit.disabled = true;
    try {
      state.currentStudy = await api.answer(session.id, { answer: answer.value.trim(), hintUsed: hintUsed.value, requestId: crypto.randomUUID() });
      answer.value = "";
      toast(state.currentStudy.pendingJobId ? "回答已保存，反馈任务正在处理" : "回答已保存", "success");
      await renderStudy();
    } catch (error) { handleError(error); }
    finally { submit.disabled = false; }
  });
  if (turns.length) form.append(el("section", { class: "panel" }, [
    sectionHeading("确认自己的理解", "无需等待 AI 判定；你的原始回答会继续保留"),
    el("p", { class: "muted", text: feedback ? "可参考反馈修改，但最终文字必须由你确认。" : "当前没有 AI 反馈，你仍可基于自己的回答整理个人理解。" }),
    tour(button("整理并确认个人理解", { kind: "primary", onClick: () => confirmUnderstanding(session) }), "study-confirm"),
  ]));
  if (completed) form.append(evidenceDetails(session.noteId));
  if (turns.length) form.append(el("section", {}, [sectionHeading("学习记录", `${turns.length} 轮回答`), el("div", { class: "step-list" }, turns.map((turn, index) => el("div", { class: "step is-done" }, [
    el("h3", { text: `第 ${index + 1} 轮 · ${formatDate(turn.createdAt, true)}` }),
    el("p", { text: turn.question || "问题" }),
    el("div", { class: "prose", text: turn.answer || "" }),
    turn.hintUsed ? badge("使用过提示", "warn") : badge("独立作答", "good"),
    turn.feedback ? renderFeedback(turn.feedback, "本轮反馈") : null,
  ])))]));
  return form;
}

function studyStatusLabel(status) {
  return ({ reading: "阅读材料", awaiting_feedback: "等待反馈", feedback: "可继续追问", completed: "已完成" })[status] || labels.state(status);
}

function renderFeedback(feedback, title) {
  if (typeof feedback === "string") return el("section", { class: "feedback" }, [el("strong", { text: title }), el("div", { class: "prose", text: feedback })]);
  const data = asObject(feedback);
  const assessment = ({ correct: "理解基本正确", partial: "部分理解", incorrect: "存在关键错误", ambiguous: "题目或结论有争议" })[data.assessment] || "反馈";
  const tone = data.assessment === "correct" ? "good" : data.assessment === "incorrect" ? "danger" : "warn";
  return el("section", { class: "feedback" }, [
    el("div", { class: "card-head" }, [el("strong", { text: title }), badge(assessment, tone)]),
    data.feedback ? el("div", {}, [el("h3", { text: "具体反馈" }), el("div", { class: "prose", text: data.feedback })]) : null,
    data.omission ? el("div", {}, [el("h3", { text: "遗漏或误解" }), el("div", { class: "prose", text: data.omission })]) : null,
    data.correction ? el("div", {}, [el("h3", { text: "修正与依据" }), el("div", { class: "prose", text: data.correction })]) : null,
    data.nextQuestion ? el("div", { class: "notice info", text: `下一步追问：${data.nextQuestion}` }) : null,
    data.suggestion ? el("details", {}, [el("summary", { text: "查看可修改的理解草稿" }), el("div", { class: "prose", text: data.suggestion })]) : null,
  ]);
}

function confirmUnderstanding(session) {
  refs.drawerBody.dataset.tour = "note-confirm";
  refs.drawerBody.dataset.tourSubject = session.id;
  refs.drawerBody.dataset.tourMode = "study";
  const latest = asArray(session.turns).at(-1);
  const form = el("form", { class: "page-stack" });
  const body = el("textarea", { rows: 16, textContent: latest?.answer || "", placeholder: "这是你的个人理解。你可以参考反馈，但请亲自确认最终文字。" });
  let submitting = false, confirmed = false;
  const submit = button("确认写入", { kind: "primary", type: "submit" });
  form.append(el("div", { class: "notice", text: "只有点击确认后，这段文字才会作为个人理解写入知识层。" }), field("个人理解", body), el("div", { class: "form-actions" }, [submit, button("暂不确认", { onClick: closeDrawer })]));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting || confirmed) return;
    submitting = true; submit.disabled = true;
    try {
      const note = await api.confirmStudy(session.id, { body: body.value });
      confirmed = true;
      toast("个人理解已由你确认并保存", "success");
      closeDrawer();
      if (note?.id) openNote(note.id);
    } catch (error) { handleError(error); }
    finally { submitting = false; if (!confirmed) submit.disabled = false; }
  });
  openDrawer("确认个人理解", "学习收尾", form);
}

async function mistakesPanel() {
  const data = await api.mistakes();
  const mistakes = asArray(data.mistakes);
  return el("section", { dataset: { tour: "study-mistakes" } }, [
    sectionHeading("错题库", "记录具体误解、修正依据和纠正情况，不把错误答案当普通知识"),
    mistakes.length ? el("div", { class: "list" }, mistakes.map((mistake) => mistakeRow(mistake))) : emptyState("还没有错误记录", "学习中的具体遗漏或应用错误会在这里留下可质疑、可撤销的记录。"),
  ]);
}

function mistakeRow(mistake) {
  const meta = asObject(mistake.meta);
  const status = mistake.status || meta.correctionState || meta.status || "open";
  const actions = el("div", { class: "item-actions wrap" }, [
    button("查看", { kind: "quiet compact", onClick: () => { recordTourEvent("mistake-open"); return mistake.noteId || mistake.kind ? openNote(mistake.noteId || mistake.id) : showMistake(mistake); } }),
    status === "open" ? button("专项练习", { kind: "primary compact", disabled: !(meta.noteId || mistake.noteId), onClick: event => beginStudy(meta.noteId || mistake.noteId, undefined, { mistakeId: mistake.id }, event.currentTarget || event.target) }) : null,
    status === "disputed" ? button("重新打开", { kind: "text compact", onClick: () => actMistake(mistake.id, "reopen") }) : status !== "revoked" ? button("质疑判定", { kind: "text compact", onClick: () => actMistake(mistake.id, "dispute") }) : null,
    status !== "resolved" && status !== "revoked" ? button("手动标记已纠正", { kind: "primary compact", onClick: () => actMistake(mistake.id, "resolve") }) : status === "resolved" ? badge("已标记纠正", "good") : null,
    status !== "revoked" ? button("撤销记录", { kind: "text compact", onClick: () => actMistake(mistake.id, "revoke") }) : badge("已撤销"),
  ]);
  return el("article", { class: "list-item" }, [
    el("div", { class: "item-symbol", text: "错" }),
    el("div", { class: "item-copy" }, [el("h3", { text: mistake.title || mistake.question || "未命名错误记录" }), el("p", { text: truncate(mistake.error || mistake.body || mistake.feedback, 160) || "等待补充错误说明" }), el("div", { class: "item-meta" }, [badge(labels.state(status), stateTone(status)), meta.category ? badge(meta.category) : null])]),
    actions,
  ]);
}

function showMistake(mistake) {
  openDrawer(mistake.title || "错误记录", "错题详情", el("div", { class: "page-stack" }, [
    el("section", {}, [el("h3", { text: "当时的问题" }), el("div", { class: "prose", text: mistake.question || "未记录" })]),
    el("section", {}, [el("h3", { text: "实际回答" }), el("div", { class: "prose", text: mistake.answer || "未记录" })]),
    el("section", {}, [el("h3", { text: "错误或遗漏" }), el("div", { class: "prose", text: mistake.error || mistake.feedback || "未记录" })]),
    el("section", {}, [el("h3", { text: "修正与依据" }), el("div", { class: "prose", text: mistake.correction || "未记录" })]),
  ]));
}

async function actMistake(id, action) {
  const needsReason = ["dispute", "revoke"].includes(action);
  const reason = needsReason ? await promptAction({ title: action === "dispute" ? "质疑这项判定" : "撤销这项记录", message: "说明会与原回答和修正记录一起保留。", label: "原因", initialValue: "判定需要进一步核对", submitText: "提交", required: true }) : "";
  if (needsReason && reason === null) return;
  try {
    await api.mistakeAction(id, { action, ...(reason ? { reason } : {}) });
    toast("错误记录已更新", "success");
    if (state.studyTab === "mistakes") await renderStudy();
  } catch (error) { handleError(error); }
}

async function renderTopics() {
  const data = await api.topics();
  const topics = asArray(data.topics);
  const create = button("新建主题学习包", { kind: "primary", onClick: () => createTopicDrawer() });
  const actions = el("div", { class: "item-actions" }, [button("AI 建议学习包", { onClick: suggestTopics }), create]);
  clear(refs.main).append(el("div", { class: "page-stack", dataset: { tour: "topics-list" } }, [
    sectionHeading("主题学习包", "跨日期组织相关内容，也允许零散材料仅供查阅", actions),
    el("div", { class: "notice info", text: "主动生成 AI 建议时使用所需材料，并以“AI 整理建议”呈现建议顺序和前置缺口；不会自动创建或确认主题学习包。你可以审阅后用“新建主题学习包”手动采用。" }),
    topics.length ? el("div", { class: "card-grid" }, topics.map(topicCard)) : emptyState("还没有主题学习包", "创建一个真实想解决的问题，再选择涉及的知识和前置内容。", create.cloneNode(true)),
  ]));
  if (!topics.length) refs.main.querySelector(".empty-state button")?.addEventListener("click", createTopicDrawer);
}

async function suggestTopics() {
  try {
    const job = await api.suggestTopics();
    toast(`学习包建议任务已${labels.state(job.state)}`, "success");
    await refreshBootstrap();
  } catch (error) { handleError(error); }
}

const topicManagedBlock = body => String(body || '').match(/<!-- zhixu-managed-links:start -->[\s\S]*?<!-- zhixu-managed-links:end -->/)?.[0] || '';
const topicDescription = body => String(body || '').replace(topicManagedBlock(body), '').trim();
const readableBody = body => topicDescription(body).replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2');
function topicCard(topic) {
  const meta = asObject(topic.meta);
  const noteIds = asArray(topic.noteIds || meta.noteIds);
  const paused = topic.status === "paused" || meta.status === "paused" || meta.paused === true || topic.paused === true;
  return el("article", { class: "card" }, [
    el("div", { class: "card-head" }, [badge(paused ? "已暂停" : "进行中", paused ? "neutral" : "accent"), badge(`${noteIds.length} 条知识`)]),
    el("h3", { text: topic.title || "未命名学习包" }),
    el("p", { text: truncate(readableBody(topic.body), 150) || "还没有写下这个主题要解决的问题。" }),
    el("div", { class: "card-foot" }, [el("span", { text: `${number(topic.minutes || meta.minutes || 20)} 分钟` }), el("div", { class: "item-actions" }, [button("查看", { kind: "text", onClick: () => openTopic(topic) }), button(paused ? "恢复" : "暂停", { kind: "text", onClick: () => actTopic(topic.id, paused ? "resume" : "pause") })])]),
  ]);
}

async function createTopicDrawer(seed = null) {
  return topicEditor(seed?.id ? seed : null, true);
}

async function openTopic(topic) {
  refs.drawerBody.dataset.tour = "topic-detail";
  try {
    const data = await api.topics();
    topic = asArray(data.topics).find(item => item.id === topic.id);
    if (!topic) { toast("主题学习包已删除或暂不可读", "error"); return; }
    recordTourEvent("topic-open");
    const meta = asObject(topic.meta), progress = asObject(topic.progress);
    const prerequisites = topic.prerequisites ?? meta.prerequisites;
    const members = asArray(topic.members);
    const paused = topic.paused === true || meta.paused === true;
    openDrawer(topic.title || "主题学习包", "主题学习包", el("div", { class: "page-stack" }, [
      el("div", { class: "prose", text: readableBody(topic.body) || "暂无说明" }),
      el("dl", { class: "key-values" }, [
        el("div", { class: "key-value" }, [el("dt", { text: "预计投入" }), el("dd", { text: `${number(topic.minutes || meta.minutes || 20)} 分钟` })]),
        el("div", { class: "key-value" }, [el("dt", { text: "前置知识" }), el("dd", { text: Array.isArray(prerequisites) ? prerequisites.join("、") || "未标记缺口" : prerequisites || "未标记缺口" })]),
        el("div", { class: "key-value" }, [el("dt", { text: "本包进度" }), el("dd", { text: `${number(progress.completedCount)} / ${number(progress.total || members.length)} 条已有练习结束或理解确认记录` })]),
      ]),
      el("div", { class: "notice info", text: "按下面的顺序学习。下方成员列表为当前顺序，说明原文可自行编辑。进度表示已有学习记录，不代表永久掌握；文本前置缺口仍需补充材料。" }),
      progress.blockedNoteId ? el("div", { class: "notice" }, [el("p", { text: "下一项知识或前置内容暂不可学习，请先查看其研究限制或状态。" }), button("查看待处理知识", { kind: "text", onClick: () => openNote(progress.blockedNoteId) })]) : null,
      button(progress.nextNoteId ? `开始下一条：${progress.nextNoteTitle || "前置知识"}` : "本包暂无待继续内容", { kind: "primary", disabled: paused || !progress.nextNoteId, onClick: event => beginStudy(progress.nextNoteId, undefined, { topicId: topic.id }, event.currentTarget || event.target) }),
      el("ol", { class: "list" }, members.map((member, index) => el("li", { class: "list-item" }, [
        el("div", { class: "item-symbol", text: String(index + 1) }),
        el("div", { class: "item-copy" }, [el("h3", { text: member.title || "知识暂不可读" }), el("div", { class: "item-meta" }, [badge(depthLabel(member.depth || "explain")), badge(member.completed ? "已有学习记录" : member.available ? "待学习" : "暂不可学习", member.completed ? "good" : "neutral")])]),
        el("div", { class: "item-actions wrap" }, [button("查看", { kind: "text compact", onClick: () => openNote(member.id) }), button("开始", { kind: "quiet compact", disabled: paused || !member.available, onClick: event => beginStudy(member.id, undefined, { topicId: topic.id }, event.currentTarget || event.target) })]),
      ]))),
      el("div", { class: "form-actions" }, [button("调整成员与顺序", { kind: "primary", onClick: () => editTopic(topic).catch(handleError) }), button("复制或拆分为新学习包", { onClick: () => createTopicDrawer(topic).catch(handleError) }), button(paused ? "恢复" : "暂停", { onClick: () => actTopic(topic.id, paused ? "resume" : "pause") })]),
    ]));
  } catch (error) { handleError(error); }
}

function editTopic(topic) { return topicEditor(topic, false); }

async function topicEditor(topic, create) {
  const noteData = await api.notes({ kind: "knowledge" });
  const notes = asArray(noteData.notes).filter(note => note.kind === "knowledge" && !isExcerptOnly(note));
  const meta = asObject(topic?.meta);
  const selected = [...new Set(asArray(topic?.noteIds || meta.noteIds))];
  const form = el("form", { class: "page-stack" });
  const title = el("input", { name: "title", value: topic ? `${topic.title}${create ? "（副本）" : ""}` : "", required: true });
  const body = el("textarea", { name: "body", textContent: topicDescription(topic?.body), rows: 7, required: true });
  const minutes = el("input", { name: "minutes", type: "number", min: 5, max: 300, value: topic?.minutes || meta.minutes || 20 });
  const originalPrerequisites = topic?.prerequisites ?? meta.prerequisites ?? [];
  const prerequisiteText = Array.isArray(originalPrerequisites) ? originalPrerequisites.join("，") : String(originalPrerequisites);
  const prerequisites = el("input", { name: "prerequisites", value: prerequisiteText });
  const order = el("div", { class: "list" });
  const available = el("div", { class: "list" });
  const query = el("input", { type: "search", placeholder: "筛选可添加的知识", ariaLabel: "筛选可添加的知识" });
  const move = (index, offset) => { const next = index + offset; if (next < 0 || next >= selected.length) return; [selected[index], selected[next]] = [selected[next], selected[index]]; renderMembers(); };
  function renderMembers() {
    clear(order).append(...selected.map((id, index) => {
      const note = notes.find(item => item.id === id);
      return el("div", { class: "list-item no-icon" }, [el("div", { class: "item-copy" }, [el("strong", { text: `${index + 1}. ${note?.title || "知识暂不可读"}` })]), el("div", { class: "item-actions wrap" }, [
        button("上移", { kind: "quiet compact", disabled: index === 0, onClick: () => move(index, -1), title: `上移 ${note?.title || id}` }),
        button("下移", { kind: "quiet compact", disabled: index === selected.length - 1, onClick: () => move(index, 1), title: `下移 ${note?.title || id}` }),
        button("移出本包", { kind: "text compact", onClick: () => { selected.splice(index, 1); renderMembers(); } }),
      ])]);
    }));
    if (!selected.length) order.append(el("p", { class: "muted", text: "尚未选择知识。移出只影响这个学习包，不删除知识。" }));
    const matches = notes.filter(note => !selected.includes(note.id) && note.meta?.stage !== "retired" && `${note.title} ${note.meta?.topic || ""}`.toLowerCase().includes(query.value.toLowerCase()));
    clear(available).append(...matches.slice(0, 50).map(note => el("div", { class: "list-item no-icon" }, [el("div", { class: "item-copy" }, [el("strong", { text: note.title }), el("p", { text: labels.stage(note.meta?.stage) })]), button("加入本包", { kind: "quiet compact", onClick: () => { selected.push(note.id); renderMembers(); } })])));
    if (matches.length > 50) available.append(el("p", { class: "fine-print", text: `另有 ${matches.length - 50} 条，请输入标题或主题缩小范围。` }));
  }
  query.addEventListener("input", renderMembers);
  form.append(el("div", { class: "notice", text: create && topic ? "这是新学习包的副本。选择要保留的成员并调整顺序后保存，原包保持不变；可用于拆分主题。" : "学习顺序由你调整。成员变化不会删除原知识；保存时检查是否有外部修改。" }), field("学习包标题", title), field("问题、顺序与边界", body), el("div", { class: "form-grid" }, [field("预计投入（分钟）", minutes), field("前置知识", prerequisites, "可以继续保留现有文本缺口；逗号分隔新条目")]), sectionHeading("学习顺序", "上移、下移只调整本包中的顺序"), order, field("添加已有知识", query), available, el("div", { class: "form-actions" }, [button(create ? "创建主题学习包" : "保存主题学习包", { kind: "primary", type: "submit" }), button("取消", { onClick: () => topic ? openTopic(topic) : closeDrawer() })]));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector("button[type='submit']"); submit.disabled = true;
    const nextPrerequisites = prerequisites.value === prerequisiteText ? originalPrerequisites : prerequisites.value.split(/[,，]/).map(value => value.trim()).filter(Boolean);
    try {
      const values = { minutes: number(minutes.value), prerequisites: nextPrerequisites, noteIds: [...selected] };
      const updated = create ? await api.createTopic({ title: title.value, body: body.value, ...values }) : await api.updateTopic(topic.id, { title: title.value, body: body.value + (topicManagedBlock(topic.body) ? "\n\n" + topicManagedBlock(topic.body) : ""), expectedHash: topic.hash, meta: values });
      if (create && topic) {
        recordTourEvent("topic-copy");
        if (selected.length < asArray(topic.noteIds || topic.meta?.noteIds).length) recordTourEvent("topic-split");
      }
      toast(create ? "主题学习包已创建" : "主题成员与顺序已保存", "success");
      await refreshBootstrap(); await renderTopics(); await openTopic(updated);
    } catch (error) { handleError(error); }
    finally { submit.disabled = false; }
  });
  renderMembers();
  refs.drawerBody.dataset.tour = "topic-editor";
  refs.drawerBody.dataset.tourSubject = topic?.id || "";
  refs.drawerBody.dataset.tourMode = create ? "create" : "edit";
  openDrawer(create ? "新建主题学习包" : "调整主题学习包", "主题学习包", form);
}

async function actTopic(id, action) {
  try { await api.topicAction(id, { action }); toast(action === "pause" ? "主题学习包已暂停" : "主题学习包已恢复", "success"); await renderTopics(); }
  catch (error) { handleError(error); }
}

async function renderDiscover() {
  const sourceData = await api.notes({ kind: "source" });
  const sources = asArray(sourceData.notes);
  const wrapper = el("div", { class: "page-stack" });
  const form = el("form", { class: "panel", dataset: { tour: "discover-search" } });
  const query = el("input", { name: "q", value: state.searchFilters.q, placeholder: "输入术语、问题或不同说法", required: true });
  const allowCloudQuery = el("input", { type: "checkbox", checked: state.searchFilters.privacy === "cloud" });
  const searchMode = selectControl([["keyword", "关键词"], ["semantic", "语义"], ["hybrid", "混合"]], state.searchFilters.mode, "mode");
  searchMode.setAttribute("aria-label", "检索方式");
  const syncSearchMode = () => {
    for (const option of searchMode.options) option.disabled = option.value !== "keyword" && !allowCloudQuery.checked;
    if (!allowCloudQuery.checked) {
      searchMode.value = "keyword";
      state.searchFilters.mode = "keyword";
      state.searchFilters.privacy = "local";
    }
  };
  allowCloudQuery.addEventListener("change", syncSearchMode);
  syncSearchMode();
  form.append(sectionHeading("检索知识库", "关键词适合精确术语，语义检索适合不同措辞，混合检索结合两者"), el("div", { class: "filter-bar" }, [
    el("div", { class: "search-input" }, query),
    searchMode,
    selectControl([["", "内容类别"], ["source", "原始资料"], ["knowledge", "知识"], ["mistake", "错题"], ["topic", "主题学习包"], ["report", "AI 整理建议"]], state.searchFilters.kind, "kind"),
    selectControl([["", "学习状态"], ["reference", "仅供查阅"], ["candidate", "待选学"], ["learning", "正在学习"], ["integrated", "已整理个人理解"], ["core", "重点知识"], ["retired", "不再使用"]], state.searchFilters.stage, "stage"),
    button("搜索", { kind: "primary", type: "submit" }),
  ]), el("label", { class: "check-field" }, [allowCloudQuery, el("span", { text: "允许将本次查询发给已配置的外部服务" })]), el("p", { class: "fine-print", text: "默认关闭：只运行本地关键词检索。开启后，本次查询可用于语义检索；仅在主动操作中发送所需材料，不因保存资料自动建外部索引。" }), el("details", {}, [el("summary", { text: "按来源、主题与时间进一步筛选" }), el("div", { class: "form-grid" }, [
    field("来源", selectControl([["", "全部来源"], ...sources.map((source) => [source.id, source.title || source.id])], state.searchFilters.source, "source")),
    field("知识主题", el("input", { name: "topic", value: state.searchFilters.topic, placeholder: "精确主题名称" })),
    field("起始日期", el("input", { name: "from", type: "date", value: state.searchFilters.from })),
    field("结束日期", el("input", { name: "to", type: "date", value: state.searchFilters.to })),
  ])]));
  const resultArea = el("section", { dataset: { tour: "discover-results" } });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    syncSearchMode();
    state.searchFilters = { ...state.searchFilters, ...serializeForm(form), privacy: allowCloudQuery.checked ? "cloud" : "local" };
    if (Object.values(serializeForm(form)).filter(Boolean).length > 2) recordTourEvent("search-filter");
    await runSearch(resultArea);
  });
  wrapper.append(form, resultArea);
  const relationsPanel = await renderRelationsPanel();
  wrapper.append(relationsPanel);
  clear(refs.main).append(wrapper);
  if (state.searchFilters.q) await runSearch(resultArea);
  else resultArea.append(emptyState("输入一次真实查询", "没有命中时会明确显示空结果，不补写知识库中不存在的内容。"));
}

async function runSearch(container, paging = {}) {
  if (paging.button?.disabled || paging.sequence && paging.sequence !== searchRenderSequence) return;
  const sequence = paging.sequence || ++searchRenderSequence, context = api.getContext(), view = state.view;
  const filters = { ...state.searchFilters }, started = Date.now();
  const current = () => { const latest = api.getContext(); return sequence === searchRenderSequence && latest.version === context.version && latest.practiceId === context.practiceId && state.view === view; };
  container.dataset.tour = "discover-results";
  if (!paging.cursor) clear(container).append(el("div", { class: "loading-panel" }, [el("span", { class: "spinner" }), el("p", { text: "正在检索本地索引…" })]));
  paging.button && (paging.button.disabled = true);
  try {
    const data = await api.search({ ...filters, ...(paging.cursor ? { cursor: paging.cursor } : {}) });
    if (!current()) return;
    const results = asArray(data.results);
    const diagnostics = asObject(data.diagnostics);
    const rows = paging.rows || el("div", { class: "list" });
    rows.append(...results.map(searchResultRow));
    container.querySelector('[data-tour="search-error"]')?.remove();
    if (!paging.cursor) clear(container).append(sectionHeading("检索结果", results.length ? `找到 ${data.total ?? results.length} 条候选，排序方式来自实际索引` : "没有找到匹配材料"), results.length ? rows : emptyState("没有命中", "可以尝试切换检索方式、减少筛选，或先补充相关资料。"));
    container.querySelector('[data-tour="search-more"]')?.remove();
    if (data.nextCursor) {
      const more = button('加载下一页', { onClick: () => runSearch(container, { cursor: data.nextCursor, sequence, rows, button: more }) });
      more.dataset.tour = 'search-more'; container.append(more);
    }
    container.querySelector('[data-tour="search-diagnostics"]')?.remove();
    diagnostics.clientToDomMs = Date.now()-started;
    container.append(el("details", { class: "panel soft", dataset: { tour: 'search-diagnostics' } }, [el("summary", { text: "查看这次检索怎样工作" }), el("pre", { class: "mono-block", text: JSON.stringify(diagnostics, null, 2) })]));
  } catch (error) {
    if (!current()) return;
    if (!paging.cursor) clear(container);
    container.querySelector('[data-tour="search-error"]')?.remove();
    const errorPanel = emptyState("检索暂时失败", errorMessage(error), button("重新检索", { onClick: () => runSearch(container) }));
    errorPanel.dataset.tour = 'search-error'; container.append(errorPanel);
  } finally {
    if (paging.button) paging.button.disabled = false;
  }
}

function searchResultRow(result) {
  const note = result.note || result;
  const reasons = result.reasons || result.reason || result.snippet;
  return el("article", { class: "list-item" }, [
    el("div", { class: "item-symbol", text: note.kind === "source" ? "源" : note.kind === "mistake" ? "错" : "知" }),
    el("div", { class: "item-copy" }, [
      el("h3", { text: note.title || "未命名" }),
      result.snippet ? el('p', { text: result.snippet }) : note.kind === 'source' ? sourceReadingBody(sourceBodyPreview(result.excerpt || note.body), 'markdown-preview', '暂无摘要') : el("p", { text: truncate(readableBody(result.excerpt || note.body), 180) || "暂无摘要" }),
      reasons && reasons !== result.snippet ? el("p", { text: Array.isArray(reasons) ? reasons.join(" · ") : String(reasons) }) : null,
      result.location ? el('p', { class: 'fine-print', text: result.location.field === 'title' ? '命中标题' : `${result.location.heading ? result.location.heading+' · ' : ''}正文第 ${result.location.line} 行${result.location.type === 'semantic' ? ' · 语义片段' : ''}` }) : null,
      el("div", { class: "item-meta" }, [badge(labels.kind(note.kind)), note.meta?.stage ? badge(labels.stage(note.meta.stage), stateTone(note.meta.stage)) : null, result.score !== undefined ? badge(`相关度 ${Number(result.score).toFixed(2)}`) : null]),
    ]),
    el("div", { class: "item-actions" }, button("打开", { kind: "quiet compact", onClick: () => openNote(note.id || result.noteId, result) })),
  ]);
}

async function renderRelationsPanel() {
  const data = await api.relations();
  const relations = asArray(data.relations);
  const candidates = asArray(data.candidates);
  const reports = asArray(data.reports);
  const allowAI = el("input", { type: "checkbox", checked: false });
  const panel = el("section", { dataset: { tour: "discover-relations" } }, [
    sectionHeading("关系发现", "分别保留探索候选和有依据的联系，每次最多确认 3 条", button("运行发现检查", { kind: "primary", onClick: async () => {
      try { const job = await api.discover({ useAI: allowAI.checked }); toast(`发现任务已${labels.state(job.state)}`, "success"); await refreshBootstrap(); }
      catch (error) { handleError(error); }
    } })),
    el("label", { class: "check-field" }, [allowAI, el("span", { text: "本次允许 AI 跨领域探索（发送获准材料，可能产生费用）" })]),
    el("p", { class: "fine-print", text: "默认只做本地结构检查；自动定期检查也仅在本地运行。" }),
  ]);
  if (!relations.length && !reports.length && !candidates.length) {
    panel.append(emptyState("暂时没有值得确认的新联系", "普通文字相似不需要逐条确认。"));
    return panel;
  }
  const pending = relations.filter(r => r.state === "suggested");
  const accepted = relations.filter(r => r.state === "accepted");
  if (candidates.length) panel.append(sectionHeading("本地探索候选", "仅表示值得比较的材料，还不是稳定联系；打开知识后可选择允许 AI 进一步分析"), el("div", { class: "list" }, candidates.map(relationRow)));
  if (pending.length) panel.append(sectionHeading("值得确认", "请结合具体用途判断是否保留"), el("div", { class: "list" }, pending.map(relationRow)));
  else panel.append(el("p", { class: "muted", text: "暂时没有需要确认的新联系。" }));
  if (accepted.length) panel.append(sectionHeading("已保留的联系", ""), el("div", { class: "list" }, accepted.map(relationRow)));
  if (reports.length) panel.append(sectionHeading("AI 整理建议", "周期检查矛盾、孤立节点和跨主题桥梁"), el("div", { class: "card-grid" }, reports.map((report) => el("article", { class: "card" }, [el("div", { class: "card-head" }, [badge("AI 整理建议", "accent"), badge(formatDate(report.updatedAt))]), el("h3", { text: report.title || "未命名报告" }), el("p", { text: truncate(report.body, 160) }), button("查看", { kind: "text", onClick: () => openNote(report.id) })]))));
  return panel;
}

function relationRow(relation) {
  const stateValue = relation.state || relation.status || "pending";
  return el("article", { class: "list-item" }, [
    el("div", { class: "item-symbol", text: "联" }),
    el("div", { class: "item-copy" }, [
      el("h3", { text: `${relation.fromTitle || "未命名知识"} ↔ ${relation.toTitle || "未命名知识"}` }),
      el("p", { text: relation.reason || relation.explanation || "尚未提供联系说明" }),
      relation.use ? el("p", { text: `用途：${relation.use}` }) : null,
      relation.boundary ? el("p", { text: `边界：${relation.boundary}` }) : null,
      el("div", { class: "item-meta" }, [badge(({similarity:"内容相似",analogy:"机制类比",prerequisite:"前置知识",support:"支持",oppose:"不同观点",example:"实例",counterexample:"反例",application:"应用",correction:"修正"})[relation.type] || "知识联系", "accent"), badge(stateValue === "candidate" ? "可探索，尚未确认" : labels.state(stateValue), stateTone(stateValue))]),
    ]),
    el("div", { class: "item-actions" }, [
      button("查看左侧知识", { kind: "quiet compact", onClick: () => openNote(relation.fromId) }),
      button("查看右侧知识", { kind: "quiet compact", onClick: () => openNote(relation.toId) }),
      ...(["pending", "suggested"].includes(stateValue) ? [button("接受", { kind: "primary compact", onClick: () => actRelation(relation.id, "accept") }), button("拒绝", { kind: "quiet compact", onClick: () => actRelation(relation.id, "reject") })] : []),
      stateValue === "candidate" ? button("忽略候选", { kind: "text compact", onClick: () => actRelation(relation.id, "reject") }) : null,
      stateValue === "accepted" ? button("移除联系", { kind: "danger compact", onClick: () => actRelation(relation.id, "remove") }) : null,
    ]),
  ]);
}

async function actRelation(id, action) {
  const reason = action === "reject" ? await promptAction({ title: "拒绝关系建议", message: "可以说明联系不成立或类比失效的原因，以改善后续建议。", label: "拒绝原因（可选）", placeholder: "例如：只有术语相近，机制并不相同", submitText: "拒绝建议" }) : "";
  if (action === "reject" && reason === null) return;
  try { await api.relationAction(id, { action, ...(reason ? { reason } : {}) }); toast(action === "remove" ? "已移除联系，笔记内容保留" : "关系建议已更新", "success"); await renderDiscover(); }
  catch (error) { handleError(error); }
}

const outputRequests = new Map(), activeOutputRequests = new Set();
const outputRequestKey = context => `zhixu.outputRequest.v1:${context.practiceId || 'formal'}`;
function pendingOutputRequest(context) {
  const key = outputRequestKey(context);
  if (!outputRequests.has(key)) {
    let saved = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (!saved || typeof saved.requestId !== 'string' || !saved.input || typeof saved.input.question !== 'string' || !Array.isArray(saved.input.scope)) saved = null;
    } catch { /* The current page can still retain a submitted intent. */ }
    outputRequests.set(key, saved);
  }
  return outputRequests.get(key);
}
function rememberOutputRequest(context, request) {
  const key = outputRequestKey(context);
  outputRequests.set(key, request);
  try { if (request) sessionStorage.setItem(key, JSON.stringify(request)); else sessionStorage.removeItem(key); }
  catch { if (request) toast('浏览器未能保留重试标识；请保持此页面打开，避免刷新后重复提交。', 'error'); }
}

async function renderOutput() {
  const context = api.getContext(), pending = pendingOutputRequest(context), previous = pending?.input;
  const wrapper = el("div", { class: "page-stack" });
  const form = el("form", { class: "panel", dataset: { tour: "output-form" } });
  const question = el("textarea", { name: "question", rows: 5, required: true, placeholder: "例如：根据我已有的资料，解释 RAG 为什么不能保证答案一定正确。" });
  question.value = previous?.question || '';
  const mode = selectControl([["answer", "回答问题"], ["outline", "组织提纲"], ["draft", "生成草稿"]], previous?.mode || "answer", "mode");
  const sourceScope = el("input", { type: "checkbox", name: "source", checked: previous ? previous.scope.includes('source') : true });
  const knowledgeScope = el("input", { type: "checkbox", name: "knowledge", checked: previous ? previous.scope.includes('knowledge') : true });
  const allowCloudQuestion = el("input", { type: "checkbox", checked: previous?.privacy === 'cloud' });
  form.append(sectionHeading("有依据的问答与输出", "默认优先个人知识，并让你看见实际使用了哪些资料"), field("问题或输出目标", question), el("div", { class: "form-grid" }, [field("输出方式", mode), field("取材范围", el("div", { class: "segmented" }, [el("label", { class: "check-field" }, [knowledgeScope, "知识笔记"]), el("label", { class: "check-field" }, [sourceScope, "原始来源"])]))]), el("label", { class: "check-field" }, [allowCloudQuestion, el("span", { text: "允许将本次问题发给已配置的外部模型" })]), el("p", { class: "fine-print", text: "默认关闭：只在本机检索并列出已有材料。开启后，本次问题与相关材料会发送给模型，资料不需要另设外发分类。" }), el("div", { class: "notice info", text: "找不到、证据冲突或内容过期时，回答应明确说明。问答和草稿不会自动成为个人知识。" }), button("开始生成", { kind: "primary", type: "submit" }));
  const answerArea = el("section", { dataset: { tour: "output-result" } });
  const draftsPanel = await renderDraftsPanel();
  const retryNotice = el('p', { class: 'notice info', dataset: { outputRetry: 'true' }, text: '上次提交尚未取得完成回执。保持输入不变后重试会继续原请求；修改输入会开始新请求，可能产生新的调用。' });
  retryNotice.hidden = !pending;
  form.append(retryNotice);
  if (state.lastOutput) renderAnswer(answerArea, state.lastOutput);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const latest = api.getContext();
    if (latest.version !== context.version || latest.practiceId !== context.practiceId) { toast('知识库已切换，请在当前页面重新提交。', 'info'); return; }
    if (activeOutputRequests.has(outputRequestKey(context))) { toast('这次问答仍在执行，请等待后再重试。', 'info'); return; }
    const scope = [];
    if (knowledgeScope.checked) scope.push("knowledge");
    if (sourceScope.checked) scope.push("source");
    if (!scope.length) { toast("请至少选择一个取材范围", "error"); return; }
    const input = { question: question.value, scope, mode: mode.value, privacy: allowCloudQuestion.checked ? 'cloud' : 'local' };
    const retained = pendingOutputRequest(context);
    const request = retained && JSON.stringify(retained.input) === JSON.stringify(input) ? retained : { requestId: crypto.randomUUID(), input };
    rememberOutputRequest(context, request);
    activeOutputRequests.add(outputRequestKey(context));
    const controls = [question, mode, sourceScope, knowledgeScope, allowCloudQuestion, form.querySelector('[type="submit"]')].filter(Boolean);
    controls.forEach(control => { control.disabled = true; });
    state.lastOutput = null;
    clear(answerArea).append(el("div", { class: "loading-panel" }, [el("span", { class: "spinner" }), el("p", { text: "正在检索并组织已有资料…" })]));
    try {
      const result = await api.ask({ ...input, requestId: request.requestId });
      rememberOutputRequest(context, null);
      retryNotice.hidden = true;
      refs.main.querySelectorAll('[data-output-retry]').forEach(notice => { notice.hidden = true; });
      state.lastOutput = result;
      renderAnswer(answerArea, result);
      try { await refreshDraftsPanel(); }
      catch { toast("结果已保存，但输出工作区暂时未能刷新。", "error"); }
    } catch (error) { retryNotice.hidden = false; clear(answerArea).append(emptyState("本次生成未完成", errorMessage(error), el('div', { class: 'form-actions' }, [
      button("重试原请求", { onClick: () => form.requestSubmit() }),
      button(input.privacy === 'cloud' ? '另起新请求（可能再次计费）' : '另起新请求', { onClick: () => { rememberOutputRequest(context, null); form.requestSubmit(); } }),
    ]))); }
    finally { activeOutputRequests.delete(outputRequestKey(context)); controls.forEach(control => { control.disabled = false; }); }
  });
  wrapper.append(...[capabilityNotice(), form, answerArea, draftsPanel].filter(Boolean));
  clear(refs.main).append(wrapper);
}

function renderAnswer(container, result) {
  container.dataset.tour = "output-result";
  const citations = asArray(result.citations);
  const limitations = [...asArray(result.limitations)];
  if (result.generated !== true && !limitations.includes("未进行 AI 生成。")) limitations.push("未进行 AI 生成。");
  clear(container).append(el("section", { class: "panel" }, [
    sectionHeading(result.generated === true ? "AI 生成结果" : "本地检索结果（未进行 AI 生成）", result.draftId ? "已保存到输出工作区，可继续编辑" : "本次结果尚未成为个人知识"),
    el("div", { class: "prose", text: result.answer || "没有生成可用内容" }),
    limitations.length ? el("div", { class: "notice", text: `限制：${limitations.join("；")}` }) : null,
    citations.length ? el("div", {}, [sectionHeading("实际引用", "关键主张应能回到笔记与底层来源"), el("div", { class: "list" }, citations.map((citation) => el("div", { class: "citation" }, [el("strong", { text: citation.title || citation.noteId || citation.id || "引用材料" }), citation.excerpt ? el("p", { text: citation.excerpt }) : null, citation.locator ? el("p", { text: `定位：${citation.locator}` }) : null, citation.noteId || citation.id ? button("打开材料", { kind: "text", onClick: () => openNote(citation.noteId || citation.id) }) : null, evidenceDetails(citation.noteId || citation.id, asArray(citation.sources))])))]) : el("div", { class: "notice danger", text: "本次结果没有返回可追溯引用，请不要把它视为有据回答。" }),
  ]));
}

async function renderDraftsPanel() {
  const panel = el("section", { dataset: { tour: "output-drafts" } });
  await refreshDraftsPanel(panel);
  return panel;
}

async function refreshDraftsPanel(panel = null) {
  const data = await api.drafts();
  const target = panel || refs.main.querySelector('[data-tour="output-drafts"]');
  if (!target) return;
  const drafts = asArray(data.drafts);
  clear(target).append(
    sectionHeading("输出工作区", "编辑素材、提纲和草稿；只有主动采集后才回到知识流程"),
    drafts.length ? el("div", { class: "card-grid" }, drafts.map((draft) => el("article", { class: "card" }, [
      el("div", { class: "card-head" }, [badge(draft.mode === "draft" ? "草稿" : draft.mode === "outline" ? "提纲" : "回答"), badge(formatDate(draft.updatedAt))]),
      el("h3", { text: draft.title || draft.question || "未命名输出" }),
      el("p", { text: truncate(draft.body || draft.answer, 150) }),
      el("div", { class: "card-foot" }, [el("span", { text: `${asArray(draft.usedIds).length} 条已采用知识` }), button("编辑", { kind: "text", onClick: () => openDraft(draft) })]),
    ]))) : emptyState("还没有输出草稿", "提出一个问题或写作目标后，结果会保留在这里继续编辑。"),
  );
}

function openDraft(draft) {
  refs.drawerBody.dataset.tour = "draft-editor";
  refs.drawerBody.dataset.tourSubject = draft.id;
  const form = el("form", { class: "page-stack" });
  const body = el("textarea", { rows: 19, textContent: draft.body || draft.answer || "" });
  const used = new Set(asArray(draft.usedIds));
  const citations = asArray(draft.citations);
  const chooser = citations.length ? el("div", { class: "list" }, citations.map((citation) => el("label", { class: "list-item no-icon" }, [
    el("div", { class: "item-copy" }, [el("h3", { text: citation.title || citation.id || "引用材料" }), el("p", { text: truncate(citation.excerpt, 120) })]),
    el("input", { type: "checkbox", name: "usedId", value: citation.id, checked: used.has(citation.id) }),
  ]))) : el("div", { class: "notice danger", text: "这份草稿没有可标记的实际引用。" });
  form.append(field("正文", tour(body, "draft-body")), sectionHeading("标记实际采用的知识", "这些反馈会用于知识使用建议，但不会自动证明知识正确。"), tour(chooser, "draft-use"), el("div", { class: "form-actions" }, [button("保存草稿", { kind: "primary", type: "submit" }), tour(button("送回收集箱", { onClick: () => captureDraft(draft, body.value) }), "draft-capture")]));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const usedIds = [...form.querySelectorAll("input[name='usedId']:checked")].map((input) => input.value);
      await api.updateDraft(draft.id, { body: body.value, usedIds });
      state.lastOutput = null;
      toast("草稿已保存", "success");
      closeDrawer();
      await renderOutput();
    } catch (error) { handleError(error); }
  });
  openDrawer(draft.title || "编辑输出", "输出工作区", form);
}

async function captureDraft(draft, body) {
  if (!body.trim()) { toast("空草稿不能送回收集箱", "error"); return; }
  try {
    await api.captureDraft(draft.id, { body, title: draft.title || draft.question || "输出草稿", privacy: "local" });
    toast("已作为原始资料送回收集箱，等待重新加工", "success");
    closeDrawer();
    await refreshBootstrap();
  } catch (error) { handleError(error); }
}

function systemTabButton(value, label) {
  return el("button", { class: `tab${state.systemTab === value ? " is-active" : ""}`, text: label, on: { click: () => { state.systemTab = value; setPage("system"); renderSystem().catch(handleError); } } });
}

async function renderSystem() {
  const wrapper = el("div", { class: "page-stack" });
  wrapper.append(el("div", { class: "tabs" }, [
    systemTabButton("settings", "API 与能力设置"), systemTabButton("usage", "用量与费用"), systemTabButton("appearance", "外观"), systemTabButton("jobs", "任务"), systemTabButton("data", "备份与恢复"),
    systemTabButton("diagnostics", "诊断与 MCP"), systemTabButton("proposals", "写入提案"), systemTabButton("conflicts", "冲突"),
  ]));
  if (state.systemTab === "appearance") wrapper.append(appearancePanel());
  else if (state.systemTab === "usage") {
    const { createUsagePanel } = await import("./usage.mjs");
    wrapper.append(await createUsagePanel({
      load: filters => api.usage(filters), settings: await api.settings(), readOnly: Boolean(api.getContext?.().practiceId),
      save: payload => api.updateUsageSettings(payload),
      loadRecovery: () => api.callRecovery(), recoverCall: (id, payload) => api.recoverCall(id, payload),
    }));
  }
  else if (state.systemTab === "jobs") wrapper.append(await jobsPanel());
  else if (state.systemTab === "data") wrapper.append(dataPanel());
  else if (state.systemTab === "diagnostics") wrapper.append(await diagnosticsPanel());
  else if (state.systemTab === "proposals") wrapper.append(await proposalsPanel());
  else if (state.systemTab === "conflicts") wrapper.append(conflictsPanel());
  else wrapper.append(await settingsPanel());
  clear(refs.main).append(wrapper);
}

function appearancePanel() {
  const appearance = window.zhixuAppearance;
  const saved = appearance.getAccent();
  let selected = saved;
  const initial = saved || "#a8b4ef";
  const picker = el("input",{type:"color",value:initial,"aria-label":"选择强调色"});
  const code = el("input",{value:initial.toUpperCase(),maxLength:7,placeholder:"#A8B4EF",spellcheck:false,"aria-label":"强调色代码"});
  const message = el("p",{class:"fine-print",role:"status",text:saved ? "当前使用自定义强调色。" : "当前使用默认配色：日间青绿，夜间柔和蓝紫。"});
  const preview = el("div",{class:"two-column appearance-previews"});
  const save = button("保存强调色",{kind:"primary",onClick:()=>{
    try { appearance.saveAccent(selected); recordTourEvent("appearance-accent"); message.textContent=selected ? "强调色已保存，刷新后仍然生效。" : "已恢复默认配色。"; toast("外观设置已保存","success"); }
    catch(error) { handleError(error); }
  }});
  function showPreview() {
    clear(preview);
    for (const theme of ["light","dark"]) {
      const sample=el("section",{class:"appearance-sample",dataset:{previewTheme:theme},"aria-label":theme==="dark"?"夜间配色预览":"日间配色预览"});
      for (const [name,value] of Object.entries(appearance.palette(selected,theme))) sample.style.setProperty(name,value);
      sample.append(el("p",{class:"eyebrow",text:theme==="dark"?"夜间模式":"日间模式"}),el("h3",{text:"把注意力留给值得学习的内容"}),el("p",{class:"sample-muted",text:"背景保持中性，强调色用于按钮、链接和选中状态。"}),el("div",{class:"form-actions"},[el("span",{class:"sample-button",text:"开始学习"}),el("span",{class:"sample-selected",text:"已选中"}),el("span",{class:"sample-link",text:"查看笔记"})]));
      preview.append(sample);
    }
  }
  function choose(value) {
    selected=value; picker.value=value; code.value=value.toUpperCase(); code.setCustomValidity(""); save.disabled=false;
    message.textContent="预览已更新，点击保存后应用到整个界面。"; showPreview();
  }
  picker.addEventListener("input",()=>choose(picker.value));
  code.addEventListener("input",()=>{
    const value=code.value.trim();
    if (/^#[0-9a-f]{6}$/i.test(value)) choose(value.toLowerCase());
    else { code.setCustomValidity("请输入 # 开头的六位颜色代码。"); save.disabled=true; message.textContent="请输入完整颜色代码，例如 #A8B4EF。"; }
  });
  const presets=el("div",{class:"form-actions appearance-presets"},[["柔和蓝紫","#a8b4ef"],["雾蓝","#8ab4d8"],["青绿","#83bfb3"],["玫瑰","#d7a3b8"],["暖杏","#d6b58e"]].map(([name,color])=>{
    const item=button(name,{kind:"quiet",onClick:()=>choose(color)});
    item.classList.add("compact");
    const dot=el("span",{class:"accent-swatch","aria-hidden":"true"});dot.style.backgroundColor=color;item.prepend(dot);return item;
  }));
  const reset=button("恢复默认配色",{onClick:()=>{
    try { appearance.saveAccent(null); selected=null; picker.value="#a8b4ef"; code.value="#A8B4EF"; code.setCustomValidity(""); save.disabled=false; message.textContent="已恢复默认配色：日间青绿，夜间柔和蓝紫。"; showPreview(); toast("已恢复默认配色","success"); }
    catch(error) { handleError(error); }
  }});
  showPreview();
  return el("section",{class:"panel page-stack",dataset:{tour:"system-appearance"}},[
    sectionHeading("外观与强调色","切换整个工作台的日夜模式；强调色会同时适配两种模式。"),
    el("div", { class: "form-actions" }, [["日间模式", "light"], ["夜间模式", "dark"]].map(([label, theme]) => button(label, { onClick: () => {
      if (document.documentElement.dataset.theme !== theme) document.querySelector("#theme-toggle")?.click();
      else recordTourEvent("appearance-theme");
    } }))),
    presets,el("div",{class:"form-grid"},[field("取色器",picker),field("颜色代码",code)]),
    preview,message,el("div",{class:"form-actions"},[save,reset]),
    el("p",{class:"fine-print",text:"保存在当前浏览器。为保证可读性，系统会按日夜模式微调颜色亮度；成功、警告和错误仍保留各自的状态色。"}),
  ]);
}

async function settingsPanel() {
  const practice = Boolean(api.getContext?.().practiceId);
  const [settings, promptData] = await Promise.all([api.settings(), api.prompts()]);
  const ai = asObject(settings.ai);
  const embedding = asObject(settings.embedding);
  const search = asObject(settings.search);
  const fetchSettings = asObject(settings.fetch);
  const mcp = asObject(settings.mcp);
  const form = el("form", { class: "page-stack" });
  const notesFolder = field("笔记存储位置", el("input", { name: "vaultDir", value: settings.vaultDir || "", placeholder: "保存笔记的本地文件夹路径" }), "原始资料和知识笔记保存在这个文件夹中，也可用 Obsidian 打开。已有资料时请保持此位置；更换知识库需先备份，再单独创建。");
  notesFolder.classList.add("span-2");
  const general = el("section", { class: "panel", dataset: { tour: "settings-general" } }, [
    sectionHeading("学习计划与笔记存储", "设置每天学多久、何时安排学习，以及笔记保存在哪里。"),
    el("div", { class: "form-grid" }, [
      field("每天计划学习多久（分钟）", el("input", { name: "dailyMinutes", type: "number", min: 5, max: 240, value: settings.dailyMinutes ?? 25 }), "系统按这个时长安排新知识、复习和错题，未排入的内容留待以后。"),
      field("日程时区", el("input", { name: "timezone", value: settings.timezone || "Asia/Shanghai" }), "默认北京时间（Asia/Shanghai，UTC+8），用于学习日程、每日日期和调用次数统计。"),
      field("每天生成学习清单的时间", el("input", { name: "scheduleTime", type: "time", value: settings.scheduleTime || "08:00" }), "例如 08:00：程序运行时，从此时间起自动安排当天学习；电脑关机或休眠时暂停。"),
      field("优先学习的主题（可选）", el("input", { name: "focusTopics", value: asArray(settings.focusTopics).join("，"), placeholder: "例如：英语，结构力学，编程" }), "多个主题用逗号分隔，用于安排学习优先级和组织学习包；留空则按已有资料安排。"),
      notesFolder,
    ]),
  ]);
  for (const item of general.querySelectorAll(".field")) {
    const hint = item.querySelector(".field-hint");
    if (!hint) continue;
    const help = el("span", { class: "field-help-icon", text: "!", tabIndex: 0 });
    help.setAttribute("aria-label", hint.textContent);
    const tooltip = el("span", { class: "field-help-tooltip", role: "tooltip", text: hint.textContent });
    help.append(tooltip);
    const positionTooltip = () => {
      const anchor = help.getBoundingClientRect();
      const box = tooltip.getBoundingClientRect();
      tooltip.style.left = `${Math.max(12, Math.min(anchor.left, window.innerWidth - box.width - 12))}px`;
      tooltip.style.top = `${anchor.bottom + box.height + 10 <= window.innerHeight ? anchor.bottom + 8 : Math.max(8, anchor.top - box.height - 8)}px`;
    };
    help.addEventListener("mouseenter", positionTooltip);
    help.addEventListener("focus", positionTooltip);
    item.querySelector(".field-label").append(help);
    hint.remove();
  }
  let testing = 0, formRevision = 0;
  form.addEventListener("input", () => { formRevision += 1; });
  form.addEventListener("change", () => { formRevision += 1; });
  const testControls = new Map(), capabilityPanels = new Map(), discoveryControls = new Map();
  function testButton(label, capability) {
    const status = el("p", { class: "api-test-status", role: "status", "aria-live": "polite", "aria-atomic": "true", text: "尚未测试当前输入。" });
    const control = button(label, { onClick: () => testCapability(capability) });
    testControls.set(capability, { control, status, label, busy: false });
    return el("div", { class: "api-test-actions" }, [control, status, el("small", { class: "fine-print", text: "使用当前填写内容测试，成功后自动保存本项；会发起真实请求，可能产生费用。" })]);
  }
  function capabilitySnapshot(capability) {
    // Read this card only: disabled controls in a different saving card are irrelevant.
    const value = name => form.querySelector(`[name="${name}"]`)?.value || "";
    return {
      model: () => ({ enabled: aiEnabled.checked, baseUrl: value("aiBaseUrl"), model: value("aiModel"), apiKey: value("aiKey"), timeoutMs: number(value("modelTimeoutSeconds")) * 1000 }),
      embedding: () => ({ enabled: embeddingEnabled.checked, baseUrl: value("embeddingBaseUrl"), model: value("embeddingModel"), apiKey: value("embeddingKey") }),
      search: () => ({ enabled: searchEnabled.checked, baseUrl: value("searchBaseUrl"), apiKey: value("searchKey") }),
      fetch: () => ({ enabled: fetchEnabled.checked }),
    }[capability]();
  }
  function showTestStatus(entry, tone, text) {
    entry.status.className = `api-test-status api-test-${tone}`;
    entry.status.textContent = text;
    entry.status.setAttribute("role", tone === "error" ? "alert" : "status");
  }
  async function testCapability(capability) {
    const entry = testControls.get(capability), panel = capabilityPanels.get(capability);
    if (practice || entry.busy) return;
    const snapshot = capabilitySnapshot(capability), before = JSON.stringify(snapshot);
    if (!snapshot.enabled) { showTestStatus(entry, "error", "请先勾选启用该能力，再测试并保存。"); return; }
    entry.busy = true; testing++; entry.control.disabled = true;
    entry.control.replaceChildren(el("span", { class: "spinner api-test-spinner", "aria-hidden": "true" }), document.createTextNode("正在测试…"));
    entry.control.setAttribute("aria-busy", "true");
    showTestStatus(entry, "pending", "正在测试当前输入，请稍候…");
    const saveButton = form.querySelector('button[type="submit"]');
    if (saveButton) saveButton.disabled = true;
    const locked = [];
    try {
      const result = await testAndSaveCapability({ capability, snapshot,
        test: api.testMainSetting, save: api.saveTestedSetting,
        unchanged: () => form.isConnected && before === JSON.stringify(capabilitySnapshot(capability)),
        saving: active => {
          if (active) {
            discoveryControls.get(capability)?.invalidate();
            showTestStatus(entry, "pending", "连接测试成功，正在自动保存本项…");
            entry.control.lastChild.textContent = "正在保存…";
            for (const control of panel.querySelectorAll("input, select, textarea, button")) if (!control.disabled) { locked.push(control); control.disabled = true; }
          } else locked.forEach(control => { control.disabled = false; });
        },
      });
      if (result.saved) {
        const key = form.querySelector(`[name="${capability === "model" ? "ai" : capability}Key"]`);
        if (key) { key.value = ""; key.placeholder = "已保存；留空保持不变"; }
        discoveryControls.get(capability)?.invalidate();
        const savedFingerprint = JSON.stringify(capabilitySnapshot(capability));
        let warning = result.warning;
        try { await refreshBootstrap(); }
        catch { warning = warning || "本项配置已保存，但页面状态未能刷新；请稍后刷新页面，无需重复测试。"; }
        if (savedFingerprint !== JSON.stringify(capabilitySnapshot(capability))) warning = "刚才测试的配置已保存；当前输入随后有修改，尚未测试保存。";
        showTestStatus(entry, warning ? "warning" : "success", warning || "连接测试成功，本项配置已自动保存。其他卡片输入保持不变。");
        toast(warning || "连接测试成功，本项配置已自动保存；其他设置未保存。", warning ? "info" : "success");
      } else {
        showTestStatus(entry, "warning", "测试成功，但本项输入已修改或页面已离开，未保存。请测试当前输入。");
        toast("连接测试成功，但测试期间表单有修改；输入已保留，请重新测试后保存。", "info");
      }
    } catch (error) {
      showTestStatus(entry, "error", error.code === "SAVE_UNCONFIRMED" ? error.message : "连接测试失败，未保存本项。请核对服务地址、密钥、模型及预算后重试；当前输入已保留。");
    } finally {
      entry.busy = false; testing--; entry.control.disabled = false; entry.control.textContent = entry.label;
      entry.control.setAttribute("aria-busy", "false");
      if (saveButton) saveButton.disabled = testing > 0;
    }
  }
  const aiEnabled = el("input", { name: "aiEnabled", type: "checkbox", checked: Boolean(ai.enabled) });
  const modelPanel = el("section", { class: "panel" }, [sectionHeading("文本生成", "OpenAI-compatible 接口；密钥只写入，不会回显", testButton("测试连接", "model")), el("label", { class: "check-field" }, [aiEnabled, "启用文本生成能力"]), el("div", { class: "form-grid" }, [field("服务地址", el("input", { name: "aiBaseUrl", value: ai.baseUrl || "", placeholder: "https://…" })), field("模型", el("input", { name: "aiModel", value: ai.model || "", placeholder: "模型名称" })), field("API 密钥", el("input", { name: "aiKey", type: "password", placeholder: ai.hasKey ? "已保存；留空保持不变" : "输入密钥" }))])]);
  modelPanel.append(el("div", { class: "usage-settings-link" }, [el("span", { text: "Token 统计、请求上限和月预算已集中到用量与费用。" }), button("查看用量与费用", { onClick: () => { state.systemTab = "usage"; setPage("system"); renderSystem().catch(handleError); } })]));
  modelPanel.append(el("div", { class: "notice info", text: `每份原始资料的单次拆解默认最多使用 ${number(ai.sourceCallLimit ?? 120)} 次外部请求。达到系统每日总上限时，任务会显示“已保存，待继续”，不会把等待误报为完成。` }));
  modelPanel.append(field("模型最长等待时间（秒）", el("input", {name:"modelTimeoutSeconds",type:"number",min:1,max:600,value:(ai.timeoutMs ?? 180000)/1000}), "整理长资料通常比连接测试慢。默认等待 180 秒；失败不自动重发，避免重复计费。"));
  const embeddingEnabled = el("input", { name: "embeddingEnabled", type: "checkbox", checked: Boolean(embedding.enabled) });
  const searchEnabled = el("input", { name: "searchEnabled", type: "checkbox", checked: Boolean(search.enabled) });
  const fetchEnabled = el("input", { name: "fetchEnabled", type: "checkbox", checked: Boolean(fetchSettings.enabled) });
  const capabilities = el("section", { class: "panel" }, [sectionHeading("独立能力", "语义嵌入使用 OpenAI-compatible；搜索使用 Tavily API；网页读取使用内置公开地址适配器。"), el("div", { class: "three-column" }, [
    el("div", { class: "panel soft" }, [el("label", { class: "check-field" }, [embeddingEnabled, "启用语义嵌入"]), field("服务地址", el("input", { name: "embeddingBaseUrl", value: embedding.baseUrl || "" })), field("模型", el("input", { name: "embeddingModel", value: embedding.model || "" })), field("密钥", el("input", { name: "embeddingKey", type: "password", placeholder: embedding.hasKey ? "已保存；留空保持" : "输入密钥" })), testButton("测试嵌入", "embedding")]),
    el("div", { class: "panel soft" }, [el("label", { class: "check-field" }, [searchEnabled, "启用联网搜索"]), field("服务地址", el("input", { name: "searchBaseUrl", value: search.baseUrl || "https://api.tavily.com" })), field("密钥", el("input", { name: "searchKey", type: "password", placeholder: search.hasKey ? "已保存；留空保持" : "输入密钥" })), testButton("测试搜索", "search")]),
    el("div", { class: "panel soft" }, [el("label", { class: "check-field" }, [fetchEnabled, "启用公开网页读取"]), el("p", { class: "muted", text: "网页读取受公开地址限制，搜索摘要不会冒充已读正文。" }), testButton("测试网页读取", "fetch")]),
  ])]);
  capabilityPanels.set("model", modelPanel);
  const independentCards = capabilities.querySelectorAll(".panel");
  ["embedding", "search", "fetch"].forEach((name, index) => capabilityPanels.set(name, independentCards[index]));
  for (const [name, panel] of capabilityPanels) {
    panel.dataset.capability = name;
    panel.classList.add("api-capability-card");
    panel.addEventListener("input", event => {
      if (event?.target && !event.target.name) return;
      const entry = testControls.get(name);
      if (!entry.busy) showTestStatus(entry, "warning", "当前输入已修改，尚未测试保存。上次结果仅对应上次输入。");
    });
  }
  if (!practice) for (const [name, prefix] of [["model", "ai"], ["embedding", "embedding"]]) {
    const panel = capabilityPanels.get(name);
    discoveryControls.set(name, attachModelDiscovery({ panel, capability: name,
      address: panel.querySelector(`[name="${prefix}BaseUrl"]`), key: panel.querySelector(`[name="${prefix}Key"]`), model: panel.querySelector(`[name="${prefix}Model"]`),
      discover: api.discoverModels, connected: () => form.isConnected,
    }));
  }
  const apiCenter = el("section", { class: "page-stack api-configuration-center", dataset: { tour: "api-configuration-center", review: "api-center" } }, [
    sectionHeading("API 配置中心", "文本生成、语义嵌入、联网搜索和网页读取在这里分别配置。测试成功只自动保存对应卡片。"),
    modelPanel, capabilities,
  ]);
  const mcpEnabled = el("input", { name: "mcpEnabled", type: "checkbox", checked: Boolean(mcp.enabled) });
  const proposals = el("input", { name: "allowProposals", type: "checkbox", checked: Boolean(mcp.allowProposals) });
  const chatgptEnabled = el("input", { name: "chatgptEnabled", type: "checkbox", checked: mcp.chatgptEnabled === true });
  const chatgptAllowRead = el("input", { name: "chatgptAllowRead", type: "checkbox", checked: mcp.chatgptAllowRead === true });
  function syncMcpChoices() {
    for (const [parent, child] of [[mcpEnabled, proposals], [chatgptEnabled, chatgptAllowRead]]) {
      child.disabled = !parent.checked;
      if (child.disabled) child.checked = false;
    }
  }
  mcpEnabled.addEventListener("change", syncMcpChoices);
  chatgptEnabled.addEventListener("change", syncMcpChoices);
  syncMcpChoices();
  const mcpPanel = el("section", { class: "panel" }, [sectionHeading("MCP 接入", "本机客户端与 ChatGPT 网页端分别授权"), el("label", { class: "check-field" }, [mcpEnabled, "启用本地 MCP 服务"]), el("label", { class: "check-field" }, [proposals, "允许本机客户端提交写入提案"]),
    el("hr"), el("h3", { text: "ChatGPT 会话收集与知识库读取" }),
    el("label", { class: "check-field" }, [chatgptEnabled, "启用 ChatGPT 接入，允许新增第一层会话资料"]),
    el("label", { class: "check-field" }, [chatgptAllowRead, "允许 ChatGPT 检索和读取知识库"]),
    el("p", { class: "fine-print", text: "读取许可独立授予 ChatGPT：读到的原文会进入 ChatGPT 上下文，其他模型与搜索服务仍只按各自的主动操作使用所需内容。保存后生效：取消读取仍可收集会话；关闭接入后两项能力都停止，再开启需重新勾选读取。保存设置不会自动建立网页端连接。" }),
    el("p", { class: "fine-print", text: "连接后说“将该会话内容整理进知序”。保存角色原文与独立摘要，缺失历史会如实标注；不会自动覆盖、核验或晋级。电脑、知序和私有隧道都需保持运行。" }),
    el("a", { href: "/chatgpt-setup.html", target: "_blank", rel: "noopener", text: "打开 ChatGPT 连接指南" }),
    el("p", { class: "fine-print", text: "连接状态与实际操作记录可在“诊断与 MCP”中查看；已启用不代表网页端已接通。" })]);
  tour(modelPanel, "settings-model"); tour(capabilities, "settings-capabilities"); tour(mcpPanel, "settings-mcp");
  if (practice) {
    notesFolder.querySelector("input").disabled = true;
    form.append(el("div", { class: "notice info practice-settings-note" }, [el("strong", { text: "练习库共用正式 API 配置" }), el("p", { text: "这里仅修改练习学习偏好和提示词。API 密钥、能力开关及地址需返回正式设置修改，对两边共同生效。" }), tour(button("前往正式 API 配置", { onClick: () => onboarding?.openSettings() }), "settings-api-link")]), general, el("section", { class: "panel practice-api-summary" }, [sectionHeading("共用 API 状态", "连接字段只在正式 API 配置中心维护。"), ...[["文本生成", ai], ["语义嵌入", embedding], ["联网搜索", search], ["网页读取", fetchSettings]].map(([title, config]) => el("p", { text: `${title}：${config.enabled ? "已启用" : "未启用"}${config.model ? ` · ${config.model}` : ""}` }))]));
  } else {
    if (onboarding?.state?.practiceId) form.append(el("div", { class: "notice info" }, [el("strong", { text: "正在配置两边共用的 AI 能力" }), el("p", { text: "此处保存的 API 配置同时用于正式库和练习库。点击测试连接使用当前表单，成功后自动保存对应能力；测试会发起真实请求并可能产生费用。密钥不会进入教程进度或练习备份。" })]));
    form.append(general, apiCenter, mcpPanel);
  }
  form.append(tour(button(practice ? "保存练习偏好" : "保存能力设置", { kind: "primary", type: "submit" }), "settings-save"));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (testing) return;
    formRevision += 1;
    syncMcpChoices();
    const data = serializeForm(form);
    const payload = {
      dailyMinutes: number(data.dailyMinutes), timezone: data.timezone, scheduleTime: data.scheduleTime, vaultDir: data.vaultDir,
      focusTopics: String(data.focusTopics || "").split(/[,，]/).map((x) => x.trim()).filter(Boolean),
      ai: { enabled: aiEnabled.checked, baseUrl: data.aiBaseUrl, model: data.aiModel, apiKey: data.aiKey, timeoutMs:number(data.modelTimeoutSeconds)*1000, sourceCallLimit: number(ai.sourceCallLimit ?? 120) },
      embedding: { enabled: embeddingEnabled.checked, baseUrl: data.embeddingBaseUrl, model: data.embeddingModel, apiKey: data.embeddingKey },
      search: { enabled: searchEnabled.checked, baseUrl: data.searchBaseUrl, apiKey: data.searchKey },
      fetch: { enabled: fetchEnabled.checked }, mcp: { enabled: mcpEnabled.checked, allowProposals: proposals.checked, chatgptEnabled: chatgptEnabled.checked, chatgptAllowRead: chatgptAllowRead.checked },
    };
    if (practice) { for (const key of ["vaultDir", "ai", "embedding", "search", "fetch", "mcp"]) delete payload[key]; }
    try { await (practice ? api.updateSettings(payload) : api.updateMainSettings ? api.updateMainSettings(payload) : api.updateSettings(payload)); toast(practice ? "练习偏好已保存" : "能力设置已保存，密钥不会在页面回显", "success"); await refreshBootstrap(); }
    catch (error) { handleError(error); }
  });
  const paused = asArray(settings.pausedIds);
  const pausedPanel = paused.length ? el("section", { class: "panel" }, [sectionHeading("已暂停的学习内容", "恢复后可重新参与每日安排，原有学习记录会保留"), ...paused.map(id => el("div", { class: "list-item no-icon" }, [el("span", { text: asArray(state.bootstrap?.notes).find(note => note.id === id)?.title || "已暂停知识" }), button("恢复安排", { kind: "quiet compact", onClick: async () => { try { await api.updateSettings({ pausedIds: paused.filter(value => value !== id) }); await refreshBootstrap(); await renderSystem(); } catch (error) { handleError(error); } } })]))]) : null;
  return el("div", { class: "page-stack" }, [form, pausedPanel, promptSettingsPanel(promptData)]);
}

function promptSettingsPanel(data) {
  const prompts = asArray(data?.prompts);
  const form = el("form", { class: "panel page-stack", dataset: { tour: "settings-prompts" } });
  form.append(
    sectionHeading("AI 与联网提示词", "查看并调整文本生成、联网搜索等任务采用的提示词"),
    el("div", { class: "notice info", text: "保存后用于后续实际请求，已保存结果不会自动重新生成。{{变量}}由系统填入资料、问题或网页正文；请保留所需变量和 JSON 输出结构。本页不会发起模型或联网测试。" }),
  );
  if (!prompts.length) {
    form.append(emptyState("没有可编辑的提示词", "服务尚未返回提示词配置。"));
    return form;
  }

  const editors = new Map();
  const resetKeys = new Set();
  prompts.forEach((prompt, index) => {
    const key = String(prompt.key || "");
    if (!key) return;
    const template = String(prompt.template ?? prompt.defaultTemplate ?? "");
    const defaultTemplate = String(prompt.defaultTemplate ?? "");
    const textarea = el("textarea", {
      value: template,
      rows: Math.max(10, Math.min(24, template.split("\n").length + 4)),
      spellcheck: false,
      ariaLabel: `${prompt.title || key}提示词模板`,
    });
    const status = badge(template === defaultTemplate ? "系统默认" : "已自定义", template === defaultTemplate ? "neutral" : "accent");
    const variables = asArray(prompt.variables).map((variable) => String(variable)).filter(Boolean);
    const details = el("details", { class: "panel soft", open: index === 0 }, [
      el("summary", {}, [el("strong", { text: prompt.title || key }), el("span", { class: "right", text: "展开编辑" })]),
      prompt.description ? el("p", { class: "muted", text: prompt.description }) : null,
      el("div", { class: "item-meta" }, [status]),
      variables.length ? el("div", {}, [
        el("p", { class: "field-label", text: "可用变量（保存时请保留所需占位符）" }),
        el("div", { class: "item-meta" }, variables.map((variable) => badge(variable, "accent"))),
        el("p", { class: "fine-print", text: "运行任务时，系统会把这些变量替换为当次资料、问题、网页正文或候选证据。请同时保留模板要求的 JSON 输出结构。" }),
      ]) : el("p", { class: "fine-print", text: "这个模板没有可插入的运行时变量。" }),
      field("提示词模板", textarea),
      el("div", { class: "form-actions" }, [button("恢复系统默认", { onClick: () => {
        resetKeys.add(key);
        textarea.value = defaultTemplate;
        status.textContent = "待保存：系统默认";
        status.className = "badge badge-warn";
        toast("已在编辑框中恢复默认模板；点击“保存全部提示词”后生效", "success");
      } })]),
    ]);
    textarea.addEventListener("input", () => {
      status.textContent = textarea.value === defaultTemplate ? "系统默认" : "已修改，待保存";
      status.className = `badge badge-${textarea.value === defaultTemplate ? "neutral" : "warn"}`;
    });
    editors.set(key, { textarea, defaultTemplate, status });
    form.append(details);
  });
  form.append(button("保存全部提示词", { kind: "primary", type: "submit" }));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries([...editors].map(([key, editor]) => [key, editor.textarea.value]));
    try {
      await api.updatePrompts({ prompts: values });
      if ([...resetKeys].some(key => editors.get(key)?.textarea.value === editors.get(key)?.defaultTemplate)) recordTourEvent("prompts-reset");
      resetKeys.clear();
      editors.forEach(({ textarea, defaultTemplate, status }) => {
        const isDefault = textarea.value === defaultTemplate;
        status.textContent = isDefault ? "系统默认" : "已自定义";
        status.className = `badge badge-${isDefault ? "neutral" : "accent"}`;
      });
      toast("提示词已保存，将用于后续新请求", "success");
    } catch (error) { handleError(error); }
  });
  return form;
}

const jobTableState = { type: "", status: "", size: "10", page: 1 };

async function jobsPanel() {
  const data = await api.jobs();
  const jobs = asArray(data.jobs).sort((a,b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
  const names = {process:"资料加工",title:"原文标题生成",structure:"逻辑关系分析",relate:"知识关联",discover:"知识发现",grade:"学习反馈",index:"更新索引",topics:"主题学习包整理"};
  const panel = el("section", {class:"panel call-history", dataset: { tour: "system-jobs" }});
  const type = selectControl([["","全部类型"],...Object.entries(names)], jobTableState.type, "jobType");
  type.setAttribute("aria-label", "筛选任务类型");
  const status = selectControl([["","全部状态"],...["queued","running","waiting","failed","done","cancelled"].map(value=>[value,labels.state(value)])], jobTableState.status, "jobStatus");
  status.setAttribute("aria-label", "筛选任务状态");
  const size = selectControl([["10","每页 10 条"],["20","每页 20 条"],["50","每页 50 条"]], jobTableState.size, "jobPageSize");
  size.setAttribute("aria-label", "每页任务记录数");
  const content = el("div"), pager = el("div", {class:"call-pagination"});
  function render() {
    const rows = jobs.filter(job=>(!type.value || job.type===type.value) && (!status.value || job.state===status.value));
    const limit = Number(size.value), pages = Math.max(1,Math.ceil(rows.length/limit));
    jobTableState.page = Math.max(1,Math.min(jobTableState.page,pages));
    const table = el("table", {class:"call-table"});
    table.append(el("thead",{},el("tr",{},["更新时间","任务类型","状态 / 进度","操作"].map(text=>el("th",{scope:"col",text})))));
    const body = el("tbody");
    for (const job of rows.slice((jobTableState.page-1)*limit,jobTableState.page*limit)) {
      const details = el("td",{},badge(labels.state(job.state),stateTone(job.state)));
      if (["queued","running","waiting"].includes(job.state)) {
        const progress = Math.max(0,Math.min(100,number(job.progress)));
        details.append(el("small",{text:progress+"%"}));
      }
      if (job.error || job.code) {
        const explanation = describeJobError(job);
        details.append(el('p', { class: 'job-error-title', text: explanation.title }),
          el('details', { class: 'call-error', on: { toggle: event => { if (event.target.open) recordTourEvent('job-open'); } } }, [
            el('summary', { text: '查看详情' }),
            el('p', { class: 'job-error-help', text: explanation.reason }),
            el('p', { class: 'job-error-help', text: `可以这样处理：${explanation.next}` }),
            ['structure','title'].includes(job.type) ? el('p', { class: 'job-error-help', text: job.type === 'title' ? '原文和临时标题已保留；重试仅生成标题，不重新拆解。' : '本次失败不会删除原文、拆解条目或覆盖已保存的结构建议。' }) : null,
            el('details', { class: 'job-technical' }, [el('summary', { text: '技术信息（供排查）' }),
              el('pre', { text: `错误代码：${job.code || '未提供'}\n原始信息：${job.error || '未提供'}` })]),
          ]));
      }
      const actions = el("div",{class:"item-actions"});
      if (["failed","cancelled","waiting"].includes(job.state)) actions.append(button(job.type === "process" && job.extractionSaved ? "继续核验" : "重试",{kind:"primary compact",onClick:()=>actJob(job.id,"retry",job)}));
      if (["queued","running","waiting"].includes(job.state)) actions.append(button("取消",{kind:"quiet compact",onClick:()=>actJob(job.id,"cancel")}));
      body.append(el("tr",{},[
        el("td",{text:formatDate(job.updatedAt || job.createdAt,true)}),
        el("td",{text:names[job.type] || "其他任务"}), details,
        el("td",{},actions.children.length ? actions : el("span",{class:"muted",text:"—"})),
      ]));
    }
    table.append(body);
    clear(content).append(rows.length ? el("div",{class:"call-table-scroll"},table) : emptyState(jobs.length?"没有匹配的任务":"没有任务记录",jobs.length?"可以调整类型或状态筛选。":"拆解、核验和学习反馈等任务会显示在这里。"));
    clear(pager).append(el("span",{class:"muted",text:"共 "+rows.length+" 条 · 第 "+jobTableState.page+" / "+pages+" 页"}),el("div",{class:"item-actions"},[
      button("上一页",{kind:"quiet compact",disabled:jobTableState.page===1,onClick:()=>{jobTableState.page--;render();}}),
      button("下一页",{kind:"quiet compact",disabled:jobTableState.page===pages,onClick:()=>{jobTableState.page++;render();}}),
    ]));
  }
  for (const control of [type,status,size]) control.addEventListener("change",()=>{
    Object.assign(jobTableState,{type:type.value,status:status.value,size:size.value,page:1}); render(); recordTourEvent("jobs-filter");
  });
  panel.append(sectionHeading("后台任务","按最近更新时间排列；详情可展开，支持重试或取消"),el("div",{class:"call-filters"},[type,status,size]),content,pager);
  render();
  return panel;
}

async function actJob(id, action, job) {
  if (action === 'retry' && job?.type === 'structure') return runConfirmedStructure(`job:${id}`, async () => {
    if (!job.payload?.noteId) throw new Error('无法确认这项任务对应的资料，请从知识库打开原文后重新分析。');
    const source = await api.note(job.payload.noteId, { background: true });
    if (source.kind !== 'source' || !source.title) throw new Error('无法确认这项任务对应的原文，请在知识库核对资料后重新分析。');
    return source.title;
  }, () => actJob(id, action));
  try { await api.jobAction(id, { action }); toast(action === "retry" ? "已重新排队" : "任务已取消", "success"); await refreshBootstrap(); await renderSystem(); }
  catch (error) { handleError(error); }
}

function dataPanel() {
  const backupInput = el("input", { type: "file", accept: ".json,application/json" });
  const previewArea = el("div");
  const restoreButton = button("先预览恢复", { kind: "primary", disabled: true });
  backupInput.addEventListener("change", async () => {
    state.restoreToken = "";
    clear(previewArea);
    restoreButton.disabled = !backupInput.files.length;
    if (!backupInput.files.length) return;
    try { state.restoreBackup = JSON.parse(await backupInput.files[0].text()); }
    catch { state.restoreBackup = null; restoreButton.disabled = true; previewArea.append(el("div", { class: "notice danger", text: "无法解析这个 JSON 备份文件。" })); }
  });
  restoreButton.addEventListener("click", async () => {
    try {
      const result = await api.restore({ backup: state.restoreBackup, preview: true });
      state.restoreToken = result.token || "";
      clear(previewArea).append(el("section", { class: "panel soft" }, [sectionHeading("恢复预览", "正式恢复前还会生成安全备份"), el("pre", { class: "mono-block", text: JSON.stringify(result, null, 2) }), button("确认恢复", { kind: "danger", disabled: !state.restoreToken, onClick: confirmRestore })]));
    } catch (error) { handleError(error); }
  });
  return el("div", { class: "two-column" }, [
    el("section", { class: "panel", dataset: { tour: "system-backup" } }, [sectionHeading("完整备份", "开放 JSON 包含知识与运行状态，不含密钥和会话令牌"), el("p", { class: "muted", text: "建议在大批量修改、合并或恢复前下载一份。" }), el("div", { class: "form-actions" }, [button("下载备份", { kind: "primary", onClick: downloadBackup }), button("导入演示资料", { onClick: importDemo })]), el("p", { class: "fine-print", text: "演示内容会明确标识，不会生成虚假的个人掌握记录。被删除内容的历史版本和备份保留策略可在导出内容中核对。" })]),
    el("section", { class: "panel", dataset: { tour: "system-restore" } }, [sectionHeading("恢复演练", "先预览差异，再明确确认"), field("选择备份文件", backupInput), restoreButton, previewArea]),
  ]);
}

async function downloadBackup() {
  try {
    const blob = await api.backup();
    const url = URL.createObjectURL(blob);
    const anchor = el("a", { href: url, download: `zhixu-backup-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
    toast("备份已生成", "success");
  } catch (error) { handleError(error); }
}

async function importDemo() {
  const ok = await confirmAction({ title: "导入演示资料？", message: "演示内容会明确标识，操作幂等，不会冒充你的真实知识或学习记录。", confirmText: "导入" });
  if (!ok) return;
  try { await api.demo(); toast("演示资料已导入", "success"); await refreshBootstrap(); }
  catch (error) { handleError(error); }
}

async function confirmRestore() {
  const ok = await confirmAction({ title: "执行恢复？", message: "应用会先生成安全备份，再恢复资料与记录。恢复后的外部能力默认关闭，未完成任务等待你确认；本机未结清调用仍保留。", confirmText: "确认恢复", danger: true });
  if (!ok) return;
  try {
    await api.restore({ backup: state.restoreBackup, preview: false, token: state.restoreToken });
    state.restoreBackup = null; state.restoreToken = "";
    toast("恢复已完成", "success");
    await refreshBootstrap();
    await renderSystem();
  } catch (error) { handleError(error); }
}

function diagnosticCount(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : "未知";
}

function diagnosticDetails(title, value) {
  return el("details", { class: "diagnostic-details" }, [el("summary", { text: title }), el("pre", { text: JSON.stringify(value, null, 2) })]);
}

function storageSummary(storage, index) {
  const practice = Boolean(api.getContext?.().practiceId);
  const conflicts = Array.isArray(storage.conflicts) ? storage.conflicts.length : null;
  const links = Array.isArray(storage.pendingLinks) ? storage.pendingLinks.length : null;
  return el("div", { class: "diagnostic-summary" }, [
    el("p", { class: "notice info", text: practice ? "当前查看的是新手练习库，以下存储与索引属于练习资料。" : "当前查看的是正式知识库。" }),
    el("p", { text: "原始资料和知识笔记保存在本机文件夹；搜索索引可重新生成。" }),
    el("p", { text: `内容片段：${diagnosticCount(index.count)}；已建立语义索引的片段：${diagnosticCount(index.vectors)}；可补建语义索引的片段：${diagnosticCount(index.pending)}。这些数量不是资料篇数。` }),
    el("p", { text: conflicts === null ? "文件冲突状态未知。" : conflicts ? `有 ${conflicts} 项文件冲突，请到“文件冲突”核对后处理。` : "未发现文件冲突。" }),
    el("p", { text: links === null ? "笔记链接更新状态未知。" : links ? `有 ${links} 篇笔记需要核对链接，请先预览下方更新内容。` : "没有待更新的笔记链接。" }),
    el("p", { class: "fine-print", text: storage.retention || "删除和备份保留范围未知；操作前请先核对备份与恢复说明。" }),
    diagnosticDetails("查看存储与索引技术详情", { storage, index }),
  ]);
}

function mcpSummary(mcp) {
  const setting = (value, yes, no) => value === true ? yes : value === false ? no : "未知，请到接入设置核对。";
  const tools = { search_knowledge: "搜索知识", read_note: "阅读知识笔记", read_source: "阅读原始资料", related_knowledge: "查找相关知识", propose_change: "提交待确认的修改建议" };
  const events = Array.isArray(mcp.events) ? mcp.events.length : null;
  const practice = Boolean(api.getContext?.().practiceId);
  return el("div", { class: "diagnostic-summary" }, [
    practice ? el("p", { class: "notice info", text: "当前是练习库视图；以下为该视图返回的权限状态，不能据此判断正式库的接入设置。请返回正式库核对。" }) : null,
    el("p", { text: `本机应用接入：${setting(mcp.enabled, "已开启，允许本机客户端调用知识工具。", "已关闭，本机客户端不能调用知识工具。")}` }),
    el("p", { text: `本机修改建议：${mcp.enabled === false ? "本机接入已关闭，当前不能提交建议。" : setting(mcp.allowProposals, "已许可；本机接入开启后可提交，修改仍须你确认后生效。", "未许可；本机接入开启时也只能读取。")}` }),
    el("p", { text: `ChatGPT 会话收集：${setting(mcp.chatgptEnabled, "入口已开启，可按连接指南配置会话收集。", "入口已关闭，不能通过此入口新增会话资料。")}` }),
    el("p", { text: `ChatGPT 读取知识库：${mcp.chatgptEnabled === false ? "接入入口已关闭，当前不能读取。" : setting(mcp.chatgptAllowRead, "已授权，包含仅本地资料；读取内容会进入 ChatGPT 上下文。", "未授权；开启会话收集本身不授予读取权限。")}` }),
    el("p", { class: "notice info", text: "客户端是否已配置：未知。ChatGPT 网页实际连接：尚未验证。开关状态和本机调用记录都不能证明网页已连通；需要使用时，请按连接指南完成一次实际收集验证。" }),
    el("p", { text: Array.isArray(mcp.tools) ? mcp.tools.length ? `本机工具功能（能否使用取决于上方权限）：${mcp.tools.map(name => tools[name] || "其他功能（见技术详情）").join("、")}。` : "当前未列出本机工具功能。" : "本机工具功能未知。" }),
    el("p", { text: events === null ? "本机调用记录未知。" : events ? `当前返回 ${events} 条本机调用记录，详情可展开查看；这不是 ChatGPT 网页连接证明。` : "暂无本机调用记录；这不能判断是否配置过客户端。" }),
    el("p", { class: "fine-print", text: "MCP 是外部应用使用知识工具的入口，模型 API 需单独配置。会话导入不覆盖已有资料；修改已有笔记仍须确认。" }),
    diagnosticDetails("查看 MCP 技术详情与调用记录", mcp),
  ]);
}

async function diagnosticsPanel() {
  const data = await api.diagnostics();
  const usage = asObject(data.usage);
  const calls = asArray(data.calls);
  const index = asObject(data.index);
  const mcp = asObject(data.mcp);
  const storage = asObject(data.storage);
  return el("div", { class: "page-stack" }, [
    data.usageNotice ? el("p", { class: "notice info", text: data.usageNotice }) : null,
    el("section", { class: "stats" }, [statCard("今日调用", usage.callsToday ?? calls.length, "实际记录"), statCard("本月费用", usage.costMonth === null || usage.costMonth === undefined ? "未知" : usage.costMonth, "供应商价格未知时不估算"), statCard("索引片段", diagnosticCount(index.count), "按内容片段计数"), statCard("MCP", "待实际验证", "开关不代表网页已连通")]),
    el("section", { class: "panel soft", dataset: { tour: "system-diagnostics" } }, [sectionHeading("系统怎样工作", "只展示可核对的输入、工具调用与结果，不展示模型隐藏推理"), el("div", { class: "step-list" }, [step("1. 切分与索引", "本地资料被拆成检索片段；关键词索引可离线使用，向量索引需由你主动补建。", true), step("2. 召回候选", "关键词与可选语义结果分别返回，再合并为有限候选。", true), step("3. 形成回答", "只有实际召回且可用的材料进入回答，并返回引用与限制。", true), step("4. MCP 调用", "外部客户端共用知识服务。ChatGPT 可按独立许可读取或新增会话资料；修改已有笔记仍需确认。", true)])]),
    el("div", { class: "two-column" }, [
      el("section", { class: "panel", dataset: { tour: "system-index" } }, [sectionHeading("存储与索引", "查看本机资料保存与搜索准备情况"), storageSummary(storage, index),
        el('p', { class: 'fine-print', text: '本地全文检索自动同步保存和外部文件变化。重建全文索引会全量校对 Markdown，不调用模型，也不清除已有向量。' }),
        button('重建本地全文索引', { onClick: async () => { try { const result=await api.rebuildLocalSearch(); toast(`本地全文索引已重建：${result.count} 条资料，${result.conflicts} 项冲突。`, 'success'); } catch(error) { handleError(error); } } }),
        el("p", { class: "fine-print", text: "保存知识只更新本地索引。点击补建后，本次所需且缺少向量的片段会发送给已配置的嵌入服务，可能产生费用。" }),
        el("div", { class: "form-actions" }, [button("只补建缺失向量", { kind: "primary", disabled: !number(index.pending), onClick: async () => { try { const result = await api.updateIndex(); toast(`补建任务已${labels.state(result.state)}`, "success"); } catch (error) { handleError(error); } } }), button("全量重建索引", { onClick: async () => { try { const result = await api.rebuildIndex(); toast(`索引任务已${labels.state(result.state)}`, "success"); } catch (error) { handleError(error); } } })]),
        asArray(storage.pendingLinks).length ? el("section", {}, [sectionHeading("待更新的 Obsidian 链接", "文件改名后，先核对预览再更新引用"), el("div", { class: "list" }, storage.pendingLinks.map(note => el("div", { class: "list-item no-icon" }, [el("strong", { text: note.title }), button("核对链接", { kind: "text compact", onClick: () => previewNoteLinks(note.id) })])))]) : null]),
      el("section", { class: "panel" }, [sectionHeading("外部应用接入（MCP）", "区分接入许可与实际连接"), mcpSummary(mcp), el("a", { href: "/chatgpt-setup.html", target: "_blank", rel: "noopener", text: "ChatGPT 连接与验收步骤" })]),
    ]),
    callHistoryPanel(calls),
  ]);
}

function callHistoryPanel(calls) {
  recordTourEvent("calls-open");
  const names = {model:"文本生成",search:"联网搜索",fetch:"网页读取",embedding:"语义嵌入"};
  const panel = el("section", {class:"panel call-history"});
  const capability = selectControl([["","全部类型"],...Object.entries(names)], "", "callCapability");
  const purpose = selectControl([["","全部用途"], ...new Map(calls.map(c => [c.purpose || 'unrecorded', c.purposeLabel || '历史用途未记录']))], "", "callPurpose");
  purpose.setAttribute("aria-label","筛选调用用途");
  capability.setAttribute("aria-label","筛选调用类型");
  const outcome = selectControl([["","全部结果"],["success","成功"],["failure","失败"],["unknown","未知"]], "", "callOutcome");
  outcome.setAttribute("aria-label","筛选调用结果");
  const size = selectControl([["10","每页 10 条"],["20","每页 20 条"],["50","每页 50 条"]], "10", "callPageSize");
  size.setAttribute("aria-label","每页调用记录数");
  const content=el("div"), pager=el("div",{class:"call-pagination"});
  let page=1;
  const status = c => c.ok===true ? "success" : c.ok===false ? "failure" : "unknown";
  function render() {
    const rows=calls.filter(c=>(!purpose.value||(c.purpose||'unrecorded')===purpose.value)&&(!capability.value||c.capability===capability.value)&&(!outcome.value||status(c)===outcome.value));
    const limit=Number(size.value), pages=Math.max(1,Math.ceil(rows.length/limit));
    page=Math.max(1,Math.min(page,pages));
    const table=el("table",{class:"call-table"});
    table.append(el("thead",{},el("tr",{},["时间","用途 / 模型 / 服务","耗时","结果"].map(t=>el("th",{scope:"col",text:t})))));
    const body=el("tbody");
    for(const c of rows.slice((page-1)*limit,page*limit)) {
      const state=status(c), error=typeof c.error==="object" ? c.error?.message || JSON.stringify(c.error) : String(c.error||"");
      const result=el("td",{},badge(state==="success"?"成功":state==="failure"?"失败":"未知",state==="success"?"good":state==="failure"?"danger":"neutral"));
      if(error) result.append(el("details",{class:"call-error"},[el("summary",{text:"查看详情"}),el("pre",{text:error})]));
      body.append(el("tr",{},[
        el("td",{text:formatDate(c.createdAt,true)}),
        el("td",{class:"call-purpose-cell"},[el("strong",{text:c.purposeLabel||"历史用途未记录"}),el("small",{text:[c.model,names[c.capability]||"其他调用"].filter(Boolean).join(" · ")})]),
        el("td",{text:Number.isFinite(c.durationMs)?`${(c.durationMs/1000).toFixed(2)} 秒`:"未知"}),result,
      ]));
    }
    table.append(body);
    clear(content).append(rows.length?el("div",{class:"call-table-scroll"},table):emptyState("没有匹配的调用记录","可以调整类型或结果筛选。"));
    clear(pager).append(el("span",{class:"muted",text:`共 ${rows.length} 条 · 第 ${page} / ${pages} 页`}),el("div",{class:"item-actions"},[
      button("上一页",{kind:"quiet compact",disabled:page===1,onClick:()=>{page--;render();}}),
      button("下一页",{kind:"quiet compact",disabled:page===pages,onClick:()=>{page++;render();}}),
    ]));
  }
  for(const control of [purpose,capability,outcome,size]) control.addEventListener("change",()=>{page=1;render();});
  panel.dataset.tour = "system-calls";
  panel.append(sectionHeading("最近外部调用",`展示最近 ${calls.length} 条记录（最多 100 条），新记录在前`),el("div",{class:"call-filters"},[purpose,capability,outcome,size]),content,pager);
  render();
  return panel;
}

function keyValueObject(object) {
  const entries = Object.entries(asObject(object));
  if (!entries.length) return el("p", { class: "muted", text: "暂无可用状态" });
  return el("dl", { class: "key-values" }, entries.map(([key, value]) => el("div", { class: "key-value" }, [el("dt", { text: key }), el("dd", { text: typeof value === "object" ? JSON.stringify(value) : String(value) })])));
}

async function proposalsPanel() {
  const data = await api.proposals();
  const undo = api.getContext().practiceId ? { requests: [] } : await api.captureUndoRequests();
  const proposals = asArray(data.proposals);
  return el("section", { dataset: { tour: "system-proposals" } }, [
    captureUndoPanel(asArray(undo.requests)),
    sectionHeading("MCP 写入提案", "外部客户端只能提交草稿；接受时仍会核对原内容哈希"),
    proposals.length ? el("div", { class: "list" }, proposals.map((proposal) => el("article", { class: "list-item" }, [
      el("div", { class: "item-symbol", text: "提" }),
      el("div", { class: "item-copy" }, [el("h3", { text: proposal.title || proposal.type || "未命名提案" }), el("p", { text: truncate(proposal.body || proposal.reason, 180) }), el("div", { class: "item-meta" }, [badge(labels.state(proposal.state || "pending"), stateTone(proposal.state || "pending")), badge(formatDate(proposal.createdAt, true))])]),
      (proposal.state || "pending") === "pending" ? el("div", { class: "item-actions" }, [button("审阅差异", { kind: "primary compact", onClick: () => openProposal(proposal) }), button("拒绝", { kind: "text compact", onClick: () => actProposal(proposal.id, "reject") })]) : null,
    ]))) : emptyState("没有待确认提案", "默认只读 MCP 不会产生提案；启用写入提案后，外部修改仍需在此确认。"),
  ]);
}

function captureUndoPanel(requests) {
  if (!requests.length) return null;
  const names = { preview: "等待本机确认", pending: "待继续", partial: "部分完成", undone: "已撤销，可恢复", restored: "已恢复" };
  return el("section", { class: "panel soft" }, [
    sectionHeading("会话保存撤销", "仅处理你指定的保存回执；原文可恢复，后续编辑或依赖变化会阻止操作。"),
    ...requests.map(item => {
      const restore = item.kind === "restore", actionable = ["preview", "pending", "partial"].includes(item.state);
      const expired = item.state === "preview" && item.expiresAt <= Date.now();
      return el("article", { class: "list-item no-icon" }, [
        el("div", { class: "item-copy" }, [
          el("h3", { text: `${restore ? "恢复" : "撤销"} · ${names[item.state] || "需核对"}` }),
          el("p", { text: item.restoreToRevision ? `更新回退到第 ${item.restoreToRevision} 版，旧资料继续保留。` : "初次保存的原资料和本次新建候选进入可恢复记录。" }),
          el("ul", {}, asArray(item.items).map(entry => el("li", { text: `${entry.title} · ${entry.action === "recycle" ? "移入可恢复记录" : entry.action === "restore_from_undo" ? "恢复撤销前内容" : "回退版本"}` }))),
          el("p", { class: "fine-print", text: expired ? "预览已过期，请在聊天中重新预览。" : `预览编号：${item.previewId}` }),
        ]),
        actionable ? button(restore ? "确认恢复" : "确认撤销", { kind: "danger compact", disabled: expired, onClick: () => confirmCaptureUndo(item) }) :
          item.kind === "undo" && item.state === "undone" ? button("预览恢复", { onClick: async () => { try { await api.captureRestorePreview({ undoId: item.undoId }); await renderSystem(); } catch (error) { handleError(error); } } }) : null,
      ]);
    }),
  ]);
}

async function confirmCaptureUndo(item) {
  const restore = item.kind === "restore";
  const ok = await confirmAction({ title: restore ? "恢复这次撤销？" : "撤销这次保存？", message: `只处理上方列出的 ${asArray(item.items).length} 项资料。执行前会重新核对内容和依赖，发生冲突时停止；不会永久删除原文。`, confirmText: restore ? "确认恢复" : "确认撤销", danger: true });
  if (!ok) return;
  try {
    const result = await (restore ? api.captureRestoreConfirm({ previewId: item.previewId }) : api.captureUndoConfirm({ previewId: item.previewId }));
    const complete = ["undone", "already_undone", "restored", "already_restored"].includes(result.status);
    toast(complete ? "操作已完成，原文和审计记录已保留。" : "尚未全部完成，请核对冲突后继续。", complete ? "success" : "error");
    await refreshBootstrap(); await renderSystem();
  } catch (error) { handleError(error); }
}

function openProposal(proposal) {
  openDrawer(proposal.title || "写入提案", "MCP 待确认", el("div", { class: "page-stack" }, [
    el("div", { class: "notice", text: "这里显示外部客户端建议的修改。接受前会检查目标文件是否已经变化。" }),
    el("div", { class: "two-column" }, [
      el("section", { class: "panel soft" }, [el("p", { class: "eyebrow", text: "修改前" }), el("h3", { text: "当前内容" }), sourceReadingBody(proposal.before, '', '未返回修改前内容；请勿在无法核对时接受。')]),
      el("section", { class: "panel soft" }, [el("p", { class: "eyebrow", text: "修改后" }), el("h3", { text: "外部建议稿" }), sourceReadingBody(proposal.body || proposal.proposedBody, '', '未提供建议正文')]),
    ]),
    proposal.diff ? el("pre", { class: "mono-block", text: proposal.diff }) : null,
    proposal.reason ? el("div", { class: "notice info", text: `提案理由：${proposal.reason}` }) : null,
    el("div", { class: "form-actions" }, [button("接受提案", { kind: "primary", disabled: !proposal.before || !(proposal.body || proposal.proposedBody), onClick: () => actProposal(proposal.id, "accept") }), button("拒绝", { kind: "danger", onClick: () => actProposal(proposal.id, "reject") })]),
  ]));
}

async function actProposal(id, action) {
  if (action === "accept") {
    const ok = await confirmAction({ title: "接受这项写入提案？", message: "将检查原哈希；若目标已修改，操作会停下并转为冲突。", confirmText: "接受" });
    if (!ok) return;
  }
  try { await api.proposalAction(id, { action }); toast(action === "accept" ? "提案已接受" : "提案已拒绝", "success"); closeDrawer(); await refreshBootstrap(); await renderSystem(); }
  catch (error) { handleError(error); }
}

function conflictsPanel() {
  recordTourEvent("conflicts-open");
  const conflicts = asArray(state.bootstrap?.conflicts);
  return el("section", { dataset: { tour: "system-conflicts" } }, [
    sectionHeading("文件与同步冲突", "重复稳定 ID、解析错误和哈希变化不会被静默覆盖"),
    conflicts.length ? el("div", { class: "list" }, conflicts.map((conflict) => el("article", { class: "list-item" }, [
      el("div", { class: "item-symbol", text: "!" }),
      el("div", { class: "item-copy" }, [el("h3", { text: conflict.title || conflict.type || "文件冲突" }), el("p", { text: conflict.error || conflict.message || conflict.path || "等待人工处理" }), el("div", { class: "item-meta" }, [conflict.code ? badge(conflict.code, "danger") : badge("待处理", "danger"), conflict.updatedAt ? badge(formatDate(conflict.updatedAt, true)) : null])]),
      conflict.noteId || conflict.id ? button("查看相关内容", { kind: "quiet compact", onClick: () => openNote(conflict.noteId || conflict.id) }) : null,
    ]))) : emptyState("没有检测到冲突", "外部修改、重命名和 Web 写入会通过稳定 ID 与内容哈希协调。"),
  ]);
}

async function renderCurrent() {
  if (isMobilePrototype() && !["capture", "library"].includes(state.view)) {
    clear(refs.main).append(emptyState("这项功能尚未迁移到手机", "当前样机支持原文收集、查看、搜索和编辑。", button("打开知识库", { onClick: () => navigate("library") })));
    return;
  }
  const renderers = { trash: () => renderRecycleBin({ main: refs.main, refresh: refreshBootstrap, onError: handleError, isActive: () => state.view === 'trash' }), today: renderToday, capture: renderCapture, library: renderLibrary, study: renderStudy, topics: renderTopics, discover: renderDiscover, output: renderOutput, system: renderSystem };
  await (renderers[state.view] || renderSystem)();
  onboarding?.rendered();
}

async function navigateTutorial(step, tutorial) {
  const prerequisite = (id, message) => ({ target: "onboarding-prerequisite", prerequisite: id, message });
  const missingContent = () => {
    if (step.id === "study-plan") return { target: "onboarding-prerequisite", prerequisite: "library-explain", message: "请先选择本原文的解释知识并加入学习，再回今日生成清单。" };
    if (step.caseId) return { target: "onboarding-case", message: "请先点击框选的“准备演示案例”，重新准备后再定位案例中的操作。" };
    if (step.noteRole === "createdTopic") return prerequisite("topic-create", "尚未找到对应主题，请先创建并保存一个练习主题。");
    if (step.noteRole === "capturedSource") return prerequisite("capture-save", "尚未找到收集的资料，请先保存练习资料。");
    if (tutorial?.materialId && step.noteRole === "source") return prerequisite("capture-save", "尚未找到本场景原文，请先保存练习资料。");
    if (tutorial?.materialId && ["aware", "find", "explain", "apply"].includes(step.noteRole) && !value) return { target: "onboarding-knowledge", message: "请在引导中选择本原文的一条实际候选，再查看内容并设置学习目标；待核验事实先联网加工。" };
    return { target: "onboarding-reset", message: "初始示例已删除或缺失。可点击框选的“重置练习”重新准备；确认后会清理当前练习进度，正式资料不受影响。" };
  };
  const value = tutorial?.roles?.[step.noteRole];
  const id = typeof value === "string" ? value : value?.id;
  if (step.noteRole && !id && step.noteRole !== 'draft') return missingContent();
  let topic;
  if (step.noteRole === "createdTopic") {
    topic = asArray((await api.topics()).topics).find(item => item.id === id);
    if (!topic) return missingContent();
  }
  const requestedTab = step.view === "study" ? step.tab || (step.target === "study-queue" || step.target === "study-history" ? "queue" : step.target === "study-mistakes" ? "mistakes" : "session") : step.tab;
  const sameView = state.view === (step.view || "today") && (step.view !== "system" || !requestedTab || state.systemTab === requestedTab) && (step.view !== "study" || state.studyTab === requestedTab);
  const openStudyConfirmation = sameView && step.id === "study-confirm" && refs.drawer.classList.contains("is-open") && refs.drawerBody.dataset.tour === "note-confirm";
  // Keep unsaved input when locating an already open form.
  if (sameView && refs.drawer.classList.contains("is-open")) {
    if (step.target === "note-editor" && refs.drawerBody.dataset.tour === "note-editor" && refs.drawerBody.dataset.tourSubject === id) return;
    if (refs.drawerBody.dataset.tour === "topic-editor") {
      const { tourSubject, tourMode } = refs.drawerBody.dataset;
      if (["topic-copy", "topic-split"].includes(step.id) && tourMode === "create" && tourSubject === id) return { target: "topic-editor" };
      if (step.action === "create-topic" && tourMode === "create" && !tourSubject) return;
      if (step.action === "edit-topic" && tourMode === "edit" && tourSubject === id) return;
    }
  }
  if (step.tab && step.view === "system") state.systemTab = step.tab;
  if (step.view === "study") state.studyTab = requestedTab;
  if (!sameView) { if (await navigate(step.view || "today") === false) return; }
  else if (!openStudyConfirmation && !step.target?.startsWith("note-") && !["topic-editor", "topic-detail", "draft-editor"].includes(step.target) && refs.drawer.classList.contains("is-open")) {
    if (!await confirmDrawerDiscard()) return;
    closeDrawer();
    if (["library", "topics"].includes(step.view)) await renderCurrent();
  }
  if (api.getContext?.().practiceId && ["settings-model", "settings-capabilities", "settings-mcp"].includes(step.target)) return { target: "settings-api-link", message: "API 配置集中在正式库，请点击框选入口配置共用能力。" };
  if (step.action === "create-topic") return createTopicDrawer();
  if (step.view === "study" && state.studyTab === "session") {
    const sessions = asArray((await api.studySessions()).sessions);
    const noteId = id || tutorial?.roles?.explain;
    const session = sessions.find(item => item.id === noteId) || sessions.find(item => item.noteId === noteId);
    if (openStudyConfirmation) {
      if (session && refs.drawerBody.dataset.tourMode === "study" && refs.drawerBody.dataset.tourSubject === session.id) return { target: "note-confirm" };
      closeDrawer();
    }
    if (!session) {
      state.studyTab = "queue"; await renderStudy();
      return { target: "study-queue", message: "还没有对应的学习会话，请先在框选的学习队列中点击这条示例的“开始学习”。" };
    }
    const sameSession = sameView && state.currentStudy?.id === session.id;
    const changed = JSON.stringify(state.currentStudy) !== JSON.stringify(session);
    if (!sameSession || changed) {
      const answer = sameSession ? refs.main.querySelector('[data-tour="study-answer"]')?.value : null;
      if (!sameSession) state.studyMaterialVisible = !asArray(session.turns).length && session.status === "reading";
      state.currentStudy = session; await renderStudy();
      const editor = refs.main.querySelector('[data-tour="study-answer"]');
      if (editor && answer != null) editor.value = answer;
    }
    if (state.studyMaterialVisible && !asArray(state.currentStudy?.turns).length && step.target !== "study-material") return { target: "study-hide", message: "请先阅读材料，再点击框选的“隐藏材料，开始回忆”，即可看到作答与练习操作。" };
    if (step.target === "study-material" && (!state.studyMaterialVisible || asArray(state.currentStudy?.turns).length)) return { target: "study-session", message: "本轮已经进入作答阶段，材料已隐藏；可继续作答，或在新一轮练习中体验隐藏材料。" };
    if (step.target === "study-confirm" && !asArray(state.currentStudy?.turns).length) return { target: "study-answer", message: "请先提交你自己的回答，再整理并确认个人理解。" };
    if (step.focusTarget === "study-feedback" && !asArray(state.currentStudy?.turns).at(-1)?.feedback) return { target: "study-session", message: "本轮反馈尚未返回，请先提交回答或等待反馈完成。" };
    return;
  }
  if (step.target === "draft-editor" || step.target === "output-result") {
    const trackedId = tutorial?.roles?.draft;
    if (step.target === "output-result" && state.lastOutput && (!trackedId && !tutorial?.materialId || state.lastOutput.draftId === trackedId)) return;
    const drafts = asArray((await api.drafts()).drafts);
    const draft = trackedId ? drafts.find(item => item.id === trackedId) : tutorial?.materialId ? null : drafts[0];
    if (!draft) {
      closeDrawer();
      return { target: "output-form", message: "还没有已保存的输出，请先在框选区域填写目标并亲自点击“开始生成”。" };
    }
    if (step.target === "draft-editor") {
      if (sameView && refs.drawer.classList.contains("is-open") && refs.drawerBody.dataset.tour === "draft-editor" && refs.drawerBody.dataset.tourSubject === draft.id) return;
      return openDraft(draft);
    }
    renderAnswer(refs.main.querySelector('[data-tour="output-result"]'), { ...draft, answer: draft.body || draft.answer, draftId: draft.id });
    return;
  }
  if (step.action === "open-topic" || step.action === "edit-topic") {
    topic ||= asArray((await api.topics()).topics).find(item => item.id === id);
    if (topic) return step.action === "edit-topic" ? editTopic(topic) : openTopic(topic);
    return prerequisite("topic-create", "对应主题已删除或尚未创建，请先保存一个练习主题。");
  }
  if (step.target === "library-content" && !refs.main.querySelector('[data-tour="library-content"]')) return { target: "library-filter", message: "当前筛选没有显示资料，请先清除筛选，或回到收集步骤保存示例。" };
  if (!id || !step.target?.startsWith("note-")) return;
  let note;
  try { note = await api.note(id); }
  catch (error) {
    if (error.status !== 404) throw error;
    return missingContent();
  }
  openDrawer(note.title || "练习知识", "新手练习", el("div"));
  if (step.target === "note-editor") return renderNoteEditor(note);
  if (step.target === "note-history") return renderHistory(note);
  if (step.target === "note-extract") return manualExtract(note);
  if (step.target === "note-confirm") return confirmDirect(note);
  if (step.target === "note-merge") return renderMerge(note, tutorial.roles?.mergeOther);
  if (step.target === "note-links") return previewNoteLinks(note.id);
  return note.kind === "source" ? renderSourceGroupDrawer(note) : renderNoteDrawer(note);
}

async function fillTutorialSample(sample, step) {
  const aliases = { query: "q" };
  const allowed = new Set(["title", "body", "platform", "author", "url", "date", "locator", "topic", "reason", "claimType", "depth", "question", "q", "minutes", "prerequisites"]);
  const root = refs.drawer.classList.contains("is-open") ? refs.drawerBody : refs.main;
  const edits = Object.entries(sample).map(([key, value]) => ({ key: aliases[key] || key, value })).filter(item => allowed.has(item.key)).map(item => ({ ...item, control: root.querySelector(`[name="${item.key}"]`) })).filter(item => item.control && !item.control.disabled);
  if (!edits.length) { toast("请先打开这一项对应的输入表单，再填入示例。", "error"); return; }
  if (edits.some(item => item.control.value && item.control.value !== String(item.value)) && !await confirmAction({ title: "用示例填入当前表单？", message: "当前输入尚未提交，填入后可以继续修改。", confirmText: "填入示例" })) return;
  edits.forEach(({ control, value }) => { if (control.markdownEditor) control.markdownEditor.setValue(value); else control.value = String(value); control.dispatchEvent(new Event("input", { bubbles: true })); control.dispatchEvent(new Event("change", { bubbles: true })); });
  toast("示例已填入；请检查后亲自保存或提交。", "success");
}

refs.nav.addEventListener("click", (event) => {
  const item = event.target.closest("[data-view]");
  if (item) navigate(item.dataset.view);
});
document.querySelector('#recycle-bin-launcher').addEventListener('click', () => navigate('trash'));
refs.quickCapture.addEventListener("click", () => navigate("capture"));
refs.refresh.addEventListener("click", async () => {
  if (!await confirmUnsavedInputDiscard()) return;
  refs.refresh.disabled = true;
  showLoading();
  try { await refreshBootstrap(); await renderCurrent(); toast("已读取最新状态", "success"); }
  catch (error) { handleError(error); }
  finally { refs.refresh.disabled = false; }
});
refs.drawerClose.addEventListener("click", requestCloseDrawer);
refs.drawerBackdrop.addEventListener("click", requestCloseDrawer);
document.addEventListener("keydown", (event) => { if (event.key === "Escape") return requestCloseDrawer(); });

function unsavedInputForm() {
  return refs.main.querySelector('[data-tour="capture-form"]') || refs.main.querySelector('[data-tour="study-session"]');
}

function protectUnsavedInput(form, values, description) {
  form.draftContextVersion = api.getContext().version;
  form.draftPracticeId = api.getContext().practiceId;
  const original = values();
  form.hasUnsavedChanges = () => values() !== original;
  let confirming = false;
  form.confirmDiscardChanges = async () => {
    if (confirming) return false;
    const context = api.getContext();
    if (form.hasUnsavedChanges()) {
      confirming = true;
      try {
        if (!await confirmAction({ title: `放弃未保存的${description}？`, message: "当前输入尚未保存。取消可继续填写；确认放弃后，本次输入不会保存。", confirmText: "放弃输入", danger: true })) return false;
      } finally { confirming = false; }
    }
    const latest = api.getContext();
    return context.version === latest.version && context.practiceId === latest.practiceId && unsavedInputForm() === form;
  };
}

async function confirmUnsavedInputDiscard() {
  const form = unsavedInputForm();
  return !form?.confirmDiscardChanges || await form.confirmDiscardChanges();
}

let contextPreparation = null;

function finishContextChange() {
  const pending = contextPreparation;
  contextPreparation = null;
  if (!pending || refs.main.querySelector(".loading-panel") !== pending.loading) return;
  const context = api.getContext();
  if (context.version !== pending.context.version || context.practiceId !== pending.context.practiceId) return;
  clear(refs.main).append(...pending.content);
}

async function prepareContextChange() {
  if (!await confirmUnsavedInputDiscard()) return false;
  if (!await confirmDrawerDiscard()) return false;
  if (!contextPreparation) {
    const content = [...refs.main.children], context = api.getContext();
    showLoading();
    contextPreparation = { content, context, loading: refs.main.querySelector(".loading-panel") };
  }
  return true;
}

// Only inspect the live form; sensitive draft text never enters browser storage.
window.addEventListener("beforeunload", (event) => {
  if (!unsavedInputForm()?.hasUnsavedChanges() && !drawerInputForm()?.hasUnsavedChanges?.()) return;
  event.preventDefault();
  // Legacy Chrome/Edge also require a nonempty returnValue to request the prompt.
  event.returnValue = "unsaved";
});

async function init() {
  const [hashView, systemTab] = window.location.hash.slice(1).split("/");
  if (hashView === "system" && ["settings", "usage", "appearance", "jobs", "data", "diagnostics", "proposals", "conflicts"].includes(systemTab)) state.systemTab = systemTab;
  setPage(pages[hashView] ? hashView : isMobilePrototype() ? "library" : "today");
  if (isMobilePrototype()) {
    document.documentElement.classList.add("android-prototype");
    refs.nav.querySelectorAll("[data-view]").forEach(item => {
      item.disabled = !["capture", "library"].includes(item.dataset.view);
      if (item.disabled) item.title = "后续版本接入";
    });
    for (const id of ["onboarding-launcher", "onboarding-reset"]) { const control = document.querySelector(`#${id}`); if (control) { control.disabled = true; control.title = "新手引导尚未迁移到手机"; } }
  }
  try {
    await startSession();
    if (!onboarding && !isMobilePrototype()) {
      const { createOnboarding } = await import("./onboarding.mjs");
      onboarding = createOnboarding({
        processStatus: noteId => processFeedback.status(noteId),
        revealTarget: sidebarNavigation.revealTarget,
        navigate: navigateTutorial,
        fillSample: fillTutorialSample,
        refresh: async () => { await refreshBootstrap(); await renderCurrent(); },
        beforeContextChange: prepareContextChange,
        contextChangeFinished: finishContextChange,
        contextChanged: async () => {
          state.lastCapture = null;
          closeDrawer(); state.currentStudy = null; state.studyMaterialVisible = true; state.studyTab = "queue";
          state.lastOutput = null;
          state.restoreBackup = null; state.restoreToken = "";
          state.libraryFilters = { q: "", kind: "", stage: "" };
          state.searchFilters = { q: "", mode: "keyword", kind: "", stage: "", topic: "", source: "", from: "", to: "", privacy: "local" };
          try { await refreshBootstrap(); await renderCurrent(); }
          catch (error) { renderFailure(error, async () => { await refreshBootstrap(); await renderCurrent(); }); throw error; }
        },
      });
      await onboarding.init();
      refs.nav.querySelectorAll("[data-view]").forEach(item => { item.dataset.tour = `nav-${item.dataset.view}`; });
      document.querySelector("#theme-toggle")?.addEventListener("click", () => recordTourEvent("appearance-theme"));
    }
    await refreshBootstrap();
    await renderCurrent();
    if (!isMobilePrototype()) processFeedback.start();
  } catch (error) {
    renderFailure(error, init);
  }
}

init();
