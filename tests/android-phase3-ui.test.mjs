import assert from "node:assert/strict";
import test from "node:test";
import { click, control, createAndroidBrowser, descendants, findButton } from "./fixtures/android-browser.mjs";

const source = { id: "reflection", kind: "source", title: "合成反思", body: "我希望先回忆，再查材料。", hash: "synthetic-source-hash", meta: {}, children: [] };
const bootstrap = async () => ({ notes: [], today: { items: [] }, stats: {} });
const guide = async () => ({ steps: [{ id: "sources", label: "保存原文", completed: true }, { id: "answer", label: "保存回答", completed: false }] });

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
