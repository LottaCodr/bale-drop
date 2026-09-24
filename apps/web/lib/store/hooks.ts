"use client";

/**
 * Store hooks — the small amount of glue every consumer needs so that
 * persisted state never breaks hydration.
 */
import { useEffect, useState } from "react";
import { useCartStore } from "./cart-store";
import { useNotificationStore } from "./notification-store";
import { usePrefsStore, type ThemeChoice } from "./prefs-store";
import { useWishlistStore } from "./wishlist-store";

/**
 * False during SSR and the first client render, true afterwards.
 * Use it to gate anything that only exists in `localStorage` (badge counts,
 * "already in cart" labels) so server HTML and client HTML always match.
 */
export function useHasMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/** True once every persisted store has finished reading from storage. */
export function useStoresHydrated(): boolean {
  const mounted = useHasMounted();
  const cart = useCartStore((state) => state.hydrated);
  const wishlist = useWishlistStore((state) => state.hydrated);
  const prefs = usePrefsStore((state) => state.hydrated);
  return mounted && cart && wishlist && prefs;
}

/**
 * Header badge count. Renders `0` until the cart has been read from storage,
 * then the real number — no flash of the wrong count, no hydration error.
 */
export function useCartCount(): number {
  const mounted = useHasMounted();
  const count = useCartStore((state) => state.lines.reduce((sum, line) => sum + line.qty, 0));
  return mounted ? count : 0;
}

/** Wishlist badge count with the same hydration guard. */
export function useWishlistCount(): number {
  const mounted = useHasMounted();
  const count = useWishlistStore((state) => state.items.length);
  return mounted ? count : 0;
}

/** True when `productId` is in the cart (false before hydration — never wrong). */
export function useInCart(productId: string): boolean {
  const mounted = useHasMounted();
  const inCart = useCartStore((state) => state.lines.some((line) => line.productId === productId));
  return mounted ? inCart : false;
}

/** True when `productId` is on the wishlist (false before hydration). */
export function useIsWished(productId: string): boolean {
  const mounted = useHasMounted();
  const wished = useWishlistStore((state) => state.items.some((item) => item.productId === productId));
  return mounted ? wished : false;
}

/** Delivery city from prefs, with a stable default for the first paint. */
export function useDeliveryCity(): string {
  const mounted = useHasMounted();
  const city = usePrefsStore((state) => state.city);
  return mounted ? city : "Lagos";
}

/** Recently viewed entries plus the clear action (hydrated flag for safety). */
export function useRecentlyViewed(): {
  items: ReturnType<typeof usePrefsStore.getState>["recentlyViewed"];
  clear: () => void;
  hydrated: boolean;
} {
  const mounted = useHasMounted();
  const items = usePrefsStore((state) => state.recentlyViewed);
  const clear = usePrefsStore((state) => state.clearRecentlyViewed);
  const stored = usePrefsStore((state) => state.hydrated);
  return { items, clear, hydrated: mounted && stored };
}

/** Persisted offset for a reserved-but-unpaid Bale Split slot. */
export function useSlotClaim(baleId: string): { bookingId: string; claimedAt: number } | undefined {
  const mounted = useHasMounted();
  const claim = usePrefsStore((state) => state.slotClaims[baleId]);
  return mounted ? claim : undefined;
}

/** Theme choice + setter (safe before hydration: reports "system"). */
export function usePreferences(): { theme: ThemeChoice; setTheme: (theme: ThemeChoice) => void; hydrated: boolean } {
  const mounted = useHasMounted();
  const theme = usePrefsStore((state) => state.theme);
  const setTheme = usePrefsStore((state) => state.setTheme);
  const stored = usePrefsStore((state) => state.hydrated);
  return { theme: mounted ? theme : "system", setTheme, hydrated: mounted && stored };
}

/** The in-progress checkout draft (delivery, payment, shipping, promo). */
export function useCheckoutDraft(): Pick<
  ReturnType<typeof usePrefsStore.getState>,
  "checkout" | "patchCheckout" | "patchShipping" | "resetCheckout"
> & { hydrated: boolean } {
  const mounted = useHasMounted();
  const checkout = usePrefsStore((state) => state.checkout);
  const patchCheckout = usePrefsStore((state) => state.patchCheckout);
  const patchShipping = usePrefsStore((state) => state.patchShipping);
  const resetCheckout = usePrefsStore((state) => state.resetCheckout);
  const stored = usePrefsStore((state) => state.hydrated);
  return { checkout, patchCheckout, patchShipping, resetCheckout, hydrated: mounted && stored };
}

/** Unread notification count + hydration flag for the header bell. */
export function useNotificationBell(): { unread: number; hydrated: boolean } {
  const mounted = useHasMounted();
  const unread = useNotificationStore((state) => state.items.reduce((count, item) => count + (item.read_at ? 0 : 1), 0));
  const stored = useNotificationStore((state) => state.status !== "idle");
  return { unread, hydrated: mounted && stored };
}
