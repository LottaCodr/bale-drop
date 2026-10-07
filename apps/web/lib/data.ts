/**
 * Server data-access layer. Reads never substitute sample data for live data.
 * All fetches are React-cached per request (metadata + page share one fetch).
 */
import { cache } from "react";
import { cookies } from "next/headers";
import {
  getBaleByProductId,
  getProductById,
  getVendorById,
  listOpenBales,
  listPaidBookings,
  listProductReviews,
  listProducts,
  listProductsByIds,
  listProductImages,
  listProductsByVendor,
  listVendorsByIds,
  listVendorReviews,
  mapBaleRow,
  mapProductRow,
  mapVendorRow,
  normalizeFilters,
  publicProductImageUrl,
  reviewAuthorLabel,
  searchProducts,
  slotsLeft,
  supabaseServer,
  type BaleListing,
  type Product,
  type ProductFilters,
  type Vendor,
} from "@bale-drop/database";
import { isSupabaseLive } from "./config";

export interface BaleLive {
  bale: BaleListing;
  product: Product;
  vendor: Vendor;
}

export interface ProductLive {
  product: Product;
  vendor: Vendor;
}

/**
 * First seller photo per product, as a public URL.
 *
 * Listings have always carried uploaded photos in `product_images` while the UI
 * rendered generated gradients, so a shop's real stock was invisible. One batched
 * query per page keeps this off the N+1 path; a listing with no photo simply
 * gets no entry and falls back to `ProductArt`.
 */
async function productImages(sb: Awaited<ReturnType<typeof authed>>, productIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (productIds.length === 0) return out;
  try {
    const paths = await listProductImages(sb, productIds);
    for (const [productId, list] of paths) {
      const url = publicProductImageUrl(list[0]);
      if (url) out.set(productId, url);
    }
  } catch (err) {
    // A missing photo must never take a page down with it.
    console.warn("[data] product images unavailable", err);
  }
  return out;
}

async function authed() {
  const store = await cookies();
  // Reads are public; set is a noop in server components (auth cookies are
  // written in route handlers / middleware once login lands).
  return supabaseServer({ getAll: () => store.getAll(), set: () => undefined });
}

export const getHomeData = cache(
  async (): Promise<{ bales: BaleLive[]; products: ProductLive[]; vendors: Vendor[] } | null> => {
    if (!isSupabaseLive()) return { bales: [], products: [], vendors: [] };
    try {
      const sb = await authed();
      const [baleRows, homeProductRows] = await Promise.all([
        listOpenBales(sb),
        listProducts(sb, { limit: 8 }),
      ]);
      const baleProducts = await listProductsByIds(sb, baleRows.map((b) => b.product_id));
      const productById = new Map(
        [...homeProductRows, ...baleProducts].map((p) => [p.id, p] as const)
      );
      const vendorRows = await listVendorsByIds(
        sb,
        [...new Set([...productById.values()].map((p) => p.vendor_id))]
      );
      const vendorById = new Map(vendorRows.map((v) => [v.id, mapVendorRow(v)] as const));
      const images = await productImages(sb, [...productById.keys()]);
      const bookings = await listPaidBookings(
        sb,
        baleRows.map((b) => b.id)
      );
      const joinersByBale = new Map<string, string[]>();
      for (const bk of bookings) {
        if (!bk.display_label) continue;
        const arr = joinersByBale.get(bk.bale_id) ?? [];
        arr.push(bk.display_label);
        joinersByBale.set(bk.bale_id, arr);
      }

      const bales: BaleLive[] = [];
      for (const row of baleRows) {
        const prow = productById.get(row.product_id);
        const vendor = prow && vendorById.get(prow.vendor_id);
        if (!prow || !vendor) continue;
        const bale = mapBaleRow(row, prow, joinersByBale.get(row.id) ?? []);
        const product = {
          ...mapProductRow(prow, images.get(prow.id)),
          tag: slotsLeft(bale) <= 1 ? "Almost full" : "Splitting now",
        };
        bales.push({ bale, product, vendor });
      }
      const products: ProductLive[] = [];
      for (const prow of homeProductRows) {
        const vendor = vendorById.get(prow.vendor_id);
        if (!vendor) continue;
        products.push({ product: mapProductRow(prow, images.get(prow.id)), vendor });
      }
      return { bales, products, vendors: [...vendorById.values()] };
    } catch (err) {
      console.error("[data] home unavailable", err);
      return null;
    }
  }
);

export interface ListingData {
  product: Product;
  vendor: Vendor;
  bale: BaleLive | null;
  related: ProductLive[];
}

export const getListingData = cache(async (id: string): Promise<ListingData | null> => {
  if (!isSupabaseLive()) return null;
  try {
    const sb = await authed();
    const prow = await getProductById(sb, id);
    if (!prow) return null;
    const [vrows, baleRow, relatedRows] = await Promise.all([
      listVendorsByIds(sb, [prow.vendor_id]),
      getBaleByProductId(sb, prow.id),
      listProducts(sb, { limit: 5 }),
    ]);
    const vrow = vrows[0];
    if (!vrow) return null;
    const vendor = mapVendorRow(vrow);
    const images = await productImages(sb, [prow.id, ...relatedRows.map((row) => row.id)]);
    const product = mapProductRow(prow, images.get(prow.id));

    let bale: BaleLive | null = null;
    if (baleRow) {
      const bookings = await listPaidBookings(sb, [baleRow.id]);
      const joiners = bookings
        .map((b) => b.display_label)
        .filter((x): x is string => !!x);
      bale = { bale: mapBaleRow(baleRow, prow, joiners), product, vendor };
    }

    const relVendorRows = await listVendorsByIds(sb, [
      ...new Set(relatedRows.map((p) => p.vendor_id)),
    ]);
    const relVendorById = new Map(relVendorRows.map((v) => [v.id, mapVendorRow(v)] as const));
    const related: ProductLive[] = [];
    for (const p of relatedRows) {
      if (p.id === id) continue;
      const v = relVendorById.get(p.vendor_id);
      if (!v) continue;
      related.push({ product: mapProductRow(p, images.get(p.id)), vendor: v });
      if (related.length >= 4) break;
    }
    return { product, vendor, bale, related };
  } catch (err) {
    console.error("[data] listing unavailable", err);
    return null;
  }
});

/* ============================================================================
 * Discovery + engagement reads (search, storefront, reviews, cart reconcile)
 * ========================================================================== */

export interface SearchResults {
  results: ProductLive[];
  /** Total matches before the limit was applied. */
  total: number;
  /** Total pages for the current limit — the pager's denominator. */
  pages: number;
  /** Rows skipped to produce this page. */
  offset: number;
  /** Category → count, for the filter rail. */
  categoryCounts: Record<string, number>;
  vendors: Vendor[];
  /** Live splits among the results — real counters, never invented urgency. */
  splits: BaleLive[];
}

/**
 * Catalog search against the live store only.
 */
export const searchCatalog = cache(async (filters: ProductFilters): Promise<SearchResults | null> => {
  const normalized = normalizeFilters(filters);
  if (!isSupabaseLive()) return emptySearchResults();

  try {
    const sb = await authed();
    const { rows, total, offset, pages } = await searchProducts(sb, normalized);
    const vendorRows = await listVendorsByIds(sb, [...new Set(rows.map((row) => row.vendor_id))]);
    const vendorById = new Map(vendorRows.map((vendor) => [vendor.id, mapVendorRow(vendor)] as const));
    const images = await productImages(sb, rows.map((row) => row.id));
    const results: ProductLive[] = [];
    for (const row of rows) {
      const vendor = vendorById.get(row.vendor_id);
      if (!vendor) continue;
      results.push({ product: mapProductRow(row, images.get(row.id)), vendor });
    }
    // One extra query beats N: fetch open splits and keep the ones on screen.
    const baleRows = await listOpenBales(sb);
    const byProduct = new Map(rows.map((row) => [row.id, row] as const));
    const splits: BaleLive[] = [];
    for (const baleRow of baleRows) {
      const productRow = byProduct.get(baleRow.product_id);
      const vendor = productRow ? vendorById.get(productRow.vendor_id) : undefined;
      if (!productRow || !vendor) continue;
      const bookings = await listPaidBookings(sb, [baleRow.id]);
      const joiners = bookings.map((booking) => booking.display_label).filter((label): label is string => !!label);
      splits.push({
        bale: mapBaleRow(baleRow, productRow, joiners),
        product: mapProductRow(productRow, images.get(productRow.id)),
        vendor,
      });
    }

    return {
      results,
      // `total` is the number of matching listings, not the size of the page
      // (the mock path has always meant that; the two must agree).
      total,
      // Both come from `search_products`, which computes them in the same
      // statement as the rows — never re-derived here from the page length.
      pages,
      offset,
      categoryCounts: countCategories(results.map((entry) => entry.product)),
      vendors: [...vendorById.values()],
      splits,
    };
  } catch (err) {
    console.error("[data] search unavailable", err);
    return null;
  }
});

function emptySearchResults(): SearchResults {
  return { results: [], total: 0, pages: 1, offset: 0, categoryCounts: {}, vendors: [], splits: [] };
}

function countCategories(products: { category: string }[]): Record<string, number> {
  const counts: Record<string, number> = { All: products.length };
  for (const product of products) counts[product.category] = (counts[product.category] ?? 0) + 1;
  return counts;
}

export interface ReviewView {
  id: string;
  productId: string | null;
  rating: number;
  body: string | null;
  createdAt: string;
  author: string;
  initials: string;
  hue: number;
}

export interface ReviewViewSummary {
  reviews: ReviewView[];
  average: number;
  count: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}

/** Product reviews for the listing page (public read; buyers are anonymized). */
export const getProductReviews = cache(async (productId: string): Promise<ReviewViewSummary> => {
  if (!isSupabaseLive()) return emptyReviewSummary();
  try {
    const sb = await authed();
    const summary = await listProductReviews(sb, productId);
    return {
      reviews: summary.reviews.map((review) => {
        const author = reviewAuthorLabel(review.buyer_id);
        return {
          id: review.id,
          productId: review.product_id,
          rating: review.rating,
          body: review.body,
          createdAt: review.created_at,
          author: author.label,
          initials: author.initials,
          hue: author.hue,
        };
      }),
      average: summary.average,
      count: summary.count,
      distribution: summary.distribution,
    };
  } catch (err) {
    console.error("[data] reviews unavailable", err);
    return emptyReviewSummary();
  }
});

function emptyReviewSummary(): ReviewViewSummary {
  return { reviews: [], average: 0, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
}

export interface VendorStorefront {
  vendor: Vendor;
  products: ProductLive[];
  splits: BaleLive[];
  reviews: ReviewViewSummary;
}

/** Public shop page: `/vendor/[id]`. */
export const getVendorStorefront = cache(async (vendorId: string): Promise<VendorStorefront | null> => {
  if (!isSupabaseLive()) return null;

  try {
    const sb = await authed();
    const vendorRow = await getVendorById(sb, vendorId);
    if (!vendorRow) return null;
    const vendor = mapVendorRow(vendorRow);
    const [productRows, reviewSummary] = await Promise.all([
      listProductsByVendor(sb, vendorId),
      listVendorReviews(sb, vendorId),
    ]);
    const images = await productImages(sb, productRows.map((row) => row.id));
    const products: ProductLive[] = productRows.map((row) => ({
      product: mapProductRow(row, images.get(row.id)),
      vendor,
    }));

    const splits: BaleLive[] = [];
    for (const row of productRows) {
      const baleRow = await getBaleByProductId(sb, row.id);
      if (!baleRow || baleRow.status !== "open") continue;
      const bookings = await listPaidBookings(sb, [baleRow.id]);
      const joiners = bookings.map((booking) => booking.display_label).filter((label): label is string => !!label);
      splits.push({ bale: mapBaleRow(baleRow, row, joiners), product: mapProductRow(row, images.get(row.id)), vendor });
    }

    return {
      vendor,
      products,
      splits,
      reviews: {
        reviews: reviewSummary.reviews.map((review) => {
          const author = reviewAuthorLabel(review.buyer_id);
          return {
            id: review.id,
            productId: review.product_id,
            rating: review.rating,
            body: review.body,
            createdAt: review.created_at,
            author: author.label,
            initials: author.initials,
            hue: author.hue,
          };
        }),
        average: reviewSummary.average,
        count: reviewSummary.count,
        distribution: reviewSummary.distribution,
      },
    };
  } catch (err) {
    console.error("[data] vendor unavailable", err);
    return null;
  }
});

/**
 * Re-price a set of product ids against the live catalog.
 * Used by the cart and checkout to prove the price the buyer saw is still the
 * price we will charge — the actual charge is always computed by
 * `paystack-initialize` on the server.
 */
export async function getProductsByIds(ids: string[]): Promise<Map<string, ProductLive>> {
  const out = new Map<string, ProductLive>();
  if (ids.length === 0) return out;
  if (!isSupabaseLive()) return out;

  try {
    const sb = await authed();
    const [rows, baleRows] = await Promise.all([listProductsByIds(sb, ids), listOpenBales(sb)]);
    const activeBaleProducts = new Set(baleRows.map((row) => row.product_id));
    const vendorRows = await listVendorsByIds(sb, [...new Set(rows.map((row) => row.vendor_id))]);
    const vendorById = new Map(vendorRows.map((vendor) => [vendor.id, mapVendorRow(vendor)] as const));
    const images = await productImages(sb, rows.map((row) => row.id));
    for (const row of rows) {
      const vendor = vendorById.get(row.vendor_id);
      if (!vendor) continue;
      const product = mapProductRow(row, images.get(row.id));
      // Split listings are sold per slot, not per unit — surface that in the cart.
      out.set(row.id, { product: activeBaleProducts.has(row.id) ? { ...product, tag: "Bale split" } : product, vendor });
    }
    return out;
  } catch (err) {
    console.warn("[data] live cart reconcile failed", err);
    return out;
  }
}

/* ============================================================================
 * Receipt (migration-era gap: the money record must exist outside the browser)
 * ========================================================================== */

export interface ReceiptLine {
  title: string;
  qty: number;
  unit: number;
  productId: string | null;
}

export interface ReceiptEvent {
  status: string;
  note: string | null;
  at: string;
}

export interface ReceiptMoney {
  kind: string;
  amount: number;
  at: string;
  reference: string | null;
}

export interface OrderReceipt {
  id: string;
  reference: string;
  placedAt: string;
  status: string;
  escrow: string;
  subtotal: number;
  deliveryFee: number;
  subsidy: number;
  total: number;
  shipping: { address: string | null; city: string | null; phone: string | null };
  vendor: Vendor | null;
  lines: ReceiptLine[];
  timeline: ReceiptEvent[];
  /** The append-only ledger rows this buyer is allowed to see (own orders). */
  ledger: ReceiptMoney[];
  paystackReference: string | null;
  tracking: { number: string | null; url: string | null };
  deliveredAt: string | null;
  escrowReleaseAt: string | null;
  refund: { amount: number; status: string; at: string | null } | null;
}

/**
 * One order, as a receipt.
 *
 * Read through the buyer's own session, so RLS decides visibility: `orders`,
 * `order_items`, `order_timeline`, `transactions` (read-own) and `order_refunds`
 * (buyer read) all have buyer policies, and nothing here needs service_role.
 * Returns null when the order is not the caller's — the page then 404s rather
 * than leaking that the id exists.
 */
export const getOrderReceipt = cache(async (orderId: string): Promise<OrderReceipt | null> => {
  if (!isSupabaseLive()) return null;
  try {
    const sb = await authed();
    const { data: orderRow, error } = await sb
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .maybeSingle();
    if (error || !orderRow) return null;

    const [{ data: itemRows }, { data: timelineRows }, { data: ledgerRows }, { data: refundRows }, vendorRows] =
      await Promise.all([
        sb.from("order_items").select("*").eq("order_id", orderId).order("created_at", { ascending: true }),
        sb.from("order_timeline").select("status, note, created_at").eq("order_id", orderId).order("created_at", { ascending: true }),
        sb.from("transactions").select("kind, amount_naira, created_at, paystack_reference").eq("order_id", orderId).order("created_at", { ascending: true }),
        sb.from("order_refunds").select("amount_naira, status, created_at").eq("order_id", orderId).order("created_at", { ascending: false }).limit(1),
        listVendorsByIds(sb, [orderRow.vendor_id]),
      ]);

    const refund = (refundRows ?? [])[0] as
      | { amount_naira: number; status: string; created_at: string | null }
      | undefined;

    return {
      id: orderRow.id,
      reference: `BD-${orderRow.id.slice(0, 6).toUpperCase()}`,
      placedAt: orderRow.created_at,
      status: orderRow.status,
      escrow: orderRow.escrow_status,
      subtotal: orderRow.subtotal_naira,
      deliveryFee: orderRow.delivery_fee_naira,
      subsidy: orderRow.subsidy_naira,
      total: orderRow.total_naira,
      shipping: {
        address: orderRow.shipping_address_snapshot,
        city: orderRow.shipping_city,
        phone: orderRow.shipping_phone,
      },
      vendor: vendorRows[0] ? mapVendorRow(vendorRows[0]) : null,
      lines: ((itemRows ?? []) as { title_snapshot: string; qty: number; unit_naira: number; product_id: string | null }[]).map(
        (item) => ({ title: item.title_snapshot, qty: item.qty, unit: item.unit_naira, productId: item.product_id }),
      ),
      timeline: ((timelineRows ?? []) as { status: string; note: string | null; created_at: string }[]).map((entry) => ({
        status: entry.status,
        note: entry.note,
        at: entry.created_at,
      })),
      ledger: ((ledgerRows ?? []) as { kind: string; amount_naira: number; created_at: string; paystack_reference: string | null }[]).map(
        (entry) => ({ kind: entry.kind, amount: entry.amount_naira, at: entry.created_at, reference: entry.paystack_reference }),
      ),
      paystackReference: orderRow.paystack_reference,
      tracking: { number: orderRow.tracking_number, url: orderRow.tracking_url },
      deliveredAt: orderRow.delivered_at,
      escrowReleaseAt: orderRow.escrow_release_at,
      refund: refund ? { amount: refund.amount_naira, status: refund.status, at: refund.created_at } : null,
    };
  } catch (err) {
    console.error("[data] receipt unavailable", err);
    return null;
  }
});
