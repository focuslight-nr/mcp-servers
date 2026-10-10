import assert from "node:assert/strict";
import test from "node:test";
import { collectGithubApprovalRecords } from "./adapter.js";
import { FakeGithubSource, config, examplePlan, pullRequest, review } from "./test-fixtures.js";

const input = (changePlan: unknown) => ({
  repository: "focuslight-nr/change-approvals", pullRequestNumber: 42,
  changePlan, evaluatedAt: "2026-08-11T08:00:00.000Z",
});

test("rejects a replaced body and caller plan before reading reviews", async () => {
  const original = await examplePlan();
  const changed = structuredClone(original);
  changed.plan.title = "Changed after review";
  const source = new FakeGithubSource(pullRequest(changed), [review(1, "alice")]);
  source.committedPlan = original;
  let reads = 0;
  source.listPullRequestReviews = async () => { reads++; return source.reviews; };
  await assert.rejects(() => collectGithubApprovalRecords(input(changed), config, source), /committed change plan/);
  assert.equal(reads, 0);
});

test("missing, invalid and unavailable committed plans fail closed", async () => {
  const plan = await examplePlan();
  for (const value of [null, {}, { ...plan, unexpected: true }]) {
    const source = new FakeGithubSource(pullRequest(plan), [review(1, "alice")]);
    source.committedPlan = value;
    await assert.rejects(() => collectGithubApprovalRecords(input(plan), config, source));
  }
  const source = new FakeGithubSource(pullRequest(plan), [review(1, "alice")]);
  source.getCommittedChangePlan = async () => { throw new Error("unavailable"); };
  await assert.rejects(() => collectGithubApprovalRecords(input(plan), config, source), /unavailable/);
});

test("canonical matching accepts reordered keys and preserves review decisions", async () => {
  const plan = await examplePlan();
  const source = new FakeGithubSource(pullRequest(plan), [review(1, "alice"), review(2, "bob", "CHANGES_REQUESTED")]);
  source.committedPlan = Object.fromEntries(Object.entries(plan).reverse());
  const result = await collectGithubApprovalRecords(input(plan), config, source);
  assert.deepEqual(result.approvalRecords.map(record => record.approval.decision), ["APPROVED", "REJECTED"]);
  assert.equal(result.effectsApplied, false);
});

test("committing a replacement plan does not reuse old head reviews", async () => {
  const plan = await examplePlan();
  plan.plan.title = "New plan";
  const source = new FakeGithubSource(pullRequest(plan, {
    head: { sha: "b".repeat(40), repo: { full_name: "focuslight-nr/change-approvals" } },
  }), [review(1, "alice")]);
  source.committedPlan = plan;
  const result = await collectGithubApprovalRecords(input(plan), config, source);
  assert.equal(result.approvalRecords.length, 0);
  assert.match(result.ignoredReviews[0]!.reason, /older head/);
});

test("rejects mutable head refs before fetching a plan", async () => {
  const plan = await examplePlan();
  const source = new FakeGithubSource(pullRequest(plan, {
    head: { sha: "main", repo: { full_name: "focuslight-nr/change-approvals" } },
  }), []);
  let reads = 0;
  source.getCommittedChangePlan = async () => { reads++; return plan; };
  await assert.rejects(() => collectGithubApprovalRecords(input(plan), config, source), /head commit SHA/);
  assert.equal(reads, 0);
});
