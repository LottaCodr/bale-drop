/**
 * Preferences store — everything that should survive a refresh but is not
 * money: delivery city, theme, recently viewed, the in-progress checkout draft
 * and reserved Bale Split slots.
 *
 * Checkout drafts matter: losing a filled-in address because the buyer answered
 * a phone call is pure conversion loss (Baymard: form friction is a top-3
 * abandonment cause). We persist the draft and re-hydrate it on return.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Grade } from "@bale-drop/database";
import { persistStorage } from "./storage";

export const PREFS_STORAGE_KEY = "bale-drop-prefs-v1";
export const RECENTLY_VIEWED_MAX = 12;

export type DeliveryMethod = "standard" | "express";
export type PaymentMethod = "card" | "bank_transfer" | "ussd";
export type ThemeChoice = "light" | "dark" | "system";

export interface RecentItem {
  productId: string;
  title: string;
  price: number;
  city: string;
  category: string;
  grade: Grade;
  hue: number;
  vendorId: string;
  vendorName: string;
  viewedAt: number;
}

export type RecentInput = Omit<RecentItem, "viewedAt">;

export interface ShippingDraft {
  addressId: string;
  fullAddress: string;
  city: string;
  phone: string;
}

export interface CheckoutDraft {
  delivery: DeliveryMethod;
  payment: PaymentMethod;
  shipping: ShippingDraft;
  promoCode: string;
}

export interface SlotClaim {
  bookingId: string;
  claimedAt: number;
}

export interface PrefsState {
  hydrated: boolean;
  /** Delivery city shown in the header; drives estimates, not the order address. */
  city: string;
  theme: ThemeChoice;
  recentlyViewed: RecentItem[];
  checkout: CheckoutDraft;
  /** baleId → reserved (pending-payment) booking, so a refresh never loses a claim. */
  slotClaims: Record<string, SlotClaim>;
  setCity: (city: string) => void;
  setTheme: (theme: ThemeChoice) => void;
  trackView: (input: RecentInput) => void;
  clearRecentlyViewed: () => void;
  patchCheckout: (patch: Partial<CheckoutDraft>) => void;
  patchShipping: (patch: Partial<ShippingDraft>) => void;
  resetCheckout: () => void;
  rememberClaim: (baleId: string, bookingId: string) => void;
  forgetClaim: (baleId: string) => void;
  markHydrated: () => void;
}

export const DEFAULT_SHIPPING: ShippingDraft = {
  addressId: "",
  fullAddress: "",
  city: "Lagos",
  phone: "",
};

const DEFAULT_CHECKOUT: CheckoutDraft = {
  delivery: "standard",
  payment: "card",
  shipping: DEFAULT_SHIPPING,
  promoCode: "",
};

export const DEFAULT_CITY = "Lagos";

function sanitizeRecent(value: unknown): RecentItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: RecentItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Partial<RecentItem>;
    if (typeof raw.productId !== "string" || !raw.productId || seen.has(raw.productId)) continue;
    seen.add(raw.productId);
    out.push({
      productId: raw.productId,
      title: typeof raw.title === "string" && raw.title ? raw.title : "Bale Drop item",
      price: typeof raw.price === "number" && raw.price >= 0 ? Math.round(raw.price) : 0,
      city: typeof raw.city === "string" ? raw.city : DEFAULT_CITY,
      category: typeof raw.category === "string" ? raw.category : "Bales",
      grade: raw.grade === "A" || raw.grade === "B" || raw.grade === "C" ? raw.grade : "B",
      hue: typeof raw.hue === "number" ? raw.hue : 160,
      vendorId: typeof raw.vendorId === "string" ? raw.vendorId : "",
      vendorName: typeof raw.vendorName === "string" ? raw.vendorName : "Verified vendor",
      viewedAt: typeof raw.viewedAt === "number" ? raw.viewedAt : Date.now(),
    });
    if (out.length >= RECENTLY_VIEWED_MAX) break;
  }
  return out;
}

function sanitizeClaims(value: unknown): Record<string, SlotClaim> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, SlotClaim> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Partial<SlotClaim>;
    if (typeof raw.bookingId !== "string" || !raw.bookingId) continue;
    out[key] = { bookingId: raw.bookingId, claimedAt: typeof raw.claimedAt === "number" ? raw.claimedAt : Date.now() };
  }
  return out;
}

function sanitizeCheckout(value: unknown): CheckoutDraft {
  if (!value || typeof value !== "object") return DEFAULT_CHECKOUT;
  const raw = value as Partial<CheckoutDraft>;
  const shipping = (raw.shipping ?? {}) as Partial<ShippingDraft>;
  return {
    delivery: raw.delivery === "express" ? "express" : "standard",
    payment: raw.payment === "bank_transfer" || raw.payment === "ussd" ? raw.payment : "card",
    shipping: {
      addressId: typeof shipping.addressId === "string" ? shipping.addressId : "",
      fullAddress: typeof shipping.fullAddress === "string" ? shipping.fullAddress : "",
      city: typeof shipping.city === "string" && shipping.city ? shipping.city : DEFAULT_CITY,
      phone: typeof shipping.phone === "string" ? shipping.phone : "",
    },
    promoCode: typeof raw.promoCode === "string" ? raw.promoCode : "",
  };
}

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      hydrated: false,
      city: DEFAULT_CITY,
      theme: "system",
      recentlyViewed: [],
      checkout: DEFAULT_CHECKOUT,
      slotClaims: {},

      setCity: (city) => set({ city }),
      setTheme: (theme) => set({ theme }),

      trackView: (input) =>
        set((state) => ({
          recentlyViewed: [
            { ...input, viewedAt: Date.now() },
            ...state.recentlyViewed.filter((item) => item.productId !== input.productId),
          ].slice(0, RECENTLY_VIEWED_MAX),
        })),

      clearRecentlyViewed: () => set({ recentlyViewed: [] }),

      patchCheckout: (patch) => set((state) => ({ checkout: { ...state.checkout, ...patch } })),
      patchShipping: (patch) =>
        set((state) => ({ checkout: { ...state.checkout, shipping: { ...state.checkout.shipping, ...patch } } })),
      resetCheckout: () => set({ checkout: DEFAULT_CHECKOUT }),

      rememberClaim: (baleId, bookingId) =>
        set((state) => ({ slotClaims: { ...state.slotClaims, [baleId]: { bookingId, claimedAt: Date.now() } } })),
      forgetClaim: (baleId) =>
        set((state) => {
          const next = { ...state.slotClaims };
          delete next[baleId];
          return { slotClaims: next };
        }),

      markHydrated: () => set({ hydrated: true }),
    }),
    {
      name: PREFS_STORAGE_KEY,
      version: 1,
      storage: persistStorage<PrefsState>(),
      skipHydration: true,
      partialize: (state) => ({
        city: state.city,
        theme: state.theme,
        recentlyViewed: state.recentlyViewed,
        checkout: state.checkout,
        slotClaims: state.slotClaims,
      }) as PrefsState,
      merge: (persisted, current) => {
        const incoming = (persisted ?? {}) as Partial<PrefsState>;
        return {
          ...current,
          city: typeof incoming.city === "string" && incoming.city ? incoming.city : DEFAULT_CITY,
          theme: incoming.theme === "dark" || incoming.theme === "light" ? incoming.theme : "system",
          recentlyViewed: sanitizeRecent(incoming.recentlyViewed),
          checkout: sanitizeCheckout(incoming.checkout),
          slotClaims: sanitizeClaims(incoming.slotClaims),
        };
      },
      onRehydrateStorage: () => (state) => {
        state?.markHydrated();
      },
    }
  )
);

export const selectRecentlyViewed = (state: PrefsState): RecentItem[] => state.recentlyViewed;
export const selectCheckoutDraft = (state: PrefsState): CheckoutDraft => state.checkout;
export const selectCity = (state: PrefsState): string => state.city;
export const selectTheme = (state: PrefsState): ThemeChoice => state.theme;
export const selectSlotClaim = (baleId: string) => (state: PrefsState): SlotClaim | undefined =>
  state.slotClaims[baleId];
