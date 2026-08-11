import assert from "node:assert/strict";
import test from "node:test";
import { diffAuditReports } from "./diff.js";
import type { AuditReport, AuditStatus } from "./types.js";

function report(status: AuditStatus): AuditReport {
  return {
    benchmark: "Organization Firewall Baseline v1",
    baselineId: "organization-firewall",
    baselineVersion: "1",
    target: "gw-diff",
    readOnly: true,
    summary: {
      pass: status === "PASS" ? 1 : 0,
      fail: status === "FAIL" ? 1 : 0,
      exempted: status === "EXEMPTED" ? 1 : 0,
      manual: 0,
      error: 0,
      total: 1,
    },
    results: [
      {
        controlId: "ORG-FW-001",
        title: "Broad destination rules are reviewed",
        status,
        expected: "No Any",
        observed: status,
        evidence: [],
      },
    ],
    notes: [],
  };
}

test("treats an expired exemption returning to FAIL as a regression", () => {
  const diff = diffAuditReports(report("EXEMPTED"), report("FAIL"));
  assert.equal(diff.regressions, 1);
  assert.equal(diff.changes[0].kind, "REGRESSION");
});
