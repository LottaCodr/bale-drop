import { beforeEach, describe, expect, it } from "vitest";
import { WISHLIST_STORAGE_KEY, useWishlistStore, type WishInput } from "@/lib/store/wishlist-store";

const product = (id: string): WishInput => ({
  productId: id,
  title: `Saved ${id}`,
  price: 12000,
  city: "Lagos",
  category: "Vintage",
  grade: "A",
  hue: 30,
  vendorId: "v1",
  vendorName: "Adaeze Thrift Co.",
});

describe("wishlist store", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useWishlistStore.setState({ items: [], hydrated: false });
  });

  it("toggles a product on and off", () => {
    expect(useWishlistStore.getState().toggle(product("p1"))).toBe(true);
    expect(useWishlistStore.getState().has("p1")).toBe(true);
    expect(useWishlistStore.getState().toggle(product("p1"))).toBe(false);
    expect(useWishlistStore.getState().has("p1")).toBe(false);
  });

  it("never stores the same product twice", () => {
    useWishlistStore.getState().add(product("p1"));
    useWishlistStore.getState().add(product("p1"));
    expect(useWishlistStore.getState().items).toHaveLength(1);
  });

  it("merges server rows without dropping local favourites", () => {
    useWishlistStore.getState().add(product("local-only"));
    useWishlistStore.getState().merge([product("p1"), product("local-only")]);
    const ids = useWishlistStore.getState().items.map((item) => item.productId).sort();
    expect(ids).toEqual(["local-only", "p1"]);
  });

  it("rehydrates saved items for the next visit", () => {
    useWishlistStore.getState().add(product("p4"));
    const payload = window.localStorage.getItem(WISHLIST_STORAGE_KEY);
    expect(payload).toContain("p4");
    // Fresh page load: only what the previous session persisted survives.
    useWishlistStore.setState({ items: [] });
    window.localStorage.setItem(WISHLIST_STORAGE_KEY, payload as string);
    useWishlistStore.persist.rehydrate();
    expect(useWishlistStore.getState().items).toHaveLength(1);
  });
});
