import { readFile } from "node:fs/promises";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectDir = path.resolve(import.meta.dirname, "..");
const query = process.argv[2] || "知识管理";
const env = Object.fromEntries(Object.entries(process.env).filter((entry) => typeof entry[1] === "string"));

function recordProtocol(inner) {
  let negotiatedProtocolVersion = null;
  return {
    get negotiatedProtocolVersion() {
      return negotiatedProtocolVersion;
    },
    get stderr() {
      return inner.stderr;
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

const transport = recordProtocol(new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectDir, "src", "mcp.mjs")],
  cwd: projectDir,
  env,
  stderr: "pipe",
}));
transport.stderr?.pipe(process.stderr);

const client = new Client({ name: "learning-workbench-smoke", version: "0.1.0" });
try {
  await client.connect(transport);
  const sdkPackage = JSON.parse(
    await readFile(path.join(projectDir, "node_modules", "@modelcontextprotocol", "sdk", "package.json"), "utf8"),
  );
  const tools = await client.listTools();
  const result = await client.callTool({ name: "search_knowledge", arguments: { query } });
  process.stdout.write(
    `${JSON.stringify(
      {
        sdkVersion: sdkPackage.version,
        negotiatedProtocolVersion: transport.negotiatedProtocolVersion,
        server: client.getServerVersion(),
        tools: tools.tools.map(({ name }) => name),
        query,
        result,
      },
      null,
      2,
    )}\n`,
  );
  if (result.isError) process.exitCode = 1;
} finally {
  await client.close();
}
