/**
 * Domain models — the shapes UI code renders. Shared by web + future mobile.
 * DB rows are mapped to these at the data-layer boundary (never leak Row
 * types into components).
 */
import type { Database } from "./types";

export type BaleRow = Database["public"]["Tables"]["bale_listings"]["Row"];
export type ProductRow = Database["public"]["Tables"]["products"]["Row"];
export type VendorRow = Database["public"]["Tables"]["vendor_profiles"]["Row"];

export type Grade = "A" | "B" | "C";

export interface Vendor {
  id: string;
  shopName: string;
  city: string;
  rating: number;
  reviews: number;
  sales: number;
  verified: boolean;
  inspected: boolean;
  responseTime: string;
  initials: string;
  hue: number;
}

export interface Product {
  id: string;
  title: string;
  /** Present when the vendor wrote one; feeds search relevance. */
  description?: string;
  category: string;
  grade: Grade;
  price: number;
  oldPrice?: number;
  city: string;
  vendorId: string;
  hue: number;
  rating: number;
  sold: number;
  isBale: boolean;
  pieces?: string;
  tag?: string;
}

export interface BaleListing {
  id: string;
  productId: string;
  totalAmount: number;
  splitCount: number;
  bookedCount: number;
  expiresInMs: number;
  expiresAt: number;
  joiners: string[];
  weight: string;
  pieces: string;
  status: "open" | "full";
}

export interface Order {
  id: string;
  title: string;
  vendor: string;
  amount: number;
  date: string;
  status: "processing" | "in_transit" | "delivered";
  tracking?: string;
  step: number;
  hue: number;
}

/** Deterministic hue from any id — stable avatar/art colors, zero storage. */
export function hueFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "B") + (parts[1]?.[0] ?? "D")).toUpperCase();
}

export function slotPrice(bale: BaleListing): number {
  return Math.round(bale.totalAmount / bale.splitCount);
}

export function slotsLeft(bale: BaleListing): number {
  return Math.max(0, bale.splitCount - bale.bookedCount);
}

/* ---------- row mappers ---------- */

export function mapVendorRow(row: VendorRow): Vendor {
  return {
    id: row.id,
    shopName: row.shop_name,
    city: row.city ?? "Lagos",
    rating: row.rating_avg > 0 ? Number(row.rating_avg) : 5, // new shops show 5.0 until rated
    reviews: row.reviews_count,
    sales: row.sales_count,
    verified: row.verification_status === "approved" || row.verification_status === "inspected",
    inspected: row.verification_status === "inspected",
    responseTime: "~2 hrs",
    initials: initialsFor(row.shop_name),
    hue: hueFor(row.id),
  };
}

export function mapProductRow(row: ProductRow): Product {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    category: row.category,
    grade: (["A", "B", "C"].includes(row.grade) ? row.grade : "B") as Grade,
    price: row.price_naira,
    oldPrice: row.old_price_naira ?? undefined,
    city: row.city ?? "Lagos",
    vendorId: row.vendor_id,
    hue: hueFor(row.id),
    rating: row.rating_avg > 0 ? Number(row.rating_avg) : 5,
    sold: row.sold_count,
    isBale: row.kind === "bale",
    pieces: row.pieces_estimate ?? undefined,
  };
}

export function mapBaleRow(row: BaleRow, product: ProductRow, joiners: string[]): BaleListing {
  const expiresAt = Date.parse(row.expires_at);
  return {
    id: row.id,
    productId: row.product_id,
    totalAmount: row.total_naira,
    splitCount: row.split_count,
    bookedCount: row.booked_count,
    expiresInMs: Math.max(0, expiresAt - Date.now()),
    expiresAt,
    joiners,
    weight: product.weight_kg != null ? `${Number(product.weight_kg)}kg` : "—",
    pieces: product.pieces_estimate ?? "—",
    status: row.status === "open" ? "open" : "full",
  };
}
