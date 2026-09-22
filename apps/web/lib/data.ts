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
  getBaleByProductId,
  getProductById,
  listOpenBales,
  listPaidBookings,
  listProducts,
  listProductsByIds,
  listVendorsByIds,
  mapBaleRow,
  mapProductRow,
  mapVendorRow,
  slotsLeft,
  supabaseServer,
  type BaleListing,
  type Product,
  type Vendor,
} from "@bale-drop/database";
import { isSupabaseLive } from "./config";
import {
  BALES,
  PRODUCTS,
  VENDORS,
  getBale as mockGetBale,
  getProduct as mockGetProduct,
  getVendor as mockGetVendor,
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
