import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolvedMcpProcess,
  runAllTargets,
  runTarget,
  summaryExitCode,
} from "./workflow.js";
import type { RunnerMcpClient } from "./workflow.js";
import type { AuditTarget, RunnerConfig } from "./types.js";

const target: AuditTarget = {
  id: "gw-1",
  gatewayIp: "192.0.2.10",
  gatewayPort: 443,
  accessLayer: "Network",
  expectedTimezone: "Asia/Tokyo",
  enabled: true,
};

function config(directory: string): RunnerConfig {
  return {
    concurrency: 2,
    retries: 1,
    retryDelayMs: 1,
    toolTimeoutMs: 5000,
    staleLockMs: 60000,
    stateDirectory: join(directory, "state"),
    reportDirectory: join(directory, "reports"),
    baselinePath: join(directory, "baseline.json"),
    notifications: {
      enabled: false,
      webhookUrlEnvironment: "BASELINE_AUDIT_WEBHOOK_URL",
      notifyOn: ["NON_COMPLIANT", "REGRESSION", "PARTIAL", "ERROR"],
      timeoutMs: 10000,
    },
    mcp: { gaia: {}, management: {}, audit: {} },
    targets: [target],
  };
}

async function writeBaseline(directory: string): Promise<void> {
  await writeFile(
    join(directory, "baseline.json"),
    JSON.stringify({
      formatVersion: "1.0",
      baseline: { id: "test-baseline", version: "1", title: "Test Baseline" },
      inputs: [
        "gaia.dns",
        "gaia.dhcp",
        "gaia.dateTime",
        "management.accessRulebase",
      ],
      controls: [
        {
          id: "TEST-1",
          title: "DNS is observed",
          expected: "DNS observation exists",
          assertion: { path: "gaia.dnsServers", operator: "exists" },
        },
      ],
    }),
  );
}

async function writeFixtures(directory: string): Promise<void> {
  await writeBaseline(directory);
  await Promise.all([
    writeFile(
      join(directory, "gw-1.dns.json"),
      JSON.stringify({ "dns-servers": ["192.0.2.53"] }),
    ),
    writeFile(
      join(directory, "gw-1.dhcp.json"),
      JSON.stringify({ enabled: false }),
    ),
    writeFile(
      join(directory, "gw-1.date-time.json"),
      JSON.stringify({
        ntp_configuration: {
          enabled: true,
          servers: ["192.0.2.123", "198.51.100.123"],
        },
        current_time_date: { timezone: "Asia/Tokyo" },
      }),
    ),
    writeFile(
      join(directory, "gw-1.rulebase.json"),
      JSON.stringify({ rulebase: [] }),
    ),
  ]);
}

class FakeAuditClient implements RunnerMcpClient {
  constructor(
    private readonly failuresBeforeSuccess = 0,
    private readonly callCounter = { value: 0 },
  ) {}

  async connect(): Promise<void> {}

  async callTool(name: string): Promise<unknown> {
    assert.equal(name, "audit_baseline_raw_responses");
    this.callCounter.value += 1;
    if (this.callCounter.value <= this.failuresBeforeSuccess) {
      throw new Error("temporary audit failure");
    }
    const payload = {
      target: "gw-1",
      summary: { pass: 8, fail: 1, exempted: 0, manual: 0, error: 0, total: 9 },
      adapterWarnings: [],
      diff: { regressions: 0, improvements: 0, changed: 0 },
    };
    return {
      content: [
        { type: "text", text: JSON.stringify(payload) },
        { type: "text", text: "# Fixture report" },
      ],
    };
  }

  async close(): Promise<void> {}
}

class RecordingRoleClient implements RunnerMcpClient {
  constructor(
    private readonly role: "gaia" | "management" | "audit",
    private readonly calls: Array<{
      role: string;
      name: string;
      args: Record<string, unknown>;
    }>,
  ) {}

  async connect(): Promise<void> {}

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    this.calls.push({ role: this.role, name, args });
    if (this.role === "audit") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              target: "gw-1",
              summary: {
                pass: 9,
                fail: 0,
                exempted: 0,
                manual: 0,
                error: 0,
                total: 9,
              },
              adapterWarnings: [],
              diff: { regressions: 0, improvements: 0, changed: 0 },
            }),
          },
          { type: "text", text: "# Live-shaped report" },
        ],
      };
    }
    return { content: [{ type: "text", text: "{}" }] };
  }

  async close(): Promise<void> {}
}

test("runs a fixture audit, retries once, and writes both report formats", async () => {
  const directory = await mkdtemp(join(tmpdir(), "baseline-runner-workflow-"));
  try {
    await writeFixtures(directory);
    const counter = { value: 0 };
    const result = await runTarget(config(directory), target, directory, {
      createMcpClient: () => new FakeAuditClient(1, counter),
      sleep: async () => undefined,
    });

    assert.equal(result.status, "NON_COMPLIANT");
    assert.equal(result.attempts, 2);
    assert.equal(counter.value, 2);
    assert.match(
      await readFile(result.reportMarkdownPath as string, "utf8"),
      /Fixture report/,
    );
    assert.match(
      await readFile(result.reportJsonPath as string, "utf8"),
      /"fail":1/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("returns an error result after all retries are exhausted", async () => {
  const directory = await mkdtemp(join(tmpdir(), "baseline-runner-workflow-"));
  try {
    await writeFixtures(directory);
    const result = await runTarget(config(directory), target, directory, {
      createMcpClient: () => new FakeAuditClient(5),
      sleep: async () => undefined,
    });
    assert.equal(result.status, "ERROR");
    assert.equal(result.attempts, 2);
    assert.match(result.error ?? "", /temporary audit failure/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("summarizes enabled targets and returns scheduler-oriented exit codes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "baseline-runner-workflow-"));
  try {
    await writeFixtures(directory);
    const summary = await runAllTargets(config(directory), directory, {
      createMcpClient: () => new FakeAuditClient(),
    });
    assert.equal(summary.counts.NON_COMPLIANT, 1);
    assert.equal(summaryExitCode(summary), 0);
    summary.counts.REGRESSION = 1;
    assert.equal(summaryExitCode(summary), 2);
    summary.counts.ERROR = 1;
    assert.equal(summaryExitCode(summary), 1);
    summary.counts.ERROR = 0;
    summary.notification = {
      attempted: true,
      delivered: false,
      error: "delivery failed",
    };
    assert.equal(summaryExitCode(summary), 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("does not forward credential environment variables implicitly", () => {
  assert.deepEqual(resolvedMcpProcess("management", {}).forwardEnvironment, []);
  assert.deepEqual(resolvedMcpProcess("audit", {}).forwardEnvironment, []);
  assert.deepEqual(
    resolvedMcpProcess("management", { forwardEnvironment: ["API_KEY"] })
      .forwardEnvironment,
    ["API_KEY"],
  );
});

test("passes the target credential profile to every Gaia collector call", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "baseline-runner-live-shape-"),
  );
  try {
    await writeBaseline(directory);
    const calls: Array<{
      role: string;
      name: string;
      args: Record<string, unknown>;
    }> = [];
    const profiledTarget = { ...target, credentialProfile: "tokyo" };
    const result = await runTarget(
      config(directory),
      profiledTarget,
      undefined,
      {
        createMcpClient: (role) => new RecordingRoleClient(role, calls),
      },
    );

    assert.equal(result.status, "COMPLIANT");
    const gaiaCalls = calls.filter((call) => call.role === "gaia");
    assert.deepEqual(
      gaiaCalls.map((call) => call.name),
      ["show_dns", "show_dhcp", "show_date_time"],
    );
    assert.equal(
      gaiaCalls.every((call) => call.args.credential_profile === "tokyo"),
      true,
    );
    assert.equal(
      calls.some((call) => call.name === "management__init"),
      true,
    );
    assert.equal(
      calls.some((call) => call.name === "audit_baseline_raw_responses"),
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("loads an organization baseline and calls the generic audit tool", async () => {
  const directory = await mkdtemp(join(tmpdir(), "baseline-runner-workflow-"));
  try {
    const baselinePath = join(directory, "organization-baseline.json");
    await writeFile(
      baselinePath,
      JSON.stringify({
        formatVersion: "1.0",
        baseline: { id: "organization", version: "1", title: "Organization" },
        inputs: ["gaia.dns"],
        controls: [
          {
            id: "ORG-1",
            title: "DNS configured",
            expected: "At least one DNS server",
            assertion: {
              path: "gaia.dnsServers",
              operator: "minItems",
              value: 1,
            },
          },
        ],
      }),
    );
    const calls: Array<{
      role: string;
      name: string;
      args: Record<string, unknown>;
    }> = [];
    const genericConfig = { ...config(directory), baselinePath };
    const parameterizedTarget: AuditTarget = {
      id: "gw-1",
      gatewayIp: "192.0.2.10",
      enabled: true,
      parameters: { approvedTimezone: "Asia/Tokyo" },
    };
    const result = await runTarget(
      genericConfig,
      parameterizedTarget,
      undefined,
      { createMcpClient: (role) => new RecordingRoleClient(role, calls) },
    );

    assert.equal(result.status, "COMPLIANT");
    const auditCall = calls.find((call) => call.role === "audit");
    assert.equal(auditCall?.name, "audit_baseline_raw_responses");
    assert.equal(
      (auditCall?.args.baseline as { baseline: { id: string } }).baseline.id,
      "organization",
    );
    assert.deepEqual(auditCall?.args.parameters, {
      approvedTimezone: "Asia/Tokyo",
    });
    assert.equal(
      calls.some((call) => call.role === "management"),
      false,
    );
    assert.deepEqual(
      calls.filter((call) => call.role === "gaia").map((call) => call.name),
      ["show_dns"],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("collects the fixed Gaia hardening snapshot when requested", async () => {
  const directory = await mkdtemp(join(tmpdir(), "baseline-runner-hardening-"));
  try {
    await writeFile(
      join(directory, "baseline.json"),
      JSON.stringify({
        formatVersion: "1.0",
        baseline: { id: "hardening", version: "1", title: "Hardening" },
        inputs: ["gaia.hardening"],
        controls: [
          {
            id: "HARD-1",
            title: "Version observed",
            expected: "Version exists",
            assertion: {
              path: "gaia.hardening.productVersion",
              operator: "exists",
            },
          },
        ],
      }),
    );
    const calls: Array<{
      role: string;
      name: string;
      args: Record<string, unknown>;
    }> = [];
    const result = await runTarget(config(directory), target, undefined, {
      createMcpClient: (role) => new RecordingRoleClient(role, calls),
    });

    assert.equal(result.status, "COMPLIANT");
    assert.deepEqual(
      calls.filter((call) => call.role === "gaia").map((call) => call.name),
      ["show_hardening_state"],
    );
    const auditCall = calls.find((call) => call.role === "audit");
    assert.notEqual(
      (auditCall?.args.gaia_responses as { hardening?: unknown }).hardening,
      undefined,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects a Runner baseline without an explicit inputs list", async () => {
  const directory = await mkdtemp(join(tmpdir(), "baseline-runner-workflow-"));
  try {
    await writeFile(
      join(directory, "baseline.json"),
      JSON.stringify({
        formatVersion: "1.0",
        baseline: {
          id: "missing-inputs",
          version: "1",
          title: "Missing Inputs",
        },
        controls: [
          {
            id: "TEST-1",
            title: "Observation exists",
            expected: "Observed",
            assertion: { path: "gaia.dnsServers", operator: "exists" },
          },
        ],
      }),
    );
    const result = await runTarget(config(directory), target, undefined, {
      createMcpClient: (role) => new RecordingRoleClient(role, []),
      sleep: async () => undefined,
    });
    assert.equal(result.status, "ERROR");
    assert.match(result.error ?? "", /must declare an inputs array/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
