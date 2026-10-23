import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createGateway } from "../src/services/gateway.mjs";
import { zipSync, strToU8 } from "fflate";
import { extractWordDocument } from "../src/platform/docx.js";
function setup(t) {
  fs.mkdirSync(".tmp", { recursive: true });
  const root = fs.mkdtempSync(path.resolve(".tmp/native-contract-"));
  const gateway = createGateway({ root });
  t.after(() => gateway.close());
  return gateway;
}
const req = (g, p, b) => g.request(p, { method: "POST", body: b });

test("foreground pumping drains queued jobs without retrying waiting work", async (t) => {
  const g = setup(t);
  await req(g, "/api/import", { process: true, items: [
    { title: "合成一", body: "第一个合成任务，模型未启用。" },
    { title: "合成二", body: "第二个合成任务，模型未启用。" },
  ] });
  assert.equal((await g.pump()).hasMore, true);
  assert.equal((await g.pump()).hasMore, false);
  const before = await g.request("/api/jobs");
  assert.equal(before.jobs.filter(job => job.state === "queued").length, 0);
  assert.equal(before.jobs.filter(job => job.attempts === 1).length, 2);
  await g.pump();
  assert.deepEqual((await g.request("/api/jobs")).jobs.map(job => job.attempts), before.jobs.map(job => job.attempts));
});

test("suspending the app leaves queued tasks waiting for a user decision", async (t) => {
  const g = setup(t);
  await req(g, "/api/import", { process: true, items: [{ title: "合成暂停", body: "暂停不触发模型。" }] });
  await g.pause();
  assert.equal((await g.pump()).hasMore, false);
  g.resume();
  assert.equal((await g.pump()).hasMore, false);
  const job = (await g.request("/api/jobs")).jobs[0];
  assert.equal(job.state, "waiting");
  assert.equal(job.attempts, 0);
});
test("portable backups exclude device drafts and restoration preserves them", async (t) => {
  const g = setup(t);
  await g.request("/api/draft-work", {
    method: "PUT",
    practiceId: "practice-test",
    body: { id: "capture", value: { body: "隔离的未保存练习草稿" } },
  });
  const backup = await g.request("/api/backup");
  assert.ok(
    !backup.records.some((record) => record.namespace === "nativeDrafts"),
  );
  const preview = await req(g, "/api/restore", { backup, preview: true });
  await req(g, "/api/restore", {
    backup,
    preview: false,
    token: preview.token,
  });
  const recovered = await g.request("/api/draft-work?id=capture", {
    practiceId: "practice-test",
  });
  assert.equal(recovered.body, "隔离的未保存练习草稿");
  const poisoned = structuredClone(backup);
  poisoned.records.push({
    namespace: "nativeDrafts",
    id: "practice-test:capture",
    json: "{}",
  });
  await assert.rejects(
    req(g, "/api/restore", { backup: poisoned, preview: true }),
    { code: "BACKUP_DEVICE_STATE" },
  );
});
async function source(g) {
  return (
    await req(g, "/api/import", {
      items: [
        {
          title: "测试原文",
          body: "这是合成的测试资料。观点需要保留来源与适用条件。",
        },
      ],
    })
  ).notes[0];
}
test("concurrent stale writes cannot overwrite a successful edit", async (t) => {
  const g = setup(t),
    n = await source(g);
  const results = await Promise.allSettled(
    ["第一份编辑", "另一份旧编辑"].map((body) =>
      g.request("/api/notes/" + n.id, {
        method: "PUT",
        body: { body, expectedHash: n.hash },
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    results.filter((r) => r.status === "rejected")[0].reason.code,
    "CONFLICT",
  );
});
test("merge preview binds both source versions", async (t) => {
  const g = setup(t),
    n = await source(g);
  const a = await req(g, `/api/notes/${n.id}/extract`, {
      title: "观点一",
      body: "原始观点一",
      claimType: "opinion",
    }),
    b = await req(g, `/api/notes/${n.id}/extract`, {
      title: "观点二",
      body: "原始观点二",
      claimType: "opinion",
    });
  const preview = await req(g, "/api/notes/merge", {
    keepId: a.id,
    mergeId: b.id,
  });
  await g.request("/api/notes/" + b.id, {
    method: "PUT",
    body: { body: "人工改过", expectedHash: b.hash },
  });
  await assert.rejects(
    req(g, "/api/notes/merge", { ...preview, preview: false }),
    { code: "CONFLICT" },
  );
  assert.equal((await g.request("/api/notes/" + a.id)).body, a.body);
});
test("practice creation stays separate and requires tested model before writes", async (t) => {
  const g = setup(t),
    p = await req(g, "/api/onboarding/start", {});
  assert.ok(p.practiceId);
  assert.equal((await g.request("/api/notes")).notes.length, 0);
  await assert.rejects(
    g.request("/api/import", {
      method: "POST",
      practiceId: p.practiceId,
      body: { items: [{ title: "合成练习", body: "不能绕过配置" }] },
    }),
    { code: "MODEL_TEST_REQUIRED" },
  );
});
test("local gateway persists original, versions and conflicts without a server", async (t) => {
  const g = setup(t),
    n = await source(g);
  const edited = await g.request("/api/notes/" + n.id, {
    method: "PUT",
    body: { body: "人工编辑的合成正文", expectedHash: n.hash },
  });
  assert.notEqual(edited.hash, n.hash);
  await assert.rejects(
    g.request("/api/notes/" + n.id, {
      method: "PUT",
      body: { body: "旧版本覆盖", expectedHash: n.hash },
    }),
    { code: "CONFLICT" },
  );
  const history = await g.request("/api/history/" + n.id);
  assert.ok(history.versions.length);
  assert.equal(
    (await g.request("/api/notes/" + n.id)).body,
    "人工编辑的合成正文",
  );
});
test("manual extraction preserves factual warnings and explicit learning confirmation", async (t) => {
  const g = setup(t),
    n = await source(g);
  const k = await req(g, `/api/notes/${n.id}/extract`, {
    title: "知识",
    body: "合成事实",
    claimType: "fact",
  });
  assert.ok(k.meta.researchLimitations.length);
  await assert.rejects(
    req(g, `/api/notes/${k.id}/promote`, { stage: "integrated" }),
  );
  const confirmed = await req(g, `/api/notes/${k.id}/confirm`, {
    body: "我自己的理解",
    expectedHash: k.hash,
  });
  assert.equal(confirmed.meta.confirmedBy, "user");
  assert.ok(confirmed.body.includes("我自己的理解"));
});
test("answers have idempotency and cannot finish before genuine feedback", async (t) => {
  const g = setup(t),
    n = await source(g),
    k = await req(g, `/api/notes/${n.id}/extract`, {
      title: "观点",
      body: "合成观点",
      claimType: "opinion",
    });
  await req(g, `/api/notes/${k.id}/promote`, {
    stage: "learning",
    reason: "练习",
    depth: "explain",
  });
  const s = await req(g, "/api/study/start", {
    noteId: k.id,
    requestId: "start-intent",
  });
  const again = await req(g, "/api/study/start", {
    noteId: k.id,
    requestId: "start-intent",
  });
  assert.equal(s.id, again.id);
  await req(g, `/api/study/${s.id}/answer`, {
    answer: "我的回答",
    requestId: "answer-intent",
  });
  const repeated = await req(g, `/api/study/${s.id}/answer`, {
    answer: "我的回答",
    requestId: "answer-intent",
  });
  assert.equal(repeated.turns.length, 1);
  await assert.rejects(req(g, `/api/study/${s.id}/finish`, {}), {
    code: "FEEDBACK_PENDING",
  });
});
test("local output never claims AI generation and preserves citation ownership", async (t) => {
  const g = setup(t);
  await source(g);
  const draft = await req(g, "/api/ask", {
    question: "测试原文",
    privacy: "local",
    requestId: "output-intent",
  });
  assert.equal(draft.generated, false);
  const same = await req(g, "/api/ask", {
    question: "测试原文",
    privacy: "local",
    requestId: "output-intent",
  });
  assert.equal(draft.draftId, same.draftId);
  await assert.rejects(
    g.request("/api/drafts/" + draft.draftId, {
      method: "PUT",
      body: { body: "编辑", usedIds: ["foreign-id"] },
    }),
  );
});
test("recycle restore requires the correct captured version and retains source", async (t) => {
  const g = setup(t),
    n = await source(g);
  await g.request("/api/notes/" + n.id, {
    method: "DELETE",
    body: { expectedHash: n.hash },
  });
  const bin = await g.request("/api/recycle-bin");
  assert.equal(bin.purgeEnabled, false);
  assert.equal(bin.items[0].id, n.id);
  await assert.rejects(
    req(g, `/api/recycle-bin/${n.id}/restore`, { versionId: "wrong" }),
  );
  await req(g, `/api/recycle-bin/${n.id}/restore`, {
    versionId: bin.items[0].versionId,
  });
  assert.equal((await g.request("/api/notes/" + n.id)).body, n.body);
});
test("backup restores only after matching preview and never accepts traversal", async (t) => {
  const g = setup(t);
  await source(g);
  const backup = await g.request("/api/backup");
  await assert.rejects(
    req(g, "/api/restore", { backup, preview: false, token: "missing" }),
    { code: "CONFLICT" },
  );
  const preview = await req(g, "/api/restore", { backup, preview: true });
  await req(g, "/api/restore", {
    backup,
    preview: false,
    token: preview.token,
  });
  assert.equal((await g.request("/api/notes")).notes.length, 1);
  const altered = structuredClone(backup);
  altered.notes[0].path = "../escape.md";
  await assert.rejects(
    req(g, "/api/restore", { backup: altered, preview: true }),
  );
});
test("mobile cannot enable a desktop listener or choose an external directory", async (t) => {
  const g = setup(t);
  await assert.rejects(
    g.request("/api/settings", {
      method: "PUT",
      body: { mcp: { enabled: true } },
    }),
    { code: "DESKTOP_ONLY" },
  );
  await assert.rejects(
    g.request("/api/settings", {
      method: "PUT",
      body: { vaultDir: "/outside" },
    }),
    { code: "MOBILE_DIRECTORY" },
  );
  await assert.rejects(g.request("https://example.com/api/notes"));
});
test("drafts persist separately from original sources", async (t) => {
  const g = setup(t);
  await g.request("/api/draft-work", {
    method: "PUT",
    body: { id: "capture", value: { body: "未保存原文草稿" } },
  });
  assert.equal(
    (await g.request("/api/draft-work?id=capture")).body,
    "未保存原文草稿",
  );
  assert.equal((await g.request("/api/notes")).notes.length, 0);
});
test("native DOCX conversion extracts text without executing XML entities", async () => {
  const bytes = zipSync({
    "word/document.xml": strToU8(
      "<w:document><w:p><w:t>合成 &amp; 文本</w:t></w:p></w:document>",
    ),
  });
  const good = await extractWordDocument({
    descriptor: { format: "docx" },
    bytes,
  });
  assert.equal(good.status, "ready");
  assert.equal(good.text, "合成 & 文本");
  const bad = await extractWordDocument({
    descriptor: { format: "docx" },
    bytes: zipSync({
      "word/document.xml": strToU8(
        '<!DOCTYPE doc [<!ENTITY x SYSTEM "file:///private">]><w:t>&x;</w:t>',
      ),
    }),
  });
  assert.equal(bad.status, "failed");
});
