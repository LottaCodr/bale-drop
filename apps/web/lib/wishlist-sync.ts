/**
 * Wishlist ↔ Supabase sync (best-effort, never blocking).
 *
 * Local storage stays the source of truth for the UI (instant heart toggle,
 * works signed-out). When a session exists we mirror changes into
 * `public.wishlists` (migration 0018) and merge server rows in on sign-in so
 * favourites follow the buyer across devices — a documented cart/wishlist
 * expectation in the marketplace research.
 */
import { mapProductRow, type ProductRow } from "@bale-drop/database";
import { supabaseBrowser } from "@/lib/supabase";
import { isSupabaseLive } from "@/lib/config";
import { useWishlistStore, type WishInput } from "@/lib/store/wishlist-store";

function toWishInput(row: ProductRow, vendorName: string): WishInput {
  const product = mapProductRow(row);
  return {
    productId: product.id,
    title: product.title,
    price: product.price,
    city: product.city,
    category: product.category,
    grade: product.grade,
    hue: product.hue,
    vendorId: product.vendorId,
    vendorName,
  };
}

/** Pull server wishlist rows and merge them into the local store. */
export async function pullWishlist(userId: string): Promise<void> {
  if (!isSupabaseLive()) return;
  try {
    const sb = supabaseBrowser();
    const { data: rows, error } = await sb.from("wishlists").select("product_id").eq("profile_id", userId);
    if (error || !rows?.length) return;
    const ids = rows.map((row) => row.product_id);
    const { data: products } = await sb.from("products").select("*").in("id", ids);
    if (!products?.length) return;
    const vendorIds = [...new Set(products.map((product) => product.vendor_id))];
    const { data: vendors } = await sb.from("vendor_profiles").select("id, shop_name").in("id", vendorIds);
    const vendorNames = new Map((vendors ?? []).map((vendor) => [vendor.id, vendor.shop_name]));
    useWishlistStore
      .getState()
      .merge(products.map((product) => toWishInput(product as ProductRow, vendorNames.get(product.vendor_id) ?? "Verified vendor")));
  } catch {
    /* offline or RLS denied — local favourites still work */
  }
}

/** Mirror a single heart toggle to the server when signed in. */
export async function pushWishlistToggle(productId: string, saved: boolean): Promise<void> {
  if (!isSupabaseLive()) return;
  try {
    const sb = supabaseBrowser();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return;
    if (saved) await sb.from("wishlists").upsert({ profile_id: user.id, product_id: productId }, { onConflict: "profile_id,product_id" });
    else await sb.from("wishlists").delete().eq("profile_id", user.id).eq("product_id", productId);
  } catch {
    /* best effort — the local store remains authoritative for this device */
  }
}
