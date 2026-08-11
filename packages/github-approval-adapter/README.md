# GitHub PR Approval Adapter MCP

Read-only adapter that converts policy-compliant GitHub pull request reviews into Approval Record Format v1 artifacts for the fake Baseline Change Executor.

## MCP tool

- `get_github_pr_approval_records` reads one allowlisted pull request and its reviews.

The server has no GitHub write operation and no Check Point connection, credentials, or configuration tool. It always returns `effectsApplied: false`.

## Approval policy

The adapter fails closed unless all of the following are true:

- The requested `owner/repository` exactly matches the configured repository allowlist.
- The pull request is open, not a draft, targets an allowed base branch, and has the required label when configured.
- Both the head and base repositories equal the allowed repository; fork pull requests are rejected.
- The body contains exactly one machine-readable plan marker matching the plan ID, canonical SHA-256, and complete change ID set.
- A review belongs to the current pull request head SHA and is the latest submitted review for that user.
- The reviewer is explicitly allowlisted, is not the pull request author, and is not a bot.
- The decision is `APPROVED` or `CHANGES_REQUESTED`, was submitted after plan generation and no later than evaluation, and has not expired.

`APPROVED` becomes an `APPROVED` record and `CHANGES_REQUESTED` becomes a blocking `REJECTED` record. The stable GitHub numeric user ID is used as the approval subject; the login remains the display name.

## Pull request marker

Put this HTML comment in the pull request body using values emitted by the Planner:

```html
<!-- checkpoint-change-plan: {"planId":"plan-...","planSha256":"<64 lowercase hex characters>","changeIds":["change-..."]} -->
```

See the [marker schema](./schemas/github-pr-plan-marker-v1.schema.json) and [synthetic PR body](./examples/pull-request-body.example.md). Editing the plan requires updating the marker and obtaining reviews against the new head commit.

## Configuration

```text
GITHUB_APPROVAL_TOKEN=<read-only token>
GITHUB_APPROVAL_ALLOWED_REPOSITORIES=owner/change-approvals
GITHUB_APPROVAL_ALLOWED_BASE_BRANCHES=main
GITHUB_APPROVAL_ALLOWED_APPROVERS=alice,bob
GITHUB_APPROVAL_REQUIRED_LABEL=change-plan
GITHUB_APPROVAL_TTL_SECONDS=3600
```

Use a fine-grained token or GitHub App installation token limited to repository Pull requests: read and Metadata: read. Secrets are accepted only from the process environment, never through MCP arguments. The API host is fixed to `https://api.github.com`, requests time out after 15 seconds, and review retrieval is bounded at 1,000 records.

## Trust boundary

The adapter reads authenticated GitHub API state over TLS and emits schema-valid Approval Records with issuer `https://github.com`. The current fake Executor still accepts caller-supplied records and trusts an issuer allowlist; it does not cryptographically verify that a record came from this adapter. A production executor must invoke this adapter through a trusted channel or verify a signed adapter attestation. GitHub approval is evidence for a later authorization decision, not permission by itself to modify a device.

## Development

```shell
npm run build:tsc --workspace=@focuslight-nr/checkpoint-baseline-change-planner-mcp
npm run build:tsc --workspace=@focuslight-nr/checkpoint-baseline-change-executor-mcp
npm run test --workspace=@focuslight-nr/checkpoint-github-approval-adapter-mcp
npm run build --workspace=@focuslight-nr/checkpoint-github-approval-adapter-mcp
```
