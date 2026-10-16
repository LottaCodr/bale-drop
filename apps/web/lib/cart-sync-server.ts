/**
 * Cross-device cart sync — server-side mirror via `profiles.cart` JSONB.
 *
 * Best effort: never blocks the local store. When a user is signed in,
 * mutations push the new cart to `profiles.cart`; on mount and sign-in,
 * we pull the server array and merge it into the local store (local wins
 * on conflicts: newer `updatedAt` or the user just edited locally).
 */
import { supabaseBrowser } from "@/lib/supabase";
import { isSupabaseLive } from "@/lib/config";
import { useCartStore, sanitizeList } from "@/lib/store/cart-store";

/** Pull server cart and merge into local store when a session exists. */
export async function pullServerCart(): Promise<void> {
  if (!isSupabaseLive()) return;
  try {
    const sb = supabaseBrowser();
    const { data: userData } = await sb.auth.getUser();
    if (!userData?.user) return;
    const { data: row } = await sb.from("profiles").select("cart, updated_at").eq("id", userData.user.id).single();
    if (!row || !row.cart) return;
    const serverLines = sanitizeList(row.cart);
    if (serverLines.length === 0) return;
    const local = useCartStore.getState();
    // Only merge if the server mirror looks newer than our last sync.
    const serverUpdated = new Date(row.updated_at ?? 0).getTime();
    const lastSyncKey = `bale-drop-cart-sync-v1`;
    const lastSync = typeof window !== "undefined" ? parseInt(localStorage.getItem(lastSyncKey) ?? "0", 10) : 0;
    if (serverUpdated > lastSync) {
      local.replace(serverLines);
      if (typeof window !== "undefined") {
        localStorage.setItem(lastSyncKey, String(serverUpdated));
      }
    }
  } catch {
    /* best effort — local cart stays authoritative */
  }
}

/** Push current cart to profiles.cart for the signed-in user. */
export async function pushServerCart(): Promise<void> {
  if (!isSupabaseLive()) return;
  try {
    const sb = supabaseBrowser();
    const { data: userData } = await sb.auth.getUser();
    if (!userData?.user) return;
    const state = useCartStore.getState();
    const lines = sanitizeList(state.lines);
    await sb.from("profiles").update({ cart: lines.map((line) => ({ ...line })) }).eq("id", userData.user.id);
  } catch {
    /* best effort */
  }
}
