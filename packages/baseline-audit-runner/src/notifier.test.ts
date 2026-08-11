import assert from "node:assert/strict";
import test from "node:test";
import { sendRunNotification } from "./notifier.js";
import type { NotificationConfig, RunSummary } from "./types.js";

const config: NotificationConfig = {
  enabled: true,
  webhookUrlEnvironment: "TEST_WEBHOOK_URL",
  notifyOn: ["NON_COMPLIANT", "REGRESSION", "PARTIAL", "ERROR"],
  timeoutMs: 1000,
};

function summary(status: "COMPLIANT" | "NON_COMPLIANT"): RunSummary {
  return {
    startedAt: "2026-07-16T00:00:00.000Z",
    finishedAt: "2026-07-16T00:00:01.000Z",
    durationMs: 1000,
    counts: {
      COMPLIANT: status === "COMPLIANT" ? 1 : 0,
      NON_COMPLIANT: status === "NON_COMPLIANT" ? 1 : 0,
      REGRESSION: 0,
      PARTIAL: 0,
      ERROR: 0,
    },
    results: [
      {
        target: "gw-1",
        status,
        startedAt: "2026-07-16T00:00:00.000Z",
        finishedAt: "2026-07-16T00:00:01.000Z",
        durationMs: 1000,
        attempts: 1,
        audit: {
          target: "gw-1",
          summary: {
            pass: 8,
            fail: status === "NON_COMPLIANT" ? 1 : 0,
            exempted: 0,
            manual: 0,
            error: 0,
            total: 9,
          },
        },
      },
    ],
  };
}

test("skips delivery when no configured status matches", async () => {
  const result = await sendRunNotification(config, summary("COMPLIANT"));
  assert.deepEqual(result, {
    attempted: false,
    delivered: false,
    reason: "no matching status",
  });
});

test("fails closed when the webhook variable is missing or not HTTPS", async () => {
  const missing = await sendRunNotification(config, summary("NON_COMPLIANT"), {
    environment: {},
  });
  assert.equal(missing.attempted, true);
  assert.match(missing.error ?? "", /not set/);

  const insecure = await sendRunNotification(config, summary("NON_COMPLIANT"), {
    environment: { TEST_WEBHOOK_URL: "http://example.test/hook" },
  });
  assert.match(insecure.error ?? "", /HTTPS/);
});

test("posts a minimal summary without audit evidence", async () => {
  let body = "";
  const result = await sendRunNotification(config, summary("NON_COMPLIANT"), {
    environment: { TEST_WEBHOOK_URL: "https://example.test/hook" },
    fetch: async (_input, init) => {
      body = String(init?.body);
      return new Response(null, { status: 204 });
    },
  });

  assert.deepEqual(result, {
    attempted: true,
    delivered: true,
    statusCode: 204,
  });
  const payload = JSON.parse(body) as Record<string, unknown>;
  assert.equal(payload.source, "baseline-audit-runner");
  assert.match(String(payload.text), /gw-1=NON_COMPLIANT/);
  assert.equal(body.includes("evidence"), false);
});
