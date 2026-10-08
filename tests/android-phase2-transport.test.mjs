import assert from "node:assert/strict";
import test from "node:test";
import { api, ApiError, request, configureLocalTransport } from "../apps/android/web/api.mjs";
import { createAndroidTransport } from "../apps/android/web/android-transport.mjs";

test("Android transport keeps the offline source path and narrowly maps native phase-two actions", async () => {
  const calls = [];
  const plugin = Object.fromEntries(["list", "read", "save", "history", "restoreVersion", "pickSource", "exportSource", "exportBackup", "previewBackup", "restoreBackup"]
    .map(method => [method, async args => {
      calls.push([method, structuredClone(args)]);
      if (method === "list") return { notes: [{ id: "source-1", kind: "source", title: "合成原文", meta: { stage: "reference" } }] };
      if (method === "read") return { note: { id: args.id, kind: "source", title: "合成原文" } };
      if (method === "save") return { note: { id: args.id || "saved-source", ...args } };
      if (method === "history") return { versions: [{ versionId: "v1" }] };
      if (method === "restoreVersion") return { note: { id: args.id, restored: true } };
      return { action: method, ...args };
    }]));
  const transport = createAndroidTransport(plugin);
  configureLocalTransport(transport);
  let httpCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { httpCalls++; throw new Error("HTTP fallback must not run"); };
  try {
    const bootstrap = await api.bootstrap();
    assert.equal(bootstrap.notes[0].id, "source-1");
    const imported = await api.import({ items: [{ title: "合成新原文", body: "原文", privacy: "local" }], captureMode: "text", process: false, research: false });
    assert.equal(imported.notes[0].id, "saved-source");
    assert.equal((await api.note("12345678-1234-1234-1234-123456789abc")).kind, "source");

    const id = "12345678-1234-1234-1234-123456789abc";
    assert.equal((await api.history(id)).versions[0].versionId, "v1");
    assert.deepEqual(await api.restoreVersion(id, { versionId: "v1", expectedHash: "hash", id: "attacker-id" }), { id, restored: true });

    await api.pickSourceFile();
    await api.exportSource(id);
    await api.exportAndroidBackup();
    await api.previewAndroidBackup();
    await api.restoreAndroidBackup("preview-token");
    assert.deepEqual(calls.slice(-7), [
      ["history", { id }],
      ["restoreVersion", { versionId: "v1", expectedHash: "hash", id }],
      ["pickSource", {}],
      ["exportSource", { id }],
      ["exportBackup", {}],
      ["previewBackup", {}],
      ["restoreBackup", { token: "preview-token", conflictPolicy: "keep-current" }],
    ]);

    const before = calls.length;
    for (const [path, method] of [
      ["/api/android/source-file?path=/private/file", "POST"],
      ["/api/android/source-export?noteId=other", "POST"],
      ["/api/android/backup-export?includeSecrets=true", "POST"],
      ["/api/android/backup-preview?file=other", "POST"],
      ["/api/android/backup-restore?token=other", "POST"],
      ["/api/android/source-export", "GET"],
    ]) {
      await assert.rejects(transport.request(path, { method, body: { id: "route-id", token: "body-token" } }), { code: "ANDROID_UNAVAILABLE" });
    }
    assert.equal(calls.length, before, "query strings and wrong methods must not reach native plugins");

    for (const path of ["/api/ask", "/api/study", "/api/restore", "/api/unknown"]) {
      await assert.rejects(request(path, { method: "POST", body: {} }), error => error instanceof ApiError && error.code === "ANDROID_UNAVAILABLE");
    }
    assert.equal(httpCalls, 0, "unsupported actions stay offline and do not fall back to HTTP");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
