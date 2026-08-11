import type {
  NotificationConfig,
  NotificationResult,
  RunSummary,
} from "./types.js";

interface NotificationDependencies {
  environment?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
}

function notificationText(summary: RunSummary): string {
  const affected = summary.results
    .filter((result) => result.status !== "COMPLIANT")
    .map((result) => `${result.target}=${result.status}`)
    .join(", ");
  return affected
    ? `Check Point baseline audit completed: ${affected}`
    : "Check Point baseline audit completed: all targets compliant";
}

export function shouldNotify(
  config: NotificationConfig,
  summary: RunSummary,
): boolean {
  return (
    config.enabled &&
    summary.results.some((result) => config.notifyOn.includes(result.status))
  );
}

export async function sendRunNotification(
  config: NotificationConfig,
  summary: RunSummary,
  dependencies: NotificationDependencies = {},
): Promise<NotificationResult> {
  if (!config.enabled) {
    return { attempted: false, delivered: false, reason: "disabled" };
  }
  if (!shouldNotify(config, summary)) {
    return { attempted: false, delivered: false, reason: "no matching status" };
  }

  const environment = dependencies.environment ?? process.env;
  const rawUrl = environment[config.webhookUrlEnvironment];
  if (!rawUrl) {
    return {
      attempted: true,
      delivered: false,
      error: `Webhook URL environment variable is not set: ${config.webhookUrlEnvironment}`,
    };
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return {
      attempted: true,
      delivered: false,
      error: "Webhook URL is invalid",
    };
  }
  if (url.protocol !== "https:") {
    return {
      attempted: true,
      delivered: false,
      error: "Webhook URL must use HTTPS",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await (dependencies.fetch ?? globalThis.fetch)(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "baseline-audit-runner",
        text: notificationText(summary),
        startedAt: summary.startedAt,
        finishedAt: summary.finishedAt,
        durationMs: summary.durationMs,
        counts: summary.counts,
        targets: summary.results.map((result) => ({
          id: result.target,
          status: result.status,
          failedControls: result.audit?.summary.fail,
          regressions: result.audit?.diff?.regressions,
        })),
      }),
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        attempted: true,
        delivered: false,
        statusCode: response.status,
        error: `Webhook returned HTTP ${response.status}`,
      };
    }
    return { attempted: true, delivered: true, statusCode: response.status };
  } catch (error) {
    const message =
      (error as Error).name === "AbortError"
        ? `Webhook timed out after ${config.timeoutMs}ms`
        : `Webhook delivery failed: ${(error as Error).message}`;
    return { attempted: true, delivered: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}
