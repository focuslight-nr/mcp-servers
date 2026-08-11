#!/usr/bin/env node

import { resolve } from "node:path";
import { Command } from "commander";
import { formatConfigError, loadRunnerConfig } from "./config.js";
import { sendRunNotification } from "./notifier.js";
import { runAllTargets, runTarget, summaryExitCode } from "./workflow.js";
import type { RunSummary, TargetRunStatus } from "./types.js";

interface CommandOptions {
  config: string;
  fixtureDir?: string;
}

function oneTargetSummary(
  result: Awaited<ReturnType<typeof runTarget>>,
): RunSummary {
  const statuses: TargetRunStatus[] = [
    "COMPLIANT",
    "NON_COMPLIANT",
    "REGRESSION",
    "PARTIAL",
    "ERROR",
  ];
  return {
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    durationMs: result.durationMs,
    results: [result],
    counts: Object.fromEntries(
      statuses.map((status) => [status, result.status === status ? 1 : 0]),
    ) as Record<TargetRunStatus, number>,
  };
}

async function runOnce(options: CommandOptions): Promise<void> {
  const config = await loadRunnerConfig(options.config);
  const summary = await runAllTargets(
    config,
    options.fixtureDir ? resolve(options.fixtureDir) : undefined,
  );
  summary.notification = await sendRunNotification(
    config.notifications,
    summary,
  );
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exitCode = summaryExitCode(summary);
}

async function runOne(
  targetId: string,
  options: CommandOptions,
): Promise<void> {
  const config = await loadRunnerConfig(options.config);
  const target = config.targets.find(
    (item) => item.id.toLowerCase() === targetId.toLowerCase(),
  );
  if (!target) {
    throw new Error(`Unknown target: ${targetId}`);
  }
  if (!target.enabled) {
    throw new Error(`Target is disabled: ${target.id}`);
  }
  const result = await runTarget(
    config,
    target,
    options.fixtureDir ? resolve(options.fixtureDir) : undefined,
  );
  const summary = oneTargetSummary(result);
  summary.notification = await sendRunNotification(
    config.notifications,
    summary,
  );
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exitCode = summaryExitCode(summary);
}

async function validate(path: string): Promise<void> {
  const config = await loadRunnerConfig(path);
  process.stdout.write(
    `${JSON.stringify(
      {
        valid: true,
        enabledTargets: config.targets
          .filter((target) => target.enabled)
          .map((target) => target.id),
        disabledTargets: config.targets
          .filter((target) => !target.enabled)
          .map((target) => target.id),
        concurrency: config.concurrency,
        stateDirectory: config.stateDirectory,
        reportDirectory: config.reportDirectory,
        baselinePath: config.baselinePath,
      },
      null,
      2,
    )}\n`,
  );
}

const program = new Command()
  .name("baseline-audit-runner")
  .description(
    "Orchestrate scheduled read-only Check Point baseline audits through MCP",
  )
  .version("0.1.0");

program
  .command("run-once")
  .description("Audit every enabled target once")
  .requiredOption("-c, --config <path>", "Runner JSON configuration file")
  .option(
    "--fixture-dir <path>",
    "Read target fixture JSON instead of calling Gaia and Management MCPs",
  )
  .action(async (options: CommandOptions) => runOnce(options));

program
  .command("run-target")
  .description("Audit one enabled target")
  .argument("<target-id>")
  .requiredOption("-c, --config <path>", "Runner JSON configuration file")
  .option(
    "--fixture-dir <path>",
    "Read target fixture JSON instead of calling Gaia and Management MCPs",
  )
  .action(async (targetId: string, options: CommandOptions) =>
    runOne(targetId, options),
  );

program
  .command("validate-config")
  .description("Validate configuration without starting any MCP server")
  .requiredOption("-c, --config <path>", "Runner JSON configuration file")
  .action(async (options: CommandOptions) => validate(options.config));

program.parseAsync().catch((error) => {
  process.stderr.write(`${formatConfigError(error)}\n`);
  process.exitCode = 1;
});

export { loadRunnerConfig, runAllTargets, runTarget, summaryExitCode };
export type {
  AuditTarget,
  RunnerConfig,
  RunSummary,
  TargetRunResult,
} from "./types.js";
