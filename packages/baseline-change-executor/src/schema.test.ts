import assert from "node:assert/strict";
import test from "node:test";
import { dryRunChangePlan } from "./executor.js";
import {
  parseApprovalRecord,
  parseDryRunReceipt,
  parseFakeGaiaState,
} from "./schema.js";
import { approval, examplePlan, fakeState } from "./test-fixtures.js";

test("validates an approval and fake state", async () => {
  const plan = await examplePlan();
  assert.equal(parseApprovalRecord(approval(plan)).formatVersion, "1.0");
  assert.equal(parseFakeGaiaState(fakeState()).backupAvailable, true);
});

test("rejects duplicate change IDs and an invalid approval lifetime", async () => {
  const plan = await examplePlan();
  const duplicate = approval(plan, {
    changeIds: [plan.changes[0]!.id, plan.changes[0]!.id],
  });
  assert.throws(() => parseApprovalRecord(duplicate), /unique/);

  const backwards = approval(plan, {
    approvedAt: "2026-08-11T08:00:00.000Z",
    expiresAt: "2026-08-11T07:00:00.000Z",
  });
  assert.throws(() => parseApprovalRecord(backwards), /later/);
});

test("validates a generated dry-run receipt and forbids applied effects", async () => {
  const plan = await examplePlan();
  const result = dryRunChangePlan({
    changePlan: plan,
    approvalRecords: [approval(plan)],
    fakeState: fakeState(),
    executorAllowedActions: ["gaia.setDnsServers"],
    trustedApprovalIssuers: ["https://id.example.test"],
    maxStateAgeSeconds: 600,
    evaluatedAt: "2026-08-11T07:10:00.000Z",
  });
  assert.equal(parseDryRunReceipt(result.receipt).effectsApplied, false);
  assert.throws(() =>
    parseDryRunReceipt({ ...result.receipt, effectsApplied: true }),
  );
});
