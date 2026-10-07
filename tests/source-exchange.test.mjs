import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseSourceFile } from "../public/source-exchange.mjs";
import { parseSourceFile as parseAndroidSourceFile } from "../apps/android/web/source-exchange.mjs";
import { createService } from "../src/service.mjs";

const fixture = source => `---\n${JSON.stringify({
  format: "zhixu-source-exchange", version: 1, title: "交换标题",
  source: { platform: "网页", author: "作者", url: "https://example.test/a", date: "2026-10-07", locator: "第 2 段", topic: "离线学习" },
})}\n---\n${source}`;

test("native exports with optional missing source fields import on both platforms", () => {
  const text = `---\n${JSON.stringify({ format: "zhixu-source-exchange", version: 1, title: "无来源原文", source: { author: "合成作者" } })}\n---\n正文  \n`;
  for (const parse of [parseSourceFile, parseAndroidSourceFile]) {
    const item = parse({ name: "zhixu-source.md", text });
    assert.equal(item.author, "合成作者");
    assert.equal(item.body, "正文  \n");
    assert.equal(item.platform, "");
    assert.equal(item.topic, "");
    assert.throws(() => parse({ name: "invalid.txt", text: "正文\0" }), { code: "SOURCE_FILE_INVALID" });
  }
});

test("ordinary Markdown frontmatter remains part of the imported body", () => {
  const text = "---\ntitle: ordinary\n---\n正文\n";
  const item = parseSourceFile({ name: "原文.md", text });
  assert.equal(item.body, text);
  assert.equal(item.title, "原文");
  assert.equal(item.platform, "本地文件");
  assert.equal(item.privacy, "local");
});

test("desktop ordinary files retain the 500000-character import allowance while Android keeps its prototype limit", t => {
  const body = "原".repeat(200000);
  const parsed = parseSourceFile({ name: "大篇幅.txt", text: body });
  assert.equal(parsed.body.length, 200000);
  assert.equal(Buffer.byteLength(parsed.body, "utf8") > 128 * 1024, true);
  assert.throws(() => parseAndroidSourceFile({ name: "大篇幅.txt", text: body }), { code: "SOURCE_FILE_INVALID" });
  assert.throws(() => parseSourceFile({ name: "超额.txt", text: "x".repeat(500001) }), { code: "SOURCE_FILE_INVALID" });

  const root = fs.mkdtempSync(path.join(path.resolve(import.meta.dirname, "../.tmp"), "source-exchange-large-"));
  const service = createService({ dataDir: path.join(root, "data"), vaultDir: path.join(root, "vault") });
  t.after(() => { service.store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const result = service.importItems({ items: [parsed], process: false, research: false });
  assert.equal(result.notes[0].body.length, 200000);
  assert.equal(result.notes[0].body, body);
});

test("Android exchange fixture keeps exact body and all six source fields", () => {
  const body = "正文首行\r\n\r\n末尾空白  \n";
  const item = parseSourceFile({ name: "交换.md", text: `\uFEFF${fixture(body)}` });
  assert.deepEqual(item, {
    title: "交换标题", body, platform: "网页", author: "作者", url: "https://example.test/a",
    date: "2026-10-07", locator: "第 2 段", topic: "离线学习", privacy: "local",
  });
});

test("recognized exchange rejects unsupported versions, fields, and source values", () => {
  const base = JSON.parse(fixture("正文").slice(4, fixture("正文").indexOf("\n---\n")));
  const cases = [
    data => { data.version = 2; },
    data => { data.privacy = "cloud"; },
    data => { data.source.extra = "x"; },
    data => { data.source.author = { name: "x" }; },
    data => { data.source.url = "javascript:alert(1)"; },
    data => { data.source.author = "作".repeat(201); },
  ];
  for (const change of cases) {
    const data = structuredClone(base); change(data);
    assert.throws(() => parseSourceFile({ name: "x.md", text: `---\n${JSON.stringify(data)}\n---\n正文` }), { code: "SOURCE_FILE_INVALID" });
  }
  assert.throws(() => parseSourceFile({ name: "x.md", text: fixture("正".repeat(500001)) }), { code: "SOURCE_FILE_INVALID" });
});

test("both exchange parsers match native URL acceptance without rewriting source values", () => {
  const parsers = [parseSourceFile, parseAndroidSourceFile];
  const exchange = url => `---\n${JSON.stringify({
    format: "zhixu-source-exchange", version: 1, title: "网址样例", source: { url },
  })}\n---\n正文`;
  const rejected = [
    "https://exa\tmple.com/path",
    "http://127.1/path",
    "http://0177.0.0.1/path",
    "http://0x7f.0.0.1/path",
    "https://example.com\\path",
    "https://bad_host.example/path",
  ];
  for (const parse of parsers) for (const url of rejected) {
    assert.throws(() => parse({ name: "网址.md", text: exchange(url) }), { code: "SOURCE_FILE_INVALID" }, url);
  }
  const accepted = [
    "https://example.com/path?q=a%20b",
    "http://192.168.1.10:8080/资料",
    "https://中文.中国/路径",
    "http://[2001:db8::1]/path",
  ];
  for (const parse of parsers) for (const url of accepted) {
    assert.equal(parse({ name: "网址.md", text: exchange(url) }).url, url, `source URL should remain unchanged: ${url}`);
  }
});

test("duplicate JSON keys and malformed recognized formats are rejected", () => {
  assert.throws(() => parseSourceFile({ name: "x.md", text: '---\n{"format":"zhixu-source-exchange","format":"zhixu-source-exchange"}\n---\n正文' }), { code: "SOURCE_FILE_INVALID" });
  assert.throws(() => parseSourceFile({ name: "x.md", text: '---\n{"format":"zhixu-source-exchange",}\n---\n正文' }), { code: "SOURCE_FILE_INVALID" });
  assert.throws(() => parseSourceFile({ name: "x.txt", text: "\ud800" }), { code: "SOURCE_FILE_INVALID" });
  const marker = "__zhixu_exchange_must_not_execute__";
  delete globalThis[marker];
  const item = parseSourceFile({ name: "x.md", text: fixture(`正文 ${marker}`) });
  assert.match(item.body, new RegExp(marker));
  assert.equal(globalThis[marker], undefined);
});

test("parsed exchange imports through the existing local-only source service", t => {
  const root = fs.mkdtempSync(path.join(path.resolve(import.meta.dirname, "../.tmp"), "source-exchange-"));
  const service = createService({ dataDir: path.join(root, "data"), vaultDir: path.join(root, "vault") });
  t.after(() => { service.store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const body = "保留的正文\n\n原有空白。";
  const item = parseSourceFile({ name: "交换.md", text: fixture(body) });
  const result = service.importItems({ items: [item], process: false, research: false });
  const note = result.notes[0];
  assert.equal(note.body, body);
  assert.equal(note.meta.privacy, "local");
  assert.equal(note.meta.stage, "reference");
  assert.deepEqual(note.meta.origins[0], {
    platform: "网页", author: "作者", url: "https://example.test/a", date: "2026-10-07",
    locator: "第 2 段", topic: "离线学习", acquiredAt: note.meta.origins[0].acquiredAt,
  });
  assert.deepEqual(result.jobs, []);
});
