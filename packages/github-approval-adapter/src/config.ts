import type { GithubApprovalConfig } from "./types.js";

const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function requiredList(env: NodeJS.ProcessEnv, name: string): string[] {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (items.length === 0 || new Set(items).size !== items.length) {
    throw new Error(
      `${name} must contain a non-empty, unique comma-separated list`,
    );
  }
  return items;
}

export function loadGithubApprovalConfig(
  env: NodeJS.ProcessEnv,
): GithubApprovalConfig {
  const repositories = requiredList(
    env,
    "GITHUB_APPROVAL_ALLOWED_REPOSITORIES",
  );
  if (!repositories.every((repository) => repositoryPattern.test(repository))) {
    throw new Error(
      "GITHUB_APPROVAL_ALLOWED_REPOSITORIES must use owner/repository entries",
    );
  }
  const ttl = Number(env.GITHUB_APPROVAL_TTL_SECONDS ?? "3600");
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 86400) {
    throw new Error(
      "GITHUB_APPROVAL_TTL_SECONDS must be an integer from 60 to 86400",
    );
  }
  const requiredLabel = env.GITHUB_APPROVAL_REQUIRED_LABEL?.trim();
  const normalizedRepositories = repositories.map((item) => item.toLowerCase());
  const normalizedApprovers = requiredList(
    env,
    "GITHUB_APPROVAL_ALLOWED_APPROVERS",
  ).map((item) => item.toLowerCase());
  if (new Set(normalizedRepositories).size !== normalizedRepositories.length) {
    throw new Error(
      "GITHUB_APPROVAL_ALLOWED_REPOSITORIES contains duplicate case-insensitive entries",
    );
  }
  if (new Set(normalizedApprovers).size !== normalizedApprovers.length) {
    throw new Error(
      "GITHUB_APPROVAL_ALLOWED_APPROVERS contains duplicate case-insensitive entries",
    );
  }
  return {
    allowedRepositories: normalizedRepositories,
    allowedBaseBranches: requiredList(
      env,
      "GITHUB_APPROVAL_ALLOWED_BASE_BRANCHES",
    ),
    allowedApprovers: normalizedApprovers,
    requiredLabel: requiredLabel || undefined,
    approvalTtlSeconds: ttl,
  };
}

export function requireGithubToken(env: NodeJS.ProcessEnv): string {
  const token = env.GITHUB_APPROVAL_TOKEN?.trim();
  if (!token) throw new Error("GITHUB_APPROVAL_TOKEN is required");
  return token;
}
