"use client";

import { useEffect } from "react";
import type { Product, Vendor } from "@bale-drop/database";
import { usePrefsStore } from "@/lib/store/prefs-store";
import { toRecentInput } from "@/lib/store/snapshot";
import { track } from "@/lib/analytics";

/**
 * Records a listing view: "recently viewed" for the buyer (client store) and a
 * `view_item` funnel event (one half of the add-to-cart conversion rate).
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
  }, [product, vendor]);
  return null;
}
