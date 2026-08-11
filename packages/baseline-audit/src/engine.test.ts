import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseBaseline } from "./baseline.js";
import { evaluateBaseline } from "./engine.js";
import type { BaselineDefinition } from "./types.js";

const organizationBaseline: BaselineDefinition = {
  formatVersion: "1.0",
  baseline: {
    id: "example-organization-gaia",
    version: "2026.1",
    title: "Example Organization Gaia Baseline",
  },
  controls: [
    {
      id: "ORG-GAIA-001",
      title: "DNS servers are configured",
      expected: "At least two DNS servers",
      assertion: { path: "gaia.dnsServers", operator: "minItems", value: 2 },
      remediation: { action: "gaia.setDnsServers" },
    },
    {
      id: "ORG-FW-001",
      title: "Allow rules do not use Any as source",
      expected: "No broad allow rules",
      assertion: {
        path: "firewall.activeRules",
        operator: "noneMatch",
        evidencePath: "label",
        where: {
          all: [
            {
              path: "action",
              operator: "equals",
              value: "accept",
              caseInsensitive: true,
            },
            {
              path: "source",
              operator: "contains",
              value: "any",
              caseInsensitive: true,
            },
          ],
        },
      },
    },
    {
      id: "ORG-GAIA-002",
      title: "Timezone matches the approved value",
      expected: "Approved timezone",
      manualWhen: {
        path: "parameters.approvedTimezone",
        operator: "notExists",
      },
      assertion: {
        path: "gaia.timezone",
        operator: "equals",
        valuePath: "parameters.approvedTimezone",
        caseInsensitive: true,
      },
    },
  ],
};

test("evaluates an organization-authored baseline", () => {
  const report = evaluateBaseline({
    baseline: organizationBaseline,
    target: "gateway-1",
    observations: {
      gaia: {
        dnsServers: ["192.0.2.53", "198.51.100.53"],
        timezone: "Asia/Tokyo",
      },
      parameters: { approvedTimezone: "asia/tokyo" },
      firewall: {
        activeRules: [
          { label: "1 (Web)", action: "Accept", source: ["Web clients"] },
          { label: "2 (Cleanup)", action: "Drop", source: ["Any"] },
        ],
      },
    },
  });

  assert.equal(report.baselineId, "example-organization-gaia");
  assert.equal(report.summary.pass, 3);
  assert.equal(report.summary.fail, 0);
  assert.equal(report.readOnly, true);
  assert.equal(report.results[0]?.severity, "medium");
});

test("returns violating collection items as evidence", () => {
  const report = evaluateBaseline({
    baseline: organizationBaseline,
    observations: {
      gaia: { dnsServers: [], timezone: "UTC" },
      firewall: {
        activeRules: [
          { label: "7 (Temporary)", action: "Accept", source: ["Any"] },
        ],
      },
    },
  });

  assert.equal(
    report.results.find((item) => item.controlId === "ORG-GAIA-001")?.status,
    "FAIL",
  );
  assert.equal(
    report.results.find((item) => item.controlId === "ORG-GAIA-001")
      ?.remediation?.action,
    "gaia.setDnsServers",
  );
  assert.deepEqual(
    report.results.find((item) => item.controlId === "ORG-FW-001")?.evidence,
    ["7 (Temporary)"],
  );
  assert.equal(
    report.results.find((item) => item.controlId === "ORG-GAIA-002")?.status,
    "MANUAL",
  );
});

test("rejects duplicate control IDs and unsupported baseline fields", () => {
  assert.throws(
    () =>
      parseBaseline({
        ...organizationBaseline,
        controls: [
          organizationBaseline.controls[0],
          organizationBaseline.controls[0],
        ],
      }),
    /duplicate control id/,
  );
  assert.throws(
    () => parseBaseline({ ...organizationBaseline, execute: "arbitrary-code" }),
    /unrecognized/i,
  );
});

test("loads the published organization baseline example", async () => {
  const path = new URL(
    "../examples/baselines/organization-gaia.json",
    import.meta.url,
  );
  const baseline = parseBaseline(
    JSON.parse(await readFile(path, "utf8")) as unknown,
  );
  assert.equal(baseline.baseline.id, "example-organization-gaia");
  assert.equal(baseline.controls.length, 3);
});

test("loads the Check Point hardening profile and evaluates numeric thresholds", async () => {
  const path = new URL(
    "../examples/baselines/checkpoint-gaia-gateway-hardening-2026.json",
    import.meta.url,
  );
  const baseline = parseBaseline(
    JSON.parse(await readFile(path, "utf8")) as unknown,
  );
  const passwordControl = {
    ...baseline,
    controls: baseline.controls.filter((item) => item.id === "CP-HARD-004"),
  };
  const pass = evaluateBaseline({
    baseline: passwordControl,
    observations: {
      gaia: {
        hardening: {
          passwordPolicy: {
            minimumLength: 14,
            complexity: 4,
            palindromeCheckEnabled: true,
            historyCheckEnabled: true,
          },
        },
      },
    },
  });
  assert.equal(baseline.controls.length, 15);
  assert.equal(pass.summary.pass, 1);
});

test("fails closed when a collection item lacks data needed by the predicate", () => {
  const report = evaluateBaseline({
    baseline: organizationBaseline,
    observations: {
      gaia: { dnsServers: ["192.0.2.53", "198.51.100.53"], timezone: "UTC" },
      parameters: { approvedTimezone: "UTC" },
      firewall: {
        activeRules: [{ label: "1 (Incomplete)", action: "Accept" }],
      },
    },
  });
  assert.equal(
    report.results.find((item) => item.controlId === "ORG-FW-001")?.status,
    "ERROR",
  );
});
