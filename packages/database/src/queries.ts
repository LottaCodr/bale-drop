/**
 * Read queries + transactional writes against Supabase.
 * Simple, batched, type-safe selects (no deep embedding) — fast enough at
 * MVP scale and trivially portable to React Native (same client, same calls).
 */
import type { DbClient } from "./types";
import { hueFor, type BaleRow, type ProductRow, type VendorRow } from "./domain";
import {
  escapeLikePattern,
  normalizeFilters,
  PRODUCT_SORTS,
  sanitizeRemoteQuery,
  type ProductFilters,
  type ProductSort,
} from "./search";

export interface PaidBookingLabel {
  bale_id: string;
  display_label: string | null;
}

/** Live splits, soonest-expiring first (urgency ordering). */
export async function listOpenBales(client: DbClient): Promise<BaleRow[]> {
  const { data, error } = await client
    .from("bale_listings")
    .select("*")
    .eq("status", "open")
    .order("expires_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function getBaleByProductId(client: DbClient, productId: string): Promise<BaleRow | null> {
  const { data, error } = await client
    .from("bale_listings")
    .select("*")
    .eq("product_id", productId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listProducts(client: DbClient, opts?: { limit?: number }): Promise<ProductRow[]> {
  const { data, error } = await client
    .from("products")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 50);
  if (error) throw error;
  return data;
}

export async function listProductsByIds(client: DbClient, ids: string[]): Promise<ProductRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client.from("products").select("*").in("id", ids);
  if (error) throw error;
  return data;
}

export async function getProductById(client: DbClient, id: string): Promise<ProductRow | null> {
  const { data, error } = await client.from("products").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listVendorsByIds(client: DbClient, ids: string[]): Promise<VendorRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client.from("vendor_profiles").select("*").in("id", ids);
  if (error) throw error;
  return data;
}

/** Paid slot labels per bale — powers the live slot chips (no PII). */
export async function listPaidBookings(client: DbClient, baleIds: string[]): Promise<PaidBookingLabel[]> {
  if (baleIds.length === 0) return [];
  const { data, error } = await client
    .from("bale_bookings")
    .select("bale_id, display_label")
    .in("bale_id", baleIds)
    .eq("status", "paid")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export interface ClaimResult {
  booking_id: string;
  booked_count: number;
  status: string;
}

/**
 * Transactional slot claim (requires authenticated buyer; RLS + RPC enforce
 * one-slot-per-buyer, open status, expiry, capacity). Call BEFORE Paystack
 * payment — booking starts `pending`, webhook flips to `paid`.
 */
export async function claimSlot(
  client: DbClient,
  baleId: string
): Promise<{ booking: ClaimResult | null; error: string | null }> {
  const { data, error } = await client.rpc("claim_bale_slot", { p_bale_id: baleId });
  if (error) return { booking: null, error: error.message };
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { booking: null, error: "Unexpected claim response" };
  }
  const booking = data as unknown as ClaimResult;
  return { booking, error: null };
}

/* ============================================================================
 * Catalog search, storefront, reviews, wishlist
 * (added with the discovery + state-management work — see docs/ROADMAP.md)
 * ========================================================================== */

/**
 * Apply the filter half of a search to a `products` select.
 *
 * This is the *fallback* path. Ranking, synonyms and paging live in
 * `search_products()` (migration 0026); PostgREST can only do the flat filter,
 * so it is used when that function is missing (an unmigrated database) and
 * nowhere else.
 */
function filteredProducts(client: DbClient, filters: ProductFilters) {
  let query = client.from("products").select("*", { count: "exact" }).eq("status", "active");

  if (filters.category) query = query.eq("category", filters.category);
  if (filters.city) query = query.eq("city", filters.city);
  if (filters.grade) query = query.eq("grade", filters.grade);
  if (filters.kind) query = query.eq("kind", filters.kind);
  if (filters.vendorId) query = query.eq("vendor_id", filters.vendorId);
  if (filters.minNaira !== undefined) query = query.gte("price_naira", filters.minNaira);
  if (filters.maxNaira !== undefined) query = query.lte("price_naira", filters.maxNaira);
  if (filters.query) {
    // PostgREST filter grammar is raw SQL-ish text: strip operator characters
    // before escaping LIKE wildcards so a buyer cannot reshape the filter.
    const term = sanitizeRemoteQuery(filters.query);
    if (term) {
      const pattern = `%${escapeLikePattern(term)}%`;
      query = query.or(`title.ilike.${pattern},category.ilike.${pattern},description.ilike.${pattern}`);
    }
  }

  return query;
}

export interface ProductPage {
  rows: ProductRow[];
  /** Total matching listings ignoring `limit` — for "N results", not the page size. */
  total: number;
  /** Rows skipped before this page. */
  offset: number;
  /** `ceil(total / limit)` — the pager needs this, and it must agree with `total`. */
  pages: number;
  /** The sort the database actually applied (it defaults to relevance for a query). */
  sort: ProductSort;
}

/** Shape returned by `search_products()` (migration 0026). */
interface SearchRpcResult {
  rows?: ProductRow[];
  total?: number;
  limit?: number;
  offset?: number;
  sort?: string;
  pages?: number;
}

/**
 * Live catalog search: one RPC, ranked in Postgres.
 *
 * `search_products()` owns relevance (tsvector rank + exact-substring bonus +
 * `search_synonyms` category boost + a small popularity nudge), the sort keys,
 * the paging and the exact total. Keeping all of that server-side is what makes
 * "N results" agree with the page it labels, and it means a buyer's punctuation
 * is sanitized by the same code path that runs the query.
 *
 * `filterProducts()` in ./search.ts remains the demo-mode equivalent, and the
 * unit tests are what stop the two from drifting apart.
 */
export async function searchProducts(
  client: DbClient,
  rawFilters: ProductFilters = {}
): Promise<ProductPage> {
  const filters = normalizeFilters(rawFilters);
  const limit = filters.limit ?? 40;
  const offset = Math.max(0, Math.round(filters.offset ?? 0));

  const { data, error } = await client.rpc("search_products", {
    p_query: filters.query ?? null,
    p_category: filters.category ?? null,
    p_city: filters.city ?? null,
    p_grade: filters.grade ?? null,
    p_kind: filters.kind ?? null,
    p_vendor_id: filters.vendorId ?? null,
    p_min_naira: filters.minNaira ?? null,
    p_max_naira: filters.maxNaira ?? null,
    p_sort: filters.sort ?? null,
    p_limit: limit,
    p_offset: offset,
  });

  // 42883 = undefined_function. An unmigrated database still gets results
  // (unranked) instead of an empty catalog; anything else is a real failure.
  if (error && error.code !== "42883") throw error;
  if (!error) {
    const result = (data ?? {}) as SearchRpcResult;
    const rows = Array.isArray(result.rows) ? result.rows : [];
    const total = Number(result.total ?? rows.length);
    const appliedLimit = Number(result.limit ?? limit) || limit;
    return {
      rows,
      total,
      offset: Number(result.offset ?? offset),
      pages: Number(result.pages ?? Math.max(1, Math.ceil(total / appliedLimit))),
      sort: (PRODUCT_SORTS as readonly string[]).includes(result.sort ?? "")
        ? (result.sort as ProductSort)
        : (filters.sort ?? "newest"),
    };
  }

  return searchProductsFallback(client, filters, limit, offset);
}

async function searchProductsFallback(
  client: DbClient,
  filters: ProductFilters,
  limit: number,
  offset: number
): Promise<ProductPage> {
  let query = filteredProducts(client, filters);

  switch (filters.sort) {
    case "price_asc":
      query = query.order("price_naira", { ascending: true });
      break;
    case "price_desc":
      query = query.order("price_naira", { ascending: false });
      break;
    case "rating":
      query = query.order("rating_avg", { ascending: false }).order("sold_count", { ascending: false });
      break;
    case "relevance":
      // Without the tsvector rank there is no honest relevance order;
      // popularity is the least-wrong proxy.
      query = query.order("sold_count", { ascending: false });
      break;
    case "newest":
    default:
      query = query.order("created_at", { ascending: false });
      break;
  }

  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) throw error;
  const rows = data ?? [];
  const total = count ?? rows.length;
  return {
    rows,
    total,
    offset,
    pages: Math.max(1, Math.ceil(total / limit)),
    sort: filters.sort ?? "newest",
  };
}

/**
 * Seller photos for a set of listings, one query.
 *
 * `product_images` rows are written when a listing is created, and the bucket is
 * public-read, so the caller turns each `storage_path` into a URL with
 * `publicProductImageUrl()`. Returns a map keyed by product id, lowest
 * `sort_order` first — the first entry is the card image.
 */
export async function listProductImages(
  client: DbClient,
  productIds: string[]
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (productIds.length === 0) return out;
  const { data, error } = await client
    .from("product_images")
    .select("product_id, storage_path, sort_order")
    .in("product_id", productIds)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  for (const row of (data ?? []) as { product_id: string; storage_path: string }[]) {
    const bucket = out.get(row.product_id) ?? [];
    bucket.push(row.storage_path);
    out.set(row.product_id, bucket);
  }
  return out;
}

export async function getVendorById(client: DbClient, id: string): Promise<VendorRow | null> {
  const { data, error } = await client.from("vendor_profiles").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listProductsByVendor(
  client: DbClient,
  vendorId: string,
  opts?: { limit?: number; includePending?: boolean }
): Promise<ProductRow[]> {
  let query = client.from("products").select("*").eq("vendor_id", vendorId);
  if (!opts?.includePending) query = query.eq("status", "active");
  const { data, error } = await query.order("created_at", { ascending: false }).limit(opts?.limit ?? 40);
  if (error) throw error;
  return data;
}

export interface ReviewRowLite {
  id: string;
  order_id: string;
  buyer_id: string;
  product_id: string | null;
  rating: number;
  body: string | null;
  created_at: string;
}

export interface ReviewSummary {
  reviews: ReviewRowLite[];
  average: number;
  count: number;
  /** rating → number of reviews */
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}

export function summarizeReviews(reviews: ReviewRowLite[]): ReviewSummary {
  const distribution: ReviewSummary["distribution"] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;
  for (const review of reviews) {
    const bucket = Math.min(5, Math.max(1, Math.round(review.rating))) as 1 | 2 | 3 | 4 | 5;
    distribution[bucket] += 1;
    total += bucket;
  }
  return {
    reviews,
    count: reviews.length,
    average: reviews.length ? Math.round((total / reviews.length) * 10) / 10 : 0,
    distribution,
  };
}

const REVIEW_COLUMNS = "id, order_id, buyer_id, product_id, rating, body, created_at";

/** Product reviews — public read (reviews table policy), newest first. */
export async function listProductReviews(
  client: DbClient,
  productId: string,
  limit = 20
): Promise<ReviewSummary> {
  const { data, error } = await client
    .from("reviews")
    .select(REVIEW_COLUMNS)
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return summarizeReviews((data ?? []) as ReviewRowLite[]);
}

/** Vendor reviews — powers the shop page's rating breakdown. */
export async function listVendorReviews(
  client: DbClient,
  vendorId: string,
  limit = 30
): Promise<ReviewSummary> {
  const { data, error } = await client
    .from("reviews")
    .select(REVIEW_COLUMNS)
    .eq("vendor_id", vendorId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return summarizeReviews((data ?? []) as ReviewRowLite[]);
}

/**
 * Display label for a review author. `profiles` is read-own-only under RLS, so
 * buyer names are deliberately NOT joined here — we show a stable initials
 * avatar instead of leaking identities (see docs/ROADMAP.md → nice-to-haves:
 * a SECURITY DEFINER view can expose display names later).
 */
export function reviewAuthorLabel(buyerId: string): { initials: string; label: string; hue: number } {
  const seed = buyerId.replace(/[^a-z0-9]/gi, "").toUpperCase();
  const initials = (seed.slice(0, 2) || "BD").padEnd(2, "D");
  return { initials, label: "Verified buyer", hue: hueFor(buyerId) };
}

/* ---------------- wishlist (migration 0018) ---------------- */

export async function listWishlistProductIds(client: DbClient, profileId: string): Promise<string[]> {
  const { data, error } = await client
    .from("wishlists")
    .select("product_id, created_at")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map((row) => row.product_id);
}

export async function addWishlistProduct(client: DbClient, profileId: string, productId: string): Promise<void> {
  const { error } = await client
    .from("wishlists")
    .upsert({ profile_id: profileId, product_id: productId }, { onConflict: "profile_id,product_id" });
  if (error) throw error;
}

export async function removeWishlistProduct(client: DbClient, profileId: string, productId: string): Promise<void> {
  const { error } = await client
    .from("wishlists")
    .delete()
    .eq("profile_id", profileId)
    .eq("product_id", productId);
  if (error) throw error;
}
