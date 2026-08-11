import assert from "node:assert/strict";
import test from "node:test";
import { loadGithubApprovalConfig, requireGithubToken } from "./config.js";

test("loads bounded allowlist policy without exposing a token", () => {
  const loaded = loadGithubApprovalConfig({
    GITHUB_APPROVAL_ALLOWED_REPOSITORIES: "Owner/Repo",
    GITHUB_APPROVAL_ALLOWED_BASE_BRANCHES: "main,release",
    GITHUB_APPROVAL_ALLOWED_APPROVERS: "Alice,Bob",
    GITHUB_APPROVAL_REQUIRED_LABEL: "change-plan",
    GITHUB_APPROVAL_TTL_SECONDS: "600",
  });
  assert.deepEqual(loaded.allowedRepositories, ["owner/repo"]);
  assert.deepEqual(loaded.allowedApprovers, ["alice", "bob"]);
  assert.equal(loaded.approvalTtlSeconds, 600);
  assert.equal("token" in loaded, false);
});

test("fails closed for missing policy, invalid TTL, and missing token", () => {
  assert.throws(() => loadGithubApprovalConfig({}), /required/);
  assert.throws(
    () =>
      loadGithubApprovalConfig({
        GITHUB_APPROVAL_ALLOWED_REPOSITORIES: "owner/repo",
        GITHUB_APPROVAL_ALLOWED_BASE_BRANCHES: "main",
        GITHUB_APPROVAL_ALLOWED_APPROVERS: "alice",
        GITHUB_APPROVAL_TTL_SECONDS: "86401",
      }),
    /60 to 86400/,
  );
  assert.throws(() => requireGithubToken({}), /required/);
});
