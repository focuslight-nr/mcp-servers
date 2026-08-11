import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("exposes only proposal and validation tools over stdio", async () => {
  const serverPath = fileURLToPath(new URL("./index.js", import.meta.url));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
  });
  const client = new Client({
    name: "baseline-change-planner-test-client",
    version: "0.1.0",
  });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [
      "plan_audit_remediation",
      "validate_change_plan",
    ]);

    const response = await client.callTool({
      name: "plan_audit_remediation",
      arguments: {
        audit_report: {
          benchmark: "Organization baseline",
          baselineId: "organization-gaia",
          baselineVersion: "1",
          target: "gateway-lab-01",
          readOnly: true,
          results: [
            {
              controlId: "ORG-001",
              title: "DNS",
              status: "FAIL",
              expected: "Two servers",
              observed: "One server",
              evidence: [],
              remediation: { action: "gaia.setDnsServers" },
            },
          ],
        },
        allowed_actions: ["gaia.setDnsServers"],
        generated_at: "2026-08-11T07:00:00.000Z",
      },
    });
    const content = response.content as Array<{ type: string; text?: string }>;
    const payload = JSON.parse(content[0]?.text ?? "{}") as {
      plan: { safety: { executionAllowed: boolean }; changes: unknown[] };
    };
    assert.equal(payload.plan.safety.executionAllowed, false);
    assert.equal(payload.plan.changes.length, 1);
  } finally {
    await client.close();
  }
});
