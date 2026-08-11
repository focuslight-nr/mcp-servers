import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { formatConfigError, loadRunnerConfig } from "./config.js";

test("loads defaults and resolves runner paths relative to the config file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "baseline-runner-config-"));
  try {
    const path = join(directory, "targets.json");
    await writeFile(
      path,
      JSON.stringify({
        baselinePath: "./organization-baseline.json",
        targets: [
          {
            id: "gw-1",
            gatewayIp: "192.0.2.10",
            accessLayer: "Network",
            expectedTimezone: "Asia/Tokyo",
            parameters: { approvedDnsCount: 2 },
          },
        ],
      }),
    );
    const config = await loadRunnerConfig(path);
    assert.equal(config.concurrency, 2);
    assert.equal(config.targets[0].enabled, true);
    assert.equal(config.stateDirectory, join(directory, ".baseline-runner"));
    assert.equal(
      config.baselinePath,
      join(directory, "organization-baseline.json"),
    );
    assert.equal(config.targets[0].parameters?.approvedDnsCount, 2);
    assert.equal(config.notifications.enabled, false);
    assert.deepEqual(config.notifications.notifyOn, [
      "NON_COMPLIANT",
      "REGRESSION",
      "PARTIAL",
      "ERROR",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects duplicate target IDs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "baseline-runner-config-"));
  try {
    const path = join(directory, "targets.json");
    await writeFile(
      path,
      JSON.stringify({
        baselinePath: "./organization-baseline.json",
        targets: [
          {
            id: "gw-1",
            gatewayIp: "192.0.2.10",
            accessLayer: "Network",
            expectedTimezone: "UTC",
          },
          {
            id: "GW-1",
            gatewayIp: "192.0.2.11",
            accessLayer: "Network",
            expectedTimezone: "UTC",
          },
        ],
      }),
    );
    await assert.rejects(
      () => loadRunnerConfig(path),
      (error: unknown) => {
        assert.match(formatConfigError(error), /duplicate target id/);
        return true;
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("requires an explicit baseline path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "baseline-runner-config-"));
  try {
    const path = join(directory, "targets.json");
    await writeFile(
      path,
      JSON.stringify({
        targets: [{ id: "gw-1", gatewayIp: "192.0.2.10" }],
      }),
    );
    await assert.rejects(
      () => loadRunnerConfig(path),
      (error: unknown) => {
        assert.match(formatConfigError(error), /baselinePath/);
        return true;
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
