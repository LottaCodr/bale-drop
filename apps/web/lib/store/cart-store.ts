/**
 * Cart store — the single source of truth for what the buyer intends to pay for.
 *
 * Design rules (see docs/ROADMAP.md → "State model"):
 * - The cart is CLIENT state, persisted to localStorage so it survives refresh,
 *   navigation, sign-in redirects and (with a server merge) devices.
 * - Lines carry a *display snapshot* (title/price/vendor) so the cart, header
 *   badge and empty states render instantly and offline. Prices are never
 *   trusted for money: `paystack-initialize` re-prices every line server-side.
 * - Derived values (count, subtotal) are selectors, never stored state — that
 *   removes a whole class of "cart says ₦5,000 but charges ₦6,000" bugs.
 * - `skipHydration` + an explicit `rehydrate()` in <StoreHydration/> keeps the
 *   server HTML and the first client render identical (no hydration mismatch).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Grade } from "@bale-drop/database";
import { dropStorageKey, persistStorage } from "./storage";

export const CART_STORAGE_KEY = "bale-drop-cart-v1";
export const LEGACY_CART_STORAGE_KEY = "bale-drop-cart";
/** Per-line ceiling, mirrors the qty clamp enforced by the old cart helper. */
export const CART_MAX_QTY = 20;
/** Guard rail so a scripted loop can't persist an unbounded payload. */
export const CART_MAX_LINES = 40;
export const CART_MAX_SAVED = 40;

export interface CartLine {
  productId: string;
  qty: number;
  /** Display snapshot — refreshed from the server at checkout, never trusted for money. */
  title: string;
  price: number;
  city: string;
  category: string;
  grade: Grade;
  hue: number;
  vendorId: string;
  vendorName: string;
  addedAt: number;
}

/** What callers pass in; qty defaults to 1 and is clamped. */
export type CartLineInput = Omit<CartLine, "qty" | "addedAt"> & { qty?: number };

export interface CartMutation {
  /** true when the line was created, false when an existing line was topped up. */
  added: boolean;
  /** qty after the mutation (clamped). */
  qty: number;
}

export interface CartState {
  lines: CartLine[];
  /** "Saved for later" — kept out of totals until moved back. */
  saved: CartLine[];
  promoCode: string | null;
  hydrated: boolean;
  updatedAt: number;
  add: (input: CartLineInput, qty?: number) => CartMutation;
  setQty: (productId: string, qty: number) => void;
  increment: (productId: string, delta?: number) => void;
  remove: (productId: string) => void;
  saveForLater: (productId: string) => void;
  moveToCart: (productId: string) => void;
  removeSaved: (productId: string) => void;
  applyPromo: (code: string | null) => void;
  clear: () => void;
  /** Replace the cart wholesale (reconciliation, cross-device merge). Input is
   *  sanitised, so partially-trusted rows are fine to pass through. */
  replace: (lines: CartLineInput[]) => void;
  markHydrated: () => void;
}

function clampQty(qty: number): number {
  if (!Number.isFinite(qty)) return 1;
  return Math.max(1, Math.min(CART_MAX_QTY, Math.round(qty)));
}

/** Defensive parse of persisted state — localStorage is user-editable. */
export function sanitizeLine(value: unknown): CartLine | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<CartLine>;
  if (typeof raw.productId !== "string" || raw.productId.length === 0) return null;
  return {
    productId: raw.productId,
    qty: clampQty(typeof raw.qty === "number" ? raw.qty : 1),
    title: typeof raw.title === "string" && raw.title ? raw.title : "Bale Drop item",
    price: typeof raw.price === "number" && raw.price >= 0 ? Math.round(raw.price) : 0,
    city: typeof raw.city === "string" ? raw.city : "Lagos",
    category: typeof raw.category === "string" ? raw.category : "Bales",
    grade: raw.grade === "A" || raw.grade === "B" || raw.grade === "C" ? raw.grade : "B",
    hue: typeof raw.hue === "number" ? raw.hue : 160,
    vendorId: typeof raw.vendorId === "string" ? raw.vendorId : "",
    vendorName: typeof raw.vendorName === "string" ? raw.vendorName : "Verified vendor",
    addedAt: typeof raw.addedAt === "number" ? raw.addedAt : Date.now(),
  };
}

function sanitizeList(value: unknown): CartLine[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: CartLine[] = [];
  for (const entry of value) {
    const line = sanitizeLine(entry);
    if (!line || seen.has(line.productId)) continue;
    seen.add(line.productId);
    out.push(line);
    if (out.length >= CART_MAX_LINES) break;
  }
  return out;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      lines: [],
      saved: [],
      promoCode: null,
      hydrated: false,
      updatedAt: 0,

      add: (input, qty = 1) => {
        const desired = clampQty(input.qty ?? qty);
        const existing = get().lines.find((line) => line.productId === input.productId);
        const nextQty = existing ? clampQty(existing.qty + Math.max(1, desired)) : desired;
        const wasSaved = get().saved.some((line) => line.productId === input.productId);

        set((state) => ({
          lines: existing
            ? state.lines.map((line) =>
                line.productId === input.productId
                  ? { ...line, qty: nextQty, price: input.price, title: input.title }
                  : line
              )
            : [...state.lines, { ...input, qty: nextQty, addedAt: Date.now() }].slice(-CART_MAX_LINES),
          // Adding an item that was parked in "saved for later" promotes it back.
          saved: wasSaved ? state.saved.filter((line) => line.productId !== input.productId) : state.saved,
          updatedAt: Date.now(),
        }));

        return { added: !existing, qty: nextQty };
      },

      setQty: (productId, qty) =>
        set((state) => ({
          lines:
            qty <= 0
              ? state.lines.filter((line) => line.productId !== productId)
              : state.lines.map((line) =>
                  line.productId === productId ? { ...line, qty: clampQty(qty) } : line
                ),
          updatedAt: Date.now(),
        })),

      increment: (productId, delta = 1) => {
        const line = get().lines.find((entry) => entry.productId === productId);
        if (!line) return;
        get().setQty(productId, line.qty + delta);
      },

      remove: (productId) =>
        set((state) => ({
          lines: state.lines.filter((line) => line.productId !== productId),
          updatedAt: Date.now(),
        })),

      saveForLater: (productId) =>
        set((state) => {
          const line = state.lines.find((entry) => entry.productId === productId);
          if (!line) return state;
          return {
            lines: state.lines.filter((entry) => entry.productId !== productId),
            saved: [line, ...state.saved.filter((entry) => entry.productId !== productId)].slice(0, CART_MAX_SAVED),
            updatedAt: Date.now(),
          };
        }),

      moveToCart: (productId) =>
        set((state) => {
          const line = state.saved.find((entry) => entry.productId === productId);
          if (!line) return state;
          const existing = state.lines.find((entry) => entry.productId === productId);
          return {
            lines: existing
              ? state.lines.map((entry) =>
                  entry.productId === productId
                    ? { ...entry, qty: clampQty(entry.qty + line.qty) }
                    : entry
                )
              : [...state.lines, line].slice(-CART_MAX_LINES),
            saved: state.saved.filter((entry) => entry.productId !== productId),
            updatedAt: Date.now(),
          };
        }),

      removeSaved: (productId) =>
        set((state) => ({ saved: state.saved.filter((line) => line.productId !== productId) })),

      applyPromo: (code) => set({ promoCode: code ? code.trim().toUpperCase().slice(0, 32) : null }),

      clear: () => set({ lines: [], promoCode: null, updatedAt: Date.now() }),

      replace: (lines) => set({ lines: sanitizeList(lines), updatedAt: Date.now() }),

      markHydrated: () => set({ hydrated: true }),
    }),
    {
      name: CART_STORAGE_KEY,
      version: 1,
      storage: persistStorage<CartState>(),
      skipHydration: true,
      partialize: (state) => ({
        lines: state.lines,
        saved: state.saved,
        promoCode: state.promoCode,
        updatedAt: state.updatedAt,
      }) as CartState,
      merge: (persisted, current) => {
        const incoming = (persisted ?? {}) as Partial<CartState>;
        return {
          ...current,
          lines: sanitizeList(incoming.lines),
          saved: sanitizeList(incoming.saved),
          promoCode: typeof incoming.promoCode === "string" ? incoming.promoCode : null,
          updatedAt: typeof incoming.updatedAt === "number" ? incoming.updatedAt : 0,
        };
      },
      onRehydrateStorage: () => (state) => {
        state?.markHydrated();
      },
    }
  )
);

/* ---------------- selectors (derived, never stored) ---------------- */

export const selectLines = (state: CartState): CartLine[] => state.lines;
export const selectSaved = (state: CartState): CartLine[] => state.saved;
export const selectPromoCode = (state: CartState): string | null => state.promoCode;
export const selectIsHydrated = (state: CartState): boolean => state.hydrated;
export const selectItemCount = (state: CartState): number =>
  state.lines.reduce((sum, line) => sum + line.qty, 0);
export const selectLineCount = (state: CartState): number => state.lines.length;
export const selectSubtotal = (state: CartState): number =>
  state.lines.reduce((sum, line) => sum + line.price * line.qty, 0);
export const selectLine = (productId: string) => (state: CartState): CartLine | undefined =>
  state.lines.find((line) => line.productId === productId);
export const selectHasProduct = (productId: string) => (state: CartState): boolean =>
  state.lines.some((line) => line.productId === productId);
export const selectQty = (productId: string) => (state: CartState): number =>
  state.lines.find((line) => line.productId === productId)?.qty ?? 0;
export const selectVendorIds = (state: CartState): string[] => [
  ...new Set(state.lines.map((line) => line.vendorId).filter(Boolean)),
];

/* ---------------- imperative helpers for non-React callers ---------------- */

/** Header badge count that gets the *current* value outside React (never stale). */
export function cartItemCount(): number {
  return selectItemCount(useCartStore.getState());
}

export function cartSubtotal(): number {
  return selectSubtotal(useCartStore.getState());
}

/**
 * Drop a legacy `bale-drop-cart` payload written by the pre-store helper.
 * The old shape stored only `{productId, qty}` — no title/price/vendor — so it
 * cannot be rendered without a network round-trip; we prefer an honest empty
 * cart over a half-rendered one (no real users existed before the store).
 */
export function discardLegacyCart(): void {
  dropStorageKey(LEGACY_CART_STORAGE_KEY);
}
