import { NextResponse } from "next/server";
import { supabaseServer } from "@bale-drop/database";
import { cookies } from "next/headers";
import { isSupabaseLive } from "@/lib/config";

/**
 * `GET /api/health` — the endpoint a load balancer, uptime monitor or the
 * launch checklist calls before/after a deploy.
 *
 * Reports *capability*, not just "200 OK":
 *  - `mode: "unavailable"` means the backend is not configured. Customer
 *    transactions are disabled and the catalog is not populated with sample data.
 *  - `mode: "live"` probes the database with a cheap, RLS-visible read.
 *
 * Never returns secrets, counts of private rows, or stack traces.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  const live = isSupabaseLive();

  if (!live) {
    return NextResponse.json(
      {
        status: "degraded",
        mode: "unavailable",
        reason: "The backend is not configured. Commerce and account features are unavailable.",
        checks: { database: "not_configured", payments: "not_configured" },
        tookMs: Date.now() - startedAt,
        time: new Date().toISOString(),
      },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }

  let database: "ok" | "error" = "error";
  try {
    const store = await cookies();
    const sb = supabaseServer({ getAll: () => store.getAll(), set: () => undefined });
    // Cheapest possible RLS-safe read: an active listing count.
    const { error } = await sb.from("products").select("id", { count: "exact", head: true }).eq("status", "active");
    database = error ? "error" : "ok";
  } catch {
    database = "error";
  }

  const healthy = database === "ok";
  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      mode: "live",
      // Edge Functions hold the Paystack secret; the web app only knows whether
      // it can reach the database and how the money path is expected to run.
      checks: { database, payments: "edge_functions" },
      tookMs: Date.now() - startedAt,
      time: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503, headers: { "cache-control": "no-store" } }
  );
}
