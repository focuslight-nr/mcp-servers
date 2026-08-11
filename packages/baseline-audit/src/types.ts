export type AuditStatus = "PASS" | "FAIL" | "EXEMPTED" | "MANUAL" | "ERROR";

export type MissingObservationStatus = "ERROR" | "MANUAL" | "FAIL";

export type BaselineValue =
  | string
  | number
  | boolean
  | null
  | BaselineValue[]
  | { [key: string]: BaselineValue };

export interface ValueAssertion {
  path: string;
  operator:
    | "exists"
    | "notExists"
    | "equals"
    | "notEquals"
    | "contains"
    | "minItems"
    | "maxItems"
    | "truthy";
  value?: BaselineValue;
  valuePath?: string;
  caseInsensitive?: boolean;
}

export interface AllAssertion {
  all: BaselineAssertion[];
}

export interface AnyAssertion {
  any: BaselineAssertion[];
}

export interface NotAssertion {
  not: BaselineAssertion;
}

export interface CollectionAssertion {
  path: string;
  operator: "allMatch" | "anyMatch" | "noneMatch";
  where: BaselineAssertion;
  evidencePath?: string;
}

export type BaselineAssertion =
  | ValueAssertion
  | AllAssertion
  | AnyAssertion
  | NotAssertion
  | CollectionAssertion;

export interface BaselineRemediation {
  action: string;
  parameters?: Record<string, BaselineValue>;
}

export interface BaselineControl {
  id: string;
  title: string;
  description?: string;
  severity?: "low" | "medium" | "high" | "critical";
  expected: string;
  assertion: BaselineAssertion;
  errorWhen?: BaselineAssertion;
  manualWhen?: BaselineAssertion;
  onMissing?: MissingObservationStatus;
  remediation?: BaselineRemediation;
}

export interface BaselineDefinition {
  $schema?: string;
  formatVersion: "1.0";
  baseline: {
    id: string;
    version: string;
    title: string;
    description?: string;
    vendor?: string;
    platform?: string;
  };
  inputs?: string[];
  controls: BaselineControl[];
}

export type ObservationDocument = Record<string, unknown>;

export interface AuditException {
  id: string;
  baselineId?: string;
  controlId: string;
  target: string;
  evidence?: string;
  reason: string;
  approvedBy: string;
  expiresAt: string;
}

export interface GaiaObservations {
  dnsServers?: string[];
  dhcpEnabled?: boolean;
  ntpEnabled?: boolean;
  ntpServers?: string[];
  timezone?: string;
  expectedTimezone?: string;
}

export interface AccessRule {
  ruleNumber?: string | number;
  name?: string;
  source?: string[];
  destination?: string[];
  service?: string[];
  action?: string;
  track?: string;
  enabled?: boolean;
  type?: "rule" | "section";
}

export interface AuditResult {
  controlId: string;
  title: string;
  status: AuditStatus;
  expected: string;
  observed: string;
  evidence: string[];
  remediation?: BaselineRemediation;
  exemptedEvidence?: string[];
  exceptionsApplied?: string[];
}

export interface AuditSummary {
  pass: number;
  fail: number;
  exempted: number;
  manual: number;
  error: number;
  total: number;
}

export type AuditChangeKind = "REGRESSION" | "IMPROVEMENT" | "CHANGED";

export interface AuditChange {
  controlId: string;
  kind: AuditChangeKind;
  previousStatus: AuditStatus;
  currentStatus: AuditStatus;
  previousObserved: string;
  currentObserved: string;
}

export interface AuditDiff {
  previousAuditId?: string;
  changed: number;
  regressions: number;
  improvements: number;
  unchanged: number;
  changes: AuditChange[];
}

export interface StoredAudit {
  id: string;
  recordedAt: string;
  report: AuditReport;
  diff?: AuditDiff;
  adapterWarnings?: string[];
}

export interface AuditReport {
  benchmark: string;
  baselineId?: string;
  baselineVersion?: string;
  target: string;
  readOnly: true;
  summary: AuditSummary;
  results: AuditResult[];
  notes: string[];
}
