/** Admin-only moderation, dispute resolution and audit operations. */
import {
  adminClient,
  authenticatedUser,
  cors,
  json,
  profile,
} from "../_shared/auth.ts";

const PAYSTACK_SECRET = Deno.env.get("PAYSTACK_SECRET_KEY");

type Body = {
  action?:
    | "approve_vendor"
    | "reject_vendor"
    | "approve_product"
    | "reject_product"
    | "resolve_dispute";
  entity_id?: string;
  reason?: string;
  resolution?: "buyer_refund" | "vendor_release";
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

  try {
    const body = await req.json() as Body;
    if (!body.action || !body.entity_id) {
      return json(req, { error: "action and entity_id are required" }, 400);
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
      }
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
    return json(req, {
      ok: true,
      dispute_id: dispute.id,
      resolution: body.resolution,
    });
  } catch (error) {
    console.error("admin-action:", error);
    return json(req, {
      error: error instanceof Error ? error.message : "Admin action failed",
    }, 400);
  }
});
