/**
 * Client-state entry point.
 *
 * Layering (docs/ENGINEERING-STANDARDS.md §3a):
 *   server state  → React Server Components + `lib/data.ts` + Realtime hooks
 *   client state  → these Zustand stores (cart, wishlist, prefs, inbox)
 *   URL state     → searchParams for anything shareable/bookmarkable
 * Never copy server data into a store, never fetch from a store.
 */
export * from "./cart-store";
export * from "./wishlist-store";
export * from "./prefs-store";
export * from "./notification-store";
export * from "./hooks";
export * from "./storage";
