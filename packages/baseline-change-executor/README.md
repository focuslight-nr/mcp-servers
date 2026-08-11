# Check Point Baseline Change Executor MCP

Fake Gaia dry-run evaluator for approved Change Plan Format v1 proposals.

Despite the package name, this version is not a real change executor. It has no Check Point credentials, network client, Gaia API or CLI implementation, filesystem state store, or tool that applies configuration. It evaluates supplied artifacts and returns a Dry-run Receipt Format v1 document with `effectsApplied: false`.

## MCP tools

- `dry_run_change_plan` evaluates a plan, approval records, and caller-supplied fake Gaia state.
- `validate_approval_record` validates Approval Record Format v1.
- `validate_dry_run_receipt` validates Dry-run Receipt Format v1.

No tool approves a plan or modifies a target.

## Dry-run checks

The dry run returns `READY` only when all checks pass:

- The fake state target exactly matches the single plan target.
- The fake state is not future-dated or older than `max_state_age_seconds`.
- The fake backend reports pre-change backup capability.
- Every action is present in both the executor policy allowlist and fake backend support list.
- Current fake observations still equal the failed observations bound into the plan.
- Every approval matches the exact plan ID, canonical plan SHA-256, and known change IDs.
- Approval issuers are explicitly trusted, approvals are current, and no active trusted rejection applies.
- Each change has the required number of distinct approver identities.

Any failed check produces `BLOCKED`. Proposed actions remain declarative receipt data and are never invoked.

Input bounds limit a plan to 100 changes, approval input to 100 records, action policy to 100 IDs, trusted issuers to 20, and fake-state freshness to at most 24 hours.

## Approval boundary

Approval Record Format v1 is an immutable artifact separate from the plan. It binds a decision to the complete plan digest and selected change IDs. See [approval-record-format-v1.schema.json](./schemas/approval-record-format-v1.schema.json) and the [synthetic example](./examples/approval-record.example.json).

Schema validation and issuer allowlisting do not authenticate a person or verify an identity-provider signature. A production approval adapter must verify the external IdP assertion or ticket-system signature before passing a record to a future executor. `provenanceReference` is an opaque reference, not trusted evidence by itself.

## Fake state and receipt

The [fake Gaia state](./examples/fake-gaia-state.example.json) is caller-controlled test data. A `READY` result proves only that the supplied synthetic artifacts satisfy these deterministic checks; it is not authorization to make a real change.

The generated [dry-run receipt](./examples/dry-run-receipt.example.json) records every check, the proposed action metadata, and `effectsApplied: false`. The MCP response also returns the canonical receipt SHA-256 for later evidence binding.

## Development

Build the Planner first because this package consumes its schemas and digest implementation:

```shell
npm run build:tsc --workspace=@focuslight-nr/checkpoint-baseline-change-planner-mcp
npm run test --workspace=@focuslight-nr/checkpoint-baseline-change-executor-mcp
npm run build --workspace=@focuslight-nr/checkpoint-baseline-change-executor-mcp
```
