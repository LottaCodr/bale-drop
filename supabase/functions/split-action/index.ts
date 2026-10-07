/**
 * Bale Split operations that move money or state.
 *
 * Two actors, two actions:
 *   - vendor: `fulfil`  → the split filled and the bale was handed over. Calls
 *     `fulfil_bale_split()`, which attributes the slot pay-ins to the vendor,
 *     takes commission and queues the payout (migration 0022). Without this the
 *     money from a filled split had no exit at all.
 *   - vendor: `cancel`  → pull a split that nobody has paid for yet.
 *
 * Everything else about a split (claiming, paying, expiring, refunding) already
 * lives in `claim_bale_slot()`, `paystack-*` and `bale-expiry`.
 */
import { adminClient, authenticatedUser, cors, json, profile } from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { alert, logError, logInfo } from "../_shared/monitor.ts";
import { deliver, naira } from "../_shared/notify.ts";

type Body = {
  action?: "fulfil" | "fulfill" | "cancel";
  bale_id?: string;
  handover_note?: string;
};

type VendorRow = { id: string; profile_id: string; shop_name: string };

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
    req, db, "split-action", user.id, 20, 60, cors(req),
  );
  if (limited) return limited;

  try {
    const body = await req.json() as Body;
    const action = body.action === "fulfill" ? "fulfil" : body.action;
    if (!body.bale_id || (action !== "fulfil" && action !== "cancel")) {
      return json(req, { error: "action and bale_id are required" }, 400);
    }

    const { data: vendor, error: vendorError } = await db.from("vendor_profiles")
      .select("id, profile_id, shop_name")
      .eq("profile_id", user.id)
      .maybeSingle();
    if (vendorError) throw vendorError;
    if (!vendor) return json(req, { error: "seller profile not found" }, 404);

    const actor = await profile(db, user.id);
    const ownsBale = await isBaleOwner(db, body.bale_id, (vendor as VendorRow).id);
    if (!ownsBale && actor?.role !== "admin") {
      return json(req, { error: "this split is not yours" }, 403);
    }

    if (action === "cancel") {
      const { data, error } = await db.rpc("cancel_bale_split", { p_bale_id: body.bale_id });
      if (error) throw error;
      logInfo("split-action", "split cancelled", { bale_id: body.bale_id });
      return json(req, { ok: true, result: data });
    }

    const note = body.handover_note?.trim().slice(0, 500) ?? null;
    const { data, error } = await db.rpc("fulfil_bale_split", {
      p_bale_id: body.bale_id,
      p_vendor_profile_id: (vendor as VendorRow).id,
      p_handover_note: note,
    });
    if (error) throw error;

    const result = data as {
      duplicate?: boolean;
      net_naira?: number;
      slots?: number;
      status?: string;
    };
    logInfo("split-action", "split fulfilled", {
      bale_id: body.bale_id,
      net_naira: result.net_naira ?? 0,
      slots: result.slots ?? 0,
      duplicate: result.duplicate === true,
    });

    // The vendor's own confirmation email/SMS. The slot buyers are notified by
    // the RPC in-app; their out-of-app copy goes out here so a provider outage
    // cannot roll back the settlement.
    await deliver(db, { profileId: (vendor as VendorRow).profile_id }, {
      title: "Split settled — payout queued",
      body: `All ${result.slots ?? 0} slots were paid. ${naira(result.net_naira ?? 0)} is queued for transfer to your bank account.`,
      href: "/vendor",
      email: {
        subject: `Bale Drop payout queued — ${naira(result.net_naira ?? 0)}`,
        details: [
          ["Slots paid", String(result.slots ?? 0)],
          ["Net to you", naira(result.net_naira ?? 0)],
          ["Status", "Queued for transfer"],
        ],
        ctaLabel: "Open seller workspace",
      },
    });

    return json(req, { ok: true, result });
  } catch (error) {
    logError("split-action", error);
    const message = error instanceof Error ? error.message : "Could not update this split";
    // A settlement that cannot complete is a money incident: page a human.
    if (/payout|commission|paid slots|settle/i.test(message)) {
      await alert("split-action", "split settlement failed", { reason: message });
    }
    return json(req, { error: message }, 400);
  }
});

async function isBaleOwner(
  db: Awaited<ReturnType<typeof adminClient>>,
  baleId: string,
  vendorId: string,
): Promise<boolean> {
  const { data } = await db.from("bale_listings")
    .select("product_id, products!inner(vendor_id)")
    .eq("id", baleId)
    .maybeSingle();
  const rows = (data as unknown as { products?: { vendor_id?: string } | { vendor_id?: string }[] } | null)?.products;
  const first = Array.isArray(rows) ? rows[0] : rows;
  return first?.vendor_id === vendorId;
}
