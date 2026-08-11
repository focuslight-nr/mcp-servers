import assert from "node:assert/strict";
import test from "node:test";
import { formatGithubPlanMarker, parseGithubPlanMarker } from "./marker.js";

const marker = {
  planId: "plan-1",
  planSha256: "a".repeat(64),
  changeIds: ["change-1"],
};

test("round-trips exactly one machine-readable marker", () => {
  assert.deepEqual(
    parseGithubPlanMarker(`Review this.\n${formatGithubPlanMarker(marker)}`),
    marker,
  );
});

test("rejects missing, duplicate, malformed, and duplicate-change markers", () => {
  assert.throws(() => parseGithubPlanMarker("none"), /exactly one/);
  const formatted = formatGithubPlanMarker(marker);
  assert.throws(
    () => parseGithubPlanMarker(`${formatted}\n${formatted}`),
    /exactly one/,
  );
  assert.throws(
    () => parseGithubPlanMarker("<!-- checkpoint-change-plan: nope -->"),
    /invalid/,
  );
  assert.throws(
    () =>
      parseGithubPlanMarker(
        formatGithubPlanMarker({
          ...marker,
          changeIds: ["change-1", "change-1"],
        }),
      ),
    /unique/,
  );
});
