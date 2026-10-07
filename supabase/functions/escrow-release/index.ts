/**
 * escrow-release — scheduled job (Supabase Cron, every 15 minutes).
 *
 * The other half of the escrow promise. `bale-expiry` refunds splits that never
 * filled and cancels payment attempts that never started; this one releases the
 * money a vendor has earned when a buyer simply never clicks "Confirm delivery".
 *
 * Before this function existed the 48-hour auto-release was advertised on
 * /orders, /policies/refunds and /sell but nothing implemented it, so a silent
 * buyer held a vendor's payment forever.
 *
 * Body: `release_due_escrows()` (migration 0023) — batched, `FOR UPDATE SKIP
 * LOCKED`, skips anything with an open dispute, and idempotent: an already
 * released order is a no-op.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { alert, logError, logInfo } from "../_shared/monitor.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const BATCH = 100;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: { "Access-Control-Allow-Origin": "*" } });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405 });
  }
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "escrow release is not configured" }), { status: 503 });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  try {
    const { data, error } = await db.rpc("release_due_escrows", { p_batch: BATCH });
    if (error) throw error;

    const result = data as { released?: number; errors?: number; last_error?: string | null };
    logInfo("escrow-release", "run complete", {
      released: result.released ?? 0,
      errors: result.errors ?? 0,
    });

    // Money that could not be released is exactly the case a human must see.
    if ((result.errors ?? 0) > 0) {
      await alert("escrow-release", "some due escrow could not be released", {
        errors: result.errors ?? 0,
        last_error: result.last_error ?? "unknown",
      });
    }

    // Housekeeping while the cron is warm: expired rate-limit windows.
    const { data: pruned, error: pruneError } = await db.rpc("prune_rate_limits", {
      p_older_than_minutes: 180,
    });
    if (pruneError) {
      logError("escrow-release", pruneError.message);
    }

    return new Response(
      JSON.stringify({
        released: result.released ?? 0,
        errors: result.errors ?? 0,
        rate_limit_rows_pruned: (pruned as { pruned?: number } | null)?.pruned ?? 0,
        ran_at: new Date().toISOString(),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    logError("escrow-release", error);
    await alert("escrow-release", "the escrow release job failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "release failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
