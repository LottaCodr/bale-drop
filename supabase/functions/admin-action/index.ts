/**
 * Admin-only moderation, dispute resolution and audit operations.
 *
 * Every state change here is written to `admin_audit_log` and mirrored to the
 * affected person out-of-app (email/SMS) — a rejected seller or a resolved
 * dispute is exactly the kind of news that must not wait for someone to reopen
 * the site.
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
import { deliver, disputeUpdateContent, refundContent, vendorDecisionContent } from "../_shared/notify.ts";

const PAYSTACK_SECRET = Deno.env.get("PAYSTACK_SECRET_KEY");

type Body = {
  action?:
    | "approve_vendor"
    | "reject_vendor"
    | "approve_product"
    | "reject_product"
    | "resolve_dispute"
    | "create_promo"
    | "set_promo_active";
  entity_id?: string;
  reason?: string;
  resolution?: "buyer_refund" | "vendor_release";
  /** `create_promo` only. */
  code?: string;
  amount_naira?: number;
  kind?: string;
  max_uses?: number | null;
  expires_at?: string | null;
  /** `set_promo_active` only. */
  active?: boolean;
};

/** Promo codes are a money lever: tight shape checks before anything is written. */
function normalizePromoCode(raw: string | undefined): string | null {
  const code = (raw ?? "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  return code.length >= 3 && code.length <= 40 ? code : null;
}

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

type RefundRow = {
  id: string;
  status: string;
  paystack_refund_id: string | null;
  paystack_reference: string;
  amount_naira: number;
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

function refundStatus(payload: PaystackPayload | null): string {
  return String(
    (payload?.data as Record<string, unknown> | undefined)?.status ?? "",
  ).toLowerCase().replaceAll("-", "_");
}

function refundId(payload: PaystackPayload | null): string | null {
  const value = (payload?.data as Record<string, unknown> | undefined)?.id;
  return value == null ? null : String(value);
}

async function listRefundsForTransaction(
  reference: string,
): Promise<PaystackResult> {
  // Paystack's refund-list filter is documented as the numeric transaction ID,
  // while refund creation accepts either an ID or reference. Resolve the
  // reference first, then fall back to it for older/test transactions.
  const transaction = await paystackRequest(
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
  return paystackRequest(
    `/refund?transaction=${encodeURIComponent(transactionId)}&perPage=50`,
    "GET",
  );
}

async function audit(
  db: ReturnType<typeof adminClient>,
  adminId: string,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
  note?: string,
) {
  const { error } = await db.from("admin_audit_log").insert({
    admin_id: adminId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    before_state: before,
    after_state: after,
    note: note ?? null,
  });
  if (error) throw error;
}

async function settleRefund(
  db: ReturnType<typeof adminClient>,
  refund: RefundRow,
  status: string,
  providerId: string | null,
  errorMessage: string | null,
) {
  const nextStatus =
    ["processed", "processing", "pending", "needs_attention", "failed"]
        .includes(status)
      ? status
      : "processing";
  const { data, error } = await db.rpc("settle_order_refund", {
    p_refund_id: refund.id,
    p_status: nextStatus,
    p_paystack_refund_id: providerId,
    p_error: errorMessage,
  });
  if (error) throw error;
  return data;
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
    req, db, "admin-action", user.id, 120, 60, cors(req),
  );
  if (limited) return limited;

  try {
    const body = await req.json() as Body;
    if (!body.action) {
      return json(req, { error: "action is required" }, 400);
    }
    if (body.action !== "create_promo" && !body.entity_id) {
      return json(req, { error: "entity_id is required" }, 400);
    }

    // ---------------- promo codes ----------------
    // Codes could only be created by hand in seed.sql or the Table Editor, so a
    // leaking discount had no off switch short of SQL. Creation and the
    // active flag are the only two writes; `used` stays owned by
    // reserve_promo_code / release_promo_reservation (migration 0025).
    if (body.action === "create_promo") {
      const code = normalizePromoCode(body.code);
      if (!code) {
        return json(req, { error: "a code of 3–40 letters, numbers, - or _ is required" }, 400);
      }
      const amount = Math.round(Number(body.amount_naira));
      if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) {
        return json(req, { error: "amount_naira must be between 0 and 1,000,000" }, 400);
      }
      const maxUses = body.max_uses == null || body.max_uses === ""
        ? null
        : Math.round(Number(body.max_uses));
      if (maxUses !== null && (!Number.isFinite(maxUses) || maxUses < 1)) {
        return json(req, { error: "max_uses must be a positive whole number or empty" }, 400);
      }
      let expiresAt: string | null = null;
      if (body.expires_at) {
        const parsed = Date.parse(String(body.expires_at));
        if (Number.isNaN(parsed)) {
          return json(req, { error: "expires_at is not a valid date" }, 400);
        }
        expiresAt = new Date(parsed).toISOString();
      }

      const { data: existing } = await db.from("promo_codes").select("id, code")
        .eq("code", code).maybeSingle();
      if (existing) {
        return json(req, { error: `${code} already exists` }, 409);
      }

      const kind = body.kind === "percentage" ? "percentage" : "delivery_subsidy";
      const { data: created, error: insertError } = await db.from("promo_codes")
        .insert({
          code,
          kind,
          amount_naira: amount,
          max_uses: maxUses,
          active: true,
          expires_at: expiresAt,
        })
        .select("*")
        .single();
      if (insertError) throw insertError;
      await audit(db, user.id, "create_promo", "promo_code", created.id, null, created, body.reason);
      logInfo("admin-action", "promo created", { code, amount_naira: amount, max_uses: maxUses });
      return json(req, { ok: true, result: created });
    }

    if (body.action === "set_promo_active") {
      const { data: before, error: readError } = await db.from("promo_codes")
        .select("*").eq("id", body.entity_id!).maybeSingle();
      if (readError) throw readError;
      if (!before) return json(req, { error: "promo code not found" }, 404);
      const active = body.active !== false;
      const { data: after, error } = await db.from("promo_codes")
        .update({ active }).eq("id", before.id).select("*").single();
      if (error) throw error;
      await audit(db, user.id, active ? "activate_promo" : "deactivate_promo", "promo_code", before.id, before, after, body.reason);
      logInfo("admin-action", active ? "promo activated" : "promo deactivated", {
        code: before.code,
      });
      return json(req, { ok: true, result: after });
    }

    if (body.action === "approve_vendor" || body.action === "reject_vendor") {
      const { data: before, error: readError } = await db.from(
        "vendor_profiles",
      ).select("*").eq("id", body.entity_id).maybeSingle();
      if (readError) throw readError;
      if (!before) return json(req, { error: "vendor not found" }, 404);
      const approved = body.action === "approve_vendor";
      const { data: after, error } = await db.from("vendor_profiles").update({
        verification_status: approved ? "approved" : "rejected",
        rejection_reason: approved
          ? null
          : (body.reason?.trim() || "Documents need another review"),
        subscription_status: approved ? "active" : "inactive",
      }).eq("id", body.entity_id).select("*").single();
      if (error) throw error;
      await audit(
        db,
        user.id,
        body.action,
        "vendor_profile",
        body.entity_id,
        before,
        after,
        body.reason,
      );
      await db.from("notifications").insert({
        profile_id: before.profile_id,
        title: approved
          ? "Vendor application approved"
          : "Vendor application needs changes",
        body: approved
          ? "Your shop can now submit listings for moderation."
          : (body.reason?.trim() ||
            "Please review your documents and resubmit."),
        href: "/vendor",
      });
      // The in-app row above is the durable record; this is the copy that
      // reaches a seller who is not looking at the dashboard.
      await deliver(
        db,
        { profileId: before.profile_id },
        vendorDecisionContent(approved ? "approved" : "rejected", body.reason),
      );
      logInfo("admin-action", "vendor decision recorded", {
        vendor_id: body.entity_id,
        decision: approved ? "approved" : "rejected",
      });
      return json(req, { ok: true, result: after });
    }

    if (body.action === "approve_product" || body.action === "reject_product") {
      const { data: before, error: readError } = await db.from("products")
        .select("*").eq("id", body.entity_id).maybeSingle();
      if (readError) throw readError;
      if (!before) return json(req, { error: "product not found" }, 404);
      const approved = body.action === "approve_product";
      const { data: after, error } = await db.from("products").update({
        status: approved ? "active" : "rejected",
      }).eq("id", body.entity_id).select("*").single();
      if (error) throw error;
      await audit(
        db,
        user.id,
        body.action,
        "product",
        body.entity_id,
        before,
        after,
        body.reason,
      );
      const { data: vendor } = await db.from("vendor_profiles").select(
        "profile_id",
      ).eq("id", before.vendor_id).maybeSingle();
      if (vendor) {
        await db.from("notifications").insert({
          profile_id: vendor.profile_id,
          title: approved ? "Listing is live" : "Listing needs changes",
          body: approved
            ? `${before.title} is now visible to buyers.`
            : (body.reason?.trim() ||
              "Please update the listing and resubmit."),
          href: "/vendor",
        });
        await deliver(db, { profileId: vendor.profile_id }, {
          title: approved ? "Listing is live" : "Listing needs changes",
          body: approved
            ? `${before.title} is now visible to buyers.`
            : (body.reason?.trim() || "Please update the listing and resubmit."),
          href: "/vendor",
          email: {
            subject: approved
              ? `Bale Drop — "${before.title}" is live`
              : `Bale Drop — "${before.title}" needs changes`,
            ctaLabel: "Open seller workspace",
          },
        });
      }
      logInfo("admin-action", "listing decision recorded", {
        product_id: body.entity_id,
        decision: approved ? "approved" : "rejected",
      });
      return json(req, { ok: true, result: after });
    }

    const { data: dispute, error: disputeError } = await db.from("disputes")
      .select("*").eq("id", body.entity_id).maybeSingle();
    if (disputeError) throw disputeError;
    if (!dispute) return json(req, { error: "dispute not found" }, 404);
    if (dispute.status !== "open" && dispute.status !== "under_review") {
      return json(req, { error: "dispute is already resolved" }, 409);
    }
    if (
      !body.resolution ||
      !["buyer_refund", "vendor_release"].includes(body.resolution)
    ) return json(req, { error: "invalid resolution" }, 400);

    const { data: order, error: orderError } = await db.from("orders").select(
      "*",
    ).eq("id", dispute.order_id).maybeSingle();
    if (orderError) throw orderError;
    if (!order) return json(req, { error: "disputed order not found" }, 404);

    if (body.resolution === "buyer_refund") {
      // A legacy refund may already have moved the order to refunded before
      // the reconciliation migration. Repair the local state without calling
      // Paystack a second time.
      if (order.status === "refunded" && order.escrow_status === "refunded") {
        if (!order.inventory_released) {
          const { error: recoveryError } = await db.rpc(
            "restore_order_inventory",
            { p_order_id: order.id },
          );
          if (recoveryError) throw recoveryError;
        }
        await db.from("disputes").update({
          status: "resolved_buyer",
          resolution_note: body.reason?.trim() || "Refund already processed",
        }).eq("id", dispute.id);
        await audit(
          db,
          user.id,
          "resolve_dispute",
          "dispute",
          dispute.id,
          { dispute, order },
          { resolution: body.resolution, duplicate: true },
          body.reason,
        );
        return json(req, {
          ok: true,
          dispute_id: dispute.id,
          resolution: body.resolution,
          duplicate: true,
        });
      }
      if (order.escrow_status !== "held") {
        return json(req, { error: "order escrow is no longer held" }, 409);
      }
      if (!order.paystack_reference) {
        return json(
          req,
          { error: "order has no Paystack reference to refund" },
          409,
        );
      }

      const { data: claimed, error: claimError } = await db.rpc(
        "claim_order_refund",
        { p_order_id: order.id, p_dispute_id: dispute.id },
      );
      if (claimError) throw claimError;
      const claim = (claimed ?? {}) as {
        refund_id?: string;
        status?: string;
        paystack_refund_id?: string | null;
        paystack_reference?: string;
        amount_naira?: number;
        duplicate?: boolean;
        claimed?: boolean;
        retry_after_seconds?: number;
      };
      if (!claim.refund_id) throw new Error("refund record was not created");
      if (claim.claimed === false) {
        return json(req, {
          ok: true,
          dispute_id: dispute.id,
          resolution: body.resolution,
          refund_status: "processing",
          retry_after_seconds: claim.retry_after_seconds ?? 900,
        }, 202);
      }
      const { data: refundRow, error: refundReadError } = await db.from(
        "order_refunds",
      ).select(
        "id, status, paystack_refund_id, paystack_reference, amount_naira",
      ).eq("id", claim.refund_id).single();
      if (refundReadError) throw refundReadError;
      const refund = refundRow as RefundRow;

      // If Paystack already returned a refund ID, verify that resource. If the
      // ID is absent, list refunds by transaction before creating another one.
      let providerPayload: PaystackPayload | null = null;
      let providerId = refund.paystack_refund_id;
      if (providerId) {
        const verified = await paystackRequest(
          `/refund/${encodeURIComponent(providerId)}`,
          "GET",
        );
        if (verified.ok) providerPayload = verified.payload;
        else if (verified.httpStatus !== 404) {
          throw new Error(
            verified.payload?.message || "Could not verify refund",
          );
        }
      }
      if (!providerPayload) {
        const listed = await listRefundsForTransaction(
          refund.paystack_reference,
        );
        if (!listed.ok && listed.httpStatus !== 404) {
          throw new Error(
            listed.payload?.message || "Could not reconcile existing refunds",
          );
        }
        const rows = Array.isArray(listed.payload?.data)
          ? listed.payload.data
          : [];
        const found = rows.find((row) =>
          String((row as Record<string, unknown>).id ?? "") ===
            String(providerId ?? "")
        ) ?? rows[0];
        if (found) {
          providerPayload = {
            status: true,
            data: found as Record<string, unknown>,
          };
          providerId = String((found as Record<string, unknown>).id ?? "") ||
            providerId;
        }
      }

      if (providerPayload && refundStatus(providerPayload) === "failed") {
        // Paystack marks a failed refund as credit returned to the merchant;
        // a later admin retry may safely initiate a fresh refund attempt.
        providerPayload = null;
        providerId = null;
      }
      if (!providerPayload) {
        const initiated = await paystackRequest("/refund", "POST", {
          transaction: refund.paystack_reference,
          amount: refund.amount_naira * 100,
          currency: "NGN",
          customer_note: "Bale Drop dispute refund",
          merchant_note: `Bale Drop dispute ${dispute.id}`,
        });
        if (!initiated.ok) {
          const message = initiated.payload?.message ||
            "Paystack refund failed";
          await settleRefund(db, refund, "failed", null, message);
          logError("admin-action", new Error(message), {
            scope: "refund",
            dispute_id: dispute.id,
          });
          await alert("admin-action", "a dispute refund was rejected by Paystack", {
            dispute_id: dispute.id,
            order_id: order.id,
            amount_naira: refund.amount_naira,
            reason: message,
          });
          await deliver(
            db,
            { profileId: order.buyer_id },
            refundContent(
              refund.amount_naira,
              "The dispute was resolved in your favour. Our team is completing this refund manually.",
              refund.paystack_reference,
            ),
          );
          await audit(
            db,
            user.id,
            "resolve_dispute",
            "dispute",
            dispute.id,
            { dispute, order },
            { resolution: body.resolution, refund_status: "failed" },
            body.reason,
          );
          return json(req, { error: message, dispute_id: dispute.id }, 502);
        }
        providerPayload = initiated.payload;
        providerId = refundId(providerPayload) ?? providerId;
      }

      const status = refundStatus(providerPayload);
      const settled = await settleRefund(
        db,
        refund,
        status,
        providerId,
        status === "failed" || status === "needs-attention" ? status : null,
      );
      await audit(db, user.id, "resolve_dispute", "dispute", dispute.id, {
        dispute,
        order,
      }, {
        resolution: body.resolution,
        refund_status: status,
        paystack_refund_id: providerId,
      }, body.reason);
      if (status === "processed") {
        await deliver(
          db,
          { profileId: order.buyer_id },
          refundContent(
            refund.amount_naira,
            "The dispute was resolved in your favour.",
            refund.paystack_reference,
          ),
        );
      } else if (status === "failed" || status === "needs_attention") {
        await alert("admin-action", "a dispute refund needs attention", {
          dispute_id: dispute.id,
          order_id: order.id,
          status,
        });
      }
      logInfo("admin-action", "dispute refund settled", {
        dispute_id: dispute.id,
        status,
      });
      return json(req, {
        ok: true,
        dispute_id: dispute.id,
        resolution: body.resolution,
        refund_status: status,
        paystack_refund_id: providerId,
        result: settled,
      });
    }

    const { error: releaseError } = await db.rpc(
      "release_disputed_order_to_vendor",
      { p_order_id: order.id },
    );
    if (releaseError) throw releaseError;
    await db.from("disputes").update({
      status: "resolved_vendor",
      resolution_note: body.reason?.trim() ||
        "Dispute resolved in vendor favour",
    }).eq("id", dispute.id);
    await audit(
      db,
      user.id,
      "resolve_dispute",
      "dispute",
      dispute.id,
      { dispute, order },
      { resolution: body.resolution },
      body.reason,
    );
    // `release_disputed_order_to_vendor` writes both in-app rows; this is the
    // out-of-app half for the buyer (who lost) and the vendor (who is paid).
    await deliver(
      db,
      { profileId: order.buyer_id },
      disputeUpdateContent(
        "resolved_vendor",
        body.reason?.trim() ||
          "Our team reviewed the evidence and released this order to the vendor.",
      ),
    );
    const { data: releasedVendor } = await db.from("vendor_profiles").select(
      "profile_id",
    ).eq("id", order.vendor_id).maybeSingle();
    if (releasedVendor?.profile_id) {
      await deliver(db, { profileId: releasedVendor.profile_id }, {
        title: "Dispute resolved in your favour — payout queued",
        body: `Order ${order.id.slice(0, 8)} was released to you. The payout is queued for transfer.`,
        href: "/vendor",
        email: {
          subject: "Bale Drop — dispute resolved in your favour",
          details: [["Order", order.id], ["Net payout", `₦${(order.subtotal_naira ?? 0).toLocaleString("en-NG")}`]],
          ctaLabel: "Open seller workspace",
        },
        sms: "Bale Drop: the dispute was resolved in your favour and your payout is queued.",
      });
    }
    logInfo("admin-action", "dispute resolved", {
      dispute_id: dispute.id,
      resolution: body.resolution,
    });
    return json(req, {
      ok: true,
      dispute_id: dispute.id,
      resolution: body.resolution,
    });
  } catch (error) {
    logError("admin-action", error);
    await alert("admin-action", "an admin action failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return json(req, {
      error: error instanceof Error ? error.message : "Admin action failed",
    }, 400);
  }
});
