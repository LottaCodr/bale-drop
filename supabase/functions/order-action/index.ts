/**
 * Authenticated order operations: buyer confirmation/disputes and vendor
 * fulfillment.
 *
 * Money-relevant, so the writes stay in the database functions
 * (`confirm_order_delivery`, `open_order_dispute`,
 * `set_order_fulfillment_status`) — this file only authenticates, rate limits,
 * validates shapes, and sends the out-of-app copy that the SQL layer cannot.
 */
import { adminClient, authenticatedUser, cors, json } from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { alert, logError, logInfo } from "../_shared/monitor.ts";
import { deliver } from "../_shared/notify.ts";

type Body = {
  action?: "confirm_delivery" | "open_dispute" | "fulfillment_status";
  order_id?: string;
  reason?: string;
  description?: string;
  evidence_urls?: string[];
  /** `delivered` is allowed since migration 0023 — it starts the 48 h window. */
  status?: "processing" | "ready" | "in_transit" | "delivered";
  tracking_number?: string;
  tracking_url?: string;
};

const FULFILLMENT_STATUSES = ["processing", "ready", "in_transit", "delivered"];

/**
 * The profile that should hear about an order event. Notifications are keyed on
 * `profiles.id`, while orders reference `vendor_profiles.id`, so this hops
 * through the vendor row. Returns null rather than throwing — a missing vendor
 * must not fail the money operation that already succeeded.
 */
async function vendorProfileForOrder(
  // deno-lint-ignore no-explicit-any
  db: any,
  orderId: string,
): Promise<string | null> {
  const { data: order } = await db.from("orders")
    .select("vendor_id")
    .eq("id", orderId)
    .maybeSingle();
  const vendorId = (order as { vendor_id?: string } | null)?.vendor_id;
  if (!vendorId) return null;
  const { data: vendor } = await db.from("vendor_profiles")
    .select("profile_id")
    .eq("id", vendorId)
    .maybeSingle();
  return (vendor as { profile_id?: string } | null)?.profile_id ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: cors(req) });
  }
  if (req.method !== "POST") {
    return json(req, { error: "method not allowed" }, 405);
  }

  const db = adminClient();
  const { user, error: authError } = await authenticatedUser(req, db);
  if (!user) return json(req, { error: authError }, 401);

  const limited = await enforceRateLimit(
    req, db, "order-action", user.id, 30, 60, cors(req),
  );
  if (limited) return limited;

  try {
    const body = await req.json() as Body;
    if (!body.order_id || !body.action) {
      return json(req, { error: "action and order_id are required" }, 400);
    }

    if (body.action === "confirm_delivery") {
      const { data, error } = await db.rpc("confirm_order_delivery", {
        p_order_id: body.order_id,
        p_buyer_id: user.id,
      });
      if (error) throw error;

      // The vendor's payout is queued by the RPC; make sure they hear about it
      // outside the app too, since a queued payout is money they are waiting on.
      const vendorProfileId = await vendorProfileForOrder(db, body.order_id);
      if (vendorProfileId) {
        await deliver(db, { profileId: vendorProfileId }, {
          title: "Buyer confirmed delivery — payout queued",
          body: "Escrow has been released for this order. Your payout is queued for transfer.",
          href: "/vendor",
          email: {
            subject: "Bale Drop — buyer confirmed delivery",
            ctaLabel: "Open seller workspace",
          },
        });
      }

      logInfo("order-action", "delivery confirmed", { order_id: body.order_id });
      return json(req, { ok: true, result: data });
    }

    if (body.action === "open_dispute") {
      const reason = body.reason?.trim();
      if (!reason || reason.length > 200) {
        return json(req, {
          error: "reason is required and must be under 200 characters",
        }, 400);
      }
      const description = body.description?.trim() ?? "";
      if (description.length > 5000) {
        return json(req, {
          error: "description must be under 5,000 characters",
        }, 400);
      }
      const evidence = Array.isArray(body.evidence_urls)
        ? body.evidence_urls
        : [];
      const evidencePrefix = `${user.id}/${body.order_id}/`;
      if (
        evidence.length > 5 ||
        evidence.some((path) =>
          typeof path !== "string" || path.length > 500 ||
          !path.startsWith(evidencePrefix)
        )
      ) {
        return json(req, { error: "invalid evidence paths" }, 400);
      }
      const { data, error } = await db.rpc("open_order_dispute", {
        p_order_id: body.order_id,
        p_buyer_id: user.id,
        p_reason: reason,
        p_description: description,
        p_evidence_urls: evidence,
      });
      if (error) throw error;

      // An open dispute freezes the 48 h auto-release, so the vendor must be
      // told immediately — they would otherwise expect a payout that is now on
      // hold pending a human decision.
      const disputeVendorProfileId = await vendorProfileForOrder(db, body.order_id);
      if (disputeVendorProfileId) {
        await deliver(db, { profileId: disputeVendorProfileId }, {
          title: "A buyer opened a dispute",
          body: `Dispute reason: ${reason}. The payout for this order is on hold until our team reviews the evidence.`,
          href: "/vendor",
          email: {
            subject: "Bale Drop — dispute opened on one of your orders",
            ctaLabel: "Review the dispute",
          },
        });
      }

      logInfo("order-action", "dispute opened", {
        order_id: body.order_id,
        reason,
      });
      return json(req, { ok: true, result: data });
    }

    if (!body.status) {
      return json(req, { error: "fulfillment status is required" }, 400);
    }
    if (!FULFILLMENT_STATUSES.includes(body.status)) {
      return json(req, { error: "invalid fulfillment status" }, 400);
    }
    const { data: vendor, error: vendorError } = await db
      .from("vendor_profiles")
      .select("id")
      .eq("profile_id", user.id)
      .maybeSingle();
    if (vendorError) throw vendorError;
    if (!vendor) return json(req, { error: "vendor profile not found" }, 404);

    const { data, error } = await db.rpc("set_order_fulfillment_status", {
      p_order_id: body.order_id,
      p_vendor_profile_id: vendor.id,
      p_status: body.status,
      p_tracking_number: body.tracking_number?.trim() ?? null,
      p_tracking_url: body.tracking_url?.trim() ?? null,
    });
    if (error) throw error;

    const result = data as { status?: string; duplicate?: boolean } | null;
    logInfo("order-action", "fulfillment status set", {
      order_id: body.order_id,
      status: result?.status ?? body.status,
      duplicate: result?.duplicate === true,
    });
    return json(req, { ok: true, result: data });
  } catch (error) {
    logError("order-action", error);
    const message = error instanceof Error ? error.message : "Order action failed";
    // A failed money move is the case an operator must see; a validation
    // rejection is just a bad request.
    if (/escrow|payout|dispute|not ready|not actionable/i.test(message)) {
      await alert("order-action", "an order action was rejected", { reason: message });
    }
    return json(req, { error: message }, 400);
  }
});
