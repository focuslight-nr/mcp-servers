# Upstream integration assessment (2026-10-08)

Source: CheckPointSW/mcp-servers `431514c125d63b50c6620fee667c803359a17bfe`.
Fork base: `70685d9`; common ancestor: `ff1a188`.
This is a selective source backport, not a merge of upstream history.

## Integrated

- WAF: GraphQL AST validation and process/session write-permission ceiling (previous backport retained).
- Shared utilities: replay and apply tool policy before connecting each HTTP session; mirror positive boolean CLI flags to declared environment flags; record transport in existing telemetry. No configured negated boolean/env pairing was found in existing server configs.
- Argos ERM: session-local customer selection/cache, customer validation, session-aware regional routing, IOC normalization/parsing. All callers of customer helpers were checked for propagation of MCP callback context.
- CPInfo and CPView: optional canonical allowed-root confinement, symlink/traversal checks, sanitized filesystem errors, HTTP deployment warnings. Existing deployments without allowed roots retain broad filesystem access. Configure `CPINFO_ALLOWED_ROOTS` / `CPVIEW_ALLOWED_ROOTS` to constrain it. CPView no longer expands environment variables in paths; migrate such inputs to explicit paths. Tilde expansion remains supported by CPView.
- Management: additive Data Center read tools and IP/CIDR correlation. Existing tools remain present. `ip-address` is declared directly, with the fork's root override retained. The correlation tool scans at most 2,000 query objects; its query results should not be treated as exhaustive in larger estates.
- Removed analytics npm scripts pointing at unavailable internal scripts.

Fork-specific packages, scripts, dependency overrides and security dependency constraints were preserved. Package versions were not advanced to upstream release numbers because this is a selective fork backport.

## Excluded

- Harmony Email: a new standalone server with tenant authentication, message download, quarantine/restore and verdict submission. Static inspection found fixed regional gateways, header-only tenant credentials and action previews by default, but its new operational contracts have not been validated against a tenant or dedicated fixtures. Package, root build/dev entries, tsconfig reference, README advertisement and lock entries are held together for separate qualification.
- Release workflow changes (#280/#283): the fork previously deleted that workflow. Reintroducing it would change publishing behavior and require fork-specific npm trusted-publisher configuration.
- Upstream package-version-only changes: no runtime effect; reserved for an actual fork release.

## Validation

- Common utilities TypeScript build: passed.
- Argos, CPInfo, CPView, Management and WAF bundle builds: passed.
- WAF plus six fork-extension suites: 84 tests passed.
- Added upstream regression suite: 8 tests passed (HTTP tool-policy replay, CLI flag mirroring, Argos session isolation, path confinement including symlink escapes/new output paths, fail-closed invalid roots, legacy unset-root behavior). `npm run test:upstream` is included in CI.
- Test drafts were delegated to the requested local `qwen3.6:27b`, validated, and corrected after review.
- CPInfo and CPView TypeScript checks: passed.
- Argos TypeScript checks, including a retry with `skipLibCheck`: exhausted Node's approximately 4 GiB heap; not successful type checks.
- WAF's previously documented TypeScript errors and dependency audit findings remain separate unresolved issues.
- No live Check Point services were contacted. No publish or push was performed.
