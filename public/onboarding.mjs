import { api } from "./api.mjs";
import { el, button, badge, clear, toast, confirmAction } from "./ui.mjs";
import { chapters, flatSteps } from "./onboarding-curriculum.mjs";

const DISMISSED = "zhixu.onboarding.welcomeDismissed.v1";
const STEP_KEY = "zhixu.onboarding.currentStep.v1";
const completed = value => ["done", "demonstrated"].includes(value?.status);
const stepChapter = step => chapters.find(chapter => chapter.id === step?.chapterId || chapter.steps?.some(item => (typeof item === "string" ? item : item.id) === step?.id));
const statusLabel = value => ({ done: "已实操", demonstrated: "已看案例", pending: "未完成", needs_setup: "待配置" })[value?.status] || "未完成";
function practiceDate(value, timezone) {
  if (!value) return "尚未开始";
  try { return new Intl.DateTimeFormat("zh-CN", { timeZone: timezone || "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value)); }
  catch { return "时间暂不可读"; }
}

function stored(key) { try { return localStorage.getItem(key); } catch { return null; } }
function dismissWelcome() { try { localStorage.setItem(DISMISSED, "yes"); } catch { /* Optional preference. */ } }
function savedStep() { try { return sessionStorage.getItem(STEP_KEY); } catch { return null; } }
function rememberStep(id) { try { sessionStorage.setItem(STEP_KEY, id); } catch { /* Optional preference. */ } }

export function getStepProgress(state, step) {
  const progress = state?.progress?.[step.id] || { status: "pending" };
  return { ...progress, label: statusLabel(progress), complete: completed(progress) };
}

export function createOnboarding(adapter) {
  let current = null;
  let selected = savedStep() || "";
  let visible = false;
  let working = false;
  let errorText = "";
  let highlight = null;
  let highlightPulse = null;
  let scheduled = null;
  let refreshing = false;
  let disposed = false;
  let compact = false;
  let observer = null;
  let poll = null;
  const workspace = document.querySelector(".workspace");
  const panel = el("aside", { class: "onboarding-panel", ariaLabel: "新手实操引导", hidden: true });
  const banner = el("section", { class: "practice-banner", ariaLabel: "当前知识库", hidden: true });
  workspace.prepend(banner, panel);

  const step = () => flatSteps.find(item => item.id === selected) || flatSteps.find(item => item.id === current?.currentStepId) || flatSteps[0];
  const inPractice = () => Boolean(api.getContext().practiceId);
  const busy = () => working || Boolean(current?.busy) || api.getContext().pending > 0;
  const stateBody = extra => ({ practiceId: current?.practiceId || api.getContext().practiceId, ...extra });
  function adopt(value) { current = value?.onboarding || value; if (!selected) selected = current?.currentStepId || flatSteps[0]?.id; }
  function clearHighlight() { highlightPulse?.cancel(); highlightPulse = null; highlight?.classList.remove("tour-target"); highlight = null; }
  function placePanel() {
    const drawer = document.querySelector("#drawer");
    const narrow = window.matchMedia("(max-width: 1100px)").matches;
    const parent = narrow && drawer?.classList.contains("is-open") ? document.querySelector("#drawer-body") : workspace;
    if (panel.parentElement !== parent) parent.prepend(panel);
  }
  function locate(scroll = false) {
    if (!visible || !step()?.target) { clearHighlight(); return; }
    const candidates = [...document.querySelectorAll("[data-tour]")].filter(node => node.dataset.tour === step().target);
    for (const node of candidates) for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) if (ancestor.tagName === "DETAILS") ancestor.open = true;
    const target = candidates.find(node => node.getClientRects().length) || null;
    if (target !== highlight) { clearHighlight(); highlight = target; }
    if (highlight) {
      for (let ancestor = highlight.parentElement; ancestor; ancestor = ancestor.parentElement) if (ancestor.tagName === "DETAILS") ancestor.open = true;
      highlight.classList.add("tour-target");
      if (scroll) highlight.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
  function flashHighlight() {
    if (!highlight || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    highlightPulse?.cancel();
    highlightPulse = highlight.animate?.([
      { outlineColor: "var(--accent)" },
      { outlineColor: "transparent" },
      { outlineColor: "var(--accent)" },
    ], { duration: 650, iterations: 3, delay: 250, easing: "ease-in-out" }) || null;
  }
  async function run(action) {
    if (working) return;
    working = true; errorText = ""; render();
    try { await action(); }
    catch (error) { errorText = error.message || "本次操作未完成，请稍后重试。"; }
    finally { working = false; render(); }
  }
  async function refreshProof() {
    if (!current?.practiceId || refreshing || disposed) return;
    refreshing = true;
    try { adopt(await api.onboarding("state", stateBody({}))); render(); }
    catch (error) { errorText = error.message; render(); }
    finally { refreshing = false; }
  }
  async function switchContext(id, destination) {
    if (current?.busy) throw new Error("练习任务仍在处理，请先等待完成或到任务页取消，再切换知识库。");
    api.setContext(id);
    await adapter.contextChanged?.();
    if (destination) await adapter.navigate(destination, current);
  }
  async function goTo(target = step()) {
    selected = target.id; rememberStep(selected); compact = false; errorText = "";
    if (current?.practiceId) adopt(await api.onboarding("checkpoint", stateBody({ stepId: target.id, mode: "check" })));
    const chapter = stepChapter(target);
    const first = chapters[0]?.id;
    if (chapter?.id !== first && !current?.modelReady) {
      render();
      errorText = "请先在第一章保存 AI 配置并测试成功，再进入实操。你可以先阅读各章说明。";
      return;
    }
    const id = chapter?.id === first && ["settings-model", "settings-capabilities", "settings-mcp", "settings-save"].includes(target.target) ? "" : current?.practiceId;
    if (!current?.practiceId) return;
    if (api.getContext().practiceId !== (id || "")) await switchContext(id || "");
    await adapter.navigate(target, current);
    render(); locate(true);
  }
  async function start() {
    adopt(await api.onboarding("start")); visible = true;
    selected = flatSteps[0]?.id;
    await goTo(step());
  }
  async function resume() {
    if (!current?.practiceId) return start();
    adopt(await api.onboarding("resume", stateBody({})));
    visible = true;
    if (current.modelReady) await switchContext(current.practiceId);
    await goTo(step());
  }
  async function pause() {
    if (current?.busy) throw new Error("练习任务仍在处理，请先等待完成或到任务页取消。");
    adopt(await api.onboarding("pause", stateBody({})));
    await switchContext(""); visible = false;
    await adapter.navigate({ view: "today" }, current);
  }
  async function openSettings() {
    if (inPractice()) await switchContext("");
    visible = Boolean(current?.practiceId);
    await adapter.navigate({ view: "system", tab: "settings" }, current);
    render();
  }
  async function reset() {
    if (busy()) throw new Error("请先等当前操作完成，或取消练习任务后再重置。");
    if (!await confirmAction({ title: "重新开始新手练习？", message: "只清理独立练习库及其练习记录。正式知识、正式 API 配置和密钥会保留。", confirmText: "重置练习", danger: true })) return;
    adopt(await api.onboarding("reset", stateBody({})));
    selected = flatSteps[0]?.id; rememberStep(selected);
    await switchContext(""); visible = true;
    await goTo(step());
  }
  async function advance(action) {
    adopt(await api.onboarding("advance", stateBody({ action })));
    await adapter.refresh?.();
    toast("练习时间已前进，电脑时间和正式学习日程保持不变。", "success");
  }
  async function abandonSession(session) {
    if (!await confirmAction({ title: `结束“${session.title || "未完成练习"}”？`, message: "保留已经提交的回答和已有反馈，本次结束不生成成绩，也不增加复习间隔。需要继续作答时，请取消并回到当前学习。", confirmText: "结束未完成练习" })) return;
    await run(async () => {
      adopt(await api.onboarding("abandon", stateBody({ sessionId: session.id })));
      await adapter.refresh?.();
      toast("已保留已有记录并结束未完成练习。", "success");
    });
  }
  async function loadCase(target) {
    adopt(await api.onboarding("case", stateBody({ caseId: target.caseId })));
    await adapter.refresh?.();
    await adapter.navigate(target, current);
    toast("演示案例已准备；后续记录会标为演练。", "success");
  }
  async function checkpoint(target) {
    adopt(await api.onboarding("checkpoint", stateBody({ stepId: target.id, mode: target.kind === "read" ? "read" : target.kind === "external" ? "external" : "check" })));
    const result = getStepProgress(current, target);
    if (!result.complete) errorText = result.message || result.reason || "尚未找到这一步的完成记录。请按说明完成操作，再检查进度。";
    else if (target.kind === "read") {
      const next = flatSteps[flatSteps.findIndex(item => item.id === target.id) + 1];
      if (next) await goTo(next);
    }
  }
  function chapterItems(chapter) { return flatSteps.filter(item => stepChapter(item)?.id === chapter.id); }
  function render() {
    const practice = inPractice();
    banner.hidden = !current?.practiceId;
    clear(banner).append(el("div", {}, [el("strong", { text: practice ? "新手练习库" : "正式知识库" }), el("span", { text: practice ? " 示例内容与正式资料分开保存" : " API 配置保存在这里，练习库共用这些能力" }), el("span", { class: "practice-date", text: `练习时间：${practiceDate(current?.clock?.now, current?.clock?.timezone || current?.settings?.timezone)}` })]),
      button(visible ? "收起引导" : "继续新手引导", { kind: "text compact", disabled: working, onClick: () => { if (visible) { visible = false; render(); } else run(resume); } }));
    document.body.classList.toggle("onboarding-open", visible);
    document.body.classList.toggle("practice-active", practice);
    panel.hidden = !visible;
    if (!visible) { clearHighlight(); return; }
    const active = step();
    if (!active) return;
    const index = flatSteps.findIndex(item => item.id === active.id);
    const chapter = stepChapter(active);
    const progress = getStepProgress(current, active);
    const done = flatSteps.filter(item => completed(current?.progress?.[item.id])).length;
    const pendingSetup = flatSteps.filter(item => current?.progress?.[item.id]?.status === "needs_setup").length;
    const chapterIndex = chapters.findIndex(item => item.id === chapter?.id);
    const title = el("div", { class: "onboarding-heading" }, [el("div", {}, [el("p", { class: "eyebrow", text: `新手全流程 · 当前第 ${index + 1}/${flatSteps.length} 步` }), el("h2", { text: chapter?.title || "开始练习" }), el("p", { class: "fine-print", text: `完成进度：${done}/${flatSteps.length} 步（含阅读和案例）` })]), button(compact ? "展开步骤" : "折叠步骤", { kind: "text compact", onClick: () => { compact = !compact; render(); } })]);
    const content = el("div", { class: "onboarding-content", hidden: compact });
    const catalog = el("details", { class: "onboarding-catalog" }, [el("summary", { text: `全部 ${chapters.length} 章${pendingSetup ? ` · ${pendingSetup} 项待配置` : ""}` })]);
    chapters.forEach((item, index) => {
      const items = chapterItems(item); const count = items.filter(row => completed(current?.progress?.[row.id])).length;
      catalog.append(button(`${String(index + 1).padStart(2, "0")} ${item.title.replace(/^\d+\.\s*/, "")} · 已完成 ${count}/${items.length} 步`, { kind: `text${item.id === chapter?.id ? " is-current" : ""}`, onClick: () => run(() => goTo(items[0])), disabled: working || !items.length }));
    });
    const choices = el("select", { ariaLabel: "选择本章步骤", disabled: working, on: { change: event => run(() => goTo(flatSteps.find(item => item.id === event.target.value))) } });
    chapterItems(chapter || chapters[0]).forEach(item => choices.append(el("option", { value: item.id, text: `${statusLabel(current?.progress?.[item.id])} · ${item.title}`, selected: item.id === active.id })));
    content.append(catalog, choices, el("div", { class: "onboarding-step-head" }, [el("h3", { text: active.title }), badge(progress.label, progress.complete ? "good" : "neutral")]),
      el("p", { class: "onboarding-instruction", text: active.instruction || active.description || "" }));
    if (active.why) content.append(el("p", { class: "fine-print", text: active.why }));
    if (active.expected) content.append(el("div", { class: "onboarding-expected" }, [el("strong", { text: "完成后应看到" }), el("p", { text: active.expected })]));
    if (active.kind === "case" || active.caseId) content.append(el("p", { class: "notice", text: "这一步使用预设演示案例，不代表你的真实经历、成绩或外部连接结果。" }));
    if (active.kind === "external") content.append(el("p", { class: "fine-print", text: "外部应用需要你自行连接。标记体验只记录你的确认，不代表系统验证连接成功。" }));
    if (chapterIndex === chapters.length - 1 || active.id === "complete-review") {
      const connections = current?.externalConnections || {};
      const mcp = connections.mcp || {};
      const obsidian = connections.obsidian || {};
      const mcpText = mcp.status === "observed" ? `发现正式通道调用记录${mcp.lastSeenAt ? `（${practiceDate(mcp.lastSeenAt, current?.settings?.timezone)}）` : ""}；不等于此刻在线` : mcp.status === "reported" ? "你已确认体验，未发现调用记录" : "尚未接通 / 待体验";
      const obsidianText = obsidian.status === "reported" ? `用户确认已打开${obsidian.editReported ? "；用户确认已体验外部编辑" : "；外部编辑待体验"}` : "尚未接通 / 待体验";
      content.append(el("div", { class: "onboarding-expected" }, [el("strong", { text: "外部工具体验状态" }), el("p", { text: `MCP：${mcpText}` }), el("p", { text: `Obsidian：${obsidianText}` })]));
    }
    if (active.downloads?.length) content.append(el("div", { class: "onboarding-actions" }, active.downloads.filter(item => item.href?.startsWith("/tutorial-examples/")).map(item => el("a", { href: item.href, download: item.title, class: "quiet-button compact", text: `下载 ${item.title}` }))));
    if (errorText) content.append(el("p", { class: "notice danger", role: "alert", text: errorText }));
    if (progress.message || progress.reason) content.append(el("p", { class: "fine-print", text: progress.message || progress.reason }));
    const actions = el("div", { class: "onboarding-actions" });
    if (!current?.practiceId) actions.append(button("创建独立练习库", { kind: "primary", onClick: () => run(start), disabled: working }));
    else {
      actions.append(button("定位操作位置", { kind: "primary", onClick: async () => { await run(() => goTo(active)); flashHighlight(); }, disabled: working }));
      if (active.sample) actions.append(button("填入示例（不提交）", { onClick: () => run(async () => { await goTo(active); await adapter.fillSample?.(active.sample, active, current); locate(true); }), disabled: working || !practice }));
      if (active.caseId) actions.append(button("准备演示案例", { onClick: () => run(() => loadCase(active)), disabled: working || !practice || !current.modelReady }));
      actions.append(button(active.kind === "read" ? "我已阅读" : active.kind === "external" ? "记录我已在外部体验" : "检查这一步", { onClick: () => run(() => checkpoint(active)), disabled: working }));
    }
    content.append(actions);
    content.append(el("div", { class: "onboarding-step-nav" }, [button("上一步", { kind: "text", disabled: working || index < 1, onClick: () => run(() => goTo(flatSteps[index - 1])) }),
      button(index === flatSteps.length - 1 ? "检查全部进度" : progress.complete ? "下一步" : "先看下一步", { kind: "text", disabled: working, onClick: () => run(() => index === flatSteps.length - 1 ? refreshProof() : goTo(flatSteps[index + 1])) })]));
    content.append(el("p", { class: "fine-print", text: "先看后面的步骤不会把当前步骤记为完成；实操进度来自实际保存的记录。" }));
    if (current?.practiceId) {
      if (!practice) content.append(button(current.modelReady ? "返回练习库" : "配置并测试 AI", { kind: "primary", onClick: () => run(current.modelReady ? async () => { await switchContext(current.practiceId); await adapter.navigate({ view: "today" }, current); } : openSettings), disabled: working }));
      const clock = el("details", { class: "onboarding-clock" }, [el("summary", { text: `练习时间：${practiceDate(current.clock?.now, current.clock?.timezone || current.settings?.timezone)}` }), el("p", { class: "fine-print", text: "按学习时区显示，只推进练习库的学习时间。收费额度和正式库使用真实时间。" }), el("div", { class: "onboarding-actions" }, [button("前进 1 天", { disabled: working || current.busy || !practice || !current.modelReady, onClick: () => run(() => advance("day")) }), button("跳到下次复习", { disabled: working || current.busy || !practice || !current.modelReady, onClick: () => run(() => advance("next")) })])]);
      if (chapterIndex === 5) clock.open = true;
      if (current.unfinishedSessions?.length) clock.append(el("div", { class: "page-stack" }, [el("p", { class: "fine-print", text: "下面的练习尚未结束。可以回学习页继续；确需放弃本次时，结束后才能推进时间。" }), ...current.unfinishedSessions.map(session => el("div", {}, [el("p", { class: "fine-print", text: session.title || "未完成练习" }), button("结束未完成练习", { kind: "text compact", disabled: busy() || !practice, onClick: () => abandonSession(session) })]))]));
      content.append(clock, el("div", { class: "onboarding-controls" }, [button("配置共享 API", { kind: "text compact", disabled: working || current.busy, onClick: () => run(openSettings) }), button("暂停并回正式库", { kind: "text compact", disabled: working || current.busy, onClick: () => run(pause) }), button("重置练习", { kind: "text compact", disabled: working || current.busy, onClick: () => { if (!working) reset().catch(error => { errorText = error.message; render(); }); } })]));
      if (current.busy) content.append(el("p", { class: "fine-print", text: "练习任务正在处理；完成或取消后可切换知识库、推进时间。" }));
    }
    clear(panel).append(title, content);
    placePanel(); locate();
  }
  function entryCard() {
    const welcome = !current?.practiceId && !stored(DISMISSED);
    if (!welcome) return el("section", { class: "panel onboarding-entry onboarding-entry-compact", dataset: { tour: "onboarding-entry" } }, [
      el("p", { class: "muted", text: current?.practiceId ? "新手实操引导已保存进度，随时继续。" : "用独立示例，亲手走通知序全流程。" }),
      el("div", { class: "form-actions" }, [button(current?.practiceId ? "继续新手引导" : "开始新手引导", { kind: "primary", onClick: () => run(current?.practiceId ? resume : start) }), current?.practiceId ? button("重新练习", { kind: "text", onClick: () => reset().catch(error => toast(error.message, "error")) }) : null]),
    ]);
    return el("section", { class: `panel onboarding-entry${welcome ? " accent-panel" : ""}`, dataset: { tour: "onboarding-entry" } }, [
      el("div", {}, [el("p", { class: "eyebrow", text: current?.practiceId ? "随时继续" : "第一次使用知序" }), el("h2", { text: "跟着示例，走通完整学习流程" }), el("p", { class: "muted", text: "先配置 AI，再到独立练习库亲手收集、整理、学习和输出；复习时间可以加速。" })]),
      el("div", { class: "form-actions" }, [button(current?.practiceId ? "继续新手引导" : "开始新手引导", { kind: "primary", onClick: () => run(current?.practiceId ? resume : start) }), welcome ? button("暂时关闭提示", { kind: "text", onClick: () => { dismissWelcome(); adapter.refresh?.(); } }) : null]),
    ]);
  }
  async function init() {
    try {
      adopt(await api.onboarding("state", api.getContext().practiceId ? { practiceId: api.getContext().practiceId } : {}));
      const storedContext = api.getContext().practiceId;
      if (storedContext && current?.practiceId !== storedContext) throw new Error("找不到此前的练习库。请重新选择练习库，系统不会把操作转到正式资料。");
      visible = Boolean(storedContext) || new URLSearchParams(window.location.search || "").get("onboarding") === "start";
      if (storedContext && current?.status === "paused") { api.setContext(""); visible = false; }
    } catch (error) {
      errorText = error.message;
      if (api.getContext().practiceId) throw error;
    }
    document.querySelector("#onboarding-launcher")?.addEventListener("click", () => run(current?.practiceId ? resume : start));
    document.querySelector("#onboarding-reset")?.addEventListener("click", () => current?.practiceId ? reset().catch(error => toast(error.message, "error")) : run(start));
    window.addEventListener("resize", () => { if (visible) { placePanel(); locate(); } });
    window.addEventListener("zhixu:request", event => {
      if (!current?.practiceId || event.detail?.path?.startsWith("/api/onboarding/")) return;
      if (scheduled) window.clearTimeout(scheduled);
      scheduled = window.setTimeout(refreshProof, 200);
    });
    observer = new MutationObserver(records => {
      if (visible && records.some(record => !panel.contains(record.target))) { placePanel(); locate(); }
    });
    observer.observe(document.querySelector("#main"), { childList: true, subtree: true });
    observer.observe(document.querySelector("#drawer-body"), { childList: true, subtree: true });
    poll = window.setInterval(() => { if (visible && !working && (current?.busy || current?.jobs?.some(job => ["queued", "running"].includes(job.state)))) refreshProof(); }, 3000);
    render();
  }
  return {
    init, entryCard, isPractice: inPractice, open: () => run(current?.practiceId ? resume : start),
    openSettings: () => run(openSettings),
    rendered: () => { if (visible) { placePanel(); locate(); } },
    refresh: refreshProof,
    get state() { return current; },
    async test(capability) { adopt(await api.onboarding("test", stateBody({ capability }))); render(); return current; },
    dispose() { disposed = true; if (scheduled) window.clearTimeout(scheduled); if (poll) window.clearInterval(poll); observer?.disconnect(); clearHighlight(); panel.remove?.(); banner.remove?.(); document.body.classList.remove("onboarding-open"); document.body.classList.remove("practice-active"); },
  };
}
