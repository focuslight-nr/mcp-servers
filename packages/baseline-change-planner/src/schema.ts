import { z } from "zod";
import type { AuditReportInput, ChangePlan, JsonValue } from "./types.js";

const idSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9._-]+$/);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ] as const),
) as z.ZodType<JsonValue>;

const remediationSchema = z
  .object({
    action: idSchema,
    parameters: z.record(jsonValueSchema).optional(),
  })
  .strict();

const auditResultSchema = z
  .object({
    controlId: z.string().min(1),
    title: z.string().min(1),
    severity: z.enum(["low", "medium", "high", "critical"]).optional(),
    status: z.enum(["PASS", "FAIL", "EXEMPTED", "MANUAL", "ERROR"]),
    expected: z.string().min(1),
    observed: z.string(),
    evidence: z.array(z.string()),
    remediation: remediationSchema.optional(),
  })
  .passthrough();

export const auditReportInputSchema = z
  .object({
    benchmark: z.string().min(1),
    baselineId: idSchema,
    baselineVersion: z.string().min(1),
    target: z.string().min(1),
    readOnly: z.literal(true),
    results: z.array(auditResultSchema),
  })
  .passthrough();

const changeSchema = z
  .object({
    id: idSchema,
    controlId: z.string().min(1),
    title: z.string().min(1),
    target: z.string().min(1),
    rationale: z.string().min(1),
    evidence: z.array(z.string()),
    action: z
      .object({ id: idSchema, parameters: z.record(jsonValueSchema) })
      .strict(),
    risk: z
      .object({
        level: z.enum(["low", "medium", "high", "critical"]),
        blastRadius: z.literal("single-target"),
        notes: z.array(z.string()),
      })
      .strict(),
    approval: z
      .object({
        status: z.literal("PENDING"),
        requiredApprovals: z.number().int().min(1),
        approvals: z.tuple([]),
      })
      .strict(),
    preconditions: z
      .array(
        z
          .object({
            kind: z.literal("audit-result-unchanged"),
            controlId: z.string().min(1),
            expectedStatus: z.literal("FAIL"),
            expectedObserved: z.string(),
          })
          .strict(),
      )
      .min(1),
    verification: z
      .object({
        kind: z.literal("baseline-control"),
        controlId: z.string().min(1),
        expectedStatus: z.literal("PASS"),
      })
      .strict(),
    rollback: z
      .object({
        required: z.literal(true),
        strategy: z.literal("restore-pre-change-backup"),
        description: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export const changePlanSchema = z
  .object({
    $schema: z.string().optional(),
    formatVersion: z.literal("1.0"),
    plan: z
      .object({
        id: idSchema,
        generatedAt: z.string().datetime(),
        status: z.literal("PROPOSED"),
        title: z.string().min(1),
      })
      .strict(),
    source: z
      .object({
        auditId: z.string().min(1).optional(),
        auditReportSha256: digestSchema,
        baselineId: idSchema,
        baselineVersion: z.string().min(1),
        target: z.string().min(1),
        reportReadOnly: z.literal(true),
      })
      .strict(),
    safety: z
      .object({
        executionAllowed: z.literal(false),
        humanApprovalRequired: z.literal(true),
        minimumApprovals: z.number().int().min(1),
        dryRunRequired: z.literal(true),
        backupRequired: z.literal(true),
        postChangeAuditRequired: z.literal(true),
        rollbackRequired: z.literal(true),
        maxTargets: z.literal(1),
      })
      .strict(),
    changes: z.array(changeSchema).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.changes.some((change) => change.target !== value.source.target)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["changes"],
        message: "every change must target source.target",
      });
    }
    const highestApprovalCount = Math.max(
      ...value.changes.map((change) => change.approval.requiredApprovals),
    );
    if (value.safety.minimumApprovals !== highestApprovalCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["safety", "minimumApprovals"],
        message: "must equal the highest per-change approval requirement",
      });
    }
    const changeIds = new Set<string>();
    const controlIds = new Set<string>();
    value.changes.forEach((change, index) => {
      if (changeIds.has(change.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["changes", index, "id"],
          message: `duplicate change id: ${change.id}`,
        });
      }
      if (controlIds.has(change.controlId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["changes", index, "controlId"],
          message: `duplicate control id: ${change.controlId}`,
        });
      }
      changeIds.add(change.id);
      controlIds.add(change.controlId);
    });
  });

export function parseAuditReport(value: unknown): AuditReportInput {
  return auditReportInputSchema.parse(value) as AuditReportInput;
}

export function parseChangePlan(value: unknown): ChangePlan {
  return changePlanSchema.parse(value) as ChangePlan;
}
