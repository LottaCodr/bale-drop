import { describe, expect, it } from "vitest";
import { hueFor, mapProductRow, publicProductImageUrl, slotsLeft } from "@bale-drop/database";
import type { ProductRow } from "@bale-drop/database";

/**
 * Seller photos are served straight from the public-read `product-images`
 * bucket. The URL shape is a contract between the upload path
 * (`vendor-onboard`, migration 0003's Storage policies) and every card that
 * renders one, so a silent change here would 404 the whole catalog.
 */
const ORIGIN = "https://xyzcompany.supabase.co";

const row: ProductRow = {
  id: "p1",
  vendor_id: "v1",
  title: "Grade A Denim Bale",
  description: "40kg, mixed wash",
  category: "Bales",
  grade: "A",
  kind: "bale",
  price_naira: 120000,
  old_price_naira: 140000,
  qty: 1,
  city: "Lagos",
  status: "active",
  weight_kg: 40,
  pieces_estimate: "180–220",
  views: 900,
  sold_count: 60,
  rating_avg: 4.7,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
} as unknown as ProductRow;

describe("publicProductImageUrl", () => {
  it("builds the public bucket URL for a storage path", () => {
    expect(publicProductImageUrl("v1/p1/front.jpg", ORIGIN)).toBe(
      `${ORIGIN}/storage/v1/object/public/product-images/v1/p1/front.jpg`
    );
  });

  it("tolerates a trailing slash on the origin and a leading slash on the path", () => {
    expect(publicProductImageUrl("/v1/p1/front.jpg", `${ORIGIN}/`)).toBe(
      `${ORIGIN}/storage/v1/object/public/product-images/v1/p1/front.jpg`
    );
  });

  it("returns undefined without a path or without a storage origin", () => {
    // No photo uploaded: the caller keeps the generated art.
    expect(publicProductImageUrl(null, ORIGIN)).toBeUndefined();
    expect(publicProductImageUrl("", ORIGIN)).toBeUndefined();
    // Unconfigured store: never emit a URL that cannot resolve.
    expect(publicProductImageUrl("v1/p1/front.jpg", "")).toBeUndefined();
    expect(publicProductImageUrl("v1/p1/front.jpg", undefined)).toBeUndefined();
  });
});

describe("mapProductRow with a photo", () => {
  const photo = `${ORIGIN}/storage/v1/object/public/product-images/v1/p1/front.jpg`;

  it("carries the image URL through and leaves it optional", () => {
    expect(mapProductRow(row, photo).imageUrl).toBe(photo);
    expect(mapProductRow(row).imageUrl).toBeUndefined();
    expect(mapProductRow(row, undefined).imageUrl).toBeUndefined();
    expect(mapProductRow(row, null).imageUrl).toBeUndefined();
  });

  it("keeps the money and trust fields unchanged by the photo argument", () => {
    const withPhoto = mapProductRow(row, photo);
    const without = mapProductRow(row);
    expect({ ...withPhoto, imageUrl: undefined }).toEqual(without);
    expect(withPhoto.price).toBe(120000);
    expect(withPhoto.oldPrice).toBe(140000);
    expect(withPhoto.rating).toBe(4.7);
    expect(withPhoto.sold).toBe(60);
    expect(withPhoto.isBale).toBe(true);
    expect(withPhoto.pieces).toBe("180–220");
    // The gradient is keyed on the id, so a listing keeps its colour forever.
    expect(withPhoto.hue).toBe(hueFor(row.id));
  });

  it("falls back to a sane grade and rating on dirty rows", () => {
    const dirty = { ...row, grade: "Z", rating_avg: 0, city: null } as unknown as ProductRow;
    const mapped = mapProductRow(dirty);
    expect(mapped.grade).toBe("B");
    expect(mapped.rating).toBe(5);
    expect(mapped.city).toBe("Lagos");
  });
});

describe("slotsLeft", () => {
  it("never reports a negative number of open slots", () => {
    const full = { splitCount: 10, bookedCount: 10, expiresAt: Date.now() } as never;
    expect(slotsLeft(full)).toBe(0);
    const oversold = { splitCount: 4, bookedCount: 6, expiresAt: Date.now() } as never;
    expect(slotsLeft(oversold)).toBe(0);
    const open = { splitCount: 10, bookedCount: 3, expiresAt: Date.now() } as never;
    expect(slotsLeft(open)).toBe(7);
  });
});
