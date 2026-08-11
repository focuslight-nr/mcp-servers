import assert from "node:assert/strict";
import test from "node:test";
import { dryRunChangePlan } from "./executor.js";
import { approval, examplePlan, fakeState } from "./test-fixtures.js";

const defaults = {
  executorAllowedActions: ["gaia.setDnsServers"],
  trustedApprovalIssuers: ["https://id.example.test"],
  maxStateAgeSeconds: 600,
  evaluatedAt: "2026-08-11T07:10:00.000Z",
};

test("returns READY without applying effects when every check passes", async () => {
  const plan = await examplePlan();
  const result = dryRunChangePlan({
    changePlan: plan,
    approvalRecords: [approval(plan)],
    fakeState: fakeState(),
    ...defaults,
  });
  assert.equal(result.receipt.receipt.status, "READY");
  assert.equal(result.receipt.receipt.mode, "DRY_RUN");
  assert.equal(result.receipt.effectsApplied, false);
  assert.equal(
    result.receipt.checks.every((item) => item.status === "PASS"),
    true,
  );
  assert.match(result.receiptSha256, /^[a-f0-9]{64}$/);
});

test("blocks missing, duplicate-subject, and rejected approvals", async () => {
  const plan = await examplePlan();
  plan.changes[0]!.risk.level = "high";
  plan.changes[0]!.approval.requiredApprovals = 2;
  plan.safety.minimumApprovals = 2;
  const missing = dryRunChangePlan({
    changePlan: plan,
    approvalRecords: [],
    fakeState: fakeState(),
    ...defaults,
  });
  assert.equal(missing.receipt.receipt.status, "BLOCKED");

  const first = approval(plan);
  const sameSubject = approval(plan, { id: "approval-002" });
  const duplicateResult = dryRunChangePlan({
    changePlan: plan,
    approvalRecords: [first, sameSubject],
    fakeState: fakeState(),
    ...defaults,
  });
  assert.equal(duplicateResult.receipt.receipt.status, "BLOCKED");

  const second = approval(plan, {
    id: "approval-003",
    approver: {
      subject: "user-002",
      issuer: "https://id.example.test",
      authentication: "external-identity-provider",
    },
  });
  const ready = dryRunChangePlan({
    changePlan: plan,
    approvalRecords: [first, second],
    fakeState: fakeState(),
    ...defaults,
  });
  assert.equal(ready.receipt.receipt.status, "READY");

  const rejection = approval(plan, {
    id: "approval-004",
    decision: "REJECTED",
    approver: {
      subject: "reviewer-003",
      issuer: "https://id.example.test",
      authentication: "external-identity-provider",
    },
  });
  const rejected = dryRunChangePlan({
    changePlan: plan,
    approvalRecords: [first, second, rejection],
    fakeState: fakeState(),
    ...defaults,
  });
  assert.equal(rejected.receipt.receipt.status, "BLOCKED");
});

test("blocks stale state and changed observations", async () => {
  const plan = await examplePlan();
  const result = dryRunChangePlan({
    changePlan: plan,
    approvalRecords: [approval(plan)],
    fakeState: fakeState({
      capturedAt: "2026-08-11T06:00:00.000Z",
      observedByControl: { "ORG-GAIA-001": "Two DNS servers" },
    }),
    ...defaults,
  });
  assert.equal(result.receipt.receipt.status, "BLOCKED");
  assert.equal(
    result.receipt.checks.some(
      (item) => item.code === "STATE_FRESH" && item.status === "FAIL",
    ),
    true,
  );
  assert.equal(
    result.receipt.checks.some(
      (item) =>
        item.code === "PRECONDITION_UNCHANGED" && item.status === "FAIL",
    ),
    true,
  );
});

test("blocks plan-digest mismatch, untrusted issuers, and expired approvals", async () => {
  const plan = await examplePlan();
  const bad = approval(plan, {
    planSha256: "0".repeat(64),
    expiresAt: "2026-08-11T07:09:00.000Z",
    approver: {
      subject: "user-001",
      issuer: "https://untrusted.example.test",
      authentication: "external-identity-provider",
    },
  });
  const result = dryRunChangePlan({
    changePlan: plan,
    approvalRecords: [bad],
    fakeState: fakeState(),
    ...defaults,
  });
  assert.equal(result.receipt.receipt.status, "BLOCKED");
  assert.equal(
    result.receipt.checks.filter(
      (item) => item.approvalId === bad.approval.id && item.status === "FAIL",
    ).length,
    3,
  );
});

test("blocks actions not allowed or supported by the fake backend", async () => {
  const plan = await examplePlan();
  const result = dryRunChangePlan({
    changePlan: plan,
    approvalRecords: [approval(plan)],
    fakeState: fakeState({ supportedActions: [] }),
    executorAllowedActions: ["gaia.setNtp"],
    trustedApprovalIssuers: defaults.trustedApprovalIssuers,
    maxStateAgeSeconds: defaults.maxStateAgeSeconds,
    evaluatedAt: defaults.evaluatedAt,
  });
  assert.equal(result.receipt.receipt.status, "BLOCKED");
});

test("rejects empty or duplicate policy allowlists", async () => {
  const plan = await examplePlan();
  assert.throws(() =>
    dryRunChangePlan({
      changePlan: plan,
      approvalRecords: [],
      fakeState: fakeState(),
      executorAllowedActions: [],
      trustedApprovalIssuers: defaults.trustedApprovalIssuers,
      maxStateAgeSeconds: defaults.maxStateAgeSeconds,
    }),
  );
  assert.throws(() =>
    dryRunChangePlan({
      changePlan: plan,
      approvalRecords: [],
      fakeState: fakeState(),
      executorAllowedActions: defaults.executorAllowedActions,
      trustedApprovalIssuers: [
        "https://id.example.test",
        "https://id.example.test",
      ],
      maxStateAgeSeconds: defaults.maxStateAgeSeconds,
    }),
  );
  assert.throws(
    () =>
      dryRunChangePlan({
        changePlan: plan,
        approvalRecords: [],
        fakeState: fakeState(),
        executorAllowedActions: defaults.executorAllowedActions,
        trustedApprovalIssuers: defaults.trustedApprovalIssuers,
        maxStateAgeSeconds: 86401,
      }),
    /between 1 and 86400/,
  );
});
