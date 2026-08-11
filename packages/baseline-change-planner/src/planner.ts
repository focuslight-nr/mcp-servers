import { createHash } from "node:crypto";
import { parseAuditReport, parseChangePlan } from "./schema.js";
import type {
  AuditReportInput,
  ChangePlan,
  JsonValue,
  PlanAuditRemediationResult,
  RiskLevel,
} from "./types.js";

export interface PlanAuditRemediationInput {
  auditReport: AuditReportInput | unknown;
  allowedActions: string[];
  auditId?: string;
  generatedAt?: string;
}

export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function auditReportDigest(report: AuditReportInput): string {
  return createHash("sha256").update(canonicalize(report)).digest("hex");
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

export function changePlanDigest(value: ChangePlan | unknown): string {
  return digest(parseChangePlan(value));
}

function riskLevel(value: unknown): RiskLevel {
  return ["low", "medium", "high", "critical"].includes(String(value))
    ? (value as RiskLevel)
    : "medium";
}

function approvalsFor(level: RiskLevel): number {
  return level === "high" || level === "critical" ? 2 : 1;
}

export function planAuditRemediation(
  input: PlanAuditRemediationInput,
): PlanAuditRemediationResult {
  const report = parseAuditReport(input.auditReport);
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(generatedAt))) {
    throw new Error("generatedAt must be an ISO 8601 timestamp");
  }
  if (input.allowedActions.length === 0) {
    throw new Error("allowedActions must contain at least one action ID");
  }
  const allowedActions = new Set(input.allowedActions);
  if (allowedActions.size !== input.allowedActions.length) {
    throw new Error("allowedActions must not contain duplicates");
  }

  const reportDigest = auditReportDigest(report);
  const unresolvedControls: PlanAuditRemediationResult["unresolvedControls"] =
    [];
  const changes: ChangePlan["changes"] = [];

  for (const result of report.results) {
    if (result.status !== "FAIL") continue;
    if (!result.remediation) {
      unresolvedControls.push({
        controlId: result.controlId,
        reason: "NO_REMEDIATION",
      });
      continue;
    }
    if (!allowedActions.has(result.remediation.action)) {
      unresolvedControls.push({
        controlId: result.controlId,
        reason: "ACTION_NOT_ALLOWED",
        action: result.remediation.action,
      });
      continue;
    }

    const level = riskLevel(result.severity);
    changes.push({
      id: `change-${result.controlId}`,
      controlId: result.controlId,
      title: result.title,
      target: report.target,
      rationale: `The latest bound audit result is FAIL. Expected: ${result.expected}`,
      evidence: [...result.evidence],
      action: {
        id: result.remediation.action,
        parameters: (result.remediation.parameters ?? {}) as Record<
          string,
          JsonValue
        >,
      },
      risk: {
        level,
        blastRadius: "single-target",
        notes: [],
      },
      approval: {
        status: "PENDING",
        requiredApprovals: approvalsFor(level),
        approvals: [],
      },
      preconditions: [
        {
          kind: "audit-result-unchanged",
          controlId: result.controlId,
          expectedStatus: "FAIL",
          expectedObserved: result.observed,
        },
      ],
      verification: {
        kind: "baseline-control",
        controlId: result.controlId,
        expectedStatus: "PASS",
      },
      rollback: {
        required: true,
        strategy: "restore-pre-change-backup",
        description:
          "Restore the executor-created pre-change backup, then rerun the bound baseline control.",
      },
    });
  }

  if (changes.length === 0) {
    return { plan: null, planSha256: null, unresolvedControls };
  }

  const minimumApprovals = Math.max(
    ...changes.map((change) => change.approval.requiredApprovals),
  );
  const planDigest = digest({
    auditReportSha256: reportDigest,
    allowedActions: [...allowedActions].sort(),
    changes: changes.map((change) => ({
      controlId: change.controlId,
      action: change.action,
    })),
  });
  const plan = parseChangePlan({
    $schema:
      "https://github.com/focuslight-nr/mcp-servers/blob/main/packages/baseline-change-planner/schemas/change-plan-format-v1.schema.json",
    formatVersion: "1.0",
    plan: {
      id: `plan-${planDigest.slice(0, 20)}`,
      generatedAt,
      status: "PROPOSED",
      title: `Baseline remediation proposal for ${report.target}`,
    },
    source: {
      auditId: input.auditId,
      auditReportSha256: reportDigest,
      baselineId: report.baselineId,
      baselineVersion: report.baselineVersion,
      target: report.target,
      reportReadOnly: true,
    },
    safety: {
      executionAllowed: false,
      humanApprovalRequired: true,
      minimumApprovals,
      dryRunRequired: true,
      backupRequired: true,
      postChangeAuditRequired: true,
      rollbackRequired: true,
      maxTargets: 1,
    },
    changes,
  });
  return { plan, planSha256: changePlanDigest(plan), unresolvedControls };
}
