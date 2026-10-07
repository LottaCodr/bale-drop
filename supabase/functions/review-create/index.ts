/**
 * Create a single verified buyer review after delivery confirmation.
 *
 * Reviews feed `products.rating_avg` and `vendor_profiles.rating_avg`, and those
 * numbers drive search ranking — so this endpoint is rate limited like a write
 * that changes what other people see, not like a harmless form post.
 */
import { adminClient, authenticatedUser, cors, json } from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { logError, logInfo } from "../_shared/monitor.ts";

type Body = {
  order_id?: string;
  rating?: number;
  body?: string;
  product_id?: string;
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

  const limited = await enforceRateLimit(
    req, db, "review-create", user.id, 10, 300, cors(req),
  );
  if (limited) return limited;

  try {
    const body = await req.json() as Body;
    const rating = Number(body.rating);
    if (
      !body.order_id || !Number.isInteger(rating) || rating < 1 || rating > 5
    ) {
      return json(
        req,
        { error: "order_id and a 1–5 rating are required" },
        400,
      );
    }
    const { data, error } = await db.rpc("create_order_review", {
      p_order_id: body.order_id,
      p_buyer_id: user.id,
      p_rating: rating,
      p_body: body.body?.trim() ?? null,
      p_product_id: body.product_id ?? null,
    });
    if (error) throw error;
    logInfo("review-create", "review recorded", {
      order_id: body.order_id,
      rating,
    });
    return json(req, { ok: true, result: data });
  } catch (error) {
    logError("review-create", error);
    return json(req, {
      error: error instanceof Error ? error.message : "Could not create review",
    }, 400);
  }
});
