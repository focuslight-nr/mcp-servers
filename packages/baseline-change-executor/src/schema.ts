import { createHash } from "node:crypto";
import { canonicalize } from "@focuslight-nr/checkpoint-baseline-change-planner-mcp/planner";
import { z } from "zod";
import type { ApprovalRecord, DryRunReceipt, FakeGaiaState } from "./types.js";

const idSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9._-]+$/);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const approvalRecordSchema = z
  .object({
    $schema: z.string().optional(),
    formatVersion: z.literal("1.0"),
    approval: z
      .object({
        id: idSchema,
        planId: idSchema,
        planSha256: digestSchema,
        changeIds: z.array(idSchema).min(1).max(100),
        decision: z.enum(["APPROVED", "REJECTED"]),
        approver: z
          .object({
            subject: z.string().min(1),
            displayName: z.string().min(1).optional(),
            issuer: z.string().min(1),
            authentication: z.literal("external-identity-provider"),
          })
          .strict(),
        approvedAt: z.string().datetime(),
        expiresAt: z.string().datetime(),
        reason: z.string().min(1),
        provenanceReference: z.string().min(1),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.approval.changeIds).size !== value.approval.changeIds.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["approval", "changeIds"],
        message: "change IDs must be unique",
      });
    }
    if (
      Date.parse(value.approval.expiresAt) <=
      Date.parse(value.approval.approvedAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["approval", "expiresAt"],
        message: "expiresAt must be later than approvedAt",
      });
    }
  });

export const fakeGaiaStateSchema = z
  .object({
    $schema: z.string().optional(),
    target: z.string().min(1),
    capturedAt: z.string().datetime(),
    observedByControl: z.record(z.string()),
    supportedActions: z.array(idSchema).max(100),
    backupAvailable: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.supportedActions).size !== value.supportedActions.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["supportedActions"],
        message: "supported actions must be unique",
      });
    }
  });

const dryRunCheckSchema = z
  .object({
    code: z.enum([
      "PLAN_TARGET_MATCH",
      "STATE_FRESH",
      "BACKUP_AVAILABLE",
      "ACTION_ALLOWED",
      "ACTION_SUPPORTED",
      "PRECONDITION_UNCHANGED",
      "APPROVAL_PLAN_BOUND",
      "APPROVAL_ISSUER_TRUSTED",
      "APPROVAL_CURRENT",
      "NO_ACTIVE_REJECTION",
      "APPROVALS_SUFFICIENT",
    ]),
    status: z.enum(["PASS", "FAIL"]),
    changeId: idSchema.optional(),
    approvalId: idSchema.optional(),
    message: z.string().min(1),
  })
  .strict();

export const dryRunReceiptSchema = z
  .object({
    $schema: z.string().optional(),
    formatVersion: z.literal("1.0"),
    receipt: z
      .object({
        id: idSchema,
        createdAt: z.string().datetime(),
        mode: z.literal("DRY_RUN"),
        status: z.enum(["READY", "BLOCKED"]),
      })
      .strict(),
    plan: z.object({ id: idSchema, sha256: digestSchema }).strict(),
    target: z.string().min(1),
    effectsApplied: z.literal(false),
    checks: z.array(dryRunCheckSchema).min(1),
    proposedActions: z.array(
      z
        .object({
          changeId: idSchema,
          actionId: idSchema,
          parameters: z.record(z.unknown()),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((value, context) => {
    const hasFailure = value.checks.some((check) => check.status === "FAIL");
    if ((value.receipt.status === "BLOCKED") !== hasFailure) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["receipt", "status"],
        message: "BLOCKED must exactly reflect whether any check failed",
      });
    }
  });

export function parseApprovalRecord(value: unknown): ApprovalRecord {
  return approvalRecordSchema.parse(value) as ApprovalRecord;
}

export function parseFakeGaiaState(value: unknown): FakeGaiaState {
  return fakeGaiaStateSchema.parse(value) as FakeGaiaState;
}

export function parseDryRunReceipt(value: unknown): DryRunReceipt {
  return dryRunReceiptSchema.parse(value) as DryRunReceipt;
}

export function artifactDigest(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}
