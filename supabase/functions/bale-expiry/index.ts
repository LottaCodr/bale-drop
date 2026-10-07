/**
 * bale-expiry — scheduled job (Supabase Cron, every 15 min).
 * Releases stale slot reservations, expires open splits and reconciles each
 * paid-slot refund through the same idempotent refund state machine used by
 * admin refunds.
 *
 * Also the housekeeping pass: expired rate-limit windows are pruned here so the
 * `rate_limits` table cannot grow without bound.
 */
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";
import { alert, logError, logInfo, logWarn } from "../_shared/monitor.ts";
import { deliver, refundContent } from "../_shared/notify.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET");
const PAYSTACK_SECRET = Deno.env.get("PAYSTACK_SECRET_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

type EdgeDb = SupabaseClient<any, "public">;
type Booking = {
  id: string;
  buyer_id: string;
  amount_naira: number;
  paystack_reference: string | null;
};
type Refund = {
  id: string;
  status: string;
  paystack_refund_id: string | null;
  paystack_reference: string;
  amount_naira: number;
};
type PaystackPayload = {
  status?: boolean;
  message?: string;
  data?: Record<string, unknown> | Record<string, unknown>[];
};
type PaystackResult = {
  ok: boolean;
  httpStatus: number;
  payload: PaystackPayload | null;
};

function statusOf(payload: PaystackPayload | null): string {
  return String(
    (payload?.data as Record<string, unknown> | undefined)?.status ?? "",
  ).toLowerCase().replaceAll("-", "_");
}

async function paystack(
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
): Promise<PaystackResult> {
  if (!PAYSTACK_SECRET) {
    throw new Error("PAYSTACK_SECRET_KEY is not configured");
  }
  const response = await fetch(`https://api.paystack.co${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => null) as
    | PaystackPayload
    | null;
  return {
    ok: response.ok && payload?.status === true,
    httpStatus: response.status,
    payload,
  };
}

async function listRefundsForTransaction(
  reference: string,
): Promise<PaystackResult> {
  const transaction = await paystack(
    `/transaction/verify/${encodeURIComponent(reference)}`,
    "GET",
  );
  if (!transaction.ok && transaction.httpStatus !== 404) {
    throw new Error(
      transaction.payload?.message ||
        "Could not verify the original transaction",
    );
  }
  const transactionId = String(
    (transaction.payload?.data as Record<string, unknown> | undefined)?.id ??
      reference,
  );
  return paystack(
    `/refund?transaction=${encodeURIComponent(transactionId)}&perPage=50`,
    "GET",
  );
}

async function reconcileRefund(db: EdgeDb, booking: Booking) {
  if (!booking.paystack_reference) {
    throw new Error(`booking ${booking.id} has no Paystack reference`);
  }
  const { data: claim, error: claimError } = await (db as any).rpc(
    "claim_bale_refund",
    { p_booking_id: booking.id },
  );
  if (claimError) throw claimError;
  const claimRow = (claim ?? {}) as {
    refund_id?: string;
    duplicate?: boolean;
    claimed?: boolean;
    retry_after_seconds?: number;
    paystack_refund_id?: string | null;
  };
  if (!claimRow.refund_id) {
    throw new Error("bale refund record was not created");
  }
  if (claimRow.claimed === false) {
    return {
      booking_id: booking.id,
      status: "processing",
      retry_after_seconds: claimRow.retry_after_seconds ?? 900,
    };
  }
  const { data: refundRow, error: refundError } = await (db as any).from(
    "bale_refunds",
  ).select("id, status, paystack_refund_id, paystack_reference, amount_naira")
    .eq("id", claimRow.refund_id).single();
  if (refundError) throw refundError;
  const refund = refundRow as Refund;

  let provider: PaystackPayload | null = null;
  let providerId = refund.paystack_refund_id;
  if (providerId) {
    const verified = await paystack(
      `/refund/${encodeURIComponent(providerId)}`,
      "GET",
    );
    if (verified.ok) provider = verified.payload;
    else if (verified.httpStatus !== 404) {
      throw new Error(
        verified.payload?.message || "Could not verify slot refund",
      );
    }
  }
  if (!provider) {
    const listed = await listRefundsForTransaction(refund.paystack_reference);
    if (!listed.ok && listed.httpStatus !== 404) {
      throw new Error(listed.payload?.message || "Could not list slot refunds");
    }
    const rows = Array.isArray(listed.payload?.data) ? listed.payload.data : [];
    const found = rows[0];
    if (found) {
      provider = { status: true, data: found as Record<string, unknown> };
      providerId = String((found as Record<string, unknown>).id ?? "") ||
        providerId;
    }
  }
  if (provider && statusOf(provider) === "failed") {
    provider = null;
    providerId = null;
  }
  if (!provider) {
    const initiated = await paystack("/refund", "POST", {
      transaction: refund.paystack_reference,
      amount: refund.amount_naira * 100,
      currency: "NGN",
      customer_note: "Bale Drop split expired",
      merchant_note: `Bale Drop split refund ${booking.id}`,
    });
    if (!initiated.ok) {
      const message = initiated.payload?.message || "Paystack refund failed";
      await (db as any).rpc("settle_bale_refund", {
        p_refund_id: refund.id,
        p_status: "failed",
        p_paystack_refund_id: null,
        p_error: message,
      });
      // A buyer is owed money and the provider refused. This is the single most
      // important thing an operator can be paged about.
      logError("bale-expiry", new Error(message), {
        scope: "refund",
        booking_id: booking.id,
      });
      await alert("bale-expiry", "a split refund was rejected by Paystack", {
        booking_id: booking.id,
        amount_naira: refund.amount_naira,
        reason: message,
      });
      await deliver(
        db as any,
        { profileId: booking.buyer_id },
        refundContent(
          refund.amount_naira,
          "The split did not fill in time. Our team is completing this refund manually and will update you.",
          refund.paystack_reference,
        ),
      );
      return { booking_id: booking.id, status: "failed", error: message };
    }
    if (!initiated.payload) {
      throw new Error("Paystack returned an empty refund payload");
    }
    provider = initiated.payload;
    providerId = String(
      (provider.data as Record<string, unknown> | undefined)?.id ?? "",
    ) || providerId;
  }

  const status = statusOf(provider);
  const nextStatus =
    ["processed", "processing", "pending", "needs_attention", "failed"]
        .includes(status)
      ? status
      : "processing";
  const { error: settleError } = await (db as any).rpc("settle_bale_refund", {
    p_refund_id: refund.id,
    p_status: nextStatus,
    p_paystack_refund_id: providerId,
    p_error: nextStatus === "failed" || nextStatus === "needs_attention"
      ? nextStatus
      : null,
  });
  if (settleError) throw settleError;

  // The in-app row is written by `settle_bale_refund`; this is the out-of-app
  // copy so the buyer learns about their money without opening the site.
  if (nextStatus === "processed") {
    await deliver(
      db as any,
      { profileId: booking.buyer_id },
      refundContent(
        refund.amount_naira,
        "The Bale Split did not fill before its deadline.",
        refund.paystack_reference,
      ),
    );
  } else if (nextStatus === "failed" || nextStatus === "needs_attention") {
    await alert("bale-expiry", "a split refund needs attention", {
      booking_id: booking.id,
      amount_naira: refund.amount_naira,
      status: nextStatus,
    });
  }

  return { booking_id: booking.id, status: nextStatus };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }
  if (!SUPABASE_URL || !SERVICE_KEY || !PAYSTACK_SECRET) {
    return new Response("expiry service is not configured", { status: 503 });
  }

  const db: EdgeDb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const { data: paymentExpiry, error: paymentExpiryError } = await (db as any)
    .rpc(
      "expire_uninitialized_payment_sessions",
      { p_age_minutes: 30 },
    );
  if (paymentExpiryError) {
    logError("bale-expiry", paymentExpiryError, { scope: "payment-expiry" });
    await alert("bale-expiry", "payment-session expiry failed", {
      reason: paymentExpiryError.message,
    });
  }

  // Housekeeping: drop rate-limit windows that can no longer be hit.
  const { data: pruned, error: pruneError } = await (db as any).rpc(
    "prune_rate_limits",
    { p_older_than_minutes: 180 },
  );
  if (pruneError) {
    logWarn("bale-expiry", "rate-limit pruning failed", {
      reason: pruneError.message,
    });
  }
  const prunedRows = (pruned as { pruned?: number } | null)?.pruned ?? 0;

  // Failed checkout rollback can leave a cancelled order with
  // inventory_released=false if a single release call timed out. Retry the
  // idempotent database repair before processing bale expiry.
  const { data: stuckOrders } = await db
    .from("orders")
    .select("id")
    .eq("status", "cancelled")
    .eq("inventory_released", false)
    .limit(100);
  const inventoryRecovery = await Promise.allSettled(
    (stuckOrders ?? []).map((order: { id: string }) =>
      (db as any).rpc("restore_order_inventory", { p_order_id: order.id })
    ),
  );

  const { data: staleReservations } = await db
    .from("bale_bookings")
    .select("bale_id")
    .eq("status", "pending")
    .not("reserved_until", "is", null)
    .lt("reserved_until", new Date().toISOString());
  const staleBaleIds = [
    ...new Set(
      (staleReservations ?? []).map((row: { bale_id: string }) => row.bale_id),
    ),
  ];
  if (staleBaleIds.length) {
    await Promise.all(
      staleBaleIds.map((baleId) =>
        (db as any).rpc("release_expired_bale_reservations", {
          p_bale_id: baleId,
        })
      ),
    );
  }

  // Include already-expired listings so a crash or a transient Paystack
  // failure after the listing transition does not strand paid bookings.
  const { data: expired, error } = await db
    .from("bale_listings")
    .select("id")
    .in("status", ["open", "expired"])
    .lt("expires_at", new Date().toISOString())
    .limit(100);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    });
  }
  if (!expired || expired.length === 0) {
    logInfo("bale-expiry", "nothing to expire", {
      inventory_recovery: inventoryRecovery.length,
      rate_limit_rows_pruned: prunedRows,
    });
    return new Response(
      JSON.stringify({
        expired: 0,
        refunds: [],
        payment_expiry: paymentExpiry ??
          { error: paymentExpiryError?.message ?? null },
        inventory_recovery: inventoryRecovery.length,
        rate_limit_rows_pruned: prunedRows,
      }),
      { status: 200 },
    );
  }

  const results = await Promise.allSettled(
    expired.map(async (bale: { id: string }) => {
      const { error: expireError } = await db.from("bale_listings").update({
        status: "expired",
      }).eq("id", bale.id).eq("status", "open");
      if (expireError) throw expireError;
      const { data: bookings, error: bookingsError } = await db.from(
        "bale_bookings",
      ).select("id, buyer_id, amount_naira, paystack_reference").eq(
        "bale_id",
        bale.id,
      ).eq("status", "paid");
      if (bookingsError) throw bookingsError;
      const refunds = await Promise.allSettled(
        (bookings ?? []).map((booking) =>
          reconcileRefund(db, booking as Booking)
        ),
      );
      return { bale: bale.id, refunds };
    }),
  );

  const rejected = results.filter((result) => result.status === "rejected");
  logInfo("bale-expiry", "run complete", {
    expired: expired.length,
    failures: rejected.length,
    rate_limit_rows_pruned: prunedRows,
  });
  if (rejected.length > 0) {
    await alert("bale-expiry", "some expired splits could not be refunded", {
      failures: rejected.length,
      reason: String((rejected[0] as PromiseRejectedResult).reason).slice(0, 300),
    });
  }

  return new Response(
    JSON.stringify({
      expired: expired.length,
      results,
      payment_expiry: paymentExpiry ??
        { error: paymentExpiryError?.message ?? null },
      inventory_recovery: inventoryRecovery.length,
      rate_limit_rows_pruned: prunedRows,
    }),
    { status: 200 },
  );
});
