import { api } from "./api.mjs";
import { el, button, badge, clear, toast, confirmAction, containDialogKeyboard } from "./ui.mjs";
import { chapters, getCurriculum } from "./onboarding-curriculum.mjs";
import { materials, customMaterial, customSample, getMaterial, materialSample } from "./onboarding-materials.mjs";

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

export function chooseMaterial(initialId = "course") {
  return new Promise(resolve => {
    const returnFocus = document.activeElement;
    let selectedId = getMaterial(initialId)?.id || "course";
    const overlay = el("div", { class: "dialog-backdrop" });
    const dialog = el("div", { class: "dialog onboarding-material-dialog", role: "dialog", ariaModal: "true", ariaLabel: "选择练习材料" });
    const options = el("fieldset", { class: "onboarding-material-options" }, [el("legend", { text: "选择贴近自己的场景" })]);
    const preview = el("section", { class: "onboarding-material-preview", ariaLive: "polite" });
    const customFields = Object.fromEntries([['title', '材料标题', 200], ['body', '原文', 150000], ['note', '个人心得（可不填）', 10000], ['author', '作者（可不填）', 1000], ['url', '出处链接（可不填）', 2000], ['locator', '章节或位置（可不填）', 2000]].map(([key, label, maxLength]) => [key, { label, control: el(['body', 'note'].includes(key) ? 'textarea' : 'input', { name: `custom-${key}`, ariaLabel: label, rows: key === 'body' ? 8 : 3, maxLength }) }]));
    const customError = el("p", { class: "notice danger", role: "alert", hidden: true });
    function showPreview() {
      const item = getMaterial(selectedId);
      if (selectedId === "custom") {
        clear(preview).append(el("h3", { text: "我的练习材料" }), ...Object.values(customFields).map(({ label, control }) => el("label", { class: "field" }, [el("span", { class: "field-label", text: label }), control])),
          el("p", { class: "fine-print", text: "先在独立练习区本地保存。请核对使用权限，不要填入密码或不愿交给 AI 的敏感内容。" }), customError);
        return;
      }
      clear(preview).append(el("h3", { text: item.source.title }), el("p", { text: item.goals[2][1] + ' ' + item.goals[3][1] }),
        el("p", { class: "fine-print", text: `作者：${item.source.author} · ${item.body.length} 字选段` }),
        el("a", { href: item.source.url, target: "_blank", rel: "noopener noreferrer", text: "查看原文" }),
        el("details", {}, [el("summary", { text: "心得示例" }), el("p", { text: item.note })]),
        el("details", {}, [el("summary", { text: "原文摘录" }), el("pre", { text: item.body })]),
        el("p", { class: "fine-print", text: item.source.license }), el("a", { href: "/tutorial-examples/SOURCE-LICENSES.txt", target: "_blank", rel: "noopener noreferrer", text: "来源与许可说明" }));
    }
    [...materials, customMaterial].forEach(item => options.append(el("label", { class: "onboarding-material-option" }, [
      el("input", { type: "radio", name: "tutorial-material", value: item.id, checked: item.id === selectedId, on: { change: event => { selectedId = event.target.value; showPreview(); } } }),
      el("span", {}, [el("strong", { text: item.id === 'custom' ? '自行粘贴练习材料' : item.label.slice(2) }), el("span", { class: "fine-print", text: item.audience })]),
    ])));
    const finish = value => {
      if (value?.materialId === 'custom') {
        try { customSample(value.customMaterial); }
        catch (error) { customError.hidden = false; customError.textContent = error.message; return; }
      }
      overlay.remove(); if (returnFocus?.isConnected) returnFocus.focus(); resolve(value);
    };
    dialog.append(el("h2", { text: "选择练习材料" }), el("div", { class: "onboarding-material-layout" }, [options, preview]),
      el("div", { class: "dialog-actions" }, [button("取消", { onClick: () => finish(null) }), button("使用这份材料", { kind: "primary", onClick: () => finish(selectedId === 'custom' ? { materialId: 'custom', customMaterial: Object.fromEntries(Object.entries(customFields).map(([key, field]) => [key, field.control.value || ''])) } : selectedId) })]));
    containDialogKeyboard(dialog, () => finish(null));
    overlay.append(dialog); document.body.append(overlay); showPreview();
    dialog.querySelector('input:checked')?.focus();
  });
}

function downloadMaterial(item) {
  const material = getMaterial(item.material);
  const body = item.exercise ? `【应用练习题】\n\n${material.transfer}${material.transferCode ? '\n\n' + material.transferCode : ''}\n\n目标：${material.goals[3][1]}` : materialSample(item.material, true).body;
  const url = URL.createObjectURL(new Blob([body], { type: "text/plain;charset=utf-8" }));
  const link = el("a", { href: url, download: item.title });
  document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function getStepProgress(state, step) {
  const progress = state?.progress?.[step.id] || { status: "pending" };
  return { ...progress, label: statusLabel(progress), complete: completed(progress) };
}

export function createOnboarding(adapter) {
  let { chapters, flatSteps, coreChapters, coreSteps, extensionChapters } = getCurriculum(null);
  let current = null;
  let proofVersion = 0;
  let selected = savedStep() || "";
  let visible = false;
  let working = false;
  let errorText = "";
  let checkErrorStepId = "";
  let location = null;
  let locationNotice = null;
  let highlight = null;
  let highlightPulse = null;
  let restoreTarget = null;
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

  const step = () => {
    const row = flatSteps.find(item => item.id === selected) || flatSteps.find(item => item.id === current?.currentStepId) || flatSteps[0];
    return current?.materialId === 'custom' && row?.id === 'capture-save' ? { ...row, sample: current.customSample || null } : row;
  };
  const coreDone = () => coreSteps.filter(item => completed(current?.progress?.[item.id])).length;
  const nextCoreStep = () => coreSteps.find(item => !completed(current?.progress?.[item.id])) || coreSteps.at(-1);
  const routeChapter = target => (target.priority === "core" ? coreChapters : extensionChapters).find(chapter => chapter.steps.some(item => item.id === target.id));
  const routeSteps = target => target.priority === "core" ? coreSteps : routeChapter(target).steps;
  const inPractice = () => Boolean(api.getContext().practiceId);
  const busy = () => working || Boolean(current?.busy) || api.getContext().pending > 0;
  const stateBody = extra => ({ practiceId: current?.practiceId || api.getContext().practiceId, ...extra });
  function adopt(value) { current = value?.onboarding || value; ({ chapters, flatSteps, coreChapters, coreSteps, extensionChapters } = getCurriculum(current?.materialId)); proofVersion++; if (!selected) selected = current?.currentStepId || flatSteps[0]?.id; }
  function clearHighlight() { highlightPulse?.cancel(); highlightPulse = null; highlight?.classList.remove("tour-target"); highlight = null; restoreTarget?.(); restoreTarget = null; }
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
    const primary = step().focusTarget || step().target;
    const ids = location?.target?.startsWith("onboarding-") ? [location.target] : [primary, location?.target, ...(step().fallbackTargets || [])].filter(Boolean);
    const nodes = [...document.querySelectorAll("[data-tour]")];
    const drawer = document.querySelector("#drawer");
    const isVisible = node => {
      if (drawer?.classList.contains("is-open") && !drawer.contains(node) && !panel.contains(node)) return false;
      if (!node.getClientRects().length) return false;
      for (let parent = node; parent; parent = parent.parentElement) {
        if (parent.hidden || parent.inert || parent.getAttribute?.("aria-hidden") === "true") return false;
        const style = window.getComputedStyle?.(parent);
        if (style?.display === "none" || style?.visibility === "hidden") return false;
      }
      return true;
    };
    let target = null, reveal = null;
    for (const id of ids) {
      const candidates = nodes.filter(node => node.dataset.tour === id);
      for (const node of candidates) {
        for (let parent = node.parentElement; parent; parent = parent.parentElement) if (parent.tagName === "DETAILS") parent.open = true;
        const restore = node === highlight ? null : adapter.revealTarget?.(node);
        if (isVisible(node)) { target = node; reveal = restore; break; }
        restore?.();
      }
      if (target) break;
    }
    if (target !== highlight) {
      clearHighlight(); highlight = target; restoreTarget = reveal || null;
    }
    if (locationNotice) {
      locationNotice.textContent = target?.dataset.tour === primary ? "" : location?.message || (target ? "已框选本步相关入口；完成当前操作后会继续定位下一处控件。" : "当前操作尚未出现。请先完成本步说明中的前置操作，再点击定位；已保存的进度不会受影响。");
      locationNotice.hidden = !locationNotice.textContent;
    }
    if (highlight) {
      highlight.classList.add("tour-target");
      if (scroll) highlight.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    }
    return Boolean(highlight);
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
  async function run(action, { flash = false } = {}) {
    if (working) return;
    working = true; errorText = ""; checkErrorStepId = ""; render();
    try { await action(); }
    catch (error) { errorText = error.message || "本次操作未完成，请稍后重试。"; compact = false; }
    finally { working = false; render(); if (flash && !errorText) { locate(true); flashHighlight(); } }
  }
  async function refreshProof() {
    if (!current?.practiceId || refreshing || disposed) return;
    const practiceId = current.practiceId, context = api.getContext();
    let version = proofVersion;
    const stillCurrent = () => !disposed && proofVersion === version && current?.practiceId === practiceId
      && api.getContext().practiceId === context.practiceId && api.getContext().version === context.version;
    refreshing = true;
    try {
      const proof = await api.onboarding("state", stateBody({}), { background: true });
      if (!stillCurrent()) return;
      adopt(proof);
      version = proofVersion;
      if (checkErrorStepId === step()?.id && getStepProgress(current, step()).complete) {
        errorText = ""; checkErrorStepId = "";
      }
      render();
    }
    catch (error) { if (stillCurrent() && error.code !== "STALE_CONTEXT") { errorText = error.message; checkErrorStepId = ""; compact = false; render(); } }
    finally { refreshing = false; }
  }
  async function switchContext(id, destination) {
    if (current?.busy) throw new Error("练习任务仍在处理，请先等待完成或到任务页取消，再切换知识库。");
    api.setContext(id);
    await adapter.contextChanged?.();
    if (destination) await adapter.navigate(destination, current);
  }
  async function goTo(target = step()) {
    selected = target.id; rememberStep(selected); compact = false; errorText = ""; checkErrorStepId = ""; location = null;
    if (current?.practiceId) adopt(await api.onboarding("checkpoint", stateBody({ stepId: target.id, mode: "check" })));
    const chapter = stepChapter(target);
    const first = chapters[0]?.id;
    if (chapter?.id !== first && !current?.modelReady) {
      location = { target: "onboarding-prerequisite", prerequisite: "setup-model", message: "请先在第一章保存 AI 配置并测试成功，再进入实操。" };
      render();
      return;
    }
    const id = ["settings-model", "settings-capabilities", "settings-mcp", "settings-save"].includes(target.target) ? "" : current?.practiceId;
    if (!current?.practiceId) return;
    if (api.getContext().practiceId !== (id || "")) await switchContext(id || "");
    location = await adapter.navigate(target, current);
    render(); locate(true);
  }
  async function start() {
    const choice = await chooseMaterial();
    if (!choice) return;
    adopt(await api.onboarding("start", typeof choice === 'string' ? { materialId: choice } : choice)); visible = true;
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
    const choice = await chooseMaterial(current?.materialId);
    if (!choice) return;
    if (!await confirmAction({ title: "重新开始新手练习？", message: "只清理独立练习库及其练习记录。正式知识、正式 API 配置和密钥会保留。", confirmText: "重置练习", danger: true })) return;
    adopt(await api.onboarding("reset", stateBody(typeof choice === 'string' ? { materialId: choice } : choice)));
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
    location = await adapter.navigate(target, current);
    toast("演示案例已准备，可以跟着提示操作了。", "success");
  }
  async function checkpoint(target) {
    try { adopt(await api.onboarding("checkpoint", stateBody({ stepId: target.id, mode: target.kind === "read" ? "read" : target.kind === "external" ? "external" : "check" }))); }
    catch (error) { checkErrorStepId = target.id; throw error; }
    const result = getStepProgress(current, target);
    if (!result.complete) {
      errorText = result.message || result.reason || "尚未找到这一步的完成记录。请按说明完成操作，再检查进度。";
      checkErrorStepId = target.id;
    }
    else if (target.kind === "read") {
      const route = routeSteps(target);
      const next = route[route.findIndex(item => item.id === target.id) + 1];
      if (next) await goTo(next);
    } else {
      const message = target.kind === "external" ? "体验进度已记录，可以继续下一步。" : result.status === "demonstrated" ? "这一步已完成，进度已记为“已看案例”。" : "这一步已完成，可以继续了。";
      toast(message, "success");
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
    if (active.overview?.length) content.append(el("ul", { class: "onboarding-overview", ariaLabel: "首页功能" }, active.overview.map(item => el("li", {}, [el("strong", { text: item.title }), el("p", { text: item.body })]))));
    const material = getMaterial(current?.materialId);
    if (material) content.prepend(el("p", { class: "fine-print", text: `练习材料：${material.id === 'custom' ? current.customSample?.title || '自行粘贴' : material.label.slice(2)}` }));
    if (material && /^library-(aware|find|explain|apply)$/.test(active.id)) {
      const role = active.id.slice(8), selectedNote = current.roles?.[role];
      const select = el("select", { ariaLabel: "选择本原文的实际知识", disabled: working || role === "explain" && current.learningStarted, on: { change: event => run(async () => {
        if (!event.target.value) return;
        adopt(await api.onboarding("select-knowledge", stateBody({ noteId: event.target.value, role })));
        location = await adapter.navigate(step(), current);
      }) } });
      select.dataset.tour = "onboarding-knowledge";
      select.append(el("option", { value: "", text: "选择一条实际候选知识", selected: !selectedNote }));
      const unavailable = note => Boolean(note.limitations?.length || (role === "explain" ? ["aware", "find", "apply"].some(other => current.roles?.[other] === note.id) : current.roles?.explain === note.id));
      (current.learningCandidates || []).forEach(note => select.append(el("option", { value: note.id, text: `${note.title}${note.limitations?.length ? "（待核验或复查）" : ""}`, selected: note.id === selectedNote, disabled: unavailable(note) })));
      content.append(select);
      if (!(current.learningCandidates || []).length) content.append(el("p", { class: "notice", text: "本原文还没有实际候选，请先完成拆解。" }));
      else if (current.learningCandidates.every(unavailable)) content.append(el("div", {}, [el("p", { class: "notice", text: "这个目标还没有可用的独立条目。可从原文手动整理另一项内容；事实仍须核验，尚不可用时保留未完成。不要改变主线知识的目标来补齐扩展。" }), button("整理另一条知识", { kind: "text compact", disabled: working || !current.roles?.capturedSource, onClick: () => run(() => goTo(flatSteps.find(item => item.id === "process-manual"))) })]));
      if ((current.learningCandidates || []).some(note => note.limitations?.length)) {
        let openedByHover = false;
        const explanation = el("details", { class: "onboarding-verification-help" }, [
          el("summary", { text: "为什么待核验的事实不能进入主线？", on: { click: event => {
            if (openedByHover) { event.preventDefault(); openedByHover = false; explanation.open = true; }
          } } }),
          el("p", { text: "主线知识会用于接下来的练习和复习。尚未核验的事实可能有错误、缺少依据或适用条件，反复练习会加深错误理解。先联网核验并审阅来源、结论和适用范围，再决定是否加入学习；联网返回的结果也需要你判断。" }),
        ]);
        explanation.addEventListener("mouseenter", () => { if (!explanation.open) { openedByHover = true; explanation.open = true; } });
        explanation.addEventListener("mouseleave", () => { if (openedByHover && !explanation.contains(document.activeElement)) { explanation.open = false; openedByHover = false; } });
        content.append(el("div", {}, [el("div", { class: "notice" }, [el("p", { text: "待核验的事实不能选入主线。请先联网加工并审阅返回依据。" }), explanation]), button("前往联网核验", { kind: "text compact", disabled: working, onClick: () => run(() => goTo(flatSteps.find(item => item.id === "process-research"))) })]));
      }
    }
    if (active.why) content.append(el("p", { class: "fine-print", text: active.why }));
    if (["process-done", "research-done"].includes(active.check)) {
      const processing = adapter.processStatus?.(current?.roles?.[active.noteRole]);
      if (processing?.active) content.append(el("div", { class: "process-status onboarding-process-status", role: "status", ariaLive: "polite" }, [
        el("span", { class: "spinner process-spinner", ariaHidden: "true" }), el("span", { text: processing.message }),
      ]));
      else if (processing && ["waiting", "failed", "cancelled"].includes(processing.state)) content.append(el("p", { class: "notice", role: "status", text: processing.message }));
    }
    if (active.expected) content.append(el("div", { class: "onboarding-expected" }, [el("strong", { text: "完成后应看到" }), el("p", { text: active.expected })]));
    if (["review-clock-due", "review-finish"].includes(active.id) && !progress.complete) content.append(el("div", { class: "onboarding-expected" }, [
      el("p", { text: "若反馈存在争议，本轮只保留记录，不会创建或更新复习安排。可以重新练习这条知识，核对材料并提交新回答；收到明确反馈并结束后，再继续复习步骤。" }),
      button("重新练习这条知识", { kind: "text compact", disabled: busy() || !practice || !current?.modelReady, onClick: () => run(() => goTo(flatSteps.find(item => item.id === "study-start"))) }),
    ]));
    if (active.kind === "case" || active.caseId) content.append(el("p", { class: "notice", text: "预设演示案例：点击“准备演示案例”，跟着提示看看这项功能如何使用。" }));
    if (active.kind === "external") content.append(el("p", { class: "fine-print", text: "按本步说明完成配置或操作后，可以记录体验进度；暂时用不到，也可以以后再来。" }));
    if (!core && chapter.id === "external") {
      const connections = current?.externalConnections || {};
      const mcp = connections.mcp || {};
      const obsidian = connections.obsidian || {};
      const mcpText = mcp.status === "observed" ? `已找到调用记录${mcp.lastSeenAt ? `（${practiceDate(mcp.lastSeenAt, current?.settings?.timezone)}）` : ""}；可在诊断页查看详情` : mcp.status === "reported" ? "体验已记录，尚未找到调用记录" : "待配置或体验";
      const obsidianText = obsidian.status === "reported" ? `用户确认已打开${obsidian.editReported ? "；用户确认已体验外部编辑" : "；外部编辑待体验"}` : "尚未接通 / 待体验";
      content.append(el("div", { class: "onboarding-expected" }, [el("strong", { text: "外部工具体验状态" }), el("p", { text: `MCP：${mcpText}` }), el("p", { text: `Obsidian：${obsidianText}` })]));
    }
    if (active.downloads?.length) content.append(el("div", { class: "onboarding-actions" }, active.downloads.map(item => item.material ? button(`下载 ${item.title}`, { kind: "quiet compact", onClick: () => downloadMaterial(item) }) : item.href?.startsWith("/tutorial-examples/") ? el("a", { href: item.href, download: item.title, class: "quiet-button compact", text: `下载 ${item.title}` }) : null)));
    locationNotice = el("p", { class: "notice info", role: "status", hidden: true });
    content.append(locationNotice);
    if (location?.prerequisite) {
      const prerequisiteId = location.prerequisite;
      const prerequisite = button("先去完成前置步骤", { onClick: () => run(() => goTo(flatSteps.find(item => item.id === prerequisiteId))), disabled: working });
      prerequisite.dataset.tour = "onboarding-prerequisite"; content.append(prerequisite);
    }
    if (errorText) content.append(el("p", { class: "notice danger", role: "alert", text: errorText }));
    if (progress.message || progress.reason) content.append(el("p", { class: "fine-print", text: progress.message || progress.reason }));
    const last = index === route.length - 1;
    const finishLabel = core ? done === coreSteps.length ? "完成体验，回正式库" : "继续核心流程" : "返回核心流程";
    const continueRoute = () => last ? core && done === coreSteps.length ? pause() : goTo(nextCoreStep()) : goTo(route[index + 1]);
    const canContinue = active.kind !== "read" && progress.complete;
    const actions = el("div", { class: "onboarding-actions" });
    if (!current?.practiceId) actions.append(button("创建独立练习库", { kind: "primary", onClick: () => run(start), disabled: working }));
    else {
      actions.append(button("定位操作位置", { kind: "primary", onClick: () => run(async () => {
        await goTo(active);
        if (errorText || !highlight) return;
        if (narrowScreen() && !panel.contains(highlight)) setCompact(true);
        locate(true);
      }, { flash: true }), disabled: working }));
      if (active.sample) actions.append(button("填入示例（不提交）", { onClick: () => run(async () => { await goTo(active); if (location?.prerequisite || ["onboarding-case", "onboarding-reset"].includes(location?.target)) return; await adapter.fillSample?.(active.sample, active, current); locate(true); }), disabled: working || !practice }));
      if (active.caseId) {
        const prepare = button("准备演示案例", { onClick: () => run(() => loadCase(active)), disabled: working || !practice || !current.modelReady });
        prepare.dataset.tour = "onboarding-case"; actions.append(prepare);
      }
      actions.append(button(canContinue ? last ? finishLabel : "进行下一步" : active.kind === "read" ? "我已阅读" : active.kind === "external" ? "记录我已在外部体验" : "检查这一步", { kind: canContinue ? "primary" : "quiet", onClick: () => run(canContinue ? continueRoute : () => checkpoint(active)), disabled: working || (canContinue && last && core && done === coreSteps.length && current?.busy) }));
    }
    content.append(actions);
    content.append(el("div", { class: "onboarding-step-nav" }, [button("上一步", { kind: "text", disabled: working || index < 1, onClick: () => run(() => goTo(route[index - 1])) }),
      button(last ? finishLabel : progress.complete ? "下一步" : "先看下一步", { kind: "text", disabled: working || (last && core && done === coreSteps.length && current?.busy), onClick: () => run(continueRoute) })]));
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
      const clock = el("details", { class: "onboarding-clock" }, [el("summary", { text: `练习时间：${practiceDate(current.clock?.now, current.clock?.timezone || current.settings?.timezone)}` }), el("p", { class: "fine-print", text: "按学习时区显示，只推进练习库的学习时间。收费额度和正式库使用真实时间。" }), el("div", { class: "onboarding-actions" }, [el("div", { dataset: { tour: "onboarding-clock-day" } }, button("前进 1 天", { disabled: working || current.busy || !practice || !current.modelReady, onClick: () => run(() => advance("day")) })), el("div", { dataset: { tour: "onboarding-clock-due" } }, button("跳到下次复习", { disabled: working || current.busy || !practice || !current.modelReady, onClick: () => run(() => advance("next")) }))])]);
      if (active.chapterId === "review") clock.open = true;
      if (current.unfinishedSessions?.length) clock.append(el("div", { class: "page-stack" }, [el("p", { class: "fine-print", text: "下面的练习尚未结束。可以回学习页继续；确需放弃本次时，结束后才能推进时间。" }), ...current.unfinishedSessions.map(session => el("div", {}, [el("p", { class: "fine-print", text: session.title || "未完成练习" }), button("结束未完成练习", { kind: "text compact", disabled: busy() || !practice, onClick: () => abandonSession(session) })]))]));
      content.append(clock, el("div", { class: "onboarding-controls" }, [button("配置共享 API", { kind: "text compact", disabled: working || current.busy, onClick: () => run(openSettings) }), button("暂停并回正式库", { kind: "text compact", disabled: working || current.busy, onClick: () => run(pause) }), el("span", { dataset: { tour: "onboarding-reset" } }, [button("重置练习", { kind: "text compact", disabled: working || current.busy, onClick: () => { if (!working) reset().catch(error => { errorText = error.message; checkErrorStepId = ""; compact = false; render(); }); } })])]));
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
      if (!current?.practiceId || event.detail?.background || event.detail?.path?.startsWith("/api/onboarding/")) return;
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
