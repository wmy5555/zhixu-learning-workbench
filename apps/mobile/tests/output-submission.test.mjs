import test from "node:test";
import assert from "node:assert/strict";
import { submitOutput } from "../src/services/output-submission.mjs";

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const original = () => ({
  question: "合成旧问题", mode: "answer", scope: ["knowledge", "source"],
  privacy: "local", requestId: "old-request",
});

test("typing during draft saving sends the old snapshot without replacing newer input", async () => {
  const saved = deferred(), input = original(), sent = [];
  const state = { question: input.question, requestId: input.requestId, result: null };
  const task = submitOutput({
    input, save: () => saved.promise,
    ask: async (snapshot) => { sent.push(snapshot); return { answer: "合成旧回答" }; },
    currentRequestId: () => state.requestId,
    onResult: (result) => { state.result = result; },
    onError: (message) => assert.fail(message),
  });
  assert.deepEqual(sent, []);
  Object.assign(input, { question: "合成新问题", mode: "draft", privacy: "cloud", requestId: "new-request" });
  input.scope.splice(0, input.scope.length, "source");
  state.question = input.question;
  state.requestId = input.requestId;
  saved.resolve();
  await task;
  assert.deepEqual(sent, [original()]);
  assert.equal(state.question, "合成新问题");
  assert.equal(state.result, null);
});

test("a failed old call cannot replace an error belonging to newer input", async () => {
  const started = deferred(), response = deferred(), input = original();
  const state = { requestId: input.requestId, error: "" };
  const task = submitOutput({
    input, save: async () => {},
    ask: () => { started.resolve(); return response.promise; },
    currentRequestId: () => state.requestId,
    onResult: () => assert.fail("失败调用不能产生结果"),
    onError: (message) => { state.error = message; },
  });
  await started.promise;
  state.requestId = "new-request";
  state.error = "合成新输入错误";
  response.reject(new Error("合成旧调用失败"));
  await task;
  assert.equal(state.error, "合成新输入错误");
});

test("unchanged input displays the returned answer after draft saving", async () => {
  const saved = deferred(), response = deferred(), started = deferred(), input = original();
  const answer = { answer: "合成回答", draftId: "synthetic-draft", citations: [{ id: "synthetic-note", title: "合成依据" }] };
  let displayed;
  const task = submitOutput({
    input, save: () => saved.promise,
    ask: (snapshot) => { assert.deepEqual(snapshot, input); started.resolve(); return response.promise; },
    currentRequestId: () => input.requestId,
    onResult: (result) => { displayed = result; },
    onError: (message) => assert.fail(message),
  });
  assert.equal(displayed, undefined);
  saved.resolve();
  await started.promise;
  assert.equal(displayed, undefined);
  response.resolve(answer);
  await task;
  assert.strictEqual(displayed, answer);
});
