import { changePlanDigest } from "@focuslight-nr/checkpoint-baseline-change-planner-mcp/planner";
import { parseChangePlan } from "@focuslight-nr/checkpoint-baseline-change-planner-mcp/schema";
import {
  artifactDigest,
  parseApprovalRecord,
  parseDryRunReceipt,
  parseFakeGaiaState,
} from "./schema.js";
import type {
  ApprovalRecord,
  DryRunChangePlanInput,
  DryRunChangePlanResult,
  DryRunCheck,
} from "./types.js";

function requireUniqueNonEmpty(values: string[], label: string): Set<string> {
  if (values.length === 0) {
    throw new Error(`${label} must contain at least one value`);
  }
  const unique = new Set(values);
  if (unique.size !== values.length) {
    throw new Error(`${label} must not contain duplicates`);
  }
  return unique;
}

function check(
  checks: DryRunCheck[],
  code: DryRunCheck["code"],
  pass: boolean,
  message: string,
  context: Pick<DryRunCheck, "changeId" | "approvalId"> = {},
): void {
  checks.push({ code, status: pass ? "PASS" : "FAIL", message, ...context });
}

function approvalKey(record: ApprovalRecord): string {
  return `${record.approval.approver.issuer}\u0000${record.approval.approver.subject}`;
}

export function dryRunChangePlan(
  input: DryRunChangePlanInput,
): DryRunChangePlanResult {
  const plan = parseChangePlan(input.changePlan);
  if (plan.changes.length > 100) {
    throw new Error("changePlan must not contain more than 100 changes");
  }
  if (input.approvalRecords.length > 100) {
    throw new Error("approvalRecords must not contain more than 100 records");
  }
  const approvals = input.approvalRecords.map(parseApprovalRecord);
  const state = parseFakeGaiaState(input.fakeState);
  const executorAllowedActions = requireUniqueNonEmpty(
    input.executorAllowedActions,
    "executorAllowedActions",
  );
  const trustedIssuers = requireUniqueNonEmpty(
    input.trustedApprovalIssuers,
    "trustedApprovalIssuers",
  );
  if (executorAllowedActions.size > 100) {
    throw new Error(
      "executorAllowedActions must not contain more than 100 values",
    );
  }
  if (trustedIssuers.size > 20) {
    throw new Error(
      "trustedApprovalIssuers must not contain more than 20 values",
    );
  }
  if (
    !Number.isInteger(input.maxStateAgeSeconds) ||
    input.maxStateAgeSeconds < 1 ||
    input.maxStateAgeSeconds > 86400
  ) {
    throw new Error(
      "maxStateAgeSeconds must be an integer between 1 and 86400",
    );
  }
  const evaluatedAt = input.evaluatedAt ?? new Date().toISOString();
  const evaluatedAtMs = Date.parse(evaluatedAt);
  if (Number.isNaN(evaluatedAtMs)) {
    throw new Error("evaluatedAt must be an ISO 8601 timestamp");
  }

  const planSha256 = changePlanDigest(plan);
  const checks: DryRunCheck[] = [];
  check(
    checks,
    "PLAN_TARGET_MATCH",
    state.target === plan.source.target,
    state.target === plan.source.target
      ? "Fake state target matches the plan target."
      : `Fake state target ${state.target} does not match ${plan.source.target}.`,
  );
  const stateAgeMs = evaluatedAtMs - Date.parse(state.capturedAt);
  const stateFresh =
    stateAgeMs >= 0 && stateAgeMs <= input.maxStateAgeSeconds * 1000;
  check(
    checks,
    "STATE_FRESH",
    stateFresh,
    stateFresh
      ? "Fake state is within the configured freshness window."
      : "Fake state is stale or dated in the future.",
  );
  check(
    checks,
    "BACKUP_AVAILABLE",
    state.backupAvailable,
    state.backupAvailable
      ? "The fake backend reports backup capability."
      : "The fake backend cannot create the required pre-change backup.",
  );

  const changeIds = new Set(plan.changes.map((change) => change.id));
  const seenApprovalIds = new Set<string>();
  const eligibleApprovals: ApprovalRecord[] = [];
  for (const record of approvals) {
    const approval = record.approval;
    const duplicateId = seenApprovalIds.has(approval.id);
    seenApprovalIds.add(approval.id);
    const bound =
      !duplicateId &&
      approval.planId === plan.plan.id &&
      approval.planSha256 === planSha256 &&
      approval.changeIds.every((changeId) => changeIds.has(changeId));
    check(
      checks,
      "APPROVAL_PLAN_BOUND",
      bound,
      bound
        ? "Approval is bound to this plan and known changes."
        : "Approval has a duplicate ID or is not bound to this exact plan and its changes.",
      { approvalId: approval.id },
    );
    const trusted = trustedIssuers.has(approval.approver.issuer);
    check(
      checks,
      "APPROVAL_ISSUER_TRUSTED",
      trusted,
      trusted
        ? "Approval issuer is allowlisted."
        : "Approval issuer is not allowlisted.",
      { approvalId: approval.id },
    );
    const approvedAtMs = Date.parse(approval.approvedAt);
    const current =
      approvedAtMs >= Date.parse(plan.plan.generatedAt) &&
      approvedAtMs <= evaluatedAtMs &&
      Date.parse(approval.expiresAt) > evaluatedAtMs;
    check(
      checks,
      "APPROVAL_CURRENT",
      current,
      current
        ? "Approval is current and was issued after the plan was generated."
        : "Approval is expired, future-dated, or predates the plan.",
      { approvalId: approval.id },
    );
    if (bound && trusted && current) eligibleApprovals.push(record);
  }

  for (const change of plan.changes) {
    const executorAllowed = executorAllowedActions.has(change.action.id);
    check(
      checks,
      "ACTION_ALLOWED",
      executorAllowed,
      executorAllowed
        ? "Action is in the executor allowlist."
        : "Action is not in the executor allowlist.",
      { changeId: change.id },
    );
    const backendSupported = state.supportedActions.includes(change.action.id);
    check(
      checks,
      "ACTION_SUPPORTED",
      backendSupported,
      backendSupported
        ? "Fake backend supports the action."
        : "Fake backend does not support the action.",
      { changeId: change.id },
    );
    for (const precondition of change.preconditions) {
      const currentObserved = state.observedByControl[precondition.controlId];
      const unchanged = currentObserved === precondition.expectedObserved;
      check(
        checks,
        "PRECONDITION_UNCHANGED",
        unchanged,
        unchanged
          ? "Observed state still matches the audited failed state."
          : "Observed state changed or is unavailable; a fresh audit is required.",
        { changeId: change.id },
      );
    }

    const relevantApprovals = eligibleApprovals.filter((record) =>
      record.approval.changeIds.includes(change.id),
    );
    const rejected = relevantApprovals.some(
      (record) => record.approval.decision === "REJECTED",
    );
    check(
      checks,
      "NO_ACTIVE_REJECTION",
      !rejected,
      rejected
        ? "An active trusted rejection blocks this change."
        : "No active trusted rejection applies to this change.",
      { changeId: change.id },
    );
    const distinctApprovers = new Set(
      relevantApprovals
        .filter((record) => record.approval.decision === "APPROVED")
        .map(approvalKey),
    );
    const sufficient =
      distinctApprovers.size >= change.approval.requiredApprovals;
    check(
      checks,
      "APPROVALS_SUFFICIENT",
      sufficient,
      sufficient
        ? `${distinctApprovers.size} distinct approval(s) satisfy the requirement.`
        : `${distinctApprovers.size} distinct approval(s); ${change.approval.requiredApprovals} required.`,
      { changeId: change.id },
    );
  }

  const status = checks.some((item) => item.status === "FAIL")
    ? "BLOCKED"
    : "READY";
  const receiptSeed = {
    planSha256,
    approvals: approvals.map((approval) => approval.approval.id).sort(),
    state,
    evaluatedAt,
  };
  const receipt = parseDryRunReceipt({
    $schema:
      "https://github.com/focuslight-nr/mcp-servers/blob/main/packages/baseline-change-executor/schemas/dry-run-receipt-format-v1.schema.json",
    formatVersion: "1.0",
    receipt: {
      id: `dry-run-${artifactDigest(receiptSeed).slice(0, 20)}`,
      createdAt: evaluatedAt,
      mode: "DRY_RUN",
      status,
    },
    plan: { id: plan.plan.id, sha256: planSha256 },
    target: plan.source.target,
    effectsApplied: false,
    checks,
    proposedActions: plan.changes.map((change) => ({
      changeId: change.id,
      actionId: change.action.id,
      parameters: change.action.parameters,
    })),
  });
  return { receipt, receiptSha256: artifactDigest(receipt) };
}
