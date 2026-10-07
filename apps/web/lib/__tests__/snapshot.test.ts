import { describe, expect, it } from "vitest";
import { mapProductRow, type ProductRow } from "@bale-drop/database";
import { snapshotOf, toCartLine, toRecentInput, toWishInput } from "@/lib/store/snapshot";
import { sanitizeLine } from "@/lib/store/cart-store";

/**
 * Product snapshots are what the cart, wishlist and recently-viewed rails
 * persist to localStorage, so they carry the uploaded photo (migration 0022).
 * Two things matter here:
 *
 *  1. the photo survives the round-trip, so the rails show the real product
 *     instead of the generated gradient after a reload;
 *  2. a tampered payload cannot smuggle a non-http URL into an <img src>, which
 *     is why every sanitiser requires an absolute http(s) URL and falls back to
 *     `null` (gradient art) otherwise.
 */

const PHOTO = "https://project.supabase.co/storage/v1/object/public/product-images/u1/p1.png";

const row = {
  id: "p1",
  vendor_id: "v1",
  title: "Denim Jackets Bale",
  description: "Forty clean denim jackets.",
  category: "Bales",
  grade: "A",
  kind: "bale",
  price_naira: 15000,
  old_price_naira: null,
  qty: 3,
  city: "Lagos",
  status: "active",
  weight_kg: 45,
  pieces_estimate: "~40 pcs",
  views: 12,
  sold_count: 1,
  rating_avg: 4.5,
  created_at: "2026-10-01T09:00:00.000Z",
  updated_at: "2026-10-01T09:00:00.000Z",
} as unknown as ProductRow;

describe("product snapshots", () => {
  it("carries the uploaded photo into every store shape", () => {
    const product = mapProductRow(row, PHOTO);
    const vendor = { id: "v1", shopName: "Adaeze Thrift Co." };

    expect(snapshotOf(product, vendor).imageUrl).toBe(PHOTO);
    expect(toCartLine(product, vendor).imageUrl).toBe(PHOTO);
    expect(toWishInput(product, vendor).imageUrl).toBe(PHOTO);
    expect(toRecentInput(product, vendor).imageUrl).toBe(PHOTO);
  });

  it("falls back to null when the listing has no photo", () => {
    const product = mapProductRow(row, null);
    expect(snapshotOf(product, null).imageUrl).toBeNull();
    // The gradient art still has everything it needs.
    expect(snapshotOf(product, null).hue).toBeTypeOf("number");
  });

  it("keeps a persisted photo across a cart round-trip", () => {
    const line = sanitizeLine({ ...toCartLine(mapProductRow(row, PHOTO), null), qty: 2 });
    expect(line?.imageUrl).toBe(PHOTO);
    expect(line?.qty).toBe(2);
  });

  it("rejects non-http image URLs from a tampered payload", () => {
    for (const hostile of [
      "javascript:alert(document.cookie)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "//evil.test/x.png",
      "file:///etc/passwd",
      "relative/path.png",
    ]) {
      expect(sanitizeLine({ ...toCartLine(mapProductRow(row, null), null), imageUrl: hostile })?.imageUrl).toBeNull();
    }
  });

  it("drops a malformed photo but keeps the rest of the line", () => {
    const line = sanitizeLine({
      ...toCartLine(mapProductRow(row, null), null),
      imageUrl: 42,
      title: "Denim Jackets Bale",
    });
    expect(line?.imageUrl).toBeNull();
    expect(line?.title).toBe("Denim Jackets Bale");
    expect(line?.price).toBe(15000);
  });
});
