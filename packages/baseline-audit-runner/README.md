# Check Point Baseline Audit Runner

Deterministic command-line orchestrator for scheduled, read-only Check Point baseline audits.

The Runner starts the Gaia, Management, and Baseline Audit MCP servers over stdio, collects raw observations, asks the Audit MCP to evaluate and persist them, writes JSON and Markdown reports, and returns scheduler-friendly exit codes. It does not modify Check Point state and does not use an LLM to decide compliance.

Set the required `baselinePath` to an organization-authored Baseline Format v1 JSON document. No benchmark content is bundled with the Runner.

## Commands

```shell
baseline-audit-runner validate-config --config ./runner.config.json
baseline-audit-runner run-once --config ./runner.config.json
baseline-audit-runner run-target gateway-tokyo-01 --config ./runner.config.json
```

For development without a device:

```shell
baseline-audit-runner run-once \
  --config ./examples/runner.config.json \
  --fixture-dir ./examples/fixtures
```

Fixture mode skips Gaia and Management MCP and still calls the real Baseline Audit MCP, including local history and diff generation.

## Workflow

For each enabled target, the Runner:

1. Acquires an exclusive file lock.
2. Reads the baseline and its required `inputs` list.
3. Starts only the required Gaia and Management MCP processes, or reads fixtures.
4. Collects only observations declared by the baseline.
5. Starts the Baseline Audit MCP and calls `audit_baseline_raw_responses` with `persist=true`.
6. Writes timestamped JSON and Markdown reports.
7. Releases the lock even when collection fails.

Each failed target attempt starts fresh MCP processes. Retry delay increases linearly by attempt. Concurrent targets are capped by `concurrency`.

## Result statuses

| Status          | Meaning                                                             |
| --------------- | ------------------------------------------------------------------- |
| `COMPLIANT`     | No FAIL, ERROR, MANUAL, adapter warning, or regression              |
| `NON_COMPLIANT` | One or more baseline controls are FAIL                              |
| `REGRESSION`    | The persisted audit identifies deterioration since the previous run |
| `PARTIAL`       | Manual checks or adapter warnings remain                            |
| `ERROR`         | Collection, parsing, persistence, timeout, or locking failed        |

Exit codes are designed for Task Scheduler or another supervisor:

| Exit code | Meaning                                                                      |
| --------: | ---------------------------------------------------------------------------- |
|         0 | Run completed; existing noncompliance alone does not fail the scheduler task |
|         1 | At least one target returned ERROR or PARTIAL                                |
|         2 | At least one target returned REGRESSION                                      |

A failed webhook delivery also returns exit code 1 so the scheduler can report that the audit ran but its alert was not delivered.

## Configuration

See [examples/runner.config.json](examples/runner.config.json). Paths are resolved relative to the configuration file. Target IDs are also used as file and lock names, so they are restricted to letters, numbers, dot, underscore, and hyphen.

The baseline path and optional target parameters are resolved from the configuration:

```json
{
  "baselinePath": "../../baseline-audit/examples/baselines/organization-gaia.json",
  "targets": [
    {
      "id": "gateway-tokyo-01",
      "parameters": {
        "approvedTimezone": "Asia/Tokyo"
      }
    }
  ]
}
```

The Runner reads the baseline as JSON and sends it inline to the audit MCP. The audit MCP validates it before every evaluation. Do not put credentials or executable content in a baseline file.

The Runner starts only collectors declared by the required baseline `inputs` array. Supported IDs are `gaia.dns`, `gaia.dhcp`, `gaia.dateTime`, and `management.accessRulebase`. `accessLayer` is required only when the Management input is selected.

MCP commands default to the locally built sibling packages:

- `packages/gaia-readonly-collector/dist/index.js`
- `packages/management/dist/index.js`
- `packages/baseline-audit/dist/index.js`

Each process can be replaced:

```json
{
  "mcp": {
    "gaia": {
      "command": "node",
      "args": ["D:/secure-tools/unattended-gaia-collector.js"],
      "forwardEnvironment": ["GAIA_SERVICE_USERNAME", "GAIA_SERVICE_PASSWORD"]
    }
  }
}
```

Only environment variables named in `forwardEnvironment` are forwarded in addition to the MCP SDK safe defaults. Do not store API keys or passwords in the JSON configuration.

## Webhook notifications

Notifications are disabled by default. Enable them in the Runner configuration without storing the secret URL there:

```json
{
  "notifications": {
    "enabled": true,
    "webhookUrlEnvironment": "BASELINE_AUDIT_WEBHOOK_URL",
    "notifyOn": ["NON_COMPLIANT", "REGRESSION", "PARTIAL", "ERROR"],
    "timeoutMs": 10000
  }
}
```

The webhook URL must use HTTPS. The POST body contains only run timestamps, aggregate counts, target IDs, statuses, failed-control counts, and regression counts. It does not contain raw observations, audit evidence, credentials, or report contents. The payload includes a `text` field for simple webhook receivers plus structured fields for automation.

## Gaia credentials

The Runner defaults to the non-interactive `gaia-readonly-collector` package. It deliberately does not answer interactive credential prompts or store Gaia passwords.

Each target can select a credential profile:

```json
{
  "id": "gateway-tokyo-01",
  "credentialProfile": "tokyo"
}
```

The profile resolves to environment variable names such as `GAIA_CREDENTIAL_TOKYO_USERNAME` and `GAIA_CREDENTIAL_TOKYO_PASSWORD`. `GAIA_ALLOWED_TARGETS` and the required credential variables must be listed under `mcp.gaia.forwardEnvironment`. See the Collector README for TLS and secret-management requirements.

## Windows Task Scheduler

Templates are provided in [examples/windows](examples/windows):

- `deployment.config.json` contains only non-secret paths and runtime settings.
- `run-scheduled-audit.ps1` decrypts credentials, sets process-only environment variables, runs the audit, writes a timestamped log, and clears the sensitive variables.
- `register-scheduled-task.ps1` registers a daily task with overlap prevention and a two-hour execution limit.

First build and validate the required packages:

```powershell
npm run nx:build:management
npm run nx:build:baseline-audit
npm run nx:build:gaia-readonly-collector
npm run nx:build:baseline-audit-runner
node packages\baseline-audit-runner\dist\index.js validate-config --config D:\secure-config\checkpoint-baseline-runner.json
```

While logged on as the task service account on the task host, create DPAPI-protected files. They can only be decrypted by that account on that machine:

```powershell
Get-Credential -UserName 'baseline-auditor' |
  Export-Clixml D:\secure-config\gaia-tokyo.credential.xml

Read-Host 'Management API key' -AsSecureString |
  Export-Clixml D:\secure-config\management-api-key.secure.xml

Read-Host 'HTTPS webhook URL' -AsSecureString |
  Export-Clixml D:\secure-config\baseline-webhook-url.secure.xml
```

Update the deployment template, test the wrapper interactively as that account, and then register it from an elevated PowerShell session:

```powershell
.\examples\windows\run-scheduled-audit.ps1 `
  -DeploymentConfigPath D:\secure-config\checkpoint-baseline-deployment.json

.\examples\windows\register-scheduled-task.ps1 `
  -WrapperPath D:\GitHub\mcp-servers\packages\baseline-audit-runner\examples\windows\run-scheduled-audit.ps1 `
  -DeploymentConfigPath D:\secure-config\checkpoint-baseline-deployment.json `
  -ServiceAccount 'DOMAIN\checkpoint-baseline$' `
  -DailyAt '02:00'
```

The registration template targets a Windows service account or gMSA. For a normal domain user, create the task in Task Scheduler and enter its password through the protected Windows prompt instead of putting it in a command. Grant the account read access to configs, CA files, and DPAPI files; execute access to Node and the MCP packages; and write access only to configured state, report, history, and log directories.

## Development

```shell
npm run build --workspace=@focuslight-nr/checkpoint-baseline-audit-mcp
npm run test --workspace=@focuslight-nr/checkpoint-baseline-audit-runner
npm run build --workspace=@focuslight-nr/checkpoint-baseline-audit-runner
```

Tests cover configuration validation, stale and overlapping locks, retries, report output, result classification, webhook policy and payload minimization, and exit-code behavior. No device is required.
