/**
 * Vendor KYC documents for the admin queue.
 *
 * `dispute-evidence` already did this for buyer evidence; vendor documents had
 * no equivalent, and the admin console's "Docs" button had no handler — so
 * approving a seller, the gate the whole "verified vendor" promise rests on, was
 * a blind decision.
 *
 * The `vendor-documents` bucket is private and its Storage policies are
 * owner-only (migration 0003), so an admin cannot read the objects directly.
 * This function is the only path in: admin role check, then short-lived signed
 * URLs (5 minutes) that are never persisted.
 */
import { adminClient, authenticatedUser, cors, json, profile } from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { logError, logInfo } from "../_shared/monitor.ts";

const BUCKET = "vendor-documents";
const URL_TTL_SECONDS = 300;

type DocumentRow = {
  id: string;
  type: string;
  storage_path: string;
  status: string;
  created_at: string;
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

  const actor = await profile(db, user.id);
  if (actor?.role !== "admin") {
    return json(req, { error: "admin access required" }, 403);
  }

  const limited = await enforceRateLimit(req, db, "vendor-documents", user.id, 60, 60, cors(req));
  if (limited) return limited;

  try {
    const body = await req.json() as { vendor_id?: string; mark_reviewed?: "approved" | "rejected" };
    if (!body.vendor_id) {
      return json(req, { error: "vendor_id is required" }, 400);
    }

    const { data: rows, error: rowsError } = await db.from("vendor_documents")
      .select("id, type, storage_path, status, created_at")
      .eq("vendor_id", body.vendor_id)
      .order("created_at", { ascending: true });
    if (rowsError) throw rowsError;

    const documents: { id: string; type: string; status: string; url: string | null; created_at: string }[] = [];
    for (const row of (rows ?? []) as DocumentRow[]) {
      const { data, error } = await db.storage.from(BUCKET).createSignedUrl(row.storage_path, URL_TTL_SECONDS);
      if (error) {
        logError("vendor-documents", error, { document_type: row.type });
        documents.push({ id: row.id, type: row.type, status: row.status, url: null, created_at: row.created_at });
        continue;
      }
      documents.push({
        id: row.id,
        type: row.type,
        status: row.status,
        url: data?.signedUrl ?? null,
        created_at: row.created_at,
      });
    }

    // Optional: record the review verdict on the documents themselves, so the
    // audit trail shows what the admin actually looked at.
    if (body.mark_reviewed) {
      const { error: updateError } = await db.from("vendor_documents")
        .update({ status: body.mark_reviewed, reviewed_by: user.id, reviewed_at: new Date().toISOString() })
        .eq("vendor_id", body.vendor_id)
        .eq("status", "pending");
      if (updateError) throw updateError;
    }

    logInfo("vendor-documents", "served signed URLs", {
      vendor_id: body.vendor_id,
      documents: documents.length,
      reviewed: body.mark_reviewed ?? "none",
    });

    return json(req, { ok: true, documents, ttl_seconds: URL_TTL_SECONDS });
  } catch (error) {
    logError("vendor-documents", error);
    return json(req, {
      error: error instanceof Error ? error.message : "Could not load vendor documents",
    }, 400);
  }
});
