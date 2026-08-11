import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { evaluateBaseline } from "./engine.js";
import { AuditStore } from "./store.js";
import type { BaselineDefinition } from "./types.js";

const baseline: BaselineDefinition = {
  formatVersion: "1.0",
  baseline: {
    id: "organization-gaia",
    version: "1",
    title: "Organization Gaia Baseline",
  },
  controls: [
    {
      id: "ORG-GAIA-001",
      title: "DHCP service is disabled",
      expected: "Disabled",
      assertion: { path: "gaia.dhcpEnabled", operator: "equals", value: false },
    },
  ],
};

function report(dhcpEnabled: boolean) {
  return evaluateBaseline({
    baseline,
    target: "gw-history",
    observations: { gaia: { dhcpEnabled } },
  });
}

test("stores audits and compares the newest result with the previous run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "baseline-audit-"));
  try {
    const store = new AuditStore(join(directory, "history.json"));
    const first = await store.recordAudit(report(false));
    const second = await store.recordAudit(report(true));
    assert.equal(first.diff?.changed, 0);
    assert.equal(second.diff?.previousAuditId, first.id);
    assert.equal(second.diff?.regressions, 1);
    assert.equal(second.diff?.changes[0].controlId, "ORG-GAIA-001");
    assert.equal((await store.listAudits("gw-history")).length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("upserts, lists, and deletes exceptions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "baseline-audit-"));
  try {
    const store = new AuditStore(join(directory, "history.json"));
    await store.upsertException({
      id: "EX-200",
      baselineId: "organization-gaia",
      controlId: "ORG-GAIA-001",
      target: "gw-history",
      reason: "Approved migration",
      approvedBy: "security@example.com",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    assert.equal((await store.listExceptions("gw-history")).length, 1);
    assert.equal(await store.deleteException("EX-200"), true);
    assert.equal((await store.listExceptions("gw-history")).length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("does not compare different baselines on the same target", async () => {
  const directory = await mkdtemp(join(tmpdir(), "baseline-audit-"));
  try {
    const store = new AuditStore(join(directory, "history.json"));
    await store.recordAudit(report(false));
    const other = {
      ...report(true),
      benchmark: "Another Baseline v1",
      baselineId: "another-baseline",
    };
    const stored = await store.recordAudit(other);
    assert.equal(stored.diff?.previousAuditId, undefined);
    assert.equal(stored.diff?.changed, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("serializes concurrent writes from independent store instances", async () => {
  const directory = await mkdtemp(join(tmpdir(), "baseline-audit-"));
  try {
    const path = join(directory, "history.json");
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        new AuditStore(path).recordAudit({
          ...report(index % 2 === 0),
          target: `gateway-${index}`,
        }),
      ),
    );
    assert.equal(
      (await new AuditStore(path).listAudits(undefined, 20)).length,
      12,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
