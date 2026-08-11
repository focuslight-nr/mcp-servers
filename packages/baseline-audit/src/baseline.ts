import { z } from "zod";
import type { BaselineDefinition, BaselineValue } from "./types.js";

const pathSchema = z
  .string()
  .min(1)
  .regex(
    /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/,
    "must be a dot-separated path",
  );
const baselineValueSchema: z.ZodType<BaselineValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(baselineValueSchema),
    z.record(baselineValueSchema),
  ] as const),
) as z.ZodType<BaselineValue>;

const assertionSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([
    z
      .object({
        path: pathSchema,
        operator: z.enum([
          "exists",
          "notExists",
          "equals",
          "notEquals",
          "contains",
          "greaterThanOrEqual",
          "lessThanOrEqual",
          "minItems",
          "maxItems",
          "truthy",
        ]),
        value: baselineValueSchema.optional(),
        valuePath: pathSchema.optional(),
        caseInsensitive: z.boolean().optional(),
      })
      .strict()
      .superRefine((value, context) => {
        const requiresValue = [
          "equals",
          "notEquals",
          "contains",
          "greaterThanOrEqual",
          "lessThanOrEqual",
          "minItems",
          "maxItems",
        ].includes(value.operator);
        if (
          requiresValue &&
          value.value === undefined &&
          value.valuePath === undefined
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${value.operator} requires value or valuePath`,
          });
        }
        if (value.value !== undefined && value.valuePath !== undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "value and valuePath are mutually exclusive",
          });
        }
        if (
          ["minItems", "maxItems"].includes(value.operator) &&
          value.valuePath === undefined &&
          (typeof value.value !== "number" ||
            !Number.isInteger(value.value) ||
            value.value < 0)
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${value.operator} requires a non-negative integer value`,
          });
        }
      }),
    z.object({ all: z.array(assertionSchema).min(1) }).strict(),
    z.object({ any: z.array(assertionSchema).min(1) }).strict(),
    z.object({ not: assertionSchema }).strict(),
    z
      .object({
        path: pathSchema,
        operator: z.enum(["allMatch", "anyMatch", "noneMatch"]),
        where: assertionSchema,
        evidencePath: pathSchema.optional(),
      })
      .strict(),
  ]),
);

const remediationSchema = z
  .object({
    action: z
      .string()
      .min(1)
      .regex(/^[A-Za-z0-9_.-]+$/),
    parameters: z.record(baselineValueSchema).optional(),
  })
  .strict();

const controlSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
    severity: z.enum(["low", "medium", "high", "critical"]).optional(),
    expected: z.string().min(1),
    assertion: assertionSchema,
    errorWhen: assertionSchema.optional(),
    manualWhen: assertionSchema.optional(),
    onMissing: z.enum(["ERROR", "MANUAL", "FAIL"]).optional().default("ERROR"),
    remediation: remediationSchema.optional(),
  })
  .strict();

export const baselineDefinitionSchema = z
  .object({
    $schema: z.string().optional(),
    formatVersion: z.literal("1.0"),
    baseline: z
      .object({
        id: z
          .string()
          .min(1)
          .regex(/^[A-Za-z0-9._-]+$/),
        version: z.string().min(1),
        title: z.string().min(1),
        description: z.string().optional(),
        vendor: z.string().optional(),
        platform: z.string().optional(),
      })
      .strict(),
    inputs: z
      .array(
        z
          .string()
          .min(1)
          .regex(/^[A-Za-z0-9._-]+$/),
      )
      .optional(),
    controls: z.array(controlSchema).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.controls.forEach((control, index) => {
      if (seen.has(control.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["controls", index, "id"],
          message: `duplicate control id: ${control.id}`,
        });
      }
      seen.add(control.id);
    });
    if (value.inputs && new Set(value.inputs).size !== value.inputs.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inputs"],
        message: "input IDs must be unique",
      });
    }
  });

export function parseBaseline(value: unknown): BaselineDefinition {
  return baselineDefinitionSchema.parse(value) as BaselineDefinition;
}
