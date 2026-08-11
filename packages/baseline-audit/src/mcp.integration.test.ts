import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const baseline = {
  formatVersion: "1.0",
  baseline: {
    id: "organization-gaia",
    version: "1",
    title: "Organization Gaia Baseline",
  },
  controls: [
    {
      id: "ORG-GAIA-001",
      title: "DNS servers are configured",
      expected: "At least one DNS server",
      assertion: { path: "gaia.dnsServers", operator: "minItems", value: 1 },
    },
  ],
};

test("starts over stdio and serves only generic baseline tools", async () => {
  const serverPath = fileURLToPath(new URL("./index.js", import.meta.url));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
  });
  const client = new Client({
    name: "baseline-audit-test-client",
    version: "0.1.0",
  });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [
      "audit_baseline",
      "audit_baseline_raw_responses",
      "delete_audit_exception",
      "get_audit_history",
      "list_audit_exceptions",
      "list_baseline_controls",
      "upsert_audit_exception",
      "validate_baseline",
    ]);

    const response = await client.callTool({
      name: "audit_baseline",
      arguments: {
        baseline,
        observations: { gaia: { dnsServers: ["192.0.2.53"] } },
        target: "normalized-fixture",
        format: "json",
      },
    });
    const content = response.content as Array<{ type: string; text?: string }>;
    const report = JSON.parse(content[0]?.text ?? "{}") as {
      baselineId: string;
      summary: { pass: number };
    };
    assert.equal(report.baselineId, "organization-gaia");
    assert.equal(report.summary.pass, 1);

    const rawResponse = await client.callTool({
      name: "audit_baseline_raw_responses",
      arguments: {
        baseline,
        target: "raw-fixture",
        gaia_responses: { dns: { "dns-servers": ["192.0.2.53"] } },
        format: "json",
      },
    });
    const rawContent = rawResponse.content as Array<{
      type: string;
      text?: string;
    }>;
    const rawReport = JSON.parse(rawContent[0]?.text ?? "{}") as {
      summary: { pass: number };
      adapterWarnings: string[];
    };
    assert.equal(rawReport.summary.pass, 1);
    assert.deepEqual(rawReport.adapterWarnings, []);
  } finally {
    await client.close();
  }
});
