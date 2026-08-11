import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { approval, examplePlan, fakeState } from "./test-fixtures.js";

test("exposes only fake dry-run and artifact validation tools", async () => {
  const serverPath = fileURLToPath(new URL("./index.js", import.meta.url));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
  });
  const client = new Client({
    name: "baseline-change-executor-test-client",
    version: "0.1.0",
  });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [
      "dry_run_change_plan",
      "validate_approval_record",
      "validate_dry_run_receipt",
    ]);

    const plan = await examplePlan();
    const response = await client.callTool({
      name: "dry_run_change_plan",
      arguments: {
        change_plan: plan,
        approval_records: [approval(plan)],
        fake_state: fakeState(),
        executor_allowed_actions: ["gaia.setDnsServers"],
        trusted_approval_issuers: ["https://id.example.test"],
        max_state_age_seconds: 600,
        evaluated_at: "2026-08-11T07:10:00.000Z",
      },
    });
    const content = response.content as Array<{ type: string; text?: string }>;
    const payload = JSON.parse(content[0]?.text ?? "{}") as {
      receipt: { receipt: { status: string }; effectsApplied: boolean };
    };
    assert.equal(payload.receipt.receipt.status, "READY");
    assert.equal(payload.receipt.effectsApplied, false);
  } finally {
    await client.close();
  }
});
