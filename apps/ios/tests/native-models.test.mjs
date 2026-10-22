import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../src/reference/markdown-reader.mjs";
import { safeExternalUrl } from "../src/reference/reader-tree.mjs";
import { transition, elapsed } from "../src/reference/focus-model.mjs";
import { accentPalette, contrast } from "../src/reference/accent.mjs";
import { AsyncLocalStorage } from "../src/platform/async_hooks.native.js";
import { changeScope } from "../src/services/scope-switch.mjs";
import { formatSelection } from "../src/services/markdown-edit.mjs";
import {
  createRequestLane,
  isImmediateLocalRequest,
} from "../src/services/request-lanes.mjs";
const flatten = (node) =>
  typeof node === "object" ? node.children.flatMap(flatten) : [String(node)];
const tags = (node) =>
  typeof node === "object" ? [node.tag, ...node.children.flatMap(tags)] : [];
test("only local draft, job status and cancellation bypass outbound work", () => {
  assert.equal(isImmediateLocalRequest("/api/jobs"), true);
  assert.equal(
    isImmediateLocalRequest("/api/jobs/one/action", {
      method: "POST",
      body: { action: "cancel" },
    }),
    true,
  );
  assert.equal(
    isImmediateLocalRequest("/api/jobs/one/action", {
      method: "POST",
      body: { action: "retry" },
    }),
    false,
  );
  for (const path of [
    "/api/ask",
    "/api/search?privacy=cloud",
    "/api/settings",
    "/api/restore",
  ])
    assert.equal(isImmediateLocalRequest(path), false);
});
test("cancellation can interrupt a pending job while the next outbound scope waits", async () => {
  const lane = createRequestLane(),
    events = [];
  let release;
  const first = lane.run(async () => {
    events.push("start");
    await new Promise((resolve) => {
      release = resolve;
    });
    events.push("end");
  });
  await Promise.resolve();
  const second = lane.run(() => events.push("second"));
  await lane.run(() => {
    events.push("cancel");
    release();
  }, true);
  await Promise.all([first, second]);
  assert.deepEqual(events, ["start", "cancel", "end", "second"]);
});
test("native reader preserves safe lists, tables and code without executing HTML", () => {
  const tree = renderMarkdown(
    "# 标题\n\n**重点**\n\n- 项目\n\n| 列 |\n| --- |\n| 内容 |\n\n```html\n<script>danger()</script>\n```\n\n[坏链接](javascript:alert(1))",
  );
  assert.ok(tags(tree).includes("table"));
  assert.ok(tags(tree).includes("ul"));
  assert.ok(tags(tree).includes("strong"));
  assert.ok(flatten(tree).join("").includes("<script>danger()</script>"));
  assert.ok(!tags(tree).includes("script"));
  assert.equal(safeExternalUrl("javascript:alert(1)"), "");
  assert.equal(safeExternalUrl("https://user:password@example.org"), "");
});
test("focus uses persisted wall clock and settles once after suspension", () => {
  let s = transition(
    null,
    { type: "start", id: "one", kind: "focus", minutes: 1 },
    1000,
  );
  assert.equal(elapsed(s.active, 31000), 30000);
  s = transition(s, { type: "pause" }, 31000);
  assert.equal(elapsed(s.active, 91000), 30000);
  s = transition(s, { type: "resume" }, 91000);
  s = transition(s, { type: "tick" }, 130000);
  assert.equal(s.records.length, 1);
  assert.equal(s.records[0].durationMs, 60000);
  s = transition(s, { type: "tick" }, 150000);
  assert.equal(s.records.length, 1);
});
test("accent palette preserves text contrast in both modes", () => {
  for (const dark of [false, true])
    for (const color of [
      "#ffffff",
      "#000000",
      "#a25d40",
      "#487c67",
      "#5c75a5",
      "#856492",
    ]) {
      const p = accentPalette(color, dark);
      assert.ok(contrast(p.accent, dark ? "#242422" : "#fcfcfb") >= 4.5);
      assert.ok(contrast(p.accent, p.ink) >= 4.5);
    }
});
test("serialized native scope restores nested values and errors", async () => {
  const scope = new AsyncLocalStorage();
  await scope.run("parent", async () => {
    await scope.run("child", async () =>
      assert.equal(scope.getStore(), "child"),
    );
    assert.equal(scope.getStore(), "parent");
    await assert.rejects(
      scope.run("throwing", async () => {
        throw Error("failure");
      }),
    );
    assert.equal(scope.getStore(), "parent");
  });
  assert.equal(scope.getStore(), undefined);
});
test("space switch flushes the previous draft before changing identity", async () => {
  let scope = "formal";
  const saved = [];
  await changeScope(
    {
      current: () => scope,
      busy: () => false,
      flush: async () => {
        saved.push(scope);
      },
      commit: (next) => {
        scope = next;
      },
    },
    "practice",
  );
  assert.deepEqual(saved, ["formal"]);
  assert.equal(scope, "practice");
});
test("failed draft save prevents a knowledge-space switch", async () => {
  let scope = "formal";
  await assert.rejects(
    changeScope(
      {
        current: () => scope,
        busy: () => false,
        flush: async () => {
          throw Error("disk full");
        },
        commit: (next) => {
          scope = next;
        },
      },
      "practice",
    ),
  );
  assert.equal(scope, "formal");
});
test("a new pending task prevents committing a stale space switch", async () => {
  let scope = "formal",
    busy = false;
  await assert.rejects(
    changeScope(
      {
        current: () => scope,
        busy: () => busy,
        flush: async () => {
          busy = true;
        },
        commit: (next) => {
          scope = next;
        },
      },
      "practice",
    ),
  );
  assert.equal(scope, "formal");
});
test("native formatting only modifies the selected range and preserves Chinese text", () => {
  const result = formatSelection("前文中文后文", { start: 2, end: 4 }, "bold");
  assert.equal(result.body, "前文**中文**后文");
  assert.equal(
    result.body.slice(result.selection.start, result.selection.end),
    "中文",
  );
  assert.equal(
    formatSelection("原文", { start: 2, end: 2 }, "heading").body,
    "原文\n## 标题\n",
  );
});
