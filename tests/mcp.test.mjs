import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");
const serverPath = path.join(projectDir, "src", "mcp.mjs");
const TEST_TOKEN = "test-only-local-mcp-token";

function recordProtocol(inner) {
  let negotiatedProtocolVersion = null;
  return {
    get negotiatedProtocolVersion() {
      return negotiatedProtocolVersion;
    },
    get stderr() {
      return inner.stderr;
    },
    get pid() {
      return inner.pid;
    },
    set onclose(handler) {
      inner.onclose = handler;
    },
    set onerror(handler) {
      inner.onerror = handler;
    },
    set onmessage(handler) {
      inner.onmessage = (message) => {
        if (message?.result?.protocolVersion) negotiatedProtocolVersion = message.result.protocolVersion;
        handler(message);
      };
    },
    start: () => inner.start(),
    send: (message) => inner.send(message),
    close: () => inner.close(),
  };
}

async function startHttpStub({ allowProposals = true } = {}) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString("utf8");
    const body = bodyText ? JSON.parse(bodyText) : null;
    const url = new URL(request.url, "http://127.0.0.1");
    requests.push({ method: request.method, path: url.pathname, query: url.searchParams, body });

    const send = (status, payload) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(payload));
    };
    if (request.headers.authorization !== `Bearer ${TEST_TOKEN}`) {
      return send(401, { error: "MCP authorization failed", code: "MCP_UNAUTHORIZED" });
    }
    if (request.method === "GET" && url.pathname === "/api/mcp/search") {
      return send(200, {
        results: [{ id: "knowledge-1", title: "受控测试知识", body: "MCP 是协议，不是模型 API。" }],
        diagnostics: { mode: "keyword", query: url.searchParams.get("q") },
      });
    }
    if (request.method === "GET" && url.pathname === "/api/mcp/notes/knowledge-1") {
      return send(200, {
        id: "knowledge-1",
        kind: "knowledge",
        title: "受控测试知识",
        body: "MCP 是协议，不是模型 API。",
        hash: "hash-1",
      });
    }
    if (request.method === "GET" && url.pathname === "/api/mcp/sources/source-1") {
      return send(200, {
        id: "source-1",
        kind: "source",
        title: "离线测试来源",
        body: "这份数据仅用于自动测试。",
      });
    }
    if (request.method === "GET" && url.pathname === "/api/mcp/related/knowledge-1") {
      return send(200, {
        relations: [{ id: "relation-1", fromId: "knowledge-1", toId: "knowledge-2", type: "supports" }],
        notes: [{ id: "knowledge-2", title: "相关测试知识" }],
      });
    }
    if (request.method === "POST" && url.pathname === "/api/mcp/proposals") {
      if (!allowProposals) {
        return send(403, { error: "MCP proposals are disabled", code: "MCP_PROPOSALS_DISABLED" });
      }
      return send(201, { proposal: { id: "proposal-1", state: "pending", ...body } });
    }
    return send(404, { error: "Not found", code: "NOT_FOUND" });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return {
    requests,
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function parseToolResult(result) {
  assert.equal(result.content?.[0]?.type, "text");
  return JSON.parse(result.content[0].text);
}

async function startMcpClient(baseUrl, dataDir, { token = TEST_TOKEN } = {}) {
  await writeFile(path.join(dataDir, "mcp-token"), `${token}\n`, { mode: 0o600 });
  const env = Object.fromEntries(Object.entries(process.env).filter((entry) => typeof entry[1] === "string"));
  delete env.LEARNING_MCP_TOKEN;
  Object.assign(env, { LEARNING_BASE_URL: baseUrl, LEARNING_DATA_DIR: dataDir });
  const transport = recordProtocol(new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: projectDir,
    env,
    stderr: "pipe",
  }));
  let stderr = "";
  transport.stderr?.setEncoding("utf8");
  transport.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });
  const client = new Client({ name: "learning-workbench-integration-test", version: "0.1.0" });
  await client.connect(transport);
  return {
    client,
    transport,
    stderr: () => stderr,
    close: async () => client.close(),
  };
}

test("official SDK client lists and calls the local stdio MCP tools", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "learning-mcp-"));
  const stub = await startHttpStub();
  const connection = await startMcpClient(stub.url, dataDir);
  t.after(async () => {
    await connection.close();
    await stub.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const listed = await connection.client.listTools();
  assert.equal(connection.transport.negotiatedProtocolVersion, "2025-11-25");
  assert.deepEqual(
    listed.tools.map((item) => item.name).sort(),
    ["propose_change", "read_note", "read_source", "related_knowledge", "search_knowledge"],
  );

  const search = await connection.client.callTool({ name: "search_knowledge", arguments: { query: "协议" } });
  assert.equal(search.isError, undefined);
  assert.equal(parseToolResult(search).results[0].id, "knowledge-1");
  assert.equal(parseToolResult(search).diagnostics.query, "协议");

  const note = await connection.client.callTool({ name: "read_note", arguments: { id: "knowledge-1" } });
  assert.equal(parseToolResult(note).hash, "hash-1");

  const source = await connection.client.callTool({ name: "read_source", arguments: { id: "source-1" } });
  assert.equal(parseToolResult(source).kind, "source");

  const related = await connection.client.callTool({ name: "related_knowledge", arguments: { id: "knowledge-1" } });
  assert.equal(parseToolResult(related).relations[0].type, "supports");

  const proposed = await connection.client.callTool({
    name: "propose_change",
    arguments: {
      noteId: "knowledge-1",
      body: "建议后的完整正文",
      reason: "修正术语",
      expectedHash: "hash-1",
    },
  });
  assert.equal(parseToolResult(proposed).proposal.state, "pending");

  assert.equal(stub.requests.length, 5);
  assert.deepEqual(
    stub.requests.map(({ method, path }) => `${method} ${path}`),
    [
      "GET /api/mcp/search",
      "GET /api/mcp/notes/knowledge-1",
      "GET /api/mcp/sources/source-1",
      "GET /api/mcp/related/knowledge-1",
      "POST /api/mcp/proposals",
    ],
  );
  assert.equal(connection.stderr().includes(TEST_TOKEN), false);
});

test("authorization failure is a tool error and does not expose either token", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "learning-mcp-auth-"));
  const stub = await startHttpStub();
  const badToken = "wrong-secret-token";
  const connection = await startMcpClient(stub.url, dataDir, { token: badToken });
  t.after(async () => {
    await connection.close();
    await stub.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const result = await connection.client.callTool({ name: "read_note", arguments: { id: "knowledge-1" } });
  const error = parseToolResult(result);
  assert.equal(result.isError, true);
  assert.equal(error.code, "MCP_UNAUTHORIZED");
  assert.equal(error.status, 401);
  const serialized = JSON.stringify(result) + connection.stderr();
  assert.equal(serialized.includes(TEST_TOKEN), false);
  assert.equal(serialized.includes(badToken), false);
});

test("disabled proposal permission is reported without changing a note", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "learning-mcp-proposal-"));
  const stub = await startHttpStub({ allowProposals: false });
  const connection = await startMcpClient(stub.url, dataDir);
  t.after(async () => {
    await connection.close();
    await stub.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const result = await connection.client.callTool({
    name: "propose_change",
    arguments: {
      noteId: "knowledge-1",
      body: "不会写入正式笔记",
      reason: "权限测试",
      expectedHash: "hash-1",
    },
  });
  assert.equal(result.isError, true);
  assert.equal(parseToolResult(result).code, "MCP_PROPOSALS_DISABLED");
  assert.equal(stub.requests.some(({ method, path }) => method === "PUT" && path.includes("/notes/")), false);
});
