import assert from "node:assert/strict";
import test from "node:test";
import { evaluateBaseline } from "./engine.js";
import { validateException } from "./exceptions.js";
import type { BaselineDefinition } from "./types.js";

const baseline: BaselineDefinition = {
  formatVersion: "1.0",
  baseline: {
    id: "organization-firewall",
    version: "1",
    title: "Organization Firewall Baseline",
  },
  controls: [
    {
      id: "ORG-FW-001",
      title: "Broad destination rules are reviewed",
      expected: "No active allow rule uses a broad destination",
      assertion: {
        path: "firewall.activeRules",
        operator: "noneMatch",
        evidencePath: "label",
        where: {
          all: [
            { path: "action", operator: "equals", value: "accept" },
            { path: "destination", operator: "contains", value: "any" },
          ],
        },
      },
    },
  ],
};

const observations = {
  firewall: {
    activeRules: [
      {
        label: "7 (Temporary broad access)",
        action: "accept",
        destination: ["any"],
      },
    ],
  },
};

test("applies an active evidence-scoped exception without reporting PASS", () => {
  const report = evaluateBaseline({
    baseline,
    observations,
    target: "gw-1",
    evaluatedAt: "2026-07-16T00:00:00.000Z",
    exceptions: [
      {
        id: "EX-100",
        baselineId: "organization-firewall",
        controlId: "ORG-FW-001",
        target: "gw-1",
        evidence: "7 (Temporary broad access)",
        reason: "Migration window",
        approvedBy: "security@example.com",
        expiresAt: "2026-07-20T00:00:00.000Z",
      },
    ],
  });
  assert.equal(report.results[0]?.status, "EXEMPTED");
  assert.deepEqual(report.results[0]?.exceptionsApplied, ["EX-100"]);
});

test("ignores an expired exception", () => {
  const report = evaluateBaseline({
    baseline,
    observations,
    target: "gw-1",
    evaluatedAt: "2026-07-16T00:00:00.000Z",
    exceptions: [
      {
        id: "EX-OLD",
        controlId: "ORG-FW-001",
        target: "gw-1",
        reason: "Expired migration",
        approvedBy: "security@example.com",
        expiresAt: "2026-07-15T00:00:00.000Z",
      },
    ],
  });
  assert.equal(report.results[0]?.status, "FAIL");
  assert.match(report.notes.join(" "), /EX-OLD/);
});

test("does not apply an exception scoped to a different baseline", () => {
  const report = evaluateBaseline({
    baseline,
    observations,
    target: "gw-1",
    evaluatedAt: "2026-07-16T00:00:00.000Z",
    exceptions: [
      {
        id: "EX-OTHER",
        baselineId: "another-baseline",
        controlId: "ORG-FW-001",
        target: "gw-1",
        reason: "Different baseline",
        approvedBy: "security@example.com",
        expiresAt: "2026-07-20T00:00:00.000Z",
      },
    ],
  });
  assert.equal(report.results[0]?.status, "FAIL");
});

test("validates required exception metadata", () => {
  assert.deepEqual(
    validateException({
      id: "",
      controlId: "ORG-FW-001",
      target: "*",
      reason: "",
      approvedBy: "",
      expiresAt: "not-a-date",
    }),
    [
      "id is required",
      "reason is required",
      "approvedBy is required",
      "expiresAt must be an ISO-8601 date",
    ],
  );
});
