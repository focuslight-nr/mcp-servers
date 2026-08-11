import type { AuditReport } from "./types.js";

function escapeCell(value: string): string {
  return value.split("|").join("\\|").split("\n").join("<br>");
}

export function renderMarkdown(report: AuditReport): string {
  const lines = [
    `# ${report.benchmark} Audit: ${report.target}`,
    "",
    `Benchmark: ${report.benchmark}`,
    "",
    `Summary: ${report.summary.pass} PASS, ${report.summary.fail} FAIL, ${report.summary.exempted} EXEMPTED, ${report.summary.manual} MANUAL, ${report.summary.error} ERROR`,
    "",
    "| Control | Status | Title | Observed | Expected |",
    "|---|---|---|---|---|",
  ];

  for (const item of report.results) {
    lines.push(
      `| ${item.controlId} | ${item.status} | ${escapeCell(item.title)} | ${escapeCell(item.observed)} | ${escapeCell(item.expected)} |`,
    );
    if (item.evidence.length > 0) {
      lines.push(
        `|  |  | Evidence | ${escapeCell(item.evidence.join(", "))} |  |`,
      );
    }
    if (item.exemptedEvidence && item.exemptedEvidence.length > 0) {
      lines.push(
        `|  |  | Exempted evidence | ${escapeCell(item.exemptedEvidence.join(", "))} |  |`,
      );
    }
    if (item.exceptionsApplied && item.exceptionsApplied.length > 0) {
      lines.push(
        `|  |  | Exceptions | ${escapeCell(item.exceptionsApplied.join(", "))} |  |`,
      );
    }
    if (item.remediation) {
      lines.push(
        `|  |  | Remediation action | ${escapeCell(item.remediation.action)} | Metadata only; not executed |`,
      );
    }
  }

  lines.push("", "## Notes", "");
  for (const note of report.notes) {
    lines.push(`- ${note}`);
  }

  return lines.join("\n");
}
