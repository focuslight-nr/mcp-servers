# Security Policy

## Supported code

Security reports for the community-developed baseline audit extension are accepted for the latest `main` branch. Upstream Check Point MCP packages should be reported through the upstream repository's security process.

## Reporting a vulnerability

Use GitHub private vulnerability reporting for this repository. Do not open a public issue containing exploit details, credentials, target addresses, device configuration, or audit evidence.

Include the affected package and version, prerequisites, impact, reproduction steps or data flow, and a suggested remediation when available. Reports are acknowledged and triaged on a best-effort community basis; no response or remediation SLA is offered.

## Operational boundary

The extension is experimental and has not been validated against a physical Check Point appliance. Operators must use dedicated least-privilege accounts, strict target allowlists, trusted CA certificates, restricted filesystem ACLs, and non-production validation before deployment.
