/**
 * paystack-webhook — the only entrypoint that marks money as paid.
 *
 * Paystack signs the raw request body with HMAC SHA-512. After verification,
 * the function calls the locked `finalize_payment_session` database function;
 * that function checks the server-created amount, promotes the order/booking,
 * sets escrow to held, and writes idempotent transaction rows.
 *
 * Secrets: PAYSTACK_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PAYSTACK_SECRET = Deno.env.get("PAYSTACK_SECRET_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

type PaystackData = {
  reference?: string;
  amount?: number;
  currency?: string;
  status?: string;
  id?: number | string;
  channel?: string;
  gateway_response?: string;
  transfer_code?: string;
  refund_reference?: string;
  transaction_reference?: string;
  metadata?: unknown;
  [key: string]: unknown;
};

type PaystackEvent = { event?: string; data?: PaystackData };

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return mismatch === 0;
}

async function validSignature(
  raw: string,
  signature: string | null,
): Promise<boolean> {
  if (!PAYSTACK_SECRET || !signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(PAYSTACK_SECRET),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(raw),
  );
  return constantTimeEqual(toHex(mac), signature.trim().toLowerCase());
}

function response(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return response("method not allowed", 405);
  if (!SUPABASE_URL || !SERVICE_KEY || !PAYSTACK_SECRET) {
    return response("webhook is not configured", 503);
  }

  const raw = await req.text();
  if (!(await validSignature(raw, req.headers.get("x-paystack-signature")))) {
    console.error("paystack-webhook: invalid signature");
    return response("invalid signature", 401);
  }

  let event: PaystackEvent;
  try {
    event = JSON.parse(raw) as PaystackEvent;
  } catch {
    return response("invalid JSON", 400);
  }

  const reference = String(event.data?.reference ?? "");
  if (!reference) return response("no reference", 200);

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });
  const eventName = event.event ?? "";

  // Transfer events settle vendor payouts after the buyer has released escrow.
  if (
    ["transfer.success", "transfer.failed", "transfer.reversed"].includes(
      eventName,
    )
  ) {
    const transferCode = String(event.data?.transfer_code ?? "");
    const transferReference = String(event.data?.reference ?? "");
    const { data: payout } = transferCode
      ? await db.from("vendor_payouts").select(
        "id, paystack_transfer_reference",
      ).eq("paystack_transfer_code", transferCode).maybeSingle()
      : transferReference
      ? await db.from("vendor_payouts").select(
        "id, paystack_transfer_reference",
      ).eq("paystack_transfer_reference", transferReference).maybeSingle()
      : { data: null };
    if (payout?.id) {
      const nextStatus = eventName === "transfer.success" ? "paid" : "failed";
      const { error: settleError } = await db.rpc(
        "complete_vendor_payout_checked",
        {
          p_payout_id: payout.id,
          p_expected_reference: payout.paystack_transfer_reference ??
            transferReference,
          p_status: nextStatus,
          p_transfer_code: transferCode || null,
          p_error: nextStatus === "failed" ? eventName : null,
        },
      );
      if (settleError) {
        console.error(
          "paystack-webhook: payout reconciliation failed",
          settleError.message,
        );
        return response("payout reconciliation failed", 500);
      }
    }
    return response("ok", 200);
  }

  const refundEvents = [
    "refund.pending",
    "refund.processing",
    "refund.needs-attention",
    "refund.failed",
    "refund.processed",
  ];
  if (refundEvents.includes(eventName)) {
    const transactionReference = String(
      event.data?.transaction_reference ?? "",
    );
    const refundReference = String(
      event.data?.refund_reference ?? event.data?.id ?? "",
    );
    const orderRefundQuery = transactionReference
      ? await db.from("order_refunds").select("id").eq(
        "paystack_reference",
        transactionReference,
      ).maybeSingle()
      : refundReference
      ? await db.from("order_refunds").select("id").eq(
        "paystack_refund_id",
        refundReference,
      ).maybeSingle()
      : { data: null };
    const baleRefundQuery = !orderRefundQuery.data?.id
      ? transactionReference
        ? await db.from("bale_refunds").select("id").eq(
          "paystack_reference",
          transactionReference,
        ).maybeSingle()
        : refundReference
        ? await db.from("bale_refunds").select("id").eq(
          "paystack_refund_id",
          refundReference,
        ).maybeSingle()
        : { data: null }
      : { data: null };
    const nextStatus = eventName === "refund.processed"
      ? "processed"
      : eventName === "refund.failed"
      ? "failed"
      : eventName === "refund.needs-attention"
      ? "needs_attention"
      : eventName === "refund.pending"
      ? "pending"
      : "processing";
    if (orderRefundQuery.data?.id) {
      const { error: settleError } = await db.rpc("settle_order_refund", {
        p_refund_id: orderRefundQuery.data.id,
        p_status: nextStatus,
        p_paystack_refund_id: refundReference || null,
        p_error: nextStatus === "failed" || nextStatus === "needs_attention"
          ? eventName
          : null,
      });
      if (settleError) {
        console.error(
          "paystack-webhook: order refund reconciliation failed",
          settleError.message,
        );
        return response("refund reconciliation failed", 500);
      }
    } else if (baleRefundQuery.data?.id) {
      const { error: settleError } = await db.rpc("settle_bale_refund", {
        p_refund_id: baleRefundQuery.data.id,
        p_status: nextStatus,
        p_paystack_refund_id: refundReference || null,
        p_error: nextStatus === "failed" || nextStatus === "needs_attention"
          ? eventName
          : null,
      });
      if (settleError) {
        console.error(
          "paystack-webhook: bale refund reconciliation failed",
          settleError.message,
        );
        return response("refund reconciliation failed", 500);
      }
    }
    return response("ok", 200);
  }

  // Only successful charges can move money into escrow. Failed/abandoned
  // events are recorded as a terminal attempt but never touch order money.
  if (eventName !== "charge.success") {
    if (
      ["charge.failed", "charge.abandoned", "transaction.failed"].includes(
        eventName,
      )
    ) {
      const { error: cancelError } = await db.rpc("cancel_payment_session", {
        p_reference: reference,
        p_reason: eventName,
      });
      if (cancelError) {
        console.error(
          "paystack-webhook: failed-session recovery",
          reference,
          cancelError.message,
        );
      }
    }
    console.log(`paystack-webhook: acknowledged ${eventName} ${reference}`);
    return response("ok", 200);
  }

  const amountKobo = Number(event.data?.amount ?? 0);
  const amountNaira = Math.round(amountKobo / 100);
  const currency = String(event.data?.currency ?? "NGN");
  if (
    !Number.isSafeInteger(amountKobo) || amountKobo <= 0 || currency !== "NGN"
  ) {
    console.error("paystack-webhook: invalid amount/currency", reference);
    return response("invalid payment payload", 422);
  }

  const { data, error } = await db.rpc("finalize_payment_session", {
    p_reference: reference,
    p_amount_naira: amountNaira,
    p_paystack_transaction_id: event.data?.id == null
      ? null
      : String(event.data.id),
    p_channel: event.data?.channel == null ? null : String(event.data.channel),
    p_gateway_response: event.data?.gateway_response == null
      ? null
      : String(event.data.gateway_response),
    p_event: event,
  });

  if (error) {
    // Returning non-200 lets Paystack retry transient delivery/database errors.
    // Signature-valid but mismatched payments stay out of escrow until an
    // operator reconciles them; never silently mark them paid.
    console.error(
      "paystack-webhook: finalization failed",
      reference,
      error.message,
    );
    return response("finalization failed", 500);
  }

  console.log("paystack-webhook: finalized", reference, data);
  return response("ok", 200);
});
