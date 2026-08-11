# Check Point Baseline Audit MCP

A deterministic, read-only audit engine for Check Point observations and organization-authored security baselines.

The engine accepts Baseline Format v1 JSON and normalized observation JSON. It does not execute JavaScript, shell commands, templates, or remediation actions from a baseline. No third-party benchmark publication is bundled; baseline authors are responsible for the content they load.

## Responsibilities

- Validate Baseline Format v1 documents before evaluation.
- Evaluate declarative assertions deterministically without an LLM.
- Produce JSON and Markdown reports.
- Store optional local history, changes, and time-limited approved exceptions.
- Normalize the currently supported Gaia and Management MCP responses.
- Expose remediation identifiers and severity as metadata for the separate Change Planner MCP.

This package never connects to or modifies a Check Point system.

## Baseline Format v1

The canonical JSON Schema is [baseline-format-v1.schema.json](./schemas/baseline-format-v1.schema.json). Examples include an [organization baseline](./examples/baselines/organization-gaia.json) and an independently authored [Check Point Gaia Gateway Hardening 2026 profile](./examples/baselines/checkpoint-gaia-gateway-hardening-2026.json).

```json
{
  "$schema": "../../schemas/baseline-format-v1.schema.json",
  "formatVersion": "1.0",
  "baseline": {
    "id": "organization-gaia",
    "version": "2026.1",
    "title": "Organization Gaia Baseline"
  },
  "inputs": ["gaia.dns"],
  "controls": [
    {
      "id": "ORG-GAIA-001",
      "title": "At least two DNS servers are configured",
      "severity": "medium",
      "expected": "At least two DNS servers",
      "assertion": {
        "path": "gaia.dnsServers",
        "operator": "minItems",
        "value": 2
      },
      "remediation": {
        "action": "gaia.setDnsServers"
      }
    }
  ]
}
```

Baseline and control objects reject unknown fields. Control IDs must be unique. Paths are restricted to dot-separated property names and cannot invoke code.

`inputs` declares the observations required by the baseline. The Runner currently recognizes `gaia.dns`, `gaia.dhcp`, `gaia.dateTime`, `gaia.hardening`, and `management.accessRulebase`, and starts only the required collectors. A baseline passed directly to `audit_baseline` may use any observation paths because collection happens outside the engine.

### Assertions

Value assertions support:

- `exists` and `notExists`
- `equals` and `notEquals`
- `contains`
- `greaterThanOrEqual` and `lessThanOrEqual` for numeric thresholds
- `minItems` and `maxItems`
- `truthy`
- `valuePath` for organization or target parameters
- optional case-insensitive string comparison

Assertions can be composed with `all`, `any`, and `not`. Array observations support `allMatch`, `anyMatch`, and `noneMatch`, with an optional `evidencePath` used to identify violating items.

Controls may use:

- `errorWhen` to treat an unusable observation state as `ERROR`.
- `manualWhen` to require human review when a parameter is unavailable.
- `onMissing` to choose `ERROR`, `MANUAL`, or `FAIL` for missing assertion data.
- `remediation` to declare a stable action ID and inert parameters. The audit engine never executes it.

## Normalized Observations

`audit_baseline` accepts any JSON object. The supplied example and Check Point raw-response adapter use this shape:

```json
{
  "gaia": {
    "dnsServers": ["192.0.2.53", "198.51.100.53"],
    "dhcpEnabled": false,
    "ntpEnabled": true,
    "ntpServers": ["192.0.2.123", "198.51.100.123"],
    "timezone": "Asia/Tokyo"
  },
  "parameters": {
    "approvedTimezone": "Asia/Tokyo"
  },
  "firewall": {
    "activeRules": [
      {
        "label": "1 (Web application)",
        "source": ["Web clients"],
        "destination": ["Web servers"],
        "service": ["https"],
        "action": "Accept",
        "track": "Log"
      }
    ]
  }
}
```

## MCP Tools

- `validate_baseline`
- `audit_baseline`
- `audit_baseline_raw_responses`
- `list_baseline_controls`
- `get_audit_history`
- `upsert_audit_exception`
- `list_audit_exceptions`
- `delete_audit_exception`

`audit_baseline_raw_responses` currently normalizes Gaia `show_dns`, `show_dhcp`, `show_date_time`, and the fixed `show_hardening_state` response plus Management `show_access_rulebase` responses. Use `audit_baseline` for other normalized observation documents.

## Check Point Hardening Profile

The included 2026 profile is an independent, concise mapping of selected recommendations from the public [Check Point Gateway and Management Hardening Administration Guide](https://sc1.checkpoint.com/documents/Check_Point_Gateway_and_Management_Hardening/CP_Check_Point_Gateway_and_Management_Hardening.pdf). It is not an official Check Point baseline, certification, or replacement for the source guide. See the [profile mapping and limitations](./examples/baselines/README-hardening-profile.md).

Password policy, restricted shells, MFA, allowed clients, SNMP, gateway syslog, and a structural Stealth Rule check can be evaluated automatically when observations are available. Recommended JHF status, implied rules, dynamic-routing design, Expert-mode governance, and LOM isolation remain `MANUAL` unless a trusted external process supplies the corresponding target parameters. The profile intentionally reports missing or unsupported API data as `MANUAL`; it never assumes compliance.

## Local Storage

Set these environment variables on the audit MCP process:

```text
BASELINE_AUDIT_STORE_PATH=D:\secure-data\checkpoint-audit-history.json
BASELINE_AUDIT_HISTORY_LIMIT=1000
```

The store may contain configuration evidence and approval metadata. Restrict filesystem access to the audit service account and apply the organization's backup and retention policy.

## Security Boundaries

- The evaluator receives observations; it has no target credentials.
- The schema is strict and does not permit executable expressions.
- Baseline paths cannot access files, environment variables, or network resources.
- Remediation declarations are metadata only.
- Exceptions produce `EXEMPTED`, never `PASS`, and require an approver and expiration. Use `baseline_id` to scope an exception when multiple baselines reuse a control ID.
- Collection, scheduling, notifications, change planning, and future write execution remain separate components.

## Development

```bash
npm run test --workspace=@focuslight-nr/checkpoint-baseline-audit-mcp
npm run build --workspace=@focuslight-nr/checkpoint-baseline-audit-mcp
```
