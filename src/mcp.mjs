import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const DEFAULT_BASE_URL = "http://127.0.0.1:4318";
const DEFAULT_TIMEOUT_MS = 15_000;

class KnowledgeApiError extends Error {
  constructor(message, { code = "MCP_UPSTREAM_ERROR", status = 502 } = {}) {
    super(message);
    this.name = "KnowledgeApiError";
    this.code = code;
    this.status = status;
  }
}

function nonEmpty(value, label) {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new KnowledgeApiError(`${label} is not configured`, {
      code: "MCP_TOKEN_UNAVAILABLE",
      status: 503,
    });
  }
  return text;
}

export function createTokenProvider({ env = process.env, readFileImpl = readFile } = {}) {
  if (env.LEARNING_MCP_TOKEN?.trim()) {
    const token = env.LEARNING_MCP_TOKEN.trim();
    return async () => token;
  }

  const dataDir = path.resolve(env.LEARNING_DATA_DIR || ".data");
  const tokenPath = path.join(dataDir, "mcp-token");
  return async () => {
    try {
      return nonEmpty(await readFileImpl(tokenPath, "utf8"), "MCP token");
    } catch (error) {
      if (error instanceof KnowledgeApiError) throw error;
      throw new KnowledgeApiError("MCP token is unavailable; start the Web service first", {
        code: "MCP_TOKEN_UNAVAILABLE",
        status: 503,
      });
    }
  };
}

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(value || DEFAULT_BASE_URL);
  } catch {
    throw new Error("LEARNING_BASE_URL must be a valid http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("LEARNING_BASE_URL must use http or https");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

function safeErrorBody(body, status) {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    return {
      error: typeof body.error === "string" ? body.error : `Knowledge service returned HTTP ${status}`,
      code: typeof body.code === "string" ? body.code : "MCP_UPSTREAM_ERROR",
    };
  }
  return { error: `Knowledge service returned HTTP ${status}`, code: "MCP_UPSTREAM_ERROR" };
}

export function createKnowledgeClient({
  baseUrl = process.env.LEARNING_BASE_URL || DEFAULT_BASE_URL,
  tokenProvider = createTokenProvider(),
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  const root = normalizeBaseUrl(baseUrl);

  async function request(pathname, { method = "GET", body } = {}) {
    const token = await tokenProvider();
    const url = new URL(pathname, root);
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new KnowledgeApiError(
        error?.name === "TimeoutError"
          ? "Knowledge service request timed out"
          : "Knowledge service is unavailable",
        { code: error?.name === "TimeoutError" ? "MCP_TIMEOUT" : "MCP_SERVICE_UNAVAILABLE", status: 503 },
      );
    }

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        if (response.ok) {
          throw new KnowledgeApiError("Knowledge service returned invalid JSON", {
            code: "MCP_INVALID_RESPONSE",
            status: 502,
          });
        }
      }
    }

    if (!response.ok) {
      const details = safeErrorBody(payload, response.status);
      const safeMessage = details.error.split(token).join("[redacted]");
      throw new KnowledgeApiError(safeMessage, { code: details.code, status: response.status });
    }
    if (payload === null) {
      throw new KnowledgeApiError("Knowledge service returned an empty response", {
        code: "MCP_INVALID_RESPONSE",
        status: 502,
      });
    }
    return payload;
  }

  return {
    search(query) {
      return request(`/api/mcp/search?q=${encodeURIComponent(query)}`);
    },
    readNote(id) {
      return request(`/api/mcp/notes/${encodeURIComponent(id)}`);
    },
    readSource(id) {
      return request(`/api/mcp/sources/${encodeURIComponent(id)}`);
    },
    related(id) {
      return request(`/api/mcp/related/${encodeURIComponent(id)}`);
    },
    proposeChange(input) {
      return request("/api/mcp/proposals", { method: "POST", body: input });
    },
  };
}

function success(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function failure(error) {
  const payload = {
    error: error instanceof KnowledgeApiError ? error.message : "MCP tool failed",
    code: error instanceof KnowledgeApiError ? error.code : "MCP_TOOL_ERROR",
    ...(error instanceof KnowledgeApiError ? { status: error.status } : {}),
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

function tool(handler) {
  return async (input) => {
    try {
      return success(await handler(input));
    } catch (error) {
      return failure(error);
    }
  };
}

export function createMcpServer({ client = createKnowledgeClient() } = {}) {
  const server = new McpServer({
    name: "personal-learning-knowledge",
    version: "0.1.0",
  });

  server.registerTool(
    "search_knowledge",
    {
      title: "Search personal knowledge",
      description: "Search the local knowledge service and return matching records with diagnostics.",
      inputSchema: {
        query: z.string().trim().min(1).max(1_000).describe("Search text"),
      },
    },
    tool(({ query }) => client.search(query)),
  );

  server.registerTool(
    "read_note",
    {
      title: "Read a knowledge note",
      description: "Read one local knowledge note by its stable id.",
      inputSchema: {
        id: z.string().trim().min(1).max(200).describe("Stable note id"),
      },
    },
    tool(({ id }) => client.readNote(id)),
  );

  server.registerTool(
    "read_source",
    {
      title: "Read an original source",
      description: "Read one locally saved source by its stable id.",
      inputSchema: {
        id: z.string().trim().min(1).max(200).describe("Stable source id"),
      },
    },
    tool(({ id }) => client.readSource(id)),
  );

  server.registerTool(
    "related_knowledge",
    {
      title: "Read related knowledge",
      description: "Return accepted or proposed relations and the related local notes for one note.",
      inputSchema: {
        id: z.string().trim().min(1).max(200).describe("Stable note id"),
      },
    },
    tool(({ id }) => client.related(id)),
  );

  server.registerTool(
    "propose_change",
    {
      title: "Propose a note change",
      description:
        "Create a pending proposal for Web review. This never updates the formal note directly and can be disabled independently.",
      inputSchema: {
        noteId: z.string().trim().min(1).max(200).describe("Stable note id"),
        body: z.string().min(1).max(200_000).describe("Complete proposed note body"),
        reason: z.string().trim().min(1).max(4_000).describe("Why this change is proposed"),
        expectedHash: z.string().trim().min(1).max(256).describe("Hash of the note version reviewed"),
      },
    },
    tool((input) => client.proposeChange(input)),
  );

  return server;
}

export async function runStdioServer() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runStdioServer().catch((error) => {
    // stdout is reserved for MCP protocol frames.
    console.error(error instanceof Error ? error.message : "MCP server failed");
    process.exitCode = 1;
  });
}
