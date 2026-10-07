/**
 * Structured logging + alerting for Edge Functions (roadmap M-7 / G-5).
 *
 * Supabase ships function stdout to Logs, so the contract here is: one JSON
 * object per line, always with `scope` and `level`, so a log query can page a
 * human. `alert()` additionally POSTs to `ALERT_WEBHOOK_URL` (Slack, Discord,
 * PagerDuty, Healthchecks — anything that accepts a JSON body) for the events
 * where "we will notice tomorrow" is not acceptable:
 *
 *   - a Paystack webhook that fails signature verification,
 *   - a webhook that verifies but cannot finalize (money is at stake),
 *   - a refund or transfer that ends in `failed`,
 *   - any uncaught error in a money function.
 *
 * Nothing here throws. Monitoring must never be the reason a payment fails.
 */

export type LogLevel = "info" | "warn" | "error" | "fatal";

const ALERT_WEBHOOK_URL = Deno.env.get("ALERT_WEBHOOK_URL");
const SITE_URL = Deno.env.get("SITE_URL") ?? "unknown";

export interface LogMeta {
  [key: string]: string | number | boolean | null | undefined;
}

function safeMeta(meta: LogMeta | undefined): LogMeta {
  const out: LogMeta = {};
  if (!meta) return out;
  for (const [key, value] of Object.entries(meta)) {
    // Never leak a secret or a raw JWT into logs.
    if (/secret|key|token|authorization|password/i.test(key)) continue;
    if (typeof value === "string") out[key] = value.slice(0, 300);
    else if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) {
      out[key] = value;
    }
  }
  return out;
}

export function log(
  scope: string,
  level: LogLevel,
  message: string,
  meta?: LogMeta,
): void {
  try {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        scope,
        message,
        site: SITE_URL,
        ...safeMeta(meta),
      }),
    );
  } catch {
    console.log(`${level} ${scope}: ${message}`);
  }
}

export function logInfo(scope: string, message: string, meta?: LogMeta): void {
  log(scope, "info", message, meta);
}

export function logWarn(scope: string, message: string, meta?: LogMeta): void {
  log(scope, "warn", message, meta);
}

export function logError(scope: string, error: unknown, meta?: LogMeta): void {
  log(scope, "error", error instanceof Error ? error.message : String(error), {
    ...meta,
    stack: error instanceof Error ? (error.stack ?? "").slice(0, 1200) : undefined,
  });
}

/**
 * Page a human. Fire-and-forget with a short timeout: an alerting endpoint that
 * hangs must not extend the lifetime of a webhook invocation.
 */
export async function alert(
  scope: string,
  message: string,
  meta?: LogMeta,
): Promise<void> {
  log(scope, "fatal", message, meta);
  if (!ALERT_WEBHOOK_URL) return;
  try {
    await fetch(ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope,
        message,
        severity: "critical",
        site: SITE_URL,
        at: new Date().toISOString(),
        ...safeMeta(meta),
      }),
      signal: AbortSignal.timeout(4000),
    });
  } catch (error) {
    // The structured log line above is still emitted, so the failure is visible
    // in Supabase Logs even when the alert channel itself is down.
    log(scope, "warn", "alert delivery failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}
