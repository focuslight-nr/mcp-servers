import { applyExceptions } from "./exceptions.js";
import { parseBaseline } from "./baseline.js";
import type {
  AuditException,
  AuditReport,
  AuditResult,
  AuditStatus,
  BaselineAssertion,
  BaselineDefinition,
  BaselineValue,
  ObservationDocument,
} from "./types.js";

interface AssertionEvaluation {
  pass: boolean;
  missingPaths: string[];
  evidence: string[];
  observed: string;
}

export interface EvaluateBaselineInput {
  baseline: BaselineDefinition | unknown;
  observations: ObservationDocument;
  target?: string;
  exceptions?: AuditException[];
  evaluatedAt?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolvePath(
  root: unknown,
  path: string,
): { found: boolean; value?: unknown } {
  let current = root;
  for (const segment of path.split(".")) {
    if (
      !isRecord(current) ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return { found: false };
    }
    current = current[segment];
  }
  return { found: true, value: current };
}

function printable(value: unknown): string {
  if (value === undefined) return "missing";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function comparable(
  value: unknown,
  caseInsensitive: boolean | undefined,
): unknown {
  if (caseInsensitive && typeof value === "string") return value.toLowerCase();
  return value;
}

function equal(
  left: unknown,
  right: unknown,
  caseInsensitive: boolean | undefined,
): boolean {
  const normalizedLeft = comparable(left, caseInsensitive);
  const normalizedRight = comparable(right, caseInsensitive);
  if (
    isRecord(normalizedLeft) ||
    Array.isArray(normalizedLeft) ||
    isRecord(normalizedRight) ||
    Array.isArray(normalizedRight)
  ) {
    return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
  }
  return normalizedLeft === normalizedRight;
}

function evidenceLabel(item: unknown, path: string | undefined): string {
  const selected = path
    ? resolvePath(item, path)
    : { found: true, value: item };
  const rendered = selected.found ? printable(selected.value) : printable(item);
  return rendered.length > 300 ? `${rendered.slice(0, 297)}...` : rendered;
}

function evaluateValue(
  assertion: Extract<
    BaselineAssertion,
    {
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
    }
  >,
  root: unknown,
  document: ObservationDocument,
): AssertionEvaluation {
  const actual = resolvePath(root, assertion.path);
  if (assertion.operator === "exists" || assertion.operator === "notExists") {
    const pass = assertion.operator === "exists" ? actual.found : !actual.found;
    return {
      pass,
      missingPaths: [],
      evidence: [],
      observed: `${assertion.path}=${actual.found ? printable(actual.value) : "missing"}`,
    };
  }
  if (!actual.found) {
    return {
      pass: false,
      missingPaths: [assertion.path],
      evidence: [],
      observed: `${assertion.path}=missing`,
    };
  }

  const expectedResult = assertion.valuePath
    ? resolvePath(document, assertion.valuePath)
    : {
        found: assertion.value !== undefined,
        value: assertion.value as BaselineValue | undefined,
      };
  if (assertion.valuePath && !expectedResult.found) {
    return {
      pass: false,
      missingPaths: [assertion.valuePath],
      evidence: [],
      observed: `${assertion.valuePath}=missing`,
    };
  }

  let pass = false;
  switch (assertion.operator) {
    case "equals":
      pass = equal(
        actual.value,
        expectedResult.value,
        assertion.caseInsensitive,
      );
      break;
    case "notEquals":
      pass = !equal(
        actual.value,
        expectedResult.value,
        assertion.caseInsensitive,
      );
      break;
    case "contains": {
      const expected = comparable(
        expectedResult.value,
        assertion.caseInsensitive,
      );
      if (Array.isArray(actual.value)) {
        pass = actual.value.some((item) =>
          equal(item, expected, assertion.caseInsensitive),
        );
      } else if (
        typeof actual.value === "string" &&
        typeof expected === "string"
      ) {
        pass = comparable(actual.value, assertion.caseInsensitive)!
          .toString()
          .includes(expected);
      }
      break;
    }
    case "minItems":
      pass =
        (Array.isArray(actual.value) || typeof actual.value === "string") &&
        actual.value.length >= Number(expectedResult.value);
      break;
    case "maxItems":
      pass =
        (Array.isArray(actual.value) || typeof actual.value === "string") &&
        actual.value.length <= Number(expectedResult.value);
      break;
    case "truthy":
      pass = Boolean(actual.value);
      break;
  }
  return {
    pass,
    missingPaths: [],
    evidence: [],
    observed: `${assertion.path}=${printable(actual.value)}`,
  };
}

function evaluateAssertion(
  assertion: BaselineAssertion,
  root: unknown,
  document: ObservationDocument,
): AssertionEvaluation {
  if ("all" in assertion) {
    const results = assertion.all.map((item) =>
      evaluateAssertion(item, root, document),
    );
    return {
      pass: results.every((item) => item.pass),
      missingPaths: results.flatMap((item) => item.missingPaths),
      evidence: results.flatMap((item) => item.evidence),
      observed: results.map((item) => item.observed).join("; "),
    };
  }
  if ("any" in assertion) {
    const results = assertion.any.map((item) =>
      evaluateAssertion(item, root, document),
    );
    const pass = results.some((item) => item.pass);
    return {
      pass,
      missingPaths:
        !pass && results.some((item) => item.missingPaths.length > 0)
          ? results.flatMap((item) => item.missingPaths)
          : [],
      evidence: results.flatMap((item) => item.evidence),
      observed: results.map((item) => item.observed).join("; "),
    };
  }
  if ("not" in assertion) {
    const result = evaluateAssertion(assertion.not, root, document);
    return {
      ...result,
      pass: result.missingPaths.length === 0 && !result.pass,
    };
  }
  if ("where" in assertion) {
    const collection = resolvePath(root, assertion.path);
    if (!collection.found || !Array.isArray(collection.value)) {
      return {
        pass: false,
        missingPaths: [assertion.path],
        evidence: [],
        observed: `${assertion.path}=missing`,
      };
    }
    const evaluated = collection.value.map((item) => ({
      item,
      result: evaluateAssertion(assertion.where, item, document),
    }));
    const matches = evaluated.filter((item) => item.result.pass);
    const failures = evaluated.filter((item) => !item.result.pass);
    const incomplete = evaluated.flatMap((item, index) =>
      item.result.missingPaths.map(
        (path) => `${assertion.path}.${index}.${path}`,
      ),
    );
    const pass =
      assertion.operator === "allMatch"
        ? failures.length === 0
        : assertion.operator === "anyMatch"
          ? matches.length > 0
          : matches.length === 0;
    const evidenceItems =
      assertion.operator === "allMatch" ? failures : matches;
    return {
      pass,
      missingPaths:
        assertion.operator === "anyMatch" && matches.length > 0
          ? []
          : incomplete,
      evidence: pass
        ? []
        : evidenceItems.map((item) =>
            evidenceLabel(item.item, assertion.evidencePath),
          ),
      observed: `${assertion.path}: ${matches.length}/${collection.value.length} matching item(s)`,
    };
  }
  return evaluateValue(assertion, root, document);
}

function resultStatus(
  onMissing: "ERROR" | "MANUAL" | "FAIL" | undefined,
): AuditStatus {
  return onMissing ?? "ERROR";
}

function count(results: AuditResult[], status: AuditStatus): number {
  return results.filter((item) => item.status === status).length;
}

export function evaluateBaseline(input: EvaluateBaselineInput): AuditReport {
  const baseline = parseBaseline(input.baseline);
  const results = baseline.controls.map((control): AuditResult => {
    if (control.errorWhen) {
      const forcedError = evaluateAssertion(
        control.errorWhen,
        input.observations,
        input.observations,
      );
      if (forcedError.pass) {
        return {
          controlId: control.id,
          title: control.title,
          status: "ERROR",
          expected: control.expected,
          observed: forcedError.observed,
          evidence: forcedError.evidence,
          remediation: control.remediation,
        };
      }
    }
    if (control.manualWhen) {
      const manual = evaluateAssertion(
        control.manualWhen,
        input.observations,
        input.observations,
      );
      if (manual.pass) {
        return {
          controlId: control.id,
          title: control.title,
          status: "MANUAL",
          expected: control.expected,
          observed: manual.observed,
          evidence: manual.evidence,
          remediation: control.remediation,
        };
      }
    }
    const evaluated = evaluateAssertion(
      control.assertion,
      input.observations,
      input.observations,
    );
    const status =
      evaluated.missingPaths.length > 0
        ? resultStatus(control.onMissing)
        : evaluated.pass
          ? "PASS"
          : "FAIL";
    return {
      controlId: control.id,
      title: control.title,
      status,
      expected: control.expected,
      observed:
        evaluated.missingPaths.length > 0
          ? `Missing observation: ${[...new Set(evaluated.missingPaths)].join(", ")}`
          : evaluated.observed,
      evidence: evaluated.evidence,
      remediation: control.remediation,
    };
  });
  const report: AuditReport = {
    benchmark: `${baseline.baseline.title} v${baseline.baseline.version}`,
    baselineId: baseline.baseline.id,
    baselineVersion: baseline.baseline.version,
    target: input.target ?? "unspecified",
    readOnly: true,
    summary: {
      pass: count(results, "PASS"),
      fail: count(results, "FAIL"),
      exempted: 0,
      manual: count(results, "MANUAL"),
      error: count(results, "ERROR"),
      total: results.length,
    },
    results,
    notes: [
      "This engine evaluates supplied observations and never changes a target system.",
      "Remediation entries are metadata only and are not executed by the audit engine.",
    ],
  };
  return applyExceptions(report, input.exceptions ?? [], input.evaluatedAt)
    .report;
}
