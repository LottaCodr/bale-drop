/** Authenticated order operations: buyer confirmation/disputes and vendor fulfillment. */
import { adminClient, authenticatedUser, cors, json } from "../_shared/auth.ts";

type Body = {
  action?: "confirm_delivery" | "open_dispute" | "fulfillment_status";
  order_id?: string;
  reason?: string;
  description?: string;
  evidence_urls?: string[];
  status?: "processing" | "ready" | "in_transit";
  tracking_number?: string;
  tracking_url?: string;
};

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
      return json(req, { ok: true, result: data });
    }

    if (!body.status) {
      return json(req, { error: "fulfillment status is required" }, 400);
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
    return json(req, { ok: true, result: data });
  } catch (error) {
    console.error("order-action:", error);
    return json(req, {
      error: error instanceof Error ? error.message : "Order action failed",
    }, 400);
  }
});
