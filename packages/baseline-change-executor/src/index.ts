#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { dryRunChangePlan } from "./executor.js";
import {
  artifactDigest,
  parseApprovalRecord,
  parseDryRunReceipt,
} from "./schema.js";

interface ToolResponse {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

const server = new McpServer({
  name: "@focuslight-nr/checkpoint-baseline-change-executor-mcp",
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
  "dry_run_change_plan",
  "Evaluate an approved Change Plan v1 against a fake Gaia state. This tool never connects to or changes a target.",
  {
    change_plan: z.record(z.unknown()),
    approval_records: z.array(z.record(z.unknown())).max(100),
    fake_state: z.record(z.unknown()),
    executor_allowed_actions: z.array(z.string().min(1)).min(1).max(100),
    trusted_approval_issuers: z.array(z.string().min(1)).min(1).max(20),
    max_state_age_seconds: z.number().int().min(1).max(86400),
    evaluated_at: z.string().datetime().optional(),
  },
  async (args: {
    change_plan?: unknown;
    approval_records?: unknown[];
    fake_state?: unknown;
    executor_allowed_actions?: string[];
    trusted_approval_issuers?: string[];
    max_state_age_seconds?: number;
    evaluated_at?: string;
  }) => {
    try {
      return response(
        dryRunChangePlan({
          changePlan: args.change_plan,
          approvalRecords: args.approval_records ?? [],
          fakeState: args.fake_state,
          executorAllowedActions: args.executor_allowed_actions ?? [],
          trustedApprovalIssuers: args.trusted_approval_issuers ?? [],
          maxStateAgeSeconds: args.max_state_age_seconds ?? 0,
          evaluatedAt: args.evaluated_at,
        }),
      );
    } catch (error) {
      return toolError(error);
    }
  },
);

registerTool(
  "validate_approval_record",
  "Validate Approval Record Format v1 without authenticating an identity or changing a target.",
  { approval_record: z.record(z.unknown()) },
  async (args: { approval_record?: unknown }) => {
    try {
      const record = parseApprovalRecord(args.approval_record);
      return response({
        valid: true,
        formatVersion: record.formatVersion,
        approval: record.approval,
        approvalRecordSha256: artifactDigest(record),
      });
    } catch (error) {
      return toolError(error);
    }
  },
);

registerTool(
  "validate_dry_run_receipt",
  "Validate Dry-run Receipt Format v1 without executing any action.",
  { dry_run_receipt: z.record(z.unknown()) },
  async (args: { dry_run_receipt?: unknown }) => {
    try {
      const receipt = parseDryRunReceipt(args.dry_run_receipt);
      return response({
        valid: true,
        formatVersion: receipt.formatVersion,
        receipt: receipt.receipt,
        effectsApplied: receipt.effectsApplied,
        receiptSha256: artifactDigest(receipt),
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

export { dryRunChangePlan } from "./executor.js";
export {
  approvalRecordSchema,
  artifactDigest,
  dryRunReceiptSchema,
  fakeGaiaStateSchema,
  parseApprovalRecord,
  parseDryRunReceipt,
  parseFakeGaiaState,
} from "./schema.js";
export type {
  ApprovalRecord,
  DryRunChangePlanInput,
  DryRunChangePlanResult,
  DryRunReceipt,
  FakeGaiaState,
} from "./types.js";
