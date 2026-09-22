/**
 * Demo fallback dataset — same domain shapes as live Supabase, so every
 * component renders identically in both modes. `lib/data.ts` serves this
 * when env vars are absent or a live fetch fails. NEVER import this from
 * components directly for catalog data — go through `lib/data.ts` (server)
 * or live hooks (client). Cart/orders still use it until auth lands.
 */
import type { BaleListing, Order, Product, Vendor } from "@bale-drop/database";

export type { BaleListing, Grade, Order, Product, Vendor } from "@bale-drop/database";
export { slotPrice, slotsLeft } from "@bale-drop/database";

export const CITIES = ["Lagos", "Abuja", "Port Harcourt", "Kano"] as const;

export const CATEGORIES = [
  "All",
  "Bales",
  "Men",
  "Women",
  "Kids",
  "Shoes",
  "Bags",
  "Vintage",
] as const;

export const VENDORS: Vendor[] = [
  { id: "v1", shopName: "Adaeze Thrift Co.", city: "Lagos", rating: 4.8, reviews: 312, sales: 1402, verified: true, inspected: true, responseTime: "~1 hr", initials: "AT", hue: 160 },
  { id: "v2", shopName: "Kano Bale House", city: "Kano", rating: 4.9, reviews: 528, sales: 2310, verified: true, inspected: true, responseTime: "~2 hrs", initials: "KB", hue: 210 },
  { id: "v3", shopName: "PH Okirika Hub", city: "Port Harcourt", rating: 4.7, reviews: 194, sales: 860, verified: true, inspected: false, responseTime: "~3 hrs", initials: "PH", hue: 280 },
  { id: "v4", shopName: "Grade-A Plug Abuja", city: "Abuja", rating: 4.9, reviews: 441, sales: 1875, verified: true, inspected: true, responseTime: "~45 min", initials: "GA", hue: 20 },
  { id: "v5", shopName: "Yaba Vintage Vault", city: "Lagos", rating: 4.6, reviews: 128, sales: 402, verified: true, inspected: false, responseTime: "~5 hrs", initials: "YV", hue: 330 },
];

export const PRODUCTS: Product[] = [
  { id: "p1", title: "Grade A Unisex Vintage Denim Jackets — Full Bale", category: "Bales", grade: "A", price: 150000, city: "Lagos", vendorId: "v1", hue: 210, rating: 4.8, sold: 132, isBale: true, pieces: "~45 pcs", tag: "Splitting now" },
  { id: "p2", title: "Grade A Sneakers Bale — Mixed Sizes 40–45", category: "Shoes", grade: "A", price: 220000, city: "Kano", vendorId: "v2", hue: 160, rating: 4.9, sold: 210, isBale: true, pieces: "~50 pairs", tag: "Almost full" },
  { id: "p3", title: "Men Corporate Shirts Bale — Long Sleeve", category: "Men", grade: "A", price: 95000, oldPrice: 110000, city: "Abuja", vendorId: "v4", hue: 220, rating: 4.7, sold: 98, isBale: true, pieces: "~70 pcs" },
  { id: "p4", title: "Vintage Levi's-Style Trucker Jacket (Single)", category: "Vintage", grade: "A", price: 12500, city: "Lagos", vendorId: "v5", hue: 200, rating: 4.6, sold: 44, isBale: false },
  { id: "p5", title: "Grade B Mixed Ladies Gowns Bale", category: "Women", grade: "B", price: 90000, city: "Port Harcourt", vendorId: "v3", hue: 300, rating: 4.7, sold: 76, isBale: true, pieces: "~80 pcs", tag: "New split" },
  { id: "p6", title: "Kids Mix Bale — Ages 2–10", category: "Kids", grade: "B", price: 68000, city: "Lagos", vendorId: "v1", hue: 40, rating: 4.8, sold: 61, isBale: true, pieces: "~120 pcs" },
  { id: "p7", title: "Leather Handbags — Single Pieces (5 pcs bundle)", category: "Bags", grade: "A", price: 28000, oldPrice: 34000, city: "Abuja", vendorId: "v4", hue: 25, rating: 4.9, sold: 187, isBale: false },
  { id: "p8", title: "Grade A Hoodies & Sweatshirts Bale", category: "Men", grade: "A", price: 130000, city: "Kano", vendorId: "v2", hue: 170, rating: 4.9, sold: 143, isBale: true, pieces: "~60 pcs" },
];

const HOUR = 3600_000;
const NOW = Date.now();

export const BALES: BaleListing[] = [
  {
    id: "b1", productId: "p1", totalAmount: 150000, splitCount: 10, bookedCount: 7,
    expiresInMs: 52 * HOUR, expiresAt: NOW + 52 * HOUR,
    joiners: ["CO", "OE", "EA", "FS", "IM", "DA", "TB"], weight: "100kg", pieces: "~45 jackets", status: "open",
  },
  {
    id: "b2", productId: "p2", totalAmount: 220000, splitCount: 10, bookedCount: 9,
    expiresInMs: 5 * HOUR, expiresAt: NOW + 5 * HOUR,
    joiners: ["CO", "OE", "EA", "FS", "IM", "DA", "TB", "SK", "NU"], weight: "55kg", pieces: "~50 pairs", status: "open",
  },
  {
    id: "b3", productId: "p5", totalAmount: 90000, splitCount: 6, bookedCount: 2,
    expiresInMs: 6 * 24 * HOUR, expiresAt: NOW + 6 * 24 * HOUR,
    joiners: ["CO", "FS"], weight: "80kg", pieces: "~80 gowns", status: "open",
  },
];

export const ORDERS: Order[] = [
  { id: "BD-2041", title: "Bale Split slot — Vintage Denim Jackets", vendor: "Adaeze Thrift Co.", amount: 15000, date: "Sep 20, 2026", status: "in_transit", tracking: "SNB-884102", step: 3, hue: 210 },
  { id: "BD-1987", title: "Leather Handbags (5 pcs bundle)", vendor: "Grade-A Plug Abuja", amount: 28000, date: "Sep 14, 2026", status: "delivered", step: 4, hue: 25 },
];

export const ORDER_STEPS = ["Ordered", "Paid (escrow)", "Processing", "In transit", "Delivered"] as const;

// --- fallback selectors (used by lib/data.ts + cart/orders until auth) ---

export function getVendor(id: string): Vendor {
  const v = VENDORS.find((x) => x.id === id);
  if (!v) throw new Error(`Unknown vendor ${id}`);
  return v;
}

export function getProduct(id: string): Product {
  const p = PRODUCTS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown product ${id}`);
  return p;
}

export function getBale(id: string): BaleListing {
  const b = BALES.find((x) => x.id === id);
  if (!b) throw new Error(`Unknown bale ${id}`);
  return b;
}
