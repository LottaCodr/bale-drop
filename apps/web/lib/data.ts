/**
 * Server data-access layer (imports next/headers — server components only).
 *
 * Strategy: live Supabase when configured, mock dataset otherwise; live
 * failures also fall back to mock so a DB blip never whitescreens the store.
 * All fetches are React-cached per request (metadata + page share one fetch).
 */
import { cache } from "react";
import { cookies } from "next/headers";
import {
  filterProducts,
  getBaleByProductId,
  getProductById,
  getVendorById,
  listOpenBales,
  listPaidBookings,
  listProductReviews,
  listProducts,
  listProductsByIds,
  listProductsByVendor,
  listVendorsByIds,
  listVendorReviews,
  mapBaleRow,
  mapProductRow,
  mapVendorRow,
  normalizeFilters,
  reviewAuthorLabel,
  searchProducts,
  searchViewOfProduct,
  slotsLeft,
  supabaseServer,
  type BaleListing,
  type Product,
  type ProductFilters,
  type Vendor,
} from "@bale-drop/database";
import { isSupabaseLive } from "./config";
import {
  BALES,
  PRODUCTS,
  VENDORS,
  getBale as mockGetBale,
  getProduct as mockGetProduct,
  getProductOrNull,
  getProductsByVendor,
  getReviewsForProduct,
  getReviewsForVendor,
  getVendor as mockGetVendor,
  getVendorOrNull,
  type MockReview,
} from "./mock";

export interface BaleLive {
  bale: BaleListing;
  product: Product;
  vendor: Vendor;
}

export interface ProductLive {
  product: Product;
  vendor: Vendor;
}

async function authed() {
  const store = await cookies();
  // Reads are public; set is a noop in server components (auth cookies are
  // written in route handlers / middleware once login lands).
  return supabaseServer({ getAll: () => store.getAll(), set: () => undefined });
}

function mockHome(): { bales: BaleLive[]; products: ProductLive[]; vendors: Vendor[] } {
  const productById = new Map(PRODUCTS.map((p) => [p.id, p]));
  const vendorById = new Map(VENDORS.map((v) => [v.id, v]));
  return {
    bales: BALES.map((b) => {
      const product = productById.get(b.productId)!;
      return { bale: b, product, vendor: vendorById.get(product.vendorId)! };
    }),
    products: PRODUCTS.map((p) => ({ product: p, vendor: vendorById.get(p.vendorId)! })),
    vendors: VENDORS,
  };
}

function mockListing(id: string): ListingData | null {
  const product = PRODUCTS.find((p) => p.id === id);
  if (!product) return null;
  const vendor = mockGetVendor(product.vendorId);
  const b = BALES.find((x) => x.productId === id) ?? null;
  return {
    product,
    vendor,
    bale: b ? { bale: b, product, vendor } : null,
    related: PRODUCTS.filter((p) => p.id !== id)
      .slice(0, 4)
      .map((p) => ({ product: p, vendor: mockGetVendor(p.vendorId) })),
  };
}

export const getHomeData = cache(
  async (): Promise<{ bales: BaleLive[]; products: ProductLive[]; vendors: Vendor[] }> => {
    if (!isSupabaseLive()) return mockHome();
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
          ...mapProductRow(prow),
          tag: slotsLeft(bale) <= 1 ? "Almost full" : "Splitting now",
        };
        bales.push({ bale, product, vendor });
      }
      const products: ProductLive[] = [];
      for (const prow of homeProductRows) {
        const vendor = vendorById.get(prow.vendor_id);
        if (!vendor) continue;
        products.push({ product: mapProductRow(prow), vendor });
      }
      return { bales, products, vendors: [...vendorById.values()] };
    } catch (err) {
      console.warn("[data] live fetch failed — mock fallback", err);
      return mockHome();
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
  if (!isSupabaseLive()) return mockListing(id);
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
    const product = mapProductRow(prow);

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
      related.push({ product: mapProductRow(p), vendor: v });
      if (related.length >= 4) break;
    }
    return { product, vendor, bale, related };
  } catch (err) {
    console.warn("[data] live fetch failed — mock fallback", err);
    return mockListing(id);
  }
});

// Re-export mock getters for cart/orders (live user orders land with auth).
export { mockGetBale, mockGetProduct, mockGetVendor };

/* ============================================================================
 * Discovery + engagement reads (search, storefront, reviews, cart reconcile)
 * ========================================================================== */

export interface SearchResults {
  results: ProductLive[];
  /** Total matches before the limit was applied. */
  total: number;
  /** Category → count, for the filter rail. */
  categoryCounts: Record<string, number>;
  vendors: Vendor[];
  /** Live splits among the results — real counters, never invented urgency. */
  splits: BaleLive[];
}

function mockSearchView(): (ReturnType<typeof searchViewOfProduct> & { product: Product })[] {
  return PRODUCTS.map((product, index) => ({
    ...searchViewOfProduct(product, PRODUCTS.length - index),
    product,
  }));
}

/**
 * Catalog search — live Postgres query or the in-memory demo equivalent.
 * Both paths run through the same `ProductFilters` contract (see
 * packages/database/src/search.ts) so demo mode never hides a filter bug.
 */
export const searchCatalog = cache(async (filters: ProductFilters): Promise<SearchResults> => {
  const normalized = normalizeFilters(filters);
  if (!isSupabaseLive()) {
    const views = mockSearchView();
    const matches = filterProducts(views, { ...normalized, limit: undefined });
    const vendorById = new Map(VENDORS.map((vendor) => [vendor.id, vendor]));
    const limited = normalized.limit ? matches.slice(0, normalized.limit) : matches;
    const results: ProductLive[] = [];
    for (const view of limited) {
      const vendor = vendorById.get(view.product.vendorId);
      if (vendor) results.push({ product: view.product, vendor });
    }
    return {
      results,
      total: matches.length,
      categoryCounts: countCategories(matches),
      vendors: [...vendorById.values()],
      splits: mockSplitsFor(results),
    };
  }

  try {
    const sb = await authed();
    const { rows, total } = await searchProducts(sb, normalized);
    const vendorRows = await listVendorsByIds(sb, [...new Set(rows.map((row) => row.vendor_id))]);
    const vendorById = new Map(vendorRows.map((vendor) => [vendor.id, mapVendorRow(vendor)] as const));
    const results: ProductLive[] = [];
    for (const row of rows) {
      const vendor = vendorById.get(row.vendor_id);
      if (!vendor) continue;
      results.push({ product: mapProductRow(row), vendor });
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
      splits.push({ bale: mapBaleRow(baleRow, productRow, joiners), product: mapProductRow(productRow), vendor });
    }

    return {
      results,
      // `total` is the number of matching listings, not the size of the page
      // (the mock path has always meant that; the two must agree).
      total: total,
      categoryCounts: countCategories(results.map((entry) => entry.product)),
      vendors: [...vendorById.values()],
      splits,
    };
  } catch (err) {
    console.warn("[data] live search failed — mock fallback", err);
    return searchCatalogMock(normalized);
  }
});

function searchCatalogMock(normalized: ProductFilters): SearchResults {
  const matches = filterProducts(mockSearchView(), { ...normalized, limit: undefined });
  const vendorById = new Map(VENDORS.map((vendor) => [vendor.id, vendor]));
  const results: ProductLive[] = [];
  for (const view of normalized.limit ? matches.slice(0, normalized.limit) : matches) {
    const vendor = vendorById.get(view.product.vendorId);
    if (vendor) results.push({ product: view.product, vendor });
  }
  return {
    results,
    total: matches.length,
    categoryCounts: countCategories(matches),
    vendors: [...vendorById.values()],
    splits: mockSplitsFor(results),
  };
}

function mockSplitsFor(results: ProductLive[]): BaleLive[] {
  const onScreen = new Map(results.map((entry) => [entry.product.id, entry] as const));
  const splits: BaleLive[] = [];
  for (const bale of BALES) {
    const entry = onScreen.get(bale.productId);
    if (entry) splits.push({ bale, product: entry.product, vendor: entry.vendor });
  }
  return splits;
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
  if (!isSupabaseLive()) return mockReviewSummary(getReviewsForProduct(productId));
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
    console.warn("[data] live reviews failed — mock fallback", err);
    return mockReviewSummary(getReviewsForProduct(productId));
  }
});

function mockReviewSummary(reviews: MockReview[]): ReviewViewSummary {
  const distribution: ReviewViewSummary["distribution"] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;
  for (const review of reviews) {
    distribution[review.rating] += 1;
    total += review.rating;
  }
  return {
    reviews: reviews.map((review) => ({
      id: review.id,
      productId: review.productId,
      rating: review.rating,
      body: review.body,
      createdAt: new Date(review.date).toISOString(),
      author: review.author,
      initials: review.initials,
      hue: review.hue,
    })),
    count: reviews.length,
    average: reviews.length ? Math.round((total / reviews.length) * 10) / 10 : 0,
    distribution,
  };
}

export interface VendorStorefront {
  vendor: Vendor;
  products: ProductLive[];
  splits: BaleLive[];
  reviews: ReviewViewSummary;
}

/** Public shop page: `/vendor/[id]`. */
export const getVendorStorefront = cache(async (vendorId: string): Promise<VendorStorefront | null> => {
  if (!isSupabaseLive()) {
    const vendor = getVendorOrNull(vendorId);
    if (!vendor) return null;
    const products = getProductsByVendor(vendorId);
    const splits: BaleLive[] = [];
    for (const bale of BALES) {
      const product = getProductOrNull(bale.productId);
      if (product && product.vendorId === vendorId) splits.push({ bale, product, vendor });
    }
    return { vendor, products: products.map((product) => ({ product, vendor })), splits, reviews: mockReviewSummary(getReviewsForVendor(vendorId)) };
  }

  try {
    const sb = await authed();
    const vendorRow = await getVendorById(sb, vendorId);
    if (!vendorRow) return null;
    const vendor = mapVendorRow(vendorRow);
    const [productRows, reviewSummary] = await Promise.all([
      listProductsByVendor(sb, vendorId),
      listVendorReviews(sb, vendorId),
    ]);
    const products: ProductLive[] = productRows.map((row) => ({ product: mapProductRow(row), vendor }));

    const splits: BaleLive[] = [];
    for (const row of productRows) {
      const baleRow = await getBaleByProductId(sb, row.id);
      if (!baleRow || baleRow.status !== "open") continue;
      const bookings = await listPaidBookings(sb, [baleRow.id]);
      const joiners = bookings.map((booking) => booking.display_label).filter((label): label is string => !!label);
      splits.push({ bale: mapBaleRow(baleRow, row, joiners), product: mapProductRow(row), vendor });
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
    console.warn("[data] live vendor fetch failed — mock fallback", err);
    return getVendorStorefrontFallback(vendorId);
  }
});

function getVendorStorefrontFallback(vendorId: string): VendorStorefront | null {
  const vendor = getVendorOrNull(vendorId);
  if (!vendor) return null;
  const products = getProductsByVendor(vendorId);
  return {
    vendor,
    products: products.map((product) => ({ product, vendor })),
    splits: [],
    reviews: mockReviewSummary(getReviewsForVendor(vendorId)),
  };
}

/**
 * Re-price a set of product ids against the live catalog (or the demo set).
 * Used by the cart and checkout to prove the price the buyer saw is still the
 * price we will charge — the actual charge is always computed by
 * `paystack-initialize` on the server.
 */
export async function getProductsByIds(ids: string[]): Promise<Map<string, ProductLive>> {
  const out = new Map<string, ProductLive>();
  if (ids.length === 0) return out;
  if (!isSupabaseLive()) {
    const vendorById = new Map(VENDORS.map((vendor) => [vendor.id, vendor]));
    for (const id of ids) {
      const product = getProductOrNull(id);
      const vendor = product ? vendorById.get(product.vendorId) : undefined;
      if (product && vendor) out.set(id, { product, vendor });
    }
    return out;
  }
  try {
    const sb = await authed();
    const [rows, baleRows] = await Promise.all([listProductsByIds(sb, ids), listOpenBales(sb)]);
    const activeBaleProducts = new Set(baleRows.map((row) => row.product_id));
    const vendorRows = await listVendorsByIds(sb, [...new Set(rows.map((row) => row.vendor_id))]);
    const vendorById = new Map(vendorRows.map((vendor) => [vendor.id, mapVendorRow(vendor)] as const));
    for (const row of rows) {
      const vendor = vendorById.get(row.vendor_id);
      if (!vendor) continue;
      const product = mapProductRow(row);
      // Split listings are sold per slot, not per unit — surface that in the cart.
      out.set(row.id, { product: activeBaleProducts.has(row.id) ? { ...product, tag: "Bale split" } : product, vendor });
    }
    return out;
  } catch (err) {
    console.warn("[data] live cart reconcile failed", err);
    return out;
  }
}
