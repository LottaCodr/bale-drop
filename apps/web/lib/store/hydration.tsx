"use client";

/**
 * <StoreHydration/> — mounted exactly once in the root layout.
 *
 * Responsibilities (all idempotent, all client-only):
 *  1. rehydrate every persisted store after mount (`skipHydration` on the store
 *     side keeps the first client render identical to the server render);
 *  2. keep tabs consistent — a cart change in tab A lands in tab B;
 *  3. apply the saved theme and follow OS changes when theme = "system";
 *  4. bridge Supabase auth into client state: merge server wishlist on sign-in,
 *     drop the cached inbox on sign-out.
 */
import { useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import { isSupabaseLive } from "@/lib/config";
import { track } from "@/lib/analytics";
import { discardLegacyCart, useCartStore } from "./cart-store";
import { useWishlistStore } from "./wishlist-store";
import { useNotificationStore } from "./notification-store";
import { usePrefsStore, type ThemeChoice } from "./prefs-store";
import { CART_STORAGE_KEY } from "./cart-store";
import { WISHLIST_STORAGE_KEY } from "./wishlist-store";
import { PREFS_STORAGE_KEY } from "./prefs-store";
import { syncAcrossTabs } from "./storage";

export const PERSISTED_STORE_KEYS = [CART_STORAGE_KEY, WISHLIST_STORAGE_KEY, PREFS_STORAGE_KEY];

/** Re-read all persisted stores from storage. Safe to call repeatedly. */
export function rehydrateStores(): void {
  void useCartStore.persist.rehydrate();
  void useWishlistStore.persist.rehydrate();
  void usePrefsStore.persist.rehydrate();
}

function applyTheme(theme: ThemeChoice): void {
  if (typeof document === "undefined") return;
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  const dark = theme === "dark" || (theme === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function StoreHydration(): null {
  // 1 + 2 — rehydrate and stay in sync with other tabs.
  useEffect(() => {
    discardLegacyCart();
    rehydrateStores();
    return syncAcrossTabs(PERSISTED_STORE_KEYS, rehydrateStores);
  }, []);

  // 3 — theme application (and OS follow when "system").
  const theme = usePrefsStore((state) => state.theme);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system" || typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [theme]);

  // 4 — auth ↔ client state bridge.
  useEffect(() => {
    if (!isSupabaseLive()) return;
    const sb = supabaseBrowser();
    const { data } = sb.auth.onAuthStateChange((event, session) => {
      const userId = session?.user.id;
      if (event === "SIGNED_OUT" || !userId) {
        useNotificationStore.getState().reset();
        return;
      }
      if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
        void import("@/lib/wishlist-sync").then(({ pullWishlist }) => pullWishlist(userId));
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Funnel top: the session started.
  useEffect(() => {
    track("view_home");
  }, []);

  return null;
}

/**
 * No-flash theme bootstrap. Inlined into <head> so the correct class exists
 * before the first paint (avoids a light→dark flash on slow devices).
 */
export const themeBootstrapScript = `(function(){try{var raw=localStorage.getItem("${PREFS_STORAGE_KEY}");var theme=raw?((JSON.parse(raw).state||{}).theme||"system"):"system";var dark=theme==="dark"||(theme==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(dark){document.documentElement.classList.add("dark");document.documentElement.style.colorScheme="dark"}}catch(e){}})();`;
