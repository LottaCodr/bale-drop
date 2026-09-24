/**
 * Product snapshots — one mapper from domain objects to the slim shapes the
 * client stores persist. Keeping this in a single place means a cart line, a
 * wishlist row and a "recently viewed" entry can never drift apart.
 */
import type { CartLineInput } from "./cart-store";
import type { WishInput } from "./wishlist-store";
import type { RecentInput } from "./prefs-store";
import type { Product, Vendor } from "@bale-drop/database";

export type ProductSnapshot = Omit<CartLineInput, "qty">;

export function snapshotOf(
  product: Product,
  vendor?: Pick<Vendor, "id" | "shopName"> | null
): ProductSnapshot {
  return {
    productId: product.id,
    title: product.title,
    price: product.price,
    city: product.city,
    category: product.category,
    grade: product.grade,
    hue: product.hue,
    vendorId: vendor?.id ?? product.vendorId,
    vendorName: vendor?.shopName ?? "Verified vendor",
  };
}

export const toCartLine = (product: Product, vendor?: Pick<Vendor, "id" | "shopName"> | null): CartLineInput =>
  snapshotOf(product, vendor);

export const toWishInput = (product: Product, vendor?: Pick<Vendor, "id" | "shopName"> | null): WishInput =>
  snapshotOf(product, vendor);

export const toRecentInput = (product: Product, vendor?: Pick<Vendor, "id" | "shopName"> | null): RecentInput =>
  snapshotOf(product, vendor);
