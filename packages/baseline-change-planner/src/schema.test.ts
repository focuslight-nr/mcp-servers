import assert from "node:assert/strict";
import test from "node:test";
import { planAuditRemediation } from "./planner.js";
import { parseChangePlan } from "./schema.js";

function validPlan(): Record<string, unknown> {
  const result = planAuditRemediation({
    auditReport: {
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
    allowedActions: ["gaia.setDnsServers"],
    generatedAt: "2026-08-11T07:00:00.000Z",
  });
  assert.ok(result.plan);
  return structuredClone(result.plan) as unknown as Record<string, unknown>;
}

test("accepts a generated Change Plan Format v1 document", () => {
  assert.equal(parseChangePlan(validPlan()).formatVersion, "1.0");
});

test("rejects attempts to mark a proposal executable", () => {
  const plan = validPlan();
  (plan.safety as Record<string, unknown>).executionAllowed = true;
  assert.throws(() => parseChangePlan(plan));
});

test("rejects a change targeting a different device", () => {
  const plan = validPlan();
  const changes = plan.changes as Array<Record<string, unknown>>;
  changes[0]!.target = "gateway-other-01";
  assert.throws(() => parseChangePlan(plan), /source.target/);
});

test("rejects a plan with pre-populated approvals", () => {
  const plan = validPlan();
  const changes = plan.changes as Array<Record<string, any>>;
  changes[0]!.approval.approvals = [{ approvedBy: "agent" }];
  assert.throws(() => parseChangePlan(plan));
});

test("rejects duplicate controls in one plan", () => {
  const plan = validPlan();
  const changes = plan.changes as Array<Record<string, unknown>>;
  changes.push(structuredClone(changes[0]!));
  assert.throws(() => parseChangePlan(plan), /duplicate change id/);
});
