/** Scheduled reconciliation for transfers whose POST response was ambiguous. */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CRON_SECRET = Deno.env.get("CRON_SECRET");
const PAYSTACK_SECRET = Deno.env.get("PAYSTACK_SECRET_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

type Payload = {
  status?: boolean;
  message?: string;
  data?: Record<string, unknown>;
};

async function verify(reference: string) {
  const response = await fetch(
    `https://api.paystack.co/transfer/verify/${encodeURIComponent(reference)}`,
    {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
    },
  );
  const payload = await response.json().catch(() => null) as Payload | null;
  return {
    ok: response.ok && payload?.status === true,
    httpStatus: response.status,
    payload,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }
  if (!PAYSTACK_SECRET || !SUPABASE_URL || !SERVICE_KEY) {
    return new Response("reconciliation service is not configured", {
      status: 503,
    });
  }
  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });
  const { data: payouts, error } = await db.from("vendor_payouts").select(
    "id, paystack_transfer_reference",
  ).eq("status", "processing").not("paystack_transfer_reference", "is", null)
    .limit(100);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    });
  }
  const results = await Promise.all(
    (payouts ?? []).map(
      async (payout: { id: string; paystack_transfer_reference: string }) => {
        const result = await verify(payout.paystack_transfer_reference);
        if (!result.ok) {
          return {
            id: payout.id,
            status: "not_found",
            http_status: result.httpStatus,
          };
        }
        const providerStatus = String(result.payload?.data?.status ?? "")
          .toLowerCase();
        const transferCode =
          String(result.payload?.data?.transfer_code ?? "") || null;
        const nextStatus =
          providerStatus === "success" || providerStatus === "successful"
            ? "paid"
            : ["failed", "reversed"].includes(providerStatus)
            ? "failed"
            : "processing";
        const { error: settleError } = await db.rpc(
          "complete_vendor_payout_checked",
          {
            p_payout_id: payout.id,
            p_expected_reference: payout.paystack_transfer_reference,
            p_status: nextStatus,
            p_transfer_code: transferCode,
            p_error: nextStatus === "failed" ? providerStatus : null,
          },
        );
        return {
          id: payout.id,
          status: nextStatus,
          error: settleError?.message ?? null,
        };
      },
    ),
  );
  return new Response(JSON.stringify({ checked: results.length, results }), {
    status: 200,
  });
});
