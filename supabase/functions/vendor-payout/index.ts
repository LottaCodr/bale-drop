/**
 * Admin-triggered Paystack transfer with idempotent references and
 * reconciliation.
 *
 * Money leaves the platform balance here, so every terminal outcome is logged
 * and the vendor is told out-of-app: a seller waiting on ₦93,000 should not have
 * to refresh a dashboard to learn it landed (or did not).
 */
import {
  adminClient,
  authenticatedUser,
  cors,
  json,
  profile,
} from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { alert, logError, logInfo } from "../_shared/monitor.ts";
import { deliver, naira } from "../_shared/notify.ts";

const PAYSTACK_SECRET = Deno.env.get("PAYSTACK_SECRET_KEY");

type PaystackPayload = {
  status?: boolean;
  message?: string;
  data?: Record<string, unknown>;
};
type Claim = {
  status?: string;
  claimed?: boolean;
  duplicate?: boolean;
  transfer_reference?: string | null;
  transfer_code?: string | null;
  attempts?: number;
};

type PaystackResult = {
  ok: boolean;
  httpStatus: number;
  payload: PaystackPayload | null;
};

async function paystackRequest(
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

function statusOf(payload: PaystackPayload | null): string {
  return String(payload?.data?.status ?? "").toLowerCase();
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
  const actor = await profile(db, user.id);
  if (!actor || actor.role !== "admin") {
    return json(req, { error: "admin access required" }, 403);
  }

  const limited = await enforceRateLimit(
    req, db, "vendor-payout", user.id, 60, 60, cors(req),
  );
  if (limited) return limited;

  let payoutId: string | undefined;
  let payoutAttempts = 0;
  let ownsAttempt = false;
  let ownedReference: string | null = null;
  try {
    const body = await req.json() as {
      payout_id?: string;
      force_reconcile?: boolean;
    };
    payoutId = body.payout_id;
    if (!payoutId) return json(req, { error: "payout_id is required" }, 400);

    const { data: payout, error: payoutError } = await db.from("vendor_payouts")
      .select("*").eq("id", payoutId).maybeSingle();
    if (payoutError) throw payoutError;
    if (!payout) return json(req, { error: "payout not found" }, 404);

    const { data: claimData, error: claimError } = await db.rpc(
      "claim_vendor_payout",
      {
        p_payout_id: payout.id,
        p_force: body.force_reconcile === true,
      },
    );
    if (claimError) throw claimError;
    const claim = (claimData ?? {}) as Claim;
    if (claim.status === "paid" || claim.duplicate) {
      return json(req, {
        ok: true,
        payout_id: payout.id,
        status: "paid",
        duplicate: true,
      });
    }
    ownsAttempt = claim.claimed === true;
    payoutAttempts = Number(claim.attempts ?? payout.attempts ?? 0);
    let transferReference = String(claim.transfer_reference ?? "");
    if (!transferReference) throw new Error("payout reference was not created");
    if (ownsAttempt) ownedReference = transferReference;

    const { data: vendor, error: vendorError } = await db.from(
      "vendor_profiles",
    ).select("*").eq("id", payout.vendor_id).maybeSingle();
    if (vendorError) throw vendorError;
    if (!vendor || !vendor.bank_code || !vendor.account_number) {
      await db.rpc("complete_vendor_payout_checked", {
        p_payout_id: payout.id,
        p_expected_reference: transferReference,
        p_status: "failed",
        p_transfer_code: null,
        p_error: "vendor bank details are incomplete",
      });
      if (vendor?.profile_id) {
        await deliver(db, { profileId: vendor.profile_id }, {
          title: "Payout on hold — add your bank details",
          body: "We tried to send your payout but your bank name and account number are missing or incomplete. Add them in your seller workspace and we will retry automatically.",
          href: "/vendor",
          email: {
            subject: "Bale Drop — your payout is on hold",
            details: [["Amount owed", naira(payout.net_naira)]],
            ctaLabel: "Add bank details",
          },
          sms: "Bale Drop: your payout is on hold because your bank details are incomplete. Add them in your seller workspace.",
        });
      }
      await alert("vendor-payout", "a payout could not start: bank details missing", {
        payout_id: payout.id,
        vendor_id: payout.vendor_id,
        amount_naira: payout.net_naira,
      });
      return json(req, { error: "vendor bank details are incomplete" }, 409);
    }

    // Always verify a previously persisted reference before initiating a new
    // transfer. This closes the timeout window where Paystack accepted the
    // transfer but our POST response was lost.
    const verified = await paystackRequest(
      `/transfer/verify/${encodeURIComponent(transferReference)}`,
      "GET",
    );
    if (verified.ok) {
      const verifiedStatus = statusOf(verified.payload);
      const transferCode = String(
        verified.payload?.data?.transfer_code ?? claim.transfer_code ?? "",
      ) || null;
      if (verifiedStatus === "success" || verifiedStatus === "successful") {
        const { data: settled, error: settleError } = await db.rpc(
          "complete_vendor_payout_checked",
          {
            p_payout_id: payout.id,
            p_expected_reference: transferReference,
            p_status: "paid",
            p_transfer_code: transferCode,
            p_error: null,
          },
        );
        if (settleError) throw settleError;
        const settlement = settled as
          | { conflict?: boolean; status?: string }
          | null;
        if (settlement?.conflict) {
          return json(req, {
            ok: true,
            payout_id: payout.id,
            status: settlement.status ?? "processing",
            retry: true,
          }, 202);
        }
        return json(req, {
          ok: true,
          payout_id: payout.id,
          status: "paid",
          transfer_code: transferCode,
          result: settled,
        });
      }
      if (["failed", "reversed"].includes(verifiedStatus)) {
        const { data: rotated, error: rotateError } = await db.rpc(
          "rotate_vendor_payout_reference_checked",
          {
            p_payout_id: payout.id,
            p_expected_reference: transferReference,
          },
        );
        if (rotateError) throw rotateError;
        const nextReference = rotated as {
          claimed?: boolean;
          transfer_reference?: string;
          status?: string;
        };
        if (nextReference.claimed !== true) {
          return json(req, {
            ok: true,
            payout_id: payout.id,
            status: nextReference.status ?? "processing",
            transfer_reference: nextReference.transfer_reference ??
              transferReference,
            retry: true,
          }, 202);
        }
        ownsAttempt = true;
        transferReference = String(nextReference.transfer_reference ?? "");
        ownedReference = transferReference;
      } else {
        const { error: stateError } = await db.rpc(
          "complete_vendor_payout_checked",
          {
            p_payout_id: payout.id,
            p_expected_reference: transferReference,
            p_status: "processing",
            p_transfer_code: transferCode,
            p_error: null,
          },
        );
        if (stateError) throw stateError;
        return json(req, {
          ok: true,
          payout_id: payout.id,
          status: "processing",
          transfer_code: transferCode,
          transfer_reference: transferReference,
        });
      }
    } else if (!claim.claimed) {
      // Another worker owns this processing attempt. Do not issue a second
      // POST when verification returned not-found; a later reconciliation can
      // retry with force_reconcile=true.
      return json(req, {
        error: "payout is already being reconciled",
        status: "processing",
      }, 409);
    }

    let recipient = vendor.paystack_recipient_code;
    if (!recipient) {
      const recipientResult = await paystackRequest(
        "/transferrecipient",
        "POST",
        {
          type: "nuban",
          name: vendor.account_name || vendor.shop_name,
          account_number: vendor.account_number,
          bank_code: vendor.bank_code,
          currency: "NGN",
        },
      );
      if (!recipientResult.ok) {
        throw new Error(
          recipientResult.payload?.message ||
            "Paystack recipient creation failed",
        );
      }
      recipient = String(recipientResult.payload?.data?.recipient_code ?? "");
      if (!recipient) {
        throw new Error("Paystack did not return a recipient code");
      }
      const { error: recipientSaveError } = await db.from("vendor_profiles")
        .update({ paystack_recipient_code: recipient }).eq("id", vendor.id);
      if (recipientSaveError) throw recipientSaveError;
    }

    const transferResult = await paystackRequest("/transfer", "POST", {
      source: "balance",
      amount: payout.net_naira * 100,
      recipient,
      reason: `Bale Drop payout ${payout.id.slice(0, 8)}`,
      reference: transferReference,
    });
    if (!transferResult.ok) {
      const message = transferResult.payload?.message ||
        "Paystack transfer failed";
      await db.rpc("complete_vendor_payout_checked", {
        p_payout_id: payout.id,
        p_expected_reference: transferReference,
        p_status: "failed",
        p_transfer_code: null,
        p_error: message,
      });
      logError("vendor-payout", new Error(message), {
        scope: "transfer",
        payout_id: payout.id,
      });
      await alert("vendor-payout", "a vendor transfer was rejected", {
        payout_id: payout.id,
        vendor_id: payout.vendor_id,
        amount_naira: payout.net_naira,
        reason: message,
      });
      if (vendor?.profile_id) {
        await deliver(db, { profileId: vendor.profile_id }, {
          title: "Payout delayed",
          body: `We could not complete your ${naira(payout.net_naira)} transfer yet. Your money is safe and our team is retrying it.`,
          href: "/vendor",
          email: {
            subject: `Bale Drop — your ${naira(payout.net_naira)} payout is delayed`,
            details: [["Amount", naira(payout.net_naira)], ["Reference", transferReference]],
            ctaLabel: "View payouts",
          },
        });
      }
      return json(req, {
        error: message,
        payout_id: payout.id,
        transfer_reference: transferReference,
      }, 502);
    }
    const transferCode =
      String(transferResult.payload?.data?.transfer_code ?? "") || null;
    const providerStatus = statusOf(transferResult.payload);
    const nextStatus =
      providerStatus === "success" || providerStatus === "successful"
        ? "paid"
        : "processing";
    const { data: settled, error: settleError } = await db.rpc(
      "complete_vendor_payout_checked",
      {
        p_payout_id: payout.id,
        p_expected_reference: transferReference,
        p_status: nextStatus,
        p_transfer_code: transferCode,
        p_error: null,
      },
    );
    if (settleError) throw settleError;
    const settlement = settled as
      | { conflict?: boolean; status?: string }
      | null;
    if (settlement?.conflict) {
      return json(req, {
        ok: true,
        payout_id: payout.id,
        status: settlement.status ?? "processing",
        retry: true,
      }, 202);
    }
    logInfo("vendor-payout", "transfer settled", {
      payout_id: payout.id,
      status: nextStatus,
      amount_naira: payout.net_naira,
    });
    if (nextStatus === "paid" && vendor?.profile_id) {
      // `complete_vendor_payout` writes the in-app row; this is the email/SMS
      // copy a seller can keep as their statement.
      await deliver(db, { profileId: vendor.profile_id }, {
        title: "Payout sent",
        body: `${naira(payout.net_naira)} has been sent to your bank account. Transfers usually land within a few minutes on business days.`,
        href: "/vendor",
        email: {
          subject: `Bale Drop payout — ${naira(payout.net_naira)} sent`,
          preheader: "Gross less commission. Keep this as your statement.",
          details: [
            ["Gross", naira(payout.gross_naira)],
            ["Commission", `−${naira(payout.commission_naira)}`],
            ["Net sent", naira(payout.net_naira)],
            ["Transfer reference", transferReference],
          ],
          ctaLabel: "View payouts",
        },
        sms: `Bale Drop: ${naira(payout.net_naira)} has been sent to your bank account.`,
      });
    }
    return json(req, {
      ok: true,
      payout_id: payout.id,
      status: nextStatus,
      transfer_code: transferCode,
      transfer_reference: transferReference,
      result: settled,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payout failed";
    if (payoutId && ownsAttempt && ownedReference) {
      await db.rpc("complete_vendor_payout_checked", {
        p_payout_id: payoutId,
        p_expected_reference: ownedReference,
        p_status: "failed",
        p_transfer_code: null,
        p_error: message,
      });
    }
    logError("vendor-payout", error, { payout_id: payoutId ?? null });
    await alert("vendor-payout", "a payout attempt failed", {
      payout_id: payoutId ?? null,
      attempts: payoutAttempts,
      reason: message,
    });
    return json(req, {
      error: message,
      payout_id: payoutId ?? null,
      attempts: payoutAttempts,
    }, 502);
  }
});
