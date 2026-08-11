import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireTargetLock } from "./lock.js";
import { loadTargetFixtures } from "./fixtures.js";
import {
  assertToolSucceeded,
  ProcessMcpClient,
  textBlocks,
} from "./mcp-client.js";
import { writeAuditReport } from "./report-writer.js";
import type {
  AuditPayload,
  AuditTarget,
  McpProcessConfig,
  RunnerConfig,
  RunSummary,
  TargetRunResult,
  TargetRunStatus,
} from "./types.js";

export interface RunnerMcpClient {
  connect(): Promise<void>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown>;
  close(): Promise<void>;
}

export interface RunnerDependencies {
  createMcpClient?: (
    role: "gaia" | "management" | "audit",
    config: McpProcessConfig,
  ) => RunnerMcpClient;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
}

function defaultScript(relativePackage: string): string {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    `../../${relativePackage}/dist/index.js`,
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function resolvedMcpProcess(
  role: "gaia" | "management" | "audit",
  configured: McpProcessConfig,
): Required<Pick<McpProcessConfig, "command" | "args">> & McpProcessConfig {
  const packageByRole = {
    gaia: "gaia-readonly-collector",
    management: "management",
    audit: "baseline-audit",
  } as const;
  const defaultForward = {
    gaia: [],
    management: [],
    audit: [],
  } as const;
  const usesDefaultCommand = !configured.command;
  return {
    ...configured,
    command: configured.command ?? process.execPath,
    args:
      configured.args ??
      (usesDefaultCommand ? [defaultScript(packageByRole[role])] : []),
    forwardEnvironment: unique([
      ...defaultForward[role],
      ...(configured.forwardEnvironment ?? []),
    ]),
  };
}

function defaultClientFactory(
  role: "gaia" | "management" | "audit",
  config: McpProcessConfig,
): RunnerMcpClient {
  return new ProcessMcpClient(role, resolvedMcpProcess(role, config));
}

function parseAuditResponse(
  response: unknown,
  toolName: string,
): {
  payload: AuditPayload;
  json: string;
  markdown: string;
} {
  assertToolSucceeded(response, toolName);
  const blocks = textBlocks(response);
  if (blocks.length === 0) {
    throw new Error("Audit MCP returned no text content");
  }
  let payload: AuditPayload;
  try {
    payload = JSON.parse(blocks[0]) as AuditPayload;
  } catch (error) {
    throw new Error(
      `Audit MCP returned invalid JSON: ${(error as Error).message}`,
    );
  }
  if (!payload.summary || typeof payload.summary.total !== "number") {
    throw new Error("Audit MCP JSON did not contain a valid summary");
  }
  return {
    payload,
    json: blocks[0],
    markdown:
      blocks[1] ??
      `# Baseline Audit: ${payload.target}\n\nJSON-only audit response.`,
  };
}

function targetStatus(payload: AuditPayload): TargetRunStatus {
  if (payload.summary.error > 0) return "ERROR";
  if ((payload.diff?.regressions ?? 0) > 0) return "REGRESSION";
  if (payload.summary.fail > 0) return "NON_COMPLIANT";
  if ((payload.adapterWarnings?.length ?? 0) > 0 || payload.summary.manual > 0)
    return "PARTIAL";
  return "COMPLIANT";
}

async function closeAll(clients: RunnerMcpClient[]): Promise<void> {
  await Promise.allSettled(clients.map((client) => client.close()));
}

const supportedInputs = [
  "gaia.dns",
  "gaia.dhcp",
  "gaia.dateTime",
  "management.accessRulebase",
] as const;

function collectorInputs(baseline: unknown): Set<string> {
  if (!baseline || typeof baseline !== "object" || !("inputs" in baseline)) {
    throw new Error("Runner baselines must declare an inputs array");
  }
  const inputs = (baseline as { inputs?: unknown }).inputs;
  if (
    !Array.isArray(inputs) ||
    inputs.some((item) => typeof item !== "string")
  ) {
    throw new Error("Baseline inputs must be an array of input IDs");
  }
  const unsupported = inputs.filter(
    (item) =>
      !supportedInputs.includes(item as (typeof supportedInputs)[number]),
  );
  if (unsupported.length > 0) {
    throw new Error(`Unsupported baseline input(s): ${unsupported.join(", ")}`);
  }
  return new Set(inputs);
}

async function loadConfiguredBaseline(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `Unable to load baseline ${path}: ${(error as Error).message}`,
    );
  }
}

async function collectLive(
  config: RunnerConfig,
  target: AuditTarget,
  inputs: ReadonlySet<string>,
  createClient: NonNullable<RunnerDependencies["createMcpClient"]>,
): Promise<{
  dns?: unknown;
  dhcp?: unknown;
  dateTime?: unknown;
  rulebase?: unknown;
}> {
  const needsGaia = [...inputs].some((input) => input.startsWith("gaia."));
  const needsManagement = inputs.has("management.accessRulebase");
  const gaia = needsGaia ? createClient("gaia", config.mcp.gaia) : undefined;
  const management = needsManagement
    ? createClient("management", config.mcp.management)
    : undefined;
  const clients = [gaia, management].filter(
    (client): client is RunnerMcpClient => client !== undefined,
  );
  try {
    if (gaia) await gaia.connect();
    if (management) {
      await management.connect();
      const managementInit = await management.callTool(
        "management__init",
        {},
        config.toolTimeoutMs,
      );
      assertToolSucceeded(managementInit, "management__init");
    }

    const gatewayArgs = {
      gateway_ip: target.gatewayIp,
      port: target.gatewayPort ?? 443,
      credential_profile: target.credentialProfile,
    };
    const collected: {
      dns?: unknown;
      dhcp?: unknown;
      dateTime?: unknown;
      rulebase?: unknown;
    } = {};
    if (inputs.has("gaia.dns") && gaia) {
      collected.dns = await gaia.callTool(
        "show_dns",
        gatewayArgs,
        config.toolTimeoutMs,
      );
      assertToolSucceeded(collected.dns, "show_dns");
    }
    if (inputs.has("gaia.dhcp") && gaia) {
      collected.dhcp = await gaia.callTool(
        "show_dhcp",
        gatewayArgs,
        config.toolTimeoutMs,
      );
      assertToolSucceeded(collected.dhcp, "show_dhcp");
    }
    if (inputs.has("gaia.dateTime") && gaia) {
      collected.dateTime = await gaia.callTool(
        "show_date_time",
        gatewayArgs,
        config.toolTimeoutMs,
      );
      assertToolSucceeded(collected.dateTime, "show_date_time");
    }
    if (inputs.has("management.accessRulebase") && management) {
      if (!target.accessLayer) {
        throw new Error(
          "Target accessLayer is required by management.accessRulebase",
        );
      }
      collected.rulebase = await management.callTool(
        "show_access_rulebase",
        {
          name: target.accessLayer,
          package: target.policyPackage,
          domain: target.managementDomain,
          limit: 0,
          details_level: "full",
          show_raw: true,
        },
        config.toolTimeoutMs,
      );
      assertToolSucceeded(collected.rulebase, "show_access_rulebase");
    }
    return collected;
  } finally {
    await closeAll(clients);
  }
}

async function executeAttempt(
  config: RunnerConfig,
  target: AuditTarget,
  fixtureDirectory: string | undefined,
  dependencies: RunnerDependencies,
): Promise<{ payload: AuditPayload; jsonPath: string; markdownPath: string }> {
  const createClient = dependencies.createMcpClient ?? defaultClientFactory;
  const baseline = await loadConfiguredBaseline(config.baselinePath);
  const inputs = collectorInputs(baseline);
  const collected = fixtureDirectory
    ? await loadTargetFixtures(fixtureDirectory, target.id, inputs)
    : await collectLive(config, target, inputs, createClient);
  const audit = createClient("audit", config.mcp.audit);
  try {
    await audit.connect();
    const toolName = "audit_baseline_raw_responses";
    const response = await audit.callTool(
      toolName,
      {
        baseline,
        target: target.id,
        gaia_responses: {
          dns: collected.dns,
          dhcp: collected.dhcp,
          date_time: collected.dateTime,
        },
        management_responses:
          collected.rulebase === undefined
            ? undefined
            : { access_rulebase_pages: [collected.rulebase] },
        expected_timezone: target.expectedTimezone,
        parameters: target.parameters ?? {},
        persist: true,
        use_saved_exceptions: true,
        format: "both",
      },
      config.toolTimeoutMs,
    );
    const parsed = parseAuditResponse(response, toolName);
    const paths = await writeAuditReport(
      config.reportDirectory,
      target.id,
      parsed.json,
      parsed.markdown,
      dependencies.now?.() ?? new Date(),
    );
    return {
      payload: parsed.payload,
      jsonPath: paths.jsonPath,
      markdownPath: paths.markdownPath,
    };
  } finally {
    await closeAll([audit]);
  }
}

export async function runTarget(
  config: RunnerConfig,
  target: AuditTarget,
  fixtureDirectory?: string,
  dependencies: RunnerDependencies = {},
): Promise<TargetRunResult> {
  const now = dependencies.now ?? (() => new Date());
  const sleep =
    dependencies.sleep ??
    ((milliseconds: number) =>
      new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)));
  const started = now();
  let attempts = 0;
  let lock;

  try {
    lock = await acquireTargetLock(
      config.stateDirectory,
      target.id,
      config.staleLockMs,
    );
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= config.retries + 1; attempt += 1) {
      attempts = attempt;
      try {
        const completed = await executeAttempt(
          config,
          target,
          fixtureDirectory,
          dependencies,
        );
        const finished = now();
        return {
          target: target.id,
          status: targetStatus(completed.payload),
          startedAt: started.toISOString(),
          finishedAt: finished.toISOString(),
          durationMs: finished.getTime() - started.getTime(),
          attempts,
          reportJsonPath: completed.jsonPath,
          reportMarkdownPath: completed.markdownPath,
          audit: completed.payload,
        };
      } catch (error) {
        lastError = error as Error;
        if (attempt <= config.retries) {
          await sleep(config.retryDelayMs * attempt);
        }
      }
    }
    throw lastError ?? new Error("Target audit failed");
  } catch (error) {
    const finished = now();
    return {
      target: target.id,
      status: "ERROR",
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: finished.getTime() - started.getTime(),
      attempts,
      error: (error as Error).message,
    };
  } finally {
    await lock?.release();
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  operation: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await operation(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export async function runAllTargets(
  config: RunnerConfig,
  fixtureDirectory?: string,
  dependencies: RunnerDependencies = {},
): Promise<RunSummary> {
  const now = dependencies.now ?? (() => new Date());
  const started = now();
  const targets = config.targets.filter((target) => target.enabled);
  const results = await mapWithConcurrency(
    targets,
    config.concurrency,
    (target) => runTarget(config, target, fixtureDirectory, dependencies),
  );
  const finished = now();
  const statuses: TargetRunStatus[] = [
    "COMPLIANT",
    "NON_COMPLIANT",
    "REGRESSION",
    "PARTIAL",
    "ERROR",
  ];
  return {
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: finished.getTime() - started.getTime(),
    results,
    counts: Object.fromEntries(
      statuses.map((status) => [
        status,
        results.filter((item) => item.status === status).length,
      ]),
    ) as Record<TargetRunStatus, number>,
  };
}

export function summaryExitCode(summary: RunSummary): number {
  if (summary.notification?.attempted && !summary.notification.delivered)
    return 1;
  if (summary.counts.ERROR > 0 || summary.counts.PARTIAL > 0) return 1;
  if (summary.counts.REGRESSION > 0) return 2;
  return 0;
}
