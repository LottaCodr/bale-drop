/**
 * Cart reconciliation — "the price you saw is the price you pay".
 *
 * A persisted cart can be days old: the vendor may have paused the listing,
 * moved the price, or sold out. Escrow commerce cannot discover that at the
 * payment step, so the cart and checkout re-check every line against the
 * catalog before the buyer pays and show exactly what changed.
 *
 * The charge itself is still computed server-side by `paystack-initialize`;
 * this is buyer honesty, not a pricing authority.
 */
import { isSupabaseLive } from "./config";
import { supabaseBrowser } from "./supabase";
import { useCartStore, type CartLine } from "./store/cart-store";

export interface CartChange {
  productId: string;
  title: string;
  from: number;
  to: number;
}

export interface CartReconcileResult {
  checked: number;
  unavailable: CartLine[];
  repriced: CartChange[];
  /** Sold-out / paused lines are dropped from the cart (they can't be bought). */
  removed: boolean;
}

const EMPTY: CartReconcileResult = { checked: 0, unavailable: [], repriced: [], removed: false };

interface CatalogRow {
  id: string;
  title: string;
  price_naira: number;
  status: string;
  qty: number;
}

/**
 * Compare cart lines against the catalog. Also refreshes titles/prices in the
 * store so the cart keeps rendering the truth after a vendor edit.
 */
export async function reconcileCart(lines: CartLine[]): Promise<CartReconcileResult> {
  if (lines.length === 0) return EMPTY;

  let catalog = new Map<string, CatalogRow>();

  if (isSupabaseLive()) {
    const sb = supabaseBrowser();
    const { data, error } = await sb
      .from("products")
      .select("id, title, price_naira, status, qty")
      .in(
        "id",
        lines.map((line) => line.productId)
      );
    if (error) return EMPTY; // offline / RLS — never block the cart on telemetry
    catalog = new Map((data ?? []).map((row) => [row.id, row as CatalogRow]));
  } else {
    // Demo mode still demonstrates the flow, using the bundled dataset.
    const mock = await import("./mock");
    catalog = new Map(
      mock.PRODUCTS.map((product) => [
        product.id,
        { id: product.id, title: product.title, price_naira: product.price, status: "active", qty: 10 },
      ])
    );
  }

  const unavailable: CartLine[] = [];
  const repriced: CartChange[] = [];
  const refreshed: CartLine[] = [];

  for (const line of lines) {
    const row = catalog.get(line.productId);
    if (!row || row.status !== "active" || row.qty <= 0) {
      unavailable.push(line);
      continue;
    }
    const price = row.price_naira;
    if (price !== line.price) repriced.push({ productId: line.productId, title: row.title, from: line.price, to: price });
    refreshed.push({
      ...line,
      title: row.title,
      price,
      qty: row.qty < line.qty ? Math.max(1, row.qty) : line.qty,
    });
  }

  if (unavailable.length > 0) {
    useCartStore.getState().replace(refreshed);
  } else if (repriced.length > 0) {
    useCartStore.getState().replace(refreshed);
  }

  return { checked: lines.length, unavailable, repriced, removed: unavailable.length > 0 };
}
