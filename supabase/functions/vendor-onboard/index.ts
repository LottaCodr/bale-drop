/**
 * Promote a completed vendor application through a server-side role change.
 *
 * This is a privilege escalation endpoint (`profiles.role` → `vendor`), so it is
 * rate limited and every promotion is logged: a burst of role changes from one
 * account is the signature of a stolen session.
 */
import { adminClient, authenticatedUser, cors, json } from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { logError, logInfo } from "../_shared/monitor.ts";

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
    req, db, "vendor-onboard", user.id, 10, 300, cors(req),
  );
  if (limited) return limited;

  try {
    const body = await req.json() as { vendor_id?: string; resubmit?: boolean };
    if (!body.vendor_id) {
      return json(req, { error: "vendor_id is required" }, 400);
    }
    const { data: vendor, error: vendorError } = await db
      .from("vendor_profiles")
      .select("id, profile_id, verification_status")
      .eq("id", body.vendor_id)
      .eq("profile_id", user.id)
      .maybeSingle();
    if (vendorError) throw vendorError;
    if (!vendor) {
      return json(req, { error: "vendor application not found" }, 404);
    }
    if (vendor.verification_status === "rejected" && body.resubmit === true) {
      const { error: resetError } = await db.from("vendor_profiles").update({
        verification_status: "pending",
        rejection_reason: null,
        subscription_status: "pending",
      }).eq("id", vendor.id).eq("profile_id", user.id);
      if (resetError) throw resetError;
    } else if (vendor.verification_status !== "pending") {
      return json(req, { error: "application is not pending" }, 409);
    }

    const { error: profileError } = await db.from("profiles").update({
      role: "vendor",
    }).eq("id", user.id);
    if (profileError) throw profileError;
    logInfo("vendor-onboard", "profile promoted to vendor", {
      vendor_id: vendor.id,
      resubmitted: body.resubmit === true,
    });
    return json(req, { ok: true, role: "vendor", vendor_id: vendor.id });
  } catch (error) {
    logError("vendor-onboard", error);
    return json(req, {
      error: error instanceof Error
        ? error.message
        : "Could not finish vendor application",
    }, 500);
  }
});
