import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";

test("starts over stdio, exposes only read tools, and fails closed without an allowlist", async () => {
  const serverPath = fileURLToPath(new URL("./index.js", import.meta.url));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: getDefaultEnvironment(),
  });
  const client = new Client({ name: "gaia-collector-test", version: "0.1.0" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
      "show_date_time",
      "show_dhcp",
      "show_dns",
    ]);
    const result = await client.callTool({
      name: "show_dns",
      arguments: { gateway_ip: "192.0.2.10" },
    });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text?: string }>;
    assert.match(content[0]?.text ?? "", /GAIA_ALLOWED_TARGETS/);
  } finally {
    await client.close();
  }
});
