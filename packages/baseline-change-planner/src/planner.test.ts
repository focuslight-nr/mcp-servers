import assert from "node:assert/strict";
import test from "node:test";
import { auditReportDigest, planAuditRemediation } from "./planner.js";
import type { AuditReportInput } from "./types.js";

function report(): AuditReportInput {
  return {
    benchmark: "Organization Gaia Baseline 2026.1",
    baselineId: "organization-gaia",
    baselineVersion: "2026.1",
    target: "gateway-lab-01",
    readOnly: true,
    results: [
      {
        controlId: "ORG-GAIA-001",
        title: "Two DNS servers are configured",
        status: "FAIL",
        expected: "At least two DNS servers",
        observed: '["192.0.2.53"]',
        evidence: ["192.0.2.53"],
        remediation: {
          action: "gaia.setDnsServers",
          parameters: {
            servers: ["192.0.2.53", "198.51.100.53"],
          },
        },
        severity: "high",
      },
      {
        controlId: "ORG-GAIA-002",
        title: "NTP is enabled",
        status: "FAIL",
        expected: "NTP enabled",
        observed: "false",
        evidence: [],
        remediation: { action: "gaia.setNtp" },
      },
      {
        controlId: "ORG-GAIA-003",
        title: "Manual operating procedure",
        status: "FAIL",
        expected: "Approved procedure",
        observed: "missing",
        evidence: [],
      },
      {
        controlId: "ORG-GAIA-004",
        title: "Timezone is approved",
        status: "PASS",
        expected: "Asia/Tokyo",
        observed: "Asia/Tokyo",
        evidence: [],
        remediation: { action: "gaia.setTimezone" },
      },
    ],
  } as AuditReportInput;
}

test("creates a bound, non-executable proposal only for allowed failed actions", () => {
  const result = planAuditRemediation({
    auditReport: report(),
    allowedActions: ["gaia.setDnsServers"],
    auditId: "audit-20260811-001",
    generatedAt: "2026-08-11T07:00:00.000Z",
  });

  assert.ok(result.plan);
  assert.equal(result.plan.changes.length, 1);
  assert.equal(result.plan.changes[0]?.action.id, "gaia.setDnsServers");
  assert.equal(result.plan.changes[0]?.risk.level, "high");
  assert.equal(result.plan.changes[0]?.approval.requiredApprovals, 2);
  assert.equal(result.plan.safety.minimumApprovals, 2);
  assert.equal(result.plan.safety.executionAllowed, false);
  assert.equal(result.plan.safety.maxTargets, 1);
  assert.equal(result.plan.source.auditId, "audit-20260811-001");
  assert.equal(
    result.plan.source.auditReportSha256,
    auditReportDigest(report()),
  );
  assert.match(result.planSha256 ?? "", /^[a-f0-9]{64}$/);
  assert.deepEqual(result.unresolvedControls, [
    {
      controlId: "ORG-GAIA-002",
      reason: "ACTION_NOT_ALLOWED",
      action: "gaia.setNtp",
    },
    { controlId: "ORG-GAIA-003", reason: "NO_REMEDIATION" },
  ]);
});

test("returns no plan when no failed remediation is allowlisted", () => {
  const result = planAuditRemediation({
    auditReport: report(),
    allowedActions: ["gaia.setTimezone"],
  });
  assert.equal(result.plan, null);
  assert.equal(result.planSha256, null);
  assert.equal(result.unresolvedControls.length, 3);
});

test("rejects duplicate and empty action allowlists", () => {
  assert.throws(
    () =>
      planAuditRemediation({
        auditReport: report(),
        allowedActions: [],
      }),
    /at least one/,
  );
  assert.throws(
    () =>
      planAuditRemediation({
        auditReport: report(),
        allowedActions: ["gaia.setDnsServers", "gaia.setDnsServers"],
      }),
    /duplicates/,
  );
});

test("produces a stable digest regardless of object key order", () => {
  const left = report();
  const right = {
    results: left.results,
    readOnly: true as const,
    target: left.target,
    baselineVersion: left.baselineVersion,
    baselineId: left.baselineId,
    benchmark: left.benchmark,
  };
  assert.equal(auditReportDigest(left), auditReportDigest(right));
});

test("uses different plan IDs for different action allowlists", () => {
  const narrow = planAuditRemediation({
    auditReport: report(),
    allowedActions: ["gaia.setDnsServers"],
    generatedAt: "2026-08-11T07:00:00.000Z",
  });
  const broad = planAuditRemediation({
    auditReport: report(),
    allowedActions: ["gaia.setDnsServers", "gaia.setNtp"],
    generatedAt: "2026-08-11T07:00:00.000Z",
  });
  assert.ok(narrow.plan);
  assert.ok(broad.plan);
  assert.notEqual(narrow.plan.plan.id, broad.plan.plan.id);
});
