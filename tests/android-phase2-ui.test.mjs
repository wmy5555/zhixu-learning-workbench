import assert from "node:assert/strict";
import test from "node:test";
import { click, control, createAndroidBrowser, descendants, findButton } from "./fixtures/android-browser.mjs";

const picked = {
  name: "换机资料.md",
  text: `---\n{"format":"zhixu-source-exchange","version":1,"title":"导入标题","source":{"platform":"网页","author":"合成作者","url":"https://example.test/","date":"2026-10-07","locator":"第 3 段","topic":"离线学习"}}\n---\n导入正文`,
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
  assert.equal(control(form, "date").value, "2026-10-07");
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
  await appFixture.app.renderSystem();
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
