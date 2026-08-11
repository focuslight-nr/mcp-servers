export interface McpProcessConfig {
  command?: string;
  args?: string[];
  cwd?: string;
  forwardEnvironment?: string[];
}

export interface AuditTarget {
  id: string;
  gatewayIp: string;
  gatewayPort?: number;
  credentialProfile?: string;
  managementDomain?: string;
  policyPackage?: string;
  accessLayer?: string;
  expectedTimezone?: string;
  parameters?: Record<string, unknown>;
  enabled: boolean;
}

export interface NotificationConfig {
  enabled: boolean;
  webhookUrlEnvironment: string;
  notifyOn: TargetRunStatus[];
  timeoutMs: number;
}

export interface RunnerConfig {
  concurrency: number;
  retries: number;
  retryDelayMs: number;
  toolTimeoutMs: number;
  staleLockMs: number;
  stateDirectory: string;
  reportDirectory: string;
  baselinePath: string;
  notifications: NotificationConfig;
  mcp: {
    gaia: McpProcessConfig;
    management: McpProcessConfig;
    audit: McpProcessConfig;
  };
  targets: AuditTarget[];
}

export type TargetRunStatus =
  | "COMPLIANT"
  | "NON_COMPLIANT"
  | "REGRESSION"
  | "PARTIAL"
  | "ERROR";

export interface AuditPayload {
  target: string;
  summary: {
    pass: number;
    fail: number;
    exempted: number;
    manual: number;
    error: number;
    total: number;
  };
  adapterWarnings?: string[];
  diff?: {
    regressions: number;
    improvements: number;
    changed: number;
  };
  [key: string]: unknown;
}

export interface TargetRunResult {
  target: string;
  status: TargetRunStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  attempts: number;
  reportJsonPath?: string;
  reportMarkdownPath?: string;
  audit?: AuditPayload;
  error?: string;
}

export interface RunSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  results: TargetRunResult[];
  counts: Record<TargetRunStatus, number>;
  notification?: NotificationResult;
}

export interface NotificationResult {
  attempted: boolean;
  delivered: boolean;
  reason?: string;
  statusCode?: number;
  error?: string;
}
