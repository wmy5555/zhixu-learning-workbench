import test from "node:test";
import assert from "node:assert/strict";
import { createResourceReader } from "../src/services/resource-reader.mjs";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function view(signature, enabled = true, key = "formal:/api/notes", path = "/api/notes") {
  return { key, path, signature, enabled };
}

test("hidden screens do not read while revisions or manual refreshes change", async () => {
  const response = deferred(), calls = [];
  const reader = createResourceReader((path) => { calls.push(path); return response.promise; });
  await reader.update(view("revision-1", false));
  await reader.update(view("revision-2", false));
  await reader.update(view("revision-2:manual-refresh", false));
  assert.deepEqual(calls, []);
  assert.equal(reader.snapshot().data, undefined);
});

test("warm returning does not read; hidden revisions merge into one latest read with old data retained", async () => {
  const first = deferred(), latest = deferred(), pending = [first, latest], calls = [];
  const reader = createResourceReader((path) => { calls.push(path); return pending.shift().promise; });
  const initial = reader.update(view("revision-1"));
  await Promise.resolve();
  first.resolve({ notes: ["合成旧资料"] });
  await initial;
  await reader.update(view("revision-1", false));
  await reader.update(view("revision-1"));
  assert.deepEqual(calls, ["/api/notes"]);
  await reader.update(view("revision-2", false));
  await reader.update(view("revision-3", false));
  const returning = reader.update(view("revision-3"));
  await Promise.resolve();
  assert.deepEqual(calls, ["/api/notes", "/api/notes"]);
  assert.deepEqual(reader.snapshot().data, { notes: ["合成旧资料"] });
  latest.resolve({ notes: ["合成最新资料"] });
  await returning;
  assert.equal(reader.snapshot().signature, "revision-3");
  assert.deepEqual(reader.snapshot().data, { notes: ["合成最新资料"] });
});

test("an explicit refresh retries a failed read", async () => {
  const failed = deferred(), retry = deferred(), pending = [failed, retry], calls = [];
  const reader = createResourceReader((path) => { calls.push(path); return pending.shift().promise; });
  const first = reader.update(view("revision-1:refresh-0"));
  await Promise.resolve();
  failed.reject(new Error("合成读取失败"));
  await first;
  assert.equal(reader.snapshot().error, "合成读取失败");
  const refreshed = reader.update(view("revision-1:refresh-1"));
  await Promise.resolve();
  retry.resolve({ notes: ["合成重试资料"] });
  await refreshed;
  assert.deepEqual(calls, ["/api/notes", "/api/notes"]);
  assert.equal(reader.snapshot().error, "");
  assert.deepEqual(reader.snapshot().data, { notes: ["合成重试资料"] });
});

test("late results or errors cannot cross a path or knowledge-space change", async () => {
  for (const next of [
    view("new-path", true, "formal:/api/notes/b", "/api/notes/b"),
    view("new-scope", true, "practice:/api/notes/a", "/api/notes/a"),
  ]) for (const fails of [false, true]) {
    const old = deferred(), current = deferred(), pending = [old, current];
    const reader = createResourceReader(() => pending.shift().promise);
    const previous = reader.update(view("old", true, "formal:/api/notes/a", "/api/notes/a"));
    await Promise.resolve();
    reader.cancel();
    await reader.update({ ...next, enabled: false });
    const latest = reader.update(next);
    await Promise.resolve();
    const expected = { note: "合成新页面资料" };
    current.resolve(expected);
    await latest;
    if (fails) old.reject(new Error("合成旧页面错误"));
    else old.resolve({ note: "合成旧页面资料" });
    await previous;
    assert.equal(reader.snapshot().key, next.key);
    assert.equal(reader.snapshot().signature, next.signature);
    assert.strictEqual(reader.snapshot().data, expected);
    assert.equal(reader.snapshot().error, "");
  }
});
