import type { AuditException, AuditReport, AuditResult } from "./types.js";

export interface AppliedExceptions {
  report: AuditReport;
  expiredExceptionIds: string[];
}

function validDate(value: string): number | undefined {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

export function validateException(exception: AuditException): string[] {
  const errors: string[] = [];
  if (!exception.id.trim()) errors.push("id is required");
  if (!exception.controlId.trim()) errors.push("controlId is required");
  if (!exception.target.trim()) errors.push("target is required");
  if (!exception.reason.trim()) errors.push("reason is required");
  if (!exception.approvedBy.trim()) errors.push("approvedBy is required");
  if (validDate(exception.expiresAt) === undefined)
    errors.push("expiresAt must be an ISO-8601 date");
  return errors;
}

function appliesToTarget(exception: AuditException, target: string): boolean {
  return (
    exception.target === "*" ||
    exception.target.toLowerCase() === target.toLowerCase()
  );
}

function appliesToBaseline(
  exception: AuditException,
  report: AuditReport,
): boolean {
  return (
    !exception.baselineId ||
    exception.baselineId.toLowerCase() === report.baselineId?.toLowerCase()
  );
}

function applyToResult(
  result: AuditResult,
  exceptions: AuditException[],
): AuditResult {
  if (result.status !== "FAIL" || exceptions.length === 0) {
    return result;
  }

  const wholeControl = exceptions.filter((item) => !item.evidence);
  if (wholeControl.length > 0) {
    return {
      ...result,
      status: "EXEMPTED",
      observed: `${result.observed}; covered by approved exception`,
      exceptionsApplied: wholeControl.map((item) => item.id),
    };
  }

  const exemptedEvidence = result.evidence.filter((evidence) =>
    exceptions.some(
      (item) => item.evidence?.toLowerCase() === evidence.toLowerCase(),
    ),
  );
  if (exemptedEvidence.length === 0) {
    return result;
  }

  const remainingEvidence = result.evidence.filter(
    (evidence) => !exemptedEvidence.includes(evidence),
  );
  const appliedIds = exceptions
    .filter(
      (item) =>
        item.evidence &&
        exemptedEvidence.some(
          (evidence) => item.evidence?.toLowerCase() === evidence.toLowerCase(),
        ),
    )
    .map((item) => item.id);

  return {
    ...result,
    status: remainingEvidence.length === 0 ? "EXEMPTED" : "FAIL",
    observed:
      remainingEvidence.length === 0
        ? "All violations are covered by approved exceptions"
        : `${remainingEvidence.length} unexempted violating rule(s)`,
    evidence: remainingEvidence,
    exemptedEvidence,
    exceptionsApplied: appliedIds,
  };
}

export function applyExceptions(
  report: AuditReport,
  exceptions: AuditException[],
  evaluatedAt = new Date().toISOString(),
): AppliedExceptions {
  const now = validDate(evaluatedAt) ?? Date.now();
  const expiredExceptionIds: string[] = [];
  const active = exceptions.filter((exception) => {
    const expiry = validDate(exception.expiresAt);
    if (expiry === undefined || expiry <= now) {
      expiredExceptionIds.push(exception.id);
      return false;
    }
    return (
      appliesToTarget(exception, report.target) &&
      appliesToBaseline(exception, report)
    );
  });
  const results = report.results.map((item) =>
    applyToResult(
      item,
      active.filter((exception) => exception.controlId === item.controlId),
    ),
  );
  const count = (status: AuditResult["status"]): number =>
    results.filter((item) => item.status === status).length;

  return {
    report: {
      ...report,
      summary: {
        pass: count("PASS"),
        fail: count("FAIL"),
        exempted: count("EXEMPTED"),
        manual: count("MANUAL"),
        error: count("ERROR"),
        total: results.length,
      },
      results,
      notes:
        expiredExceptionIds.length > 0
          ? [
              ...report.notes,
              `Expired or invalid exceptions ignored: ${expiredExceptionIds.join(", ")}`,
            ]
          : report.notes,
    },
    expiredExceptionIds,
  };
}
