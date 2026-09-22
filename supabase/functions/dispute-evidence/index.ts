/** Return short-lived private evidence links to an authenticated admin. */
import {
  adminClient,
  authenticatedUser,
  cors,
  json,
  profile,
} from "../_shared/auth.ts";

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
  if (actor?.role !== "admin") {
    return json(req, { error: "admin access required" }, 403);
  }
  try {
    const body = await req.json() as { dispute_id?: string };
    if (!body.dispute_id) {
      return json(req, { error: "dispute_id is required" }, 400);
    }
    const { data: dispute, error: disputeError } = await db.from("disputes")
      .select("evidence_urls").eq("id", body.dispute_id).maybeSingle();
    if (disputeError) throw disputeError;
    if (!dispute) return json(req, { error: "dispute not found" }, 404);
    const links: string[] = [];
    for (const path of dispute.evidence_urls ?? []) {
      const { data, error } = await db.storage.from("dispute-evidence")
        .createSignedUrl(path, 600);
      if (!error && data?.signedUrl) links.push(data.signedUrl);
    }
    return json(req, { ok: true, links });
  } catch (error) {
    console.error("dispute-evidence:", error);
    return json(req, {
      error: error instanceof Error ? error.message : "Could not load evidence",
    }, 400);
  }
});
