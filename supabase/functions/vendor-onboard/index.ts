/** Promote a completed vendor application through a server-side role change. */
import { adminClient, authenticatedUser, cors, json } from "../_shared/auth.ts";

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
    return json(req, { ok: true, role: "vendor", vendor_id: vendor.id });
  } catch (error) {
    console.error("vendor-onboard:", error);
    return json(req, {
      error: error instanceof Error
        ? error.message
        : "Could not finish vendor application",
    }, 500);
  }
});
