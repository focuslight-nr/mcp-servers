# Check Point Quantum Infra 

This package is a depedency of Check Point Quantum MCP servers

## HTTP credential configuration

HTTP settings created by `fromHeaders` do not inherit authentication or connection values from the server process environment. HTTP clients must supply their own credentials and connection headers, including any non-default management port or region. This also applies to the Documentation, Spark Management, WAF and Workforce AI settings factories derived from this package. Explicit session IDs remain supported. The built-in defaults are management port `443`, region `EU` and development port `8006` when the corresponding headers are absent.

Direct construction and CLI/stdio settings retain environment-variable configuration. WAF documentation-service configuration and the process write-permission ceiling remain deployment-wide settings.

Run the focused regression suite with `npm run test:http-settings --workspace=@chkp/quantum-infra` from the repository root. It uses dummy credentials and captures the login transport without making network requests.
