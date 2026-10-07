/**
 * Rate limiting for Edge Functions (roadmap M-6 / G-4).
 *
 * Edge Functions run on many isolates, so an in-memory counter is not a limit.
 * The counter lives in Postgres (`public.rate_limits`, migration 0027) and is
 * advanced by `check_rate_limit()`, which is atomic because the upsert takes a
 * row lock. Buckets are always derived server-side from the authenticated user
 * or the request IP — never from a client-supplied string, or a caller could
 * spend somebody else's budget.
 *
 * Policy: fail *open* if the limiter itself breaks (a monitoring bug must not
 * take down payments), fail *closed* on a definitive "over limit".
 */
import type { AdminClient } from "./auth.ts";
import { logWarn } from "./monitor.ts";

export interface RateLimitVerdict {
  allowed: boolean;
  hits: number;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

const ALLOWED: RateLimitVerdict = {
  allowed: true,
  hits: 0,
  limit: 0,
  remaining: 0,
  retryAfterSeconds: 0,
};

/**
 * Consume one unit of `bucket`. `bucket` must already be namespaced
 * (e.g. `paystack-initialize:<user-id>`).
 */
export async function checkRateLimit(
  db: AdminClient,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitVerdict> {
  if (!bucket || limit < 1 || windowSeconds < 1) return ALLOWED;
  try {
    const { data, error } = await db.rpc("check_rate_limit", {
      p_bucket: bucket.slice(0, 180),
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      logWarn("rate-limit", "limiter unavailable, failing open", {
        bucket,
        reason: error.message,
      });
      return ALLOWED;
    }
    const verdict = data as Partial<RateLimitVerdict> | null;
    if (!verdict || typeof verdict.allowed !== "boolean") return ALLOWED;
    return {
      allowed: verdict.allowed,
      hits: Number(verdict.hits ?? 0),
      limit: Number(verdict.limit ?? limit),
      remaining: Number(verdict.remaining ?? 0),
      retryAfterSeconds: Number(verdict.retryAfterSeconds ?? verdict.retry_after_seconds ?? 60),
    };
  } catch (error) {
    logWarn("rate-limit", "limiter threw, failing open", {
      bucket,
      reason: error instanceof Error ? error.message : String(error),
    });
    return ALLOWED;
  }
}

/** Best-effort client IP for guest endpoints. Never trusted for identity. */
export function requestIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim().slice(0, 64) || "unknown";
  return req.headers.get("x-real-ip")?.slice(0, 64) || "unknown";
}

/**
 * Convenience wrapper: returns `null` when the caller may proceed, or a 429
 * Response (with `Retry-After` and the same CORS headers as the rest of the
 * function) when they may not.
 */
export async function enforceRateLimit(
  req: Request,
  db: AdminClient,
  scope: string,
  identity: string,
  limit: number,
  windowSeconds: number,
  corsHeaders: HeadersInit,
): Promise<Response | null> {
  const verdict = await checkRateLimit(db, `${scope}:${identity}`, limit, windowSeconds);
  if (verdict.allowed) return null;
  logWarn(scope, "rate limit exceeded", {
    identity: identity.slice(0, 64),
    hits: verdict.hits,
    limit: verdict.limit,
  });
  return new Response(
    JSON.stringify({
      error: "Too many attempts. Please wait and try again.",
      retry_after_seconds: verdict.retryAfterSeconds,
      code: "rate_limited",
    }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        "Retry-After": String(Math.max(1, verdict.retryAfterSeconds)),
      },
    },
  );
}
