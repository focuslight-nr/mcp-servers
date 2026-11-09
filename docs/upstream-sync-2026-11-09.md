# Upstream sync (2026-11-09)

Merged `CheckPointSW/mcp-servers` `main` at `81de7cc` into the fork's `main` at
`1eafe8d`. This includes the vendor's published fix for HTTP session credential
inheritance. The upstream constructor now accepts only explicit credentials;
`fromArgs` applies environment defaults for CLI/stdio use. The fork's earlier
HTTP isolation regression tests were updated to check this contract.

The merge retains the fork-only baseline, Gaia collector, and GitHub approval
packages, their build entries and CI; the WAF GraphQL write guard; dependency
overrides; and the fork's policy of not publishing through upstream release
workflows. It also adds the upstream Cloud Firewall and Harmony Email packages.

Validation completed locally:

- HTTP settings regression tests: 12 passed.
- WAF write guard tests: 6 passed.
- Upstream regression tests: 8 passed.
- All six fork-specific package test suites and bundle builds passed.
- `@chkp/mcp-utils` and `@chkp/quantum-infra` TypeScript builds passed.

The root `build:tsc` command still reports implicit-`any` errors in four
upstream server entry points: GW CLI, GW CLI Connection Analysis, Spark
Management, and Harmony SASE. Those four files match upstream `main`; the
errors are unrelated to merge conflict resolution. The other 22 projects in
that command passed. No live Check Point service was contacted.
