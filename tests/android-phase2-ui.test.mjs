import assert from "node:assert/strict";
import test from "node:test";
import { click, control, createAndroidBrowser, descendants, findButton } from "./fixtures/android-browser.mjs";

test("Android source restore remains successful when post-restore refresh rejects and cannot repeat the consumed token", async () => {
  let nativeCalls = 0, refreshCalls = 0;
  const errors = [];
  const fixture = await createAndroidBrowser();
  const panel = fixture.context.createAndroidDataPanel({ api: {
    previewAndroidBackup: async () => ({ token: "consumed-source-token", newCount: 1, sameCount: 0, conflicts: [], versionCount: 1 }),
    restoreAndroidBackup: async token => { assert.equal(token, "consumed-source-token"); nativeCalls++; return { imported: 1, unchanged: 0, conflictsSkipped: 0, versionsImported: 1 }; },
  }, onRestored: async () => { refreshCalls++; throw new Error("bootstrap unavailable after commit"); }, onError: error => { errors.push(error); } });
  await click(findButton(panel, "选择备份并预览"));
  const reviewed = control(panel, "restoreReviewed"), restore = findButton(panel, "确认恢复，保留冲突资料");
  reviewed.checked = true; reviewed.events.change();
  await click(restore);
  assert.equal(nativeCalls, 1);
  assert.equal(refreshCalls, 1);
  assert.match(panel.textContent, /已新增 1 份/);
  assert.match(panel.textContent, /备份恢复已完成，但页面刷新未完成/);
  assert.match(panel.textContent, /顶部刷新按钮或重新打开应用/);
  assert.doesNotMatch(panel.textContent, /恢复未完成，请重新预览/);
  assert.equal(restore.disabled, true);
  assert.equal(reviewed.checked, false);
  assert.equal(reviewed.disabled, true);
  await click(restore);
  assert.equal(nativeCalls, 1);
  assert.equal(errors.length, 0);
});

test("Android committed source restore readback warning does not invite a second restore", async () => {
  const fixture = await createAndroidBrowser();
  const panel = fixture.context.createAndroidDataPanel({ api: {
    previewAndroidBackup: async () => ({ token: "readback-token", newCount: 1, sameCount: 0, conflicts: [], versionCount: 0 }),
    restoreAndroidBackup: async () => ({ imported: 1, unchanged: 0, conflictsSkipped: 0, versionsImported: 0, readbackPending: true }),
  }, onRestored: async () => {}, onError: () => assert.fail("Committed restore must not report failure") });
  await click(findButton(panel, "选择备份并预览"));
  const reviewed = control(panel, "restoreReviewed"), restore = findButton(panel, "确认恢复，保留冲突资料");
  reviewed.checked = true; reviewed.events.change(); await click(restore);
  assert.match(panel.textContent, /已新增 1 份/);
  assert.match(panel.textContent, /资料已恢复，列表暂未刷新/);
  assert.match(panel.textContent, /无需再次恢复备份/);
  assert.equal(restore.disabled, true);
});

const picked = {
  name: "换机资料.md",
  text: `---\n{"format":"zhixu-source-exchange","version":1,"title":"导入标题","source":{"platform":"网页","author":"合成作者","url":"https://example.test/","date":"2024年春","locator":"第 3 段","topic":"离线学习"}}\n---\n导入正文`,
};

test("Android file selection only fills a draft; cancel preserves it and confirmed selection carries all source fields", async () => {
  const imports = [];
  const appFixture = await createAndroidBrowser({ api: {
    pickSourceFile: async () => picked,
    import: async payload => { imports.push(payload); return { notes: [{}] }; },
    bootstrap: async () => ({ notes: [] }),
  }, confirmations: [false, true] });
  await appFixture.app.renderCapture();
  const form = appFixture.app.refs.main.querySelector(".capture-form");
  const title = control(form, "title"), body = control(form, "body"), topic = control(form, "topic");
  title.value = "尚未保存的标题"; body.value = "尚未保存的草稿"; topic.value = "原主题";
  const localOnly = control(form, "localOnly"), process = control(form, "process"), research = control(form, "research");
  assert.equal(localOnly.checked, true);
  assert.equal(localOnly.disabled, true);
  assert.equal(process.disabled, true);
  assert.equal(research.disabled, true);

  const choose = findButton(appFixture.app.refs.main, "选择文件填入草稿");
  await click(choose);
  assert.equal(title.value, "尚未保存的标题");
  assert.equal(body.value, "尚未保存的草稿");
  assert.equal(topic.value, "原主题");
  assert.equal(imports.length, 0, "file choice must never save or start processing");

  await click(choose);
  assert.equal(title.value, "导入标题");
  assert.equal(body.value, "导入正文");
  assert.equal(control(form, "platform").value, "网页");
  assert.equal(control(form, "author").value, "合成作者");
  assert.equal(control(form, "url").value, "https://example.test/");
  assert.equal(control(form, "date").type, "text");
  assert.equal(control(form, "date").value, "2024年春");
  assert.equal(control(form, "locator").value, "第 3 段");
  assert.equal(topic.value, "离线学习");
  assert.equal(localOnly.checked, true);
  assert.equal(imports.length, 0);

  await form.events.submit({ preventDefault() {} });
  assert.equal(imports.length, 1);
  assert.equal(imports[0].process, false);
  assert.equal(imports[0].research, false);
  assert.equal(imports[0].items[0].privacy, "local");
  assert.equal(imports[0].items[0].topic, "离线学习");
});

test("Android file selection confirms metadata-only drafts but not the untouched blank form", async () => {
  const appFixture = await createAndroidBrowser({ api: { pickSourceFile: async () => picked }, confirmations: Array(6).fill(false) });
  await appFixture.app.renderCapture();
  const form = appFixture.app.refs.main.querySelector(".capture-form");
  const choose = findButton(appFixture.app.refs.main, "选择文件填入草稿");

  await click(choose);
  assert.equal(appFixture.context.confirmPrompts.length, 0, "an untouched form should not ask to replace a draft");
  let promptCount = 0;
  for (const [key, value] of [["platform", "手工来源"], ["author", "草稿作者"], ["url", "https://draft.example/"], ["date", "2024年春"], ["locator", "草稿定位"], ["topic", "草稿主题"]]) {
    for (const name of ["title", "body", "platform", "author", "url", "date", "locator", "topic"]) control(form, name).value = "";
    const input = control(form, key);
    input.value = value;
    await click(choose);
    assert.equal(appFixture.context.confirmPrompts.length, ++promptCount, `${key} alone must trigger replacement confirmation`);
    assert.equal(input.value, value, `cancel must preserve ${key}`);
    input.value = "";
  }
});

test("Android source editor preserves non-ISO metadata dates verbatim", async () => {
  const source = { id: "dated-source", kind: "source", title: "日期资料", body: "正文", hash: "synthetic-hash", meta: { date: "2024-03-01T10:20:30Z" }, children: [] };
  const appFixture = await createAndroidBrowser();
  appFixture.app.renderSourceGroupDrawer(source);
  await click(findButton(appFixture.app.refs.drawerBody, "编辑原始资料"));
  const date = control(appFixture.app.refs.drawerBody, "date");
  assert.equal(date.type, "text");
  assert.equal(date.value, "2024-03-01T10:20:30Z");
});

test("Android source drawer exposes history and exports the current source id; old body is text", async () => {
  const calls = [];
  const source = { id: "synthetic-source-id", kind: "source", title: "合成原文", body: "<img src=x onerror=alert(1)> 原文", meta: {}, children: [] };
  const appFixture = await createAndroidBrowser({ api: {
    exportSource: async id => { calls.push(["export", id]); },
    history: async id => { calls.push(["history", id]); return { versions: [{ versionId: "v1", raw: "<script>danger()</script>" }] }; },
  } });
  appFixture.app.renderSourceGroupDrawer(source);
  const panel = appFixture.app.refs.drawerBody;
  assert.equal(findButton(panel, "查看版本").disabled, false);
  assert.equal(findButton(panel, "导出原文").disabled, false);
  assert.equal(panel.querySelector("img"), null);
  assert.match(panel.textContent, /<img src=x onerror=alert\(1\)> 原文/);
  await click(findButton(panel, "导出原文"));
  assert.deepEqual(calls, [["export", "synthetic-source-id"]]);
  await click(findButton(panel, "查看版本"));
  assert.deepEqual(calls[1], ["history", "synthetic-source-id"]);
  assert.equal(panel.querySelector("script"), null);
  assert.match(panel.textContent, /<script>danger\(\)<\/script>/);
});

test("Android backup preview requires review, clears stale previews, preserves conflicts, and gates one restore", async () => {
  const outcomes = [
    { token: "token-one", newCount: 1, sameCount: 0, conflicts: [{ title: '<img src=x onerror="bad()">冲突' }], versionCount: 2 },
    Object.assign(new Error("picker cancelled"), { code: "CANCELLED" }),
    Object.assign(new Error("invalid package"), { code: "INVALID_BACKUP" }),
    { token: "token-final", newCount: 2, sameCount: 1, conflicts: [], versionCount: 3 },
  ];
  let restoreCalls = 0, restoreDone;
  const restored = new Promise(resolve => { restoreDone = resolve; });
  let confirmation = true, restoredRefreshes = 0;
  const appFixture = await createAndroidBrowser({ api: {
    exportAndroidBackup: async () => ({ saved: true }),
    previewAndroidBackup: async () => {
      const next = outcomes.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    restoreAndroidBackup: async token => { restoreCalls++; assert.equal(token, "token-final"); await restored; return { imported: 2, unchanged: 1, conflictsSkipped: 0, versionsImported: 3 }; },
    bootstrap: async () => ({ notes: [] }),
  } });
  appFixture.context.confirmAction = async () => confirmation;
  await appFixture.app.navigate("system");
  const panel = appFixture.app.refs.main;
  const choose = findButton(panel, "选择备份并预览");
  const acknowledge = control(panel, "restoreReviewed");
  const restore = findButton(panel, "确认恢复，保留冲突资料");
  assert.equal(restore.disabled, true);
  assert.equal(acknowledge.disabled, true);

  await click(choose);
  assert.equal(acknowledge.disabled, false);
  assert.equal(restore.disabled, true);
  const conflict = descendants(panel).find(node => node.tagName === "li");
  assert.match(conflict.textContent, /<img src=x onerror="bad\(\)">冲突/);
  assert.equal(panel.querySelector("img"), null);
  acknowledge.checked = true; acknowledge.events.change({ target: acknowledge });
  assert.equal(restore.disabled, false);

  const cancelPreview = click(choose);
  assert.equal(acknowledge.checked, false, "starting a new picker flow clears reviewed state immediately");
  assert.equal(restore.disabled, true);
  await cancelPreview;
  assert.equal(restore.disabled, true);

  await click(choose);
  assert.equal(restore.disabled, true, "invalid preview cannot reuse the prior token");
  assert.equal(acknowledge.checked, false);
  assert.equal(appFixture.document.querySelector("#toast-region").children.length > 0, true);

  await click(choose);
  acknowledge.checked = true; acknowledge.events.change({ target: acknowledge });
  confirmation = false;
  await click(restore);
  assert.equal(restoreCalls, 0, "canceling the final confirmation keeps data untouched");
  assert.equal(restore.disabled, false, "review remains available after confirmation cancel");

  confirmation = true;
  const pending = click(restore);
  await Promise.resolve();
  await click(restore);
  assert.equal(restoreCalls, 1, "busy state prevents duplicate restore calls");
  assert.equal(restore.disabled, true);
  restoreDone();
  await pending;
  assert.equal(findButton(panel, "选择备份并预览").disabled, false);
});
