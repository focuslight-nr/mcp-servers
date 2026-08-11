import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { z } from "zod";
import type { RunnerConfig } from "./types.js";

const processSchema = z
  .object({
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    forwardEnvironment: z.array(z.string().min(1)).optional(),
  })
  .optional()
  .default({});

const targetSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(
      /^[A-Za-z0-9._-]+$/,
      "id may contain only letters, numbers, dot, underscore, and hyphen",
    ),
  gatewayIp: z.string().min(1),
  gatewayPort: z.number().int().min(1).max(65535).optional().default(443),
  credentialProfile: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  managementDomain: z.string().optional(),
  policyPackage: z.string().optional(),
  accessLayer: z.string().min(1).optional(),
  expectedTimezone: z.string().min(1).optional(),
  parameters: z.record(z.unknown()).optional().default({}),
  enabled: z.boolean().optional().default(true),
});

const targetStatuses = [
  "COMPLIANT",
  "NON_COMPLIANT",
  "REGRESSION",
  "PARTIAL",
  "ERROR",
] as const;

const notificationSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    webhookUrlEnvironment: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be an environment variable name")
      .optional()
      .default("BASELINE_AUDIT_WEBHOOK_URL"),
    notifyOn: z
      .array(z.enum(targetStatuses))
      .min(1)
      .optional()
      .default(["NON_COMPLIANT", "REGRESSION", "PARTIAL", "ERROR"]),
    timeoutMs: z.number().int().min(1000).max(60000).optional().default(10000),
  })
  .optional()
  .default({});

const configSchema = z
  .object({
    concurrency: z.number().int().min(1).max(20).optional().default(2),
    retries: z.number().int().min(0).max(5).optional().default(2),
    retryDelayMs: z.number().int().min(0).max(60000).optional().default(1000),
    toolTimeoutMs: z
      .number()
      .int()
      .min(1000)
      .max(600000)
      .optional()
      .default(60000),
    staleLockMs: z
      .number()
      .int()
      .min(60000)
      .max(86400000)
      .optional()
      .default(3600000),
    stateDirectory: z.string().min(1).optional().default(".baseline-runner"),
    reportDirectory: z
      .string()
      .min(1)
      .optional()
      .default(".baseline-runner/reports"),
    baselinePath: z.string().min(1),
    notifications: notificationSchema,
    mcp: z
      .object({
        gaia: processSchema,
        management: processSchema,
        audit: processSchema,
      })
      .optional()
      .default({ gaia: {}, management: {}, audit: {} }),
    targets: z.array(targetSchema).min(1),
  })
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.targets.forEach((target, index) => {
      const normalized = target.id.toLowerCase();
      if (seen.has(normalized)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["targets", index, "id"],
          message: `duplicate target id: ${target.id}`,
        });
      }
      seen.add(normalized);
    });
  });

function resolvePath(
  baseDirectory: string,
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  return isAbsolute(value) ? value : resolve(baseDirectory, value);
}

export async function loadRunnerConfig(path: string): Promise<RunnerConfig> {
  const absolutePath = resolve(path);
  const raw = JSON.parse(await readFile(absolutePath, "utf8")) as unknown;
  const parsed = configSchema.parse(raw);
  const baseDirectory = dirname(absolutePath);

  return {
    ...parsed,
    stateDirectory: resolvePath(baseDirectory, parsed.stateDirectory) as string,
    reportDirectory: resolvePath(
      baseDirectory,
      parsed.reportDirectory,
    ) as string,
    baselinePath: resolvePath(baseDirectory, parsed.baselinePath) as string,
    mcp: {
      gaia: {
        ...parsed.mcp.gaia,
        cwd: resolvePath(baseDirectory, parsed.mcp.gaia.cwd),
      },
      management: {
        ...parsed.mcp.management,
        cwd: resolvePath(baseDirectory, parsed.mcp.management.cwd),
      },
      audit: {
        ...parsed.mcp.audit,
        cwd: resolvePath(baseDirectory, parsed.mcp.audit.cwd),
      },
    },
  };
}

export function formatConfigError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
      .join("\n");
  }
  return (error as Error).message;
}
