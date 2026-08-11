#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { changePlanDigest, planAuditRemediation } from "./planner.js";
import { parseChangePlan } from "./schema.js";

interface ToolResponse {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

const server = new McpServer({
  name: "@focuslight-nr/checkpoint-baseline-change-planner-mcp",
  version: "0.1.0",
});

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

function response(value: unknown): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
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
  "plan_audit_remediation",
  "Generate a non-executable Change Plan Format v1 proposal from a read-only audit report. Only explicitly allowlisted action IDs are included.",
  {
    audit_report: z.record(z.unknown()),
    allowed_actions: z.array(z.string().min(1)).min(1),
    audit_id: z.string().min(1).optional(),
    generated_at: z.string().datetime().optional(),
  },
  async (args: {
    audit_report?: unknown;
    allowed_actions?: string[];
    audit_id?: string;
    generated_at?: string;
  }) => {
    try {
      return response(
        planAuditRemediation({
          auditReport: args.audit_report,
          allowedActions: args.allowed_actions ?? [],
          auditId: args.audit_id,
          generatedAt: args.generated_at,
        }),
      );
    } catch (error) {
      return toolError(error);
    }
  },
);

registerTool(
  "validate_change_plan",
  "Validate Change Plan Format v1 without approving or executing any change.",
  { change_plan: z.record(z.unknown()) },
  async (args: { change_plan?: unknown }) => {
    try {
      const plan = parseChangePlan(args.change_plan);
      return response({
        valid: true,
        formatVersion: plan.formatVersion,
        plan: plan.plan,
        source: plan.source,
        safety: plan.safety,
        changeCount: plan.changes.length,
        planSha256: changePlanDigest(plan),
      });
    } catch (error) {
      return toolError(error);
    }
  },
);

const main = async (): Promise<void> => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
};

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});

export {
  auditReportDigest,
  canonicalize,
  changePlanDigest,
  planAuditRemediation,
} from "./planner.js";
export { changePlanSchema, parseChangePlan } from "./schema.js";
export type {
  ChangePlan,
  ChangePlanChange,
  PlanAuditRemediationResult,
  UnresolvedControl,
} from "./types.js";
