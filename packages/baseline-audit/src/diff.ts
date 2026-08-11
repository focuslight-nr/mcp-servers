import type { AuditDiff, AuditReport, AuditStatus } from "./types.js";

function isBad(status: AuditStatus): boolean {
  return status === "FAIL" || status === "ERROR";
}

export function diffAuditReports(
  previous: AuditReport | undefined,
  current: AuditReport,
): AuditDiff {
  if (!previous) {
    return {
      changed: 0,
      regressions: 0,
      improvements: 0,
      unchanged: current.results.length,
      changes: [],
    };
  }

  const previousById = new Map(
    previous.results.map((item) => [item.controlId, item]),
  );
  const changes: AuditDiff["changes"] = [];
  let unchanged = 0;

  for (const currentResult of current.results) {
    const previousResult = previousById.get(currentResult.controlId);
    if (!previousResult) {
      continue;
    }
    if (
      previousResult.status === currentResult.status &&
      previousResult.observed === currentResult.observed
    ) {
      unchanged += 1;
      continue;
    }

    const kind =
      ["PASS", "EXEMPTED"].includes(previousResult.status) &&
      isBad(currentResult.status)
        ? "REGRESSION"
        : isBad(previousResult.status) &&
            ["PASS", "EXEMPTED"].includes(currentResult.status)
          ? "IMPROVEMENT"
          : "CHANGED";
    changes.push({
      controlId: currentResult.controlId,
      kind,
      previousStatus: previousResult.status,
      currentStatus: currentResult.status,
      previousObserved: previousResult.observed,
      currentObserved: currentResult.observed,
    });
  }

  return {
    changed: changes.length,
    regressions: changes.filter((item) => item.kind === "REGRESSION").length,
    improvements: changes.filter((item) => item.kind === "IMPROVEMENT").length,
    unchanged,
    changes,
  };
}
