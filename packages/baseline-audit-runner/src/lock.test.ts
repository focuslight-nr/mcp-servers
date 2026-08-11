import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireTargetLock } from "./lock.js";

test("prevents overlapping runs for the same target", async () => {
  const directory = await mkdtemp(join(tmpdir(), "baseline-runner-lock-"));
  try {
    const lock = await acquireTargetLock(directory, "gw-1", 60000);
    await assert.rejects(
      () => acquireTargetLock(directory, "gw-1", 60000),
      /already locked/,
    );
    await lock.release();
    const next = await acquireTargetLock(directory, "gw-1", 60000);
    await next.release();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("replaces a stale target lock", async () => {
  const directory = await mkdtemp(join(tmpdir(), "baseline-runner-lock-"));
  try {
    const lock = await acquireTargetLock(directory, "gw-1", 60000);
    const old = new Date(Date.now() - 120000);
    await utimes(lock.path, old, old);
    const replacement = await acquireTargetLock(directory, "gw-1", 60000);
    await replacement.release();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
