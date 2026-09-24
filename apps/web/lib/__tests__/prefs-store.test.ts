import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SHIPPING,
  PREFS_STORAGE_KEY,
  RECENTLY_VIEWED_MAX,
  usePrefsStore,
  type RecentInput,
} from "@/lib/store/prefs-store";

const item = (id: string): RecentInput => ({
  productId: id,
  title: `Item ${id}`,
  price: 1000,
  city: "Lagos",
  category: "Bales",
  grade: "A",
  hue: 200,
  vendorId: "v1",
  vendorName: "Adaeze Thrift Co.",
});

describe("prefs store", () => {
  beforeEach(() => {
    window.localStorage.clear();
    usePrefsStore.setState({
      city: "Lagos",
      theme: "system",
      recentlyViewed: [],
      checkout: { delivery: "standard", payment: "card", shipping: DEFAULT_SHIPPING, promoCode: "" },
      slotClaims: {},
      hydrated: false,
    });
  });

  it("tracks recently viewed newest-first without duplicates", () => {
    usePrefsStore.getState().trackView(item("p1"));
    usePrefsStore.getState().trackView(item("p2"));
    usePrefsStore.getState().trackView(item("p1"));
    const ids = usePrefsStore.getState().recentlyViewed.map((entry) => entry.productId);
    expect(ids).toEqual(["p1", "p2"]);
  });

  it("caps the recently viewed rail", () => {
    for (let index = 0; index < RECENTLY_VIEWED_MAX + 6; index++) {
      usePrefsStore.getState().trackView(item(`p${index}`));
    }
    expect(usePrefsStore.getState().recentlyViewed).toHaveLength(RECENTLY_VIEWED_MAX);
  });

  it("keeps a checkout draft across patches and resets it on demand", () => {
    usePrefsStore.getState().patchCheckout({ delivery: "express", promoCode: "LAUNCH1500" });
    usePrefsStore.getState().patchShipping({ fullAddress: "14 Admiralty Way", phone: "0803 123 4567" });
    const draft = usePrefsStore.getState().checkout;
    expect(draft.delivery).toBe("express");
    expect(draft.shipping.fullAddress).toBe("14 Admiralty Way");
    expect(draft.shipping.phone).toBe("0803 123 4567");

    usePrefsStore.getState().resetCheckout();
    expect(usePrefsStore.getState().checkout.delivery).toBe("standard");
    expect(usePrefsStore.getState().checkout.shipping.fullAddress).toBe("");
  });

  it("remembers a reserved slot claim so a refresh cannot lose it", () => {
    usePrefsStore.getState().rememberClaim("b1", "booking-123");
    expect(usePrefsStore.getState().slotClaims.b1.bookingId).toBe("booking-123");
    usePrefsStore.getState().forgetClaim("b1");
    expect(usePrefsStore.getState().slotClaims.b1).toBeUndefined();
  });

  it("ignores corrupt persisted preferences instead of crashing", () => {
    window.localStorage.setItem(
      PREFS_STORAGE_KEY,
      JSON.stringify({
        state: {
          city: 42,
          theme: "neon",
          recentlyViewed: [{ title: "no id" }, { productId: "p9", grade: "Z" }],
          checkout: { delivery: "teleport", shipping: { city: "" } },
          slotClaims: { b1: { bookingId: 7 }, b2: { bookingId: "ok" } },
        },
        version: 1,
      })
    );
    usePrefsStore.persist.rehydrate();
    const state = usePrefsStore.getState();
    expect(state.city).toBe("Lagos");
    expect(state.theme).toBe("system");
    expect(state.recentlyViewed).toHaveLength(1);
    expect(state.recentlyViewed[0]).toMatchObject({ productId: "p9", grade: "B" });
    expect(state.checkout.delivery).toBe("standard");
    expect(state.checkout.shipping.city).toBe("Lagos");
    expect(state.slotClaims.b1).toBeUndefined();
    expect(state.slotClaims.b2.bookingId).toBe("ok");
    expect(state.hydrated).toBe(true);
  });

  it("persists city changes for the next visit", () => {
    usePrefsStore.getState().setCity("Kano");
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    expect(raw).toContain("Kano");
  });
});
