#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { adaptAccessRulebasePages, adaptGaiaResponses } from "./adapters.js";
import { parseBaseline } from "./baseline.js";
import { evaluateBaseline } from "./engine.js";
import { buildObservationDocument } from "./observations.js";
import { renderMarkdown } from "./report.js";
import { AuditStore } from "./store.js";
import type {
  AuditException,
  AuditReport,
  ObservationDocument,
  StoredAudit,
} from "./types.js";

type AuditFormat = "json" | "markdown" | "both";

interface AuditToolArgs {
  baseline?: unknown;
  observations?: ObservationDocument;
  target?: string;
  format?: AuditFormat;
  persist?: boolean;
  use_saved_exceptions?: boolean;
  evaluated_at?: string;
}

interface RawAuditToolArgs extends AuditToolArgs {
  gaia_responses?: {
    dns?: unknown;
    dhcp?: unknown;
    date_time?: unknown;
  };
  management_responses?: {
    access_rulebase_pages?: unknown[];
  };
  expected_timezone?: string;
  parameters?: Record<string, unknown>;
}

interface ExceptionToolArgs {
  id?: string;
  baseline_id?: string;
  control_id?: string;
  target?: string;
  evidence?: string;
  reason?: string;
  approved_by?: string;
  expires_at?: string;
  include_expired?: boolean;
}

interface HistoryToolArgs {
  target?: string;
  limit?: number;
}

interface ToolResponse {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

const server = new McpServer({
  name: "@focuslight-nr/checkpoint-baseline-audit-mcp",
  version: "0.1.0",
});
const store = new AuditStore();

// TypeScript 5.0 cannot fully instantiate the SDK + Zod tool overloads.
const registerTool = (
  server as unknown as {
    tool: (
      name: string,
      description: string,
      schema: Record<string, unknown>,
      handler: (args: any) => Promise<ToolResponse>,
    ) => void;
  }
).tool.bind(server);

const outputSchema = {
  format: z.enum(["json", "markdown", "both"]).optional().default("both"),
  persist: z.boolean().optional().default(false),
  use_saved_exceptions: z.boolean().optional().default(true),
  evaluated_at: z.string().datetime().optional(),
};

const exceptionSchema = {
  id: z.string().min(1),
  baseline_id: z.string().min(1).optional(),
  control_id: z.string().min(1),
  target: z
    .string()
    .min(1)
    .describe("Exact audit target or * for every target"),
  evidence: z.string().optional().describe("Optional exact evidence label"),
  reason: z.string().min(1),
  approved_by: z.string().min(1),
  expires_at: z.string().datetime(),
};

function asException(args: ExceptionToolArgs): AuditException {
  return {
    id: args.id ?? "",
    baselineId: args.baseline_id,
    controlId: args.control_id ?? "",
    target: args.target ?? "",
    evidence: args.evidence,
    reason: args.reason ?? "",
    approvedBy: args.approved_by ?? "",
    expiresAt: args.expires_at ?? "",
  };
}

async function savedExceptions(
  target: string | undefined,
  enabled: boolean | undefined,
): Promise<AuditException[]> {
  return enabled === false ? [] : store.listExceptions(target);
}

function renderDiff(record: StoredAudit | undefined): string {
  if (!record?.diff?.previousAuditId) return "";
  const lines = [
    "",
    "## Changes Since Previous Audit",
    "",
    `Regressions: ${record.diff.regressions}; Improvements: ${record.diff.improvements}; Other changes: ${record.diff.changed - record.diff.regressions - record.diff.improvements}`,
    "",
  ];
  for (const change of record.diff.changes) {
    lines.push(
      `- ${change.kind} ${change.controlId}: ${change.previousStatus} -> ${change.currentStatus}`,
    );
  }
  return lines.join("\n");
}

function auditResponse(
  report: AuditReport,
  format: AuditFormat | undefined,
  adapterWarnings: string[] = [],
  record?: StoredAudit,
): ToolResponse {
  const selectedFormat = format ?? "both";
  const content: ToolResponse["content"] = [];
  const payload = {
    ...report,
    adapterWarnings,
    storage: record
      ? { id: record.id, recordedAt: record.recordedAt }
      : undefined,
    diff: record?.diff,
  };
  if (selectedFormat === "json" || selectedFormat === "both") {
    content.push({ type: "text", text: JSON.stringify(payload, null, 2) });
  }
  if (selectedFormat === "markdown" || selectedFormat === "both") {
    const warningSection =
      adapterWarnings.length > 0
        ? `\n\n## Adapter Warnings\n\n${adapterWarnings.map((warning) => `- ${warning}`).join("\n")}`
        : "";
    content.push({
      type: "text",
      text: `${renderMarkdown(report)}${warningSection}${renderDiff(record)}`,
    });
  }
  return { content };
}

function toolError(error: unknown): ToolResponse {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: (error as Error).message }, null, 2),
      },
    ],
  };
}

registerTool(
  "validate_baseline",
  "Validate an inline Baseline Format v1 document without evaluating observations or changing a target system.",
  { baseline: z.record(z.unknown()) },
  async (args: AuditToolArgs) => {
    try {
      const baseline = parseBaseline(args.baseline);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                valid: true,
                formatVersion: baseline.formatVersion,
                baseline: baseline.baseline,
                inputs: baseline.inputs ?? [],
                controls: baseline.controls.map(({ id, title }) => ({
                  id,
                  title,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return toolError(error);
    }
  },
);

registerTool(
  "audit_baseline",
  "Evaluate Baseline Format v1 against normalized observations. The engine never executes code or remediation actions.",
  {
    baseline: z.record(z.unknown()),
    observations: z.record(z.unknown()),
    target: z.string().optional(),
    ...outputSchema,
  },
  async (args: AuditToolArgs) => {
    try {
      const report = evaluateBaseline({
        baseline: args.baseline,
        observations: args.observations ?? {},
        target: args.target,
        exceptions: await savedExceptions(
          args.target,
          args.use_saved_exceptions,
        ),
        evaluatedAt: args.evaluated_at,
      });
      const record = args.persist ? await store.recordAudit(report) : undefined;
      return auditResponse(report, args.format, [], record);
    } catch (error) {
      return toolError(error);
    }
  },
);

registerTool(
  "audit_baseline_raw_responses",
  "Normalize supported Check Point Gaia and Management show responses, then evaluate Baseline Format v1 without changing a target system.",
  {
    baseline: z.record(z.unknown()),
    target: z.string().optional(),
    gaia_responses: z
      .object({
        dns: z.unknown().optional(),
        dhcp: z.unknown().optional(),
        date_time: z.unknown().optional(),
      })
      .optional(),
    management_responses: z
      .object({ access_rulebase_pages: z.array(z.unknown()).optional() })
      .optional(),
    expected_timezone: z.string().optional(),
    parameters: z.record(z.unknown()).optional(),
    ...outputSchema,
  },
  async (args: RawAuditToolArgs) => {
    try {
      const gaia = adaptGaiaResponses({
        dns: args.gaia_responses?.dns,
        dhcp: args.gaia_responses?.dhcp,
        dateTime: args.gaia_responses?.date_time,
        expectedTimezone: args.expected_timezone,
      });
      const rulebase = adaptAccessRulebasePages(
        args.management_responses?.access_rulebase_pages ?? [],
      );
      const warnings = [...gaia.warnings, ...rulebase.warnings];
      const observations = buildObservationDocument({
        gaia: gaia.value,
        rules: rulebase.value.length > 0 ? rulebase.value : undefined,
        parameters: args.parameters,
      });
      const report = evaluateBaseline({
        baseline: args.baseline,
        observations,
        target: args.target,
        exceptions: await savedExceptions(
          args.target,
          args.use_saved_exceptions,
        ),
        evaluatedAt: args.evaluated_at,
      });
      const record = args.persist
        ? await store.recordAudit(report, warnings)
        : undefined;
      return auditResponse(report, args.format, warnings, record);
    } catch (error) {
      return toolError(error);
    }
  },
);

registerTool(
  "get_audit_history",
  "Get locally stored baseline audit history and changes from previous runs.",
  {
    target: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional().default(20),
  },
  async (args: HistoryToolArgs) => {
    try {
      const audits = await store.listAudits(args.target, args.limit);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ storePath: store.path, audits }, null, 2),
          },
        ],
      };
    } catch (error) {
      return toolError(error);
    }
  },
);

registerTool(
  "upsert_audit_exception",
  "Create or replace a time-limited baseline exception. Exceptions are reported as EXEMPTED and never PASS.",
  exceptionSchema,
  async (args: ExceptionToolArgs) => {
    try {
      const exception = await store.upsertException(asException(args));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ stored: true, exception }, null, 2),
          },
        ],
      };
    } catch (error) {
      return toolError(error);
    }
  },
);

registerTool(
  "list_audit_exceptions",
  "List locally stored baseline exceptions, optionally including expired entries.",
  {
    target: z.string().optional(),
    include_expired: z.boolean().optional().default(false),
  },
  async (args: ExceptionToolArgs) => {
    try {
      const exceptions = await store.listExceptions(
        args.target,
        args.include_expired,
      );
      return {
        content: [
          { type: "text", text: JSON.stringify({ exceptions }, null, 2) },
        ],
      };
    } catch (error) {
      return toolError(error);
    }
  },
);

registerTool(
  "delete_audit_exception",
  "Delete a locally stored baseline exception by ID without changing a target system.",
  { id: z.string().min(1) },
  async (args: ExceptionToolArgs) => {
    try {
      const deleted = await store.deleteException(args.id ?? "");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ id: args.id, deleted }, null, 2),
          },
        ],
      };
    } catch (error) {
      return toolError(error);
    }
  },
);

registerTool(
  "list_baseline_controls",
  "Validate Baseline Format v1 and list its controls and remediation metadata.",
  { baseline: z.record(z.unknown()) },
  async (args: AuditToolArgs) => {
    try {
      const baseline = parseBaseline(args.baseline);
      const controls = baseline.controls.map((control) => ({
        id: control.id,
        title: control.title,
        severity: control.severity,
        remediation: control.remediation,
      }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { baseline: baseline.baseline, controls },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return toolError(error);
    }
  },
);

export {
  adaptAccessRulebasePages,
  adaptGaiaResponses,
  AuditStore,
  buildObservationDocument,
  evaluateBaseline,
  parseBaseline,
  renderMarkdown,
  server,
};
export type {
  AccessRule,
  AuditException,
  AuditReport,
  AuditResult,
  BaselineAssertion,
  BaselineControl,
  BaselineDefinition,
  GaiaObservations,
  ObservationDocument,
  StoredAudit,
} from "./types.js";

const main = async (): Promise<void> => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
};

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
