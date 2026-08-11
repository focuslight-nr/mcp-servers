# Check Point Baseline Change Planner MCP

Deterministic, read-only generator and validator for Change Plan Format v1 proposals.

The Planner consumes a read-only Baseline Audit report and an explicit action allowlist. It creates proposals only for `FAIL` results that contain allowlisted remediation metadata. It has no Check Point credentials, network client, approval write path, generic API tool, CLI execution tool, or change executor.

## MCP tools

- `plan_audit_remediation` creates an unapproved, non-executable proposal.
- `validate_change_plan` validates a proposal without approving or executing it.

Both tools return JSON. A valid plan always has `status: PROPOSED`, `executionAllowed: false`, an empty approvals array, and a single target.

## Change Plan Format v1

The canonical schema is [change-plan-format-v1.schema.json](./schemas/change-plan-format-v1.schema.json). A complete synthetic document is available at [change-plan.example.json](./examples/change-plan.example.json).

Each plan binds to the canonical SHA-256 digest of its source audit report. Planner and validation responses also return the canonical SHA-256 digest of the complete plan document for future approval binding. The plan records:

- The exact baseline version and target.
- An allowlisted action ID and declarative parameters, never a command or API path.
- The failed observation that must remain unchanged before execution.
- Risk and minimum human approval requirements.
- Mandatory dry-run, pre-change backup, post-change audit, and rollback requirements.
- Controls that could not be planned because remediation metadata was absent or not allowlisted.

High and critical changes require two approvals; low and medium changes require one. Missing severity defaults to medium for compatibility with older reports.

The plan document is immutable proposal evidence. Approval records and dry-run receipts remain separate artifacts bound to the plan digest; changing the plan invalidates those records. The sibling Fake Gaia Executor package validates these artifacts without applying configuration.

## Example call

```json
{
  "audit_report": { "...": "Baseline Audit JSON report" },
  "allowed_actions": ["gaia.setDnsServers"],
  "audit_id": "audit-example-001",
  "generated_at": "2026-08-11T07:00:00.000Z"
}
```

An empty or duplicate allowlist is rejected. `PASS`, `EXEMPTED`, `MANUAL`, and `ERROR` results never become changes.

## Development

```shell
npm run test --workspace=@focuslight-nr/checkpoint-baseline-change-planner-mcp
npm run build --workspace=@focuslight-nr/checkpoint-baseline-change-planner-mcp
```
