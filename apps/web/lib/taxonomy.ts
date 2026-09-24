/**
 * Catalog taxonomy — the single source of truth for the filter vocabulary.
 *
 * Filter chips, the search page, vendor onboarding, the admin console and the
 * mock dataset all read from here. Client components import this module (it is
 * dependency-free) instead of pulling the demo dataset into the browser bundle.
 */

export const CITIES = ["Lagos", "Abuja", "Port Harcourt", "Kano"] as const;
export type City = (typeof CITIES)[number];

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
export type Category = (typeof CATEGORIES)[number];

export const GRADES = ["A", "B", "C"] as const;
export type Grade = (typeof GRADES)[number];

export const LISTING_KINDS = ["bale", "single"] as const;
export type ListingKind = (typeof LISTING_KINDS)[number];

// Sort keys + labels are owned by the shared package so the SQL path and the
// in-browser path can never disagree about "price_asc".
export {
  PRODUCT_SORTS as SORTS,
  SORT_LABELS,
  type ProductSort as SortKey,
} from "@bale-drop/database";

/** Delivery options shared by the cart, checkout and order summaries. */
export const DELIVERY_METHODS = [
  { id: "standard", name: "Standard", eta: "2–4 days", fee: 2500 },
  { id: "express", name: "Express", eta: "Next day (Lagos)", fee: 4500 },
] as const;
export type DeliveryMethodId = (typeof DELIVERY_METHODS)[number]["id"];

/** Launch promo: subsidised delivery, capped at the delivery fee. */
export const DELIVERY_SUBSIDY_NAIRA = 1500;

export function deliveryFee(method: DeliveryMethodId): number {
  return DELIVERY_METHODS.find((entry) => entry.id === method)?.fee ?? DELIVERY_METHODS[0].fee;
}

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

export function isCity(value: string): value is City {
  return (CITIES as readonly string[]).includes(value);
}

/** Free-text → category, re-exported from the shared search module. */
export { SEARCH_SYNONYMS } from "@bale-drop/database";
