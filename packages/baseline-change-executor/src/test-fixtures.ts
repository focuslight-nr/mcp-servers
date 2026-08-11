import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { changePlanDigest } from "@focuslight-nr/checkpoint-baseline-change-planner-mcp/planner";
import { parseChangePlan } from "@focuslight-nr/checkpoint-baseline-change-planner-mcp/schema";
import type { ChangePlan } from "@focuslight-nr/checkpoint-baseline-change-planner-mcp/types";
import type { ApprovalRecord, FakeGaiaState } from "./types.js";

export async function examplePlan(): Promise<ChangePlan> {
  const path = fileURLToPath(
    new URL(
      "../../baseline-change-planner/examples/change-plan.example.json",
      import.meta.url,
    ),
  );
  return parseChangePlan(JSON.parse(await readFile(path, "utf8")));
}

export function approval(
  plan: ChangePlan,
  overrides: Partial<ApprovalRecord["approval"]> = {},
): ApprovalRecord {
  return {
    formatVersion: "1.0",
    approval: {
      id: "approval-001",
      planId: plan.plan.id,
      planSha256: changePlanDigest(plan),
      changeIds: plan.changes.map((change) => change.id),
      decision: "APPROVED",
      approver: {
        subject: "user-001",
        displayName: "Example Approver",
        issuer: "https://id.example.test",
        authentication: "external-identity-provider",
      },
      approvedAt: "2026-08-11T07:01:00.000Z",
      expiresAt: "2026-08-11T08:00:00.000Z",
      reason: "Synthetic lab approval",
      provenanceReference: "ticket-example-001",
      ...overrides,
    },
  };
}

export function fakeState(
  overrides: Partial<FakeGaiaState> = {},
): FakeGaiaState {
  return {
    target: "gateway-lab-01",
    capturedAt: "2026-08-11T07:05:00.000Z",
    observedByControl: { "ORG-GAIA-001": "One DNS server" },
    supportedActions: ["gaia.setDnsServers"],
    backupAvailable: true,
    ...overrides,
  };
}
