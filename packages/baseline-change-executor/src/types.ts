import type {
  ChangePlan,
  JsonValue,
} from "@focuslight-nr/checkpoint-baseline-change-planner-mcp/types";

export interface ApprovalRecord {
  $schema?: string;
  formatVersion: "1.0";
  approval: {
    id: string;
    planId: string;
    planSha256: string;
    changeIds: string[];
    decision: "APPROVED" | "REJECTED";
    approver: {
      subject: string;
      displayName?: string;
      issuer: string;
      authentication: "external-identity-provider";
    };
    approvedAt: string;
    expiresAt: string;
    reason: string;
    provenanceReference: string;
  };
}

export interface FakeGaiaState {
  $schema?: string;
  target: string;
  capturedAt: string;
  observedByControl: Record<string, string>;
  supportedActions: string[];
  backupAvailable: boolean;
}

export type DryRunCheckCode =
  | "PLAN_TARGET_MATCH"
  | "STATE_FRESH"
  | "BACKUP_AVAILABLE"
  | "ACTION_ALLOWED"
  | "ACTION_SUPPORTED"
  | "PRECONDITION_UNCHANGED"
  | "APPROVAL_PLAN_BOUND"
  | "APPROVAL_ISSUER_TRUSTED"
  | "APPROVAL_CURRENT"
  | "NO_ACTIVE_REJECTION"
  | "APPROVALS_SUFFICIENT";

export interface DryRunCheck {
  code: DryRunCheckCode;
  status: "PASS" | "FAIL";
  changeId?: string;
  approvalId?: string;
  message: string;
}

export interface DryRunReceipt {
  $schema?: string;
  formatVersion: "1.0";
  receipt: {
    id: string;
    createdAt: string;
    mode: "DRY_RUN";
    status: "READY" | "BLOCKED";
  };
  plan: {
    id: string;
    sha256: string;
  };
  target: string;
  effectsApplied: false;
  checks: DryRunCheck[];
  proposedActions: Array<{
    changeId: string;
    actionId: string;
    parameters: Record<string, JsonValue>;
  }>;
}

export interface DryRunChangePlanInput {
  changePlan: ChangePlan | unknown;
  approvalRecords: Array<ApprovalRecord | unknown>;
  fakeState: FakeGaiaState | unknown;
  executorAllowedActions: string[];
  trustedApprovalIssuers: string[];
  maxStateAgeSeconds: number;
  evaluatedAt?: string;
}

export interface DryRunChangePlanResult {
  receipt: DryRunReceipt;
  receiptSha256: string;
}
