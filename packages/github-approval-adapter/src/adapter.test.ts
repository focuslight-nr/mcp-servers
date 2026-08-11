import assert from "node:assert/strict";
import test from "node:test";
import { collectGithubApprovalRecords } from "./adapter.js";
import { formatGithubPlanMarker } from "./marker.js";
import {
  FakeGithubSource,
  config,
  examplePlan,
  pullRequest,
  review,
} from "./test-fixtures.js";

const input = (plan: Awaited<ReturnType<typeof examplePlan>>) => ({
  repository: "focuslight-nr/change-approvals",
  pullRequestNumber: 42,
  changePlan: plan,
  evaluatedAt: "2026-08-11T08:00:00.000Z",
});

test("converts current allowed approvals and rejections into bound records", async () => {
  const plan = await examplePlan();
  const result = await collectGithubApprovalRecords(
    input(plan),
    config,
    new FakeGithubSource(pullRequest(plan), [
      review(1, "Alice"),
      review(2, "Bob", "CHANGES_REQUESTED"),
    ]),
  );
  assert.deepEqual(
    result.approvalRecords.map((item) => item.approval.decision),
    ["APPROVED", "REJECTED"],
  );
  assert.equal(
    result.approvalRecords[0]!.approval.approver.issuer,
    "https://github.com",
  );
  assert.equal(result.effectsApplied, false);
});

test("uses only each reviewer's latest decision on the current head", async () => {
  const plan = await examplePlan();
  const reviews = [
    review(1, "Alice", "APPROVED", {
      submitted_at: "2026-08-11T07:10:00.000Z",
    }),
    review(2, "Alice", "CHANGES_REQUESTED", {
      submitted_at: "2026-08-11T07:20:00.000Z",
    }),
    review(3, "Bob", "APPROVED", { commit_id: "old-head" }),
  ];
  const result = await collectGithubApprovalRecords(
    input(plan),
    config,
    new FakeGithubSource(pullRequest(plan), reviews),
  );
  assert.equal(result.approvalRecords.length, 1);
  assert.equal(result.approvalRecords[0]!.approval.id, "github-review-2");
  assert.equal(result.approvalRecords[0]!.approval.decision, "REJECTED");
  assert.equal(
    result.ignoredReviews.some((item) => item.reason.includes("older head")),
    true,
  );
});

test("ignores self, bot, disallowed, non-decision, and expired reviews", async () => {
  const plan = await examplePlan();
  const reviews = [
    review(1, "author", "APPROVED", {
      user: { id: 100, login: "author", type: "User" },
    }),
    review(2, "build[bot]", "APPROVED", {
      user: { id: 1003, login: "build[bot]", type: "Bot" },
    }),
    review(3, "mallory"),
    review(4, "alice", "COMMENTED"),
    review(5, "bob", "APPROVED", { submitted_at: "2026-08-11T06:00:00.000Z" }),
  ];
  const result = await collectGithubApprovalRecords(
    input(plan),
    config,
    new FakeGithubSource(pullRequest(plan), reviews),
  );
  assert.equal(result.approvalRecords.length, 0);
  assert.equal(result.ignoredReviews.length, 5);
});

test("ignores reviews before plan generation or after evaluation", async () => {
  const plan = await examplePlan();
  const reviews = [
    review(1, "alice", "APPROVED", {
      submitted_at: "2026-08-11T06:59:59.000Z",
    }),
    review(2, "bob", "APPROVED", { submitted_at: "2026-08-11T08:00:01.000Z" }),
  ];
  const result = await collectGithubApprovalRecords(
    input(plan),
    config,
    new FakeGithubSource(pullRequest(plan), reviews),
  );
  assert.equal(result.approvalRecords.length, 0);
  assert.equal(
    result.ignoredReviews.every((item) =>
      item.reason.includes("evaluation window"),
    ),
    true,
  );
});

test("fails closed when PR policy or marker binding does not match", async () => {
  const plan = await examplePlan();
  await assert.rejects(
    () =>
      collectGithubApprovalRecords(
        input(plan),
        config,
        new FakeGithubSource(pullRequest(plan, { draft: true }), []),
      ),
    /open and ready/,
  );
  await assert.rejects(
    () =>
      collectGithubApprovalRecords(
        input(plan),
        config,
        new FakeGithubSource(pullRequest(plan, { labels: [] }), []),
      ),
    /required label/,
  );
  await assert.rejects(
    () =>
      collectGithubApprovalRecords(
        input(plan),
        config,
        new FakeGithubSource(
          pullRequest(plan, {
            head: { sha: "abc123", repo: { full_name: "other/fork" } },
          }),
          [],
        ),
      ),
    /base and head/,
  );
  const badBody = formatGithubPlanMarker({
    planId: plan.plan.id,
    planSha256: "0".repeat(64),
    changeIds: plan.changes.map((change) => change.id),
  });
  await assert.rejects(
    () =>
      collectGithubApprovalRecords(
        input(plan),
        config,
        new FakeGithubSource(pullRequest(plan, { body: badBody }), []),
      ),
    /does not match/,
  );
});
