import { beforeEach, describe, expect, it } from "vitest";
import {
  CART_MAX_QTY,
  CART_STORAGE_KEY,
  cartItemCount,
  cartSubtotal,
  sanitizeLine,
  selectItemCount,
  selectSubtotal,
  useCartStore,
  type CartLineInput,
} from "@/lib/store/cart-store";

/**
 * Cart behaviour is money behaviour: these tests pin the invariants that keep
 * the displayed total equal to what the buyer intends to pay.
 */

const jacket: CartLineInput = {
  productId: "p1",
  title: "Denim Jackets Bale",
  price: 15000,
  city: "Lagos",
  category: "Bales",
  grade: "A",
  hue: 210,
  vendorId: "v1",
  vendorName: "Adaeze Thrift Co.",
};

const bags: CartLineInput = { ...jacket, productId: "p7", title: "Leather Handbags", price: 28000 };

function reset() {
  useCartStore.setState({ lines: [], saved: [], promoCode: null, updatedAt: 0, hydrated: false });
  window.localStorage.clear();
}

describe("cart store", () => {
  beforeEach(reset);

  it("adds a new line with the requested quantity", () => {
    const result = useCartStore.getState().add(jacket, 2);
    expect(result).toEqual({ added: true, qty: 2 });
    expect(selectItemCount(useCartStore.getState())).toBe(2);
    expect(selectSubtotal(useCartStore.getState())).toBe(30000);
  });

  it("tops up an existing line instead of duplicating it", () => {
    useCartStore.getState().add(jacket, 1);
    const result = useCartStore.getState().add(jacket, 3);
    expect(result.added).toBe(false);
    expect(useCartStore.getState().lines).toHaveLength(1);
    expect(selectItemCount(useCartStore.getState())).toBe(4);
  });

  it("clamps quantity to the per-line ceiling", () => {
    useCartStore.getState().add(jacket, CART_MAX_QTY + 10);
    expect(useCartStore.getState().lines[0].qty).toBe(CART_MAX_QTY);
    useCartStore.getState().add(jacket, 5);
    expect(useCartStore.getState().lines[0].qty).toBe(CART_MAX_QTY);
  });

  it("refreshes the stored snapshot price when re-adding a line", () => {
    useCartStore.getState().add(jacket, 1);
    useCartStore.getState().add({ ...jacket, price: 12500 }, 1);
    expect(useCartStore.getState().lines[0].price).toBe(12500);
  });

  it("removes a line when quantity drops to zero", () => {
    useCartStore.getState().add(jacket, 2);
    useCartStore.getState().setQty("p1", 0);
    expect(useCartStore.getState().lines).toHaveLength(0);
  });

  it("moves a line to saved-for-later and back without losing quantity", () => {
    useCartStore.getState().add(jacket, 3);
    useCartStore.getState().saveForLater("p1");
    expect(useCartStore.getState().lines).toHaveLength(0);
    expect(useCartStore.getState().saved[0].qty).toBe(3);
    expect(cartItemCount()).toBe(0);

    useCartStore.getState().moveToCart("p1");
    expect(useCartStore.getState().saved).toHaveLength(0);
    expect(useCartStore.getState().lines[0].qty).toBe(3);
  });

  it("promotes a saved line back to the cart when it is added again", () => {
    useCartStore.getState().add(jacket, 1);
    useCartStore.getState().saveForLater("p1");
    useCartStore.getState().add(jacket, 2);
    expect(useCartStore.getState().saved).toHaveLength(0);
    expect(useCartStore.getState().lines[0].qty).toBe(2);
  });

  it("normalises the promo code and forgets it when the cart is cleared", () => {
    useCartStore.getState().applyPromo(" launch1500 ");
    expect(useCartStore.getState().promoCode).toBe("LAUNCH1500");
    // Clearing happens after a confirmed payment, so the code must not linger
    // on the next basket.
    useCartStore.getState().clear();
    expect(useCartStore.getState().promoCode).toBeNull();
  });

  it("clears paid-for lines but keeps saved-for-later items", () => {
    useCartStore.getState().add(jacket, 1);
    useCartStore.getState().add(bags, 1);
    useCartStore.getState().saveForLater("p7");
    useCartStore.getState().clear();
    expect(useCartStore.getState().lines).toHaveLength(0);
    expect(useCartStore.getState().saved).toHaveLength(1);
  });

  it("keeps derived totals consistent for many lines", () => {
    useCartStore.getState().add(jacket, 2); // 30,000
    useCartStore.getState().add(bags, 3); // 84,000
    expect(cartSubtotal()).toBe(114000);
    expect(cartItemCount()).toBe(5);
  });
});

describe("cart sanitisation", () => {
  beforeEach(reset);

  it("rejects entries without a usable product id", () => {
    expect(sanitizeLine(null)).toBeNull();
    expect(sanitizeLine({ qty: 2 })).toBeNull();
    expect(sanitizeLine({ productId: "" })).toBeNull();
  });

  it("repairs a partially corrupt persisted line instead of dropping the cart", () => {
    const line = sanitizeLine({ productId: "p1", qty: -4, title: "", price: "free", grade: "Z" });
    expect(line).toMatchObject({ productId: "p1", qty: 1, title: "Bale Drop item", price: 0, grade: "B" });
  });

  it("dedupes and caps a hostile persisted list", () => {
    useCartStore.getState().replace([
      { ...jacket, qty: 1 },
      { ...jacket, qty: 5 },
      ...Array.from({ length: 60 }, (_, index) => ({ ...jacket, productId: `x${index}` })),
    ]);
    const lines = useCartStore.getState().lines;
    expect(lines.filter((line) => line.productId === "p1")).toHaveLength(1);
    expect(lines.length).toBeLessThanOrEqual(40);
  });
});

/**
 * Simulate a new page load: in-memory state is discarded, the storage payload a
 * *previous* session wrote is the only thing left. (Note: `setState` itself
 * persists, so the payload has to be captured first — exactly what the browser
 * does when a tab is closed and reopened.)
 */
function simulateFreshSession() {
  const payload = window.localStorage.getItem(CART_STORAGE_KEY);
  expect(payload).toBeTruthy();
  useCartStore.setState({ lines: [], saved: [], promoCode: null, hydrated: false });
  window.localStorage.setItem(CART_STORAGE_KEY, payload as string);
}

describe("cart persistence", () => {
  beforeEach(reset);

  it("rehydrates the cart written by a previous session", () => {
    useCartStore.getState().add(jacket, 2);
    useCartStore.getState().add(bags, 1);
    simulateFreshSession();
    expect(cartItemCount()).toBe(0);

    useCartStore.persist.rehydrate();
    expect(useCartStore.getState().lines).toHaveLength(2);
    expect(cartSubtotal()).toBe(58000);
    expect(useCartStore.getState().hydrated).toBe(true);
  });

  it("recovers from a corrupted storage payload", () => {
    window.localStorage.setItem(CART_STORAGE_KEY, "{not json at all");
    useCartStore.persist.rehydrate();
    expect(useCartStore.getState().lines).toEqual([]);
  });
});
