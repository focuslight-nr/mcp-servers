# Experimental Read-only Audit Extension

## Status and ownership

This extension is community-developed work in a fork of the Check Point MCP Servers repository. It is not part of the upstream project, is not an official Check Point product, and is not endorsed or supported by Check Point Software Technologies Ltd.

The upstream source remains covered by its existing MIT license and copyright notice. Keep the repository `LICENSE` file and original notices when redistributing the fork.

## Why this extension exists

The upstream Gaia and Management MCP servers make Check Point product capabilities available to AI clients. That is useful for interactive investigation and administration, but unattended auditing needs a smaller and more deterministic operating boundary:

1. A scheduled process cannot answer interactive credential prompts.
2. A read-only audit should not expose unrelated write operations to the agent.
3. Compliance decisions should be reproducible code, not an unconstrained language-model judgment.
4. Operations need retries, locking, history, reports, exit codes, and notification routing outside the audit evaluator.

The extension separates those responsibilities into collection, evaluation, orchestration, non-executable change planning, approval validation, and fake dry-run components.

## Architecture

```mermaid
flowchart LR
  Baseline[Baseline Format v1 JSON] --> Audit[Security Baseline Audit MCP]
  Runner[AgentRunner] --> Collector[Gaia Read-only Collector MCP]
  Runner --> Management[Upstream Management MCP]
  Collector --> Audit[Security Baseline Audit MCP]
  Management --> Audit
  Audit --> Reports[JSON and Markdown reports]
  Audit --> Planner[Baseline Change Planner MCP]
  Planner --> Proposal[Non-executable Change Plan v1]
  Approval[External Approval Record v1] --> FakeExecutor[Fake Gaia Dry-run Executor MCP]
  Proposal --> FakeExecutor
  FakeExecutor --> Receipt[Dry-run Receipt v1]
  Runner --> Notify[HTTPS webhook]
```

### Gaia Read-only Collector MCP

Package: `packages/gaia-readonly-collector`

- Exposes `show_dns`, `show_dhcp`, `show_date_time`, and the fixed aggregate `show_hardening_state`.
- The hardening snapshot uses only allowlisted official Gaia show APIs for version, users, roles, password policy, allowed clients, SNMP, syslog, and BGP configuration.
- Rejects targets not listed in `GAIA_ALLOWED_TARGETS`.
- Requires TLS certificate verification and supports a configured CA file.
- Resolves credentials from process environment profiles rather than MCP arguments.
- Provides no generic endpoint, arbitrary CLI, or configuration-write operation.

### Security Baseline Audit MCP

Package: `packages/baseline-audit`

- Accepts normalized observations or raw MCP responses.
- Validates strict Baseline Format v1 documents and rejects unknown fields.
- Supports organization-authored baselines through a non-executable declarative assertion language.
- Bundles independently authored example profiles; third-party benchmark publications are not included.
- Produces deterministic `PASS`, `FAIL`, `MANUAL`, `ERROR`, and `EXEMPTED` results.
- Persists audit history and reports regressions and improvements.
- Supports scoped, expiring exceptions without converting them into passes.
- Does not connect to or modify a Check Point system itself.
- Treats remediation action IDs as inert metadata for a separate future executor.

### Baseline Audit Runner

Package: `packages/baseline-audit-runner`

- Starts MCP servers over stdio and audits enabled targets with bounded concurrency.
- Requires a Baseline Format v1 JSON file with an explicit `inputs` list.
- Starts only the Gaia and Management collectors declared by the baseline `inputs` list.
- Passes target-specific non-secret parameters to the baseline evaluator.
- Retries failed attempts and prevents overlapping runs for the same target.
- Writes timestamped JSON and Markdown reports.
- Sends a minimal HTTPS webhook summary for configured result statuses.
- Includes Windows Task Scheduler and DPAPI credential-loading templates.

### Baseline Change Planner MCP

Package: `packages/baseline-change-planner`

- Accepts only read-only audit reports and an explicit action allowlist.
- Produces immutable Change Plan Format v1 proposals bound to the source audit SHA-256 digest.
- Includes failed-state preconditions, risk, human approval requirements, verification, backup, and rollback requirements.
- Exposes no Check Point credentials, network client, generic API or CLI operation, approval write path, or executor.
- Keeps approval records and future execution receipts outside the immutable proposal document.

### Baseline Change Executor MCP

Package: `packages/baseline-change-executor`

- Validates separate Approval Record Format v1 artifacts bound to the canonical plan SHA-256 digest.
- Requires trusted issuer, executor action, and fake backend capability allowlists.
- Checks distinct approver counts, active rejections, expiration, target identity, state freshness, backup capability, and unchanged failed observations.
- Produces deterministic `READY` or `BLOCKED` Dry-run Receipt Format v1 evidence with `effectsApplied: false`.
- Uses caller-supplied synthetic Gaia state and has no Check Point credentials, network client, API, CLI, or configuration-write tool.
- Does not authenticate approval identities; a future production adapter must verify external IdP or ticket-system signatures before providing approval records.

## Security boundary

This project starts with read-only auditing rather than automated remediation. The main controls are:

- Fixed Collector tools instead of arbitrary Gaia API access.
- Exact target allowlisting.
- TLS verification with no insecure bypass option.
- Explicit environment-variable forwarding between processes.
- No credentials in MCP arguments, reports, fixtures, or sample configuration values.
- Deterministic evaluation independent of an LLM.
- Strict baseline validation and no executable expressions, scripts, network references, or file references.
- Remediation metadata is not executable by the audit MCP or Runner.
- Change plans are proposals with `executionAllowed: false`; the Planner cannot approve or execute them.
- Dry-run `READY` means only that supplied synthetic artifacts passed deterministic checks; it is not authorization to change a device.
- Approval schema validation and issuer allowlisting do not establish identity authenticity.
- Separate scheduling and notification from evidence evaluation.

Automated configuration should be implemented later as a separate component with explicit approval, a per-control operation allowlist, pre-change backup, post-change verification, and rollback behavior.

## Validation status

The following checks do not require a Check Point device and have been completed:

- Gaia Read-only Collector unit and stdio tests.
- Security Baseline Audit MCP unit and stdio integration tests.
- Baseline Change Planner schema, deterministic planning, safety-invariant, and stdio integration tests.
- Approval Record and Dry-run Receipt schema tests plus Fake Gaia Executor fail-closed and stdio integration tests.
- Baseline Audit Runner unit and fixture integration tests.
- Real stdio MCP client/server exchanges.
- Fixture audit using the independently authored organization baseline example.
- Organization-authored baseline evaluation and input-driven Collector selection.
- Monorepo package builds, configuration validation, report generation, and PowerShell syntax checks.

The following require a lab or production-approved Check Point environment:

- Gaia API response fields and version differences.
- Minimum service-account permissions for each read operation.
- Management API pagination against a large real rulebase.
- CA chain and hostname validation.
- Session expiration and reauthentication behavior.
- Audit accuracy against real policy and device configurations.

## Baseline content

This repository does not include third-party benchmark publications. It includes independently authored examples and a concise profile based on public Check Point hardening guidance. The profile links to, but does not replace or reproduce, the official guide and is not an official Check Point certification.

Users who load external baseline content are responsible for obtaining it lawfully, complying with its license and trademark terms, and validating that the implemented assertions accurately represent their intended policy. An audit result is evidence from the supplied observations, not a product certification.

## Maintaining and redistributing this fork

This section is for maintainers of this public fork and anyone who redistributes or derives another fork from it. The repository follows these ongoing publication and maintenance requirements:

1. Preserve the upstream `LICENSE` and copyright notice.
2. Continue to identify the fork as community-developed and unofficial in the repository description and README.
3. Do not commit third-party benchmark publications, production reports, credentials, CA private keys, DPAPI files, or real target configuration.
4. Use documentation-only IP ranges and synthetic fixtures in published examples and tests.
5. Protect changes with secret scanning, tests, builds, and dependency review in CI.
6. Keep fork-owned packages unpublished until a separate npm publication and naming review is complete.
7. Keep upstream release automation disabled and use fork-owned test and build workflows.

For an upstream contribution, follow the upstream contribution process and let the maintainers decide package naming, scope, ownership, and product positioning.
