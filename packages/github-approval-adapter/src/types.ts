import type { ApprovalRecord } from "@focuslight-nr/checkpoint-baseline-change-executor-mcp/types";
import type { ChangePlan } from "@focuslight-nr/checkpoint-baseline-change-planner-mcp/types";

export interface GithubApprovalConfig {
  allowedRepositories: string[];
  allowedBaseBranches: string[];
  allowedApprovers: string[];
  requiredLabel?: string;
  approvalTtlSeconds: number;
}

export interface GithubPullRequest {
  number: number;
  state: string;
  draft: boolean;
  body: string | null;
  html_url: string;
  user: { id: number; login: string };
  base: { ref: string; repo: { full_name: string } };
  head: { sha: string; repo: { full_name: string } | null };
  labels: Array<{ name: string }>;
}

export interface GithubReview {
  id: number;
  user: { id: number; login: string; type?: string } | null;
  state: string;
  html_url: string;
  submitted_at: string | null;
  commit_id: string;
}

export interface GithubApprovalSource {
  getCommittedChangePlan(repository: string, commitSha: string): Promise<unknown>;
  getPullRequest(
    repository: string,
    pullNumber: number,
  ): Promise<GithubPullRequest>;
  listPullRequestReviews(
    repository: string,
    pullNumber: number,
  ): Promise<GithubReview[]>;
}

export interface IgnoredReview {
  reviewId: number;
  reviewer?: string;
  reason: string;
}

export interface GithubApprovalResult {
  repository: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  headSha: string;
  planId: string;
  planSha256: string;
  approvalRecords: ApprovalRecord[];
  ignoredReviews: IgnoredReview[];
  evaluatedAt: string;
  effectsApplied: false;
}

export interface CollectGithubApprovalsInput {
  repository: string;
  pullRequestNumber: number;
  changePlan: ChangePlan | unknown;
  evaluatedAt?: string;
}
