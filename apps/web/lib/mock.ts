/**
 * Demo fallback dataset — same domain shapes as live Supabase, so every
 * component renders identically in both modes. `lib/data.ts` serves this
 * when env vars are absent or a live fetch fails. NEVER import this from
 * components directly for catalog data — go through `lib/data.ts` (server).
 *
 * Size: ~20 listings / 7 vendors / 6 live splits — enough for search, filters
 * and storefront pages to behave like the real catalog instead of a 8-item toy.
 */
import type { BaleListing, Order, Product, Vendor } from "@bale-drop/database";

export type { BaleListing, Grade, Order, Product, Vendor } from "@bale-drop/database";
export { slotPrice, slotsLeft } from "@bale-drop/database";

// Taxonomy lives in lib/taxonomy.ts so client components can import it
// without bundling the demo dataset. Re-exported here for backwards imports.
export { CATEGORIES, CITIES, GRADES, type Category, type City } from "./taxonomy";

export const VENDORS: Vendor[] = [
  { id: "v1", shopName: "Adaeze Thrift Co.", city: "Lagos", rating: 4.8, reviews: 312, sales: 1402, verified: true, inspected: true, responseTime: "~1 hr", initials: "AT", hue: 160 },
  { id: "v2", shopName: "Kano Bale House", city: "Kano", rating: 4.9, reviews: 528, sales: 2310, verified: true, inspected: true, responseTime: "~2 hrs", initials: "KB", hue: 210 },
  { id: "v3", shopName: "PH Okirika Hub", city: "Port Harcourt", rating: 4.7, reviews: 194, sales: 860, verified: true, inspected: false, responseTime: "~3 hrs", initials: "PH", hue: 280 },
  { id: "v4", shopName: "Grade-A Plug Abuja", city: "Abuja", rating: 4.9, reviews: 441, sales: 1875, verified: true, inspected: true, responseTime: "~45 min", initials: "GA", hue: 20 },
  { id: "v5", shopName: "Yaba Vintage Vault", city: "Lagos", rating: 4.6, reviews: 128, sales: 402, verified: true, inspected: false, responseTime: "~5 hrs", initials: "YV", hue: 330 },
  { id: "v6", shopName: "Ikeja Sneaker Yard", city: "Lagos", rating: 4.7, reviews: 205, sales: 974, verified: true, inspected: false, responseTime: "~2 hrs", initials: "IS", hue: 190 },
  { id: "v7", shopName: "Aba Road Bales", city: "Port Harcourt", rating: 4.8, reviews: 156, sales: 731, verified: true, inspected: true, responseTime: "~4 hrs", initials: "AR", hue: 95 },
];

export const PRODUCTS: Product[] = [
  { id: "p1", title: "Grade A Unisex Vintage Denim Jackets — Full Bale", description: "45 clean denim jackets, no rips, mixed M–XL. Inspected in Lagos before shipping.", category: "Bales", grade: "A", price: 150000, city: "Lagos", vendorId: "v1", hue: 210, rating: 4.8, sold: 132, isBale: true, pieces: "~45 pcs", tag: "Splitting now" },
  { id: "p2", title: "Grade A Sneakers Bale — Mixed Sizes 40–45", description: "50 pairs of branded sneakers, light wear, sorted by size. Great resale margin.", category: "Shoes", grade: "A", price: 220000, city: "Kano", vendorId: "v2", hue: 160, rating: 4.9, sold: 210, isBale: true, pieces: "~50 pairs", tag: "Almost full" },
  { id: "p3", title: "Men Corporate Shirts Bale — Long Sleeve", description: "70 long-sleeve shirts, mostly white and blue, office-ready.", category: "Men", grade: "A", price: 95000, oldPrice: 110000, city: "Abuja", vendorId: "v4", hue: 220, rating: 4.7, sold: 98, isBale: true, pieces: "~70 pcs" },
  { id: "p4", title: "Vintage Levi's-Style Trucker Jacket (Single)", description: "One-off trucker jacket, stone-washed, chest 42. Cleaned and steamed.", category: "Vintage", grade: "A", price: 12500, city: "Lagos", vendorId: "v5", hue: 200, rating: 4.6, sold: 44, isBale: false },
  { id: "p5", title: "Grade B Mixed Ladies Gowns Bale", description: "80 gowns, a few need minor repairs — priced for the fix-up margin.", category: "Women", grade: "B", price: 90000, city: "Port Harcourt", vendorId: "v3", hue: 300, rating: 4.7, sold: 76, isBale: true, pieces: "~80 pcs", tag: "New split" },
  { id: "p6", title: "Kids Mix Bale — Ages 2–10", description: "120 kidswear pieces, sorted by age band, no stains.", category: "Kids", grade: "B", price: 68000, city: "Lagos", vendorId: "v1", hue: 40, rating: 4.8, sold: 61, isBale: true, pieces: "~120 pcs" },
  { id: "p7", title: "Leather Handbags — Single Pieces (5 pcs bundle)", description: "Five leather handbags, genuine leather, mixed colours.", category: "Bags", grade: "A", price: 28000, oldPrice: 34000, city: "Abuja", vendorId: "v4", hue: 25, rating: 4.9, sold: 187, isBale: false },
  { id: "p8", title: "Grade A Hoodies & Sweatshirts Bale", description: "60 hoodies and sweatshirts, heavyweight cotton, mixed sizes.", category: "Men", grade: "A", price: 130000, city: "Kano", vendorId: "v2", hue: 170, rating: 4.9, sold: 143, isBale: true, pieces: "~60 pcs" },
  { id: "p9", title: "Nike Air Max Bundle — 8 Pairs Grade A", description: "Eight pairs of Nike Air Max, sizes 41–44, verified authentic.", category: "Shoes", grade: "A", price: 168000, city: "Lagos", vendorId: "v6", hue: 205, rating: 4.8, sold: 87, isBale: false, pieces: "8 pairs" },
  { id: "p10", title: "Ladies Office Blazers Bale — Grade A", description: "40 tailored blazers, plain colours, dry-cleaned and pressed.", category: "Women", grade: "A", price: 112000, city: "Abuja", vendorId: "v4", hue: 320, rating: 4.8, sold: 54, isBale: true, pieces: "~40 pcs" },
  { id: "p11", title: "Designer Denim Jeans Bale — Mixed Waist", description: "55 pairs of denim, waist 28–38, no tears.", category: "Men", grade: "A", price: 145000, city: "Port Harcourt", vendorId: "v7", hue: 215, rating: 4.7, sold: 66, isBale: true, pieces: "~55 pairs" },
  { id: "p12", title: "Vintage Silk Scarves — 20 Piece Lot", description: "Twenty printed silk scarves, washed and ironed.", category: "Vintage", grade: "B", price: 22000, city: "Lagos", vendorId: "v5", hue: 285, rating: 4.5, sold: 39, isBale: false },
  { id: "p13", title: "Baby & Toddler Shoes Bale — 60 Pairs", description: "Sixty pairs of toddler shoes, sizes 18–26, clean soles.", category: "Kids", grade: "B", price: 48000, city: "Kano", vendorId: "v2", hue: 55, rating: 4.6, sold: 47, isBale: true, pieces: "~60 pairs" },
  { id: "p14", title: "Leather Office Shoes — 12 Pairs Grade A", description: "Twelve pairs of men's leather shoes, sizes 41–45.", category: "Shoes", grade: "A", price: 84000, city: "Lagos", vendorId: "v6", hue: 30, rating: 4.8, sold: 112, isBale: false, pieces: "12 pairs" },
  { id: "p15", title: "Crossbody & Tote Bag Mix — 15 Pieces", description: "Fifteen bags: totes, crossbody and mini. Mixed brands, no damage.", category: "Bags", grade: "B", price: 52000, city: "Port Harcourt", vendorId: "v3", hue: 340, rating: 4.6, sold: 58, isBale: false, pieces: "15 pieces" },
  { id: "p16", title: "Grade A Sports Jerseys Bale — 80 Pcs", description: "Eighty football jerseys, assorted clubs, breathable fabric.", category: "Men", grade: "A", price: 98000, city: "Abuja", vendorId: "v4", hue: 145, rating: 4.9, sold: 205, isBale: true, pieces: "~80 pcs", tag: "Splitting now" },
  { id: "p17", title: "Wool Coats & Trenches — 25 Piece Winter Lot", description: "Twenty-five coats, heavyweight wool blends, dry-cleaned.", category: "Women", grade: "A", price: 165000, city: "Lagos", vendorId: "v1", hue: 245, rating: 4.9, sold: 41, isBale: true, pieces: "~25 pcs" },
  { id: "p18", title: "Canvas Tote Bag (Single)", description: "Heavy canvas tote, unisex, single piece.", category: "Bags", grade: "B", price: 6500, city: "Kano", vendorId: "v2", hue: 100, rating: 4.5, sold: 23, isBale: false },
  { id: "p19", title: "Kids Party Dresses — 30 Piece Bundle", description: "Thirty girls' party dresses, ages 3–8, bright prints.", category: "Kids", grade: "A", price: 46000, city: "Abuja", vendorId: "v4", hue: 350, rating: 4.7, sold: 29, isBale: false, pieces: "30 pieces" },
  { id: "p20", title: "Vintage Leather Jackets Bale — 30 Pcs", description: "Thirty leather jackets, Grade A, mixed sizes. Heaviest seller in Lagos.", category: "Vintage", grade: "A", price: 195000, city: "Lagos", vendorId: "v5", hue: 15, rating: 4.9, sold: 91, isBale: true, pieces: "~30 pcs", tag: "Almost full" },
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
  {
    id: "b4", productId: "p16", totalAmount: 98000, splitCount: 8, bookedCount: 5,
    expiresInMs: 20 * HOUR, expiresAt: NOW + 20 * HOUR,
    joiners: ["CO", "OE", "TB", "SK", "NU"], weight: "40kg", pieces: "~80 jerseys", status: "open",
  },
  {
    id: "b5", productId: "p10", totalAmount: 112000, splitCount: 7, bookedCount: 3,
    expiresInMs: 3 * 24 * HOUR, expiresAt: NOW + 3 * 24 * HOUR,
    joiners: ["EA", "FS", "DA"], weight: "35kg", pieces: "~40 blazers", status: "open",
  },
  {
    id: "b6", productId: "p20", totalAmount: 195000, splitCount: 5, bookedCount: 4,
    expiresInMs: 9 * HOUR, expiresAt: NOW + 9 * HOUR,
    joiners: ["CO", "IM", "TB", "SK"], weight: "70kg", pieces: "~30 jackets", status: "open",
  },
];

export const ORDERS: Order[] = [
  { id: "BD-2041", title: "Bale Split slot — Vintage Denim Jackets", vendor: "Adaeze Thrift Co.", amount: 15000, date: "Sep 20, 2026", status: "in_transit", tracking: "SNB-884102", step: 3, hue: 210 },
  { id: "BD-1987", title: "Leather Handbags (5 pcs bundle)", vendor: "Grade-A Plug Abuja", amount: 28000, date: "Sep 14, 2026", status: "delivered", step: 4, hue: 25 },
];

export const ORDER_STEPS = ["Ordered", "Paid (escrow)", "Processing", "In transit", "Delivered"] as const;

/* ---------- demo reviews (mirrors the public `reviews` read) ---------- */

export interface MockReview {
  id: string;
  productId: string;
  vendorId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  body: string;
  author: string;
  initials: string;
  hue: number;
  date: string;
}

export const REVIEWS: MockReview[] = [
  { id: "r1", productId: "p1", vendorId: "v1", rating: 5, body: "Bale exactly as described — Grade A, no stories. Escrow made me confident to pay upfront.", author: "Chiamaka O.", initials: "CO", hue: 280, date: "Sep 10, 2026" },
  { id: "r2", productId: "p1", vendorId: "v1", rating: 4, body: "Delivery to Kano took 3 days, tracking worked throughout. One piece had a small stain, vendor gave partial refund fast.", author: "Ibrahim M.", initials: "IM", hue: 210, date: "Aug 28, 2026" },
  { id: "r3", productId: "p1", vendorId: "v1", rating: 5, body: "Third bale from Adaeze. Denim quality is consistently the best I have bought on any app.", author: "Folake S.", initials: "FS", hue: 160, date: "Aug 19, 2026" },
  { id: "r4", productId: "p2", vendorId: "v2", rating: 5, body: "All 50 pairs matched the sizes listed. Sold out of my shop in 6 days.", author: "Sani K.", initials: "SK", hue: 45, date: "Sep 12, 2026" },
  { id: "r5", productId: "p2", vendorId: "v2", rating: 4, body: "Two pairs had worn soles but the vendor refunded the difference without arguing.", author: "Ngozi U.", initials: "NU", hue: 300, date: "Sep 02, 2026" },
  { id: "r6", productId: "p5", vendorId: "v3", rating: 5, body: "Grade B was honest — a few repairs needed, exactly as the listing said. Great margin.", author: "Blessing A.", initials: "BA", hue: 330, date: "Aug 30, 2026" },
  { id: "r7", productId: "p16", vendorId: "v4", rating: 5, body: "Jerseys came sealed and clean. Split filled in two days and delivery was tracked the whole way.", author: "Tunde B.", initials: "TB", hue: 200, date: "Sep 15, 2026" },
  { id: "r8", productId: "p20", vendorId: "v5", rating: 5, body: "Leather quality is unreal for the price. Escrow released only after I confirmed.", author: "Emeka E.", initials: "EE", hue: 15, date: "Sep 08, 2026" },
  { id: "r9", productId: "p7", vendorId: "v4", rating: 5, body: "Genuine leather, five bags as promised. Will buy again.", author: "Aisha D.", initials: "AD", hue: 25, date: "Sep 05, 2026" },
  { id: "r10", productId: "p10", vendorId: "v4", rating: 5, body: "Blazers were dry-cleaned and pressed like the listing said. Zero repairs needed.", author: "Halima Y.", initials: "HY", hue: 320, date: "Sep 18, 2026" },
];

export function getReviewsForProduct(productId: string): MockReview[] {
  return REVIEWS.filter((review) => review.productId === productId);
}

export function getReviewsForVendor(vendorId: string): MockReview[] {
  return REVIEWS.filter((review) => review.vendorId === vendorId);
}

export function getProductsByVendor(vendorId: string): Product[] {
  return PRODUCTS.filter((product) => product.vendorId === vendorId);
}

// --- fallback selectors (used by lib/data.ts + cart/orders until auth) ---

export function getVendor(id: string): Vendor {
  const v = VENDORS.find((x) => x.id === id);
  if (!v) throw new Error(`Unknown vendor ${id}`);
  return v;
}

export function getVendorOrNull(id: string): Vendor | null {
  return VENDORS.find((x) => x.id === id) ?? null;
}

export function getProduct(id: string): Product {
  const p = PRODUCTS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown product ${id}`);
  return p;
}

export function getProductOrNull(id: string): Product | null {
  return PRODUCTS.find((x) => x.id === id) ?? null;
}

export function getBale(id: string): BaleListing {
  const b = BALES.find((x) => x.id === id);
  if (!b) throw new Error(`Unknown bale ${id}`);
  return b;
}
