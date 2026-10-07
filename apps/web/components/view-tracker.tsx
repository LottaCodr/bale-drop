"use client";

import { useEffect } from "react";
import type { Product, Vendor } from "@bale-drop/database";
import { isSupabaseLive } from "@/lib/config";
import { supabaseBrowser } from "@/lib/supabase";
import { usePrefsStore } from "@/lib/store/prefs-store";
import { toRecentInput } from "@/lib/store/snapshot";
import { track } from "@/lib/analytics";

/**
 * Records a listing view in three places:
 *   1. `products.views` through `record_product_view()` (migration 0024) — the
 *      number a seller sees in their workspace and the denominator of their
 *      conversion rate. Granted to `anon`, so signed-out traffic counts too.
 *   2. "recently viewed" in the buyer's local prefs store.
 *   3. a `view_item` funnel event (one half of the add-to-cart conversion rate).
 *
 * One call per mount per product: a re-render caused by a filter change must not
 * inflate the counter, and neither should a refresh loop.
 *
 * Renders nothing.
 */
export function ViewTracker({
  product,
  vendor,
}: {
  product: Product;
  vendor?: Pick<Vendor, "id" | "shopName"> | null;
}) {
  useEffect(() => {
    usePrefsStore.getState().trackView(toRecentInput(product, vendor));
    track("view_item", {
      item_id: product.id,
      item_name: product.title,
      value: product.price,
      category: product.category,
      grade: product.grade,
      city: product.city,
      vendor_id: product.vendorId,
    });

    if (!isSupabaseLive()) return;
    // Best effort: a view counter must never surface an error to a shopper.
    // The Supabase builder is a `PromiseLike`, so it is wrapped before `.catch`.
    void Promise.resolve(supabaseBrowser().rpc("record_product_view", { p_product_id: product.id })).catch(
      () => undefined
    );
    // `product.id` is the only dependency that should re-count a view.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per listing view
  }, [product.id]);

  return null;
}
