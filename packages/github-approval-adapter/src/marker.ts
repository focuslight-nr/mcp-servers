import { z } from "zod";

const markerSchema = z
  .object({
    planId: z
      .string()
      .min(1)
      .regex(/^[A-Za-z0-9._-]+$/),
    planSha256: z.string().regex(/^[a-f0-9]{64}$/),
    changeIds: z
      .array(
        z
          .string()
          .min(1)
          .regex(/^[A-Za-z0-9._-]+$/),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.changeIds).size !== value.changeIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["changeIds"],
        message: "change IDs must be unique",
      });
    }
  });

export type GithubPlanMarker = z.infer<typeof markerSchema>;

const markerPattern = /<!--\s*checkpoint-change-plan:\s*([\s\S]*?)\s*-->/g;

export function parseGithubPlanMarker(body: string | null): GithubPlanMarker {
  const matches = [...(body ?? "").matchAll(markerPattern)];
  if (matches.length !== 1) {
    throw new Error(
      "pull request body must contain exactly one checkpoint-change-plan marker",
    );
  }
  try {
    return markerSchema.parse(JSON.parse(matches[0]![1]!));
  } catch (error) {
    throw new Error(
      `invalid checkpoint-change-plan marker: ${(error as Error).message}`,
    );
  }
}

export function formatGithubPlanMarker(marker: GithubPlanMarker): string {
  return `<!-- checkpoint-change-plan: ${JSON.stringify(marker)} -->`;
}
