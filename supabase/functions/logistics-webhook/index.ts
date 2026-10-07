/**
 * Provider-neutral logistics webhook. A real courier adapter can forward its
 * signed status events here; order state remains service-role/RPC controlled.
 *
 * `delivered` is applied through `set_order_fulfillment_status` (migration
 * 0023): it stamps `delivered_at` and starts the 48-hour escrow release window,
 * but it never moves money. The vendor is paid either when the buyer confirms,
 * or when the `escrow-release` cron settles the window — and never while a
 * dispute is open.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { alert, logError, logInfo, logWarn } from "../_shared/monitor.ts";

const WEBHOOK_SECRET = Deno.env.get("LOGISTICS_WEBHOOK_SECRET");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

type EventBody = {
  event_id?: string;
  provider?: string;
  order_id?: string;
  status?: string;
  tracking_number?: string;
  tracking_url?: string;
  payload?: Record<string, unknown>;
};

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function equal(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function validSignature(
  raw: string,
  supplied: string | null,
): Promise<boolean> {
  if (!WEBHOOK_SECRET || !supplied) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(raw),
  );
  return equal(hex(digest), supplied.trim().toLowerCase());
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function normalizeStatus(
  status: string,
): "processing" | "ready" | "in_transit" | "delivered" | null {
  const normalized = status.trim().toLowerCase().replaceAll("-", "_")
    .replaceAll(" ", "_");
  if (["processing", "accepted", "picked_up"].includes(normalized)) {
    return "processing";
  }
  if (["ready", "packed"].includes(normalized)) return "ready";
  if (["in_transit", "dispatched", "out_for_delivery"].includes(normalized)) {
    return "in_transit";
  }
  if (["delivered", "delivery_confirmed"].includes(normalized)) {
    return "delivered";
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY || !WEBHOOK_SECRET) {
    return json({ error: "logistics webhook is not configured" }, 503);
  }

  const raw = await req.text();
  if (!(await validSignature(raw, req.headers.get("x-logistics-signature")))) {
    logWarn("logistics-webhook", "rejected an unsigned courier event", {
      bytes: raw.length,
    });
    return json({ error: "invalid signature" }, 401);
  }

  let body: EventBody;
  try {
    body = JSON.parse(raw) as EventBody;
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  const eventId = body.event_id?.trim();
  const orderId = body.order_id?.trim();
  const provider = body.provider?.trim() || "courier";
  const status = body.status ? normalizeStatus(body.status) : null;
  if (!eventId || eventId.length > 180 || !orderId || !status) {
    return json({
      error: "event_id, order_id and a supported status are required",
    }, 400);
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });
  const externalEventId = `${provider}:${eventId}`;
  if (externalEventId.length > 200) {
    return json({ error: "provider and event_id are too long" }, 400);
  }
  const { data: existing, error: existingError } = await db.from(
    "fulfillment_events",
  ).select("order_id, status, tracking_number, tracking_url").eq(
    "external_event_id",
    externalEventId,
  ).maybeSingle();
  if (existingError) return json({ error: existingError.message }, 500);
  if (existing) return json({ ok: true, duplicate: true, event: existing });

  const { data: order, error: orderError } = await db.from("orders").select(
    "id, vendor_id, tracking_number, tracking_url",
  ).eq("id", orderId).maybeSingle();
  if (orderError) return json({ error: orderError.message }, 500);
  if (!order) return json({ error: "order not found" }, 404);

  const trackingNumber = body.tracking_number?.trim() ||
    order.tracking_number || null;
  const trackingUrl = body.tracking_url?.trim() || order.tracking_url || null;
  const { error: eventError } = await db.from("fulfillment_events").insert({
    order_id: order.id,
    provider,
    external_event_id: externalEventId,
    status,
    tracking_number: trackingNumber,
    tracking_url: trackingUrl,
    payload: body.payload ?? body,
  });
  if (eventError) {
    const { data: raceWinner } = await db.from("fulfillment_events").select(
      "order_id, status, tracking_number, tracking_url",
    ).eq("external_event_id", externalEventId).maybeSingle();
    if (raceWinner) {
      return json({ ok: true, duplicate: true, event: raceWinner });
    }
    return json({ error: eventError.message }, 500);
  }

  // Every status — including `delivered` — goes through the same RPC, so the
  // timeline, the buyer notification and the release window are written by SQL
  // in one transaction instead of being reconstructed here.
  const { data: stateResult, error: stateError } = await db.rpc(
    "set_order_fulfillment_status",
    {
      p_order_id: order.id,
      p_vendor_profile_id: order.vendor_id,
      p_status: status,
      p_tracking_number: trackingNumber,
      p_tracking_url: trackingUrl,
    },
  );
  if (stateError) {
    logError("logistics-webhook", stateError, {
      order_id: order.id,
      status,
      scope: "fulfillment",
    });
    await db.from("fulfillment_events").delete().eq(
      "external_event_id",
      externalEventId,
    );
    // An order that is already refunded/cancelled/disputed is a normal race with
    // a courier replay, not an incident — but it must not be silently dropped.
    if (/not actionable|backwards/i.test(stateError.message)) {
      return json({
        ok: false,
        order_id: order.id,
        status,
        skipped: stateError.message,
      }, 409);
    }
    await alert("logistics-webhook", "a courier event could not be applied", {
      order_id: order.id,
      status,
      reason: stateError.message,
    });
    return json({ error: stateError.message }, 409);
  }

  const applied = stateResult as
    | { status?: string; escrow_release_at?: string; duplicate?: boolean }
    | null;
  logInfo("logistics-webhook", "courier event applied", {
    order_id: order.id,
    status,
    duplicate: applied?.duplicate === true,
    escrow_release_at: applied?.escrow_release_at ?? null,
  });

  return json({
    ok: true,
    order_id: order.id,
    status,
    tracking_number: trackingNumber,
    // Delivery starts the clock; it does not pay the vendor.
    escrow_release_at: applied?.escrow_release_at ?? null,
    buyer_confirmation_required: status === "delivered",
  });
});
