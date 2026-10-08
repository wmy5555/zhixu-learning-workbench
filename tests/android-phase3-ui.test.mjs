import assert from "node:assert/strict";
import test from "node:test";
import { click, control, createAndroidBrowser, descendants, findButton } from "./fixtures/android-browser.mjs";

const source = { id: "reflection", kind: "source", title: "合成反思", body: "我希望先回忆，再查材料。", hash: "synthetic-source-hash", meta: {}, children: [] };
const bootstrap = async () => ({ notes: [], today: { items: [] }, stats: {} });
const guide = async () => ({ steps: [{ id: "sources", label: "保存原文", completed: true }, { id: "answer", label: "保存回答", completed: false }] });

const prerequisiteA = "11111111-1111-4111-8111-111111111111";
const prerequisiteB = "22222222-2222-4222-8222-222222222222";
const retiredPrerequisite = "33333333-3333-4333-8333-333333333333";
const missingPrerequisite = "44444444-4444-4444-8444-444444444444";
async function topicPrerequisiteFixture(notes, initialTopic = null) {
  let topics = initialTopic ? [initialTopic] : [];
  const requests = [];
  const fixture = await createAndroidBrowser({ api: {
    notes: async () => ({ notes }), topics: async () => ({ topics }), bootstrap: async () => ({ notes, topics }),
    createTopic: async payload => { requests.push({ action: "create", payload }); const saved = { id: "saved-topic", ...payload, members: [], progress: {} }; topics = [saved]; return saved; },
    updateTopic: async (id, payload) => { requests.push({ action: "edit", id, payload }); const saved = { ...initialTopic, title: payload.title, body: payload.body, meta: { ...initialTopic.meta, ...payload.meta }, prerequisites: payload.meta.prerequisites, members: [], progress: {} }; topics = [saved]; return saved; },
  } });
  await fixture.app.navigate("topics");
  if (initialTopic) { await click(findButton(fixture.app.refs.main, "查看")); await click(findButton(fixture.app.refs.drawerBody, "调整成员与顺序")); }
  else await click(findButton(fixture.app.refs.main, "新建主题学习包"));
  return { ...fixture, requests };
}

test("Android topic creation selects eligible saved knowledge IDs instead of textual prerequisites", async () => {
  const notes = [
    { id: prerequisiteA, kind: "knowledge", title: "可用前置", meta: { stage: "candidate" }, limitations: [] },
    { id: prerequisiteB, kind: "knowledge", title: "尚待核验", meta: { stage: "candidate" }, limitations: ["事实尚待核验"] },
    { id: retiredPrerequisite, kind: "knowledge", title: "停用前置", meta: { stage: "retired" }, limitations: [] },
    { id: missingPrerequisite, kind: "knowledge", title: "已被替代", meta: { stage: "learning", supersededBy: prerequisiteA }, limitations: [] },
  ];
  const fixture = await topicPrerequisiteFixture(notes);
  const form = fixture.app.refs.drawerBody.querySelector("form");
  assert.equal(control(form, "prerequisites"), undefined);
  const choices = descendants(form).filter(node => node.name === "topicPrerequisite");
  assert.equal(choices.length, 1);
  assert.equal(choices[0].value, prerequisiteA);
  control(form, "title").value = "新主题草稿"; control(form, "body").value = "已写的问题说明";
  choices[0].checked = true; choices[0].events.change();
  assert.equal(control(form, "title").value, "新主题草稿");
  assert.equal(control(form, "body").value, "已写的问题说明");
  await form.events.submit({ preventDefault() {} });
  assert.equal(fixture.requests[0].action, "create");
  assert.deepEqual(Array.from(fixture.requests[0].payload.prerequisites), [prerequisiteA]);
});

test("Android topic editing keeps old missing text and blocked prerequisites visible until explicitly corrected", async () => {
  const notes = [
    { id: prerequisiteA, kind: "knowledge", title: "原有效前置", meta: { stage: "learning" }, limitations: [] },
    { id: prerequisiteB, kind: "knowledge", title: "替代前置", meta: { stage: "candidate" }, limitations: [] },
    { id: retiredPrerequisite, kind: "knowledge", title: "已受限前置", meta: { stage: "candidate" }, limitations: ["事实尚待核验"] },
  ];
  const topic = { id: "topic", title: "旧主题", body: "旧说明", hash: "expected-topic-hash", meta: {}, prerequisites: [prerequisiteA, "先学方程", missingPrerequisite, retiredPrerequisite], members: [], progress: {} };
  const fixture = await topicPrerequisiteFixture(notes, topic);
  const form = fixture.app.refs.drawerBody.querySelector("form"), submit = findButton(form, "保存主题学习包");
  assert.match(form.textContent, /先学方程（未找到对应知识，保留原有前置）/);
  assert.match(form.textContent, /已受限前置（当前不可用，保留原有前置）/);
  assert.match(form.textContent, new RegExp(missingPrerequisite));
  assert.equal(submit.disabled, true);
  await form.events.submit({ preventDefault() {} });
  assert.equal(fixture.requests.length, 0);
  control(form, "title").value = "未提交的新标题"; control(form, "body").value = "未提交的说明和文字缺口";
  const replacement = descendants(form).find(node => node.name === "topicPrerequisite" && node.value === prerequisiteB);
  replacement.checked = true; replacement.events.change();
  assert.equal(submit.disabled, true, "choosing a replacement must not silently discard old invalid prerequisites");
  for (let remaining = 3; remaining > 0; remaining--) await click(findButton(form, "移除此失效前置"));
  assert.equal(control(form, "title").value, "未提交的新标题");
  assert.equal(control(form, "body").value, "未提交的说明和文字缺口");
  assert.equal(submit.disabled, false);
  await form.events.submit({ preventDefault() {} });
  assert.equal(fixture.requests[0].action, "edit");
  assert.equal(fixture.requests[0].payload.expectedHash, topic.hash);
  assert.deepEqual(Array.from(fixture.requests[0].payload.meta.prerequisites), [prerequisiteA, prerequisiteB]);
});

test("Android topic creation with no eligible prerequisite can explicitly save without new prerequisites", async () => {
  const fixture = await topicPrerequisiteFixture([{ id: prerequisiteA, kind: "knowledge", title: "待核验知识", meta: { stage: "candidate" }, limitations: ["尚待核验"] }]);
  const form = fixture.app.refs.drawerBody.querySelector("form");
  assert.match(form.textContent, /当前没有可用的前置知识/);
  assert.equal(control(form, "topicPrerequisite"), undefined);
  control(form, "title").value = "暂不设前置"; control(form, "body").value = "保留真实问题";
  assert.equal(findButton(form, "创建主题学习包").disabled, false);
  await form.events.submit({ preventDefault() {} });
  assert.deepEqual(Array.from(fixture.requests[0].payload.prerequisites), []);
});

test("Android topic member starts only the current next step and disabled starts make no request", async () => {
  for (const scenario of [
    { label: "A is next", progress: { nextNoteId: "a", nextNoteTitle: "A" }, members: [{ id: "a", available: true }, { id: "b", available: true }], enabled: "a" },
    { label: "A is blocked", progress: { nextNoteId: null, blockedNoteId: "a" }, members: [{ id: "a", available: false }, { id: "b", available: true }], enabled: null },
    { label: "A is paused", progress: { nextNoteId: null, blockedNoteId: "a" }, members: [{ id: "a", available: false }, { id: "b", available: true }], enabled: null },
    { label: "A is confirmed and B is next", progress: { nextNoteId: "b", nextNoteTitle: "B" }, members: [{ id: "a", available: true, completed: true }, { id: "b", available: true }], enabled: "b" },
    { label: "topic is paused", paused: true, progress: { nextNoteId: "a" }, members: [{ id: "a", available: true }, { id: "b", available: true }], enabled: null },
  ]) {
    const calls = [], topic = { id: "topic", title: "有前置顺序的主题", body: "先A再B", ...scenario };
    const session = { id: "session", noteId: scenario.enabled, status: "reading", turns: [], material: "本地材料" };
    const fixture = await createAndroidBrowser({ api: { topics: async () => ({ topics: [topic] }), startStudy: async body => { calls.push({ ...body }); return session; }, study: async () => session } });
    await fixture.app.navigate("topics");
    await click(findButton(fixture.app.refs.main, "查看"));
    const starts = descendants(fixture.app.refs.drawerBody).filter(node => node.tagName === "button" && node.textContent === "开始");
    assert.equal(starts.length, 2, scenario.label);
    for (let index = 0; index < starts.length; index++) {
      assert.equal(starts[index].disabled, scenario.members[index].id !== scenario.enabled, scenario.label);
      if (starts[index].disabled) await click(starts[index]);
    }
    assert.equal(calls.length, 0, `${scenario.label}: disabled members cannot send a request even when the handler is invoked`);
    const next = descendants(fixture.app.refs.drawerBody).find(node => node.tagName === "button" && (node.textContent.startsWith("开始下一条") || node.textContent === "本包暂无待继续内容"));
    assert.equal(next.disabled, !scenario.enabled, scenario.label);
    if (!scenario.enabled) { await click(next); assert.equal(calls.length, 0, scenario.label); }
    else {
      await click(starts[scenario.members.findIndex(member => member.id === scenario.enabled)]);
      assert.deepEqual(calls, [{ noteId: scenario.enabled, topicId: topic.id }]);
    }
  }
});

test("Android ordinary single knowledge remains startable without topic context", async () => {
  const calls = [], session = { id: "session", noteId: "b", status: "reading", turns: [], material: "个人反思" };
  const fixture = await createAndroidBrowser({ api: { startStudy: async body => { calls.push({ ...body }); return session; }, study: async () => session } });
  fixture.app.renderNoteDrawer({ id: "b", kind: "knowledge", title: "B的独立学习", body: "个人反思", meta: { claimType: "opinion", stage: "learning" } });
  const start = findButton(fixture.app.refs.drawerBody, "开始学习");
  assert.equal(start.disabled, false);
  await click(start);
  assert.deepEqual(calls, [{ noteId: "b" }]);
});

test("Android today and queue topic plans disable later steps while unbound single knowledge remains available", async () => {
  for (const view of ["today", "study"]) for (const next of ["a", null, "b"]) {
    const calls = [], topic = { id: "topic", progress: { nextNoteId: next, ...(next ? {} : { blockedNoteId: "a" }) } };
    const items = ["a", "b", "single"].map(noteId => ({ id: `plan-${noteId}`, noteId, title: noteId, kind: "study", state: "pending", minutes: 5, ...(noteId === "single" ? {} : { topicId: "topic" }) }));
    const session = { id: "session", noteId: next, status: "reading", turns: [], material: "本地材料" };
    const fixture = await createAndroidBrowser({ api: {
      bootstrap: async () => ({ topics: [topic], today: { items, budget: 25 }, stats: {} }),
      today: async () => ({ items }), topics: async () => ({ topics: [topic] }), notes: async () => ({ notes: [] }), studySessions: async () => ({ sessions: [] }),
      startStudy: async body => { calls.push({ ...body }); return session; }, study: async () => session,
    } });
    await fixture.app.navigate(view);
    const starts = descendants(fixture.app.refs.main).filter(node => node.tagName === "button" && node.textContent === (view === "today" ? "开始" : "开始学习"));
    assert.equal(starts.length, 3);
    assert.equal(starts[0].disabled, next !== "a", `${view}: A follows current progress`);
    assert.equal(starts[1].disabled, next !== "b", `${view}: B follows current progress`);
    assert.equal(starts[2].disabled, false, `${view}: unbound knowledge stays available`);
    for (const start of starts.filter(node => node.disabled)) await click(start);
    assert.equal(calls.length, 0, `${view}: disabled topic plan sends no request`);
    if (next) { await click(starts[next === "a" ? 0 : 1]); assert.deepEqual(calls, [{ noteId: next, planId: `plan-${next}`, topicId: "topic" }]); }
  }
});

test("Android learning restore keeps committed success when bootstrap refresh fails and does not repeat restore", async () => {
  let nativeCalls = 0, refreshCalls = 0;
  const fixture = await createAndroidBrowser({ api: { androidGuide: guide,
    previewAndroidLearningBackup: async () => ({ token: "consumed-learning-token", context: "formal", notes: 1, history: 1, canRestore: true }),
    restoreAndroidLearningBackup: async token => { assert.equal(token, "consumed-learning-token"); nativeCalls++; return { restored: true, unchanged: false }; },
    bootstrap: async () => { refreshCalls++; throw new Error("bootstrap unavailable after commit"); },
  } });
  await fixture.app.renderSystem();
  const main = fixture.app.refs.main;
  await click(findButton(main, "选择学习备份并预览"));
  const reviewed = control(main, "learningRestoreReviewed"), restore = findButton(main, "确认恢复学习记录");
  reviewed.checked = true; reviewed.events.change();
  await click(restore);
  assert.equal(nativeCalls, 1);
  assert.equal(refreshCalls, 1);
  assert.match(main.textContent, /学习记录恢复完成/);
  assert.match(main.textContent, /页面刷新未完成/);
  assert.match(main.textContent, /无需再次恢复备份/);
  assert.equal(restore.disabled, true);
  assert.equal(reviewed.checked, false);
  assert.equal(reviewed.disabled, true);
  await click(restore);
  assert.equal(nativeCalls, 1);
  assert.doesNotMatch(fixture.document.querySelector("#toast-region").textContent, /bootstrap unavailable after commit/);
});

test("Android current learning after restart exposes saved completed session and reloads the original answer", async () => {
  const calls = [];
  const summary = { id: "persisted-session", noteId: "knowledge", status: "completed", createdAt: "2026-10-08T10:00:00Z", question: "怎样反思", turns: [] };
  const fixture = await createAndroidBrowser({ api: { studySessions: async () => ({ sessions: [{ ...summary, id: "older", createdAt: "2026-10-07T10:00:00Z" }, summary] }), study: async id => { calls.push(id); return { ...summary, turns: [{ answer: "飞行模式下保存的原始回答" }], completion: { reviewSettled: false } }; } } });
  fixture.app.state.studyTab = "session";
  assert.equal(fixture.app.state.currentStudy, null);
  await fixture.app.renderStudy();
  assert.ok(findButton(fixture.app.refs.main, "查看最近记录"));
  assert.ok(findButton(fixture.app.refs.main, "查看全部已保存记录"));
  assert.doesNotMatch(fixture.app.refs.main.textContent, /还没有进行中的学习/);
  await click(findButton(fixture.app.refs.main, "查看最近记录"));
  assert.deepEqual(calls, ["persisted-session"]);
  assert.match(fixture.app.refs.main.textContent, /飞行模式下保存的原始回答/);
  assert.match(fixture.app.refs.main.textContent, /未批改/);
});

test("Android today hero counts pending work separately from saved completed records", async () => {
  const done = { id: "done", noteId: "saved", title: "已保存学习", state: "done", kind: "study", minutes: 30 };
  const pending = { id: "pending", noteId: "next", title: "待学习", state: "pending", kind: "study", minutes: 7 };
  const fixture = await createAndroidBrowser({ api: { bootstrap: async () => ({ today: { items: [done, pending], minutes: 37, budget: 25 }, stats: {} }) } });
  await fixture.app.navigate("today");
  assert.match(fixture.app.refs.main.textContent, /今天还有 1 项待学习/);
  assert.match(fixture.app.refs.main.textContent, /待学习预计 7 分钟/);
  assert.match(fixture.app.refs.main.textContent, /已结束并保存 1 项记录/);
  fixture.app.state.bootstrap = { today: { items: [done], minutes: 0, budget: 25 }, stats: {} };
  await fixture.app.navigate("today");
  assert.match(fixture.app.refs.main.textContent, /今天已保存 1 项学习记录/);
  assert.match(fixture.app.refs.main.textContent, /待学习预计 0 分钟/);
  assert.doesNotMatch(fixture.app.refs.main.textContent, /今天有 1 项值得投入/);
});

test("Android starting study from an open source drawer reveals learning and failed start preserves the drawer", async () => {
  const child = { id: "knowledge", kind: "knowledge", title: "我的观点", body: "个人反思", meta: { claimType: "opinion", stage: "learning" } };
  const session = { id: "session", noteId: child.id, status: "reading", turns: [], material: child.body };
  let resolveStart;
  const starting = new Promise(resolve => { resolveStart = resolve; });
  const fixture = await createAndroidBrowser({ api: { startStudy: async () => starting, study: async () => session } });
  fixture.app.renderSourceGroupDrawer({ ...source, children: [child] });
  fixture.app.refs.drawer.classList.add("is-open"); fixture.app.refs.drawerBackdrop.hidden = false;
  const request = click(findButton(fixture.app.refs.drawerBody, "开始学习"));
  assert.equal(fixture.app.refs.drawer.classList.contains("is-open"), true);
  resolveStart(session); await request;
  assert.equal(fixture.app.state.view, "study");
  assert.equal(fixture.app.refs.drawer.classList.contains("is-open"), false);
  assert.equal(fixture.app.refs.drawerBackdrop.hidden, true);
  assert.match(fixture.app.refs.main.textContent, /学习材料/);
  assert.equal(descendants(fixture.app.refs.main).filter(node => node.tagName === "strong" && node.textContent === "手机本地学习").length, 1);

  const failed = await createAndroidBrowser({ api: { startStudy: async () => { throw new Error("暂不能开始"); } } });
  failed.app.renderSourceGroupDrawer({ ...source, children: [child] });
  failed.app.refs.drawer.classList.add("is-open"); failed.app.refs.drawerBackdrop.hidden = false;
  await click(findButton(failed.app.refs.drawerBody, "开始学习"));
  assert.equal(failed.app.refs.drawer.classList.contains("is-open"), true);
  assert.equal(failed.app.refs.drawerBackdrop.hidden, false);
  assert.equal(failed.app.state.currentStudy, null);
});

test("Android manual extraction defaults to facts and explicitly preserves classification, depth and reason", async () => {
  const requests = [];
  const fixture = await createAndroidBrowser({ api: { bootstrap, note: async () => source, extractSource: async (id, payload) => { requests.push({ id, ...payload }); return { id: "knowledge" }; } } });
  fixture.app.renderSourceGroupDrawer(source);
  await click(findButton(fixture.app.refs.drawerBody, "手动整理为待选学"));
  const form = fixture.app.refs.drawerBody.querySelector("form");
  assert.equal(control(form, "claimType").children[0].selected, true);
  assert.equal(control(form, "claimType").value, "fact");
  assert.match(fixture.app.refs.drawerBody.textContent, /含事实.*待研究/);
  for (const [name, value] of Object.entries({ title: "我的反思", body: "我的个人观点", claimType: "opinion", depth: "explain", reason: "回顾个人学习方式", topic: "反思" })) control(form, name).value = value;
  await form.events.submit({ preventDefault() {} });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].claimType, "opinion");
  assert.equal(requests[0].depth, "explain");
  assert.equal(requests[0].reason, "回顾个人学习方式");
  assert.equal(requests[0].expectedHash, source.hash);
});

test("Android factual knowledge cannot start learning and knowledge edits retain expected hash and depth", async () => {
  const note = { id: "knowledge", kind: "knowledge", title: "待核验事实", body: "内容", hash: "original-hash", meta: { stage: "candidate", claimType: "fact", depth: "explain", privacy: "local", researchLimitations: ["尚待核验"] } };
  let saved;
  const fixture = await createAndroidBrowser({ api: { bootstrap, updateNote: async (id, payload) => { saved = { id, ...payload }; return { ...note, hash: "updated-hash" }; } } });
  fixture.app.renderNoteDrawer(note);
  assert.equal(findButton(fixture.app.refs.drawerBody, "查看版本"), undefined);
  assert.match(fixture.app.refs.drawerBody.textContent, /历史随学习记录备份保留/);
  assert.equal(findButton(fixture.app.refs.drawerBody, "开始学习").disabled, true);
  assert.equal(findButton(fixture.app.refs.drawerBody, "加入学习").disabled, true);
  await click(findButton(fixture.app.refs.drawerBody, "编辑"));
  const form = fixture.app.refs.drawerBody.querySelector("form");
  assert.equal(control(form, "depth").disabled, false);
  control(form, "title").value = "新标题"; control(form, "body").value = "新正文"; control(form, "depth").value = "apply";
  await form.events.submit({ preventDefault() {} });
  assert.equal(saved.expectedHash, "original-hash");
  assert.equal(saved.meta.depth, "apply");
});

test("Android answers remain unassessed and only explicit finish saves completion without correct or mastery claims", async () => {
  let session = { id: "session", noteId: "knowledge", status: "reading", question: "如何回忆？", turns: [] };
  const writes = [];
  const fixture = await createAndroidBrowser({ api: { bootstrap, study: async () => session,
    answer: async (id, payload) => { writes.push(["answer", id, payload]); session = { ...session, status: "unassessed", turns: [{ answer: payload.answer }] }; return session; },
    finishStudy: async id => { writes.push(["finish", id]); session = { ...session, status: "completed", completion: { reviewSettled: false, evidence: { assessment: "correct" } } }; return session; },
  } });
  fixture.app.state.currentStudy = session; fixture.app.state.studyTab = "session"; fixture.app.state.studyMaterialVisible = false;
  await fixture.app.renderStudy();
  assert.equal(findButton(fixture.app.refs.main, "结束并保存记录").disabled, true);
  control(fixture.app.refs.main, "answer").value = "先尝试用自己的话解释";
  await fixture.app.refs.main.querySelector("form").events.submit({ preventDefault() {} });
  assert.equal(writes.length, 1);
  assert.equal(writes[0][2].hintUsed, false);
  assert.match(fixture.app.refs.main.textContent, /回答已保存在手机/);
  assert.equal(findButton(fixture.app.refs.main, "结束并保存记录").disabled, false);
  assert.equal(findButton(fixture.app.refs.main, "分级提示"), undefined);
  await click(findButton(fixture.app.refs.main, "结束并保存记录"));
  assert.equal(writes.length, 2);
  assert.match(fixture.app.refs.main.textContent, /本轮已结束并保存记录，未批改/);
  assert.doesNotMatch(fixture.app.refs.main.textContent, /独立完成|理解基本正确|跨日保持证据/);
});

test("Android user mistake writes actual user fields and marks the list as user records", async () => {
  let payload;
  const mistake = { id: "mistake", kind: "mistake", title: "误解：反思", body: "## 问题\n如何反思\n\n## 用户当时的回答\n我的已保存原答\n\n## 遗漏\n遗漏条件\n\n## 修正\n补充条件\n\n## 理由\n漏掉边界\n\n## 后续练习\n何时失效", meta: { origin: "user", omission: "遗漏条件", correction: "补充条件", nextQuestion: "何时失效", noteId: "knowledge", correctionState: "open" } };
  const fixture = await createAndroidBrowser({ api: { recordStudyMistake: async (id, body) => { assert.equal(id, "session"); payload = body; return mistake; }, mistakes: async () => ({ mistakes: [mistake] }) } });
  fixture.app.androidMistakeForm({ id: "session", turns: [{ answer: "回答" }] });
  const form = fixture.app.refs.drawerBody.querySelector("form");
  for (const [name, value] of Object.entries({ omission: "遗漏条件", correction: "补充条件", reason: "回忆时漏掉了边界", nextQuestion: "何时失效" })) control(form, name).value = value;
  await form.events.submit({ preventDefault() {} });
  assert.equal(payload.origin, "user");
  assert.equal(payload.nextQuestion, "何时失效");
  assert.equal(payload.reason, "回忆时漏掉了边界");
  await fixture.app.navigate("mistakes");
  assert.match(fixture.app.refs.main.textContent, /用户记录/);
  assert.match(fixture.app.refs.main.textContent, /遗漏条件/);
  await click(findButton(fixture.app.refs.main, "查看"));
  assert.match(fixture.app.refs.drawerBody.textContent, /我的已保存原答/);
  assert.match(fixture.app.refs.drawerBody.textContent, /何时失效/);
  assert.doesNotMatch(fixture.app.refs.drawerBody.textContent, /实际回答.*未记录/);
});

test("Android context change while saving an answer cannot restore the old study session", async () => {
  let context = { practiceId: "android-local", version: 0 }, resolveAnswer;
  const pendingAnswer = new Promise(resolve => { resolveAnswer = resolve; });
  const session = { id: "old", noteId: "knowledge", status: "reading", turns: [] };
  const fixture = await createAndroidBrowser({ api: { getContext: () => context, study: async () => session, answer: async () => pendingAnswer } });
  fixture.app.state.currentStudy = session; fixture.app.state.studyTab = "session"; fixture.app.state.studyMaterialVisible = false;
  await fixture.app.renderStudy();
  control(fixture.app.refs.main, "answer").value = "旧库中的原答";
  const submission = fixture.app.refs.main.querySelector("form").events.submit({ preventDefault() {} });
  context = { practiceId: "", version: 1 }; fixture.app.state.currentStudy = null;
  resolveAnswer({ ...session, status: "unassessed", turns: [{ answer: "旧库中的原答" }] });
  await submission;
  assert.equal(fixture.app.state.currentStudy, null);
});

test("Android practice switches explicit context, clears session and hides formal source backup controls", async () => {
  let context = { practiceId: "", version: 0 };
  const calls = [];
  const fixture = await createAndroidBrowser({ api: { bootstrap, androidGuide: guide, getContext: () => context,
    setContext: id => { calls.push(["context", id]); context = { practiceId: id, version: context.version + 1 }; },
    androidPractice: async action => { calls.push(["practice", action]); return { practiceId: "android-local" }; },
  } });
  fixture.app.state.currentStudy = { id: "old-session" };
  await fixture.app.switchAndroidLibrary("android-local");
  assert.deepEqual(calls, [["practice", "start"], ["context", "android-local"]]);
  assert.equal(fixture.app.state.currentStudy, null);
  assert.equal(findButton(fixture.app.refs.main, "选择备份并预览"), undefined);
  assert.ok(findButton(fixture.app.refs.main, "导出学习记录备份"));
  fixture.app.renderSourceGroupDrawer(source);
  assert.equal(findButton(fixture.app.refs.drawerBody, "导出原文"), undefined);
  assert.equal(findButton(fixture.app.refs.drawerBody, "查看版本"), undefined);
  await fixture.app.switchAndroidLibrary("");
  assert.equal(context.practiceId, "");
  assert.ok(findButton(fixture.app.refs.main, "选择备份并预览"));
});

test("Android learning backup preview gates restore and a cancelled picker clears stale tokens", async () => {
  let previews = 0, restores = 0;
  const fixture = await createAndroidBrowser({ api: { bootstrap, androidGuide: guide,
    previewAndroidLearningBackup: async () => { if (++previews === 2) throw Object.assign(new Error("cancelled"), { code: "CANCELLED" }); return { token: "reviewed", context: "formal", notes: 2, history: 1, canRestore: true, identical: false }; },
    restoreAndroidLearningBackup: async token => { assert.equal(token, "reviewed"); restores++; return { restored: true, unchanged: false }; },
  } });
  await fixture.app.renderSystem();
  const main = fixture.app.refs.main, choose = findButton(main, "选择学习备份并预览"), restore = findButton(main, "确认恢复学习记录"), reviewed = control(main, "learningRestoreReviewed");
  assert.equal(restore.disabled, true);
  await click(choose); reviewed.checked = true; await reviewed.events.change();
  assert.equal(restore.disabled, false);
  assert.match(main.textContent, /目标：正式库/);
  assert.match(main.textContent, /学习设置或引导记录/);
  assert.match(main.textContent, /两个文件一起保管/);
  await click(choose);
  assert.equal(restore.disabled, true);
  assert.equal(reviewed.checked, false);
  assert.equal(restores, 0);
  await click(choose); reviewed.checked = true; await reviewed.events.change(); await click(restore);
  assert.equal(restores, 1);
  assert.equal(restore.disabled, true);
  assert.match(main.textContent, /学习记录恢复完成/);
  assert.doesNotMatch(main.textContent, /true.*项/);
});

test("Android retained source snapshot is displayed as raw source and never as online evidence", async () => {
  const fixture = await createAndroidBrowser({ api: { evidence: async id => ({ noteId: id, evidence: [], limitations: ["事实尚待核验"], sourceSnapshot: { title: "抽取时原文", body: "<img src=x>保留的原文正文" } }) } });
  fixture.app.renderNoteDrawer({ id: "knowledge", kind: "knowledge", title: "手工知识", body: "正文", meta: {} });
  const details = descendants(fixture.app.refs.drawerBody).find(node => node.dataset.tour === "note-evidence");
  details.open = true; await details.events.toggle();
  assert.match(details.textContent, /抽取时原文/);
  assert.match(details.textContent, /保留的原文正文/);
  assert.match(details.textContent, /不是联网核验结果/);
  assert.match(details.textContent, /事实尚待核验/);
  assert.equal(details.querySelector("img"), null);
});

test("Android local settings save only learning preferences and paused content can resume", async () => {
  let settings = { dailyMinutes: 25, timezone: "Asia/Shanghai", scheduleTime: "08:00", pausedIds: ["knowledge"] };
  const writes = [];
  const fixture = await createAndroidBrowser({ api: { androidGuide: guide, settings: async () => settings, bootstrap: async () => ({ notes: [{ id: "knowledge", title: "暂停知识" }] }), updateSettings: async payload => { writes.push({ ...payload }); settings = { ...settings, ...payload }; return settings; } } });
  await fixture.app.renderSystem();
  const form = descendants(fixture.app.refs.main).find(node => node.tagName === "form" && control(node, "dailyMinutes"));
  control(form, "dailyMinutes").value = "40"; control(form, "timezone").value = "Asia/Singapore";
  await form.events.submit({ preventDefault() {} });
  assert.deepEqual(writes[0], { dailyMinutes: 40, timezone: "Asia/Singapore", scheduleTime: "08:00" });
  assert.equal(control(fixture.app.refs.main, "apiKey"), undefined);
  await click(findButton(fixture.app.refs.main, "恢复安排"));
  assert.equal(writes[1].pausedIds.length, 0);
  assert.equal(findButton(fixture.app.refs.main, "恢复安排"), undefined);
});

test("Android topic page offers manual creation without AI and unsupported output stays blocked", async () => {
  const fixture = await createAndroidBrowser({ api: { topics: async () => ({ topics: [] }) } });
  await fixture.app.navigate("topics");
  assert.ok(findButton(fixture.app.refs.main, "新建主题学习包"));
  assert.equal(findButton(fixture.app.refs.main, "AI 建议学习包"), undefined);
  await fixture.app.navigate("output");
  assert.match(fixture.app.refs.main.textContent, /尚未迁移到手机/);
  assert.equal(descendants(fixture.app.refs.main).some(node => node.name === "question"), false);
});
