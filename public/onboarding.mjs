import { api } from "./api.mjs";
import { el, button, badge, clear, toast, confirmAction } from "./ui.mjs";
import { chapters, flatSteps, coreChapters, coreSteps, extensionChapters } from "./onboarding-curriculum.mjs";

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
  let showExtensions = false;
  let observer = null;
  let poll = null;
  const narrowScreen = () => window.matchMedia("(max-width: 1100px)").matches;
  let narrow = narrowScreen();
  const workspace = document.querySelector(".workspace");
  const panel = el("aside", { class: "onboarding-panel", ariaLabel: "新手实操引导", hidden: true });
  const banner = el("section", { class: "practice-banner", ariaLabel: "当前知识库", hidden: true });
  workspace.prepend(banner, panel);
  panel.addEventListener("keydown", event => {
    if (event.key === "Escape" && narrowScreen() && !compact) {
      event.preventDefault(); event.stopPropagation(); setCompact(true);
    }
  });

  const step = () => flatSteps.find(item => item.id === selected) || flatSteps.find(item => item.id === current?.currentStepId) || flatSteps[0];
  const coreDone = () => coreSteps.filter(item => completed(current?.progress?.[item.id])).length;
  const nextCoreStep = () => coreSteps.find(item => !completed(current?.progress?.[item.id])) || coreSteps.at(-1);
  const routeChapter = target => (target.priority === "core" ? coreChapters : extensionChapters).find(chapter => chapter.steps.some(item => item.id === target.id));
  const routeSteps = target => target.priority === "core" ? coreSteps : routeChapter(target).steps;
  const inPractice = () => Boolean(api.getContext().practiceId);
  const busy = () => working || Boolean(current?.busy) || api.getContext().pending > 0;
  const stateBody = extra => ({ practiceId: current?.practiceId || api.getContext().practiceId, ...extra });
  function adopt(value) { current = value?.onboarding || value; if (!selected) selected = current?.currentStepId || flatSteps[0]?.id; }
  function clearHighlight() { highlightPulse?.cancel(); highlightPulse = null; highlight?.classList.remove("tour-target"); highlight = null; }
  function placePanel() {
    // Keep the floating window outside the drawer's transformed scroll container.
    if (panel.parentElement !== workspace) workspace.prepend(panel);
  }
  function setCompact(value) {
    compact = value; render();
    panel.querySelectorAll("[data-onboarding-toggle]")[0]?.focus({ preventScroll: true });
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
      if (scroll) highlight.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
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
    catch (error) { errorText = error.message || "本次操作未完成，请稍后重试。"; compact = false; }
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
    try { adopt(await api.onboarding("advance", stateBody({ action }))); }
    catch (error) {
      if (action !== "next" || error.code !== "NO_REVIEW") throw error;
      await goTo(flatSteps.find(item => item.id === "study-start"));
      errorText = "还没有可用的复习安排。反馈存在争议时，结束练习只会保留记录。请重新开始这条知识的练习，核对材料、提交新回答，收到明确反馈并结束后再前往复习。";
      return;
    }
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
      const route = routeSteps(target);
      const next = route[route.findIndex(item => item.id === target.id) + 1];
      if (next) await goTo(next);
    }
  }
  async function openExtensions() {
    showExtensions = true;
    await resume();
    panel.querySelectorAll(".onboarding-extensions")[0]?.scrollIntoView({ block: "nearest" });
  }
  function render() {
    const focusToggle = document.activeElement?.dataset?.onboardingToggle === "true";
    const previousContent = panel.querySelectorAll(".onboarding-content")[0];
    const scrollTop = panel.dataset.stepId === step()?.id ? previousContent?.scrollTop || 0 : 0;
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
    const core = active.priority === "core";
    const route = routeSteps(active);
    const index = route.findIndex(item => item.id === active.id);
    const chapter = routeChapter(active);
    const progress = getStepProgress(current, active);
    const done = coreDone();
    const routeDone = route.filter(item => completed(current?.progress?.[item.id])).length;
    panel.classList.toggle("is-compact", compact);
    panel.dataset.stepId = active.id;
    const toggle = button(compact ? "展开步骤" : narrowScreen() ? "收成小窗" : "折叠步骤", { kind: "text compact", onClick: () => setCompact(!compact) });
    toggle.dataset.onboardingToggle = "true";
    toggle.setAttribute("aria-expanded", String(!compact));
    toggle.setAttribute("aria-controls", "onboarding-content");
    const title = el("div", { class: "onboarding-heading" }, [el("div", { class: "onboarding-heading-copy" }, [el("p", { class: "eyebrow", text: `${core ? "核心流程" : "扩展阅读（可选）"} · 当前第 ${index + 1}/${route.length} 步` }), el("h2", { text: compact && narrowScreen() ? active.title : chapter?.title.replace(/^\d+\.\s*/, "") || "开始练习" }), el("p", { class: "fine-print onboarding-heading-progress", text: `核心完成进度：${done}/${coreSteps.length} 步（含阅读）` })]), toggle]);
    const content = el("div", { id: "onboarding-content", class: "onboarding-content", hidden: compact });
    const catalog = el("details", { class: "onboarding-catalog" }, [el("summary", { text: `核心流程 · ${coreChapters.length} 个阶段 · ${done}/${coreSteps.length} 步已完成` })]);
    coreChapters.forEach(item => {
      const count = item.steps.filter(row => completed(current?.progress?.[row.id])).length;
      catalog.append(button(`${item.title} · 已完成 ${count}/${item.steps.length} 步`, { kind: `text${core && item.id === chapter?.id ? " is-current" : ""}`, onClick: () => run(() => goTo(item.steps[0])), disabled: working }));
    });
    content.append(catalog);
    if (!core) content.append(el("p", { class: "fine-print", text: `本专题已完成 ${routeDone}/${route.length} 步，可随时返回。扩展内容不计入核心完成进度。` }), button("返回核心流程", { kind: "text compact", disabled: working, onClick: () => run(() => goTo(nextCoreStep())) }));
    if (active.id === "complete-review") content.append(el("div", { class: "onboarding-expected", role: "status" }, [
      el("strong", { text: done === coreSteps.length ? "核心流程已完成" : `核心流程还有 ${coreSteps.length - done} 步待完成` }),
      el("p", { text: "扩展阅读由你自选，未学习或待配置都不影响核心体验完成。" }),
    ]));
    const choices = el("select", { ariaLabel: core ? "选择本阶段步骤" : "选择本专题步骤", disabled: working, on: { change: event => run(() => goTo(flatSteps.find(item => item.id === event.target.value))) } });
    chapter.steps.forEach(item => choices.append(el("option", { value: item.id, text: `${statusLabel(current?.progress?.[item.id])} · ${item.title}`, selected: item.id === active.id })));
    content.append(choices, el("div", { class: "onboarding-step-head" }, [el("h3", { text: active.title }), badge(progress.label, progress.complete ? "good" : "neutral")]),
      el("p", { class: "onboarding-instruction", text: active.instruction || active.description || "" }));
    if (active.why) content.append(el("p", { class: "fine-print", text: active.why }));
    if (active.expected) content.append(el("div", { class: "onboarding-expected" }, [el("strong", { text: "完成后应看到" }), el("p", { text: active.expected })]));
    if (["review-clock-due", "review-finish"].includes(active.id) && !progress.complete) content.append(el("div", { class: "onboarding-expected" }, [
      el("p", { text: "若反馈存在争议，本轮只保留记录，不会创建或更新复习安排。可以重新练习这条知识，核对材料并提交新回答；收到明确反馈并结束后，再继续复习步骤。" }),
      button("重新练习这条知识", { kind: "text compact", disabled: busy() || !practice || !current?.modelReady, onClick: () => run(() => goTo(flatSteps.find(item => item.id === "study-start"))) }),
    ]));
    if (active.kind === "case" || active.caseId) content.append(el("p", { class: "notice", text: "这一步使用预设演示案例，不代表你的真实经历、成绩或外部连接结果。" }));
    if (active.kind === "external") content.append(el("p", { class: "fine-print", text: "外部应用需要你自行连接。标记体验只记录你的确认，不代表系统验证连接成功。" }));
    if (!core && chapter.id === "external") {
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
      actions.append(button("定位操作位置", { kind: "primary", onClick: () => run(async () => {
        await goTo(active);
        if (errorText || !highlight) return;
        if (narrowScreen()) setCompact(true);
        locate(true); flashHighlight();
      }), disabled: working }));
      if (active.sample) actions.append(button("填入示例（不提交）", { onClick: () => run(async () => { await goTo(active); await adapter.fillSample?.(active.sample, active, current); locate(true); }), disabled: working || !practice }));
      if (active.caseId) actions.append(button("准备演示案例", { onClick: () => run(() => loadCase(active)), disabled: working || !practice || !current.modelReady }));
      actions.append(button(active.kind === "read" ? "我已阅读" : active.kind === "external" ? "记录我已在外部体验" : "检查这一步", { onClick: () => run(() => checkpoint(active)), disabled: working }));
    }
    content.append(actions);
    const last = index === route.length - 1;
    const finishLabel = core ? done === coreSteps.length ? "完成体验，回正式库" : "继续核心流程" : "返回核心流程";
    content.append(el("div", { class: "onboarding-step-nav" }, [button("上一步", { kind: "text", disabled: working || index < 1, onClick: () => run(() => goTo(route[index - 1])) }),
      button(last ? finishLabel : progress.complete ? "下一步" : "先看下一步", { kind: "text", disabled: working || (last && core && done === coreSteps.length && current?.busy), onClick: () => run(() => last ? core && done === coreSteps.length ? pause() : goTo(nextCoreStep()) : goTo(route[index + 1])) })]));
    content.append(el("p", { class: "fine-print", text: "先看后面的步骤不会把当前步骤记为完成；实操进度来自实际保存的记录。" }));
    const extensions = el("details", { class: "onboarding-catalog onboarding-extensions", open: showExtensions }, [el("summary", { text: `扩展阅读（可选）· ${extensionChapters.length} 个专题` }), el("p", { class: "fine-print", text: "首次使用可以先完成核心流程。需要时再选一个专题阅读或实操，不必全部学完。" })]);
    extensionChapters.forEach(item => {
      const count = item.steps.filter(row => completed(current?.progress?.[row.id])).length;
      extensions.append(button(`${item.title.replace(/^\d+\.\s*/, "")} · 可选 · 已完成 ${count}/${item.steps.length} 步`, { kind: `text${!core && item.id === chapter.id ? " is-current" : ""}`, onClick: () => run(() => goTo(item.steps[0])), disabled: working }));
    });
    extensions.addEventListener("toggle", () => { showExtensions = extensions.open; });
    content.append(extensions);
    if (current?.practiceId) {
      if (!practice) content.append(button(current.modelReady ? "返回练习库" : "配置并测试 AI", { kind: "primary", onClick: () => run(current.modelReady ? async () => { await switchContext(current.practiceId); await adapter.navigate({ view: "today" }, current); } : openSettings), disabled: working }));
      const clock = el("details", { class: "onboarding-clock" }, [el("summary", { text: `练习时间：${practiceDate(current.clock?.now, current.clock?.timezone || current.settings?.timezone)}` }), el("p", { class: "fine-print", text: "按学习时区显示，只推进练习库的学习时间。收费额度和正式库使用真实时间。" }), el("div", { class: "onboarding-actions" }, [button("前进 1 天", { disabled: working || current.busy || !practice || !current.modelReady, onClick: () => run(() => advance("day")) }), button("跳到下次复习", { disabled: working || current.busy || !practice || !current.modelReady, onClick: () => run(() => advance("next")) })])]);
      if (active.chapterId === "review") clock.open = true;
      if (current.unfinishedSessions?.length) clock.append(el("div", { class: "page-stack" }, [el("p", { class: "fine-print", text: "下面的练习尚未结束。可以回学习页继续；确需放弃本次时，结束后才能推进时间。" }), ...current.unfinishedSessions.map(session => el("div", {}, [el("p", { class: "fine-print", text: session.title || "未完成练习" }), button("结束未完成练习", { kind: "text compact", disabled: busy() || !practice, onClick: () => abandonSession(session) })]))]));
      content.append(clock, el("div", { class: "onboarding-controls" }, [button("配置共享 API", { kind: "text compact", disabled: working || current.busy, onClick: () => run(openSettings) }), button("暂停并回正式库", { kind: "text compact", disabled: working || current.busy, onClick: () => run(pause) }), button("重置练习", { kind: "text compact", disabled: working || current.busy, onClick: () => { if (!working) reset().catch(error => { errorText = error.message; render(); }); } })]));
      if (current.busy) content.append(el("p", { class: "fine-print", text: "练习任务正在处理；完成或取消后可切换知识库、推进时间。" }));
    }
    clear(panel).append(title, content);
    content.scrollTop = scrollTop;
    if (focusToggle) toggle.focus({ preventScroll: true });
    placePanel(); locate();
  }
  function entryCard() {
    const welcome = !current?.practiceId && !stored(DISMISSED);
    const finished = coreDone() === coreSteps.length;
    if (!welcome) return el("section", { class: "panel onboarding-entry onboarding-entry-compact", dataset: { tour: "onboarding-entry" } }, [
      el("p", { class: "muted", text: finished ? "核心流程已完成，可以按需选择扩展阅读。" : current?.practiceId ? `核心体验进度：${coreDone()}/${coreSteps.length} 步，随时继续；扩展阅读按需自选。` : "用独立示例走通核心学习流程，扩展阅读按需自选。" }),
      el("div", { class: "form-actions" }, [button(finished ? "查看扩展阅读" : current?.practiceId ? "继续新手引导" : "开始新手引导", { kind: "primary", onClick: () => run(finished ? openExtensions : current?.practiceId ? resume : start) }), current?.practiceId ? button("重新练习", { kind: "text", onClick: () => reset().catch(error => toast(error.message, "error")) }) : null]),
    ]);
    return el("section", { class: `panel onboarding-entry${welcome ? " accent-panel" : ""}`, dataset: { tour: "onboarding-entry" } }, [
      el("div", {}, [el("p", { class: "eyebrow", text: current?.practiceId ? "随时继续" : "第一次使用知序" }), el("h2", { text: "先走通核心学习流程" }), el("p", { class: "muted", text: `先配置 AI，再在独立练习库体验收集加工、学习确认、复习和输出。核心共 ${coreSteps.length} 步；次要教程放在扩展阅读，按需自选。` })]),
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
    window.addEventListener("resize", () => {
      if (disposed) return;
      if (narrow !== narrowScreen()) { narrow = narrowScreen(); if (visible) render(); }
    });
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
