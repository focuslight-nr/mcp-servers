export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface AuditResultInput {
  controlId: string;
  title: string;
  severity?: RiskLevel;
  status: "PASS" | "FAIL" | "EXEMPTED" | "MANUAL" | "ERROR";
  expected: string;
  observed: string;
  evidence: string[];
  remediation?: {
    action: string;
    parameters?: Record<string, JsonValue>;
  };
}

export interface AuditReportInput {
  benchmark: string;
  baselineId: string;
  baselineVersion: string;
  target: string;
  readOnly: true;
  results: AuditResultInput[];
}

export interface ChangePlanChange {
  id: string;
  controlId: string;
  title: string;
  target: string;
  rationale: string;
  evidence: string[];
  action: {
    id: string;
    parameters: Record<string, JsonValue>;
  };
  risk: {
    level: RiskLevel;
    blastRadius: "single-target";
    notes: string[];
  };
  approval: {
    status: "PENDING";
    requiredApprovals: number;
    approvals: [];
  };
  preconditions: Array<{
    kind: "audit-result-unchanged";
    controlId: string;
    expectedStatus: "FAIL";
    expectedObserved: string;
  }>;
  verification: {
    kind: "baseline-control";
    controlId: string;
    expectedStatus: "PASS";
  };
  rollback: {
    required: true;
    strategy: "restore-pre-change-backup";
    description: string;
  };
}

export interface ChangePlan {
  $schema?: string;
  formatVersion: "1.0";
  plan: {
    id: string;
    generatedAt: string;
    status: "PROPOSED";
    title: string;
  };
  source: {
    auditId?: string;
    auditReportSha256: string;
    baselineId: string;
    baselineVersion: string;
    target: string;
    reportReadOnly: true;
  };
  safety: {
    executionAllowed: false;
    humanApprovalRequired: true;
    minimumApprovals: number;
    dryRunRequired: true;
    backupRequired: true;
    postChangeAuditRequired: true;
    rollbackRequired: true;
    maxTargets: 1;
  };
  changes: ChangePlanChange[];
}

export interface UnresolvedControl {
  controlId: string;
  reason: "NO_REMEDIATION" | "ACTION_NOT_ALLOWED";
  action?: string;
}

export interface PlanAuditRemediationResult {
  plan: ChangePlan | null;
  planSha256: string | null;
  unresolvedControls: UnresolvedControl[];
}
