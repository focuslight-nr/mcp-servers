# Gaia Read-only Collector MCP

Non-interactive, fail-closed Check Point Gaia collector for scheduled security baseline audits.

This package is intentionally separate from the interactive Gaia MCP. It exposes only three fixed read operations and has no generic API, CLI, or configuration-write tool.

## Tools

- `show_dns`
- `show_dhcp`
- `show_date_time`

Every call requires `gateway_ip`. Optional arguments are `port`, `credential_profile`, `member_id`, and, where supported, `virtual_system_id`.

## Required environment

All gateway targets must be explicitly allowlisted:

```text
GAIA_ALLOWED_TARGETS=192.0.2.10,192.0.2.11
```

Default credentials use:

```text
GAIA_USERNAME=baseline-auditor
GAIA_PASSWORD=<secret>
```

A target with `credential_profile=tokyo-prod` uses:

```text
GAIA_CREDENTIAL_TOKYO_PROD_USERNAME=baseline-auditor
GAIA_CREDENTIAL_TOKYO_PROD_PASSWORD=<secret>
```

Profile names may contain only letters, numbers, underscore, and hyphen. Credential values are never accepted as MCP tool arguments and are never included in successful responses.

## TLS

TLS certificate validation is always enabled. There is intentionally no `insecure` option.

For an internal or self-signed Gaia certificate, provide the issuing CA certificate:

```text
GAIA_CA_FILE=D:\secure-config\gaia-ca.pem
```

Profiles can override the CA file with `GAIA_CREDENTIAL_<PROFILE>_CA_FILE`. The certificate must match the gateway hostname or address used by the Runner.

## Secret management

Environment variables are the Collector boundary, not the recommended long-term secret database. A scheduled wrapper should retrieve credentials from an approved secret store, set them only for the Runner process, and clear them when the process exits.

The Runner forwards only the explicitly named variables in `mcp.gaia.forwardEnvironment`. Never place passwords in the Runner JSON, Task Scheduler arguments, report files, or MCP arguments.

For per-target profiles, configure the target with only the reference:

```json
{
  "id": "gateway-tokyo-01",
  "credentialProfile": "tokyo-prod"
}
```

## Operational controls

- Use a dedicated Gaia account with the minimum read-only permissions required by the three show APIs.
- Restrict management access on each gateway to the Runner host.
- Run the Runner and Collector under a dedicated operating-system service account.
- Protect CA files, Runner state, Audit history, and reports with restrictive filesystem ACLs.
- Treat authentication, TLS, timeout, and unavailable API responses as collection errors, not baseline failures.
- Keep `GAIA_ALLOWED_TARGETS` exact; CIDR and wildcard matching are not supported.

## Development

```shell
npm run test --workspace=@focuslight-nr/checkpoint-gaia-readonly-collector-mcp
npm run build --workspace=@focuslight-nr/checkpoint-gaia-readonly-collector-mcp
```

Tests use fake API clients and a real stdio MCP exchange. No Gaia device is required. Final certificate trust, API response fields, and read-only account permissions require a lab or production-approved gateway test.
