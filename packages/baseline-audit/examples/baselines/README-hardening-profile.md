# Community Gaia Gateway Hardening Profile 2026

This is an independently authored audit profile for the community extension. It is not an official Check Point baseline, certification, or product feature.

The profile was mapped on 2026-08-11 from the public [Check Point Gateway and Management Hardening Administration Guide](https://sc1.checkpoint.com/documents/Check_Point_Gateway_and_Management_Hardening/CP_Check_Point_Gateway_and_Management_Hardening.pdf), which identifies R81.20, R82, and R82.10 as applicable releases. Consult the current official guide before relying on the profile because recommendations and supported API fields can change.

## Automated observations

The `gaia.hardening` input uses a fixed allowlist of official Gaia API show commands:

- `show-version`
- `show-users`
- `show-roles`
- `show-password-policy`
- `show-allowed-clients`
- `show-snmp`
- `show-snmp-users`
- `show-syslog`
- `show-remote-syslogs`
- `show-configuration-bgp`

The profile automatically evaluates observable version identity, restricted user shells, password policy thresholds, Gaia MFA when the field is available, allowed clients, SNMP protection, and gateway syslog forwarding. It also performs a structural check for a drop-and-log Stealth Rule through `management.accessRulebase`.

The Stealth Rule check confirms presence only. It does not prove correct rule ordering, completeness of permitted management traffic, successful policy installation, or effective network reachability.

## Manual or external evidence

These controls remain manual until a trusted evidence collector supplies the corresponding target parameter:

| Parameter | Evidence expected |
| --- | --- |
| `recommendedReleaseAndJhfConfirmed` | Current Check Point lifecycle and recommended JHF lookup compared with the installed version |
| `impliedRulesReviewed` | Approved review of enabled implied rules and logging behavior |
| `dynamicRoutingReviewed` | Approved peers, authentication, route filters, and required-protocol review |
| `expertModeGovernanceConfirmed` | Approved role assignment and monitoring evidence |
| `lomIsolationConfirmed` | Network topology and reachability evidence for the out-of-band interface |

Do not set a confirmation parameter to `true` without retaining its supporting evidence and approval. Missing parameters produce `MANUAL`, not `PASS`.

## Write boundary

Remediation action IDs in the profile are metadata only. The Collector, Audit MCP, and Runner do not call `set-*`, publish policy, install policy, run scripts, or otherwise modify a target. Automated configuration requires a separate approval-gated write executor and real-device validation.
