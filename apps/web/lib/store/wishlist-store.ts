/**
 * Wishlist store — saved products, optimistic and persisted.
 *
 * The heart button exists on cards, listings and search results, so its state
 * cannot live in a component. Local-first (works signed-out, works offline,
 * works in demo mode); when a session exists <StoreHydration/> merges the
 * server rows in `public.wishlists` (migration 0018) so favourites follow the
 * buyer across devices.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Grade } from "@bale-drop/database";
import { persistStorage } from "./storage";

export const WISHLIST_STORAGE_KEY = "bale-drop-wishlist-v1";
export const WISHLIST_MAX = 100;

export interface WishItem {
  productId: string;
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

export type WishInput = Omit<WishItem, "addedAt">;

export interface WishlistState {
  items: WishItem[];
  hydrated: boolean;
  toggle: (input: WishInput) => boolean;
  add: (input: WishInput) => void;
  remove: (productId: string) => void;
  has: (productId: string) => boolean;
  /** Merge server rows without dropping local-only favourites. */
  merge: (items: WishInput[]) => void;
  clear: () => void;
  markHydrated: () => void;
}

function sanitize(value: unknown): WishItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: WishItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Partial<WishItem>;
    if (typeof raw.productId !== "string" || !raw.productId || seen.has(raw.productId)) continue;
    seen.add(raw.productId);
    out.push({
      productId: raw.productId,
      title: typeof raw.title === "string" && raw.title ? raw.title : "Bale Drop item",
      price: typeof raw.price === "number" && raw.price >= 0 ? Math.round(raw.price) : 0,
      city: typeof raw.city === "string" ? raw.city : "Lagos",
      category: typeof raw.category === "string" ? raw.category : "Bales",
      grade: raw.grade === "A" || raw.grade === "B" || raw.grade === "C" ? raw.grade : "B",
      hue: typeof raw.hue === "number" ? raw.hue : 160,
      vendorId: typeof raw.vendorId === "string" ? raw.vendorId : "",
      vendorName: typeof raw.vendorName === "string" ? raw.vendorName : "Verified vendor",
      addedAt: typeof raw.addedAt === "number" ? raw.addedAt : Date.now(),
    });
    if (out.length >= WISHLIST_MAX) break;
  }
  return out;
}

export const useWishlistStore = create<WishlistState>()(
  persist(
    (set, get) => ({
      items: [],
      hydrated: false,

      add: (input) =>
        set((state) =>
          state.items.some((item) => item.productId === input.productId)
            ? state
            : { items: [{ ...input, addedAt: Date.now() }, ...state.items].slice(0, WISHLIST_MAX) }
        ),

      remove: (productId) =>
        set((state) => ({ items: state.items.filter((item) => item.productId !== productId) })),

      toggle: (input) => {
        const saved = get().items.some((item) => item.productId === input.productId);
        if (saved) get().remove(input.productId);
        else get().add(input);
        return !saved;
      },

      has: (productId) => get().items.some((item) => item.productId === productId),

      merge: (incoming) =>
        set((state) => {
          const byId = new Map(state.items.map((item) => [item.productId, item]));
          for (const item of sanitize(incoming.map((entry) => ({ ...entry, addedAt: Date.now() })))) {
            if (!byId.has(item.productId)) byId.set(item.productId, item);
          }
          return { items: [...byId.values()].sort((a, b) => b.addedAt - a.addedAt).slice(0, WISHLIST_MAX) };
        }),

      clear: () => set({ items: [] }),

      markHydrated: () => set({ hydrated: true }),
    }),
    {
      name: WISHLIST_STORAGE_KEY,
      version: 1,
      storage: persistStorage<WishlistState>(),
      skipHydration: true,
      partialize: (state) => ({ items: state.items }) as WishlistState,
      merge: (persisted, current) => ({
        ...current,
        items: sanitize((persisted as Partial<WishlistState> | undefined)?.items),
      }),
      onRehydrateStorage: () => (state) => {
        state?.markHydrated();
      },
    }
  )
);

export const selectWishItems = (state: WishlistState): WishItem[] => state.items;
export const selectWishCount = (state: WishlistState): number => state.items.length;
export const selectIsWished = (productId: string) => (state: WishlistState): boolean =>
  state.items.some((item) => item.productId === productId);

export function isWishedNow(productId: string): boolean {
  return selectIsWished(productId)(useWishlistStore.getState());
}
