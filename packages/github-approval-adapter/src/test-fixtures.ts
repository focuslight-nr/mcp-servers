import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { changePlanDigest } from "@focuslight-nr/checkpoint-baseline-change-planner-mcp/planner";
import { parseChangePlan } from "@focuslight-nr/checkpoint-baseline-change-planner-mcp/schema";
import type { ChangePlan } from "@focuslight-nr/checkpoint-baseline-change-planner-mcp/types";
import { formatGithubPlanMarker } from "./marker.js";
import type {
  GithubApprovalConfig,
  GithubApprovalSource,
  GithubPullRequest,
  GithubReview,
} from "./types.js";

export async function examplePlan(): Promise<ChangePlan> {
  const path = fileURLToPath(
    new URL(
      "../../baseline-change-planner/examples/change-plan.example.json",
      import.meta.url,
    ),
  );
  return parseChangePlan(JSON.parse(await readFile(path, "utf8")));
}

export const config: GithubApprovalConfig = {
  allowedRepositories: ["focuslight-nr/change-approvals"],
  allowedBaseBranches: ["main"],
  allowedApprovers: ["alice", "bob", "author", "build[bot]"],
  requiredLabel: "change-plan",
  approvalTtlSeconds: 3600,
};

export function pullRequest(
  plan: ChangePlan,
  overrides: Partial<GithubPullRequest> = {},
): GithubPullRequest {
  return {
    number: 42,
    state: "open",
    draft: false,
    body: formatGithubPlanMarker({
      planId: plan.plan.id,
      planSha256: changePlanDigest(plan),
      changeIds: plan.changes.map((change) => change.id),
    }),
    html_url: "https://github.com/focuslight-nr/change-approvals/pull/42",
    user: { id: 100, login: "author" },
    base: {
      ref: "main",
      repo: { full_name: "focuslight-nr/change-approvals" },
    },
    head: {
      sha: "abc123",
      repo: { full_name: "focuslight-nr/change-approvals" },
    },
    labels: [{ name: "change-plan" }],
    ...overrides,
  };
}

export function review(
  id: number,
  login: string,
  state = "APPROVED",
  overrides: Partial<GithubReview> = {},
): GithubReview {
  const userIds: Record<string, number> = {
    alice: 1001,
    bob: 1002,
    author: 100,
    "build[bot]": 1003,
    mallory: 1004,
  };
  return {
    id,
    user: { id: userIds[login.toLowerCase()] ?? 9000, login, type: "User" },
    state,
    html_url: `https://github.com/focuslight-nr/change-approvals/pull/42#pullrequestreview-${id}`,
    submitted_at: "2026-08-11T07:30:00.000Z",
    commit_id: "abc123",
    ...overrides,
  };
}

export class FakeGithubSource implements GithubApprovalSource {
  constructor(
    public pr: GithubPullRequest,
    public reviews: GithubReview[],
  ) {}
  async getPullRequest(): Promise<GithubPullRequest> {
    return this.pr;
  }
  async listPullRequestReviews(): Promise<GithubReview[]> {
    return this.reviews;
  }
}
