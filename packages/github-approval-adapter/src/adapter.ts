import { parseApprovalRecord } from "@focuslight-nr/checkpoint-baseline-change-executor-mcp/schema";
import type { ApprovalRecord } from "@focuslight-nr/checkpoint-baseline-change-executor-mcp/types";
import { changePlanDigest } from "@focuslight-nr/checkpoint-baseline-change-planner-mcp/planner";
import { parseChangePlan } from "@focuslight-nr/checkpoint-baseline-change-planner-mcp/schema";
import { parseGithubPlanMarker } from "./marker.js";
import type {
  CollectGithubApprovalsInput,
  GithubApprovalConfig,
  GithubApprovalResult,
  GithubApprovalSource,
  GithubReview,
  IgnoredReview,
} from "./types.js";

function sameSet(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((item, index) => item === [...right].sort()[index])
  );
}

function laterReview(left: GithubReview, right: GithubReview): GithubReview {
  const leftTime = Date.parse(left.submitted_at ?? "");
  const rightTime = Date.parse(right.submitted_at ?? "");
  if (leftTime !== rightTime) return leftTime > rightTime ? left : right;
  return left.id > right.id ? left : right;
}

export async function collectGithubApprovalRecords(
  input: CollectGithubApprovalsInput,
  config: GithubApprovalConfig,
  source: GithubApprovalSource,
): Promise<GithubApprovalResult> {
  const repository = input.repository.toLowerCase();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repository))
    throw new Error("repository must use owner/repository format");
  if (!config.allowedRepositories.includes(repository))
    throw new Error("repository is not allowed by adapter policy");
  if (!Number.isInteger(input.pullRequestNumber) || input.pullRequestNumber < 1)
    throw new Error("pullRequestNumber must be a positive integer");
  const evaluatedAt = input.evaluatedAt ?? new Date().toISOString();
  const evaluatedTime = Date.parse(evaluatedAt);
  if (Number.isNaN(evaluatedTime))
    throw new Error("evaluatedAt must be an ISO 8601 timestamp");

  const plan = parseChangePlan(input.changePlan);
  const planSha256 = changePlanDigest(plan);
  const pr = await source.getPullRequest(
    input.repository,
    input.pullRequestNumber,
  );
  if (pr.number !== input.pullRequestNumber)
    throw new Error("GitHub returned a different pull request number");
  if (pr.state !== "open" || pr.draft)
    throw new Error("pull request must be open and ready for review");
  if (
    pr.base.repo.full_name.toLowerCase() !== repository ||
    pr.head.repo?.full_name.toLowerCase() !== repository
  ) {
    throw new Error(
      "pull request base and head must belong to the allowed repository",
    );
  }
  if (!config.allowedBaseBranches.includes(pr.base.ref))
    throw new Error(
      "pull request base branch is not allowed by adapter policy",
    );
  if (
    config.requiredLabel &&
    !pr.labels.some((label) => label.name === config.requiredLabel)
  ) {
    throw new Error(
      `pull request is missing required label: ${config.requiredLabel}`,
    );
  }

  const marker = parseGithubPlanMarker(pr.body);
  const changeIds = plan.changes.map((change) => change.id);
  if (
    marker.planId !== plan.plan.id ||
    marker.planSha256 !== planSha256 ||
    !sameSet(marker.changeIds, changeIds)
  ) {
    throw new Error(
      "pull request marker does not match the complete change plan",
    );
  }

  const reviews = await source.listPullRequestReviews(
    input.repository,
    input.pullRequestNumber,
  );
  const ignoredReviews: IgnoredReview[] = [];
  const latestByReviewer = new Map<number, GithubReview>();
  for (const review of reviews) {
    const login = review.user?.login.toLowerCase();
    if (!login || !review.submitted_at) {
      ignoredReviews.push({
        reviewId: review.id,
        reviewer: login,
        reason: "missing reviewer or submitted timestamp",
      });
      continue;
    }
    if (review.commit_id !== pr.head.sha) {
      ignoredReviews.push({
        reviewId: review.id,
        reviewer: login,
        reason: "review is for an older head commit",
      });
      continue;
    }
    const userId = review.user!.id;
    const current = latestByReviewer.get(userId);
    latestByReviewer.set(
      userId,
      current ? laterReview(current, review) : review,
    );
  }

  const approvalRecords: ApprovalRecord[] = [];
  for (const [userId, review] of [...latestByReviewer.entries()].sort(
    ([left], [right]) => left - right,
  )) {
    const login = review.user!.login.toLowerCase();
    if (!config.allowedApprovers.includes(login)) {
      ignoredReviews.push({
        reviewId: review.id,
        reviewer: login,
        reason: "reviewer is not allowed by adapter policy",
      });
      continue;
    }
    if (userId === pr.user.id) {
      ignoredReviews.push({
        reviewId: review.id,
        reviewer: login,
        reason: "pull request authors cannot approve their own plan",
      });
      continue;
    }
    if (review.user?.type === "Bot" || login.endsWith("[bot]")) {
      ignoredReviews.push({
        reviewId: review.id,
        reviewer: login,
        reason: "bot reviews are not accepted",
      });
      continue;
    }
    if (review.state !== "APPROVED" && review.state !== "CHANGES_REQUESTED") {
      ignoredReviews.push({
        reviewId: review.id,
        reviewer: login,
        reason: `latest review state ${review.state} is not a decision`,
      });
      continue;
    }
    const approvedAt = review.submitted_at!;
    const approvedTime = Date.parse(approvedAt);
    if (
      approvedTime < Date.parse(plan.plan.generatedAt) ||
      approvedTime > evaluatedTime
    ) {
      ignoredReviews.push({
        reviewId: review.id,
        reviewer: login,
        reason: "review is outside the plan evaluation window",
      });
      continue;
    }
    const expiresAt = new Date(
      Date.parse(approvedAt) + config.approvalTtlSeconds * 1000,
    ).toISOString();
    if (Date.parse(expiresAt) <= evaluatedTime) {
      ignoredReviews.push({
        reviewId: review.id,
        reviewer: login,
        reason: "review approval record has expired",
      });
      continue;
    }
    approvalRecords.push(
      parseApprovalRecord({
        $schema:
          "https://github.com/focuslight-nr/mcp-servers/blob/main/packages/baseline-change-executor/schemas/approval-record-format-v1.schema.json",
        formatVersion: "1.0",
        approval: {
          id: `github-review-${review.id}`,
          planId: plan.plan.id,
          planSha256,
          changeIds,
          decision: review.state === "APPROVED" ? "APPROVED" : "REJECTED",
          approver: {
            subject: `github-user:${userId}`,
            displayName: review.user!.login,
            issuer: "https://github.com",
            authentication: "external-identity-provider",
          },
          approvedAt,
          expiresAt,
          reason: `GitHub pull request review ${review.state}`,
          provenanceReference: review.html_url,
        },
      }),
    );
  }
  return {
    repository: input.repository,
    pullRequestNumber: input.pullRequestNumber,
    pullRequestUrl: pr.html_url,
    headSha: pr.head.sha,
    planId: plan.plan.id,
    planSha256,
    approvalRecords,
    ignoredReviews,
    evaluatedAt: new Date(evaluatedTime).toISOString(),
    effectsApplied: false,
  };
}
